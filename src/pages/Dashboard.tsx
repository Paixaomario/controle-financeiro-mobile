import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Sparkles, ChevronRight } from 'lucide-react';
import { api } from '../lib/api';
import { formatCentsToBRL } from '../lib/money';
import { MetricCard } from '../components/MetricCard';
import { TransactionRow } from '../components/TransactionRow';

interface Summary {
  totalBalanceCents: string;
  incomeCents: string;
  expenseCents: string;
}

interface RecentTransaction {
  id: string;
  type: 'INCOME' | 'EXPENSE';
  amountCents: string;
  merchantName: string | null;
  occurredAt: string;
  source: string;
  category: { name: string };
}

interface Insight {
  type: string;
  title: string;
  description: string;
}

function currentMonthRef(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export default function Dashboard() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [recent, setRecent] = useState<RecentTransaction[]>([]);
  const [insight, setInsight] = useState<Insight | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api.get<Summary>(`/dashboard/summary?month=${currentMonthRef()}`),
      api.get<RecentTransaction[]>('/dashboard/recent-transactions'),
    ])
      .then(([s, r]) => {
        setSummary(s);
        setRecent(r);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));

    // resumo do assistente é "melhor esforço" — se não tiver ainda, o
    // card de destaque simplesmente convida a gerar, sem quebrar a tela
    api
      .get<Insight[]>('/insights')
      .then((items) => setInsight(items.find((i) => i.type === 'MONTHLY_SUMMARY') ?? null))
      .catch(() => {});
  }, []);

  if (loading) return <div className="p-4 text-text-secondary text-sm">Carregando...</div>;
  if (error) return <div className="p-4 text-expense-red text-sm">Erro ao carregar: {error}</div>;

  return (
    <div className="p-4 pb-24 max-w-md mx-auto">
      <Link
        to="/assistente"
        className="flex items-center gap-2.5 bg-income-green/10 border border-income-green/30 rounded-xl p-3.5 mb-4"
      >
        <Sparkles size={18} strokeWidth={1.75} className="text-income-green shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-[11px] text-income-green font-medium">Assistente Financeiro</div>
          <div className="text-[12px] text-text-secondary truncate">
            {insight ? insight.description : 'Toque para ver a análise do seu mês'}
          </div>
        </div>
        <ChevronRight size={16} className="text-text-muted shrink-0" />
      </Link>

      <div className="mb-4">
        <div className="text-xs text-text-secondary">Saldo total</div>
        <div className="text-[28px] font-medium text-text-primary mt-0.5">
          {formatCentsToBRL(summary?.totalBalanceCents)}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 mb-5">
        <MetricCard label="Entradas" value={formatCentsToBRL(summary?.incomeCents)} tone="income" />
        <MetricCard label="Saídas" value={formatCentsToBRL(summary?.expenseCents)} tone="expense" />
      </div>

      <div className="text-xs text-text-secondary mb-2">Movimentações recentes</div>
      <div className="flex flex-col gap-1">
        {recent.length === 0 && (
          <div className="text-text-muted text-sm py-6 text-center">
            Nenhuma movimentação ainda. Toque em "+" para adicionar a primeira.
          </div>
        )}
        {recent.map((t) => (
          <TransactionRow
            key={t.id}
            description={t.merchantName || t.category.name}
            meta={new Date(t.occurredAt).toLocaleDateString('pt-BR')}
            amountCents={t.amountCents}
            type={t.type}
            fromSms={t.source === 'SMS' || t.source === 'NOTIFICATION'}
          />
        ))}
      </div>
    </div>
  );
}
