import { Injectable, Controller, Module, Get, Post, Body, Param, Req } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export class CreateFixedExpenseDto {
  description!: string;
  expectedAmountCents!: string;
  dayOfMonth!: number;
  categoryId!: string;
}

@Injectable()
export class FixedExpensesService {
  constructor(private readonly prisma: PrismaService) {}

  list(userId: string) {
    return this.prisma.fixedExpenseRule.findMany({ where: { userId } });
  }

  create(userId: string, dto: CreateFixedExpenseDto) {
    const firstDue = this.nextOccurrence(dto.dayOfMonth);
    return this.prisma.fixedExpenseRule.create({
      data: {
        userId,
        description: dto.description,
        expectedAmountCents: BigInt(dto.expectedAmountCents),
        dayOfMonth: dto.dayOfMonth,
        categoryId: dto.categoryId,
        nextExpectedDueDate: firstDue,
      },
    });
  }

  /**
   * Chamado quando o parser (Fase 2) confirma que essa conta fixa foi
   * paga. Atualiza lastPaidAt e recalcula nextExpectedDueDate com base
   * no intervalo real entre pagamentos — não fica preso ao dayOfMonth
   * original se o banco cobrar em dia diferente na prática.
   */
  async markPaid(userId: string, ruleId: string, paidAt: Date) {
    const rule = await this.prisma.fixedExpenseRule.findFirstOrThrow({
      where: { id: ruleId, userId },
    });

    const nextDue = rule.lastPaidAt
      ? this.addApproxMonth(paidAt, this.daysBetween(rule.lastPaidAt, paidAt))
      : this.addApproxMonth(paidAt, 30);

    return this.prisma.fixedExpenseRule.update({
      where: { id: ruleId },
      data: { lastPaidAt: paidAt, nextExpectedDueDate: nextDue },
    });
  }

  private nextOccurrence(dayOfMonth: number): Date {
    const now = new Date();
    const candidate = new Date(now.getFullYear(), now.getMonth(), dayOfMonth);
    if (candidate < now) candidate.setMonth(candidate.getMonth() + 1);
    return candidate;
  }

  private daysBetween(a: Date, b: Date): number {
    return Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
  }

  private addApproxMonth(date: Date, intervalDays: number): Date {
    const result = new Date(date);
    // usa o intervalo real observado, com piso de 25 e teto de 35 dias
    // para não deixar um outlier (ex: pagamento atrasado) distorcer o padrão
    const clamped = Math.min(Math.max(intervalDays, 25), 35);
    result.setDate(result.getDate() + clamped);
    return result;
  }
}

@Controller('fixed-expenses')
export class FixedExpensesController {
  constructor(private readonly fixedExpenses: FixedExpensesService) {}

  @Get()
  list(@Req() req: any) {
    return this.fixedExpenses.list(req.user.id);
  }

  @Post()
  create(@Req() req: any, @Body() dto: CreateFixedExpenseDto) {
    return this.fixedExpenses.create(req.user.id, dto);
  }

  @Post(':id/mark-paid')
  markPaid(@Req() req: any, @Param('id') id: string, @Body('paidAt') paidAt: string) {
    return this.fixedExpenses.markPaid(req.user.id, id, new Date(paidAt));
  }
}

@Module({
  controllers: [FixedExpensesController],
  providers: [FixedExpensesService, PrismaService],
  exports: [FixedExpensesService],
})
export class FixedExpensesModule {}
