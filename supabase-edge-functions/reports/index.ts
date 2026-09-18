// Edge Function: reports
// Fluxo de caixa, patrimônio líquido, gastos por categoria, e os
// relatórios anual/IR em HTML pronto para impressão (o navegador vira
// PDF nativamente via "Salvar como PDF" na janela de impressão — mais
// confiável num PWA do que gerar binário de PDF no servidor).

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

Deno.serve(async (req: Request) => {
  const authHeader = req.headers.get('Authorization') ?? '';
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response(JSON.stringify({ error: 'Não autenticado' }), { status: 401 });

  const { data: appUser } = await supabase.from('app_user').select('id').eq('auth_user_id', user.id).single();
  if (!appUser) return new Response(JSON.stringify({ error: 'Perfil não encontrado' }), { status: 404 });
  const userId = appUser.id;

  const url = new URL(req.url);
  const action = url.searchParams.get('action');

  try {
    if (action === 'cash-flow') {
      const months = Number(url.searchParams.get('months') ?? '6');
      const result = [];
      const now = new Date();
      for (let i = months - 1; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const start = d.toISOString();
        const end = new Date(d.getFullYear(), d.getMonth() + 1, 1).toISOString();
        const monthRef = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

        const { data: txs } = await supabase
          .from('transaction')
          .select('type, amount_cents')
          .eq('user_id', userId)
          .is('cancelled_at', null)
          .gte('occurred_at', start)
          .lt('occurred_at', end);

        const income = (txs ?? []).filter((t) => t.type === 'INCOME').reduce((s, t) => s + BigInt(t.amount_cents), 0n);
        const expense = (txs ?? []).filter((t) => t.type === 'EXPENSE').reduce((s, t) => s + BigInt(t.amount_cents), 0n);

        result.push({
          monthRef,
          incomeCents: income.toString(),
          expenseCents: expense.toString(),
          netCents: (income - expense).toString(),
        });
      }
      return json(result);
    }

    if (action === 'net-worth') {
      const { data: accounts } = await supabase.from('account').select('balance_cents').eq('user_id', userId);
      const { data: investments } = await supabase
        .from('investment')
        .select('amount_cents')
        .eq('user_id', userId)
        .is('cancelled_at', null);
      const { data: installments } = await supabase
        .from('loan_installment')
        .select('principal_cents, loan:loan_id(user_id, cancelled_at)')
        .eq('status', 'PENDING');

      const totalAccountBalanceCents = (accounts ?? []).reduce((s, a) => s + BigInt(a.balance_cents), 0n);
      const totalInvestmentsCents = (investments ?? []).reduce((s, i) => s + BigInt(i.amount_cents), 0n);
      const totalOutstandingLoanBalanceCents = (installments ?? [])
        .filter((i: any) => i.loan?.user_id === userId && !i.loan?.cancelled_at)
        .reduce((s, i) => s + BigInt(i.principal_cents), 0n);

      const netWorthCents = totalAccountBalanceCents + totalInvestmentsCents - totalOutstandingLoanBalanceCents;

      return json({
        totalAccountBalanceCents: totalAccountBalanceCents.toString(),
        totalInvestmentsCents: totalInvestmentsCents.toString(),
        totalOutstandingLoanBalanceCents: totalOutstandingLoanBalanceCents.toString(),
        netWorthCents: netWorthCents.toString(),
      });
    }

    if (action === 'category-breakdown') {
      const year = Number(url.searchParams.get('year'));
      const type = url.searchParams.get('type') ?? 'EXPENSE';
      const start = new Date(year, 0, 1).toISOString();
      const end = new Date(year + 1, 0, 1).toISOString();

      const { data: txs } = await supabase
        .from('transaction')
        .select('amount_cents, category:category_id(id, name)')
        .eq('user_id', userId)
        .eq('type', type)
        .is('cancelled_at', null)
        .gte('occurred_at', start)
        .lt('occurred_at', end);

      const byCategory = new Map<string, { name: string; total: bigint }>();
      for (const t of txs ?? []) {
        const cat = t.category as any;
        if (!cat) continue;
        const entry = byCategory.get(cat.id) ?? { name: cat.name, total: 0n };
        entry.total += BigInt(t.amount_cents);
        byCategory.set(cat.id, entry);
      }

      const result = [...byCategory.entries()]
        .map(([categoryId, v]) => ({ categoryId, categoryName: v.name, totalCents: v.total.toString() }))
        .sort((a, b) => (BigInt(b.totalCents) > BigInt(a.totalCents) ? 1 : -1));

      return json(result);
    }

    if (action === 'annual-report-html' || action === 'ir-report-html') {
      const year = Number(url.searchParams.get('year'));
      const isIr = action === 'ir-report-html';
      const start = new Date(year, 0, 1).toISOString();
      const end = new Date(year + 1, 0, 1).toISOString();

      const { data: txs } = await supabase
        .from('transaction')
        .select('type, amount_cents, occurred_at, merchant_name, category:category_id(name)')
        .eq('user_id', userId)
        .is('cancelled_at', null)
        .gte('occurred_at', start)
        .lt('occurred_at', end)
        .order('occurred_at', { ascending: true });

      const { data: investments } = await supabase
        .from('investment')
        .select('description, institution, type, amount_cents, invested_at')
        .eq('user_id', userId)
        .is('cancelled_at', null);

      const income = (txs ?? []).filter((t) => t.type === 'INCOME').reduce((s, t) => s + BigInt(t.amount_cents), 0n);
      const expense = (txs ?? []).filter((t) => t.type === 'EXPENSE').reduce((s, t) => s + BigInt(t.amount_cents), 0n);

      const rowsHtml = (txs ?? [])
        .map(
          (t) => `<tr>
            <td>${new Date(t.occurred_at).toLocaleDateString('pt-BR')}</td>
            <td>${t.merchant_name ?? '-'}</td>
            <td>${(t.category as any)?.name ?? '-'}</td>
            <td style="text-align:right; color:${t.type === 'INCOME' ? '#178a4c' : '#b3261e'}">
              ${t.type === 'INCOME' ? '+' : '-'}${formatBRL(BigInt(t.amount_cents))}
            </td>
          </tr>`,
        )
        .join('');

      const investmentsHtml = isIr
        ? `<h2>Investimentos (posição em ${year})</h2>
           <table><thead><tr><th>Descrição</th><th>Instituição</th><th>Tipo</th><th>Valor investido</th></tr></thead><tbody>
           ${(investments ?? [])
             .map(
               (i) =>
                 `<tr><td>${i.description}</td><td>${i.institution}</td><td>${i.type}</td><td style="text-align:right">${formatBRL(BigInt(i.amount_cents))}</td></tr>`,
             )
             .join('')}
           </tbody></table>`
        : '';

      const html = `<!DOCTYPE html><html><head><meta charset="utf-8" />
        <title>${isIr ? 'Apoio à declaração de IR' : 'Relatório anual'} ${year}</title>
        <style>
          body { font-family: -apple-system, Arial, sans-serif; color: #111; padding: 24px; }
          h1 { font-size: 20px; } h2 { font-size: 15px; margin-top: 28px; }
          table { width: 100%; border-collapse: collapse; margin-top: 8px; }
          th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #ddd; font-size: 12px; }
          .summary { display: flex; gap: 24px; margin: 16px 0; }
          .summary div { font-size: 13px; }
          .note { font-size: 11px; color: #666; margin-top: 24px; }
          @media print { body { padding: 0; } }
        </style>
        </head><body>
        <h1>${isIr ? 'Apoio à declaração de Imposto de Renda' : 'Relatório anual'} — ${year}</h1>
        <div class="summary">
          <div>Total de entradas: <b style="color:#178a4c">${formatBRL(income)}</b></div>
          <div>Total de saídas: <b style="color:#b3261e">${formatBRL(expense)}</b></div>
        </div>
        ${investmentsHtml}
        <h2>Movimentações do ano</h2>
        <table><thead><tr><th>Data</th><th>Estabelecimento</th><th>Categoria</th><th>Valor</th></tr></thead>
        <tbody>${rowsHtml}</tbody></table>
        ${isIr ? '<p class="note">Este relatório organiza os valores para preenchimento manual da declaração — não substitui orientação contábil nem os informes de rendimento oficiais dos bancos/corretoras.</p>' : ''}
        <script>window.onload = () => window.print();</script>
        </body></html>`;

      return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }

    return json({ error: `Ação desconhecida: ${action}` }, 400);
  } catch (err) {
    return json({ error: (err as Error).message }, 400);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
