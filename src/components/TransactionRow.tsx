import { ArrowUpRight, ArrowDownRight, MessageSquareText, X } from 'lucide-react';
import { formatCentsToBRL } from '../lib/money';

interface TransactionRowProps {
  description: string;
  meta: string;
  amountCents: string;
  type: 'INCOME' | 'EXPENSE';
  fromSms?: boolean;
  cancelled?: boolean;
  onCancel?: () => void;
}

export function TransactionRow({ description, meta, amountCents, type, fromSms, cancelled, onCancel }: TransactionRowProps) {
  const isIncome = type === 'INCOME';
  return (
    <div className={`flex items-center gap-2.5 bg-bg-card px-3 py-2.5 rounded-lg ${cancelled ? 'opacity-40' : ''}`}>
      <div
        className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
          isIncome ? 'bg-[#173404] text-income-green' : 'bg-[#4A1B0C] text-expense-red'
        }`}
      >
        {isIncome ? (
          <ArrowUpRight size={16} strokeWidth={2} />
        ) : (
          <ArrowDownRight size={16} strokeWidth={2} />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] text-text-primary truncate">
          {description} {cancelled && <span className="text-text-muted">(estornada)</span>}
        </div>
        <div className="text-[10.5px] text-text-muted flex items-center gap-1">
          {fromSms && (
            <span title="capturado via SMS" className="inline-flex">
              <MessageSquareText size={11} strokeWidth={1.75} />
            </span>
          )}
          {meta}
        </div>
      </div>
      <div className={`text-[13px] font-medium ${isIncome ? 'text-income-green-alt' : 'text-expense-red'}`}>
        {isIncome ? '+' : '-'}
        {formatCentsToBRL(amountCents)}
      </div>
      {onCancel && !cancelled && (
        <button
          onClick={onCancel}
          title="Estornar"
          className="text-text-muted hover:text-expense-red p-1"
        >
          <X size={14} strokeWidth={2} />
        </button>
      )}
    </div>
  );
}
