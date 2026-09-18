import { SmsParserService } from './sms-parser.service';

describe('SmsParserService', () => {
  const parser = new SmsParserService();

  it('reconhece compra do Nubank e extrai valor + estabelecimento', () => {
    const result = parser.parse(
      'Nubank',
      'Compra aprovada: R$ 312,40 em Supermercado Extra - Piracicaba, 18/08 as 14:32.',
    );
    expect(result.recognized).toBe(true);
    expect(result.bankGuess).toBe('Nubank');
    expect(result.amountCents).toBe(31240n);
    expect(result.city).toBe('Piracicaba');
    expect(result.paymentMethod).toBe('CREDIT');
  });

  it('reconhece Pix do Itaú', () => {
    const result = parser.parse('Itau', 'Transferencia Pix enviada no valor de R$ 1.200,00 em 18/08.');
    expect(result.recognized).toBe(true);
    expect(result.amountCents).toBe(120000n);
    expect(result.paymentMethod).toBe('PIX');
  });

  it('detecta parcela de financiamento pela palavra-chave', () => {
    const result = parser.parse(
      'Inter',
      'Compra no cartao aprovada: R$ 890,00 em Financiamento Veiculo Santander parcela 9/48.',
    );
    expect(result.isLoanOrFinancing).toBe(true);
    expect(result.installmentCurrent).toBe(9);
    expect(result.installmentTotal).toBe(48);
  });

  it('marca para fallback de IA quando o remetente não é reconhecido', () => {
    const result = parser.parse('+55 11 91234-5678', 'Sua fatura fecha em 3 dias.');
    expect(result.recognized).toBe(false);
    expect(result.needsAiFallback).toBe(true);
  });

  it('marca fallback de IA quando o banco é conhecido mas o formato da mensagem não bate com nenhum padrão', () => {
    const result = parser.parse('Bradesco', 'Sua senha foi alterada com sucesso.');
    expect(result.recognized).toBe(false);
    expect(result.bankGuess).toBe('Bradesco');
    expect(result.needsAiFallback).toBe(true);
  });

  it('converte valores com milhar corretamente para centavos exatos, sem arredondar', () => {
    const result = parser.parse('Nubank', 'Compra aprovada: R$ 12.345,67 em Loja Teste, 01/01.');
    expect(result.amountCents).toBe(1234567n);
  });

  it('reconhece compra no débito do Mercado Pago', () => {
    const result = parser.parse(
      'MercadoPago',
      'Compra aprovada no débito: R$ 45,90 em Padaria Sao Jose, 18/08 as 08:15.',
    );
    expect(result.recognized).toBe(true);
    expect(result.bankGuess).toBe('Mercado Pago');
    expect(result.amountCents).toBe(4590n);
    expect(result.paymentMethod).toBe('DEBIT');
  });

  it('reconhece compra no crédito do Mercado Pago', () => {
    const result = parser.parse(
      'Mercado Pago',
      'Compra aprovada no crédito: R$ 199,00 em Loja Online Brasil, 18/08.',
    );
    expect(result.recognized).toBe(true);
    expect(result.bankGuess).toBe('Mercado Pago');
    expect(result.amountCents).toBe(19900n);
    expect(result.paymentMethod).toBe('CREDIT');
  });

  it('reconhece Pix recebido pelo Mercado Pago', () => {
    const result = parser.parse('MP', 'Pix recebido: R$ 350,00. Confira em Mercado Pago.');
    expect(result.recognized).toBe(true);
    expect(result.amountCents).toBe(35000n);
    expect(result.paymentMethod).toBe('PIX');
  });

  it('reconhece parcelamento no Mercado Pago', () => {
    const result = parser.parse(
      'MercadoPago',
      'Compra aprovada no crédito: R$ 89,90 em Eletronicos Silva parcela 2/10.',
    );
    expect(result.installmentCurrent).toBe(2);
    expect(result.installmentTotal).toBe(10);
  });


  describe('detectRecurrenceAsLoan', () => {
    it('identifica recorrência mensal do mesmo valor/banco como possível financiamento', () => {
      const history = [
        { amountCents: 89000n, bankGuess: 'Santander', occurredAt: new Date('2026-06-15') },
        { amountCents: 89000n, bankGuess: 'Santander', occurredAt: new Date('2026-07-15') },
        { amountCents: 89000n, bankGuess: 'Santander', occurredAt: new Date('2026-08-14') },
      ];
      expect(parser.detectRecurrenceAsLoan(history)).toBe(true);
    });

    it('não identifica quando o valor muda entre os meses', () => {
      const history = [
        { amountCents: 89000n, bankGuess: 'Santander', occurredAt: new Date('2026-06-15') },
        { amountCents: 95000n, bankGuess: 'Santander', occurredAt: new Date('2026-07-15') },
      ];
      expect(parser.detectRecurrenceAsLoan(history)).toBe(false);
    });

    it('não identifica com menos de 2 ocorrências', () => {
      const history = [{ amountCents: 89000n, bankGuess: 'Santander', occurredAt: new Date('2026-06-15') }];
      expect(parser.detectRecurrenceAsLoan(history)).toBe(false);
    });
  });
});
