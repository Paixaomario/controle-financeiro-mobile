import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { MoneyInput } from '../../components/MoneyInput';

const LOAN_TYPES = [
  { value: 'VEHICLE', label: 'Veículo' },
  { value: 'MORTGAGE', label: 'Imóvel' },
  { value: 'PERSONAL', label: 'Empréstimo pessoal' },
  { value: 'STORE_INSTALLMENT', label: 'Carnê de loja' },
  { value: 'CREDIT_CARD_INVOICE', label: 'Fatura parcelada' },
  { value: 'OTHER', label: 'Outro' },
];

export default function NovoFinanciamento() {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    description: '',
    institution: '',
    type: 'VEHICLE',
    amortizationMethod: 'PRICE' as 'PRICE' | 'SAC',
    totalAmountCents: '0',
    installmentsTotal: '',
    monthlyInterestRate: '',
    dueDay: '15',
    firstDueDate: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    setSaving(true);
    setError(null);
    try {
      const totalAmountCents = form.totalAmountCents;
      const installmentsTotal = parseInt(form.installmentsTotal, 10);
      const rate = parseFloat(form.monthlyInterestRate.replace(',', '.')) / 100;

      await api.post('/loans', {
        description: form.description,
        institution: form.institution,
        type: form.type,
        amortizationMethod: form.amortizationMethod,
        totalAmountCents,
        installmentsTotal,
        installmentCents: (BigInt(totalAmountCents) / BigInt(installmentsTotal)).toString(),
        dueDay: parseInt(form.dueDay, 10),
        firstDueDate: new Date(form.firstDueDate).toISOString(),
        monthlyInterestRate: isNaN(rate) ? null : rate,
      });
      navigate('/financiamentos');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-4 pb-24 max-w-md mx-auto">
      <h1 className="text-lg font-medium mb-4">Novo financiamento</h1>

      <div className="flex flex-col gap-3">
        <Field label="Descrição">
          <TextInput value={form.description} onChange={(v) => setForm({ ...form, description: v })} />
        </Field>

        <div className="grid grid-cols-2 gap-2">
          <Field label="Instituição">
            <TextInput value={form.institution} onChange={(v) => setForm({ ...form, institution: v })} />
          </Field>
          <Field label="Tipo">
            <select
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value })}
              className="w-full bg-bg-card border border-border-default rounded-lg px-3 py-2.5 text-sm outline-none focus:border-income-green"
            >
              {LOAN_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="Método de amortização">
          <div className="flex gap-2">
            {(['PRICE', 'SAC'] as const).map((method) => (
              <button
                key={method}
                onClick={() => setForm({ ...form, amortizationMethod: method })}
                className={`flex-1 rounded-lg py-2.5 text-center border ${
                  form.amortizationMethod === method
                    ? 'bg-[#173404] border-income-green text-income-green'
                    : 'bg-bg-card border-border-default text-text-secondary'
                }`}
              >
                <div className="text-xs font-medium">{method}</div>
                <div className="text-[9.5px] mt-0.5">{method === 'PRICE' ? 'Parcela fixa' : 'Decrescente'}</div>
              </button>
            ))}
          </div>
        </Field>

        <div className="grid grid-cols-2 gap-2">
          <Field label="Valor total (R$)">
            <MoneyInput valueCents={form.totalAmountCents} onChange={(v) => setForm({ ...form, totalAmountCents: v })} />
          </Field>
          <Field label="Qtd. de parcelas">
            <TextInput
              value={form.installmentsTotal}
              onChange={(v) => setForm({ ...form, installmentsTotal: v })}
              placeholder="48"
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Field label="Taxa de juros a.m. (%)">
            <TextInput
              value={form.monthlyInterestRate}
              onChange={(v) => setForm({ ...form, monthlyInterestRate: v })}
              placeholder="1,35"
            />
          </Field>
          <Field label="Dia de vencimento">
            <TextInput value={form.dueDay} onChange={(v) => setForm({ ...form, dueDay: v })} placeholder="15" />
          </Field>
        </div>

        <Field label="Data da primeira parcela">
          <input
            type="date"
            value={form.firstDueDate}
            onChange={(e) => setForm({ ...form, firstDueDate: e.target.value })}
            className="w-full bg-bg-card border border-border-default rounded-lg px-3 py-2.5 text-sm outline-none focus:border-income-green"
          />
        </Field>

        {error && <div className="text-expense-red text-xs">{error}</div>}

        <button
          onClick={handleSubmit}
          disabled={saving}
          className="bg-income-green text-bg-base text-center text-sm font-medium py-3 rounded-xl disabled:opacity-50"
        >
          {saving ? 'Salvando...' : 'Confirmar financiamento'}
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10.5px] text-text-secondary mb-1">{label}</div>
      {children}
    </div>
  );
}

function TextInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <input
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className="w-full bg-bg-card border border-border-default rounded-lg px-3 py-2.5 text-sm outline-none focus:border-income-green"
    />
  );
}
