import { Injectable, Controller, Module, Get, Post, Param, Req, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { PushService } from '../push/push.module';
import { buildLoanInstallmentPayload, buildFixedExpensePayload } from './reminder-message.util';

@Injectable()
export class RemindersService {
  private readonly logger = new Logger(RemindersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly push: PushService,
  ) {}

  upcoming(userId: string) {
    return this.prisma.paymentReminder.findMany({
      where: { userId, status: 'PENDING', scheduledFor: { gte: new Date() } },
      orderBy: { scheduledFor: 'asc' },
      take: 20,
    });
  }

  dismiss(userId: string, id: string) {
    return this.prisma.paymentReminder.update({
      where: { id },
      data: { status: 'SENT', sentAt: new Date() },
    });
  }

  /**
   * Cancela avisos futuros de uma parcela/conta já paga — se o usuário
   * quita antes do próximo aviso programado, não faz sentido continuar
   * disparando (Fase 1, seção 7).
   */
  async cancelRemainingForInstallment(loanInstallmentId: string) {
    return this.prisma.paymentReminder.deleteMany({
      where: { loanInstallmentId, status: 'PENDING' },
    });
  }

  /**
   * Roda a cada minuto: varre PaymentReminder com scheduledFor no passado
   * e status PENDING, monta a mensagem certa (parcela de financiamento ou
   * conta fixa) e dispara via Web Push de verdade (Fase 7).
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async dispatchDueReminders() {
    const due = await this.prisma.paymentReminder.findMany({
      where: { status: 'PENDING', scheduledFor: { lte: new Date() } },
      take: 100,
    });

    for (const reminder of due) {
      try {
        const payload = await this.buildPayload(reminder);
        if (payload) {
          await this.push.sendToUser(reminder.userId, payload);
        }
      } catch (err) {
        this.logger.error(`Falha ao montar/enviar aviso ${reminder.id}: ${err}`);
      }

      await this.prisma.paymentReminder.update({
        where: { id: reminder.id },
        data: { status: 'SENT', sentAt: new Date() },
      });
    }
  }

  private async buildPayload(reminder: { targetType: string; loanInstallmentId: string | null; fixedExpenseId: string | null; dueDate: Date }) {
    if (reminder.targetType === 'LOAN_INSTALLMENT' && reminder.loanInstallmentId) {
      const installment = await this.prisma.loanInstallment.findUnique({
        where: { id: reminder.loanInstallmentId },
        include: { loan: true },
      });
      if (!installment || installment.status !== 'PENDING') return null; // já foi paga, não avisa à toa

      return buildLoanInstallmentPayload({
        loanDescription: installment.loan.description,
        loanId: installment.loanId,
        installmentNumber: installment.number,
        installmentsTotal: installment.loan.installmentsTotal,
        amountCents: installment.amountCents,
        dueDate: reminder.dueDate,
      });
    }

    if (reminder.targetType === 'FIXED_EXPENSE' && reminder.fixedExpenseId) {
      const rule = await this.prisma.fixedExpenseRule.findUnique({ where: { id: reminder.fixedExpenseId } });
      if (!rule) return null;

      return buildFixedExpensePayload({
        description: rule.description,
        expectedAmountCents: rule.expectedAmountCents,
        dueDate: reminder.dueDate,
      });
    }

    return null;
  }
}

@Controller('reminders')
export class RemindersController {
  constructor(private readonly reminders: RemindersService) {}

  @Get('upcoming')
  upcoming(@Req() req: any) {
    return this.reminders.upcoming(req.user.id);
  }

  @Post(':id/dismiss')
  dismiss(@Req() req: any, @Param('id') id: string) {
    return this.reminders.dismiss(req.user.id, id);
  }
}

@Module({
  controllers: [RemindersController],
  providers: [RemindersService, PrismaService, PushService],
  exports: [RemindersService],
})
export class RemindersModule {}
