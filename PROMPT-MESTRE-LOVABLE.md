# PROMPT MESTRE — ÓTICA COM IA (colar no Lovable)

> Cole este texto inteiro como a **primeira mensagem** do projeto no Lovable, depois de já ter
> conectado o Supabase e rodado o `supabase-schema.sql`.

---

## Contexto do produto

Estou construindo um SaaS mobile-first para **óticas** chamado **Ótica com IA**.
Não é um CRM, não é um dashboard, não é um ERP. É uma **central inteligente de crescimento**:
o dono da ótica abre o celular e em segundos entende **como está a operação, onde está o
problema e o que fazer agora**.

O produto cobre um único ciclo, que é a espinha dorsal:
**campanha → anúncio → lead → atendimento → agendamento → comparecimento → venda (ou perda) → resultado volta pra campanha.**

O ativo central é o **histórico completo do lead** (de onde veio, qual campanha/anúncio, quem
atendeu, quanto demorou, o que comprou, por que não comprou).

## Regras invioláveis

1. **Mobile-first de verdade.** Projete primeiro para ~390px. Depois tablet, depois desktop.
   Nunca desenhe desktop e comprima.
2. **Multi-tenant.** Todo dado pertence a uma `organization`. Nunca mostrar dado de uma
   organização para outra. As policies de RLS já cuidam disso — **não desative RLS**.
3. **Nada de financeiro, estoque, DRE, contas a pagar/receber, ERP.** Fora do escopo.
4. **A IA nunca é um chatbot solto.** Ela sempre trabalha sobre os dados reais da operação.
5. **Toda tela de alerta segue: ALERTA → CONTEXTO → AÇÃO.** Nunca um alerta sem botão de ação.
6. **Menos é mais.** Bastante respiro, hierarquia tipográfica forte, números importantes
   grandes, textos curtos. Sem dezenas de gráficos, sem cards demais.

## Stack

- Use a stack padrão do Lovable: **React + Vite + TypeScript + Tailwind + shadcn/ui**.
- **Supabase já está conectado** e o schema já existe (tabelas, enums, RLS, dados semente).
  **Não crie nem altere tabelas. Não rode migrações.** Apenas leia o schema existente e
  gere os tipos TypeScript a partir dele.
- Autenticação: **Supabase Auth (e-mail/senha)**. O perfil e o papel do usuário ficam na
  tabela `profiles` (`role`: `proprietario` | `gerente` | `vendedor`).
- Toda leitura de dados é via cliente Supabase, respeitando RLS. Nada de dado hard-coded no
  React — os dados de demonstração já estão no banco.

## Banco de dados (já criado — só consumir)

Entidades principais: `organizations`, `stores`, `profiles`, `sellers`, `campaigns`,
`ad_sets`, `ads`, `creatives`, `products`, `leads`, `lead_interactions`, `appointments`,
`sales`, `sale_items`, `ai_insights`, `tasks`.

- `leads` tem a atribuição completa (`campaign_id`, `ad_set_id`, `ad_id`, `assigned_seller_id`,
  `status`, `temperature`, `lead_score`, `first_response_seconds`, `next_action`, etc.).
- `lead_interactions` é a **linha do tempo** do lead (componente `Timeline`).
- `ai_insights` alimenta os blocos de IA (campo `scope`: `home`, `funil`, `campanha`, ...).
- `tasks` alimenta o **Plano de Ação** (`priority`: `urgente`/`importante`/`oportunidade`/`followup`).

Para os números de "hoje", filtre por `created_at`/`sold_at`/`scheduled_at` no dia atual.

## Design system

Crie tokens no `tailwind.config` e um tema claro (dark depois). Direção: **premium,
inteligente, simples, confiável, moderno, humano.** Evite cara de CRM/ERP, neon, cyberpunk,
gradientes exagerados.

- **Cores de status:** verde `#16a34a` (indo bem), âmbar `#d97706` (atenção), vermelho
  `#dc2626` (problema). Base neutra em cinzas quentes. 1 cor de marca sóbria (azul-petróleo
  `#0f766e` ou índigo discreto) para ações/acentos da IA.
- **Tipografia:** Inter. Escala com contraste forte: número-herói ~40/48px bold, título de
  seção ~18px semibold, corpo 14–15px, legenda 12px.
- **Espaçamento:** base 4px; respiro generoso entre blocos (24–32px).
- **Cartões:** cantos 16px, sombra muito sutil, borda 1px cinza-claro.
- **Ícone da IA:** um selo discreto `✦` antes de textos gerados por IA.

## Componentes reutilizáveis (crie a biblioteca antes das telas)

`AppHeader`, `BottomNavigation`, `StatusCard`, `MetricCard`, `AttentionCard`, `FunnelCard`,
`CampaignCard`, `LeadCard`, `LeadScoreBadge`, `AppointmentCard`, `AIInsightCard`, `ActionCard`,
`SellerCard`, `Timeline`, `EmptyState`, `LoadingState`, `ErrorState`, `FilterBar`, `SearchBar`.

Todos com estados de **loading**, **vazio** e **erro** previstos.

## Navegação

Bottom navigation fixo (mobile): **Home · Leads · ✦ IA · Campanhas · Mais**.
Dentro de "Mais": Agenda, Equipe, Relatórios, Configurações (Criativos e Ofertas ficam
visíveis como "em breve").

---

## TAREFA DESTA PRIMEIRA EXECUÇÃO

**Construa SOMENTE a tela HOME (mobile), consumindo os dados reais do Supabase**, mais o
shell do app (layout + bottom navigation + tema + biblioteca de componentes base).

Não construa as outras telas agora. Não implemente integrações externas (Meta, WhatsApp,
Google, Stripe). Login pode ficar como uma rota placeholder simples por enquanto.

### Blocos da Home, nesta ordem exata

1. **Header** — "Bom dia, {nome} 👋", nome da ótica + unidade, ícones de notificação e perfil.
2. **Status do dia** (`StatusCard`) — semáforo (🟢/🟡/🔴) + frase ("Estamos indo bem"),
   contadores do dia: leads recebidos, atendidos, agendamentos, vendas. Linha destacada
   ("Existem N leads aguardando primeiro atendimento") + botão **"Ver o que precisa de atenção"**.
3. **Precisa da sua atenção** — lista de `AttentionCard` (leads sem atendimento, leads muito
   quentes aguardando, agendamentos não confirmados, follow-ups). Cada um: ícone + contexto +
   botão de ação. Deriva de `leads`, `appointments`, `tasks`.
4. **Funil de hoje** (`FunnelCard`) — Leads → Atendidos → Agendados → Compareceram → Vendas,
   com a conversão Lead→Venda em %.
5. **✦ Análise da IA sobre o funil** (`AIInsightCard`, `scope = 'funil'` ou `'home'`) — texto
   curto apontando o gargalo + botão de ação.
6. **Campanhas ativas** — `CampaignCard` por campanha: nome, status, canal, investido,
   leads, CPL, agendamentos, vendas. Marcar "✦ Melhor campanha do dia" e "⚠️ CPL acima da média".
7. **Leads prioritários** — `LeadCard` dos leads que merecem atenção (não os mais recentes):
   nome, produto de interesse, `LeadScoreBadge` (temperatura), tempo aguardando, campanha,
   responsável, botão de ação.
8. **Agenda de hoje** — `AppointmentCard` por horário: hora, nome, status
   (compareceu/confirmado/aguardando/não confirmou). Insight da IA sobre quem não confirmou.
9. **Resultado comercial de hoje** — vendas, valor vendido, ticket médio, produtos vendidos,
   linha "X das Y vendas vieram de campanhas pagas". **Sem módulo financeiro.**
10. **✦ Resumo da IA** (`AIInsightCard`, `scope = 'home'`) — parágrafo curto + botão
    **"Ver plano de ação"**.
11. **Bottom navigation**.

### Critério de sucesso

Ao abrir a Home no celular, um dono de ótica precisa sentir *"entendo minha operação inteira
em poucos segundos"* — e não *"lá vem mais um dashboard de agência"*.

Quando terminar a Home, **pare e me mostre**. As próximas telas eu peço uma a uma.
