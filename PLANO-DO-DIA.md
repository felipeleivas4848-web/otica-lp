# Plano do dia — Ótica com IA (V1)

## O que dá pra ter HOJE (realista)

Uma **V1 navegável e vendável como "acesso antecipado"**:

- App mobile-first bonito, com identidade premium
- Login + 3 perfis (proprietário / gerente / vendedor) + isolamento por organização (RLS)
- **Home completa** + telas núcleo (Leads, Pipeline, Perfil do Lead com timeline, Campanhas, Agenda)
- Base de dados **semente única e consistente** já no Supabase
- IA respondendo sobre esses dados (via Edge Function) — nível 1–3 (mostrar / comparar / diagnosticar)

Com isso você **demonstra pra ótica hoje** e começa a comercializar.

## O que NÃO dá hoje (e está tudo bem)

- Meta Ads / Google Ads / WhatsApp ao vivo → semanas (OAuth, webhooks, homologação)
- Cobrança automática (Stripe) → depois; no começo você cobra manual
- IA nível 4–5 (recomendar / executar campanha) → depois

---

## Blocos do dia

### Bloco 1 — Setup (30–45 min)
- [ ] Criar conta / projeto no **Lovable**
- [ ] Criar projeto no **Supabase**, região **South America (São Paulo)**
- [ ] Conectar Lovable ↔ Supabase
- [ ] No Supabase → SQL Editor → colar e rodar **`supabase-schema.sql`** inteiro
- [ ] Auth do Supabase: em dev, **desligar "Confirm email"** (religar antes de vender)

### Bloco 2 — Fundação (45–60 min)
- [ ] Colar **`PROMPT-MESTRE-LOVABLE.md`** como primeira mensagem no Lovable
- [ ] Deixar ele criar: tema, tokens, biblioteca de componentes, shell + bottom nav
- [ ] Revisar o visual base (respiro, tipografia, cores de status)

### Bloco 3 — Home (2 h)
- [ ] Home bloco a bloco (o prompt já pede na ordem certa)
- [ ] Conferir se os números batem com a semente (18 leads / 14 / 6 / 3 / R$4.280)
- [ ] Ajustar espaçamento e hierarquia até "entendo tudo em segundos"

### Bloco 4 — Telas núcleo (2–3 h) — um prompt por vez
- [ ] Leads + Pipeline (Novo → Em atendimento → Agendado → Compareceu → Venda; + Perdido / Reativação)
- [ ] Perfil do Lead + **Timeline** (usar `lead_interactions`; a jornada da Maria já está semeada)
- [ ] Campanhas + Detalhe da Campanha + Detalhe do Anúncio (atribuição nos dois sentidos)
- [ ] Agenda do dia

### Bloco 5 — Auth + IA (1 h)
- [ ] Tela de Login real (Supabase Auth) + roteamento por `role`
- [ ] Criar seu login → rodar o `UPDATE` do fim do `supabase-schema.sql` com seu e-mail
- [ ] Edge Function `ai-assistant`: recebe pergunta → busca resumo dos dados da organização →
      chama a IA → devolve. **Chave da IA só no servidor (secret da Edge Function).**

### Bloco 6 — Acabamento + publicar (30–60 min)
- [ ] Estados vazio / carregando / erro em tudo
- [ ] Testar em tela de celular real
- [ ] Publicar pelo Lovable → link pra mostrar pra ótica

---

## Ordem dos próximos prompts no Lovable (peça um de cada vez)

1. `PROMPT-MESTRE` → shell + componentes + **Home**
2. "Agora a tela **Leads** + **Pipeline**" (Kanban simples, mobile)
3. "Agora o **Perfil do Lead** com o componente **Timeline** lendo `lead_interactions`"
4. "Agora **Campanhas** + **Detalhe da Campanha** + **Detalhe do Anúncio** com atribuição"
5. "Agora a **Agenda de hoje**"
6. "Agora **Login** real com Supabase Auth e roteamento por `role`"
7. "Agora a **Edge Function da IA** + a tela **✦ IA** + o **Plano de Ação**"
8. "Agora **Equipe** e **Configurações**"

## Regras que valem pra todos os prompts

- Mobile primeiro (~390px). Reutilizar componentes. Não duplicar. Não quebrar telas prontas.
- Não criar/alterar tabelas. Não desligar RLS.
- Nenhuma chave de terceiro no frontend — sempre via Edge Function.
- Sem financeiro / estoque / ERP.
