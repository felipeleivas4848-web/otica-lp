# Cadência comercial automática — Ótica com IA (Kommo + n8n)

Implantado em **29/09/2026**. Funil Kommo **ÓTICA COM IA** (pipeline `13923191`, conta `poloads`).
Nenhum outro funil (TVGO, PROSPECÇÃO - TVGO, EXAME DE VISTA) foi alterado.

## Como funciona (arquitetura)

| Camada | Responsabilidade |
|---|---|
| **Kommo** | Etapas, campos, tarefas e histórico. Cada ação do robô vira uma nota `🤖 CADÊNCIA ÓTICA · data · origem` no lead. **Nenhuma** automação nativa de tarefa no Digital Pipeline (para não duplicar). |
| **n8n · Eventos** (`P1ukc1o7nPGH3zAe`) | Webhook da conta Kommo (`add_lead` + `add_message`, id `47496779`). Lead novo no funil → cria **⚡ LIGAR NOVO LEAD** na hora (prazo = criação + 60s). Mensagem **recebida** → grava `⚙ Última resposta do lead em`. Ignora todos os outros funis. |
| **n8n · Motor** (`KA2v3ywDsJViykUh`) | Roda **a cada 1 minuto**. Para cada lead ativo da Ótica, calcula a próxima ação a partir de (etapa + campos + tarefas) e **reconcilia**: cria o que falta, conclui como `⚙ CANCELADA pelo robô: <motivo>` o que não serve mais e remove duplicadas. É idempotente: rodar 1 ou 100 vezes dá o mesmo resultado, e ele se corrige se algum webhook se perder. |

Fonte única da lógica: `planner.js`. O `build-workflows.mjs` embute esse arquivo nos dois workflows.

**Regra de ouro para o vendedor:** o robô só lê três coisas: **em que etapa o card está**, **quais tarefas
foram concluídas** e **alguns campos** do grupo "Ótica · Cadência".

## Funil (IDs)

| # | Etapa | ID | O que o robô faz |
|---|---|---|---|
| – | Incoming leads (pré-funil WhatsApp/newsletter) | 107441739 | nada (entra na cadência quando aceito) |
| 1 | LEAD NOVO | 107441747 | ⚡ LIGAR NOVO LEAD em 1 min · ⚠ alerta SLA aos 5 min (1 só) · concluiu a tarefa e não moveu em 2 min → TENTANDO CONTATO |
| 2 | TENTANDO CONTATO *(nova)* | 112334559 | ☎ 2H → ☎ D+1 → ✉ D+2 → ☎ D+4 → ✉ ÚLTIMA (D+7), um de cada vez · sem resposta → NUTRIÇÃO |
| 3 | RESPONDEU *(era CONTATO INICIAL)* | 108142683 | ⭐ QUALIFICAR LEAD (com roteiro das 9 perguntas) |
| 4 | QUALIFICADO | 107441751 | ✍ AGENDAR CALL · **webhook 3 → Meta QualifiedLead (mantido)** |
| 5 | CALL AGENDADA | 107442027 | ▶ REALIZAR CALL — NOME (tipo Reunião, no horário) + ⏰ lembrete 1h antes |
| 6 | CALL REALIZADA *(nova)* | 112334563 | ✍ REGISTRAR RESULTADO DA CALL → move conforme o resultado |
| 7 | PROPOSTA / CONTRATO *(era Proposta Enviada)* | 107442031 | ✉ D+1 → ✉ D+3 → ☎ D+5 → ✉ D+7 → ⚖ DEFINIR DESTINO · contrato solicitado → ✍ ENVIAR CONTRATO |
| 8 | FOLLOW DECISÃO *(era FOLLOW)* | 107442039 | cadência própria (sem pressão): ✉ D+2 → ☎ D+5 → ✉ D+10 → ⚖ DEFINIR DESTINO |
| 9 | NUTRIÇÃO / GELADEIRA *(nova)* | 112334567 | ♻ AVALIAR REATIVAÇÃO a cada 30 dias (só se houver novidade real) |
| 10 | NÃO QUALIFICADO *(nova)* | 112334571 | cancela tudo · pede ✍ REGISTRAR MOTIVO se "Motivo não qualificado" vazio |
| 11 | Fechado - ganho | 142 | cancela tudo · **webhook 4 → Meta Purchase (mantido)** |
| 12 | Fechado - perdido | 143 | cancela tudo · pede motivo se "Motivo perda (Ótica)" e o motivo nativo estiverem vazios |

Resultado da call → etapa: *Proposta apresentada / Contrato solicitado* → PROPOSTA · *Pensar/retornar* → FOLLOW DECISÃO ·
*Não qualificado* → NÃO QUALIFICADO · *Perdido* → Fechado-perdido · *Qualificado* → ✉ ENVIAR PROPOSTA · *Não compareceu* → ✍ REAGENDAR CALL.

## Regras transversais

- **Mensagem recebida** (só `incoming`; mensagem do vendedor não conta) em LEAD NOVO/TENTANDO → move para **RESPONDEU**
  e cancela toda a prospecção. Nunca move para QUALIFICADO (regra 19). Em PROPOSTA, FOLLOW DECISÃO e NUTRIÇÃO → pausa
  a sequência e cria **✉ ANALISAR RESPOSTA**. Depois que você a conclui, a cadência recomeça a contar a partir dali.
- **⏰ Retorno combinado em** / **⏸ Segurar até** (campos): cancela os follows genéricos e cria **1** tarefa na data/hora exata.
  Em LEAD NOVO/TENTANDO, também move para RESPONDEU (houve contato). Quando você conclui a tarefa, o campo é limpo e a
  cadência da etapa volta.
- **▶ Data/hora da call** preenchida com data futura: cria a tarefa da reunião + lembrete e move para CALL AGENDADA
  (vindo de LEAD NOVO, TENTANDO, RESPONDEU, QUALIFICADO, CALL REALIZADA ou NUTRIÇÃO). Mudou o horário → a tarefa antiga é
  cancelada e a nova criada. **Atenção:** se o card pular QUALIFICADO direto para CALL AGENDADA, o evento QualifiedLead
  **não** vai para o Meta. Para alimentar a campanha, passe por QUALIFICADO.
- **Tarefa manual aberta = próxima ação.** Se o lead tem uma tarefa criada à mão e ainda aberta, o robô não cria outra
  (só as pedidas por campo: call, lembrete, retorno, segurar). Quando você conclui a manual, o robô assume.
- **Follow-ups** caem entre **9h e 18h (Brasília), nunca no domingo**, com pelo menos 3h entre um e outro. A ⚡ LIGAR NOVO
  LEAD e as tarefas "agora" (qualificar, analisar resposta…) são sempre imediatas.
- **Carência de 2 min:** depois de você concluir uma tarefa, o robô espera 2 min antes de agir (dá tempo de mover o card).
- **Antiduplicidade:** cada tipo de tarefa é reconhecido pela 1ª linha do texto **sem símbolos**. O Kommo apaga emojis
  de 4 bytes (🔥📞💬🎯…) de tarefas e **nomes de campos**, por isso só usamos símbolos simples (⚡ ⚠ ☎ ✉ ⭐ ▶ ⏰ ⚖ ♻ ⚙).
  No webhook de lead novo, uma espera aleatória de 0–3s + uma verificação 3s depois removem duplicadas vindas de
  eventos simultâneos. O Motor também remove duplicadas a cada minuto.

## Campos criados (grupo "Ótica · Cadência")

| Campo | ID | Quem preenche |
|---|---|---|
| ▶ Data/hora da call | 1143216 | vendedor |
| ⏰ Retorno combinado em | 1143218 | vendedor |
| ⏸ Segurar até | 1143220 | vendedor |
| Resultado da call (lista) | 1143222 | vendedor |
| Motivo não qualificado (lista) | 1143224 | vendedor |
| Motivo perda (Ótica) (lista) | 1143226 | vendedor |
| Detalhe do motivo | 1143228 | vendedor |
| ⚙ Última resposta do lead em (robô) | 1143230 | n8n Eventos |
| ⚙ 1ª tentativa em (robô) | 1143232 | Motor (mede o SLA real) |
| ⚙ Tentativas de contato (robô) | 1143234 | Motor |
| ⚙ Na etapa desde (robô) | 1143236 | Motor |
| ⚙ Etapa controlada (robô) | 1143238 | Motor (detecta mudança de etapa) |

Os motivos de perda **nativos** do Kommo são da conta inteira (TVGO usa). Por isso não foram alterados: os motivos da
Ótica ficam nesses campos próprios.

## Meta / Conversions API — onde está cada dado (nada foi alterado)

| Dado | Onde fica | Quem grava |
|---|---|---|
| FBP | campo 1140986 | WEBHOOK 1 (site) |
| Client IP Address | 1140988 | WEBHOOK 1 |
| Client User Agent | 1140990 | WEBHOOK 1 |
| Event ID (do Lead no site) | 1140992 | WEBHOOK 1 |
| FB Lead ID | 1140982 | (reservado para leads de formulário nativo) |
| FBCLID (base do `fbc`) | 646676 | WEBHOOK 1 |
| UTM source/medium/campaign/content/term | 646664/646660/646662/646658/646666 | WEBHOOK 1 |
| Telefone/e-mail (hash no envio) | contato do lead | WEBHOOK 1 |

Eventos já em produção: `Lead` (site, WEBHOOK 1), `QualifiedLead` (etapa QUALIFICADO, WEBHOOK 3), `Purchase` (Fechado-ganho,
WEBHOOK 4). **Preparado, não implementado:** `Schedule` quando o lead entra em CALL AGENDADA (o campo "⚙ Na etapa desde"
dá o horário). Seguiria o mesmo padrão do WEBHOOK 3, com `event_id` = `lead_{id}_schedule`. Nenhum evento novo foi criado.

## Arquivos

- `planner.js` — toda a lógica (config de IDs no topo, `CFG`).
- `test-planner.js` — simulador offline (56 verificações). Rodar: `node test-planner.js`.
- `build-workflows.mjs` — gera os workflows; `node build-workflows.mjs --deploy` publica e ativa.
- `workflows.json` e `dist/` — IDs + **path secreto do webhook** → no `.gitignore`, não commitar.
- `dist/backup-avisos-wpp-o7b2zk-2026-09-29.json` — backup do resumo diário antes do ajuste do mapa de etapas.

**Para mudar prazos/textos:** edite `planner.js` → `node test-planner.js` → `node build-workflows.mjs --deploy`.

## Alterações feitas fora dos arquivos

- Kommo: 4 etapas criadas, 4 renomeadas, reordenadas; grupo + 12 campos; webhook de conta `47496779`.
- n8n: 2 workflows novos e ativos; "avisos wpp campanha ótica com IA" (`o7b2zkCJxR9rAuYR`) só teve o **mapa de nomes das
  etapas** atualizado (as etapas novas aparecem no resumo das 8h).
- Não foram mexidos: WEBHOOK 1–4, AGENTE EXEMPLO AGENDA (ignora leads da Ótica sem a tag dele), webhook Zapier.

## Testes realizados (29/09/2026)

**Ao vivo no Kommo** (leads "TESTE CADÊNCIA - APAGAR" 23504466, 23504668 e "TESTE CORRIDA - APAGAR" 23504684):
1 ✔ tarefa criada ~1s após o lead, prazo exatamente +60s · 2 ✔ alerta SLA aos 5 min, 1 só · 3 ✔ não atendeu → TENTANDO + 2H ·
4 ✔ resposta cancela o 2H · 5 ✔ RESPONDEU + QUALIFICAR · 7 ✔ call → tarefa Reunião no horário + lembrete, depois
CALL REALIZADA · 8 ✔ proposta → follow D+1 · 9 ✔ resposta pausa a proposta → ANALISAR RESPOSTA · 10 ✔ retorno combinado
substitui os genéricos · 11 ✔ webhook repetido e 4 eventos simultâneos → 1 tarefa · 12 ✔ fechado → tudo cancelado ·
13 ✔ motivo pedido e registrado.

**Só no simulador (não ao vivo):** 6 (QUALIFICADO) e o fechamento como GANHO. Mover um lead falso para essas etapas
dispararia QualifiedLead/Purchase **falsos** no Meta. Também só no simulador: cadência completa até NUTRIÇÃO,
FOLLOW DECISÃO, segurar, contrato, não compareceu e tarefa manual.

**Mensagens nos testes ao vivo:** simuladas no mesmo formato do Kommo (capturado de mensagens reais da conta). Uma
mensagem de WhatsApp real ainda não passou pelo webhook novo.

## Pendências manuais

1. Apagar no Kommo (a API não apaga) os leads de teste 23504466, 23504668 e 23504684 (já estão em Fechado-perdido).
2. Mandar um WhatsApp de verdade para um lead de teste e ver o card ir para RESPONDEU (fecha o teste de mensagem real).
3. Os 7 leads que já estavam no funil têm tarefas manuais abertas. O robô assume cada um quando a manual for concluída.
   O lead Wellington, em RESPONDEU, vai ganhar ⭐ QUALIFICAR nessa hora.
4. Opcional: renomear "Fechado - ganho/perdido" na tela (a API não deixa).
5. Opcional: tornar "Motivo não qualificado" obrigatório na etapa NÃO QUALIFICADO (Kommo → campo → obrigatório por etapa).
6. Mais vendedores: o robô usa o responsável do lead. Distribuição automática (rodízio) ainda não existe; hoje só há 1 usuário.
7. Monitoramento: se o n8n cair, o Motor para. As execuções com erro ficam salvas no n8n; um alerta automático de erro
   (ex.: WhatsApp) não foi configurado.
