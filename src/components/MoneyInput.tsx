import { formatCentsToBRL } from '../lib/money';

interface MoneyInputProps {
  valueCents: string;
  onChange: (centsString: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}

/**
 * Campo de valor monetário no padrão "centavos primeiro" (mesmo padrão
 * Nubank/Uber): o usuário digita os dígitos da direita para a esquerda,
 * sem precisar acertar vírgula/ponto manualmente — elimina qualquer
 * ambiguidade de formato e sempre resulta em um valor exato em centavos,
 * nunca passando por ponto flutuante.
 *
 * Ex: digitar "1", "2", "3", "4" mostra R$ 0,01 → R$ 0,12 → R$ 1,23 → R$ 12,34.
 */
export function MoneyInput({ valueCents, onChange, placeholder, autoFocus }: MoneyInputProps) {
  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const digitsOnly = e.target.value.replace(/\D/g, '');
    const withoutLeadingZeros = digitsOnly.replace(/^0+(?=\d)/, '');
    onChange(withoutLeadingZeros === '' ? '0' : withoutLeadingZeros);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    // Backspace apaga um dígito de centavo por vez, em vez de mexer no cursor
    if (e.key === 'Backspace') {
      e.preventDefault();
      const next = valueCents.slice(0, -1);
      onChange(next === '' ? '0' : next);
    }
  }

  return (
    <input
      type="text"
      inputMode="numeric"
      autoFocus={autoFocus}
      value={formatCentsToBRL(valueCents)}
      onChange={handleChange}
      onKeyDown={handleKeyDown}
      placeholder={placeholder}
      className="w-full bg-bg-card border border-border-default rounded-lg px-3 py-2.5 text-lg font-medium text-text-primary outline-none focus:border-income-green tabular-nums"
    />
  );
}
