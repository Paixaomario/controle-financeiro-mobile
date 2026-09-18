# Fase 2 — Integração com mensagens (SMS e notificações)
## Projeto: Controle Financeiro Pessoal (Android nativo)
**Agente responsável:** Integração de Mensagens
**Validado por:** Supervisor de Integração
**Auditado por:** Analista Final (conformidade e política do Google Play)

---

## 1. Objetivo

Capturar automaticamente lançamentos financeiros a partir de SMS e notificações de apps bancários, extrair valor/estabelecimento/local, reconhecer o tipo de lançamento (transação comum, despesa fixa, **financiamento/empréstimo**) e alimentar o app sem exigir digitação manual — mantendo o texto bruto da mensagem **fora do backend**, conforme definido na Fase 1.

---

## 2. Componentes Android

### 2.1 SmsReceiver (BroadcastReceiver)
Escuta `android.provider.Telephony.SMS_RECEIVED`. Roda em background, processa o corpo da mensagem localmente e descarta o texto original após extrair os dados estruturados.

### 2.2 BankNotificationListenerService (NotificationListenerService)
Captura notificações de apps bancários instalados (Nubank, Itaú, Bradesco, Inter, C6, etc.), filtrando por `packageName` de uma lista de instituições suportadas. Necessário porque muitos bancos hoje notificam em vez de mandar SMS.

### 2.3 Fluxo de permissões (obrigatório antes de qualquer captura)
1. Tela de onboarding explica claramente o que será lido e por quê.
2. Consentimento explícito e separado (não pode estar embutido no aceite geral de termos) — grava `smsConsentAt` e `smsConsentVersion` no `User` (Fase 1).
3. Só então o app solicita `READ_SMS`, `RECEIVE_SMS` e o acesso especial de notificações (`BIND_NOTIFICATION_LISTENER_SERVICE`, concedido manualmente pelo usuário nas configurações do Android — não é um runtime permission comum).
4. Usuário pode revogar a qualquer momento em Configurações → Privacidade, o que interrompe a captura e oferece apagar o histórico auto-capturado (exigência já definida no parecer LGPD da Fase 1).

---

## 3. Pipeline de processamento (100% local até virar dado estruturado)

```
SMS/Notificação recebida
   → Filtro por remetente/pacote conhecido (lista de bancos suportados)
   → Parser por regex/template (rápido, cobre ~80% dos casos comuns)
   → Se o template não reconhecer com confiança alta → chamada à IA (Claude API)
      apenas com o texto da mensagem, sem se persistir localmente após a resposta
   → Resultado estruturado: { tipo, valor, estabelecimento, cidade, data, categoria_sugerida, é_financiamento }
   → Se é_financiamento = true → abre tela de cadastro de Loan pré-preenchida (Fase 1)
   → Senão → cria Transaction (source = SMS ou NOTIFICATION) com sourceConfidence
   → Usuário pode revisar/corrigir → correção alimenta o parser (fine-tuning de regras locais)
```

### 3.1 Reconhecimento de financiamento/empréstimo
Camada adicional de regras que roda sobre o resultado do parser, buscando sinais como:
- Palavras-chave: "financiamento", "empréstimo", "consignado", "parcela X/Y", "parcela X de Y"
- Padrão numérico de parcelamento no corpo da mensagem
- Recorrência: mesmo valor, mesmo remetente, mesmo dia do mês, se repetindo — mesmo sem palavra-chave explícita, o sistema sinaliza como "possível financiamento" e sugere ao usuário confirmar

Quando confirmado, dispara a criação do `Loan` + geração automática de todas as `LoanInstallment` futuras, exatamente como mostrado na tela de cadastro.

---

## 4. Templates por banco (exemplos de estrutura, sem reproduzir textos reais de SMS)

Cada banco tem um `SmsParsingRule` com um padrão de captura de: valor, tipo de operação (compra/pix/débito/crédito), e quando disponível, estabelecimento e parcela. A tabela de regras fica no backend só para distribuição/atualização — nunca recebe o conteúdo das mensagens dos usuários, apenas os templates genéricos mantidos pela equipe.

| Banco | Cobertura inicial |
|---|---|
| Nubank | Compra no cartão, Pix, fatura |
| Itaú | Compra no cartão, débito automático |
| Bradesco | Compra no cartão, Pix |
| Inter | Compra no cartão, Pix, empréstimo |
| C6 Bank | Compra no cartão, Pix |

---

## 5. Testes obrigatórios antes de avançar

- Precisão do parser ≥ 90% nos 5 bancos listados, medida com massa de teste anonimizada (mensagens sintéticas, não reais de usuários).
- Latência de processamento local < 500ms por mensagem, para não impactar bateria/performance.
- Teste de revogação de permissão em tempo real (app precisa parar de capturar imediatamente).
- Teste do fluxo de financiamento: mensagem de parcela detectada → tela pré-preenchida → confirmação → 45+ parcelas futuras geradas corretamente no orçamento.

---

## 6. Verificação de pagamento de parcelas via SMS

Além de detectar novos lançamentos, o parser da Fase 2 monitora SMS/notificações de **confirmação de pagamento** para conciliar com uma `LoanInstallment` (financiamento, empréstimo, carnê, fatura parcelada ou compra de loja) que esteja `PENDING`.

### 6.1 O que é extraído de cada mensagem de pagamento
- **Valor pago**
- **Forma de pagamento**: débito, crédito, Pix ou boleto — identificado por palavras-chave típicas de cada tipo de mensagem (ex: mensagens de Pix têm estrutura diferente de mensagens de compra no débito/crédito)
- **Banco/instituição usada para pagar** (`bankUsed`) — normalmente identificável pelo remetente do SMS ou pelo app de origem da notificação
- **Nome do estabelecimento/credor exatamente como aparece na mensagem** (`merchantNameFromSms`) — guardado para o usuário conferir contra o `Loan` cadastrado, já que o nome que aparece no SMS às vezes difere do nome popular da loja/financeira

### 6.2 Lógica de conciliação
1. Sistema busca `LoanInstallment` do usuário com status `PENDING`, `dueDate` próxima (janela de ±5 dias) e `amountCents` compatível com o valor da mensagem.
2. Se encontrar correspondência única → concilia automaticamente: preenche `paymentMethod`, `bankUsed`, `merchantNameFromSms`, `paidAt`, aciona o `AmortizationService` (Fase 1, seção 5) para calcular `discountCents`/`interestCents` finais, muda status para `PAID`.
3. Se encontrar mais de uma correspondência possível ou nenhuma com confiança suficiente → notifica o usuário para confirmar manualmente qual parcela foi paga, mostrando a mensagem já interpretada (nunca o texto bruto armazenado, só o resultado extraído).
4. Todo esse processamento e a comparação de candidatos rodam localmente no aparelho — o backend só recebe o resultado final da conciliação.

## 7. Parecer do Supervisor de Integração

Pipeline aprovado com uma exigência: a chamada à IA (Claude API) para os casos de baixa confiança do parser deve rodar por um proxy no backend, nunca com a chave de API embutida no app — mesmo enviando só o texto da mensagem pontualmente, a chave nunca pode estar no cliente Android (risco de engenharia reversa do APK).

## 8. Parecer do Analista Final (Google Play / conformidade)

Dois pontos que bloqueiam a publicação se não forem atendidos:
1. Declaração obrigatória no Play Console justificando o uso de `READ_SMS` e `BIND_NOTIFICATION_LISTENER_SERVICE` como funcionalidade **essencial** do app (categoria "gerenciador financeiro pessoal" é aceita, mas precisa de vídeo demonstrativo no processo de revisão).
2. Política de privacidade pública, linkada dentro do app, detalhando exatamente o que é lido, o que é enviado ao servidor (nunca o texto bruto) e como revogar/apagar.
