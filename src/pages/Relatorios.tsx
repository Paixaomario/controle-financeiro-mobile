import { useEffect, useState } from 'react';
import { FileText } from 'lucide-react';
import { api } from '../lib/api';
import { formatCentsToBRL } from '../lib/money';
import { supabase } from '../lib/supabase';

interface CashFlowMonth {
  monthRef: string;
  incomeCents: string;
  expenseCents: string;
  netCents: string;
}

interface NetWorth {
  totalAccountBalanceCents: string;
  totalInvestmentsCents: string;
  totalOutstandingLoanBalanceCents: string;
  netWorthCents: string;
}

interface CategoryItem {
  categoryId: string;
  categoryName: string;
  totalCents: string;
}

/**
 * Os relatórios abrem em uma nova aba já formatados para impressão — o
 * navegador oferece "Salvar como PDF" nativamente na janela de impressão,
 * o que é mais confiável dentro de um PWA do que gerar um binário de PDF
 * no servidor. O HTML já vem com auto-print (ver Edge Function `reports`).
 */
async function openReport(action: 'annual-report-html' | 'ir-report-html', year: number) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const supabaseUrl = (supabase as any).supabaseUrl as string;

  const response = await fetch(
    `${supabaseUrl}/functions/v1/reports?action=${action}&year=${year}`,
    { headers: token ? { Authorization: `Bearer ${token}` } : {} },
  );
  if (!response.ok) throw new Error(`Falha ao gerar relatório: ${response.status}`);

  const html = await response.text();
  const reportWindow = window.open('', '_blank');
  if (!reportWindow) throw new Error('O navegador bloqueou a abertura da nova aba — permita pop-ups para este site.');
  reportWindow.document.write(html);
  reportWindow.document.close();
}

export default function Relatorios() {
  const [cashFlow, setCashFlow] = useState<CashFlowMonth[]>([]);
  const [netWorth, setNetWorth] = useState<NetWorth | null>(null);
  const [expenseByCategory, setExpenseByCategory] = useState<CategoryItem[]>([]);
  const [year, setYear] = useState(new Date().getFullYear());
  const [downloading, setDownloading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<CashFlowMonth[]>('/reports/cash-flow?months=6').then(setCashFlow);
    api.get<NetWorth>('/reports/net-worth').then(setNetWorth);
  }, []);

  useEffect(() => {
    api
      .get<CategoryItem[]>(`/reports/category-breakdown?year=${year}&type=EXPENSE`)
      .then(setExpenseByCategory);
  }, [year]);

  async function handleDownload(kind: 'annual' | 'ir') {
    setDownloading(kind);
    setError(null);
    try {
      await openReport(kind === 'annual' ? 'annual-report-html' : 'ir-report-html', year);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setDownloading(null);
    }
  }

  const maxAbs = Math.max(
    1,
    ...cashFlow.flatMap((m) => [Number(BigInt(m.incomeCents)), Number(BigInt(m.expenseCents))]),
  );

  return (
    <div className="p-4 pb-24 max-w-md mx-auto">
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-lg font-medium flex items-center gap-2">
          <FileText size={19} strokeWidth={1.75} className="text-text-secondary" />
          Relatórios
        </h1>
        <select
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          className="bg-bg-card border border-border-default rounded-lg px-2 py-1 text-xs text-text-primary outline-none"
        >
          {[year, year - 1, year - 2].map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </div>

      {netWorth && (
        <div className="bg-bg-card border border-border-default rounded-2xl p-3.5 mb-4">
          <div className="text-[10.5px] text-text-secondary">Patrimônio líquido</div>
          <div className="text-xl font-medium text-text-primary mt-1">
            {formatCentsToBRL(netWorth.netWorthCents)}
          </div>
          <div className="grid grid-cols-3 gap-2 mt-3 text-[10px]">
            <div>
              <div className="text-text-secondary">Contas</div>
              <div className="text-income-green-alt">{formatCentsToBRL(netWorth.totalAccountBalanceCents)}</div>
            </div>
            <div>
              <div className="text-text-secondary">Investido</div>
              <div className="text-income-green-alt">{formatCentsToBRL(netWorth.totalInvestmentsCents)}</div>
            </div>
            <div>
              <div className="text-text-secondary">Devedor</div>
              <div className="text-expense-red">{formatCentsToBRL(netWorth.totalOutstandingLoanBalanceCents)}</div>
            </div>
          </div>
        </div>
      )}

      <div className="text-[11px] text-text-secondary mb-2">Fluxo de caixa (últimos 6 meses)</div>
      <div className="bg-bg-card border border-border-default rounded-2xl p-3.5 mb-4">
        <div className="flex items-end justify-between gap-1.5 h-28">
          {cashFlow.map((m) => {
            const incomeH = (Number(BigInt(m.incomeCents)) / maxAbs) * 100;
            const expenseH = (Number(BigInt(m.expenseCents)) / maxAbs) * 100;
            return (
              <div key={m.monthRef} className="flex-1 flex flex-col items-center gap-1">
                <div className="w-full flex items-end justify-center gap-0.5 h-24">
                  <div className="w-2.5 bg-income-green rounded-t" style={{ height: `${incomeH}%` }} />
                  <div className="w-2.5 bg-expense-red rounded-t" style={{ height: `${expenseH}%` }} />
                </div>
                <div className="text-[8.5px] text-text-muted">{m.monthRef.slice(5)}</div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="text-[11px] text-text-secondary mb-2">Gastos por categoria em {year}</div>
      <div className="flex flex-col gap-1 mb-5">
        {expenseByCategory.length === 0 && (
          <div className="text-text-muted text-xs py-2">Nenhum gasto registrado neste ano ainda.</div>
        )}
        {expenseByCategory.map((cat) => (
          <div key={cat.categoryId} className="bg-bg-card px-3 py-2 rounded-lg flex justify-between">
            <span className="text-[12px] text-text-primary">{cat.categoryName}</span>
            <span className="text-[12px] text-expense-red">{formatCentsToBRL(cat.totalCents)}</span>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-2.5">
        <button
          onClick={() => handleDownload('annual')}
          disabled={downloading !== null}
          className="w-full bg-bg-card border border-border-default text-text-primary text-sm font-medium py-3 rounded-xl disabled:opacity-50"
        >
          {downloading === 'annual' ? 'Gerando PDF...' : `Baixar relatório anual ${year} (PDF)`}
        </button>

        <button
          onClick={() => handleDownload('ir')}
          disabled={downloading !== null}
          className="w-full bg-income-green text-bg-base text-sm font-medium py-3 rounded-xl disabled:opacity-50"
        >
          {downloading === 'ir' ? 'Gerando PDF...' : `Baixar apoio à declaração de IR ${year} (PDF)`}
        </button>

        <p className="text-[10px] text-text-muted text-center px-2">
          O relatório de IR organiza os valores para preenchimento manual — não substitui orientação contábil
          nem os informes de rendimento oficiais.
        </p>

        {error && <div className="text-expense-red text-xs text-center">{error}</div>}
      </div>
    </div>
  );
}
