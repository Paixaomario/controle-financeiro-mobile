import { LoanType, AmortizationMethod, LoanOrigin } from '@prisma/client';

/**
 * Todos os valores monetários chegam como STRING (centavos) no payload,
 * nunca como number/float — evita que o JSON.parse do Node ou qualquer
 * middleware silenciosamente vire ponto flutuante antes de virar BigInt.
 * A conversão para BigInt acontece explicitamente aqui, uma única vez.
 */

export class CreateLoanDto {
  description!: string;
  institution?: string;
  type!: LoanType;
  amortizationMethod!: AmortizationMethod; // 'PRICE' | 'SAC'
  totalAmountCents!: string; // ex: "3600000" = R$ 36.000,00
  installmentsTotal!: number;
  installmentCents!: string;
  dueDay!: number;
  firstDueDate!: string; // ISO date
  monthlyInterestRate?: number; // ex: 0.0135
  origin?: LoanOrigin;
  accountId?: string;
  creditCardId?: string;

  static toDomain(dto: CreateLoanDto) {
    return {
      description: dto.description,
      institution: dto.institution ?? null,
      type: dto.type,
      amortizationMethod: dto.amortizationMethod,
      totalAmountCents: BigInt(dto.totalAmountCents),
      installmentsTotal: dto.installmentsTotal,
      installmentCents: BigInt(dto.installmentCents),
      dueDay: dto.dueDay,
      firstDueDate: new Date(dto.firstDueDate),
      monthlyInterestRate: dto.monthlyInterestRate ?? null,
      origin: dto.origin ?? 'MANUAL',
      accountId: dto.accountId ?? null,
      creditCardId: dto.creditCardId ?? null,
    };
  }
}

export class AmortizeInstallmentsDto {
  installmentNumbersInput!: string; // ex: "15-20" ou "15,16,18"
  paidAt!: string; // ISO date
}

export class AdjustPaidAmountDto {
  paidAmountCents!: string;
  adjustmentNote?: string;
}

export class ReconcilePaymentDto {
  installmentId!: string;
  paymentMethod!: 'DEBIT' | 'CREDIT' | 'PIX' | 'BOLETO' | 'OTHER';
  bankUsed?: string;
  merchantNameFromSms?: string;
  paidAt!: string;
}
