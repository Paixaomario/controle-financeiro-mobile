import { Module } from '@nestjs/common';
import { LoansController } from './loans.controller';
import { LoansService } from './loans.service';
import { AmortizationService } from '../amortization/amortization.service';
import { PrismaService } from '../../prisma/prisma.service';

@Module({
  controllers: [LoansController],
  providers: [LoansService, AmortizationService, PrismaService],
  exports: [LoansService],
})
export class LoansModule {}
