import { Injectable } from '@nestjs/common';

/**
 * ─────────────────────────────────────────────────────────────────────────
 * REGRA DE PRECISÃO (Fase 1, seção "Nunca arredondar valores")
 * ─────────────────────────────────────────────────────────────────────────
 * Todo valor monetário de ENTRADA e SAÍDA deste serviço é `bigint` em
 * centavos. A única exceção legítima é o CÁLCULO INTERNO da fórmula de
 * juros (Price/SAC), que depende de uma taxa percentual — matemática
 * financeira exige aritmética de ponto flutuante nesse passo específico.
 * O arredondamento acontece UMA vez, no fechamento de cada parcela
 * (Math.round para o centavo mais próximo), nunca em cascata, e o
 * resultado nunca é reprocessado como float depois de virar bigint.
 * Qualquer diferença residual de centavos entre a soma das parcelas e o
 * valor total financiado é jogada na ÚLTIMA parcela, para nunca "sumir"
 * nem "sobrar" dinheiro por arredondamento.
 * ─────────────────────────────────────────────────────────────────────────
 */

export interface LoanInput {
  totalAmountCents: bigint;
  installmentsTotal: number;
  monthlyInterestRate: number | null; // ex: 0.0135 = 1,35% a.m.
  firstDueDate: Date;
  amortizationMethod: 'PRICE' | 'SAC';
}

export interface InstallmentSchedule {
  number: number;
  dueDate: Date;
  amountCents: bigint;
  principalCents: bigint;
  interestCents: bigint;
}

export interface EarlyPaymentResult {
  installmentNumber: number;
  originalAmountCents: bigint;
  discountCents: bigint;
  payableAmountCents: bigint;
  daysEarly: number;
}

export interface AmortizationEventResult {
  installmentNumbers: number[];
  totalOriginalCents: bigint;
  totalDiscountCents: bigint;
  totalPayableCents: bigint;
  perInstallment: EarlyPaymentResult[];
}

@Injectable()
export class AmortizationService {
  /**
   * Gera o cronograma completo de parcelas para um empréstimo/financiamento/
   * carnê recém-cadastrado, usando o método PRICE (parcela fixa) ou SAC
   * (amortização constante, parcela decrescente).
   */
  generateSchedule(loan: LoanInput): InstallmentSchedule[] {
    if (loan.installmentsTotal <= 0) {
      throw new Error('installmentsTotal deve ser maior que zero');
    }

    const rate = loan.monthlyInterestRate ?? 0;

    return loan.amortizationMethod === 'SAC'
      ? this.generateSac(loan, rate)
      : this.generatePrice(loan, rate);
  }

  private generatePrice(loan: LoanInput, rate: number): InstallmentSchedule[] {
    const n = loan.installmentsTotal;
    const principalTotal = loan.totalAmountCents;

    // Valor fixo da parcela (fórmula Price). Se rate = 0, parcela = principal/n.
    const fixedInstallmentCents =
      rate === 0
        ? principalTotal / BigInt(n)
        : this.centsFromFloat(
            (Number(principalTotal) * rate) / (1 - Math.pow(1 + rate, -n)),
          );

    const schedule: InstallmentSchedule[] = [];
    let remainingPrincipal = principalTotal;
    let allocatedPrincipal = 0n;

    for (let i = 1; i <= n; i++) {
      const isLast = i === n;
      const interestCents = this.centsFromFloat(Number(remainingPrincipal) * rate);

      let principalCents: bigint;
      let amountCents: bigint;

      if (isLast) {
        // última parcela absorve qualquer resíduo de arredondamento,
        // garantindo que a soma das parcelas feche exatamente com o total financiado
        principalCents = principalTotal - allocatedPrincipal;
        amountCents = principalCents + interestCents;
      } else {
        amountCents = fixedInstallmentCents;
        principalCents = amountCents - interestCents;
      }

      schedule.push({
        number: i,
        dueDate: this.addMonths(loan.firstDueDate, i - 1),
        amountCents,
        principalCents,
        interestCents,
      });

      allocatedPrincipal += principalCents;
      remainingPrincipal -= principalCents;
    }

    return schedule;
  }

  private generateSac(loan: LoanInput, rate: number): InstallmentSchedule[] {
    const n = loan.installmentsTotal;
    const principalTotal = loan.totalAmountCents;

    const baseAmortizationCents = principalTotal / BigInt(n);
    const schedule: InstallmentSchedule[] = [];
    let remainingPrincipal = principalTotal;
    let allocatedPrincipal = 0n;

    for (let i = 1; i <= n; i++) {
      const isLast = i === n;
      const interestCents = this.centsFromFloat(Number(remainingPrincipal) * rate);

      const principalCents = isLast
        ? principalTotal - allocatedPrincipal // resíduo de arredondamento na última
        : baseAmortizationCents;

      const amountCents = principalCents + interestCents;

      schedule.push({
        number: i,
        dueDate: this.addMonths(loan.firstDueDate, i - 1),
        amountCents,
        principalCents,
        interestCents,
      });

      allocatedPrincipal += principalCents;
      remainingPrincipal -= principalCents;
    }

    return schedule;
  }

  /**
   * Calcula o desconto pro-rata de uma única parcela paga antecipadamente.
   * O desconto é proporcional aos dias entre o pagamento e o vencimento,
   * aplicado apenas sobre a fração de juros da parcela (o principal nunca
   * sofre desconto — é o valor que efetivamente reduz a dívida).
   */
  calculateEarlyPaymentDiscount(
    installment: { number: number; dueDate: Date; amountCents: bigint; interestCents: bigint },
    paidAt: Date,
    monthlyInterestRate: number,
  ): EarlyPaymentResult {
    const daysEarly = this.diffInDays(installment.dueDate, paidAt);

    if (daysEarly <= 0 || monthlyInterestRate <= 0) {
      return {
        installmentNumber: installment.number,
        originalAmountCents: installment.amountCents,
        discountCents: 0n,
        payableAmountCents: installment.amountCents,
        daysEarly: Math.max(daysEarly, 0),
      };
    }

    const dailyRate = monthlyInterestRate / 30;
    const proportion = Math.min(dailyRate * daysEarly, 1); // nunca descontar mais que 100% dos juros da parcela
    const discountCents = this.centsFromFloat(Number(installment.interestCents) * proportion);
    const cappedDiscount = discountCents > installment.interestCents ? installment.interestCents : discountCents;

    return {
      installmentNumber: installment.number,
      originalAmountCents: installment.amountCents,
      discountCents: cappedDiscount,
      payableAmountCents: installment.amountCents - cappedDiscount,
      daysEarly,
    };
  }

  /**
   * Amortização extraordinária: recebe uma lista de números de parcela
   * (ex: [15,16,17,18,19,20], vindos do input "15-20" já expandido pela
   * camada de validação) e calcula o desconto de cada uma individualmente,
   * já que cada parcela tem uma data de vencimento diferente.
   */
  calculateAmortizationEvent(
    installments: Array<{ number: number; dueDate: Date; amountCents: bigint; interestCents: bigint }>,
    installmentNumbers: number[],
    paidAt: Date,
    monthlyInterestRate: number,
  ): AmortizationEventResult {
    const selected = installments.filter((i) => installmentNumbers.includes(i.number));

    if (selected.length !== installmentNumbers.length) {
      const found = selected.map((s) => s.number);
      const missing = installmentNumbers.filter((n) => !found.includes(n));
      throw new Error(`Parcelas não encontradas ou já pagas: ${missing.join(', ')}`);
    }

    const perInstallment = selected.map((installment) =>
      this.calculateEarlyPaymentDiscount(installment, paidAt, monthlyInterestRate),
    );

    const totalOriginalCents = perInstallment.reduce((sum, r) => sum + r.originalAmountCents, 0n);
    const totalDiscountCents = perInstallment.reduce((sum, r) => sum + r.discountCents, 0n);
    const totalPayableCents = totalOriginalCents - totalDiscountCents;

    return {
      installmentNumbers,
      totalOriginalCents,
      totalDiscountCents,
      totalPayableCents,
      perInstallment,
    };
  }

  /**
   * Expande um input de texto do app ("15-20" ou "15,16,18,20") em uma
   * lista de números de parcela. Validação leve — a validação forte final
   * é conferir se as parcelas existem e estão PENDING no banco.
   */
  parseInstallmentNumbersInput(input: string): number[] {
    const trimmed = input.trim();
    if (/^\d+\s*-\s*\d+$/.test(trimmed)) {
      const [start, end] = trimmed.split('-').map((v) => parseInt(v.trim(), 10));
      if (start > end) throw new Error('Intervalo inválido: início maior que fim');
      const result: number[] = [];
      for (let i = start; i <= end; i++) result.push(i);
      return result;
    }
    if (/^\d+(\s*,\s*\d+)*$/.test(trimmed)) {
      return trimmed.split(',').map((v) => parseInt(v.trim(), 10));
    }
    throw new Error('Formato inválido. Use "15-20" ou "15,16,18"');
  }

  // ── helpers ────────────────────────────────────────────────────────────

  /** Único ponto de arredondamento permitido: fechamento de cálculo financeiro para centavo inteiro. */
  private centsFromFloat(value: number): bigint {
    return BigInt(Math.round(value));
  }

  private addMonths(date: Date, months: number): Date {
    const result = new Date(date);
    result.setMonth(result.getMonth() + months);
    return result;
  }

  private diffInDays(dueDate: Date, paidAt: Date): number {
    const ms = dueDate.getTime() - paidAt.getTime();
    return Math.floor(ms / (1000 * 60 * 60 * 24));
  }
}
