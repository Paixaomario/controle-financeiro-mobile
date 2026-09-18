import { AmortizationService } from './amortization.service';

describe('AmortizationService', () => {
  const service = new AmortizationService();

  describe('generateSchedule - PRICE', () => {
    it('gera parcelas fixas que somam exatamente o total financiado', () => {
      const schedule = service.generateSchedule({
        totalAmountCents: 3_600_000n, // R$ 36.000,00
        installmentsTotal: 48,
        monthlyInterestRate: 0.0135,
        firstDueDate: new Date('2026-09-15'),
        amortizationMethod: 'PRICE',
      });

      expect(schedule).toHaveLength(48);

      // todas as parcelas (exceto a última, que absorve resíduo) têm o mesmo valor
      const amounts = new Set(schedule.slice(0, -1).map((s) => s.amountCents.toString()));
      expect(amounts.size).toBe(1);

      // soma do principal amortizado deve fechar exatamente com o total financiado
      const totalPrincipal = schedule.reduce((sum, s) => sum + s.principalCents, 0n);
      expect(totalPrincipal).toBe(3_600_000n);

      // juros decrescem ao longo do tempo (mais no início, menos no fim)
      expect(schedule[0].interestCents).toBeGreaterThan(schedule[47].interestCents);
    });

    it('sem juros, divide o principal igualmente e a última parcela absorve o resíduo', () => {
      const schedule = service.generateSchedule({
        totalAmountCents: 1000n, // R$ 10,00 em 3x — não divide exato
        installmentsTotal: 3,
        monthlyInterestRate: 0,
        firstDueDate: new Date('2026-09-15'),
        amortizationMethod: 'PRICE',
      });

      const total = schedule.reduce((sum, s) => sum + s.amountCents, 0n);
      expect(total).toBe(1000n);
      expect(schedule[0].amountCents).toBe(333n);
      expect(schedule[1].amountCents).toBe(333n);
      expect(schedule[2].amountCents).toBe(334n); // resíduo vai para a última
    });
  });

  describe('generateSchedule - SAC', () => {
    it('gera parcelas decrescentes com principal constante', () => {
      const schedule = service.generateSchedule({
        totalAmountCents: 4_800_000n,
        installmentsTotal: 48,
        monthlyInterestRate: 0.012,
        firstDueDate: new Date('2026-09-15'),
        amortizationMethod: 'SAC',
      });

      const principals = new Set(schedule.slice(0, -1).map((s) => s.principalCents.toString()));
      expect(principals.size).toBe(1); // principal fixo em todas menos a última

      // parcelas SAC são decrescentes
      expect(schedule[0].amountCents).toBeGreaterThan(schedule[10].amountCents);
      expect(schedule[10].amountCents).toBeGreaterThan(schedule[47].amountCents);

      const totalPrincipal = schedule.reduce((sum, s) => sum + s.principalCents, 0n);
      expect(totalPrincipal).toBe(4_800_000n);
    });
  });

  describe('calculateEarlyPaymentDiscount', () => {
    it('aplica desconto proporcional aos dias de antecipação', () => {
      const installment = {
        number: 9,
        dueDate: new Date('2026-09-15'),
        amountCents: 89_000n,
        interestCents: 12_000n,
      };
      const paidAt = new Date('2026-09-12'); // 3 dias antes

      const result = service.calculateEarlyPaymentDiscount(installment, paidAt, 0.0135);

      expect(result.daysEarly).toBe(3);
      expect(result.discountCents).toBeGreaterThan(0n);
      expect(result.discountCents).toBeLessThan(installment.interestCents);
      expect(result.payableAmountCents).toBe(installment.amountCents - result.discountCents);
    });

    it('não aplica desconto se pago na data ou depois', () => {
      const installment = {
        number: 1,
        dueDate: new Date('2026-09-15'),
        amountCents: 89_000n,
        interestCents: 12_000n,
      };
      const result = service.calculateEarlyPaymentDiscount(installment, new Date('2026-09-15'), 0.0135);
      expect(result.discountCents).toBe(0n);
      expect(result.payableAmountCents).toBe(89_000n);
    });

    it('nunca desconta mais do que o valor de juros da parcela', () => {
      const installment = {
        number: 1,
        dueDate: new Date('2026-12-01'),
        amountCents: 89_000n,
        interestCents: 500n, // juros muito baixo
      };
      // pago 300 dias antes — cenário extremo, não pode gerar desconto negativo no principal
      const result = service.calculateEarlyPaymentDiscount(installment, new Date('2026-02-05'), 0.0135);
      expect(result.discountCents).toBeLessThanOrEqual(installment.interestCents);
    });
  });

  describe('parseInstallmentNumbersInput', () => {
    it('expande intervalo "15-20"', () => {
      expect(service.parseInstallmentNumbersInput('15-20')).toEqual([15, 16, 17, 18, 19, 20]);
    });

    it('expande lista "15,16,18"', () => {
      expect(service.parseInstallmentNumbersInput('15,16,18')).toEqual([15, 16, 18]);
    });

    it('rejeita formato inválido', () => {
      expect(() => service.parseInstallmentNumbersInput('abc')).toThrow();
    });

    it('rejeita intervalo invertido', () => {
      expect(() => service.parseInstallmentNumbersInput('20-15')).toThrow();
    });
  });

  describe('calculateAmortizationEvent', () => {
    it('calcula desconto individual por parcela e soma corretamente', () => {
      const schedule = service.generateSchedule({
        totalAmountCents: 3_600_000n,
        installmentsTotal: 48,
        monthlyInterestRate: 0.0135,
        firstDueDate: new Date('2026-01-15'),
        amortizationMethod: 'PRICE',
      });

      const event = service.calculateAmortizationEvent(
        schedule,
        [15, 16, 17, 18, 19, 20],
        new Date('2027-02-01'), // antecipando várias parcelas futuras
        0.0135,
      );

      expect(event.installmentNumbers).toEqual([15, 16, 17, 18, 19, 20]);
      expect(event.perInstallment).toHaveLength(6);
      expect(event.totalDiscountCents).toBeGreaterThan(0n);
      expect(event.totalPayableCents).toBe(event.totalOriginalCents - event.totalDiscountCents);

      // parcela mais distante do vencimento (20) deve ter desconto >= parcela mais próxima (15)
      const d15 = event.perInstallment.find((p) => p.installmentNumber === 15)!;
      const d20 = event.perInstallment.find((p) => p.installmentNumber === 20)!;
      expect(d20.daysEarly).toBeGreaterThan(d15.daysEarly);
    });

    it('lança erro se alguma parcela informada não existir no cronograma', () => {
      const schedule = service.generateSchedule({
        totalAmountCents: 1_000_000n,
        installmentsTotal: 10,
        monthlyInterestRate: 0.01,
        firstDueDate: new Date('2026-01-15'),
        amortizationMethod: 'PRICE',
      });

      expect(() =>
        service.calculateAmortizationEvent(schedule, [8, 9, 99], new Date('2026-06-01'), 0.01),
      ).toThrow(/99/);
    });
  });
});
