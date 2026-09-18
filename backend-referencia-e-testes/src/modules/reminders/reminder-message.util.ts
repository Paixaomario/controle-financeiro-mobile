/** "-R$ 1.234,56" a partir de centavos em BigInt — nunca passa por Number. */
export function formatCentsToBRL(cents: bigint): string {
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  const reais = (abs / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const centavos = (abs % 100n).toString().padStart(2, '0');
  return `${negative ? '-' : ''}R$ ${reais},${centavos}`;
}

/** Diferença em dias entre agora e a data de vencimento (arredondado). */
export function daysUntil(dueDate: Date, now: Date = new Date()): number {
  const ms = dueDate.getTime() - now.getTime();
  return Math.round(ms / (1000 * 60 * 60 * 24));
}

export interface ReminderPayload {
  title: string;
  body: string;
  url: string;
}

export function buildLoanInstallmentPayload(params: {
  loanDescription: string;
  loanId: string;
  installmentNumber: number;
  installmentsTotal: number;
  amountCents: bigint;
  dueDate: Date;
  now?: Date;
}): ReminderPayload {
  const days = daysUntil(params.dueDate, params.now);
  const when = days <= 0 ? 'vence hoje' : `vence em ${days} dia${days > 1 ? 's' : ''}`;
  const valueBRL = formatCentsToBRL(params.amountCents);

  return {
    title: days <= 0 ? 'Parcela vence hoje' : 'Parcela próxima do vencimento',
    body: `${params.loanDescription} · parcela ${params.installmentNumber}/${params.installmentsTotal} · ${valueBRL} — ${when}`,
    url: `/financiamentos/${params.loanId}`,
  };
}

export function buildFixedExpensePayload(params: {
  description: string;
  expectedAmountCents: bigint;
  dueDate: Date;
  now?: Date;
}): ReminderPayload {
  const days = daysUntil(params.dueDate, params.now);
  const when = days <= 0 ? 'vence hoje' : `vence em ${days} dia${days > 1 ? 's' : ''}`;
  const valueBRL = formatCentsToBRL(params.expectedAmountCents);

  return {
    title: days <= 0 ? 'Conta fixa vence hoje' : 'Conta fixa próxima do vencimento',
    body: `${params.description} · ${valueBRL} — ${when}`,
    url: '/orcamento',
  };
}
