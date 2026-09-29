# Integração Kommo CRM + N8N + Meta CAPI + GTM — Ótica com IA

> Documento de planejamento (SEM segredos/tokens — esses ficam em `integracoes/.env.secrets`,
> que é ignorado pelo git). Este arquivo pode ser versionado normalmente.

## Objetivo

Fechar o loop de rastreamento: **Landing Page → Kommo CRM → N8N → Meta Conversions API (CAPI)**,
com correspondência avançada (Advanced Matching), + Google Tag Manager no site.
O Pixel do Meta **não** deve ser colocado dentro do GTM — o rastreamento para o Meta deve ser
feito via API (CAPI/N8N), com o máximo de correspondência possível (usando inclusive o token
de acesso do Meta).

## Status atual (2026-09-14)

- [x] Chave de API do N8N recebida e salva em `.env.secrets` (`N8N_API_KEY`).
- [x] Etapas do pipeline "Leivadz" (id 13923191) ajustadas via API: Contato Inicial (20),
      ATENDIMENTO HUMANO mantida (30), Qualificado (40), Call agendada (50), Proposta Enviada
      (60), FOLLOW (70). Nenhum lead foi movido/apagado.
  - Efeito colateral (visual, baixo risco): as 6 etapas customizadas ficaram todas com a mesma
    cor (amarelo claro `#fffeb2`) — a API rejeitou reaplicar as cores originais. Ajuste manual
    opcional na UI se quiser cores diferentes por etapa.
  - **Limitação da API:** as etapas fixas "Fechado - ganho" (id 142) e "Fechado - perdido"
    (id 143) não podem ser renomeadas via API do Kommo (retorna erro `NotSupportedChoice` no
    campo `id`). Se o usuário quiser "FECHADO - GANHO"/"FECHADO - PERDIDO" em maiúsculas, só
    dá pra fazer manualmente na tela do Kommo.
  - **Cuidado técnico aprendido:** o endpoint `PATCH /leads/pipelines/{id}/statuses/{status_id}`
    NÃO faz merge parcial de verdade — enviar só `{"sort": N}` sem `name` apagou o nome da etapa
    (ficou `""`). Sempre enviar `name` + `sort` + `color` juntos nesse endpoint.
- [x] Campos customizados de Lead criados (FB Lead ID, País, FBP, Client IP Address, Client User
      Agent, Event ID) — UTMs/GCLID/FBCLID reaproveitados de campos que já existiam na conta.
      Ver IDs na seção "Campos de lead necessários no Kommo" abaixo.
- [x] Usuário confirmou que colou os webhooks 3 e 4 nas etapas "Qualificado" e "FECHADO - GANHO"
      do Kommo.
- [x] Os 4 fluxos do N8N foram construídos, **ativados** e **testados de ponta a ponta** em
      2026-09-14 — todos com execução `success` e o Meta confirmando `events_received: 1` pros
      4 eventos (Lead, Subscribe, QualifiedLead, Purchase). Bugs encontrados e corrigidos durante
      o teste: (1) `require('crypto')` é bloqueado no sandbox do N8N — troquei por uma
      implementação de SHA-256 em JS puro (validada byte a byte contra o `crypto` do Node); (2) a
      opção `fullResponse` do node HTTP Request precisa ser `true` nessa versão do n8n, senão o
      node quebra; (3) o node IF exige tipo `string` estrito — o id do contato precisa ser
      convertido com `String()` antes de comparar.
- [ ] Falta: apagar manualmente o lead/contato de teste "TESTE INTEGRACAO - APAGAR" no Kommo (a
      API não permite deletar via DELETE, só pela tela — dá erro 405).
- [x] Site finalizado em 2026-09-14: GTM (`GTM-P85Z4D55`) e Meta Pixel (`1718677262582293`, fora
      do GTM, direto no HTML como pedido) instalados no `<head>`/`<body>` de `index.html` e
      `obrigado.html`. `assets/script.js` ganhou: captura de UTMs/fbclid da URL (guardados em
      `sessionStorage` pra sobreviver à navegação até o formulário), leitura do cookie `_fbp`,
      geração de `event_id` por envio, chamada direta (client-side) pros Webhooks 1 e 2 do N8N,
      e disparo do Pixel no navegador (`Lead` no form principal, `Subscribe` no popup,
      `ViewContent` a cada carregamento de página) — sempre com o mesmo `event_id` do envio ao
      servidor, para o Meta deduplicar client x server.
- [x] **Google Sheets removido** (a pedido do usuário em 2026-09-14): o formulário principal e o
      popup de newsletter não mandam mais nada pro Apps Script/planilha — só pros webhooks do
      N8N. `SHEETS_ENDPOINT` e o código relacionado foram apagados de `assets/script.js`. O
      `apps-script/Codigo.gs` e a documentação da planilha no `README-LP.md` continuam no repo
      como histórico, mas não são mais usados pelo site.
      ViewContent via N8N/CAPI (servidor) não foi criado — ficou só client-side por enquanto,
      que já cobre bem esse tipo de evento; avisar se quiser o webhook 5 também.
- [x] Usuário criou a Conversão Personalizada no Gerenciador de Anúncios (nome dado por ele:
      "qualificaleads"), mapeada para o evento **QualifiedLead**.
- [x] Site publicado em produção (oticacomia.com.br, domínio GoDaddy + Netlify) com as mudanças
      de tracking, e **validado com dado real de ponta a ponta em 2026-09-14**: formulário
      principal (lead 21409690 criado no Kommo, evento `Lead` confirmado pelo Meta) e popup de
      newsletter (evento `Subscribe` confirmado) testados no site ao vivo pelo navegador; o
      usuário moveu o lead 21409690 de verdade no Kommo (Qualificado → FECHADO - GANHO) e os
      webhooks 3/4 dispararam com o payload real do Kommo — bateu exatamente com o formato
      clássico (`leads[status][0][id]` etc.) que a lógica do N8N já esperava. Meta confirmou
      `QualifiedLead` e `Purchase`. **Integração liberada para ativar campanha no Meta Ads.**
      Pendência de limpeza (não bloqueia nada): apagar/perder manualmente no Kommo os leads de
      teste "TESTE INTEGRACAO - APAGAR" e "Ótica Teste Verificação - Teste Verificação" (esse
      último ficou como "FECHADO - GANHO" fake e vai distorcer relatório de vendas se não corrigir).

## Fluxos do N8N (construídos em 2026-09-14)

Todos em `https://n8n-n8n-start.uqrrdf.easypanel.host`, usando a credencial Kommo já existente
na conta ("2.0 Kommo N8n", OAuth2) e chamando o Meta Graph API diretamente com o access token
(guardado em `.env.secrets`, nunca em texto puro nos arquivos deste repositório).

**WEBHOOK 1 — `WEBHOOK 1 -> LEAD LP P/CRM`** (id `a2bbaFPPSGr668wc`)
Recebe o POST do formulário principal da LP → busca contato existente pelo WhatsApp → cria
contato se não existir → cria Lead na etapa "Contato Inicial" com UTMs/fbclid/fbp/IP/UA/event_id
→ dispara evento Meta CAPI `Lead` (action_source `website`, com fbc/fbp/IP/UA/telefone
hasheado). Espera um JSON body com: `nome, otica, cidade, estado, whatsapp, cargo, ja_investe,
faturamento, investimento_mensal, objetivo, inicio, utm_source, utm_medium, utm_campaign,
utm_content, utm_term, fbclid, fbp, event_id`. IP e User-Agent são lidos automaticamente dos
headers da requisição (por isso o site precisa chamar esse webhook direto do navegador, não por
um proxy/servidor).

**WEBHOOK 2 — `WEBHOOK 2 -> LEAD Newsletter P/CRM`** (id `B3xP11PIg5tH9Ust`)
Mesma lógica do Webhook 1, mas para o popup de e-mail: busca/cria contato pelo e-mail, cria Lead
na etapa "Incoming leads" (não existe etapa específica de newsletter no funil combinado — ajustar
se quiser outra etapa) e dispara evento Meta CAPI `Subscribe`. Espera: `email, utm_source,
utm_medium, utm_campaign, utm_content, utm_term, fbclid, fbp, event_id`.

**WEBHOOK 3 — `WEBHOOK 3 -> LEAD Qualificado do CRM P/METADS`** (id `ngvGeBjLxc7Y2HxY`)
Acionado pelo Kommo quando o lead entra na etapa "Qualificado". Extrai o `lead_id` do payload do
Kommo (aceita tanto o formato clássico `leads[status][0][id]` quanto JSON), busca o lead e o
contato vinculado via API do Kommo, monta `user_data` (telefone/e-mail hasheados SHA-256, fbc a
partir do fbclid salvo, fbp, IP, User-Agent, external_id) e envia pro Meta CAPI o evento
customizado **`QualifiedLead`** (`action_source: system_generated`, com `event_id` fixo
`lead_{id}_qualified` pra deduplicar em caso de reprocessamento).
**Pendência do usuário:** criar a Conversão Personalizada "QualifiedLead" no Gerenciador de
Anúncios pra poder usar esse evento em otimização de campanha.

**WEBHOOK 4 — `WEBHOOK 4 -> Vendas feitas do CRM P/META`** (id `Ki8vo9ueV1aGS9lX`)
Igual ao Webhook 3, mas acionado na etapa "FECHADO - GANHO" e envia o evento padrão **`Purchase`**
pro Meta CAPI, com `value` = campo `price` do Lead no Kommo e `currency: BRL`. `event_id`:
`lead_{id}_purchase`.

**Limitações conhecidas / pontos de atenção:**
- `fbc` é remontado no momento do envio usando a hora atual (não a hora real do clique) — reduz
  um pouco a qualidade do match, mas é a única forma sem guardar o timestamp original do clique.
- Números de telefone são normalizados assumindo Brasil (adiciona `55` na frente se tiver 10-11
  dígitos) antes de hashear.
- Os fluxos 1 e 2 assumem que o navegador do visitante chama o webhook do N8N **diretamente**
  (fetch do lado do cliente), pra capturar IP e User-Agent reais nos headers da requisição.
- Nenhum fluxo foi testado com execução real ainda — recomendado testar antes de ativar em
  produção.

## Ordem de execução combinada com o usuário

1. Acessar o Kommo e garantir que existem as etapas do funil (ver abaixo) + os campos de lead
   necessários para Advanced Matching (FB Lead ID, País, e demais parâmetros do Meta CAPI).
2. **Aguardar o usuário confirmar** que colou manualmente os webhooks 3 e 4 (abaixo) nas etapas
   corretas do Kommo (ele faz isso na interface do Kommo, não eu).
3. Só depois disso: entrar no N8N e construir os fluxos que recebem esses webhooks e mandam o
   evento certo pro Meta (Lead qualificado / Venda).
4. Finalizar o envio dos leads do site: webhook 1 (formulário principal) e webhook 2
   (newsletter) → N8N → cadastro de contato + lead no Kommo, com todas as UTMs e parâmetros.
5. Implementar no site: GTM (head + body/noscript) e o rastreamento via CAPI/N8N (ViewContent,
   Lead, Inscrição) — sem duplicar o Pixel dentro do GTM.

## Etapas do funil (Kommo)

1. Contato Inicial
2. Qualificado
3. Call agendada
4. Proposta Enviada
5. FOLLOW
6. FECHADO - GANHO
7. FECHADO - PERDIDO

## Eventos de conversão mapeados para o Meta Ads

| Evento Meta | Etapa correspondente no Kommo | Webhook (ver `.env.secrets`) |
|---|---|---|
| Lead qualificado | Qualificado | Webhook 3 |
| Venda feita | FECHADO - GANHO | Webhook 4 |

## Webhooks do site → N8N

| Origem | Ação esperada | Webhook |
|---|---|---|
| Formulário principal da LP | Capturar lead + todas as UTMs → criar contato e lead no Kommo com os parâmetros necessários pro Meta | Webhook 1 |
| Formulário de newsletter (popup de e-mail) | Capturar lead + parâmetros → criar contato/lead no Kommo | Webhook 2 |

## Campos de lead necessários no Kommo (Advanced Matching / CAPI)

**Status: criado em 2026-09-14.** Esta conta do Kommo já é usada por outras campanhas/clientes
do usuário e já trazia campos padrão de rastreamento — reaproveitados, não duplicados:

| Campo | Field ID | Origem |
|---|---|---|
| UTM Source | 646664 | já existia (padrão da conta) |
| UTM Medium | 646660 | já existia |
| UTM Campaign | 646662 | já existia |
| UTM Content | 646658 | já existia |
| UTM Term | 646666 | já existia |
| Referrer | 646670 | já existia |
| GCLID | 646674 | já existia |
| **FBCLID** (usar como base do `fbc` no envio pro CAPI) | 646676 | já existia |
| FB Lead ID | **1140982** | criado agora |
| País | **1140984** | criado agora |
| FBP (Facebook Browser ID) | **1140986** | criado agora |
| Client IP Address | **1140988** | criado agora |
| Client User Agent | **1140990** | criado agora |
| Event ID | **1140992** | criado agora |

O `fbc` que o Meta CAPI espera tem o formato `fb.1.<timestamp>.<fbclid>` — o N8N deve montar essa
string a partir do campo `fbclid` (646676) na hora de enviar pro CAPI, não precisa de um campo
Kommo separado pra isso.

Campos do formulário (nome, ótica, cidade, estado, cargo, já investe, faturamento, investimento
mensal, objetivo, quando pretende começar) — ainda **não** foram criados como campos de Lead no
Kommo; só existem hoje na planilha do Google Sheets (ver `PROMPT-MESTRE-LOVABLE.md`/README-LP.md
do projeto). Decidir se cada um vira campo de Lead no Kommo também (não pedido explicitamente
pelo usuário — ele só pediu os campos de correspondência avançada) antes de criar.

## Campos do formulário da LP

1. Qual seu nome?
2. Qual o nome da ótica?
3. Onde fica sua ótica? (cidade)
4. Estado
5. Você é: Proprietário(a) / Sócio(a) / Gestor(a)/responsável / Outro
6. Sua ótica já investe em anúncios?: Sim, atualmente / Já investi anteriormente / Nunca investi
7. Faturamento médio mensal: <5mil / 5-10mil / 10-15mil / 15-20mil / 20-50mil / 50-100mil / >100mil
8. Quanto consegue investir mensalmente em anúncios?: até 500 / 500-1000 / 1000-2000 / >2000
9. Principal objetivo: atrair clientes / vender multifocais / aumentar ticket médio / mais
   conversas no WhatsApp / melhorar processo comercial / outro
10. Quando pretende começar?: agora / próximos 30 dias / próximos 3 meses / só pesquisando

## Rastreamento do site

- **GTM:** container `GTM-P85Z4D55` (não é segredo — vai exposto no HTML mesmo).
- **Meta Pixel:** ID `1718677262582293` (também não é segredo — aparece no código-fonte da
  página de qualquer forma). O usuário pediu para NÃO colocar a tag do Pixel dentro do GTM;
  o plano é rastrear via API/CAPI (N8N) com o máximo de correspondência, usando o access token
  do Meta guardado em `.env.secrets`.
- N8N deve ganhar um fluxo dedicado a receber eventos do site (Lead, ViewContent, Inscrição) e
  repassar para o Meta CAPI.

## Onde estão os segredos

Access token do Meta, token de longa duração do Kommo, subdomínio/pipeline do Kommo e as URLs
dos 4 webhooks do N8N estão em `integracoes/.env.secrets` (gitignorado — nunca commitar).

## Atualização 2026-09-21 — campos do formulário no Kommo (correção)

**Problema:** os leads de 19/09 e 20/09 entraram no Kommo sem as respostas do formulário (os campos
nunca tinham sido criados e o WEBHOOK 1 só gravava rastreamento). Dados recuperados do histórico
de execuções do N8N (execuções 3725 e 3726) e gravados manualmente nos leads 22161118 e 22209168.
No lead 2 os UTMs vieram vazios (Instagram Stories) — recuperados da string `utm`.

**Campos de Lead criados (todos texto):**
| Campo | Field ID |
|---|---|
| Ótica (LP) | 1142048 |
| Cidade (LP) | 1142050 |
| Estado (LP) | 1142052 |
| Cargo (LP) | 1142054 |
| Já investe em tráfego (LP) | 1142056 |
| Faturamento mensal (LP) | 1142058 |
| Investimento mensal em anúncios (LP) | 1142060 |
| Objetivo (LP) | 1142062 |
| Quando pretende começar (LP) | 1142064 |

**WEBHOOK 1 atualizado:** "Criar Lead" grava os 9 campos; "Normalizar" faz trim nas respostas e lê
UTMs/fbclid da string `utm` quando os campos separados vêm vazios. Cuidado: o Code node do N8N
**não tem `URLSearchParams`** (usar parser manual). Testado de ponta a ponta (execução 3738).

**Pendência:** apagar manualmente no Kommo o lead de teste "TESTE - TESTE - APAGAR" (id 22349020).

## Atualização 2026-09-21 — Resumo diário no WhatsApp (workflow `o7b2zkCJxR9rAuYR`)

Workflow "avisos wpp campanha ótica com IA" (todo dia 8h, WhatsApp via stevo) reescrito: uma única
mensagem com 3 blocos (ONTEM / ÚLTIMOS 3 DIAS / ÚLTIMOS 7 DIAS — janelas terminam ontem, fuso SP),
cada um com Impressões, Alcance, Frequência · CPM, CPC, CTR · Leads no site, Custo por lead, Valor
gasto, Leads no CRM; e ao final o funil Kommo dos leads dos últimos 7 dias.
- Meta: 3 chamadas de insights nível conta (alcance/frequência não somam entre dias). Leads no site =
  `offsite_conversion.fb_pixel_lead` (fallback `lead`). Conta de anúncios `act_636798527905412`.
- Bug antigo corrigido: o Kommo era consultado com `limit=250` sem filtro de data/ordem, então leads
  novos podiam nem entrar. Agora usa `filter[created_at][from]` + `order[created_at]=desc`. O corpo
  vem como texto (hal+json) e é convertido com JSON.parse no código.
- Novo nó "Disparo de teste" (webhook POST, path secreto no próprio workflow) para disparar a
  mensagem na hora. Backup do original só local (fora do repo).

## Atualização 2026-09-29 — Cadência comercial automática

Funil reestruturado (etapas novas: TENTANDO CONTATO, CALL REALIZADA, NUTRIÇÃO / GELADEIRA, NÃO QUALIFICADO;
CONTATO INICIAL → RESPONDEU, Proposta Enviada → PROPOSTA / CONTRATO, FOLLOW → FOLLOW DECISÃO — mesmos IDs, webhooks 3/4
intactos) + 2 workflows n8n de cadência (Motor a cada 1 min + Eventos). Documentação completa, IDs, testes e
pendências em `integracoes/cadencia/CADENCIA-COMERCIAL.md`. A seção "Etapas do funil" acima está desatualizada.
