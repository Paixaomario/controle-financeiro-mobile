import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InstallmentStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AmortizationService, InstallmentSchedule } from '../amortization/amortization.service';
import {
  AdjustPaidAmountDto,
  AmortizeInstallmentsDto,
  CreateLoanDto,
  ReconcilePaymentDto,
} from './loans.dto';

@Injectable()
export class LoansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly amortization: AmortizationService,
  ) {}

  /** Lista todos os financiamentos do usuário, com o status das parcelas para a tela de listagem. */
  async list(userId: string) {
    return this.prisma.loan.findMany({
      where: { userId },
      include: { installments: { select: { status: true }, orderBy: { number: 'asc' } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Cria o Loan e gera todo o cronograma de LoanInstallment de uma vez,
   * usando o AmortizationService (PRICE ou SAC). Tudo dentro de uma
   * transação Prisma — ou cria tudo, ou nada, nunca um Loan "órfão"
   * sem parcelas.
   */
  async createLoan(userId: string, dto: CreateLoanDto) {
    const domain = CreateLoanDto.toDomain(dto);

    const schedule = this.amortization.generateSchedule({
      totalAmountCents: domain.totalAmountCents,
      installmentsTotal: domain.installmentsTotal,
      monthlyInterestRate: domain.monthlyInterestRate,
      firstDueDate: domain.firstDueDate,
      amortizationMethod: domain.amortizationMethod,
    });

    return this.prisma.$transaction(async (tx) => {
      const loan = await tx.loan.create({
        data: {
          userId,
          description: domain.description,
          institution: domain.institution,
          type: domain.type,
          amortizationMethod: domain.amortizationMethod,
          totalAmountCents: domain.totalAmountCents,
          installmentsTotal: domain.installmentsTotal,
          installmentCents: domain.installmentCents,
          dueDay: domain.dueDay,
          firstDueDate: domain.firstDueDate,
          monthlyInterestRate: domain.monthlyInterestRate,
          origin: domain.origin,
          accountId: domain.accountId,
          creditCardId: domain.creditCardId,
        },
      });

      await tx.loanInstallment.createMany({
        data: schedule.map((s) => ({
          loanId: loan.id,
          number: s.number,
          dueDate: s.dueDate,
          amountCents: s.amountCents,
          principalCents: s.principalCents,
          interestCents: s.interestCents,
        })),
      });

      // gera os avisos de vencimento (10d, 5d, 2d, e 3x no dia) para cada parcela
      const reminders = schedule.flatMap((s) => this.buildReminderRows(userId, s));
      await tx.paymentReminder.createMany({ data: reminders });

      return tx.loan.findUniqueOrThrow({
        where: { id: loan.id },
        include: { installments: { orderBy: { number: 'asc' } } },
      });
    });
  }

  /** 10 dias, 5 dias, 2 dias antes, e 3 avisos no próprio dia do vencimento. */
  private buildReminderRows(userId: string, installment: InstallmentSchedule) {
    const due = installment.dueDate;
    const offsets = [10, 5, 2];
    const rows = offsets.map((days) => ({
      userId,
      targetType: 'LOAN_INSTALLMENT' as const,
      dueDate: due,
      scheduledFor: this.subtractDays(due, days),
    }));

    const dayHours = [9, 13, 18];
    for (const hour of dayHours) {
      const scheduledFor = new Date(due);
      scheduledFor.setHours(hour, 0, 0, 0);
      rows.push({ userId, targetType: 'LOAN_INSTALLMENT' as const, dueDate: due, scheduledFor });
    }

    return rows;
  }

  private subtractDays(date: Date, days: number): Date {
    const result = new Date(date);
    result.setDate(result.getDate() - days);
    return result;
  }

  async getStatement(loanId: string, userId: string) {
    const loan = await this.prisma.loan.findFirst({
      where: { id: loanId, userId },
      include: { installments: { orderBy: { number: 'asc' } }, amortizationEvents: true },
    });
    if (!loan) throw new NotFoundException('Financiamento não encontrado');

    const paid = loan.installments.filter((i) => i.status === 'PAID');
    const pending = loan.installments.filter((i) => i.status !== 'PAID');

    const totalPaidCents = paid.reduce((sum, i) => sum + (i.paidAmountCents ?? i.amountCents), 0n);
    const totalInterestPaidCents = paid.reduce((sum, i) => sum + i.interestCents, 0n);
    const totalDiscountCents = paid.reduce((sum, i) => sum + i.discountCents, 0n);
    const remainingBalanceCents = pending.reduce((sum, i) => sum + i.principalCents, 0n);

    return {
      loanId: loan.id,
      description: loan.description,
      installmentsPaid: paid.length,
      installmentsTotal: loan.installmentsTotal,
      totalPaidCents: totalPaidCents.toString(),
      totalInterestPaidCents: totalInterestPaidCents.toString(),
      totalDiscountCents: totalDiscountCents.toString(),
      remainingBalanceCents: remainingBalanceCents.toString(),
      installments: loan.installments.map((i) => ({
        id: i.id,
        number: i.number,
        dueDate: i.dueDate,
        status: i.status,
        amountCents: i.amountCents.toString(),
        paidAmountCents: i.paidAmountCents?.toString() ?? null,
        discountCents: i.discountCents.toString(),
        interestCents: i.interestCents.toString(),
        paymentMethod: i.paymentMethod,
        bankUsed: i.bankUsed,
        isManuallyAdjusted: i.isManuallyAdjusted,
        originalCalculatedCents: i.originalCalculatedCents?.toString() ?? null,
      })),
    };
  }

  /**
   * Amortização extraordinária — usuário digita "15-20" ou "15,16,18",
   * o service calcula o desconto individual de cada parcela e persiste
   * tudo (parcelas + evento agrupador) numa única transação.
   */
  async amortize(loanId: string, userId: string, dto: AmortizeInstallmentsDto) {
    const loan = await this.prisma.loan.findFirst({
      where: { id: loanId, userId },
      include: { installments: { where: { status: 'PENDING' } } },
    });
    if (!loan) throw new NotFoundException('Financiamento não encontrado');
    if (!loan.monthlyInterestRate) {
      throw new BadRequestException('Financiamento sem taxa de juros cadastrada — não é possível calcular desconto');
    }

    const numbers = this.amortization.parseInstallmentNumbersInput(dto.installmentNumbersInput);
    const paidAt = new Date(dto.paidAt);

    const event = this.amortization.calculateAmortizationEvent(
      loan.installments,
      numbers,
      paidAt,
      loan.monthlyInterestRate,
    );

    return this.prisma.$transaction(async (tx) => {
      for (const result of event.perInstallment) {
        await tx.loanInstallment.update({
          where: { loanId_number: { loanId, number: result.installmentNumber } },
          data: {
            status: InstallmentStatus.PAID,
            paidAt,
            discountCents: result.discountCents,
            paidAmountCents: result.payableAmountCents,
          },
        });
      }

      await tx.amortizationEvent.create({
        data: {
          loanId,
          installmentNumbers: numbers,
          paidAt,
          totalPaidCents: event.totalPayableCents,
          totalDiscountCents: event.totalDiscountCents,
        },
      });

      return {
        installmentNumbers: numbers,
        totalOriginalCents: event.totalOriginalCents.toString(),
        totalDiscountCents: event.totalDiscountCents.toString(),
        totalPayableCents: event.totalPayableCents.toString(),
      };
    });
  }

  /** Conciliação de pagamento vinda do parser de SMS/notificação (Fase 2). */
  async reconcilePayment(userId: string, dto: ReconcilePaymentDto) {
    const installment = await this.prisma.loanInstallment.findUnique({
      where: { id: dto.installmentId },
      include: { loan: true },
    });
    if (!installment || installment.loan.userId !== userId) {
      throw new NotFoundException('Parcela não encontrada');
    }
    if (installment.status === 'PAID') {
      throw new BadRequestException('Parcela já conciliada');
    }

    const paidAt = new Date(dto.paidAt);
    const rate = installment.loan.monthlyInterestRate ?? 0;
    const discount = this.amortization.calculateEarlyPaymentDiscount(installment, paidAt, rate);

    return this.prisma.loanInstallment.update({
      where: { id: installment.id },
      data: {
        status: InstallmentStatus.PAID,
        paidAt,
        paymentMethod: dto.paymentMethod,
        bankUsed: dto.bankUsed,
        merchantNameFromSms: dto.merchantNameFromSms,
        discountCents: discount.discountCents,
        paidAmountCents: discount.payableAmountCents,
      },
    });
  }

  /** Ajuste manual — usuário corrige o valor pago quando o cálculo não bate com o extrato real. */
  async adjustPaidAmount(installmentId: string, userId: string, dto: AdjustPaidAmountDto) {
    const installment = await this.prisma.loanInstallment.findUnique({
      where: { id: installmentId },
      include: { loan: true },
    });
    if (!installment || installment.loan.userId !== userId) {
      throw new NotFoundException('Parcela não encontrada');
    }

    const newPaidAmount = BigInt(dto.paidAmountCents);

    return this.prisma.loanInstallment.update({
      where: { id: installmentId },
      data: {
        originalCalculatedCents: installment.originalCalculatedCents ?? installment.paidAmountCents ?? installment.amountCents,
        paidAmountCents: newPaidAmount,
        isManuallyAdjusted: true,
        adjustmentNote: dto.adjustmentNote,
      },
    });
  }

  /**
   * Cancela o financiamento inteiro — nunca apaga (Fase 1: rastreabilidade).
   * Marca cancelledAt no Loan e cancela todas as parcelas ainda PENDING
   * (parcelas já PAID permanecem como estavam, são histórico real).
   * Remove os avisos de vencimento futuros das parcelas canceladas.
   */
  async cancelLoan(loanId: string, userId: string) {
    const loan = await this.prisma.loan.findFirst({ where: { id: loanId, userId } });
    if (!loan) throw new NotFoundException('Financiamento não encontrado');
    if (loan.cancelledAt) return loan; // idempotente

    return this.prisma.$transaction(async (tx) => {
      await tx.loan.update({ where: { id: loanId }, data: { cancelledAt: new Date() } });

      const pending = await tx.loanInstallment.findMany({
        where: { loanId, status: 'PENDING' },
      });

      await tx.loanInstallment.updateMany({
        where: { loanId, status: 'PENDING' },
        data: { status: 'CANCELLED' },
      });

      await tx.paymentReminder.deleteMany({
        where: { loanInstallmentId: { in: pending.map((i) => i.id) }, status: 'PENDING' },
      });

      return tx.loan.findUniqueOrThrow({ where: { id: loanId } });
    });
  }

  /**
   * Estorna o pagamento de UMA parcela específica — volta para PENDING,
   * limpa os campos de pagamento, e cancela (não apaga) a transação que
   * havia sido criada para esse pagamento.
   */
  async cancelInstallmentPayment(installmentId: string, userId: string) {
    const installment = await this.prisma.loanInstallment.findUnique({
      where: { id: installmentId },
      include: { loan: true },
    });
    if (!installment || installment.loan.userId !== userId) {
      throw new NotFoundException('Parcela não encontrada');
    }
    if (installment.status !== 'PAID') {
      throw new BadRequestException('Só é possível estornar uma parcela que está paga');
    }

    return this.prisma.$transaction(async (tx) => {
      if (installment.transactionId) {
        const transaction = await tx.transaction.findUnique({ where: { id: installment.transactionId } });
        if (transaction && !transaction.cancelledAt) {
          await tx.transaction.update({
            where: { id: transaction.id },
            data: { cancelledAt: new Date() },
          });
          if (transaction.accountId) {
            const signedAmount = transaction.type === 'EXPENSE' ? -transaction.amountCents : transaction.amountCents;
            await tx.account.update({
              where: { id: transaction.accountId },
              data: { balanceCents: { increment: -signedAmount } },
            });
          }
        }
      }

      return tx.loanInstallment.update({
        where: { id: installmentId },
        data: {
          status: 'PENDING',
          paidAt: null,
          paidAmountCents: null,
          discountCents: 0n,
          paymentMethod: null,
          bankUsed: null,
          merchantNameFromSms: null,
          isManuallyAdjusted: false,
          originalCalculatedCents: null,
          adjustmentNote: null,
          transactionId: null,
        },
      });
    });
  }
}
