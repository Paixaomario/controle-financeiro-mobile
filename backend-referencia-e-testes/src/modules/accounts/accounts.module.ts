import { Injectable, Controller, Module, Get, Post, Patch, Delete, Body, Param, Req } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export class CreateAccountDto {
  name!: string;
  institution?: string;
  type!: string;
  initialBalanceCents?: string;
}

@Injectable()
export class AccountsService {
  constructor(private readonly prisma: PrismaService) {}

  list(userId: string) {
    return this.prisma.account.findMany({ where: { userId }, orderBy: { name: 'asc' } });
  }

  create(userId: string, dto: CreateAccountDto) {
    return this.prisma.account.create({
      data: {
        userId,
        name: dto.name,
        institution: dto.institution,
        type: dto.type,
        balanceCents: BigInt(dto.initialBalanceCents ?? '0'),
      },
    });
  }

  update(userId: string, id: string, dto: Partial<CreateAccountDto>) {
    return this.prisma.account.update({
      where: { id },
      data: {
        name: dto.name,
        institution: dto.institution,
        type: dto.type,
      },
    });
  }

  remove(userId: string, id: string) {
    return this.prisma.account.delete({ where: { id } });
  }
}

@Controller('accounts')
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}

  @Get()
  list(@Req() req: any) {
    return this.accounts.list(req.user.id);
  }

  @Post()
  create(@Req() req: any, @Body() dto: CreateAccountDto) {
    return this.accounts.create(req.user.id, dto);
  }

  @Patch(':id')
  update(@Req() req: any, @Param('id') id: string, @Body() dto: Partial<CreateAccountDto>) {
    return this.accounts.update(req.user.id, id, dto);
  }

  @Delete(':id')
  remove(@Req() req: any, @Param('id') id: string) {
    return this.accounts.remove(req.user.id, id);
  }
}

@Module({
  controllers: [AccountsController],
  providers: [AccountsService, PrismaService],
  exports: [AccountsService],
})
export class AccountsModule {}
