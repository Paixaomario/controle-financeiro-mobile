import { Controller, Get, Module, Query, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ReportsService } from './reports.service';
import { ReportsPdfService } from './reports-pdf.service';
import { PrismaService } from '../../prisma/prisma.service';

@Controller('reports')
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly pdf: ReportsPdfService,
  ) {}

  @Get('cash-flow')
  cashFlow(@Req() req: any, @Query('months') months?: string) {
    return this.reports.cashFlow(req.user.id, months ? parseInt(months, 10) : 12);
  }

  @Get('category-breakdown')
  categoryBreakdown(
    @Req() req: any,
    @Query('year') year: string,
    @Query('type') type: 'INCOME' | 'EXPENSE' = 'EXPENSE',
  ) {
    const y = parseInt(year, 10);
    return this.reports.categoryBreakdown(req.user.id, new Date(y, 0, 1), new Date(y + 1, 0, 1), type);
  }

  @Get('net-worth')
  netWorth(@Req() req: any) {
    return this.reports.netWorth(req.user.id);
  }

  @Get('ir')
  irData(@Req() req: any, @Query('year') year: string) {
    return this.reports.irData(req.user.id, parseInt(year, 10));
  }

  @Get('annual-pdf')
  async annualPdf(@Req() req: any, @Query('year') year: string, @Res() res: Response) {
    const y = parseInt(year, 10);
    const [cashFlow, expenseByCategory, incomeByCategory, netWorth] = await Promise.all([
      this.reports.cashFlow(req.user.id, 12),
      this.reports.categoryBreakdown(req.user.id, new Date(y, 0, 1), new Date(y + 1, 0, 1), 'EXPENSE'),
      this.reports.categoryBreakdown(req.user.id, new Date(y, 0, 1), new Date(y + 1, 0, 1), 'INCOME'),
      this.reports.netWorth(req.user.id),
    ]);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="relatorio-anual-${y}.pdf"`);
    const doc = this.pdf.generateAnnualReportPdf({ year: y, cashFlow, expenseByCategory, incomeByCategory, netWorth });
    doc.pipe(res);
  }

  @Get('ir-pdf')
  async irPdf(@Req() req: any, @Query('year') year: string, @Res() res: Response) {
    const y = parseInt(year, 10);
    const data = await this.reports.irData(req.user.id, y);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="apoio-ir-${y}.pdf"`);
    const doc = this.pdf.generateIrReportPdf(data);
    doc.pipe(res);
  }
}

@Module({
  controllers: [ReportsController],
  providers: [ReportsService, ReportsPdfService, PrismaService],
})
export class ReportsModule {}
