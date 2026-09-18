// Edge Function: sms-parser
// Porta Deno do SmsParserService — mesmos templates (Nubank, Itaú, Inter,
// Bradesco, C6, Mercado Pago), mesma lógica de detecção de débito/crédito
// e financiamento.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';

type PaymentMethodGuess = 'DEBIT' | 'CREDIT' | 'PIX' | 'BOLETO' | 'OTHER';

interface BankTemplate {
  bankName: string;
  senderPatterns: RegExp[];
  purchasePattern: RegExp;
  pixPattern: RegExp;
  installmentPattern: RegExp;
}

const LOAN_KEYWORDS = [/financiamento/i, /empr[eé]stimo/i, /consignado/i, /crediário/i, /crediario/i];
const CITY_SUFFIX_PATTERN = /-\s*([A-ZÀ-Ú][a-zà-ú]+(?:\s[A-ZÀ-Ú][a-zà-ú]+)*)\s*$/;

const BANK_TEMPLATES: BankTemplate[] = [
  {
    bankName: 'Nubank',
    senderPatterns: [/nubank/i, /^nu\b/i],
    purchasePattern: /compra\s+aprovada.*?R\$\s?([\d.,]+)\s+em\s+([A-Za-zÀ-ú0-9 .&'-]+?)(?:,|\.|\s+parcela|$)/i,
    pixPattern: /pix\s+enviado.*?R\$\s?([\d.,]+)/i,
    installmentPattern: /parcela\s*(\d+)\s*\/\s*(\d+)/i,
  },
  {
    bankName: 'Itaú',
    senderPatterns: [/ita[uú]/i],
    purchasePattern: /compra\s+de\s+R\$\s?([\d.,]+)\s+.*?em\s+([A-Za-zÀ-ú0-9 .&'-]+?)(?:,|\.|\s+parcela|$)/i,
    pixPattern: /transfer[eê]ncia\s+pix.*?R\$\s?([\d.,]+)/i,
    installmentPattern: /(\d+)\s*de\s*(\d+)\s*parcelas?/i,
  },
  {
    bankName: 'Inter',
    senderPatterns: [/banco\s?inter/i, /^inter\b/i],
    purchasePattern: /compra\s+no\s+cart[aã]o.*?R\$\s?([\d.,]+)\s+.*?em\s+([A-Za-zÀ-ú0-9 .&'-]+?)(?:,|\.|\s+parcela|$)/i,
    pixPattern: /pix.*?recebido.*?R\$\s?([\d.,]+)|pix.*?enviado.*?R\$\s?([\d.,]+)/i,
    installmentPattern: /parcela\s*(\d+)\/(\d+)/i,
  },
  {
    bankName: 'Bradesco',
    senderPatterns: [/bradesco/i],
    purchasePattern: /compra\s+aprovada.*?valor\s+R\$\s?([\d.,]+).*?em\s+([A-Za-zÀ-ú0-9 .&'-]+?)(?:,|\.|\s+parcela|$)/i,
    pixPattern: /pix\s+realizado.*?R\$\s?([\d.,]+)/i,
    installmentPattern: /(\d+)\/(\d+)\s*parcelas?/i,
  },
  {
    bankName: 'C6 Bank',
    senderPatterns: [/c6\s?bank/i, /^c6\b/i],
    purchasePattern: /compra\s+.*?R\$\s?([\d.,]+)\s+.*?em\s+([A-Za-zÀ-ú0-9 .&'-]+?)(?:,|\.|\s+parcela|$)/i,
    pixPattern: /pix.*?R\$\s?([\d.,]+)/i,
    installmentPattern: /parcela\s*(\d+)\s*de\s*(\d+)/i,
  },
  {
    bankName: 'Mercado Pago',
    senderPatterns: [/mercado\s?pago/i, /^mp\b/i],
    purchasePattern: /(?:compra|pagamento)\s+aprovad[ao].*?R\$\s?([\d.,]+)\s+.*?em\s+([A-Za-zÀ-ú0-9 .&'-]+?)(?:,|\.|\s+parcela|$)/i,
    pixPattern: /pix\s+(?:enviado|recebido).*?R\$\s?([\d.,]+)/i,
    installmentPattern: /parcela\s*(\d+)\s*\/\s*(\d+)/i,
  },
];

function detectPaymentMethodFromText(body: string, fallback: PaymentMethodGuess): PaymentMethodGuess {
  if (/d[eé]bito/i.test(body)) return 'DEBIT';
  if (/cr[eé]dito/i.test(body)) return 'CREDIT';
  if (/boleto/i.test(body)) return 'BOLETO';
  return fallback;
}

function parseAmountToCents(raw: string): string | null {
  const normalized = raw.trim().replace(/\./g, '').replace(',', '.');
  const parts = normalized.split('.');
  if (parts.length > 2) return null;
  const integerPart = parts[0] || '0';
  const decimalPart = (parts[1] || '00').padEnd(2, '0').slice(0, 2);
  if (!/^\d+$/.test(integerPart) || !/^\d{2}$/.test(decimalPart)) return null;
  return (BigInt(integerPart) * 100n + BigInt(decimalPart)).toString();
}

function matchTemplate(sender: string): BankTemplate | null {
  for (const template of BANK_TEMPLATES) {
    if (template.senderPatterns.some((p) => p.test(sender))) return template;
  }
  return null;
}

function unrecognizedResult() {
  return {
    recognized: false,
    confidence: 0,
    amountCents: null,
    merchantName: null,
    city: null,
    paymentMethod: null,
    bankGuess: null,
    isLoanOrFinancing: false,
    installmentCurrent: null,
    installmentTotal: null,
    needsAiFallback: true,
  };
}

function buildResult(
  template: BankTemplate,
  body: string,
  amountRaw: string | undefined,
  merchantRaw: string | null,
  paymentMethod: PaymentMethodGuess,
) {
  const amountCents = amountRaw ? parseAmountToCents(amountRaw) : null;
  const installmentMatch = body.match(template.installmentPattern);
  const isLoan = LOAN_KEYWORDS.some((kw) => kw.test(body));
  const cityMatch = merchantRaw?.match(CITY_SUFFIX_PATTERN) ?? null;

  return {
    recognized: amountCents !== null,
    confidence: amountCents !== null ? 90 : 40,
    amountCents,
    merchantName: merchantRaw ? merchantRaw.replace(/\s+parcela\s*$/i, '').trim() : null,
    city: cityMatch ? cityMatch[1] : null,
    paymentMethod,
    bankGuess: template.bankName,
    isLoanOrFinancing: isLoan,
    installmentCurrent: installmentMatch ? parseInt(installmentMatch[1], 10) : null,
    installmentTotal: installmentMatch ? parseInt(installmentMatch[2], 10) : null,
    needsAiFallback: amountCents === null,
  };
}

function parse(sender: string, body: string) {
  const template = matchTemplate(sender);
  if (!template) return unrecognizedResult();

  const purchase = body.match(template.purchasePattern);
  const pix = body.match(template.pixPattern);

  if (purchase) {
    return buildResult(template, body, purchase[1], purchase[2] ?? null, detectPaymentMethodFromText(body, 'CREDIT'));
  }
  if (pix) {
    const amountRaw = pix[1] ?? pix[2];
    return buildResult(template, body, amountRaw, null, 'PIX');
  }

  return {
    ...unrecognizedResult(),
    bankGuess: template.bankName,
    isLoanOrFinancing: LOAN_KEYWORDS.some((kw) => kw.test(body)),
    needsAiFallback: true,
  };
}

Deno.serve(async (req: Request) => {
  try {
    const { sender, body } = await req.json();
    const result = parse(sender, body);
    return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 400 });
  }
});
