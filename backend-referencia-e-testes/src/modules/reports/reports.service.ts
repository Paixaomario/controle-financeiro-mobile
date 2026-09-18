import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface CashFlowMonth {
  monthRef: string;
  incomeCents: string;
  expenseCents: string;
  netCents: string;
}

export interface CategoryBreakdownItem {
  categoryId: string;
  categoryName: string;
  totalCents: string;
}

export interface NetWorthSummary {
  totalAccountBalanceCents: string;
  totalInvestmentsCents: string;
  totalOutstandingLoanBalanceCents: string;
  netWorthCents: string;
}

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Entradas x saídas mês a mês, últimos N meses (para gráfico/relatório). */
  async cashFlow(userId: string, months = 12): Promise<CashFlowMonth[]> {
    const now = new Date();
    const results: CashFlowMonth[] = [];

    for (let i = months - 1; i >= 0; i--) {
      const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
      const monthRef = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}`;

      const [income, expense] = await Promise.all([
        this.prisma.transaction.aggregate({
          where: { userId, type: 'INCOME', occurredAt: { gte: start, lt: end }, cancelledAt: null },
          _sum: { amountCents: true },
        }),
        this.prisma.transaction.aggregate({
          where: { userId, type: 'EXPENSE', occurredAt: { gte: start, lt: end }, cancelledAt: null },
          _sum: { amountCents: true },
        }),
      ]);

      const incomeCents = income._sum.amountCents ?? 0n;
      const expenseCents = expense._sum.amountCents ?? 0n;

      results.push({
        monthRef,
        incomeCents: incomeCents.toString(),
        expenseCents: expenseCents.toString(),
        netCents: (incomeCents - expenseCents).toString(),
      });
    }

    return results;
  }

  /** Gasto por categoria num período (ex: ano inteiro, para o relatório anual). */
  async categoryBreakdown(userId: string, start: Date, end: Date, type: 'INCOME' | 'EXPENSE' = 'EXPENSE'): Promise<CategoryBreakdownItem[]> {
    const transactions = await this.prisma.transaction.findMany({
      where: { userId, type, occurredAt: { gte: start, lt: end }, cancelledAt: null },
      include: { category: true },
    });

    const byCategory = new Map<string, { name: string; total: bigint }>();
    for (const t of transactions) {
      const entry = byCategory.get(t.categoryId) ?? { name: t.category.name, total: 0n };
      entry.total += t.amountCents;
      byCategory.set(t.categoryId, entry);
    }

    return [...byCategory.entries()]
      .map(([categoryId, v]) => ({ categoryId, categoryName: v.name, totalCents: v.total.toString() }))
      .sort((a, b) => Number(BigInt(b.totalCents) - BigInt(a.totalCents)));
  }

  /** Patrimônio líquido: saldo em contas + investimentos - saldo devedor de financiamentos. */
  async netWorth(userId: string): Promise<NetWorthSummary> {
    const [accounts, investments, loans] = await Promise.all([
      this.prisma.account.findMany({ where: { userId } }),
      this.prisma.investment.findMany({ where: { userId, cancelledAt: null } }),
      this.prisma.loan.findMany({
        where: { userId, cancelledAt: null },
        include: { installments: { where: { status: 'PENDING' } } },
      }),
    ]);

    const totalAccountBalanceCents = accounts.reduce((sum, a) => sum + a.balanceCents, 0n);
    const totalInvestmentsCents = investments.reduce(
      (sum, i) => sum + (i.currentValueCents ?? i.amountCents),
      0n,
    );
    const totalOutstandingLoanBalanceCents = loans.reduce(
      (sum, loan) => sum + loan.installments.reduce((s, i) => s + i.principalCents, 0n),
      0n,
    );

    const netWorthCents = totalAccountBalanceCents + totalInvestmentsCents - totalOutstandingLoanBalanceCents;

    return {
      totalAccountBalanceCents: totalAccountBalanceCents.toString(),
      totalInvestmentsCents: totalInvestmentsCents.toString(),
      totalOutstandingLoanBalanceCents: totalOutstandingLoanBalanceCents.toString(),
      netWorthCents: netWorthCents.toString(),
    };
  }

  /**
   * Dados para a declaração de Imposto de Renda — organiza os valores
   * que o usuário precisa para preencher manualmente as fichas "Bens e
   * Direitos" e "Dívidas e Ônus Reais". NÃO é um substituto de orientação
   * contábil — os códigos de bem sugeridos são os mais comuns, mas cada
   * caso pode ter particularidades que só um contador confirma.
   */
  async irData(userId: string, year: number) {
    const yearEnd = new Date(year, 11, 31, 23, 59, 59);
    const yearStart = new Date(year, 0, 1);
    const prevYearEnd = new Date(year - 1, 11, 31, 23, 59, 59);

    const [investments, loans, incomeByCategory] = await Promise.all([
      this.prisma.investment.findMany({
        where: { userId, cancelledAt: null, investedAt: { lte: yearEnd } },
      }),
      this.prisma.loan.findMany({
        where: { userId, cancelledAt: null, firstDueDate: { lte: yearEnd } },
        include: { installments: true },
      }),
      this.categoryBreakdown(userId, yearStart, new Date(year + 1, 0, 1), 'INCOME'),
    ]);

    const bensEDireitos = investments.map((inv) => ({
      descricao: inv.description,
      instituicao: inv.institution,
      tipo: inv.type,
      situacaoAnoAnterior: null as string | null, // exige histórico de anos anteriores — ver observação
      situacaoAnoAtual: (inv.currentValueCents ?? inv.amountCents).toString(),
      codigoSugerido: this.suggestBemCodigo(inv.type),
    }));

    const dividasEOnus = loans.map((loan) => {
      const paidByYearEnd = loan.installments.filter((i) => i.status === 'PAID' && i.paidAt && i.paidAt <= yearEnd);
      const totalPaidPrincipal = paidByYearEnd.reduce((s, i) => s + i.principalCents, 0n);
      const saldoDevedor = loan.totalAmountCents - totalPaidPrincipal;

      return {
        descricao: loan.description,
        instituicao: loan.institution,
        tipo: loan.type,
        saldoDevedorAnoAtual: saldoDevedor > 0n ? saldoDevedor.toString() : '0',
        codigoSugerido: this.suggestDividaCodigo(loan.type),
      };
    });

    return {
      year,
      bensEDireitos,
      dividasEOnus,
      rendimentosPorCategoria: incomeByCategory,
      observacao:
        'Este relatório organiza os valores registrados no sistema para facilitar o preenchimento manual da declaração. ' +
        'Não substitui orientação de um contador nem a fonte oficial (informes de rendimento dos bancos/empregador). ' +
        'Confirme os códigos de bem e dívida antes de declarar.',
    };
  }

  /** Sugestão de código de bem mais comum — sempre a confirmar com contador. */
  private suggestBemCodigo(type: string): string {
    const map: Record<string, string> = {
      SAVINGS: '41 - Caderneta de poupança',
      CDB: '45 - Aplicação de renda fixa (CDB, RDB e outros)',
      STOCKS: '31 - Ações',
      FUNDS: '73 - Fundos de investimento',
      TREASURY: '45 - Título público (Tesouro Direto)',
      CRYPTO: '81 - Criptoativo',
      OTHER: '99 - Outros bens e direitos',
    };
    return map[type] ?? '99 - Outros bens e direitos';
  }

  /** Sugestão de código de dívida/ônus mais comum — sempre a confirmar com contador. */
  private suggestDividaCodigo(type: string): string {
    const map: Record<string, string> = {
      VEHICLE: '15 - Financiamento de veículo',
      MORTGAGE: '18 - Financiamento imobiliário (SFH/SFI)',
      PERSONAL: '19 - Dívida com pessoa jurídica (empréstimo pessoal)',
      STORE_INSTALLMENT: '19 - Dívida com pessoa jurídica',
      CREDIT_CARD_INVOICE: '19 - Dívida com pessoa jurídica',
      OTHER: '99 - Outras dívidas e ônus reais',
    };
    return map[type] ?? '99 - Outras dívidas e ônus reais';
  }
}
