import { Body, Controller, Get, Param, Patch, Post, Req } from '@nestjs/common';
import { LoansService } from './loans.service';
import {
  AdjustPaidAmountDto,
  AmortizeInstallmentsDto,
  CreateLoanDto,
  ReconcilePaymentDto,
} from './loans.dto';

/**
 * userId vem do JWT (Supabase, via JWKS) já validado por um AuthGuard
 * global — omitido aqui por brevidade, mesmo padrão do projeto anterior.
 * `req.user.id` é o único ponto de confiança para "de quem é esse dado".
 */
@Controller('loans')
export class LoansController {
  constructor(private readonly loans: LoansService) {}

  @Get()
  list(@Req() req: any) {
    return this.loans.list(req.user.id);
  }

  @Post()
  create(@Req() req: any, @Body() dto: CreateLoanDto) {
    return this.loans.createLoan(req.user.id, dto);
  }

  @Get(':id/statement')
  statement(@Req() req: any, @Param('id') id: string) {
    return this.loans.getStatement(id, req.user.id);
  }

  @Post(':id/amortize')
  amortize(@Req() req: any, @Param('id') id: string, @Body() dto: AmortizeInstallmentsDto) {
    return this.loans.amortize(id, req.user.id, dto);
  }

  @Patch('installments/:id/adjust')
  adjust(@Req() req: any, @Param('id') id: string, @Body() dto: AdjustPaidAmountDto) {
    return this.loans.adjustPaidAmount(id, req.user.id, dto);
  }

  @Post(':id/cancel')
  cancelLoan(@Req() req: any, @Param('id') id: string) {
    return this.loans.cancelLoan(id, req.user.id);
  }

  @Post('installments/:id/cancel-payment')
  cancelPayment(@Req() req: any, @Param('id') id: string) {
    return this.loans.cancelInstallmentPayment(id, req.user.id);
  }

  @Post('installments/reconcile')
  reconcile(@Req() req: any, @Body() dto: ReconcilePaymentDto) {
    return this.loans.reconcilePayment(req.user.id, dto);
  }
}
