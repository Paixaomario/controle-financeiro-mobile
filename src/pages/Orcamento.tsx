import { useEffect, useState } from 'react';
import { PiggyBank, Plus, X } from 'lucide-react';
import { api } from '../lib/api';
import { formatCentsToBRL } from '../lib/money';
import { ProgressBar } from '../components/ProgressBar';
import { MoneyInput } from '../components/MoneyInput';

interface BudgetItem {
  categoryId: string;
  categoryName: string;
  limitCents: string;
  spentCents: string;
  percentageUsed: number;
}

interface Category {
  id: string;
  name: string;
  kind: 'INCOME' | 'EXPENSE';
}

function currentMonthRef(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export default function Orcamento() {
  const [items, setItems] = useState<BudgetItem[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [newCategoryId, setNewCategoryId] = useState('');
  const [newLimitCents, setNewLimitCents] = useState('0');
  const [saving, setSaving] = useState(false);

  function load() {
    api
      .get<BudgetItem[]>(`/budgets?month=${currentMonthRef()}`)
      .then(setItems)
      .finally(() => setLoading(false));
    api.get<Category[]>('/categories').then(setCategories);
  }

  useEffect(load, []);

  const categoriesWithoutBudget = categories.filter(
    (c) => c.kind === 'EXPENSE' && !items.some((i) => i.categoryId === c.id),
  );

  async function handleSaveBudget() {
    if (!newCategoryId || newLimitCents === '0') return;
    setSaving(true);
    try {
      await api.post('/budgets', { categoryId: newCategoryId, monthRef: currentMonthRef(), limitCents: newLimitCents });
      setShowForm(false);
      setNewCategoryId('');
      setNewLimitCents('0');
      load();
    } finally {
      setSaving(false);
    }
  }

  const totalLimit = items.reduce((s, i) => s + BigInt(i.limitCents), 0n);
  const totalSpent = items.reduce((s, i) => s + BigInt(i.spentCents), 0n);
  const totalPercentage = totalLimit > 0n ? Number((totalSpent * 10000n) / totalLimit) / 100 : 0;

  return (
    <div className="p-4 pb-24 max-w-md mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-medium flex items-center gap-2">
          <PiggyBank size={19} strokeWidth={1.75} className="text-text-secondary" />
          Orçamento
        </h1>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="w-8 h-8 rounded-lg bg-income-green/15 text-income-green flex items-center justify-center"
        >
          {showForm ? <X size={16} strokeWidth={2} /> : <Plus size={16} strokeWidth={2} />}
        </button>
      </div>

      {showForm && (
        <div className="bg-bg-card border border-border-default rounded-xl p-3.5 mb-4 flex flex-col gap-2.5">
          <select
            value={newCategoryId}
            onChange={(e) => setNewCategoryId(e.target.value)}
            className="bg-bg-base border border-border-default rounded-lg px-3 py-2.5 text-sm outline-none focus:border-income-green"
          >
            <option value="">Escolha a categoria...</option>
            {categoriesWithoutBudget.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <MoneyInput valueCents={newLimitCents} onChange={setNewLimitCents} placeholder="Limite do mês" />
          <button
            onClick={handleSaveBudget}
            disabled={saving || !newCategoryId || newLimitCents === '0'}
            className="bg-income-green text-bg-base text-center text-sm font-medium py-2.5 rounded-lg disabled:opacity-50"
          >
            {saving ? 'Salvando...' : 'Definir orçamento'}
          </button>
        </div>
      )}

      {loading && <div className="text-text-secondary text-sm">Carregando...</div>}

      {!loading && items.length > 0 && (
        <div className="bg-bg-card border border-border-default rounded-2xl p-3.5 mb-4">
          <div className="text-[11px] text-text-secondary">Total planejado x gasto</div>
          <div className="flex items-baseline gap-1.5 mt-1">
            <span className="text-xl font-medium text-text-primary">{formatCentsToBRL(totalSpent.toString())}</span>
            <span className="text-xs text-text-muted">de {formatCentsToBRL(totalLimit.toString())}</span>
          </div>
          <div className="mt-2.5">
            <ProgressBar percentage={totalPercentage} />
          </div>
        </div>
      )}

      {!loading && items.length === 0 && (
        <div className="text-text-muted text-sm py-6 text-center">Nenhum orçamento definido para este mês.</div>
      )}

      <div className="flex flex-col gap-2.5">
        {items.map((item) => (
          <div key={item.categoryId} className="bg-bg-card border border-border-default rounded-xl p-3">
            <div className="flex justify-between items-center">
              <span className="text-[12.5px] text-text-primary">{item.categoryName}</span>
              <span className="text-[11.5px] text-text-secondary">
                {formatCentsToBRL(item.spentCents)} / {formatCentsToBRL(item.limitCents)}
              </span>
            </div>
            <div className="mt-2">
              <ProgressBar percentage={item.percentageUsed} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
