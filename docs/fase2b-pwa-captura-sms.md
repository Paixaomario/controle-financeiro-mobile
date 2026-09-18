# Fase 2-PWA — Captura de SMS adaptada para PWA (substitui parte da Fase 2 e da Fase 4 nativas)

## Por que mudou

A Fase 2 original previa um app Android nativo com `BroadcastReceiver` e
`NotificationListenerService` lendo SMS/notificações automaticamente, sem
nenhuma ação do usuário. **Um PWA não tem acesso a essa API** — não é uma
limitação de implementação, é uma restrição de segurança de qualquer
navegador, em qualquer sistema operacional. Não existe contorno.

O que se mantém 100% igual: o `SmsParserService` (parser por banco,
detecção de financiamento, cálculo de centavos exato) — só muda **como o
texto chega até ele**.

## Os dois caminhos de captura no PWA

### 1. Compartilhar (Web Share Target) — principal, só Android
O `manifest.json` do PWA declara um `share_target`. Isso faz o app
aparecer na folha de compartilhamento nativa do Android quando o usuário
toca em "Compartilhar" numa notificação bancária ou numa mensagem SMS.
O texto chega direto na rota `/capture-sms?text=...` do frontend, que
chama `POST /sms-parser/parse` e mostra a tela de confirmação (mesmo
layout do mockup "detectado automaticamente via SMS" que já validamos)
antes de criar a transação.

**Limitação**: só funciona no Android (Chrome/Edge). No iOS, o Safari não
implementa Web Share Target para apps instalados de forma equivalente.

### 2. Colar manual — funciona em qualquer plataforma
Tela "Adicionar rápido" com um campo de texto onde o usuário cola o
conteúdo do SMS/notificação (copiar do app de mensagens é 2 toques).
Mesmo endpoint `POST /sms-parser/parse`, mesma tela de confirmação.
É o caminho universal — inclusive serve de fallback quando o
compartilhamento não reconhece o remetente.

## Avisos de vencimento no PWA

Substituem WorkManager/AlarmManager por **Web Push** (`sw.js`), com o
backend dependendo de uma integração de push (ex: `web-push` no Node,
usando VAPID keys) para disparar a notificação no horário exato
(10d/5d/2d/3x no dia — mesma regra da Fase 1, seção 7). Funciona bem no
Android; no iOS exige 16.4+ e o app "adicionado à tela de início".

## Bancos suportados no parser (atualizado)

Nubank, Itaú, Inter, Bradesco, C6 Bank, **Mercado Pago** (débito e
crédito diferenciados pela palavra explícita no corpo da mensagem, além
de Pix e parcelamento).

## O que fica igual, sem mudança nenhuma

Todo o resto do sistema — modelagem de dados (Fase 1), amortização
PRICE/SAC, amortização extraordinária, ajuste manual, backend NestJS
(Fase 3), design system (Fase 5) — independe de a captura ser nativa ou
via PWA. Só a "porta de entrada" do dado mudou.
