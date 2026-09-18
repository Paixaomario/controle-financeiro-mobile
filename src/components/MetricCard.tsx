interface MetricCardProps {
  label: string;
  value: string;
  tone?: 'default' | 'income' | 'expense' | 'warning';
}

const toneClasses: Record<NonNullable<MetricCardProps['tone']>, string> = {
  default: 'text-text-primary',
  income: 'text-income-green-alt',
  expense: 'text-expense-red',
  warning: 'text-warning-amber',
};

export function MetricCard({ label, value, tone = 'default' }: MetricCardProps) {
  return (
    <div className="bg-bg-card border border-border-default rounded-xl px-3 py-2.5">
      <div className="text-[11px] text-text-secondary">{label}</div>
      <div className={`text-[15px] font-medium mt-1 ${toneClasses[tone]}`}>{value}</div>
    </div>
  );
}
