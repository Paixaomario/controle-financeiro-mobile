# Fase 1 — Modelagem de dados
## Projeto: Controle Financeiro Pessoal (Android nativo)
**Agente responsável:** Arquiteto de Produto
**Validado por:** Supervisor de Arquitetura
**Auditado por:** Analista Final (conformidade LGPD)

---

## 1. Princípios de design do modelo

- **Valores monetários em centavos (BigInt)** — evita erros de ponto flutuante, mesmo padrão já validado no projeto anterior.
- **Nada de texto bruto de SMS/notificação no servidor.** O parser roda localmente no dispositivo (Fase 2). Só sobe ao backend o resultado já estruturado (`Transaction`), nunca o conteúdo original da mensagem. Isso reduz drasticamente a superfície de dados sensíveis armazenados e simplifica a conformidade com LGPD.
- **Transações são imutáveis por padrão** — edição gera um registro de ajuste vinculado (`adjustmentOf`), preservando trilha de auditoria, essencial em app financeiro.
- **Origem rastreável** — todo lançamento guarda como foi criado: manual, SMS, notificação ou importação, permitindo à IA de categorização aprender com correções do usuário.
- **Nunca arredondar valores.** Todo valor monetário trafega e é armazenado em centavos como `BigInt`, exatamente como recebido/pago em reais — sem conversão para `Float`/`Decimal` com arredondamento em nenhuma camada (parser local, API, banco, exibição). A exibição em R$ formata o `BigInt` para tela, mas o valor de origem nunca é alterado por esse processo.

---

## 2. Entidades principais

### User
Dados de autenticação (Supabase JWT/JWKS), preferências (moeda, fuso horário), e flag de consentimento explícito para leitura de SMS/notificações (`smsConsentAt`, `smsConsentVersion`) — obrigatório documentar quando e qual versão dos termos o usuário aceitou.

### Account
Conta bancária ou carteira. Campos: nome, instituição, tipo (corrente, poupança, carteira), saldo atual (calculado por trigger/transação atômica, nunca editado direto).

### CreditCard
Cartão de crédito vinculado a uma instituição. Campos: nome, limite total, dia de fechamento, dia de vencimento, cor de exibição. O saldo da fatura é derivado da soma de transações do período, não armazenado como campo solto (evita inconsistência).

### Category
Categorias de entrada e saída (ex: Salário, Mercado, Transporte, Lazer). Campo `kind` distingue INCOME/EXPENSE. Campo `isSystemDefault` marca categorias pré-cadastradas vs. criadas pelo usuário.

### Transaction
O núcleo do sistema. Campos principais:
- `type`: INCOME | EXPENSE
- `amountCents`: BigInt
- `occurredAt`: data real do evento (não da captura)
- `accountId` ou `creditCardId` (um dos dois, nunca ambos)
- `categoryId`
- `merchantName`, `merchantLocation` (lat/lng opcional, cidade/estado) — vem do parser de SMS quando disponível
- `source`: MANUAL | SMS | NOTIFICATION | IMPORT
- `sourceConfidence`: 0–100, quão confiante a IA ficou na categorização automática
- `isFixedExpense`: boolean — liga à lógica de despesas fixas recorrentes
- `recurrenceId`: vínculo opcional a uma regra de recorrência

### FixedExpenseRule
Regras de recorrência (aluguel, assinaturas, contas fixas). Campos: descrição, valor esperado, dia do mês, categoria, conta/cartão padrão. O sistema usa isso para: (1) prever o mês seguinte no orçamento, (2) casar automaticamente uma transação vinda de SMS com a regra esperada.

Campos adicionais para aviso de vencimento adaptativo:
- `lastPaidAt` — data real do último pagamento reconhecido via SMS/notificação
- `nextExpectedDueDate` — recalculada automaticamente a cada pagamento detectado, com base em `lastPaidAt` + intervalo típico da recorrência (em vez de depender só do `dayOfMonth` cadastrado, que pode não bater com o dia real de cobrança). Isso é o que alimenta os avisos de vencimento (seção 7).

### PaymentReminder
Um aviso agendado de vencimento, gerado tanto para `LoanInstallment` quanto para a próxima ocorrência prevista de `FixedExpenseRule`. Ver seção 7 para a regra de geração (10, 5, 2 dias antes e 3x no dia).

### AmortizationEvent
Registro de uma operação de **amortização extraordinária**, onde o usuário quita várias parcelas de uma vez informando os números das parcelas (ex: "15 a 20"). Ver seção 8.

### Budget
Orçamento mensal por categoria (`userId + categoryId + monthRef`, chave upsert — mesmo padrão do projeto anterior). Compara `limitCents` planejado contra o somatório real de `Transaction` do mês.

### SmsParsingRule *(opcional, evolutivo)*
Tabela de regras/templates por banco (Nubank, Itaú, Bradesco, Inter, C6...) usada pelo parser local para pré-processar o texto antes de mandar para a IA classificar. Fica no backend só como fonte de atualização remota das regras — o processamento em si acontece no aparelho.

### Loan *(financiamento, empréstimo, carnê, fatura parcelada, compra de loja)*
Registro genérico de **qualquer plano de parcelas com amortização**: financiamento de veículo/imóvel, empréstimo, empréstimo consignado, carnê de loja, compra parcelada em crediário, ou fatura parcelada de cartão. Campos: descrição, instituição/loja credora, tipo (`VEHICLE`, `MORTGAGE`, `PERSONAL`, `STORE_INSTALLMENT`, `CREDIT_CARD_INVOICE`, `OTHER`), método de amortização (`PRICE` — parcelas fixas, ou `SAC` — parcelas decrescentes), valor total contratado, quantidade total de parcelas, valor da parcela, dia de vencimento, data da primeira parcela, taxa de juros mensal contratada, origem (`MANUAL` ou `SMS_DETECTED`).

Quando o parser da Fase 2 identifica um lançamento como financiamento/empréstimo/carnê (palavras-chave como "financiamento", "empréstimo", "parcela X/Y", "consignado", "crediário") ou o usuário cadastra manualmente uma compra parcelada de loja, o app abre a tela de cadastro pré-preenchida quando possível — o usuário confirma ou ajusta e salva.

### LoanInstallment
Uma parcela individual gerada a partir de um `Loan`. Ao cadastrar o plano com a quantidade total de parcelas, o **Motor de Amortização** (ver seção 7) gera automaticamente todas as `LoanInstallment` futuras (status `PENDING`), já divididas entre principal e juros conforme o método (PRICE/SAC), vinculadas à categoria correspondente e à conta/cartão padrão informado.

Campos adicionais de conciliação de pagamento:
- `principalCents` — parte do valor da parcela que amortiza o saldo devedor
- `interestCents` — parte do valor da parcela referente a juros, recalculada se houver pagamento antecipado
- `discountCents` — desconto obtido por antecipação, calculado automaticamente
- `paidAmountCents` — valor efetivamente pago (pode ser menor que o previsto por causa do desconto)
- `paidAt` — data real do pagamento
- `paymentMethod` — `DEBIT`, `CREDIT`, `PIX`, `BOLETO`, `OTHER`, extraído do SMS/notificação que confirmou o pagamento
- `bankUsed` — banco/instituição usada para pagar, extraído do texto do SMS
- `merchantNameFromSms` — nome do estabelecimento/credor exatamente como aparece na mensagem, para conferência
- `isManuallyAdjusted` — marca se o usuário corrigiu manualmente o valor pago porque o cálculo automático não bateu exatamente com o que foi pago
- `originalCalculatedCents` — preserva o valor que o `AmortizationService` havia calculado antes do ajuste manual, para auditoria
- `adjustmentNote` — motivo do ajuste, opcional, preenchido pelo usuário

Quando a parcela vence e é paga (detectada via SMS na Fase 2, ou confirmada manualmente), ela vira uma `Transaction` vinculada e seu status muda para `PAID`. Se ainda não venceu, permanece `PENDING` e já aparece projetada no orçamento dos meses seguintes.

### Investment
Registro de valores investidos pelo usuário. Campos: descrição, tipo (`SAVINGS`, `CDB`, `STOCKS`, `FUNDS`, `TREASURY`, `CRYPTO`, `OTHER`), **instituição/banco usado para investir**, valor investido (`amountCents`, exato, sem arredondamento), data do investimento, valor atual opcional (para quem quiser acompanhar rendimento, atualizado manualmente pelo usuário — o app não puxa cotação automaticamente nesta fase).

---

## 3. Diagrama de relacionamento (resumo textual)

```
User 1—N Account
User 1—N CreditCard
User 1—N Category
User 1—N FixedExpenseRule
User 1—N Budget
Account 1—N Transaction
CreditCard 1—N Transaction
Category 1—N Transaction
FixedExpenseRule 1—N Transaction (opcional)
Transaction N—1 Transaction (self, via adjustmentOf, opcional)
User 1—N Loan
Loan 1—N LoanInstallment
LoanInstallment 0—1 Transaction (quando quitada/conciliada)
Loan 1—N AmortizationEvent
User 1—N PaymentReminder
LoanInstallment 1—N PaymentReminder (opcional)
FixedExpenseRule 1—N PaymentReminder (opcional)
User 1—N Investment
```

---

## 4. Schema Prisma (rascunho inicial)

```prisma
enum TransactionType {
  INCOME
  EXPENSE
}

enum TransactionSource {
  MANUAL
  SMS
  NOTIFICATION
  IMPORT
}

model User {
  id                String   @id @default(uuid())
  email             String   @unique
  smsConsentAt      DateTime?
  smsConsentVersion String?
  createdAt         DateTime @default(now())

  accounts     Account[]
  creditCards  CreditCard[]
  categories   Category[]
  transactions Transaction[]
  budgets      Budget[]
  fixedRules   FixedExpenseRule[]
  loans        Loan[]
  reminders    PaymentReminder[]
  investments  Investment[]
}

model Account {
  id            String   @id @default(uuid())
  userId        String
  name          String
  institution   String?
  type          String
  balanceCents  BigInt   @default(0)
  createdAt     DateTime @default(now())

  user         User          @relation(fields: [userId], references: [id])
  transactions Transaction[]
}

model CreditCard {
  id           String   @id @default(uuid())
  userId       String
  name         String
  institution  String?
  limitCents   BigInt
  closingDay   Int
  dueDay       Int
  colorHex     String?

  user         User          @relation(fields: [userId], references: [id])
  transactions Transaction[]
}

model Category {
  id              String           @id @default(uuid())
  userId          String
  name            String
  kind            TransactionType
  isSystemDefault Boolean          @default(false)

  user         User          @relation(fields: [userId], references: [id])
  transactions Transaction[]
  budgets      Budget[]
}

model FixedExpenseRule {
  id                  String    @id @default(uuid())
  userId              String
  description         String
  expectedAmountCents BigInt
  dayOfMonth          Int
  categoryId          String
  lastPaidAt          DateTime?
  nextExpectedDueDate DateTime?

  user         User              @relation(fields: [userId], references: [id])
  transactions Transaction[]
  reminders    PaymentReminder[]
}

model Transaction {
  id                String             @id @default(uuid())
  userId            String
  type              TransactionType
  amountCents       BigInt
  occurredAt        DateTime
  accountId         String?
  creditCardId      String?
  categoryId        String
  merchantName      String?
  merchantCity      String?
  merchantLat       Float?
  merchantLng       Float?
  source            TransactionSource  @default(MANUAL)
  sourceConfidence  Int?
  isFixedExpense    Boolean            @default(false)
  recurrenceId      String?
  adjustmentOfId    String?
  paymentMethod     PaymentMethod?
  bankUsed          String?
  createdAt         DateTime           @default(now())

  user         User              @relation(fields: [userId], references: [id])
  account      Account?          @relation(fields: [accountId], references: [id])
  creditCard   CreditCard?       @relation(fields: [creditCardId], references: [id])
  category     Category          @relation(fields: [categoryId], references: [id])
  fixedRule    FixedExpenseRule? @relation(fields: [recurrenceId], references: [id])
  adjustmentOf Transaction?      @relation("Adjustment", fields: [adjustmentOfId], references: [id])
  adjustments  Transaction[]     @relation("Adjustment")
}

model Budget {
  id          String   @id @default(uuid())
  userId      String
  categoryId  String
  monthRef    String   // formato "2026-08"
  limitCents  BigInt

  user     User     @relation(fields: [userId], references: [id])
  category Category @relation(fields: [categoryId], references: [id])

  @@unique([userId, categoryId, monthRef])
}

enum LoanType {
  VEHICLE
  MORTGAGE
  PERSONAL
  STORE_INSTALLMENT
  CREDIT_CARD_INVOICE
  OTHER
}

enum LoanOrigin {
  MANUAL
  SMS_DETECTED
}

enum AmortizationMethod {
  PRICE   // parcelas de valor fixo
  SAC     // parcelas decrescentes (amortização constante)
}

enum PaymentMethod {
  DEBIT
  CREDIT
  PIX
  BOLETO
  OTHER
}

model Loan {
  id                  String              @id @default(uuid())
  userId              String
  description         String
  institution         String?
  type                LoanType
  amortizationMethod  AmortizationMethod  @default(PRICE)
  totalAmountCents    BigInt
  installmentsTotal   Int
  installmentCents    BigInt
  dueDay              Int
  firstDueDate        DateTime
  monthlyInterestRate Float?
  origin              LoanOrigin          @default(MANUAL)
  accountId           String?
  creditCardId        String?
  createdAt           DateTime            @default(now())

  user               User                @relation(fields: [userId], references: [id])
  installments       LoanInstallment[]
  amortizationEvents AmortizationEvent[]
}

enum InstallmentStatus {
  PENDING
  PAID
  OVERDUE
}

model LoanInstallment {
  id                  String            @id @default(uuid())
  loanId              String
  number              Int               // parcela X de Y
  dueDate             DateTime
  amountCents         BigInt            // valor previsto (principal + juros)
  principalCents      BigInt
  interestCents       BigInt
  discountCents       BigInt            @default(0)
  paidAmountCents     BigInt?
  paidAt              DateTime?
  status              InstallmentStatus @default(PENDING)
  paymentMethod       PaymentMethod?
  bankUsed            String?
  merchantNameFromSms String?
  isManuallyAdjusted  Boolean           @default(false)
  originalCalculatedCents BigInt?
  adjustmentNote      String?
  transactionId       String?           @unique

  loan        Loan              @relation(fields: [loanId], references: [id])
  transaction Transaction?      @relation(fields: [transactionId], references: [id])
  reminders   PaymentReminder[]

  @@unique([loanId, number])
}

enum ReminderTargetType {
  LOAN_INSTALLMENT
  FIXED_EXPENSE
}

enum ReminderStatus {
  PENDING
  SENT
}

model PaymentReminder {
  id                String             @id @default(uuid())
  userId            String
  targetType        ReminderTargetType
  loanInstallmentId String?
  fixedExpenseId    String?
  dueDate           DateTime
  scheduledFor      DateTime           // momento exato do disparo
  status            ReminderStatus     @default(PENDING)
  sentAt            DateTime?

  user            User              @relation(fields: [userId], references: [id])
  loanInstallment LoanInstallment?  @relation(fields: [loanInstallmentId], references: [id])
  fixedExpense    FixedExpenseRule? @relation(fields: [fixedExpenseId], references: [id])
}

model AmortizationEvent {
  id                 String   @id @default(uuid())
  loanId             String
  installmentNumbers Int[]    // parcelas quitadas juntas nessa operação, ex: [15,16,17,18,19,20]
  paidAt             DateTime
  totalPaidCents     BigInt
  totalDiscountCents BigInt
  createdAt          DateTime @default(now())

  loan Loan @relation(fields: [loanId], references: [id])
}

enum InvestmentType {
  SAVINGS
  CDB
  STOCKS
  FUNDS
  TREASURY
  CRYPTO
  OTHER
}

model Investment {
  id                String         @id @default(uuid())
  userId            String
  description       String
  type              InvestmentType
  institution       String         // banco/corretora usado para investir
  amountCents       BigInt         // valor exato investido, sem arredondamento
  investedAt        DateTime
  currentValueCents BigInt?
  createdAt         DateTime       @default(now())

  user User @relation(fields: [userId], references: [id])
}
```

---

## 5. Motor de amortização

Serviço de backend (`AmortizationService`) acionado sempre que um `Loan` é criado ou uma parcela é conciliada como paga.

**Geração inicial das parcelas** (`PRICE` ou `SAC`):
- `PRICE`: todas as parcelas com `amountCents` igual, mas a proporção `principalCents`/`interestCents` muda mês a mês (mais juros no início, mais principal no fim) — cálculo padrão de tabela Price sobre `monthlyInterestRate`.
- `SAC`: `principalCents` fixo em todas as parcelas, `interestCents` decrescente sobre o saldo devedor remanescente — parcelas ficam decrescentes ao longo do tempo.

**Recalculo no pagamento** (dispara ao conciliar uma `LoanInstallment` como paga, manual ou via SMS na Fase 2):
1. Compara `paidAt` com `dueDate`.
2. Se pago **antecipadamente**, calcula `discountCents` proporcional aos dias de antecipação sobre a taxa de juros mensal contratada (juros pro-rata sobre o saldo devedor daquela parcela).
3. Atualiza `interestCents` para refletir o valor realmente cobrado (menor que o previsto) e `paidAmountCents` = `principalCents + interestCents - discountCents`.
4. Se pago **em atraso**, o mesmo motor pode, de forma inversa, sinalizar juros adicionais — status muda para `OVERDUE` antes da conciliação, e o campo `interestCents` é ajustado para cima conforme regra de mora informada no cadastro do `Loan` (campo futuro, opcional).

## 6. Demonstrativo de amortização (relatório, não é tabela nova)

Tela/relatório por `Loan`, computado a partir do somatório das `LoanInstallment` já pagas:
- **Valor total contratado** x **valor total já pago**
- **Total de juros pagos** (soma de `interestCents` das parcelas `PAID`)
- **Total de desconto obtido por antecipação** (soma de `discountCents`)
- Comparativo parcela a parcela: **valor previsto x valor efetivamente pago**, com destaque visual para parcelas que tiveram desconto
- Projeção do saldo devedor restante com base nas parcelas ainda `PENDING`

Esse relatório é 100% derivado — não exige nova tabela, só consultas agregadas sobre `LoanInstallment`.

## 7. Avisos de vencimento

Serviço `ReminderGeneratorService`, acionado sempre que uma `LoanInstallment` é criada, ou quando o `nextExpectedDueDate` de uma `FixedExpenseRule` é recalculado.

**Regra de geração de avisos** (idêntica para parcela de financiamento/carnê ou conta fixa):
- **10 dias antes** do vencimento
- **5 dias antes**
- **2 dias antes**
- **No dia do vencimento**, 3 avisos espaçados ao longo do dia (ex: 09:00, 13:00, 18:00 — horários configuráveis pelo usuário)

Cada um vira uma linha em `PaymentReminder` com `scheduledFor` já calculado. A entrega em si acontece via **notificação local no Android** (WorkManager/AlarmManager), agendada pelo app assim que os dados sincronizam do backend — não depende de o app estar aberto no momento do aviso.

**Reconhecimento adaptativo de data de contas fixas:** quando o parser da Fase 2 confirma o pagamento de uma conta fixa via SMS, o sistema atualiza `FixedExpenseRule.lastPaidAt` com a data real, recalcula `nextExpectedDueDate` (baseado no intervalo real entre pagamentos, não só no `dayOfMonth` cadastrado) e regenera os avisos da próxima ocorrência automaticamente — corrigindo o calendário de avisos caso a cobrança historicamente aconteça em dia diferente do originalmente cadastrado.

Se um aviso for enviado e a parcela/conta for paga antes do próximo aviso programado, os avisos restantes daquela ocorrência são cancelados automaticamente (`status` não muda para `SENT`, a linha é descartada).

## 8. Amortização extraordinária com parcelas específicas

Ao escolher "amortizar" um `Loan`, o app apresenta um campo para o usuário **digitar os números das parcelas** que está quitando de uma vez (ex: `15-20` ou `15,16,18,20`), em vez de assumir só a próxima parcela.

Fluxo:
1. Usuário digita os números das parcelas.
2. Sistema busca as `LoanInstallment` correspondentes (`status = PENDING`), soma `amountCents` previsto de todas.
3. Calcula o desconto de cada uma individualmente (mesma lógica pro-rata da seção 5, já que cada parcela tem uma data de vencimento diferente e portanto um desconto diferente por antecipação).
4. Mostra o resumo: valor total previsto x valor total a pagar com desconto, antes de confirmar.
5. Ao confirmar, marca todas as `LoanInstallment` selecionadas como `PAID`, grava um `AmortizationEvent` agrupando a operação (para aparecer como um único evento no demonstrativo, com o detalhamento por parcela disponível ao expandir).

## 9. Ajuste manual de valores pagos

O `AmortizationService` calcula `interestCents`/`discountCents`/`paidAmountCents` automaticamente, mas juros bancários reais às vezes não batem exatamente com a fórmula pro-rata (arredondamentos do próprio banco, taxas administrativas não informadas no cadastro, etc). Por isso:

1. Toda `LoanInstallment` conciliada — seja via SMS ou manualmente — pode ter seu `paidAmountCents` **editado diretamente pelo usuário**.
2. Ao editar, o sistema grava o valor que havia calculado em `originalCalculatedCents` (preservando o cálculo original para auditoria/comparação no demonstrativo) e marca `isManuallyAdjusted = true`.
3. O demonstrativo de amortização (seção 6) passa a mostrar, quando aplicável, "valor calculado" x "valor ajustado manualmente", nunca escondendo a diferença.
4. Esse ajuste nunca aciona arredondamento — o valor digitado pelo usuário é gravado exatamente como informado, em centavos.

## 10. Parecer do Supervisor de Arquitetura

Modelo aprovado com uma ressalva: recomenda-se índice composto em `Transaction(userId, occurredAt)` desde o início, já que o dashboard e o extrato vão consultar por período constantemente — sem isso, a performance degrada rápido com histórico longo. Adicionalmente, recomenda-se índice em `PaymentReminder(scheduledFor, status)` para o worker de disparo de avisos não varrer a tabela inteira a cada execução. Reforça-se que nenhuma camada (ORM, serialização JSON da API, formatação de UI) pode converter `BigInt` para `Number`/`Float` em nenhum ponto do fluxo de cálculo — só na exibição final formatada em R$, e nunca de volta.

## 11. Parecer do Analista Final (LGPD)

Conformidade condicionada a três pontos obrigatórios na Fase 2:
1. Tela de consentimento explícita e específica para leitura de SMS/notificações, separada do aceite geral de termos.
2. Nenhum texto bruto de mensagem deve trafegar para o backend ou ser persistido em log de servidor.
3. Usuário precisa ter opção de revogar o consentimento e apagar o histórico de transações capturadas automaticamente, mantendo apenas o que ele confirmar manualmente.
