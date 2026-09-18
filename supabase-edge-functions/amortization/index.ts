// Edge Function: amortization
// Porta Deno do AmortizationService (backend/src/modules/amortization) —
// mesma lógica, mesmas regras de precisão (nunca arredonda, BigInt em
// centavos, resíduo sempre na última parcela).
//
// Rotas por `action` no corpo JSON:
//   generate-schedule       → gera cronograma PRICE/SAC
//   early-payment-discount  → desconto de 1 parcela antecipada
//   amortization-event      → amortização extraordinária (várias parcelas)
//   parse-installment-input → expande "15-20" ou "15,16,18"

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';

interface LoanInput {
  totalAmountCents: string;
  installmentsTotal: number;
  monthlyInterestRate: number | null;
  firstDueDate: string;
  amortizationMethod: 'PRICE' | 'SAC';
}

interface InstallmentSchedule {
  number: number;
  dueDate: string;
  amountCents: string;
  principalCents: string;
  interestCents: string;
}

function centsFromFloat(value: number): bigint {
  return BigInt(Math.round(value));
}

function addMonths(dateIso: string, months: number): string {
  const d = new Date(dateIso);
  d.setMonth(d.getMonth() + months);
  return d.toISOString();
}

function diffInDays(dueDateIso: string, paidAtIso: string): number {
  const ms = new Date(dueDateIso).getTime() - new Date(paidAtIso).getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

function generatePrice(loan: LoanInput, rate: number): InstallmentSchedule[] {
  const n = loan.installmentsTotal;
  const principalTotal = BigInt(loan.totalAmountCents);

  const fixedInstallmentCents =
    rate === 0
      ? principalTotal / BigInt(n)
      : centsFromFloat((Number(principalTotal) * rate) / (1 - Math.pow(1 + rate, -n)));

  const schedule: InstallmentSchedule[] = [];
  let remainingPrincipal = principalTotal;
  let allocatedPrincipal = 0n;

  for (let i = 1; i <= n; i++) {
    const isLast = i === n;
    const interestCents = centsFromFloat(Number(remainingPrincipal) * rate);

    let principalCents: bigint;
    let amountCents: bigint;

    if (isLast) {
      principalCents = principalTotal - allocatedPrincipal;
      amountCents = principalCents + interestCents;
    } else {
      amountCents = fixedInstallmentCents;
      principalCents = amountCents - interestCents;
    }

    schedule.push({
      number: i,
      dueDate: addMonths(loan.firstDueDate, i - 1),
      amountCents: amountCents.toString(),
      principalCents: principalCents.toString(),
      interestCents: interestCents.toString(),
    });

    allocatedPrincipal += principalCents;
    remainingPrincipal -= principalCents;
  }

  return schedule;
}

function generateSac(loan: LoanInput, rate: number): InstallmentSchedule[] {
  const n = loan.installmentsTotal;
  const principalTotal = BigInt(loan.totalAmountCents);
  const baseAmortizationCents = principalTotal / BigInt(n);

  const schedule: InstallmentSchedule[] = [];
  let remainingPrincipal = principalTotal;
  let allocatedPrincipal = 0n;

  for (let i = 1; i <= n; i++) {
    const isLast = i === n;
    const interestCents = centsFromFloat(Number(remainingPrincipal) * rate);
    const principalCents = isLast ? principalTotal - allocatedPrincipal : baseAmortizationCents;
    const amountCents = principalCents + interestCents;

    schedule.push({
      number: i,
      dueDate: addMonths(loan.firstDueDate, i - 1),
      amountCents: amountCents.toString(),
      principalCents: principalCents.toString(),
      interestCents: interestCents.toString(),
    });

    allocatedPrincipal += principalCents;
    remainingPrincipal -= principalCents;
  }

  return schedule;
}

function generateSchedule(loan: LoanInput): InstallmentSchedule[] {
  if (loan.installmentsTotal <= 0) throw new Error('installmentsTotal deve ser maior que zero');
  const rate = loan.monthlyInterestRate ?? 0;
  return loan.amortizationMethod === 'SAC' ? generateSac(loan, rate) : generatePrice(loan, rate);
}

function calculateEarlyPaymentDiscount(
  installment: { number: number; dueDate: string; amountCents: string; interestCents: string },
  paidAt: string,
  monthlyInterestRate: number,
) {
  const daysEarly = diffInDays(installment.dueDate, paidAt);
  const amountCents = BigInt(installment.amountCents);
  const interestCents = BigInt(installment.interestCents);

  if (daysEarly <= 0 || monthlyInterestRate <= 0) {
    return {
      installmentNumber: installment.number,
      originalAmountCents: amountCents.toString(),
      discountCents: '0',
      payableAmountCents: amountCents.toString(),
      daysEarly: Math.max(daysEarly, 0),
    };
  }

  const dailyRate = monthlyInterestRate / 30;
  const proportion = Math.min(dailyRate * daysEarly, 1);
  const discountCents = centsFromFloat(Number(interestCents) * proportion);
  const cappedDiscount = discountCents > interestCents ? interestCents : discountCents;

  return {
    installmentNumber: installment.number,
    originalAmountCents: amountCents.toString(),
    discountCents: cappedDiscount.toString(),
    payableAmountCents: (amountCents - cappedDiscount).toString(),
    daysEarly,
  };
}

function calculateAmortizationEvent(
  installments: Array<{ number: number; dueDate: string; amountCents: string; interestCents: string }>,
  installmentNumbers: number[],
  paidAt: string,
  monthlyInterestRate: number,
) {
  const selected = installments.filter((i) => installmentNumbers.includes(i.number));
  if (selected.length !== installmentNumbers.length) {
    const found = selected.map((s) => s.number);
    const missing = installmentNumbers.filter((n) => !found.includes(n));
    throw new Error(`Parcelas não encontradas ou já pagas: ${missing.join(', ')}`);
  }

  const perInstallment = selected.map((i) => calculateEarlyPaymentDiscount(i, paidAt, monthlyInterestRate));
  const totalOriginalCents = perInstallment.reduce((sum, r) => sum + BigInt(r.originalAmountCents), 0n);
  const totalDiscountCents = perInstallment.reduce((sum, r) => sum + BigInt(r.discountCents), 0n);

  return {
    installmentNumbers,
    totalOriginalCents: totalOriginalCents.toString(),
    totalDiscountCents: totalDiscountCents.toString(),
    totalPayableCents: (totalOriginalCents - totalDiscountCents).toString(),
    perInstallment,
  };
}

function parseInstallmentNumbersInput(input: string): number[] {
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

Deno.serve(async (req: Request) => {
  try {
    const { action, payload } = await req.json();
    let result: unknown;

    switch (action) {
      case 'generate-schedule':
        result = generateSchedule(payload);
        break;
      case 'early-payment-discount':
        result = calculateEarlyPaymentDiscount(payload.installment, payload.paidAt, payload.monthlyInterestRate);
        break;
      case 'amortization-event':
        result = calculateAmortizationEvent(
          payload.installments,
          payload.installmentNumbers,
          payload.paidAt,
          payload.monthlyInterestRate,
        );
        break;
      case 'parse-installment-input':
        result = { installmentNumbers: parseInstallmentNumbersInput(payload.input) };
        break;
      default:
        return new Response(JSON.stringify({ error: `Ação desconhecida: ${action}` }), { status: 400 });
    }

    return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 400 });
  }
});
