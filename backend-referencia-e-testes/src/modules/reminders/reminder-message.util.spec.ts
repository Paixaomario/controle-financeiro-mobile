import {
  formatCentsToBRL,
  daysUntil,
  buildLoanInstallmentPayload,
  buildFixedExpensePayload,
} from './reminder-message.util';

describe('formatCentsToBRL', () => {
  it('formata milhar e centavos corretamente', () => {
    expect(formatCentsToBRL(1234567n)).toBe('R$ 12.345,67');
  });

  it('formata valores negativos', () => {
    expect(formatCentsToBRL(-89000n)).toBe('-R$ 890,00');
  });

  it('formata valores pequenos sem separador de milhar', () => {
    expect(formatCentsToBRL(500n)).toBe('R$ 5,00');
  });

  it('formata zero', () => {
    expect(formatCentsToBRL(0n)).toBe('R$ 0,00');
  });
});

describe('daysUntil', () => {
  it('calcula dias positivos corretamente', () => {
    const now = new Date('2026-08-10T12:00:00');
    const due = new Date('2026-08-15T12:00:00');
    expect(daysUntil(due, now)).toBe(5);
  });

  it('retorna zero ou negativo quando já venceu', () => {
    const now = new Date('2026-08-16T12:00:00');
    const due = new Date('2026-08-15T12:00:00');
    expect(daysUntil(due, now)).toBeLessThanOrEqual(0);
  });
});

describe('buildLoanInstallmentPayload', () => {
  it('monta título e corpo corretos para parcela futura', () => {
    const payload = buildLoanInstallmentPayload({
      loanDescription: 'Financiamento veículo',
      loanId: 'loan-1',
      installmentNumber: 10,
      installmentsTotal: 48,
      amountCents: 89000n,
      dueDate: new Date('2026-08-15T12:00:00'),
      now: new Date('2026-08-10T12:00:00'),
    });

    expect(payload.title).toBe('Parcela próxima do vencimento');
    expect(payload.body).toContain('Financiamento veículo');
    expect(payload.body).toContain('parcela 10/48');
    expect(payload.body).toContain('R$ 890,00');
    expect(payload.body).toContain('vence em 5 dias');
    expect(payload.url).toBe('/financiamentos/loan-1');
  });

  it('usa "vence hoje" quando a data de vencimento é hoje', () => {
    const now = new Date('2026-08-15T09:00:00');
    const payload = buildLoanInstallmentPayload({
      loanDescription: 'Carnê loja',
      loanId: 'loan-2',
      installmentNumber: 3,
      installmentsTotal: 12,
      amountCents: 15000n,
      dueDate: new Date('2026-08-15T00:00:00'),
      now,
    });

    expect(payload.title).toBe('Parcela vence hoje');
    expect(payload.body).toContain('vence hoje');
  });

  it('usa singular para 1 dia restante', () => {
    const payload = buildLoanInstallmentPayload({
      loanDescription: 'Empréstimo pessoal',
      loanId: 'loan-3',
      installmentNumber: 1,
      installmentsTotal: 6,
      amountCents: 50000n,
      dueDate: new Date('2026-08-11T12:00:00'),
      now: new Date('2026-08-10T12:00:00'),
    });

    expect(payload.body).toContain('vence em 1 dia');
    expect(payload.body).not.toContain('1 dias');
  });
});

describe('buildFixedExpensePayload', () => {
  it('monta payload correto para conta fixa', () => {
    const payload = buildFixedExpensePayload({
      description: 'Energia elétrica',
      expectedAmountCents: 18990n,
      dueDate: new Date('2026-08-20T12:00:00'),
      now: new Date('2026-08-15T12:00:00'),
    });

    expect(payload.title).toBe('Conta fixa próxima do vencimento');
    expect(payload.body).toBe('Energia elétrica · R$ 189,90 — vence em 5 dias');
    expect(payload.url).toBe('/orcamento');
  });
});
