import { Injectable, Controller, Module, Get, Post, Patch, Body, Param, Req, Query } from '@nestjs/common';
import { TransactionSource, TransactionType, PaymentMethod } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import * as crypto from 'crypto';

export class CreateTransactionDto {
  type!: TransactionType;
  amountCents!: string;
  occurredAt!: string;
  accountId?: string;
  creditCardId?: string;
  categoryId!: string;
  merchantName?: string;
  merchantCity?: string;
}

/** Payload que chega do parser local (Fase 2) já estruturado — nunca texto bruto de SMS. */
export class IngestTransactionDto {
  type!: TransactionType;
  amountCents!: string;
  occurredAt!: string;
  categoryId!: string;
  accountId?: string;
  creditCardId?: string;
  merchantName?: string;
  merchantCity?: string;
  paymentMethod?: PaymentMethod;
  bankUsed?: string;
  sourceConfidence?: number;
}

@Injectable()
export class TransactionsService {
  constructor(private readonly prisma: PrismaService) {}

  list(userId: string, filters: { month?: string; accountId?: string; creditCardId?: string; includeCancelled?: boolean }) {
    const where: any = { userId };
    if (!filters.includeCancelled) where.cancelledAt = null;
    if (filters.month) {
      const [year, month] = filters.month.split('-').map(Number);
      where.occurredAt = {
        gte: new Date(year, month - 1, 1),
        lt: new Date(year, month, 1),
      };
    }
    if (filters.accountId) where.accountId = filters.accountId;
    if (filters.creditCardId) where.creditCardId = filters.creditCardId;

    return this.prisma.transaction.findMany({ where, orderBy: { occurredAt: 'desc' } });
  }

  /**
   * Estorno — nunca apaga a linha (trilha de auditoria, Fase 1). Marca
   * cancelledAt e reverte o impacto no saldo da conta, se houver.
   */
  async cancel(userId: string, transactionId: string) {
    return this.prisma.$transaction(async (tx) => {
      const transaction = await tx.transaction.findFirstOrThrow({
        where: { id: transactionId, userId },
      });
      if (transaction.cancelledAt) {
        return transaction; // idempotente — já estava cancelada
      }

      const cancelled = await tx.transaction.update({
        where: { id: transactionId },
        data: { cancelledAt: new Date() },
      });

      if (transaction.accountId) {
        const signedAmount = transaction.type === 'EXPENSE' ? -transaction.amountCents : transaction.amountCents;
        // reverte exatamente o que foi aplicado na criação (sinal invertido)
        await tx.account.update({
          where: { id: transaction.accountId },
          data: { balanceCents: { increment: -signedAmount } },
        });
      }

      return cancelled;
    });
  }

  /** Criação manual — sempre atualiza o saldo da conta atomicamente junto com a transação. */
  async create(userId: string, dto: CreateTransactionDto) {
    return this.prisma.$transaction(async (tx) => {
      const amountCents = BigInt(dto.amountCents);
      const signedAmount = dto.type === 'EXPENSE' ? -amountCents : amountCents;

      const transaction = await tx.transaction.create({
        data: {
          userId,
          type: dto.type,
          amountCents,
          occurredAt: new Date(dto.occurredAt),
          accountId: dto.accountId,
          creditCardId: dto.creditCardId,
          categoryId: dto.categoryId,
          merchantName: dto.merchantName,
          merchantCity: dto.merchantCity,
          source: 'MANUAL',
        },
      });

      if (dto.accountId) {
        await tx.account.update({
          where: { id: dto.accountId },
          data: { balanceCents: { increment: signedAmount } },
        });
      }

      return transaction;
    });
  }

  /**
   * Ingestão vinda do parser local do app (Fase 2/3). Deduplica por hash
   * do payload + occurredAt + amountCents, para retries de rede não
   * gerarem lançamento duplicado.
   */
  async ingest(userId: string, dto: IngestTransactionDto) {
    const dedupeHash = this.buildDedupeHash(userId, dto);

    const existing = await this.prisma.transaction.findFirst({
      where: {
        userId,
        amountCents: BigInt(dto.amountCents),
        occurredAt: new Date(dto.occurredAt),
        merchantName: dto.merchantName,
      },
    });
    if (existing) return existing; // idempotente — já processado

    return this.create(userId, {
      type: dto.type,
      amountCents: dto.amountCents,
      occurredAt: dto.occurredAt,
      categoryId: dto.categoryId,
      accountId: dto.accountId,
      creditCardId: dto.creditCardId,
      merchantName: dto.merchantName,
      merchantCity: dto.merchantCity,
    }).then((t) =>
      this.prisma.transaction.update({
        where: { id: t.id },
        data: {
          source: (dto.creditCardId ? 'SMS' : 'SMS') as TransactionSource,
          sourceConfidence: dto.sourceConfidence,
          paymentMethod: dto.paymentMethod,
          bankUsed: dto.bankUsed,
        },
      }),
    );
  }

  private buildDedupeHash(userId: string, dto: IngestTransactionDto): string {
    return crypto
      .createHash('sha256')
      .update(`${userId}:${dto.amountCents}:${dto.occurredAt}:${dto.merchantName ?? ''}`)
      .digest('hex');
  }

  /** Ajuste manual de uma transação existente — gera registro de ajuste, nunca sobrescreve. */
  async adjust(userId: string, transactionId: string, newAmountCents: string) {
    const original = await this.prisma.transaction.findFirstOrThrow({
      where: { id: transactionId, userId },
    });

    return this.prisma.transaction.create({
      data: {
        userId,
        type: original.type,
        amountCents: BigInt(newAmountCents),
        occurredAt: original.occurredAt,
        accountId: original.accountId,
        creditCardId: original.creditCardId,
        categoryId: original.categoryId,
        merchantName: original.merchantName,
        source: 'MANUAL',
        adjustmentOfId: original.id,
      },
    });
  }
}

@Controller('transactions')
export class TransactionsController {
  constructor(private readonly transactions: TransactionsService) {}

  @Get()
  list(@Req() req: any, @Query('month') month?: string, @Query('accountId') accountId?: string) {
    return this.transactions.list(req.user.id, { month, accountId });
  }

  @Post(':id/cancel')
  cancel(@Req() req: any, @Param('id') id: string) {
    return this.transactions.cancel(req.user.id, id);
  }

  @Post()
  create(@Req() req: any, @Body() dto: CreateTransactionDto) {
    return this.transactions.create(req.user.id, dto);
  }

  @Post('ingest')
  ingest(@Req() req: any, @Body() dto: IngestTransactionDto) {
    return this.transactions.ingest(req.user.id, dto);
  }

  @Patch(':id/adjust')
  adjust(@Req() req: any, @Param('id') id: string, @Body('amountCents') amountCents: string) {
    return this.transactions.adjust(req.user.id, id, amountCents);
  }
}

@Module({
  controllers: [TransactionsController],
  providers: [TransactionsService, PrismaService],
  exports: [TransactionsService],
})
export class TransactionsModule {}
