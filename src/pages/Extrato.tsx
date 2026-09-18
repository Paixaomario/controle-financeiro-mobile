import { useEffect, useState } from 'react';
import { Receipt } from 'lucide-react';
import { api } from '../lib/api';
import { formatCentsToBRL } from '../lib/money';
import { TransactionRow } from '../components/TransactionRow';

interface Transaction {
  id: string;
  type: 'INCOME' | 'EXPENSE';
  amountCents: string;
  merchantName: string | null;
  occurredAt: string;
  source: string;
  cancelledAt: string | null;
}

function currentMonthRef(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export default function Extrato() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);

  function load() {
    api
      .get<Transaction[]>(`/transactions?month=${currentMonthRef()}`)
      .then(setTransactions)
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function handleCancel(id: string) {
    if (!confirm('Estornar esta movimentação? Ela fica registrada como cancelada, mas não é apagada.')) return;
    await api.post(`/transactions/${id}/cancel`);
    load();
  }

  const activeTransactions = transactions.filter((t) => !t.cancelledAt);
  const totalIncome = activeTransactions.filter((t) => t.type === 'INCOME').reduce((s, t) => s + BigInt(t.amountCents), 0n);
  const totalExpense = activeTransactions.filter((t) => t.type === 'EXPENSE').reduce((s, t) => s + BigInt(t.amountCents), 0n);

  const grouped = groupByDay(transactions);

  return (
    <div className="p-4 pb-24 max-w-md mx-auto">
      <h1 className="text-lg font-medium mb-4 flex items-center gap-2">
        <Receipt size={19} strokeWidth={1.75} className="text-text-secondary" />
        Extrato
      </h1>

      <div className="grid grid-cols-2 gap-2 mb-5">
        <div className="bg-bg-card border border-border-default rounded-xl px-3 py-2.5">
          <div className="text-[10.5px] text-text-secondary">Total entradas</div>
          <div className="text-[15px] font-medium text-income-green-alt mt-1">
            +{formatCentsToBRL(totalIncome.toString())}
          </div>
        </div>
        <div className="bg-bg-card border border-border-default rounded-xl px-3 py-2.5">
          <div className="text-[10.5px] text-text-secondary">Total saídas</div>
          <div className="text-[15px] font-medium text-expense-red mt-1">
            -{formatCentsToBRL(totalExpense.toString())}
          </div>
        </div>
      </div>

      {loading && <div className="text-text-secondary text-sm">Carregando...</div>}

      {Object.entries(grouped).map(([day, items]) => (
        <div key={day} className="mb-4">
          <div className="text-[11px] text-text-muted mb-1.5">{day}</div>
          <div className="flex flex-col gap-1">
            {items.map((t) => (
              <TransactionRow
                key={t.id}
                description={t.merchantName || 'Movimentação'}
                meta={new Date(t.occurredAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                amountCents={t.amountCents}
                type={t.type}
                fromSms={t.source === 'SMS' || t.source === 'NOTIFICATION'}
                cancelled={!!t.cancelledAt}
                onCancel={() => handleCancel(t.id)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function groupByDay(transactions: Transaction[]): Record<string, Transaction[]> {
  return transactions.reduce((acc, t) => {
    const day = new Date(t.occurredAt).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long' });
    (acc[day] ||= []).push(t);
    return acc;
  }, {} as Record<string, Transaction[]>);
}
