import { Injectable, Controller, Module, Get, Req, Query } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getSummary(userId: string, monthRef: string) {
    const [year, month] = monthRef.split('-').map(Number);
    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 1);

    const [income, expense, accounts, cards] = await Promise.all([
      this.prisma.transaction.aggregate({
        where: { userId, type: 'INCOME', occurredAt: { gte: start, lt: end }, cancelledAt: null },
        _sum: { amountCents: true },
      }),
      this.prisma.transaction.aggregate({
        where: { userId, type: 'EXPENSE', occurredAt: { gte: start, lt: end }, cancelledAt: null },
        _sum: { amountCents: true },
      }),
      this.prisma.account.findMany({ where: { userId } }),
      this.prisma.creditCard.findMany({ where: { userId } }),
    ]);

    const totalBalanceCents = accounts.reduce((sum, a) => sum + a.balanceCents, 0n);

    return {
      totalBalanceCents: totalBalanceCents.toString(),
      incomeCents: (income._sum.amountCents ?? 0n).toString(),
      expenseCents: (expense._sum.amountCents ?? 0n).toString(),
      accountsCount: accounts.length,
      cardsCount: cards.length,
    };
  }

  recentTransactions(userId: string, take = 10) {
    return this.prisma.transaction.findMany({
      where: { userId },
      orderBy: { occurredAt: 'desc' },
      take,
      include: { category: true },
    });
  }
}

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('summary')
  summary(@Req() req: any, @Query('month') month: string) {
    return this.dashboard.getSummary(req.user.id, month);
  }

  @Get('recent-transactions')
  recent(@Req() req: any) {
    return this.dashboard.recentTransactions(req.user.id);
  }
}

@Module({
  controllers: [DashboardController],
  providers: [DashboardService, PrismaService],
})
export class DashboardModule {}
