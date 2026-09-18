# Fase 3 — Backend (API)
## Projeto: Controle Financeiro Pessoal (Android nativo)
**Agente responsável:** Backend
**Validado por:** Supervisor de Backend
**Auditado por:** Analista Final (segurança e integridade financeira)

---

## 1. Stack e princípios

- **NestJS + TypeScript**, Clean Architecture por módulo (mesmo padrão do seu projeto anterior).
- **Prisma + PostgreSQL (Supabase)**, schema da Fase 1.
- **Auth**: Supabase JWT via JWKS (RS256/ES256), mesma implementação já validada no projeto anterior — sem reescrever do zero.
- **Regra de ouro herdada da Fase 1**: todo valor monetário é `BigInt` fim a fim. Nenhum DTO, serializer ou service pode converter para `number`/`Float`. Os DTOs usam `string` para BigInt na serialização JSON (padrão do Prisma + `class-transformer` com transform customizado), evitando perda de precisão do `JSON.stringify` nativo com `BigInt`.
- **Nenhum texto bruto de SMS chega à API.** Os endpoints de ingestão só aceitam o payload já estruturado pelo parser local (Fase 2).

---

## 2. Módulos

| Módulo | Responsabilidade |
|---|---|
| `AccountsModule` | Contas e carteiras, saldo atômico |
| `CreditCardsModule` | Cartões, cálculo de fatura |
| `CategoriesModule` | Categorias de entrada/saída |
| `TransactionsModule` | Núcleo — CRUD, ingestão de SMS estruturado, ajustes |
| `FixedExpensesModule` | Regras de recorrência + recálculo adaptativo de data |
| `BudgetsModule` | Orçamento mensal por categoria |
| `LoansModule` | Financiamentos, empréstimos, carnês, faturas parceladas |
| `AmortizationModule` | `AmortizationService`, amortização extraordinária, ajuste manual |
| `RemindersModule` | Geração de `PaymentReminder`, worker de disparo |
| `InvestmentsModule` | Registro de investimentos |
| `AiCategorizationModule` | Proxy para Claude API (categorização e casos de baixa confiança do parser) |
| `DashboardModule` | Agregações para a tela inicial |

---

## 3. Endpoints principais

### Ingestão (usado pelo app após o parser local processar SMS/notificação)
```
POST /ingestion/transaction
POST /ingestion/loan-detected        → cria Loan com origin=SMS_DETECTED, pendente de confirmação
POST /ingestion/installment-payment  → concilia LoanInstallment (seção 6 da Fase 2)
POST /ingestion/fixed-expense-paid   → atualiza lastPaidAt/nextExpectedDueDate (seção 7 da Fase 1)
```
Todos exigem que `smsConsentAt` esteja preenchido no usuário — caso contrário, 403.

### Financiamentos e amortização
```
POST   /loans                        → cria Loan, dispara AmortizationService.generateSchedule()
GET    /loans/:id/installments
GET    /loans/:id/statement          → demonstrativo (seção 6 da Fase 1)
POST   /loans/:id/amortize           → { installmentNumbers: number[] } → amortização extraordinária
PATCH  /loans/:id/installments/:n    → ajuste manual de paidAmountCents (seção 9 da Fase 1)
```

### Avisos
```
GET  /reminders/upcoming
POST /reminders/:id/dismiss
```
O disparo em si roda como **cron job interno** (`@nestjs/schedule`), varrendo `PaymentReminder` com `scheduledFor <= now()` e `status = PENDING`, enviando push (FCM) como gatilho para o app confirmar/reagendar a notificação local — dupla camada (WorkManager local + FCM de sincronização) garante que o aviso dispare mesmo se o dispositivo tiver o app fechado há dias.

### Investimentos
```
POST /investments   → { description, type, institution, amountCents, investedAt }
GET  /investments
GET  /investments/summary   → total investido por instituição e por tipo
```

---

## 4. Regras de negócio críticas

- **Transações atômicas Prisma** em toda operação que mexe em saldo/limite/parcela — mesmo padrão do projeto anterior, nunca duas escritas separadas para saldo e transação.
- **Upsert idempotente na ingestão**: se o mesmo SMS gerar duas chamadas (retry de rede do app), a API deduplica por hash do payload estruturado + `occurredAt` + `amountCents`, evitando lançamento duplicado.
- **AmortizationService roda dentro do backend**, não no app — garante que o cálculo de juros/desconto seja centralizado e auditável, mesmo que o usuário troque de aparelho.
- **BigInt em toda a cadeia**: validação de DTO usa `zod`/`class-validator` com transformer customizado que rejeita valores não inteiros em centavos — impossível persistir `R$ 10,995` por engano de conversão.

---

## 5. Segurança

- Rate limiting por usuário nos endpoints de ingestão (evita flood caso o parser local tenha um bug e reenvie em loop).
- Chave da Claude API **apenas no backend** (`AiCategorizationModule` atua como proxy, nunca exposta ao app — conforme já definido no parecer da Fase 2).
- Logs de aplicação nunca gravam o corpo de requisições de ingestão na íntegra — apenas metadados (tipo, valor, timestamp), para não reintroduzir dado sensível de SMS por uma porta lateral (log).

---

## 6. Testes obrigatórios antes de avançar

- Testes unitários do `AmortizationService` para PRICE e SAC, incluindo casos de amortização extraordinária com parcelas não sequenciais (ex: `15,17,20`).
- Teste de concorrência: duas requisições de ingestão simultâneas para a mesma parcela não podem gerar duas conciliações.
- Teste de precisão: nenhum valor sofre perda ao passar por serialização JSON (BigInt como string, não number).
- Teste do cron de avisos com fuso horário — usuário em horário de verão/diferente não pode receber aviso na hora errada.

---

## 7. Parecer do Supervisor de Backend

Arquitetura aprovada. Ponto de atenção: o endpoint `/loans/:id/amortize` precisa de um lock otimista (campo `version` ou `updatedAt` checado antes do commit) para evitar que duas amortizações concorrentes sobre parcelas sobrepostas corrompam o saldo devedor — cenário raro, mas possível se o usuário usar o app em dois dispositivos.

## 8. Parecer do Analista Final (segurança e integridade financeira)

Aprovado com uma exigência: todo endpoint de ajuste manual (`PATCH /loans/:id/installments/:n`) precisa registrar em auditoria **quem, quando e o valor anterior**, já que mexe diretamente em dado financeiro sensível — isso já está coberto pelo campo `originalCalculatedCents`, mas recomenda-se also logar `userId` e IP de origem da requisição por segurança adicional, num log de auditoria separado do log de aplicação (não misturar com dados sensíveis de SMS).
