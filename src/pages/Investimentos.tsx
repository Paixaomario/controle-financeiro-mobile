import { useEffect, useState } from 'react';
import { TrendingUp } from 'lucide-react';
import { api } from '../lib/api';
import { formatCentsToBRL } from '../lib/money';
import { MoneyInput } from '../components/MoneyInput';

interface Investment {
  id: string;
  description: string;
  type: string;
  institution: string;
  amountCents: string;
  investedAt: string;
}

interface Summary {
  totalCents: string;
  byInstitution: Record<string, string>;
  byType: Record<string, string>;
}

const TYPE_LABELS: Record<string, string> = {
  SAVINGS: 'Poupança',
  CDB: 'CDB',
  STOCKS: 'Ações',
  FUNDS: 'Fundos',
  TREASURY: 'Tesouro',
  CRYPTO: 'Cripto',
  OTHER: 'Outro',
};

export default function Investimentos() {
  const [investments, setInvestments] = useState<Investment[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    description: '',
    type: 'CDB',
    institution: '',
    amountCents: '0',
  });

  function load() {
    api.get<Investment[]>('/investments').then(setInvestments);
    api.get<Summary>('/investments/summary').then(setSummary);
  }

  useEffect(load, []);

  async function handleSubmit() {
    if (!form.description || !form.institution || form.amountCents === '0') return;
    await api.post('/investments', {
      description: form.description,
      type: form.type,
      institution: form.institution,
      amountCents: form.amountCents,
      investedAt: new Date().toISOString(),
    });
    setForm({ description: '', type: 'CDB', institution: '', amountCents: '0' });
    setShowForm(false);
    load();
  }

  async function handleCancel(id: string) {
    if (!confirm('Estornar este investimento? Ele sai dos totais, mas fica registrado no histórico.')) return;
    await api.post(`/investments/${id}/cancel`);
    load();
  }

  return (
    <div className="p-4 pb-24 max-w-md mx-auto">
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-lg font-medium flex items-center gap-2">
          <TrendingUp size={19} strokeWidth={1.75} className="text-text-secondary" />
          Investimentos
        </h1>
        <button onClick={() => setShowForm((v) => !v)} className="text-income-green text-xl">
          +
        </button>
      </div>

      {summary && (
        <div className="bg-bg-card border border-border-default rounded-2xl p-3.5 mb-4">
          <div className="text-[11px] text-text-secondary">Total investido</div>
          <div className="text-xl font-medium text-text-primary mt-1">{formatCentsToBRL(summary.totalCents)}</div>
          <div className="mt-3 flex flex-col gap-1">
            {Object.entries(summary.byInstitution).map(([inst, cents]) => (
              <div key={inst} className="flex justify-between text-[11.5px]">
                <span className="text-text-secondary">{inst}</span>
                <span className="text-text-primary">{formatCentsToBRL(cents)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {showForm && (
        <div className="bg-bg-card border border-border-default rounded-xl p-3.5 mb-4 flex flex-col gap-2.5">
          <input
            placeholder="Descrição"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            className="bg-bg-base border border-border-default rounded-lg px-3 py-2 text-sm outline-none focus:border-income-green"
          />
          <select
            value={form.type}
            onChange={(e) => setForm({ ...form, type: e.target.value })}
            className="bg-bg-base border border-border-default rounded-lg px-3 py-2 text-sm outline-none focus:border-income-green"
          >
            {Object.entries(TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <input
            placeholder="Banco/corretora usado para investir"
            value={form.institution}
            onChange={(e) => setForm({ ...form, institution: e.target.value })}
            className="bg-bg-base border border-border-default rounded-lg px-3 py-2 text-sm outline-none focus:border-income-green"
          />
          <MoneyInput valueCents={form.amountCents} onChange={(v) => setForm({ ...form, amountCents: v })} />
          <button
            onClick={handleSubmit}
            className="bg-income-green text-bg-base text-center text-sm font-medium py-2.5 rounded-lg"
          >
            Salvar investimento
          </button>
        </div>
      )}

      <div className="flex flex-col gap-2">
        {investments.map((inv) => (
          <div key={inv.id} className="bg-bg-card border border-border-default rounded-xl p-3 flex justify-between items-center">
            <div>
              <div className="text-[13px] text-text-primary">{inv.description}</div>
              <div className="text-[10.5px] text-text-muted">
                {TYPE_LABELS[inv.type]} · {inv.institution}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="text-[13px] font-medium text-income-green-alt">{formatCentsToBRL(inv.amountCents)}</div>
              <button
                onClick={() => handleCancel(inv.id)}
                title="Estornar"
                className="text-text-muted hover:text-expense-red text-xs px-1"
              >
                ✕
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
