/**
 * Regra de ouro do projeto (Fase 1): nenhum valor monetário passa por
 * `Number`/`parseFloat` em nenhum ponto do cálculo. Os valores chegam da
 * API como STRING de centavos (ex: "312400" = R$ 3.124,00) e são
 * formatados aqui só para exibição — a formatação nunca "volta" a virar
 * a fonte da verdade do valor.
 */

/** "312400" -> "R$ 3.124,00" */
export function formatCentsToBRL(cents: string | null | undefined): string {
  if (cents === null || cents === undefined) return 'R$ 0,00';

  const negative = cents.startsWith('-');
  const digits = negative ? cents.slice(1) : cents;
  const padded = digits.padStart(3, '0');
  const integerPart = padded.slice(0, -2);
  const decimalPart = padded.slice(-2);

  const withThousands = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${negative ? '-' : ''}R$ ${withThousands},${decimalPart}`;
}

/**
 * "1.234,56" ou "1234.56" -> "123456" (string de centavos, exata).
 * Nunca usa parseFloat — faz a conversão por manipulação de string,
 * preservando exatamente o que o usuário digitou.
 */
export function brlInputToCentsString(input: string): string {
  const trimmed = input.trim().replace(/\./g, '').replace(',', '.');
  const [integerPart = '0', decimalPart = ''] = trimmed.split('.');
  const cleanInteger = integerPart.replace(/\D/g, '') || '0';
  const cleanDecimal = decimalPart.replace(/\D/g, '').padEnd(2, '0').slice(0, 2);
  const cents = BigInt(cleanInteger) * 100n + BigInt(cleanDecimal || '0');
  return cents.toString();
}
