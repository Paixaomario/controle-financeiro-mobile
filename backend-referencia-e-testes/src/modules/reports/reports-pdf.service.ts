import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { CashFlowMonth, CategoryBreakdownItem, NetWorthSummary } from './reports.service';

function centsToBRL(cents: string): string {
  const value = BigInt(cents);
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const reais = abs / 100n;
  const centavos = (abs % 100n).toString().padStart(2, '0');
  const reaisFormatted = reais.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${negative ? '-' : ''}R$ ${reaisFormatted},${centavos}`;
}

@Injectable()
export class ReportsPdfService {
  /** Relatório anual: fluxo de caixa, categorias, patrimônio líquido. */
  generateAnnualReportPdf(params: {
    year: number;
    cashFlow: CashFlowMonth[];
    expenseByCategory: CategoryBreakdownItem[];
    incomeByCategory: CategoryBreakdownItem[];
    netWorth: NetWorthSummary;
  }): PDFKit.PDFDocument {
    const doc = new PDFDocument({ margin: 50, size: 'A4' });

    doc.fontSize(20).text(`Relatório Financeiro Anual — ${params.year}`, { align: 'left' });
    doc.moveDown(0.5);
    doc.fontSize(10).fillColor('#666').text(`Gerado em ${new Date().toLocaleDateString('pt-BR')}`);
    doc.moveDown(1.5);

    doc.fillColor('#000').fontSize(14).text('Patrimônio líquido');
    doc.moveDown(0.3);
    doc.fontSize(10);
    doc.text(`Saldo em contas: ${centsToBRL(params.netWorth.totalAccountBalanceCents)}`);
    doc.text(`Investimentos: ${centsToBRL(params.netWorth.totalInvestmentsCents)}`);
    doc.text(`Saldo devedor de financiamentos: ${centsToBRL(params.netWorth.totalOutstandingLoanBalanceCents)}`);
    doc.fontSize(12).text(`Patrimônio líquido total: ${centsToBRL(params.netWorth.netWorthCents)}`, { underline: true });
    doc.moveDown(1.5);

    doc.fontSize(14).text('Fluxo de caixa mensal');
    doc.moveDown(0.3);
    doc.fontSize(9);
    for (const month of params.cashFlow) {
      doc.text(
        `${month.monthRef}   Entradas: ${centsToBRL(month.incomeCents)}   Saídas: ${centsToBRL(month.expenseCents)}   Líquido: ${centsToBRL(month.netCents)}`,
      );
    }
    doc.moveDown(1.5);

    doc.fontSize(14).text('Gastos por categoria');
    doc.moveDown(0.3);
    doc.fontSize(9);
    for (const cat of params.expenseByCategory) {
      doc.text(`${cat.categoryName}: ${centsToBRL(cat.totalCents)}`);
    }
    doc.moveDown(1.5);

    doc.fontSize(14).text('Entradas por categoria');
    doc.moveDown(0.3);
    doc.fontSize(9);
    for (const cat of params.incomeByCategory) {
      doc.text(`${cat.categoryName}: ${centsToBRL(cat.totalCents)}`);
    }

    doc.end();
    return doc;
  }

  /** Relatório de apoio à declaração de Imposto de Renda. */
  generateIrReportPdf(data: {
    year: number;
    bensEDireitos: Array<{ descricao: string; instituicao: string | null; situacaoAnoAtual: string; codigoSugerido: string }>;
    dividasEOnus: Array<{ descricao: string; instituicao: string | null; saldoDevedorAnoAtual: string; codigoSugerido: string }>;
    rendimentosPorCategoria: CategoryBreakdownItem[];
    observacao: string;
  }): PDFKit.PDFDocument {
    const doc = new PDFDocument({ margin: 50, size: 'A4' });

    doc.fontSize(20).text(`Apoio à Declaração de IR — Ano-base ${data.year}`);
    doc.moveDown(0.5);
    doc.fontSize(9).fillColor('#a00').text(data.observacao, { width: 495 });
    doc.fillColor('#000').moveDown(1.5);

    doc.fontSize(14).text('Bens e Direitos — situação em 31/12');
    doc.moveDown(0.3);
    doc.fontSize(9);
    for (const item of data.bensEDireitos) {
      doc.text(`${item.descricao} (${item.instituicao ?? '—'})`);
      doc.text(`  Código sugerido: ${item.codigoSugerido}`);
      doc.text(`  Valor: ${centsToBRL(item.situacaoAnoAtual)}`);
      doc.moveDown(0.3);
    }
    doc.moveDown(1);

    doc.fontSize(14).text('Dívidas e Ônus Reais — saldo devedor em 31/12');
    doc.moveDown(0.3);
    doc.fontSize(9);
    for (const item of data.dividasEOnus) {
      doc.text(`${item.descricao} (${item.instituicao ?? '—'})`);
      doc.text(`  Código sugerido: ${item.codigoSugerido}`);
      doc.text(`  Saldo devedor: ${centsToBRL(item.saldoDevedorAnoAtual)}`);
      doc.moveDown(0.3);
    }
    doc.moveDown(1);

    doc.fontSize(14).text('Rendimentos registrados no sistema, por categoria');
    doc.fontSize(8).fillColor('#666').text(
      'Informativo — não substitui o Informe de Rendimentos oficial do empregador/banco para fins de declaração.',
    );
    doc.fillColor('#000').fontSize(9).moveDown(0.3);
    for (const item of data.rendimentosPorCategoria) {
      doc.text(`${item.categoryName}: ${centsToBRL(item.totalCents)}`);
    }

    doc.end();
    return doc;
  }
}
