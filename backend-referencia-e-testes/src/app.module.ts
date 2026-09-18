import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';

import { AmortizationService } from './modules/amortization/amortization.service';
import { LoansModule } from './modules/loans/loans.module';
import { SmsParserModule } from './modules/sms-parser/sms-parser.module';
import { AccountsModule } from './modules/accounts/accounts.module';
import { CreditCardsModule } from './modules/credit-cards/credit-cards.module';
import { CategoriesModule } from './modules/categories/categories.module';
import { TransactionsModule } from './modules/transactions/transactions.module';
import { FixedExpensesModule } from './modules/fixed-expenses/fixed-expenses.module';
import { BudgetsModule } from './modules/budgets/budgets.module';
import { InvestmentsModule } from './modules/investments/investments.module';
import { RemindersModule } from './modules/reminders/reminders.module';
import { PushModule } from './modules/push/push.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { ReportsModule } from './modules/reports/reports.module';
import { AiCategorizationModule } from './modules/ai-categorization/ai-categorization.module';
import { JwtAuthGuard } from './common/auth/jwt-auth.guard';

@Module({
  imports: [
    ScheduleModule.forRoot(), // habilita o @Cron do RemindersService
    LoansModule,
    SmsParserModule,
    AccountsModule,
    CreditCardsModule,
    CategoriesModule,
    TransactionsModule,
    FixedExpensesModule,
    BudgetsModule,
    InvestmentsModule,
    RemindersModule,
    PushModule,
    DashboardModule,
    ReportsModule,
    AiCategorizationModule,
  ],
  providers: [
    AmortizationService,
    // AuthGuard global — toda rota exige um JWT Supabase válido,
    // exceto as marcadas explicitamente como públicas (não há
    // nenhuma pública neste sistema financeiro)
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule {}
