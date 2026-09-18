import { useEffect, useState } from 'react';
import { CreditCard as CreditCardIcon } from 'lucide-react';
import { api } from '../lib/api';
import { formatCentsToBRL } from '../lib/money';
import { ProgressBar } from '../components/ProgressBar';

interface CreditCard {
  id: string;
  name: string;
  institution: string | null;
  limitCents: string;
  dueDay: number;
}

interface Invoice {
  totalCents: string;
  limitCents: string;
  usedPercentage: number;
}

export default function Cartoes() {
  const [cards, setCards] = useState<CreditCard[]>([]);
  const [invoices, setInvoices] = useState<Record<string, Invoice>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get<CreditCard[]>('/credit-cards')
      .then(async (list) => {
        setCards(list);
        const results = await Promise.all(
          list.map((c) => api.get<Invoice>(`/credit-cards/${c.id}/invoice`).then((inv) => [c.id, inv] as const)),
        );
        setInvoices(Object.fromEntries(results));
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="p-4 pb-24 max-w-md mx-auto">
      <h1 className="text-lg font-medium mb-4 flex items-center gap-2">
        <CreditCardIcon size={19} strokeWidth={1.75} className="text-text-secondary" />
        Cartões
      </h1>

      {loading && <div className="text-text-secondary text-sm">Carregando...</div>}
      {!loading && cards.length === 0 && (
        <div className="text-text-muted text-sm py-6 text-center">Nenhum cartão cadastrado ainda.</div>
      )}

      <div className="flex flex-col gap-3">
        {cards.map((card) => {
          const invoice = invoices[card.id];
          const isHigh = (invoice?.usedPercentage ?? 0) >= 85;
          return (
            <div
              key={card.id}
              className="rounded-2xl p-4 border border-border-default"
              style={{
                background: isHigh
                  ? 'linear-gradient(100deg, #2A1B1E, #12151A)'
                  : 'linear-gradient(100deg, #1B2A22, #12151A)',
              }}
            >
              <div className="flex justify-between items-center">
                <CreditCardIcon size={20} strokeWidth={1.75} className={isHigh ? 'text-expense-red' : 'text-income-green'} />
                <span className="text-[10px] text-text-muted tracking-wider uppercase">
                  {card.institution || card.name}
                </span>
              </div>
              <div className="text-sm text-[#C7CBD1] tracking-widest mt-4">{card.name}</div>
              <div className="flex justify-between items-end mt-4">
                <div>
                  <div className="text-[10px] text-text-muted">Fatura atual</div>
                  <div className="text-base text-text-primary font-medium">
                    {formatCentsToBRL(invoice?.totalCents ?? '0')}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] text-text-muted">Vence dia {card.dueDay}</div>
                  <div className={`text-[10px] ${isHigh ? 'text-warning-amber' : 'text-income-green'}`}>
                    {invoice?.usedPercentage ?? 0}% do limite
                  </div>
                </div>
              </div>
              <div className="mt-2">
                <ProgressBar percentage={invoice?.usedPercentage ?? 0} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
