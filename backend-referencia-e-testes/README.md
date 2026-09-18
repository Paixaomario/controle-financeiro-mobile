# Controle Financeiro Pessoal — Backend

API NestJS completa do app de controle financeiro pessoal (Android nativo), com:
- Contas, cartões, transações, orçamento
- Financiamentos/empréstimos/carnês com amortização PRICE/SAC (testado)
- Amortização extraordinária por número de parcela (testado)
- Ajuste manual auditável de valores pagos
- Parser de SMS/notificações financeiras por banco (testado) + fallback de IA
- Avisos de vencimento adaptativos (10d/5d/2d/3x no dia) com worker via cron
- Investimentos
- Autenticação JWT via JWKS do Supabase

## Documentação técnica completa
Pasta `docs/` — Fases 1 a 6 do plano de desenvolvimento.

## Setup
\`\`\`bash
npm install
cp .env.example .env   # preencher DATABASE_URL, SUPABASE_URL, CLAUDE_API_KEY
npx prisma generate
npm test                # 21 testes: AmortizationService + SmsParserService
npm run start:dev
\`\`\`

## Banco de dados
Schema já aplicado no Supabase (projeto kgtyfgiuyakixcuagdby) via migração
`initial_schema_controle_financeiro`, com Row Level Security em todas as tabelas.
`prisma/schema.prisma` é a fonte da verdade do modelo.

## Estrutura de módulos
\`\`\`
src/
  main.ts, app.module.ts
  common/auth/jwt-auth.guard.ts      — autenticação JWT/JWKS (guard global)
  prisma/prisma.service.ts
  modules/
    amortization/    — motor de cálculo PRICE/SAC, testado (12 testes)
    sms-parser/       — parser de SMS por banco, testado (9 testes)
    loans/            — financiamentos, amortização extraordinária, ajuste manual
    accounts/, credit-cards/, categories/, transactions/
    fixed-expenses/   — recálculo adaptativo de data de vencimento
    budgets/, investments/, reminders/, dashboard/
    ai-categorization/ — proxy da Claude API (fallback do parser)
\`\`\`

## O que ainda falta (fora do escopo deste backend)
- App Android nativo (Kotlin/Compose) consumindo esta API — Fase 4
- `BroadcastReceiver`/`NotificationListenerService` reais no dispositivo
- Publicação na Google Play (declaração de uso de `READ_SMS`)

Ver `docs/fase6-consolidacao-final.md` para o checklist completo de entrega.
