import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { formatCentsToBRL, brlInputToCentsString } from '../../lib/money';

interface InstallmentView {
  id: string;
  number: number;
  dueDate: string;
  status: 'PENDING' | 'PAID' | 'OVERDUE';
  amountCents: string;
  paidAmountCents: string | null;
  discountCents: string;
  isManuallyAdjusted: boolean;
  originalCalculatedCents: string | null;
  paymentMethod: string | null;
  bankUsed: string | null;
}

interface Statement {
  description: string;
  installmentsPaid: number;
  installmentsTotal: number;
  totalPaidCents: string;
  totalInterestPaidCents: string;
  totalDiscountCents: string;
  remainingBalanceCents: string;
  installments: InstallmentView[];
}

export default function Demonstrativo() {
  const { id } = useParams<{ id: string }>();
  const [statement, setStatement] = useState<Statement | null>(null);
  const [showAmortize, setShowAmortize] = useState(false);
  const [installmentInput, setInstallmentInput] = useState('');
  const [adjustingId, setAdjustingId] = useState<number | null>(null);
  const [adjustValue, setAdjustValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function load() {
    if (!id) return;
    api.get<Statement>(`/loans/${id}/statement`).then(setStatement);
  }

  useEffect(load, [id]);

  async function handleAmortize() {
    if (!id || !installmentInput.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/loans/${id}/amortize`, {
        installmentNumbersInput: installmentInput,
        paidAt: new Date().toISOString(),
      });
      setShowAmortize(false);
      setInstallmentInput('');
      load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleAdjust(installmentId: string) {
    if (!adjustValue.trim()) return;
    setBusy(true);
    try {
      await api.patch(`/loans/installments/${installmentId}/adjust`, {
        paidAmountCents: brlInputToCentsString(adjustValue),
        adjustmentNote: 'Ajustado manualmente pelo usuário',
      });
      setAdjustingId(null);
      setAdjustValue('');
      load();
    } finally {
      setBusy(false);
    }
  }

  async function handleCancelPayment(installmentId: string) {
    if (!confirm('Estornar o pagamento desta parcela? Ela volta a ficar pendente.')) return;
    setBusy(true);
    try {
      await api.post(`/loans/installments/${installmentId}/cancel-payment`);
      load();
    } finally {
      setBusy(false);
    }
  }

  async function handleCancelLoan() {
    if (!id) return;
    if (!confirm('Cancelar este financiamento inteiro? As parcelas pendentes serão canceladas — as já pagas ficam no histórico.')) return;
    setBusy(true);
    try {
      await api.post(`/loans/${id}/cancel`);
      load();
    } finally {
      setBusy(false);
    }
  }

  if (!statement) return <div className="p-4 text-text-secondary text-sm">Carregando...</div>;

  const progress = Math.round((statement.installmentsPaid / statement.installmentsTotal) * 100);

  return (
    <div className="p-4 pb-24 max-w-md mx-auto">
      <div className="flex justify-between items-start mb-1">
        <h1 className="text-lg font-medium">{statement.description}</h1>
        <button onClick={handleCancelLoan} className="text-[10.5px] text-text-muted hover:text-expense-red">
          cancelar financiamento
        </button>
      </div>
      <p className="text-[11px] text-text-muted mb-4">
        {statement.installmentsPaid}/{statement.installmentsTotal} parcelas pagas
      </p>

      <div className="bg-bg-card border border-border-default rounded-2xl p-3.5 mb-3">
        <div className="text-[10.5px] text-text-secondary">Saldo devedor restante</div>
        <div className="text-[19px] font-medium text-text-primary mt-0.5">
          {formatCentsToBRL(statement.remainingBalanceCents)}
        </div>
        <div className="h-1.5 bg-border-default rounded-full mt-2.5 overflow-hidden">
          <div className="h-full bg-income-green" style={{ width: `${progress}%` }} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 mb-4">
        <MiniStat label="Total pago" value={formatCentsToBRL(statement.totalPaidCents)} />
        <MiniStat label="Juros pagos" value={formatCentsToBRL(statement.totalInterestPaidCents)} tone="expense" />
        <MiniStat label="Desconto obtido" value={formatCentsToBRL(statement.totalDiscountCents)} tone="income" />
        <MiniStat
          label="Parcelas restantes"
          value={String(statement.installmentsTotal - statement.installmentsPaid)}
        />
      </div>

      <button
        onClick={() => setShowAmortize((v) => !v)}
        className="w-full border border-income-green text-income-green text-center text-sm font-medium py-2.5 rounded-xl mb-4"
      >
        Amortizar parcelas
      </button>

      {showAmortize && (
        <div className="bg-bg-card border border-border-default rounded-xl p-3.5 mb-4">
          <div className="text-[10.5px] text-text-secondary mb-1">Números das parcelas</div>
          <input
            value={installmentInput}
            onChange={(e) => setInstallmentInput(e.target.value)}
            placeholder="Ex: 15-20 ou 15,16,18"
            className="w-full bg-bg-base border border-border-default rounded-lg px-3 py-2.5 text-sm mb-3 outline-none focus:border-income-green"
          />
          {error && <div className="text-expense-red text-xs mb-2">{error}</div>}
          <button
            onClick={handleAmortize}
            disabled={busy}
            className="w-full bg-income-green text-bg-base text-center text-sm font-medium py-2.5 rounded-lg disabled:opacity-50"
          >
            {busy ? 'Calculando...' : 'Confirmar amortização'}
          </button>
        </div>
      )}

      <div className="text-[11px] text-text-secondary mb-2">Previsto x pago por parcela</div>
      <div className="flex flex-col gap-1">
        {statement.installments.map((inst) => (
          <div key={inst.number} className="bg-bg-card px-3 py-2.5 rounded-lg">
            <div className="flex justify-between items-center">
              <span className="text-[11.5px] text-text-primary">
                Parcela {inst.number}
                {inst.status === 'PENDING' && <span className="text-text-muted"> · pendente</span>}
                {inst.isManuallyAdjusted && <span className="text-warning-amber"> · ajustada</span>}
              </span>
              <span className="text-right">
                {inst.paidAmountCents && inst.paidAmountCents !== inst.amountCents ? (
                  <>
                    <span className="text-[9.5px] text-text-muted line-through mr-1">
                      {formatCentsToBRL(inst.amountCents)}
                    </span>
                    <span className="text-[11.5px] text-income-green-alt">
                      {formatCentsToBRL(inst.paidAmountCents)}
                    </span>
                  </>
                ) : (
                  <span className="text-[11.5px] text-text-primary">{formatCentsToBRL(inst.amountCents)}</span>
                )}
              </span>
            </div>
            {inst.status === 'PAID' && adjustingId !== inst.number && (
              <div className="flex gap-3 mt-1">
                <button
                  onClick={() => {
                    setAdjustingId(inst.number);
                    setAdjustValue('');
                  }}
                  className="text-[10px] text-text-muted"
                >
                  ajustar valor pago
                </button>
                <button
                  onClick={() => handleCancelPayment(inst.id)}
                  className="text-[10px] text-text-muted hover:text-expense-red"
                >
                  estornar pagamento
                </button>
              </div>
            )}
            {adjustingId === inst.number && (
              <div className="flex gap-1.5 mt-2">
                <input
                  value={adjustValue}
                  onChange={(e) => setAdjustValue(e.target.value)}
                  placeholder="Valor real pago (R$)"
                  className="flex-1 bg-bg-base border border-border-default rounded-lg px-2.5 py-1.5 text-xs outline-none focus:border-income-green"
                />
                <button
                  onClick={() => handleAdjust(inst.id)}
                  className="bg-income-green text-bg-base text-xs px-3 rounded-lg"
                >
                  Salvar
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function MiniStat({ label, value, tone }: { label: string; value: string; tone?: 'income' | 'expense' }) {
  const color =
    tone === 'income' ? 'text-income-green-alt' : tone === 'expense' ? 'text-expense-red' : 'text-text-primary';
  return (
    <div className="bg-bg-card border border-border-default rounded-xl px-3 py-2.5">
      <div className="text-[10px] text-text-secondary">{label}</div>
      <div className={`text-[14px] font-medium mt-1 ${color}`}>{value}</div>
    </div>
  );
}
