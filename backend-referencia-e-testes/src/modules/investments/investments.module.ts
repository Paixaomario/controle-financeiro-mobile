import { Injectable, Controller, Module, Get, Post, Body, Param, Req } from '@nestjs/common';
import { InvestmentType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export class CreateInvestmentDto {
  description!: string;
  type!: InvestmentType;
  institution!: string; // banco/corretora usado para investir
  amountCents!: string; // valor exato, sem arredondamento
  investedAt!: string;
  currentValueCents?: string;
}

@Injectable()
export class InvestmentsService {
  constructor(private readonly prisma: PrismaService) {}

  list(userId: string) {
    return this.prisma.investment.findMany({
      where: { userId, cancelledAt: null },
      orderBy: { investedAt: 'desc' },
    });
  }

  cancel(userId: string, id: string) {
    return this.prisma.investment.updateMany({
      where: { id, userId, cancelledAt: null },
      data: { cancelledAt: new Date() },
    });
  }

  create(userId: string, dto: CreateInvestmentDto) {
    return this.prisma.investment.create({
      data: {
        userId,
        description: dto.description,
        type: dto.type,
        institution: dto.institution,
        amountCents: BigInt(dto.amountCents),
        investedAt: new Date(dto.investedAt),
        currentValueCents: dto.currentValueCents ? BigInt(dto.currentValueCents) : null,
      },
    });
  }

  async summary(userId: string) {
    const investments = await this.prisma.investment.findMany({ where: { userId, cancelledAt: null } });

    const byInstitution = new Map<string, bigint>();
    const byType = new Map<string, bigint>();

    for (const inv of investments) {
      byInstitution.set(inv.institution, (byInstitution.get(inv.institution) ?? 0n) + inv.amountCents);
      byType.set(inv.type, (byType.get(inv.type) ?? 0n) + inv.amountCents);
    }

    const totalCents = investments.reduce((sum, i) => sum + i.amountCents, 0n);

    return {
      totalCents: totalCents.toString(),
      byInstitution: Object.fromEntries([...byInstitution].map(([k, v]) => [k, v.toString()])),
      byType: Object.fromEntries([...byType].map(([k, v]) => [k, v.toString()])),
    };
  }
}

@Controller('investments')
export class InvestmentsController {
  constructor(private readonly investments: InvestmentsService) {}

  @Get()
  list(@Req() req: any) {
    return this.investments.list(req.user.id);
  }

  @Get('summary')
  summary(@Req() req: any) {
    return this.investments.summary(req.user.id);
  }

  @Post()
  create(@Req() req: any, @Body() dto: CreateInvestmentDto) {
    return this.investments.create(req.user.id, dto);
  }

  @Post(':id/cancel')
  cancel(@Req() req: any, @Param('id') id: string) {
    return this.investments.cancel(req.user.id, id);
  }
}

@Module({
  controllers: [InvestmentsController],
  providers: [InvestmentsService, PrismaService],
  exports: [InvestmentsService],
})
export class InvestmentsModule {}
