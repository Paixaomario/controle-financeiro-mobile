import { Injectable, Controller, Module, Get, Post, Patch, Delete, Body, Param, Req } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export class CreateCreditCardDto {
  name!: string;
  institution?: string;
  limitCents!: string;
  closingDay!: number;
  dueDay!: number;
  colorHex?: string;
}

@Injectable()
export class CreditCardsService {
  constructor(private readonly prisma: PrismaService) {}

  list(userId: string) {
    return this.prisma.creditCard.findMany({ where: { userId } });
  }

  create(userId: string, dto: CreateCreditCardDto) {
    return this.prisma.creditCard.create({
      data: {
        userId,
        name: dto.name,
        institution: dto.institution,
        limitCents: BigInt(dto.limitCents),
        closingDay: dto.closingDay,
        dueDay: dto.dueDay,
        colorHex: dto.colorHex,
      },
    });
  }

  /** Fatura atual = soma das transações do cartão desde o último fechamento. */
  async getCurrentInvoice(userId: string, cardId: string) {
    const card = await this.prisma.creditCard.findFirstOrThrow({ where: { id: cardId, userId } });
    const now = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth(), card.closingDay);
    if (periodStart > now) periodStart.setMonth(periodStart.getMonth() - 1);

    const transactions = await this.prisma.transaction.findMany({
      where: { creditCardId: cardId, occurredAt: { gte: periodStart } },
    });

    const totalCents = transactions.reduce((sum, t) => sum + t.amountCents, 0n);
    const usedPercentage = card.limitCents > 0n ? Number((totalCents * 10000n) / card.limitCents) / 100 : 0;

    return {
      cardId: card.id,
      periodStart,
      totalCents: totalCents.toString(),
      limitCents: card.limitCents.toString(),
      usedPercentage,
    };
  }

  update(userId: string, id: string, dto: Partial<CreateCreditCardDto>) {
    return this.prisma.creditCard.update({
      where: { id },
      data: {
        name: dto.name,
        institution: dto.institution,
        limitCents: dto.limitCents ? BigInt(dto.limitCents) : undefined,
        closingDay: dto.closingDay,
        dueDay: dto.dueDay,
        colorHex: dto.colorHex,
      },
    });
  }

  remove(userId: string, id: string) {
    return this.prisma.creditCard.delete({ where: { id } });
  }
}

@Controller('credit-cards')
export class CreditCardsController {
  constructor(private readonly creditCards: CreditCardsService) {}

  @Get()
  list(@Req() req: any) {
    return this.creditCards.list(req.user.id);
  }

  @Get(':id/invoice')
  invoice(@Req() req: any, @Param('id') id: string) {
    return this.creditCards.getCurrentInvoice(req.user.id, id);
  }

  @Post()
  create(@Req() req: any, @Body() dto: CreateCreditCardDto) {
    return this.creditCards.create(req.user.id, dto);
  }

  @Patch(':id')
  update(@Req() req: any, @Param('id') id: string, @Body() dto: Partial<CreateCreditCardDto>) {
    return this.creditCards.update(req.user.id, id, dto);
  }

  @Delete(':id')
  remove(@Req() req: any, @Param('id') id: string) {
    return this.creditCards.remove(req.user.id, id);
  }
}

@Module({
  controllers: [CreditCardsController],
  providers: [CreditCardsService, PrismaService],
  exports: [CreditCardsService],
})
export class CreditCardsModule {}
