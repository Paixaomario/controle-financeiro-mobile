# Fase 5 — Design System consolidado
## Projeto: Controle Financeiro Pessoal (Android nativo)
**Agente responsável:** Design (padrão AAA)
**Validado por:** Supervisor de Design
**Auditado por:** Analista Final (checklist de UI)

Este documento formaliza os tokens visuais já aplicados em todas as telas de prévia validadas nas fases anteriores (dashboard, extrato, cartões, orçamento, financiamento, demonstrativo, popup de vencimento, amortização extraordinária).

---

## 1. Princípio central

**Modo dark é o único modo do app** — não é um tema alternável, é a identidade visual. Estética de "mercado financeiro": superfícies quase pretas, cartões com leve gradiente metálico, tipografia técnica, cor com função (nunca decorativa).

---

## 2. Paleta de cores

| Token | Hex | Uso |
|---|---|---|
| `bg-base` | `#0B0D0F` | Fundo geral do app |
| `bg-card` | `#12151A` | Cards, listas, superfícies elevadas |
| `border-default` | `#23262B` | Bordas de card, divisores |
| `border-subtle` | `#1D2026` | Divisores internos de lista |
| `text-primary` | `#F2F3F5` | Texto principal |
| `text-secondary` | `#8A8F98` | Rótulos, texto de apoio |
| `text-muted` | `#5B6069` | Metadados, timestamps |
| `income-green` | `#97C459` / `#5DCAA5` | **Entradas** — valor positivo, saldo, confirmação |
| `expense-red` | `#F09595` | **Saídas** — valor negativo, alerta de estouro |
| `warning-amber` | `#EF9F27` | Avisos de vencimento no dia, orçamento no limite |

**Regra fixa de cor**: verde = dinheiro entrando ou dentro do previsto. Vermelho = dinheiro saindo. Âmbar = atenção/vencimento iminente, nunca usado para saída comum (evita poluir o vermelho semântico de "saída" com o de "alerta"). Nenhuma outra cor de destaque é usada — sem azul, roxo ou rosa decorativos, para manter a leitura financeira limpa.

---

## 3. Tipografia

- Fonte do sistema (Roboto no Android), sem serifa — reforça o tom técnico/financeiro.
- Pesos: **400 regular** para corpo, **500 medium** para valores e títulos — nunca bold 700 (evita peso visual excessivo em uma tela com muitos números).
- Hierarquia numérica: valor de destaque (saldo, total) em 24–28px; valores de linha (transação individual) em 12,5–15px; metadados em 10–11px.
- Valores monetários sempre com o símbolo R$ e duas casas decimais na exibição — mesmo que o dado subjacente nunca arredonde (Fase 1), a formatação de tela é só cosmética.

---

## 4. Iconografia

Tabler Icons, variante **outline** exclusivamente (nunca filled) — consistente com a estética técnica e linear do "mercado financeiro". Ícones semânticos fixos:
- `arrow-up-right` → entrada
- `arrow-down-right` → saída
- `message-2` → lançamento capturado via SMS/notificação (selo de rastreabilidade, usado em todas as telas onde isso é relevante)
- `bell` → aviso de vencimento
- `credit-card` → cartões e financiamentos

---

## 5. Componentes reutilizáveis

| Componente | Onde aparece | Regra |
|---|---|---|
| Metric card | Dashboard, cartões, orçamento | `bg-card`, borda sutil, label 10–11px acima, valor 15–16px abaixo |
| Transaction row | Extrato, dashboard | Ícone circular colorido por categoria + verde/vermelho no valor à direita |
| Card financeiro (gradiente) | Cartões, financiamentos | Gradiente sutil 100° combinando com a cor semântica do contexto (verde para cartão saudável, vermelho para fatura alta) |
| Progress bar | Orçamento, cartões, demonstrativo | 4–6px de altura, cor muda conforme limite (verde até ~85%, âmbar acima) |
| Badge de origem | Qualquer lançamento auto-capturado | Ícone `message-2` pequeno, sem texto, ao lado do nome do estabelecimento |
| Bottom nav | Todas as telas principais | 5 itens, ação central destacada (`+`) em verde sólido |

---

## 6. Acessibilidade (AAA)

- Contraste mínimo AA/AAA verificado entre `text-primary` sobre `bg-card` e `bg-base`.
- Nenhuma informação crítica (status de parcela, alerta de estouro de orçamento) depende só de cor — sempre acompanhada de ícone ou texto (ex: parcela `OVERDUE` tem ícone de alerta, não só borda vermelha).
- Áreas de toque mínimas de 44×44dp em todos os elementos interativos, mesmo nos ícones compactos da bottom nav.

---

## 7. Parecer do Supervisor de Design

Sistema aprovado como consistente em todas as 8 telas já prototipadas. Ressalva: formalizar os tokens acima como `Color.kt`/`Type.kt` no Compose antes da Fase 4 começar a implementação, para nenhum agente de mobile "reinventar" um verde ou cinza levemente diferente tela a tela.

## 8. Parecer do Analista Final (checklist de UI)

Aprovado. Checklist de saída para cada tela nova a partir daqui: (1) usa só os tokens desta tabela, (2) verde restrito a entrada/positivo, vermelho restrito a saída/negativo, âmbar restrito a alerta, (3) nenhum texto abaixo de 10px, (4) ícones sempre outline.
