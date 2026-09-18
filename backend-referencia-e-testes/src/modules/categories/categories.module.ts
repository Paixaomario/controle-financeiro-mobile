import { Injectable, Controller, Module, Get, Post, Delete, Body, Param, Req } from '@nestjs/common';
import { TransactionType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export class CreateCategoryDto {
  name!: string;
  kind!: TransactionType; // 'INCOME' | 'EXPENSE'
}

const DEFAULT_CATEGORIES: Array<{ name: string; kind: TransactionType }> = [
  { name: 'Salário', kind: 'INCOME' },
  { name: 'Freelance', kind: 'INCOME' },
  { name: 'Investimentos', kind: 'INCOME' },
  { name: 'Mercado', kind: 'EXPENSE' },
  { name: 'Transporte', kind: 'EXPENSE' },
  { name: 'Contas fixas', kind: 'EXPENSE' },
  { name: 'Lazer', kind: 'EXPENSE' },
  { name: 'Saúde', kind: 'EXPENSE' },
  { name: 'Financiamento/Empréstimo', kind: 'EXPENSE' },
];

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  list(userId: string) {
    return this.prisma.category.findMany({ where: { userId }, orderBy: { name: 'asc' } });
  }

  create(userId: string, dto: CreateCategoryDto) {
    return this.prisma.category.create({
      data: { userId, name: dto.name, kind: dto.kind, isSystemDefault: false },
    });
  }

  /** Roda uma vez no onboarding do usuário, populando as categorias padrão. */
  seedDefaults(userId: string) {
    return this.prisma.category.createMany({
      data: DEFAULT_CATEGORIES.map((c) => ({ userId, name: c.name, kind: c.kind, isSystemDefault: true })),
    });
  }

  remove(userId: string, id: string) {
    return this.prisma.category.delete({ where: { id } });
  }
}

@Controller('categories')
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Get()
  list(@Req() req: any) {
    return this.categories.list(req.user.id);
  }

  @Post()
  create(@Req() req: any, @Body() dto: CreateCategoryDto) {
    return this.categories.create(req.user.id, dto);
  }

  @Post('seed-defaults')
  seed(@Req() req: any) {
    return this.categories.seedDefaults(req.user.id);
  }

  @Delete(':id')
  remove(@Req() req: any, @Param('id') id: string) {
    return this.categories.remove(req.user.id, id);
  }
}

@Module({
  controllers: [CategoriesController],
  providers: [CategoriesService, PrismaService],
  exports: [CategoriesService],
})
export class CategoriesModule {}
