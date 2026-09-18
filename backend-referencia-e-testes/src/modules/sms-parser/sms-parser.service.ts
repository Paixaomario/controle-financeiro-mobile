import { Injectable } from '@nestjs/common';

/**
 * Este service representa a MESMA lógica que roda nativamente no
 * Android (Kotlin) dentro do app, conforme Fase 2 — aqui em TypeScript
 * para poder ser testada e validada no backend antes da portabilidade
 * para Kotlin. Em produção real, o parsing acontece 100% no dispositivo;
 * este código só recebe o texto já estruturado ou serve de referência
 * de implementação para o time mobile.
 *
 * IMPORTANTE: os regex abaixo são PADRÕES GENÉRICOS de formato de SMS
 * bancário brasileiro (estrutura comum a vários bancos), não texto
 * literal de nenhuma mensagem real — são construídos a partir do
 * formato observável publicamente (valor, estabelecimento, parcela).
 */

export type PaymentMethodGuess = 'DEBIT' | 'CREDIT' | 'PIX' | 'BOLETO' | 'OTHER';

export interface ParsedSmsResult {
  recognized: boolean;
  confidence: number; // 0-100
  amountCents: bigint | null;
  merchantName: string | null;
  city: string | null;
  paymentMethod: PaymentMethodGuess | null;
  bankGuess: string | null;
  isLoanOrFinancing: boolean;
  installmentCurrent: number | null;
  installmentTotal: number | null;
  needsAiFallback: boolean;
}

interface BankTemplate {
  bankName: string;
  senderPatterns: RegExp[]; // padrões de remetente/número curto
  purchasePattern: RegExp; // extrai valor + estabelecimento de compra
  pixPattern: RegExp;
  installmentPattern: RegExp; // extrai "parcela X/Y" ou "X de Y"
}

const LOAN_KEYWORDS = [
  /financiamento/i,
  /empr[eé]stimo/i,
  /consignado/i,
  /crediário/i,
  /crediario/i,
];

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
    // Mercado Pago manda o mesmo formato de aviso tanto para débito quanto
    // para crédito, com a palavra "débito"/"crédito" no corpo — a distinção
    // entre os dois é feita depois, por detectPaymentMethodFromText().
    purchasePattern: /(?:compra|pagamento)\s+aprovad[ao].*?R\$\s?([\d.,]+)\s+.*?em\s+([A-Za-zÀ-ú0-9 .&'-]+?)(?:,|\.|\s+parcela|$)/i,
    pixPattern: /pix\s+(?:enviado|recebido).*?R\$\s?([\d.,]+)/i,
    installmentPattern: /parcela\s*(\d+)\s*\/\s*(\d+)/i,
  },
];

@Injectable()
export class SmsParserService {
  /**
   * Ponto de entrada principal: recebe o remetente e o corpo do SMS,
   * tenta casar contra os templates de banco conhecidos. Se nenhum
   * template bater com confiança suficiente, marca `needsAiFallback`
   * para a camada de IA (Fase 2, seção 3) tentar interpretar.
   */
  parse(sender: string, body: string): ParsedSmsResult {
    const template = this.matchTemplate(sender, body);

    if (!template) {
      return this.unrecognizedResult();
    }

    const purchase = body.match(template.purchasePattern);
    const pix = body.match(template.pixPattern);

    if (purchase) {
      return this.buildResult(template, body, purchase[1], purchase[2] ?? null, this.detectPaymentMethodFromText(body, 'CREDIT'));
    }
    if (pix) {
      const amountRaw = pix[1] ?? pix[2];
      return this.buildResult(template, body, amountRaw, null, 'PIX');
    }

    // remetente reconhecido mas nenhum padrão de valor bateu — provavelmente
    // um formato de mensagem que o time ainda não mapeou para esse banco.
    // Mesmo sem extrair o valor, ainda sinalizamos financiamento por
    // palavra-chave, para o fallback de IA já vir com essa pista.
    return {
      ...this.unrecognizedResult(),
      bankGuess: template.bankName,
      isLoanOrFinancing: LOAN_KEYWORDS.some((kw) => kw.test(body)),
      needsAiFallback: true,
    };
  }

  private matchTemplate(sender: string, body: string): BankTemplate | null {
    for (const template of BANK_TEMPLATES) {
      if (template.senderPatterns.some((p) => p.test(sender))) {
        return template;
      }
    }
    return null;
  }

  private buildResult(
    template: BankTemplate,
    body: string,
    amountRaw: string | undefined,
    merchantRaw: string | null,
    paymentMethod: PaymentMethodGuess,
  ): ParsedSmsResult {
    const amountCents = amountRaw ? this.parseAmountToCents(amountRaw) : null;
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

  /**
   * Detecta débito/crédito/boleto pela palavra explícita no corpo da
   * mensagem (comum em avisos do Mercado Pago, que usam o mesmo formato
   * de frase para os dois). Se nada bater, usa o palpite padrão do
   * template (ex: a maioria dos bancos manda SMS de compra assumindo
   * cartão de crédito quando não especifica).
   */
  private detectPaymentMethodFromText(body: string, fallback: PaymentMethodGuess): PaymentMethodGuess {
    if (/d[eé]bito/i.test(body)) return 'DEBIT';
    if (/cr[eé]dito/i.test(body)) return 'CREDIT';
    if (/boleto/i.test(body)) return 'BOLETO';
    return fallback;
  }

  private unrecognizedResult(): ParsedSmsResult {
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

  /**
   * "1.234,56" -> 123456n (centavos). Nunca passa por Number para o
   * valor final — só para o parsing intermediário do texto, o resultado
   * é sempre BigInt exato de centavos, conforme regra de não arredondar.
   */
  private parseAmountToCents(raw: string): bigint | null {
    const normalized = raw.trim().replace(/\./g, '').replace(',', '.');
    const parts = normalized.split('.');
    if (parts.length > 2) return null;

    const integerPart = parts[0] || '0';
    const decimalPart = (parts[1] || '00').padEnd(2, '0').slice(0, 2);

    if (!/^\d+$/.test(integerPart) || !/^\d{2}$/.test(decimalPart)) return null;

    return BigInt(integerPart) * 100n + BigInt(decimalPart);
  }

  /**
   * Detecção de possível financiamento/carnê por RECORRÊNCIA, mesmo sem
   * palavra-chave explícita (Fase 2, seção 3.1) — mesmo valor, mesmo
   * remetente, mesmo dia do mês, repetindo em pelo menos 2 meses.
   */
  detectRecurrenceAsLoan(
    history: Array<{ amountCents: bigint; bankGuess: string | null; occurredAt: Date }>,
  ): boolean {
    if (history.length < 2) return false;

    const sorted = [...history].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const curr = sorted[i];
      const sameAmount = prev.amountCents === curr.amountCents;
      const sameBank = prev.bankGuess === curr.bankGuess;
      const daysBetween = Math.round(
        (curr.occurredAt.getTime() - prev.occurredAt.getTime()) / (1000 * 60 * 60 * 24),
      );
      const roughlyMonthly = daysBetween >= 27 && daysBetween <= 33;

      if (!(sameAmount && sameBank && roughlyMonthly)) return false;
    }
    return true;
  }
}
