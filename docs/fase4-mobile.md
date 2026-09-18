# Fase 4 — Mobile (Android nativo)
## Projeto: Controle Financeiro Pessoal (Android nativo)
**Agente responsável:** Mobile
**Validado por:** Supervisor de Mobile
**Auditado por:** Analista Final (performance e acessibilidade)

---

## 1. Stack e princípios

- **Kotlin + Jetpack Compose**, Material 3 como base, sobrescrito pelos tokens visuais da Fase 5 (dark-only, verde/vermelho semânticos).
- **Arquitetura MVI** por tela: `State` imutável, `Intent`/`Event` de UI, `ViewModel` como única fonte de verdade, repositórios como fronteira com API/armazenamento local.
- **Valores monetários como `String` (centavos) em todo o transporte** — nunca `Double`/`Float`. Na camada de domínio, convertidos para `java.math.BigDecimal` só no momento de exibição formatada em R$, nunca para cálculo. Cálculo de amortização em si acontece só no backend (Fase 3); o app apenas exibe o resultado.
- **Offline-first parcial**: leitura de extrato/dashboard funciona com cache local (Room), mas lançamentos e conciliações exigem conectividade — dado financeiro sincronizado não é gravado otimisticamente sem confirmação do backend, ao contrário do padrão "optimistic update" usado no projeto anterior (lá o risco era menor; aqui envolve amortização e juros, então a fonte de verdade é sempre o backend).

---

## 2. Estrutura de telas (Navigation Compose)

```
Onboarding
 └─ Consentimento de leitura de SMS/notificações (Fase 2, obrigatório e separado)
 └─ Concessão de permissões (READ_SMS, RECEIVE_SMS, acesso a notificações)

Dashboard (Home)
Extrato
Cartões
Orçamento
Financiamentos
 ├─ Cadastro (com escolha PRICE/SAC)
 ├─ Demonstrativo de amortização
 └─ Amortização extraordinária (input de números de parcela)
Investimentos
 ├─ Cadastro (valor + instituição)
 └─ Resumo por instituição/tipo
Configurações
 ├─ Privacidade (revogar consentimento, apagar histórico auto-capturado)
 └─ Horários de aviso (personalizar os 3 horários do dia de vencimento)
```

Todas as telas já validadas visualmente nas fases anteriores servem de referência direta de implementação — dashboard, extrato, cartões, orçamento, cadastro de financiamento v2, demonstrativo de amortização, popup de vencimento e amortização extraordinária.

---

## 3. Componentes nativos críticos (ligados à Fase 2)

### 3.1 SmsReceiver + BankNotificationListenerService
Implementados como `BroadcastReceiver`/`NotificationListenerService` de acordo com a Fase 2, rodando o parser local (módulo Kotlin puro, sem dependência de UI, testável isoladamente).

### 3.2 Agendamento de avisos (WorkManager + AlarmManager)
Ao sincronizar `PaymentReminder` do backend, o app agenda `AlarmManager.setExactAndAllowWhileIdle()` para cada `scheduledFor` — os 4 avisos (10d, 5d, 2d, dia) mais os 3 horários do dia do vencimento. Um `WorkManager` periódico (a cada 6h) resincroniza para pegar avisos novos/cancelados sem depender só do FCM.

### 3.3 Popup de vencimento
Renderizado como notificação nativa Android (heads-up quando app em foreground, notificação padrão quando em background) — o mockup da Fase 1 é a referência visual para o layout customizado da notificação (ícone, título, corpo, ação "Ver parcela").

---

## 4. Telas com input crítico de precisão

- **Cadastro de financiamento/investimento**: campo de valor usa teclado numérico "cents-first" (mesmo padrão Nubank/Uber já validado no projeto anterior), evitando qualquer digitação que produza ponto flutuante — o usuário digita centavos da direita para a esquerda, sem separador decimal manual.
- **Ajuste manual de valor pago**: mesmo componente de teclado, com exibição lado a lado do "valor calculado" (`originalCalculatedCents`) vs. campo editável, para o usuário nunca perder a referência do que o sistema havia previsto.
- **Amortização extraordinária**: campo de texto livre para números de parcela (`15-20` ou `15,16,18`), validado localmente antes de enviar ao backend — regex simples que aceita intervalo ou lista, rejeita caracteres inválidos com mensagem inline, sem travar a tela.

---

## 5. Testes obrigatórios antes de avançar

- Teste de UI (Compose Test) para os 3 componentes de input acima, garantindo que nenhum valor exibido perde precisão na conversão `String` → `BigDecimal` → formatação R$.
- Teste de bateria/performance do `NotificationListenerService` rodando em background por 24h contínuas (Android é agressivo com serviços em background; precisa de `foreground service` leve ou `WorkManager` para sobreviver ao Doze mode).
- Teste de acessibilidade: contraste mínimo AA no modo dark (já usando os tokens da Fase 5), navegação por leitor de tela nas telas de financiamento (input crítico não pode depender só de cor para indicar erro).
- Teste de revogação de permissão em runtime — app precisa detectar e parar captura imediatamente, sem crash.

---

## 6. Parecer do Supervisor de Mobile

Aprovado com uma ressalva: o teclado "cents-first" precisa de um modo de entrada alternativo (colar valor copiado, ex: de um boleto) — obrigar sempre a digitação dígito a dígito pode ser lento para cadastro de financiamento com muitas casas decimais grandes (ex: financiamento de imóvel).

## 7. Parecer do Analista Final (performance e acessibilidade)

Aprovado com uma exigência: o `NotificationListenerService` e o `SmsReceiver` precisam de indicador visual persistente e discreto (ex: ícone fixo na barra de status ou linha no card de configurações) mostrando que a captura está ativa — transparência contínua com o usuário sobre quando o app está lendo suas mensagens, não só no momento do consentimento inicial.
