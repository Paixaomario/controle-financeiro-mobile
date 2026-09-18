import { useEffect, useState } from 'react';
import {
  Sparkles,
  RefreshCw,
  Repeat,
  Copy,
  TrendingUp as TrendingUpIcon,
  X,
} from 'lucide-react';
import { api } from '../lib/api';
import { formatCentsToBRL } from '../lib/money';

interface Insight {
  id: string;
  type: 'SUBSCRIPTION' | 'DUPLICATE' | 'CATEGORY_ANOMALY' | 'MONTHLY_SUMMARY' | 'TIP';
  title: string;
  description: string;
  amountCents: string | null;
  monthRef: string | null;
  createdAt: string;
}

const TYPE_ICON: Record<Insight['type'], typeof Repeat> = {
  SUBSCRIPTION: Repeat,
  DUPLICATE: Copy,
  CATEGORY_ANOMALY: TrendingUpIcon,
  MONTHLY_SUMMARY: Sparkles,
  TIP: Sparkles,
};

const TYPE_COLOR: Record<Insight['type'], string> = {
  SUBSCRIPTION: 'text-warning-amber',
  DUPLICATE: 'text-expense-red',
  CATEGORY_ANOMALY: 'text-expense-red',
  MONTHLY_SUMMARY: 'text-income-green',
  TIP: 'text-income-green',
};

/**
 * A tela do assistente financeiro — reúne o que os 4 agentes já
 * identificaram (assinaturas, duplicidades, gastos fora do padrão) e o
 * resumo do mês em linguagem natural, no espírito do Pierre: em vez de
 * o usuário caçar informação em gráfico, o app já entrega o que importa.
 */
export default function Assistente() {
  const [insights, setInsights] = useState<Insight[]>([]);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function load() {
    api
      .get<Insight[]>('/insights')
      .then(setInsights)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function handleAnalyze() {
    setAnalyzing(true);
    setError(null);
    try {
      await api.post('/financial-coach/run-all');
      load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleDismiss(id: string) {
    setInsights((prev) => prev.filter((i) => i.id !== id));
    try {
      await api.post(`/insights/${id}/dismiss`);
    } catch {
      load(); // se falhar no servidor, recarrega para não ficar com estado incorreto
    }
  }

  const summary = insights.find((i) => i.type === 'MONTHLY_SUMMARY');
  const alerts = insights.filter((i) => i.type !== 'MONTHLY_SUMMARY');

  if (loading) return <div className="p-4 text-text-secondary text-sm">Carregando...</div>;

  return (
    <div className="p-4 pb-24 max-w-md mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-medium flex items-center gap-2">
          <Sparkles size={19} strokeWidth={1.75} className="text-income-green" />
          Assistente Financeiro
        </h1>
        <button
          onClick={handleAnalyze}
          disabled={analyzing}
          className="w-8 h-8 rounded-lg bg-income-green/15 text-income-green flex items-center justify-center disabled:opacity-50"
          title="Atualizar análise"
        >
          <RefreshCw size={16} strokeWidth={2} className={analyzing ? 'animate-spin' : ''} />
        </button>
      </div>

      {error && <div className="text-expense-red text-xs mb-3">{error}</div>}

      {/* Resumo do mês, em linguagem natural */}
      {summary ? (
        <div className="bg-bg-card border border-border-default rounded-xl p-4 mb-4">
          <div className="text-[10.5px] text-text-secondary mb-1.5">{summary.title}</div>
          <div className="text-[13px] text-text-primary leading-relaxed">{summary.description}</div>
        </div>
      ) : (
        <div className="bg-bg-card border border-dashed border-border-default rounded-xl p-4 mb-4 text-center">
          <div className="text-[12.5px] text-text-secondary mb-3">
            Ainda não tenho uma análise deste mês. Toque em atualizar para eu olhar seus lançamentos.
          </div>
          <button
            onClick={handleAnalyze}
            disabled={analyzing}
            className="bg-income-green text-bg-base text-[13px] font-medium px-4 py-2 rounded-lg disabled:opacity-50"
          >
            {analyzing ? 'Analisando...' : 'Analisar agora'}
          </button>
        </div>
      )}

      {/* Alertas: assinaturas, duplicidades, gastos fora do padrão */}
      {alerts.length > 0 && (
        <>
          <div className="text-[11px] text-text-secondary mb-2 mt-5">Pontos de atenção</div>
          <div className="flex flex-col gap-2">
            {alerts.map((insight) => {
              const Icon = TYPE_ICON[insight.type];
              return (
                <div key={insight.id} className="bg-bg-card border border-border-default rounded-xl p-3.5">
                  <div className="flex items-start gap-2.5">
                    <div className={`mt-0.5 shrink-0 ${TYPE_COLOR[insight.type]}`}>
                      <Icon size={16} strokeWidth={1.75} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[12.5px] text-text-primary font-medium">{insight.title}</div>
                      <div className="text-[11.5px] text-text-secondary mt-0.5 leading-relaxed">
                        {insight.description}
                      </div>
                      {insight.amountCents && (
                        <div className={`text-[12px] font-medium mt-1.5 ${TYPE_COLOR[insight.type]}`}>
                          {formatCentsToBRL(insight.amountCents)}
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => handleDismiss(insight.id)}
                      className="text-text-muted shrink-0 p-0.5"
                      title="Dispensar"
                    >
                      <X size={14} strokeWidth={2} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {!summary && alerts.length === 0 && !analyzing && (
        <div className="text-[12px] text-text-muted text-center mt-6">
          Nenhum alerta por enquanto — bom sinal, ou ainda não há lançamentos suficientes para analisar.
        </div>
      )}
    </div>
  );
}
