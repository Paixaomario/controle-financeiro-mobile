import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Landmark } from 'lucide-react';
import { api } from '../../lib/api';
import { formatCentsToBRL } from '../../lib/money';

interface Loan {
  id: string;
  description: string;
  institution: string | null;
  installmentsTotal: number;
  installments: Array<{ status: string }>;
  cancelledAt: string | null;
}

export default function FinanciamentosList() {
  const [loans, setLoans] = useState<Loan[]>([]);
  const [loading, setLoading] = useState(true);

  function load() {
    api
      .get<Loan[]>('/loans')
      .then(setLoans)
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function handleCancel(id: string, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm('Cancelar este financiamento inteiro? As parcelas já pagas ficam no histórico, as pendentes são canceladas.')) return;
    await api.post(`/loans/${id}/cancel`);
    load();
  }

  return (
    <div className="p-4 pb-24 max-w-md mx-auto">
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-lg font-medium flex items-center gap-2">
          <Landmark size={19} strokeWidth={1.75} className="text-text-secondary" />
          Financiamentos
        </h1>
        <Link to="/financiamentos/novo" className="text-income-green text-xl">
          +
        </Link>
      </div>

      {loading && <div className="text-text-secondary text-sm">Carregando...</div>}
      {!loading && loans.length === 0 && (
        <div className="text-text-muted text-sm py-6 text-center">
          Nenhum financiamento cadastrado. Toque em "+" para começar.
        </div>
      )}

      <div className="flex flex-col gap-2.5">
        {loans.map((loan) => {
          const paid = loan.installments.filter((i) => i.status === 'PAID').length;
          return (
            <Link
              key={loan.id}
              to={`/financiamentos/${loan.id}`}
              className={`bg-bg-card border border-border-default rounded-xl p-3.5 flex justify-between items-center ${
                loan.cancelledAt ? 'opacity-40' : ''
              }`}
            >
              <div>
                <div className="text-[13.5px] text-text-primary">
                  {loan.description} {loan.cancelledAt && <span className="text-text-muted">(cancelado)</span>}
                </div>
                <div className="text-[11px] text-text-muted mt-0.5">
                  {loan.institution} · {paid}/{loan.installmentsTotal} parcelas pagas
                </div>
              </div>
              {!loan.cancelledAt && (
                <button
                  onClick={(e) => handleCancel(loan.id, e)}
                  title="Cancelar financiamento"
                  className="text-text-muted hover:text-expense-red text-xs px-1"
                >
                  ✕
                </button>
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
