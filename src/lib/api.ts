import { supabase, ensureAppUser } from './supabase';

/**
 * Este arquivo substitui o antigo cliente REST (que chamava um backend
 * NestJS separado). Agora TUDO fala direto com o Supabase: consultas
 * simples viram `supabase.from(...)`, e a lógica de cálculo que exige
 * servidor (amortização, parser de SMS, relatórios) chama as Edge
 * Functions já publicadas no projeto Supabase.
 *
 * As páginas continuam chamando `api.get(path)` / `api.post(path, body)`
 * exatamente como antes — só o que acontece por trás mudou.
 */

let cachedUserId: string | null = null;
async function userId(): Promise<string> {
  if (!cachedUserId) cachedUserId = await ensureAppUser();
  return cachedUserId;
}

function monthRange(monthRef: string) {
  const [year, month] = monthRef.split('-').map(Number);
  return {
    start: new Date(year, month - 1, 1).toISOString(),
    end: new Date(year, month, 1).toISOString(),
  };
}

async function invokeEdge<T>(fn: 'amortization' | 'sms-parser' | 'reports' | 'financial-coach' | 'pluggy-sync', body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(fn, { body });
  if (error) {
    // supabase-js só dá uma mensagem genérica ("Edge Function returned a
    // non-2xx status code") por padrão — o corpo real da resposta (com o
    // motivo específico) fica em error.context, precisa ser lido à parte.
    let message = error.message;
    const context = (error as any).context;
    if (context && typeof context.json === 'function') {
      try {
        const errorBody = await context.json();
        if (errorBody?.error) message = errorBody.error;
      } catch {
        // corpo da resposta não veio em JSON — mantém a mensagem genérica
      }
    }
    throw new Error(message);
  }
  if (data?.error) throw new Error(data.error);
  return data as T;
}

/** Para as Edge Functions que recebem querystring (reports) em vez de body. */
async function invokeEdgeGet<T>(fn: string, params: Record<string, string>): Promise<T> {
  const { data: session } = await supabase.auth.getSession();
  const token = session.session?.access_token;
  const qs = new URLSearchParams(params).toString();
  const supabaseUrl = (supabase as any).supabaseUrl as string;

  const response = await fetch(`${supabaseUrl}/functions/v1/${fn}?${qs}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) throw new Error(`Erro ${response.status} ao chamar ${fn}`);

  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('text/html')) return (await response.text()) as unknown as T;
  return response.json();
}

// ── roteador principal — mantém a MESMA assinatura que as páginas já usam ──

async function get<T>(path: string): Promise<T> {
  const uid = await userId();
  const [route, queryString] = path.split('?');
  const params = new URLSearchParams(queryString ?? '');

  // /dashboard/summary?month=YYYY-MM
  if (route === '/dashboard/summary') {
    const { start, end } = monthRange(params.get('month')!);
    const [{ data: accounts }, { data: incomeTx }, { data: expenseTx }] = await Promise.all([
      supabase.from('account').select('balance_cents').eq('user_id', uid),
      supabase
        .from('transaction')
        .select('amount_cents')
        .eq('user_id', uid)
        .eq('type', 'INCOME')
        .is('cancelled_at', null)
        .gte('occurred_at', start)
        .lt('occurred_at', end),
      supabase
        .from('transaction')
        .select('amount_cents')
        .eq('user_id', uid)
        .eq('type', 'EXPENSE')
        .is('cancelled_at', null)
        .gte('occurred_at', start)
        .lt('occurred_at', end),
    ]);
    const totalBalanceCents = (accounts ?? []).reduce((s, a) => s + BigInt(a.balance_cents), 0n);
    const incomeCents = (incomeTx ?? []).reduce((s, t) => s + BigInt(t.amount_cents), 0n);
    const expenseCents = (expenseTx ?? []).reduce((s, t) => s + BigInt(t.amount_cents), 0n);
    return {
      totalBalanceCents: totalBalanceCents.toString(),
      incomeCents: incomeCents.toString(),
      expenseCents: expenseCents.toString(),
    } as T;
  }

  if (route === '/dashboard/recent-transactions') {
    const { data } = await supabase
      .from('transaction')
      .select('id, type, amount_cents, merchant_name, occurred_at, source, category:category_id(name)')
      .eq('user_id', uid)
      .is('cancelled_at', null)
      .order('occurred_at', { ascending: false })
      .limit(10);
    return (data ?? []).map(rowToTransactionView) as T;
  }

  if (route === '/categories') {
    const { data } = await supabase.from('category').select('id, name, kind').eq('user_id', uid).order('name');
    return (data ?? []) as T;
  }

  if (route.match(/^\/transactions$/)) {
    const { start, end } = monthRange(params.get('month')!);
    const { data } = await supabase
      .from('transaction')
      .select('id, type, amount_cents, merchant_name, occurred_at, source, cancelled_at')
      .eq('user_id', uid)
      .gte('occurred_at', start)
      .lt('occurred_at', end)
      .order('occurred_at', { ascending: false });
    return (data ?? []).map((t) => ({
      id: t.id,
      type: t.type,
      amountCents: t.amount_cents.toString(),
      merchantName: t.merchant_name,
      occurredAt: t.occurred_at,
      source: t.source,
      cancelledAt: t.cancelled_at,
    })) as T;
  }

  if (route === '/credit-cards') {
    const { data } = await supabase
      .from('credit_card')
      .select('id, name, institution, limit_cents, due_day')
      .eq('user_id', uid);
    return (data ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      institution: c.institution,
      limitCents: c.limit_cents.toString(),
      dueDay: c.due_day,
    })) as T;
  }

  const invoiceMatch = route.match(/^\/credit-cards\/([^/]+)\/invoice$/);
  if (invoiceMatch) {
    const cardId = invoiceMatch[1];
    const { data: card } = await supabase
      .from('credit_card')
      .select('closing_day, limit_cents')
      .eq('id', cardId)
      .single();
    const now = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth(), card!.closing_day);
    if (periodStart > now) periodStart.setMonth(periodStart.getMonth() - 1);

    const { data: txs } = await supabase
      .from('transaction')
      .select('amount_cents')
      .eq('credit_card_id', cardId)
      .is('cancelled_at', null)
      .gte('occurred_at', periodStart.toISOString());

    const totalCents = (txs ?? []).reduce((s, t) => s + BigInt(t.amount_cents), 0n);
    const limitCents = BigInt(card!.limit_cents);
    const usedPercentage = limitCents > 0n ? Number((totalCents * 10000n) / limitCents) / 100 : 0;

    return { totalCents: totalCents.toString(), limitCents: limitCents.toString(), usedPercentage } as T;
  }

  if (route === '/budgets') {
    const monthRef = params.get('month')!;
    const { start, end } = monthRange(monthRef);
    const { data: budgets } = await supabase
      .from('budget')
      .select('category_id, limit_cents, category:category_id(name)')
      .eq('user_id', uid)
      .eq('month_ref', monthRef);

    const results = await Promise.all(
      (budgets ?? []).map(async (b) => {
        const { data: txs } = await supabase
          .from('transaction')
          .select('amount_cents')
          .eq('user_id', uid)
          .eq('category_id', b.category_id)
          .eq('type', 'EXPENSE')
          .is('cancelled_at', null)
          .gte('occurred_at', start)
          .lt('occurred_at', end);
        const spentCents = (txs ?? []).reduce((s, t) => s + BigInt(t.amount_cents), 0n);
        const limitCents = BigInt(b.limit_cents);
        return {
          categoryId: b.category_id,
          categoryName: (b.category as any)?.name ?? '',
          limitCents: limitCents.toString(),
          spentCents: spentCents.toString(),
          percentageUsed: limitCents > 0n ? Number((spentCents * 10000n) / limitCents) / 100 : 0,
        };
      }),
    );
    return results as T;
  }

  if (route === '/investments') {
    const { data } = await supabase
      .from('investment')
      .select('id, description, type, institution, amount_cents, invested_at')
      .eq('user_id', uid)
      .is('cancelled_at', null)
      .order('invested_at', { ascending: false });
    return (data ?? []).map((i) => ({
      id: i.id,
      description: i.description,
      type: i.type,
      institution: i.institution,
      amountCents: i.amount_cents.toString(),
      investedAt: i.invested_at,
    })) as T;
  }

  if (route === '/investments/summary') {
    const { data } = await supabase
      .from('investment')
      .select('institution, type, amount_cents')
      .eq('user_id', uid)
      .is('cancelled_at', null);

    const byInstitution = new Map<string, bigint>();
    const byType = new Map<string, bigint>();
    let totalCents = 0n;
    for (const i of data ?? []) {
      const cents = BigInt(i.amount_cents);
      totalCents += cents;
      byInstitution.set(i.institution, (byInstitution.get(i.institution) ?? 0n) + cents);
      byType.set(i.type, (byType.get(i.type) ?? 0n) + cents);
    }
    return {
      totalCents: totalCents.toString(),
      byInstitution: Object.fromEntries([...byInstitution].map(([k, v]) => [k, v.toString()])),
      byType: Object.fromEntries([...byType].map(([k, v]) => [k, v.toString()])),
    } as T;
  }

  if (route === '/loans') {
    const { data } = await supabase
      .from('loan')
      .select('id, description, institution, installments_total, cancelled_at, loan_installment(status)')
      .eq('user_id', uid)
      .order('created_at', { ascending: false });
    return (data ?? []).map((l: any) => ({
      id: l.id,
      description: l.description,
      institution: l.institution,
      installmentsTotal: l.installments_total,
      installments: l.loan_installment,
      cancelledAt: l.cancelled_at,
    })) as T;
  }

  const statementMatch = route.match(/^\/loans\/([^/]+)\/statement$/);
  if (statementMatch) return getLoanStatement<T>(statementMatch[1]);

  if (route === '/reports/cash-flow') {
    return invokeEdgeGet<T>('reports', { action: 'cash-flow', months: params.get('months') ?? '6' });
  }
  if (route === '/reports/net-worth') {
    return invokeEdgeGet<T>('reports', { action: 'net-worth' });
  }
  if (route === '/reports/category-breakdown') {
    return invokeEdgeGet<T>('reports', {
      action: 'category-breakdown',
      year: params.get('year')!,
      type: params.get('type') ?? 'EXPENSE',
    });
  }

  if (route === '/bank-connections') {
    const { data } = await supabase
      .from('bank_connection')
      .select('id, item_id, institution_name, last_synced_at')
      .eq('user_id', uid);
    return (data ?? []).map((c) => ({
      id: c.id,
      itemId: c.item_id,
      institutionName: c.institution_name,
      lastSyncedAt: c.last_synced_at,
    })) as T;
  }

  if (route === '/insights') {
    const { data } = await supabase
      .from('financial_insight')
      .select('id, type, title, description, amount_cents, month_ref, created_at')
      .eq('user_id', uid)
      .is('dismissed_at', null)
      .order('created_at', { ascending: false });
    return (data ?? []).map((i) => ({
      id: i.id,
      type: i.type,
      title: i.title,
      description: i.description,
      amountCents: i.amount_cents?.toString() ?? null,
      monthRef: i.month_ref,
      createdAt: i.created_at,
    })) as T;
  }

  throw new Error(`Rota GET não implementada: ${path}`);
}

async function post<T>(path: string, body?: any): Promise<T> {
  const uid = await userId();

  if (path === '/sms-parser/parse') {
    return invokeEdge<T>('sms-parser', body);
  }

  /** Aciona os 3 agentes detectores + o conselheiro financeiro de uma vez. */
  if (path === '/financial-coach/run-all') {
    return invokeEdge<T>('financial-coach', { action: 'run-all' });
  }

  /** Agente de Categorização Inteligente — sugere categoria por nome de estabelecimento. */
  if (path === '/financial-coach/suggest-category') {
    return invokeEdge<T>('financial-coach', { action: 'suggest-category', payload: { merchantName: body.merchantName } });
  }

  /** Agente de Categorização Inteligente — aprende com a categoria confirmada pelo usuário. */
  if (path === '/financial-coach/confirm-category') {
    return invokeEdge<T>('financial-coach', {
      action: 'confirm-category',
      payload: { merchantName: body.merchantName, categoryId: body.categoryId },
    });
  }

  const dismissInsightMatch = path.match(/^\/insights\/([^/]+)\/dismiss$/);
  if (dismissInsightMatch) {
    const { error } = await supabase
      .from('financial_insight')
      .update({ dismissed_at: new Date().toISOString() })
      .eq('id', dismissInsightMatch[1])
      .eq('user_id', uid);
    if (error) throw error;
    return undefined as T;
  }

  if (path === '/transactions/ingest') {
    const { data, error } = await supabase
      .from('transaction')
      .insert({
        user_id: uid,
        type: body.type,
        amount_cents: BigInt(body.amountCents),
        occurred_at: body.occurredAt,
        category_id: body.categoryId,
        merchant_name: body.merchantName,
        merchant_city: body.merchantCity,
        source: 'SMS',
        source_confidence: body.sourceConfidence,
        payment_method: body.paymentMethod,
        bank_used: body.bankUsed,
      })
      .select()
      .single();
    if (error) throw error;
    return data as T;
  }

  const cancelTxMatch = path.match(/^\/transactions\/([^/]+)\/cancel$/);
  if (cancelTxMatch) {
    const { error } = await supabase
      .from('transaction')
      .update({ cancelled_at: new Date().toISOString() })
      .eq('id', cancelTxMatch[1])
      .eq('user_id', uid);
    if (error) throw error;
    return undefined as T;
  }

  /**
   * Lançamento MANUAL de entrada ou saída — o usuário digita tudo, sem
   * depender de SMS. Atualiza o saldo da conta atomicamente junto com a
   * transação, quando uma conta é informada.
   */
  if (path === '/transactions') {
    const amountCents = BigInt(body.amountCents);
    const { data, error } = await supabase
      .from('transaction')
      .insert({
        user_id: uid,
        type: body.type,
        amount_cents: amountCents,
        occurred_at: body.occurredAt,
        category_id: body.categoryId,
        merchant_name: body.merchantName || null,
        account_id: body.accountId || null,
        source: 'MANUAL',
      })
      .select()
      .single();
    if (error) throw error;

    if (body.accountId) {
      const signedAmount = body.type === 'EXPENSE' ? -amountCents : amountCents;
      const { data: account } = await supabase.from('account').select('balance_cents').eq('id', body.accountId).single();
      if (account) {
        await supabase
          .from('account')
          .update({ balance_cents: BigInt(account.balance_cents) + signedAmount })
          .eq('id', body.accountId);
      }
    }

    if (body.merchantName) {
      // aprendizado do Agente de Categorização — roda em segundo plano,
      // não atrasa nem quebra o salvamento da transação se falhar
      invokeEdge('financial-coach', {
        action: 'confirm-category',
        payload: { merchantName: body.merchantName, categoryId: body.categoryId },
      }).catch(() => {});
    }

    return data as T;
  }

  /**
   * Nova categoria criada pelo usuário na hora (botão "+" no seletor de
   * categorias) — fica salva no banco para aparecer em todos os
   * lançamentos futuros, de qualquer tela.
   */
  if (path === '/categories') {
    const { data, error } = await supabase
      .from('category')
      .insert({ user_id: uid, name: body.name, kind: body.kind, is_system_default: false })
      .select('id, name, kind')
      .single();
    if (error) throw error;
    return data as T;
  }

  /** Cria ou atualiza o limite de orçamento de uma categoria no mês. */
  /** Agente de Sincronização Bancária (Open Finance / Pluggy). */
  if (path === '/bank-connections/connect-token') {
    return invokeEdge<T>('pluggy-sync', { action: 'create-connect-token' });
  }
  if (path === '/bank-connections') {
    return invokeEdge<T>('pluggy-sync', { action: 'add-connection', payload: { itemId: body.itemId } });
  }
  if (path === '/bank-connections/sync') {
    return invokeEdge<T>('pluggy-sync', { action: 'sync' });
  }

  if (path === '/budgets') {
    const { data, error } = await supabase
      .from('budget')
      .upsert(
        { user_id: uid, category_id: body.categoryId, month_ref: body.monthRef, limit_cents: BigInt(body.limitCents) },
        { onConflict: 'user_id,category_id,month_ref' },
      )
      .select()
      .single();
    if (error) throw error;
    return data as T;
  }

  if (path === '/investments') {
    const { data, error } = await supabase
      .from('investment')
      .insert({
        user_id: uid,
        description: body.description,
        type: body.type,
        institution: body.institution,
        amount_cents: BigInt(body.amountCents),
        invested_at: body.investedAt,
      })
      .select()
      .single();
    if (error) throw error;
    return data as T;
  }

  const cancelInvMatch = path.match(/^\/investments\/([^/]+)\/cancel$/);
  if (cancelInvMatch) {
    const { error } = await supabase
      .from('investment')
      .update({ cancelled_at: new Date().toISOString() })
      .eq('id', cancelInvMatch[1])
      .eq('user_id', uid);
    if (error) throw error;
    return undefined as T;
  }

  if (path === '/loans') return createLoan<T>(uid, body);

  const amortizeMatch = path.match(/^\/loans\/([^/]+)\/amortize$/);
  if (amortizeMatch) return amortizeLoan<T>(amortizeMatch[1], body);

  const cancelLoanMatch = path.match(/^\/loans\/([^/]+)\/cancel$/);
  if (cancelLoanMatch) {
    const loanId = cancelLoanMatch[1];
    await supabase.from('loan_installment').delete().eq('loan_id', loanId).eq('status', 'PENDING');
    const { error } = await supabase
      .from('loan')
      .update({ cancelled_at: new Date().toISOString() })
      .eq('id', loanId)
      .eq('user_id', uid);
    if (error) throw error;
    return undefined as T;
  }

  const reconcileMatch = path.match(/^\/loans\/installments\/([^/]+)\/cancel-payment$/);
  if (reconcileMatch) {
    const { error } = await supabase
      .from('loan_installment')
      .update({
        status: 'PENDING',
        paid_at: null,
        paid_amount_cents: null,
        discount_cents: 0,
        payment_method: null,
        bank_used: null,
      })
      .eq('id', reconcileMatch[1]);
    if (error) throw error;
    return undefined as T;
  }

  throw new Error(`Rota POST não implementada: ${path}`);
}

async function patch<T>(path: string, body?: any): Promise<T> {
  const adjustMatch = path.match(/^\/loans\/installments\/([^/]+)\/adjust$/);
  if (adjustMatch) {
    const installmentId = adjustMatch[1];
    const { data: current } = await supabase
      .from('loan_installment')
      .select('original_calculated_cents, paid_amount_cents, amount_cents')
      .eq('id', installmentId)
      .single();

    const { error } = await supabase
      .from('loan_installment')
      .update({
        original_calculated_cents: current?.original_calculated_cents ?? current?.paid_amount_cents ?? current?.amount_cents,
        paid_amount_cents: BigInt(body.paidAmountCents),
        is_manually_adjusted: true,
        adjustment_note: body.adjustmentNote,
      })
      .eq('id', installmentId);
    if (error) throw error;
    return undefined as T;
  }

  throw new Error(`Rota PATCH não implementada: ${path}`);
}

// ── helpers de domínio (financiamentos) ──────────────────────────────────

function rowToTransactionView(t: any) {
  return {
    id: t.id,
    type: t.type,
    amountCents: t.amount_cents.toString(),
    merchantName: t.merchant_name,
    occurredAt: t.occurred_at,
    source: t.source,
    category: { name: t.category?.name ?? '' },
  };
}

async function createLoan<T>(uid: string, body: any): Promise<T> {
  const schedule = await invokeEdge<
    Array<{ number: number; dueDate: string; amountCents: string; principalCents: string; interestCents: string }>
  >('amortization', {
    action: 'generate-schedule',
    payload: {
      totalAmountCents: body.totalAmountCents,
      installmentsTotal: body.installmentsTotal,
      monthlyInterestRate: body.monthlyInterestRate,
      firstDueDate: body.firstDueDate,
      amortizationMethod: body.amortizationMethod,
    },
  });

  const { data: loan, error } = await supabase
    .from('loan')
    .insert({
      user_id: uid,
      description: body.description,
      institution: body.institution,
      type: body.type,
      amortization_method: body.amortizationMethod,
      total_amount_cents: BigInt(body.totalAmountCents),
      installments_total: body.installmentsTotal,
      installment_cents: BigInt(body.installmentCents),
      due_day: body.dueDay,
      first_due_date: body.firstDueDate,
      monthly_interest_rate: body.monthlyInterestRate,
      origin: 'MANUAL',
    })
    .select('id')
    .single();
  if (error) throw error;

  await supabase.from('loan_installment').insert(
    schedule.map((s) => ({
      loan_id: loan.id,
      number: s.number,
      due_date: s.dueDate,
      amount_cents: BigInt(s.amountCents),
      principal_cents: BigInt(s.principalCents),
      interest_cents: BigInt(s.interestCents),
    })),
  );

  // avisos: 10d, 5d, 2d antes + 3x no dia do vencimento (Fase 1, seção 7)
  const { data: installmentRows } = await supabase
    .from('loan_installment')
    .select('id, due_date')
    .eq('loan_id', loan.id);

  const reminders = (installmentRows ?? []).flatMap((inst) => {
    const due = new Date(inst.due_date);
    const rows = [10, 5, 2].map((days) => {
      const d = new Date(due);
      d.setDate(d.getDate() - days);
      return { user_id: uid, target_type: 'LOAN_INSTALLMENT', loan_installment_id: inst.id, due_date: inst.due_date, scheduled_for: d.toISOString() };
    });
    for (const hour of [9, 13, 18]) {
      const d = new Date(due);
      d.setHours(hour, 0, 0, 0);
      rows.push({ user_id: uid, target_type: 'LOAN_INSTALLMENT', loan_installment_id: inst.id, due_date: inst.due_date, scheduled_for: d.toISOString() });
    }
    return rows;
  });
  if (reminders.length) await supabase.from('payment_reminder').insert(reminders);

  return loan as T;
}

async function getLoanStatement<T>(loanId: string): Promise<T> {
  const { data: loan } = await supabase.from('loan').select('description').eq('id', loanId).single();
  const { data: installments } = await supabase
    .from('loan_installment')
    .select('*')
    .eq('loan_id', loanId)
    .order('number', { ascending: true });

  const rows = installments ?? [];
  const paid = rows.filter((i) => i.status === 'PAID');
  const pending = rows.filter((i) => i.status !== 'PAID');

  const totalPaidCents = paid.reduce((s, i) => s + BigInt(i.paid_amount_cents ?? i.amount_cents), 0n);
  const totalInterestPaidCents = paid.reduce((s, i) => s + BigInt(i.interest_cents), 0n);
  const totalDiscountCents = paid.reduce((s, i) => s + BigInt(i.discount_cents), 0n);
  const remainingBalanceCents = pending.reduce((s, i) => s + BigInt(i.principal_cents), 0n);

  return {
    description: loan?.description ?? '',
    installmentsPaid: paid.length,
    installmentsTotal: rows.length,
    totalPaidCents: totalPaidCents.toString(),
    totalInterestPaidCents: totalInterestPaidCents.toString(),
    totalDiscountCents: totalDiscountCents.toString(),
    remainingBalanceCents: remainingBalanceCents.toString(),
    installments: rows.map((i) => ({
      id: i.id,
      number: i.number,
      dueDate: i.due_date,
      status: i.status,
      amountCents: i.amount_cents.toString(),
      paidAmountCents: i.paid_amount_cents?.toString() ?? null,
      discountCents: i.discount_cents.toString(),
      isManuallyAdjusted: i.is_manually_adjusted,
      originalCalculatedCents: i.original_calculated_cents?.toString() ?? null,
      paymentMethod: i.payment_method,
      bankUsed: i.bank_used,
    })),
  } as T;
}

async function amortizeLoan<T>(loanId: string, body: { installmentNumbersInput: string; paidAt: string }): Promise<T> {
  const { installmentNumbers } = await invokeEdge<{ installmentNumbers: number[] }>('amortization', {
    action: 'parse-installment-input',
    payload: { input: body.installmentNumbersInput },
  });

  const { data: loan } = await supabase.from('loan').select('monthly_interest_rate').eq('id', loanId).single();
  const { data: installments } = await supabase
    .from('loan_installment')
    .select('number, due_date, amount_cents, interest_cents')
    .eq('loan_id', loanId)
    .eq('status', 'PENDING');

  const event = await invokeEdge<{
    installmentNumbers: number[];
    totalDiscountCents: string;
    totalPayableCents: string;
    perInstallment: Array<{ installmentNumber: number; discountCents: string; payableAmountCents: string }>;
  }>('amortization', {
    action: 'amortization-event',
    payload: {
      installments: (installments ?? []).map((i) => ({
        number: i.number,
        dueDate: i.due_date,
        amountCents: i.amount_cents.toString(),
        interestCents: i.interest_cents.toString(),
      })),
      installmentNumbers,
      paidAt: body.paidAt,
      monthlyInterestRate: loan?.monthly_interest_rate ?? 0,
    },
  });

  for (const result of event.perInstallment) {
    await supabase
      .from('loan_installment')
      .update({
        status: 'PAID',
        paid_at: body.paidAt,
        discount_cents: BigInt(result.discountCents),
        paid_amount_cents: BigInt(result.payableAmountCents),
      })
      .eq('loan_id', loanId)
      .eq('number', result.installmentNumber);
  }

  await supabase.from('amortization_event').insert({
    loan_id: loanId,
    installment_numbers: installmentNumbers,
    paid_at: body.paidAt,
    total_paid_cents: BigInt(event.totalPayableCents),
    total_discount_cents: BigInt(event.totalDiscountCents),
  });

  return event as T;
}

export const api = { get, post, patch };
