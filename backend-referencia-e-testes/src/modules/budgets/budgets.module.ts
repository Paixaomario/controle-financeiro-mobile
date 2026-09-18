import { Injectable, Controller, Module, Get, Post, Body, Req, Query } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export class UpsertBudgetDto {
  categoryId!: string;
  monthRef!: string; // "2026-08"
  limitCents!: string;
}

@Injectable()
export class BudgetsService {
  constructor(private readonly prisma: PrismaService) {}

  async getMonthSummary(userId: string, monthRef: string) {
    const [year, month] = monthRef.split('-').map(Number);
    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 1);

    const budgets = await this.prisma.budget.findMany({
      where: { userId, monthRef },
      include: { category: true },
    });

    const results = await Promise.all(
      budgets.map(async (budget) => {
        const spent = await this.prisma.transaction.aggregate({
          where: {
            userId,
            categoryId: budget.categoryId,
            type: 'EXPENSE',
            occurredAt: { gte: start, lt: end },
            cancelledAt: null,
          },
          _sum: { amountCents: true },
        });
        const spentCents = spent._sum.amountCents ?? 0n;
        return {
          categoryId: budget.categoryId,
          categoryName: budget.category.name,
          limitCents: budget.limitCents.toString(),
          spentCents: spentCents.toString(),
          percentageUsed: budget.limitCents > 0n ? Number((spentCents * 10000n) / budget.limitCents) / 100 : 0,
        };
      }),
    );

    return results;
  }

  upsert(userId: string, dto: UpsertBudgetDto) {
    return this.prisma.budget.upsert({
      where: { userId_categoryId_monthRef: { userId, categoryId: dto.categoryId, monthRef: dto.monthRef } },
      create: { userId, categoryId: dto.categoryId, monthRef: dto.monthRef, limitCents: BigInt(dto.limitCents) },
      update: { limitCents: BigInt(dto.limitCents) },
    });
  }
}

@Controller('budgets')
export class BudgetsController {
  constructor(private readonly budgets: BudgetsService) {}

  @Get()
  summary(@Req() req: any, @Query('month') month: string) {
    return this.budgets.getMonthSummary(req.user.id, month);
  }

  @Post()
  upsert(@Req() req: any, @Body() dto: UpsertBudgetDto) {
    return this.budgets.upsert(req.user.id, dto);
  }
}

@Module({
  controllers: [BudgetsController],
  providers: [BudgetsService, PrismaService],
  exports: [BudgetsService],
})
export class BudgetsModule {}
