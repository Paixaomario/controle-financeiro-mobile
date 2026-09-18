// Edge Function: financial-coach
// Os 4 agentes de inteligência que transformam o app de "cadastro de
// transações" em assistente financeiro de verdade, sobre os dados que
// já existem (manual + SMS) — sem depender de Open Finance.
//
// action:
//   detect-subscriptions   → Agente Detector de Anomalias (assinaturas)
//   detect-duplicates      → Agente Detector de Anomalias (cobranças duplicadas)
//   detect-category-anomalies → Agente Detector de Anomalias (gasto fora do padrão)
//   monthly-summary        → Agente Conselheiro Financeiro (resumo em linguagem natural)
//   suggest-category       → Agente de Categorização Inteligente (sugestão)
//   confirm-category       → Agente de Categorização Inteligente (aprendizado)
//   run-all                → roda os 3 detectores + o resumo mensal de uma vez

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

function formatBRL(cents: bigint): string {
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  const str = abs.toString().padStart(3, '0');
  const intPart = str.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const decPart = str.slice(-2);
  return `${negative ? '-' : ''}R$ ${intPart},${decPart}`;
}

function normalizeMerchant(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove acentos
    .replace(/\s+/g, ' ')
    .replace(/\d{2,}/g, '') // remove números longos (ex: número de terminal/parcela)
    .trim();
}

Deno.serve(async (req: Request) => {
  const authHeader = req.headers.get('Authorization') ?? '';
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return json({ error: 'Não autenticado' }, 401);

  const { data: appUser } = await supabase.from('app_user').select('id').eq('auth_user_id', user.id).single();
  if (!appUser) return json({ error: 'Perfil não encontrado' }, 404);
  const userId = appUser.id;

  try {
    const { action, payload } = await req.json();

    if (action === 'detect-subscriptions') return json(await detectSubscriptions(supabase, userId));
    if (action === 'detect-duplicates') return json(await detectDuplicates(supabase, userId));
    if (action === 'detect-category-anomalies') return json(await detectCategoryAnomalies(supabase, userId));
    if (action === 'monthly-summary') return json(await monthlySummary(supabase, userId));
    if (action === 'suggest-category') return json(await suggestCategory(supabase, userId, payload.merchantName));
    if (action === 'confirm-category') return json(await confirmCategory(supabase, userId, payload.merchantName, payload.categoryId));
    if (action === 'run-all') {
      const subscriptions = await detectSubscriptions(supabase, userId);
      const duplicates = await detectDuplicates(supabase, userId);
      const anomalies = await detectCategoryAnomalies(supabase, userId);
      const summary = await monthlySummary(supabase, userId);
      return json({ subscriptions, duplicates, anomalies, summary });
    }

    return json({ error: `Ação desconhecida: ${action}` }, 400);
  } catch (err) {
    return json({ error: (err as Error).message }, 400);
  }
});

// ─────────────────────────────────────────────────────────────────────
// Agente Detector de Anomalias
// ─────────────────────────────────────────────────────────────────────

async function detectSubscriptions(supabase: any, userId: string) {
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

  const { data: txs } = await supabase
    .from('transaction')
    .select('id, merchant_name, amount_cents, occurred_at')
    .eq('user_id', userId)
    .eq('type', 'EXPENSE')
    .is('cancelled_at', null)
    .not('merchant_name', 'is', null)
    .gte('occurred_at', sixMonthsAgo.toISOString())
    .order('occurred_at', { ascending: true });

  const groups = new Map<string, Array<{ id: string; amountCents: bigint; occurredAt: Date }>>();
  for (const t of txs ?? []) {
    const key = normalizeMerchant(t.merchant_name);
    if (!key) continue;
    const list = groups.get(key) ?? [];
    list.push({ id: t.id, amountCents: BigInt(t.amount_cents), occurredAt: new Date(t.occurred_at) });
    groups.set(key, list);
  }

  const found: Array<{ merchant: string; amountCents: string; occurrences: number; transactionIds: string[] }> = [];

  for (const [merchant, list] of groups) {
    if (list.length < 2) continue;
    let isRecurring = true;
    for (let i = 1; i < list.length; i++) {
      const daysBetween = Math.round((list[i].occurredAt.getTime() - list[i - 1].occurredAt.getTime()) / 86_400_000);
      const amountDiffPct = Number(
        ((list[i].amountCents > list[i - 1].amountCents ? list[i].amountCents - list[i - 1].amountCents : list[i - 1].amountCents - list[i].amountCents) * 100n) /
          (list[i - 1].amountCents === 0n ? 1n : list[i - 1].amountCents),
      );
      if (!(daysBetween >= 25 && daysBetween <= 35) || amountDiffPct > 10) {
        isRecurring = false;
        break;
      }
    }
    if (isRecurring) {
      found.push({
        merchant,
        amountCents: list[list.length - 1].amountCents.toString(),
        occurrences: list.length,
        transactionIds: list.map((l) => l.id),
      });
    }
  }

  for (const sub of found) {
    await upsertInsight(supabase, userId, {
      type: 'SUBSCRIPTION',
      title: `Assinatura recorrente: ${sub.merchant}`,
      description: `Identificamos ${sub.occurrences} cobranças mensais de ${formatBRL(BigInt(sub.amountCents))} em "${sub.merchant}". Se você não reconhece ou não usa mais, esse é um bom lugar para cortar gasto fixo.`,
      amountCents: BigInt(sub.amountCents),
      relatedTransactionIds: sub.transactionIds,
    });
  }

  return { found: found.length, items: found };
}

async function detectDuplicates(supabase: any, userId: string) {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const { data: txs } = await supabase
    .from('transaction')
    .select('id, merchant_name, amount_cents, occurred_at')
    .eq('user_id', userId)
    .eq('type', 'EXPENSE')
    .is('cancelled_at', null)
    .gte('occurred_at', thirtyDaysAgo.toISOString())
    .order('occurred_at', { ascending: true });

  const list = (txs ?? []).map((t: any) => ({
    id: t.id,
    merchant: t.merchant_name ? normalizeMerchant(t.merchant_name) : '',
    amountCents: BigInt(t.amount_cents),
    occurredAt: new Date(t.occurred_at),
  }));

  const duplicates: Array<{ transactionIds: string[]; merchant: string; amountCents: string }> = [];
  const used = new Set<string>();

  for (let i = 0; i < list.length; i++) {
    if (used.has(list[i].id)) continue;
    for (let j = i + 1; j < list.length; j++) {
      if (used.has(list[j].id)) continue;
      const hoursBetween = Math.abs(list[j].occurredAt.getTime() - list[i].occurredAt.getTime()) / 3_600_000;
      if (list[i].merchant === list[j].merchant && list[i].amountCents === list[j].amountCents && hoursBetween <= 48) {
        duplicates.push({
          transactionIds: [list[i].id, list[j].id],
          merchant: list[i].merchant || 'estabelecimento não identificado',
          amountCents: list[i].amountCents.toString(),
        });
        used.add(list[i].id);
        used.add(list[j].id);
        break;
      }
    }
  }

  for (const dup of duplicates) {
    await upsertInsight(supabase, userId, {
      type: 'DUPLICATE',
      title: `Possível cobrança duplicada: ${dup.merchant}`,
      description: `Duas cobranças de ${formatBRL(BigInt(dup.amountCents))} em "${dup.merchant}" em menos de 48 horas. Vale conferir se não é duplicidade antes de ignorar.`,
      amountCents: BigInt(dup.amountCents),
      relatedTransactionIds: dup.transactionIds,
    });
  }

  return { found: duplicates.length, items: duplicates };
}

async function detectCategoryAnomalies(supabase: any, userId: string) {
  const now = new Date();
  const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const historyStart = new Date(now.getFullYear(), now.getMonth() - 4, 1);

  const { data: txs } = await supabase
    .from('transaction')
    .select('category_id, amount_cents, occurred_at, category:category_id(name)')
    .eq('user_id', userId)
    .eq('type', 'EXPENSE')
    .is('cancelled_at', null)
    .gte('occurred_at', historyStart.toISOString());

  const byCategory = new Map<string, { name: string; monthly: Map<string, bigint> }>();

  for (const t of txs ?? []) {
    const monthKey = t.occurred_at.slice(0, 7);
    const entry = byCategory.get(t.category_id) ?? { name: (t.category as any)?.name ?? '?', monthly: new Map() };
    entry.monthly.set(monthKey, (entry.monthly.get(monthKey) ?? 0n) + BigInt(t.amount_cents));
    byCategory.set(t.category_id, entry);
  }

  const currentMonthKey = currentMonthStart.toISOString().slice(0, 7);
  const anomalies: Array<{ categoryName: string; currentCents: string; averageCents: string; percentAbove: number }> = [];

  for (const [, entry] of byCategory) {
    const currentCents = entry.monthly.get(currentMonthKey) ?? 0n;
    const historicalMonths = [...entry.monthly.entries()].filter(([k]) => k !== currentMonthKey);
    if (historicalMonths.length < 2 || currentCents === 0n) continue;

    const avgCents = historicalMonths.reduce((s, [, v]) => s + v, 0n) / BigInt(historicalMonths.length);
    if (avgCents === 0n) continue;

    const percentAbove = Number(((currentCents - avgCents) * 100n) / avgCents);
    if (percentAbove >= 50) {
      anomalies.push({
        categoryName: entry.name,
        currentCents: currentCents.toString(),
        averageCents: avgCents.toString(),
        percentAbove,
      });
    }
  }

  for (const a of anomalies) {
    await upsertInsight(supabase, userId, {
      type: 'CATEGORY_ANOMALY',
      title: `${a.categoryName} acima do normal este mês`,
      description: `Você já gastou ${formatBRL(BigInt(a.currentCents))} em "${a.categoryName}" este mês, ${a.percentAbove}% acima da sua média (${formatBRL(BigInt(a.averageCents))}). Vale olhar o que mudou.`,
      amountCents: BigInt(a.currentCents),
      monthRef: currentMonthKey,
    });
  }

  return { found: anomalies.length, items: anomalies };
}

// ─────────────────────────────────────────────────────────────────────
// Agente Conselheiro Financeiro
// ─────────────────────────────────────────────────────────────────────

async function monthlySummary(supabase: any, userId: string) {
  const now = new Date();
  const currentStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const previousStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const monthRef = currentStart.toISOString().slice(0, 7);

  const [currentTxs, previousTxs, openInsights] = await Promise.all([
    supabase
      .from('transaction')
      .select('type, amount_cents, category:category_id(name)')
      .eq('user_id', userId)
      .is('cancelled_at', null)
      .gte('occurred_at', currentStart.toISOString()),
    supabase
      .from('transaction')
      .select('type, amount_cents')
      .eq('user_id', userId)
      .is('cancelled_at', null)
      .gte('occurred_at', previousStart.toISOString())
      .lt('occurred_at', currentStart.toISOString()),
    supabase.from('financial_insight').select('type, title').eq('user_id', userId).is('dismissed_at', null).limit(10),
  ]);

  const income = (currentTxs.data ?? []).filter((t: any) => t.type === 'INCOME').reduce((s: bigint, t: any) => s + BigInt(t.amount_cents), 0n);
  const expense = (currentTxs.data ?? []).filter((t: any) => t.type === 'EXPENSE').reduce((s: bigint, t: any) => s + BigInt(t.amount_cents), 0n);
  const prevExpense = (previousTxs.data ?? []).filter((t: any) => t.type === 'EXPENSE').reduce((s: bigint, t: any) => s + BigInt(t.amount_cents), 0n);

  const byCategory = new Map<string, bigint>();
  for (const t of currentTxs.data ?? []) {
    if (t.type !== 'EXPENSE') continue;
    const name = (t.category as any)?.name ?? 'Outros';
    byCategory.set(name, (byCategory.get(name) ?? 0n) + BigInt(t.amount_cents));
  }
  const topCategories = [...byCategory.entries()]
    .sort((a, b) => (b[1] > a[1] ? 1 : -1))
    .slice(0, 3)
    .map(([name, cents]) => `${name}: ${formatBRL(cents)}`);

  const apiKey = Deno.env.get('CLAUDE_API_KEY');
  let narrative: string;

  if (apiKey) {
    const prompt = `Você é um consultor financeiro pessoal direto e gentil, no estilo do assistente Pierre (finanças brasileiras). Gere um resumo curto (máximo 5 frases, português do Brasil) do mês para o usuário, baseado nestes dados:
- Entradas do mês: ${formatBRL(income)}
- Saídas do mês: ${formatBRL(expense)}
- Saídas do mês passado: ${formatBRL(prevExpense)}
- Top 3 categorias de gasto: ${topCategories.join(', ') || 'sem dados suficientes'}
- Alertas já detectados: ${(openInsights.data ?? []).map((i: any) => i.title).join('; ') || 'nenhum'}

Seja específico com os números, aponte se o gasto subiu ou caiu em relação ao mês passado, e termine com UMA sugestão prática e acionável. Não use markdown, não use saudação, vá direto ao ponto.`;

    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 300,
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      const data = await response.json();
      narrative = data.content?.find((b: any) => b.type === 'text')?.text ?? fallbackNarrative();
    } catch {
      narrative = fallbackNarrative();
    }
  } else {
    narrative = fallbackNarrative();
  }

  function fallbackNarrative(): string {
    const diff = expense - prevExpense;
    const trend = diff > 0n ? `subiram ${formatBRL(diff)}` : `caíram ${formatBRL(-diff)}`;
    return `Este mês: ${formatBRL(income)} de entrada e ${formatBRL(expense)} de saída. Suas despesas ${trend} em relação ao mês passado. Categoria com mais gasto: ${topCategories[0] ?? 'sem dados suficientes'}.`;
  }

  await upsertInsight(supabase, userId, {
    type: 'MONTHLY_SUMMARY',
    title: `Resumo de ${monthRef}`,
    description: narrative,
    amountCents: expense,
    monthRef,
  });

  return { monthRef, incomeCents: income.toString(), expenseCents: expense.toString(), narrative };
}

// ─────────────────────────────────────────────────────────────────────
// Agente de Categorização Inteligente
// ─────────────────────────────────────────────────────────────────────

async function suggestCategory(supabase: any, userId: string, merchantName: string) {
  const normalized = normalizeMerchant(merchantName);

  const { data: mapped } = await supabase
    .from('merchant_category_map')
    .select('category_id, times_confirmed')
    .eq('user_id', userId)
    .eq('merchant_pattern', normalized)
    .maybeSingle();

  if (mapped) {
    return { categoryId: mapped.category_id, source: 'learned', confidence: Math.min(50 + mapped.times_confirmed * 10, 95) };
  }

  const apiKey = Deno.env.get('CLAUDE_API_KEY');
  if (!apiKey) return { categoryId: null, source: 'none', confidence: 0 };

  const { data: categories } = await supabase.from('category').select('id, name').eq('user_id', userId).eq('kind', 'EXPENSE');
  if (!categories?.length) return { categoryId: null, source: 'none', confidence: 0 };

  const prompt = `Estabelecimento: "${merchantName}". Categorias disponíveis: ${categories.map((c: any) => `${c.id}:${c.name}`).join(', ')}. Responda APENAS com o ID da categoria mais adequada, nada mais.`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 50, messages: [{ role: 'user', content: prompt }] }),
    });
    const data = await response.json();
    const suggestedId = data.content?.find((b: any) => b.type === 'text')?.text?.trim();
    const match = categories.find((c: any) => c.id === suggestedId);
    return match ? { categoryId: match.id, source: 'ai', confidence: 60 } : { categoryId: null, source: 'none', confidence: 0 };
  } catch {
    return { categoryId: null, source: 'none', confidence: 0 };
  }
}

async function confirmCategory(supabase: any, userId: string, merchantName: string, categoryId: string) {
  const normalized = normalizeMerchant(merchantName);
  if (!normalized) return { saved: false };

  const { data: existing } = await supabase
    .from('merchant_category_map')
    .select('id, times_confirmed, category_id')
    .eq('user_id', userId)
    .eq('merchant_pattern', normalized)
    .maybeSingle();

  if (existing) {
    await supabase
      .from('merchant_category_map')
      .update({
        category_id: categoryId,
        times_confirmed: existing.category_id === categoryId ? existing.times_confirmed + 1 : 1,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id);
  } else {
    await supabase.from('merchant_category_map').insert({ user_id: userId, merchant_pattern: normalized, category_id: categoryId });
  }

  return { saved: true };
}

// ─────────────────────────────────────────────────────────────────────

async function upsertInsight(
  supabase: any,
  userId: string,
  insight: {
    type: string;
    title: string;
    description: string;
    amountCents?: bigint;
    monthRef?: string;
    relatedTransactionIds?: string[];
  },
) {
  const { data: existing } = await supabase
    .from('financial_insight')
    .select('id')
    .eq('user_id', userId)
    .eq('type', insight.type)
    .eq('title', insight.title)
    .is('dismissed_at', null)
    .maybeSingle();

  if (existing) {
    await supabase
      .from('financial_insight')
      .update({ description: insight.description, amount_cents: insight.amountCents ?? null })
      .eq('id', existing.id);
    return;
  }

  await supabase.from('financial_insight').insert({
    user_id: userId,
    type: insight.type,
    title: insight.title,
    description: insight.description,
    amount_cents: insight.amountCents ?? null,
    month_ref: insight.monthRef ?? null,
    related_transaction_ids: insight.relatedTransactionIds ?? null,
  });
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
