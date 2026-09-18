# Controle Financeiro Pessoal — PWA

Sistema completo de controle financeiro pessoal: entradas/saídas (manuais ou via SMS),
cartões, orçamento, financiamentos com amortização (PRICE/SAC), amortização
extraordinária, investimentos, avisos de vencimento e relatórios/IR.

## Arquitetura

```
/ (raiz deste zip)          → Frontend PWA (React + Vite) — isto é o que vai no Vercel
/docs/                       → Documentação técnica completa (Fases 1-6)
/supabase-edge-functions/    → Código-fonte das Edge Functions (já publicadas no Supabase)
/backend-referencia-e-testes/→ Backend NestJS original — não é mais necessário para
                                rodar o sistema, mantido só pelos 25 testes automatizados
                                que validam a lógica de amortização e do parser de SMS
```

Toda a lógica que antes rodava num servidor NestJS foi portada para **Edge Functions do
próprio Supabase** (`amortization`, `sms-parser`, `reports`, `dispatch-reminders`) — já
publicadas e ativas no projeto `kgtyfgiuyakixcuagdby`. O frontend fala direto com o
Supabase (banco + Edge Functions).

## Passo a passo para colocar no ar

### 1. GitHub
```bash
cd pasta-do-projeto
git add -A
git commit -m "Atualização"
git push
```

### 2. Vercel
Importe o repositório — o Vercel detecta sozinho que é **Vite** (por causa do
`vercel.json` e do `package.json` na raiz). **Atenção**: se o campo **Root Directory**
em Settings → General tiver algo escrito (ex: `backend` ou `frontend`), apague e deixe
em branco — o projeto inteiro vive na raiz do repositório.

### 3. Supabase
Banco de dados, RLS e as 4 Edge Functions já estão publicados. Restam só os ajustes
manuais de configuração de conta descritos abaixo (não são possíveis via código).

## Open Finance (conexão bancária real, via Pluggy — direto no app)

Nova seção em **Mais → Contas bancárias (Open Finance)**, com o **Agente de
Sincronização Bancária**. Diferente do parser de SMS, isso puxa saldo e extrato
**oficialmente**, direto do banco, incluindo iOS (SMS nunca funcionou lá).

**Fluxo integrado (o principal)**: botão **"Conectar banco"** abre o widget oficial
da Pluggy dentro do próprio app — você escolhe o banco, autoriza no app dele, e a
conexão é salva automaticamente, sem precisar copiar/colar nenhum código manualmente.

**Fluxo manual (alternativa/backup)**: ainda existe um campo para colar um Item ID
manualmente (dentro de "Já tenho um Item ID"), útil se você conectou pelo
`meu.pluggy.ai` fora do app por algum motivo.

### Passos para ativar

1. **No painel da Pluggy** (`dashboard.pluggy.ai`), pegue `Client ID` e `Client Secret`
2. Adicione os dois como secrets no Supabase (mesmo caminho do `CLAUDE_API_KEY`):
   `https://supabase.com/dashboard/project/kgtyfgiuyakixcuagdby/functions/secrets`
   - `PLUGGY_CLIENT_ID`
   - `PLUGGY_CLIENT_SECRET`
3. No app, vá em **Mais → Contas bancárias → Conectar banco**, escolha seu banco e
   autorize — a sincronização do extrato roda automaticamente assim que a conexão
   é confirmada

**Importante sobre segurança**: a conexão usa só o produto de **dados** (leitura de
extrato/saldo) da Pluggy, nunca o de pagamentos — não existe caminho técnico, nessa
integração, para mover dinheiro da conta. Revogar o acesso é feito direto no app do
banco a qualquer momento.

**Limitação honesta**: a Edge Function `pluggy-sync` foi escrita com base na
documentação e nos tipos oficiais da SDK da Pluggy (`pluggy-sdk`, `pluggy-connect-sdk`),
mas eu não consegui testá-la contra a API real deles (ambiente de desenvolvimento sem
acesso a esse domínio específico). Se o primeiro teste real der erro, me manda a
mensagem exata que aparecer — costuma ser rápido de ajustar.

## Assistente Financeiro (os 4 agentes de inteligência)

Nova aba **Assistente** (ícone de estrelas no menu, e card de destaque no topo do
Dashboard) — a parte que faz o app resolver sua vida financeira, não só registrar:

- **Agente Detector de Assinaturas**: identifica cobranças recorrentes mensais (mesmo
  estabelecimento, valor parecido, ~30 dias de intervalo) e aponta como candidatas a corte.
- **Agente Detector de Duplicidade**: encontra cobranças iguais (mesmo estabelecimento,
  mesmo valor) em menos de 48h, que costumam ser erro de cobrança.
- **Agente Detector de Anomalia por Categoria**: compara o gasto do mês em cada
  categoria com a sua média dos últimos meses, e avisa quando passa 50% acima.
- **Agente Conselheiro Financeiro**: gera um resumo do mês em linguagem natural
  (entradas, saídas, comparação com o mês passado, uma sugestão prática).
- **Agente de Categorização Inteligente**: aprende qual categoria você usa para cada
  estabelecimento (ex: sempre que você categoriza "iFood" como "Lazer", ele memoriza) e
  já sugere sozinho da próxima vez — em qualquer tela onde você lança uma saída manual.

Botão de atualizar (ícone de recarregar) na tela do Assistente roda a análise sob
demanda. Não há automação periódica agendada ainda (ao contrário dos avisos de
vencimento) — cada usuário aciona quando quiser olhar.

### Chave da Claude API (opcional, mas recomendado)

Sem essa chave, o Conselheiro e a Categorização ainda funcionam (com um resumo mais
simples, numérico, e sem sugestão automática de categoria por IA — só a memória de
categorias já aprendidas continua funcionando normalmente).

Para ativar a análise em linguagem natural:
1. Acesse `https://supabase.com/dashboard/project/kgtyfgiuyakixcuagdby/functions/secrets`
2. Adicione o secret `CLAUDE_API_KEY` com uma chave de API válida da Anthropic
   (`console.anthropic.com` → API Keys)

## Lançamento manual de entrada/saída (sem depender de SMS)

Botão **"+"** do menu inferior abre a tela **Novo lançamento**, com:
- Seletor **Entrada** (verde) / **Saída** (vermelho)
- Campo de valor no padrão "centavos primeiro" (mesmo do Nubank/Uber) — digita os
  números e o R$ se formata sozinho, sempre com vírgula decimal e ponto de milhar
  corretos, nunca depende de o usuário acertar a pontuação
- Categorias já cadastradas aparecem como botões — categoria nova é criada na hora
  pelo "+ Nova categoria" e fica salva no banco para todos os lançamentos futuros
- Link para "Adicionar via SMS/notificação" continua disponível, mas é uma
  alternativa, não o único caminho

O mesmo campo de valor ("centavos primeiro") também está em Investimentos, cadastro de
Financiamento e criação de Orçamento — nenhum valor do app depende de o usuário acertar
a formatação manualmente.

## Login é e-mail + senha (sem link de confirmação)

Cadastro por **e-mail + senha + confirmar senha**, com botões "Entrar"/"Cadastrar" na
mesma tela — nada de link por e-mail. Para o cadastro **não pedir confirmação por
e-mail**, é preciso desativar uma configuração no painel do Supabase (não dá pra fazer
por código):

1. Acesse `https://supabase.com/dashboard/project/kgtyfgiuyakixcuagdby/auth/providers`
2. Clique em **Email**
3. Desative o toggle **"Confirm email"**
4. Salve

## E-mail com limite baixo (se precisar no futuro)

O serviço de e-mail embutido do Supabase tem limite bem baixo (só para testes). Se
algum fluxo por e-mail voltar a ser usado e bater no limite, configure um SMTP próprio
(ex: Resend, grátis até 100 e-mails/dia) em Project Settings → Auth → **SMTP Settings**.

## A única coisa que exige um passo manual seu (Web Push)

Os avisos de vencimento (10/5/2 dias antes + 3x no dia) dependem de uma chave
criptográfica privada (VAPID) — exigência do protocolo Web Push em si, não deste projeto.

1. Acesse `https://supabase.com/dashboard/project/kgtyfgiuyakixcuagdby/functions/secrets`
2. Adicione o secret `VAPID_PRIVATE_KEY` com o valor:
   `oB7Wvs2x07izOuSjOHz6JBU8tDs9GZZ48y0NM0tySV4`
3. Pronto — o cron `dispatch-reminders` (já agendado a cada minuto) passa a enviar.

Até fazer esse passo, o resto do sistema funciona 100% normalmente.

## O que já foi testado e confirmado antes desta entrega

- `npx tsc -b --noEmit` no frontend → **zero erros de tipo**
- `npx vite build` → **build de produção limpo**, PWA com service worker
- 25 testes automatizados (`backend-referencia-e-testes/`): 12 do motor de amortização
  PRICE/SAC + 13 do parser de SMS (Nubank, Itaú, Inter, Bradesco, C6, Mercado Pago)
- As 4 Edge Functions publicadas e `ACTIVE` no Supabase
- Ícones reais (Lucide) em todos os menus e cabeçalhos — sem glifos de texto

## Funcionalidades

- Dashboard, extrato (com estorno), cartões, orçamento (com criação de limite) — ícones em tudo
- **Lançamento manual de entrada/saída** com categorias dinâmicas, sem depender de SMS
- Login/cadastro por e-mail e senha, sem exigir confirmação por link
- Financiamentos/empréstimos/carnês com amortização PRICE ou SAC
- Amortização extraordinária (digitando números de parcela: `15-20` ou `15,16,18`)
- Ajuste manual de valor pago, com auditoria do valor original calculado
- Captura de SMS/notificação via **compartilhamento** (Android) ou **colar manual**
  (qualquer plataforma) — como alternativa ao lançamento manual, nunca obrigatória
- Investimentos (valor, tipo, banco/corretora usado)
- Avisos de vencimento (10d/5d/2d + 3x no dia) via Web Push
- Relatórios: fluxo de caixa, patrimônio líquido, gastos por categoria, relatório
  anual e apoio à declaração de IR (abrem prontos para "Salvar como PDF" do navegador)
- Modo escuro exclusivo, verde para entradas, vermelho para saídas, âmbar para alertas
