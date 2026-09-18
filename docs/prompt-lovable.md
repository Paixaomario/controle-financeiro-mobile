# PROMPT PARA LOVABLE — Controle Financeiro Pessoal

Cole o conteúdo abaixo (a partir de "## CONTEXTO") diretamente no Lovable.

---

## CONTEXTO

Construa um aplicativo web completo (React + Supabase) de controle financeiro pessoal, com qualidade de produto AAA — visual sofisticado, modo escuro exclusivo, e lógica financeira precisa. O banco de dados Supabase **já existe e já tem o schema completo criado** (projeto `kgtyfgiuyakixcuagdby`) — conecte a esse projeto Supabase existente em vez de criar um novo, e gere as queries/mutations em cima das tabelas já existentes, listadas abaixo.

## IDENTIDADE VISUAL (obrigatório, não é sugestão)

- **Modo escuro é o único modo** — não implemente alternância de tema, o app não tem modo claro.
- Fundo base: `#0B0D0F`. Cards/superfícies: `#12151A`. Bordas: `#23262B`.
- Texto principal: `#F2F3F5`. Texto secundário: `#8A8F98`. Texto de metadado: `#5B6069`.
- **Verde (`#97C459` para ações/destaque, `#5DCAA5` para valores) é usado exclusivamente para entradas de dinheiro e status positivo.**
- **Vermelho (`#F09595`) é usado exclusivamente para saídas de dinheiro e alertas de estouro.**
- **Âmbar (`#EF9F27`) é usado exclusivamente para avisos de vencimento e orçamento no limite** — nunca use âmbar para saída comum, nem vermelho para alerta de vencimento (são conceitos diferentes).
- Tipografia sem serifa (Inter ou similar), peso 400 para corpo e 500 para valores/títulos — nunca bold 700.
- Ícones estilo outline/linear (ex: biblioteca Lucide), nunca preenchidos.
- Estética geral de "mercado financeiro/fintech": cards com leve gradiente metálico, números grandes e limpos, muito espaço em branco (escuro) entre seções, nada de cor decorativa fora da paleta acima.
- Valores monetários sempre exibidos como R$ 0.000,00 (padrão brasileiro), **mas o dado subjacente nunca é arredondado** — todo valor é armazenado e calculado em centavos inteiros, a formatação em R$ é só cosmética na exibição.

## TABELAS SUPABASE JÁ EXISTENTES (não recriar, usar como estão)

```
app_user, account, credit_card, category, fixed_expense_rule, transaction,
budget, loan, loan_installment, amortization_event, payment_reminder, investment
```

Todas com Row Level Security ativado — cada usuário só acessa seus próprios dados via `auth.uid()`. Use a autenticação nativa do Supabase (`auth.users`) e garanta que todo registro criado pelo app popule corretamente `user_id` vinculado ao usuário logado via `app_user.auth_user_id`.

Peça ao Lovable para inspecionar o schema real do projeto Supabase conectado antes de gerar as queries, para garantir que os nomes de coluna batam exatamente (todos em `snake_case`, valores monetários sempre como `bigint` em centavos).

## TELAS A CONSTRUIR

### 1. Dashboard (Home)
Saldo total, cards de resumo "Entradas" (verde) e "Saídas" (vermelho) do mês, prévia dos cartões com barra de limite usado, lista das últimas movimentações com ícone por categoria e indicador visual (`message-2` outline) quando `transaction.source` for `SMS` ou `NOTIFICATION`.

### 2. Extrato
Lista completa de `transaction`, filtrável por mês/categoria/conta/cartão, com totais de entrada/saída no topo do período filtrado.

### 3. Cartões
Lista de `credit_card` com fatura atual calculada (soma de `transaction` do período de fechamento), barra de limite usado, cor de alerta quando próximo do limite.

### 4. Orçamento
Comparação `budget.limit_cents` (planejado) x soma real de `transaction` por categoria no mês, com barra de progresso: verde até ~85%, âmbar acima disso.

### 5. Financiamentos / Empréstimos / Carnês
- Lista de `loan`, cada um mostrando tipo, instituição, parcelas pagas/total, saldo devedor.
- **Cadastro**: descrição, instituição, tipo (financiamento veículo/imóvel, empréstimo pessoal, carnê de loja, fatura parcelada), **escolha entre método de amortização PRICE (parcela fixa) ou SAC (parcela decrescente)**, valor total, quantidade de parcelas, valor da parcela, taxa de juros mensal, dia de vencimento. Ao salvar, gerar automaticamente todas as `loan_installment` (implemente a lógica de amortização: PRICE = parcela fixa com juros decrescente sobre saldo devedor; SAC = principal fixo, parcela decrescente — a fórmula está documentada no arquivo `amortization.service.ts` anexo a este prompt, replique essa lógica no frontend/edge function).
- **Demonstrativo de amortização**: para cada financiamento, mostrar valor total pago, total de juros pagos, total de desconto obtido por antecipação, saldo devedor restante, e o comparativo parcela a parcela (previsto x pago, com riscado no valor original quando houve desconto).
- **Amortização extraordinária**: campo de texto para o usuário digitar números de parcelas a quitar juntas (formato `15-20` ou `15,16,18`), calcular desconto pro-rata individual de cada parcela selecionada (parcelas mais distantes do vencimento têm desconto proporcionalmente maior), mostrar resumo antes de confirmar, e ao confirmar marcar todas como `PAID` e gravar um `amortization_event`.
- **Ajuste manual de valor pago**: em qualquer parcela paga, permitir editar `paid_amount_cents` manualmente caso o valor calculado não bata com o extrato real do banco — ao editar, preservar o valor calculado original em `original_calculated_cents` e marcar `is_manually_adjusted = true`, exibindo os dois valores lado a lado no demonstrativo.
- **Nunca arredondar**: toda operação de cálculo trabalha em centavos inteiros (`bigint`); se usar JavaScript, nunca usar `Number`/`Float` para valores monetários em cálculo — usar `BigInt` nativo do JS ou uma biblioteca de precisão decimal, convertendo para exibição em R$ só no componente final de UI.

### 6. Avisos de vencimento
Painel/lista mostrando os próximos `payment_reminder` (10, 5, 2 dias antes e 3 avisos no dia do vencimento, espaçados por horário). Como o Lovable gera web app, implemente isso como **notificações in-app + Web Push do navegador** (não como notificação nativa Android — isso é limitação de plataforma, não do app).

### 7. Investimentos
Cadastro (`investment`): descrição, tipo (poupança, CDB, ações, fundos, tesouro, cripto, outro), **instituição/banco usado para investir**, valor investido exato em centavos, data, valor atual opcional. Tela de resumo agrupando por instituição e por tipo.

### 8. Configurações
Dados da conta, gerenciamento de categorias, e um aviso claro de que a captura automática via SMS é exclusiva do app Android nativo (não disponível na versão web).

## O QUE NÃO PEDIR AO LOVABLE (fora do escopo dele)

Não tente implementar: leitura de SMS, `NotificationListenerService`, agendamento de alarme nativo Android, ou qualquer captura de dados do sistema operacional do celular — isso não é possível em uma aplicação web e será desenvolvido separadamente como app Android nativo (Kotlin), consumindo a mesma base Supabase.

---

## O QUE FICA PARA DEPOIS DO LOVABLE (feito por nós)

- Captura de SMS/notificações bancárias (app Android nativo)
- Parser local de mensagens e conciliação automática de pagamento
- Agendamento de notificações nativas via WorkManager/AlarmManager
- Publicação na Google Play (declaração de uso essencial de `READ_SMS`)
- Ajustes finos de qualquer lógica de amortização que o Lovable não reproduzir com 100% de precisão (validar contra os testes já escritos em `amortization.service.spec.ts`)
