interface ProgressBarProps {
  percentage: number; // 0-100+
}

export function ProgressBar({ percentage }: ProgressBarProps) {
  const clamped = Math.min(percentage, 100);
  const color = percentage >= 100 ? 'bg-warning-amber' : 'bg-income-green';

  return (
    <div className="h-1.5 bg-border-default rounded-full overflow-hidden">
      <div className={`h-full ${color}`} style={{ width: `${clamped}%` }} />
    </div>
  );
}
