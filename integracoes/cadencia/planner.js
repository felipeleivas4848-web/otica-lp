// =====================================================================
// CADÊNCIA COMERCIAL — ÓTICA COM IA (Kommo pipeline 13923191)
// ---------------------------------------------------------------------
// Fonte única da lógica. Este arquivo é embutido (copiado) nos Code nodes
// dos workflows n8n "CADÊNCIA ÓTICA · Motor" e "CADÊNCIA ÓTICA · Eventos"
// pelo script build-workflows.mjs. Editou aqui? Rode o build e publique.
//
// Ideia central: RECONCILIAÇÃO IDEMPOTENTE.
// Para cada lead, a partir de (etapa + campos + tarefas existentes) o
// planner calcula qual deve ser a próxima ação. Depois:
//   - cria só o que falta,
//   - conclui como "⚙ CANCELADA pelo robô" o que não serve mais,
//   - conclui como "⚙ DUPLICADA pelo robô" o que estiver repetido.
// Rodar 1 ou 10 vezes seguidas produz o mesmo estado final.
// Todas as ações viram uma nota "🤖 CADÊNCIA ÓTICA" no lead (auditoria).
// =====================================================================

const CFG = {
  PIPELINE: 13923191,
  ST: {
    INCOMING: 107441739, NOVO: 107441747, TENTANDO: 112334559, RESPONDEU: 108142683,
    QUALIFICADO: 107441751, CALL_AGENDADA: 107442027, CALL_REALIZADA: 112334563,
    PROPOSTA: 107442031, FOLLOW_DECISAO: 107442039, NUTRICAO: 112334567,
    NAO_QUALIFICADO: 112334571, GANHO: 142, PERDIDO: 143,
  },
  F: {
    CALL: 1143216, RETORNO: 1143218, SEGURAR: 1143220, RESULTADO: 1143222,
    MOTIVO_NQ: 1143224, MOTIVO_PERDA: 1143226, RESPOSTA: 1143230, PRIMEIRA: 1143232,
    TENTATIVAS: 1143234, DESDE: 1143236, CTRL: 1143238,
    OTICA: 1142048, CIDADE: 1142050, ESTADO: 1142052, CARGO: 1142054, JA_INVESTE: 1142056,
    FAT: 1142058, INVEST: 1142060, OBJ: 1142062, QUANDO: 1142064,
    UTM_SOURCE: 646664, UTM_CAMPAIGN: 646662, UTM_CONTENT: 646658,
  },
  TASK_TYPE: { FOLLOW: 1, MEETING: 2 },
  DEFAULT_RESPONSIBLE: 13146959,
  TZ_OFFSET_S: -3 * 3600,          // America/Sao_Paulo (sem horário de verão)
  BH_START: 9, BH_END: 18,          // follow-ups agendados só entre 9h e 18h, nunca domingo
  GRACE_S: 120,                     // espera após concluir tarefa antes de agir (vendedor pode mover o card)
  EVENT_WINDOW_S: 90,               // leads com menos disso são do workflow de Eventos (evita corrida)
  NOVO_DUE_S: 60,                   // SLA: 1ª tentativa em até 1 minuto
  SLA_S: 300,                       // alerta se ⚡ LIGAR NOVO LEAD não foi feita em 5 min
  SLA_MAX_AGE_S: 6 * 3600,          // não gera alerta SLA para lead antigo
  MIN_GAP_S: 3 * 3600,              // intervalo mínimo entre dois follow-ups
  CALL_REMINDER_S: 3600,            // lembrete 1h antes da call
  CALL_STALE_S: 6 * 3600,           // call com +6h no passado não gera mais tarefa
};

const DAY = 86400;
const S = CFG.ST;
const STAGE_NAME = {
  [S.INCOMING]: 'Incoming leads', [S.NOVO]: 'LEAD NOVO', [S.TENTANDO]: 'TENTANDO CONTATO',
  [S.RESPONDEU]: 'RESPONDEU', [S.QUALIFICADO]: 'QUALIFICADO', [S.CALL_AGENDADA]: 'CALL AGENDADA',
  [S.CALL_REALIZADA]: 'CALL REALIZADA', [S.PROPOSTA]: 'PROPOSTA / CONTRATO',
  [S.FOLLOW_DECISAO]: 'FOLLOW DECISÃO', [S.NUTRICAO]: 'NUTRIÇÃO / GELADEIRA',
  [S.NAO_QUALIFICADO]: 'NÃO QUALIFICADO', [S.GANHO]: 'FECHADO - GANHO', [S.PERDIDO]: 'FECHADO - PERDIDO',
};
const CLOSED = [S.GANHO, S.PERDIDO, S.NAO_QUALIFICADO];
// etapas "antes da call": uma data de call futura puxa o lead para CALL AGENDADA
const PRE_CALL = [S.NOVO, S.TENTANDO, S.RESPONDEU, S.QUALIFICADO, S.CALL_REALIZADA, S.NUTRICAO];

// ---------------------------------------------------------------------
// Tipos de tarefa do robô. A 1ª linha do texto da tarefa é a identidade
// (é assim que o robô reconhece as próprias tarefas e evita duplicar).
// ---------------------------------------------------------------------
const WPP_MSG = (c) =>
  `"${c.oi} Tudo bem? Aqui é o Felipe, da Ótica com IA.\n` +
  `Vi seu cadastro e tentei te ligar agora há pouco.\n` +
  `Quando tiver 5 minutinhos, me avisa por aqui que eu te ligo para entender melhor o cenário da ótica ` +
  `e te explicar um pouco das estratégias que estamos utilizando para aumentar as vendas de multifocais."`;

const COMO_REGISTRAR =
  `➡ Atendeu/conversou: mova o card para RESPONDEU (ou QUALIFICADO).\n` +
  `➡ Não atendeu: só conclua esta tarefa — o robô agenda o próximo follow.\n` +
  `➡ Pediu retorno em data/hora: preencha "Retorno combinado em".`;

const ROTEIRO_QUALIFICACAO =
  `NECESSIDADE\n1. O que fez você procurar a gente?\n2. Qual é a principal dificuldade da ótica hoje?\n` +
  `3. Vocês já investem em tráfego? Como estão os resultados?\n4. Como estão as vendas de multifocais hoje?\n` +
  `AUTORIDADE\n5. A decisão sobre marketing fica com você ou tem mais alguém envolvido?\n` +
  `INVESTIMENTO\n6. Quanto vocês investem hoje em anúncios por mês?\n7. Esse valor é só de mídia ou inclui a gestão?\n` +
  `MOMENTO\n8. Vocês querem resolver isso agora?\n9. Se fizer sentido, quando gostariam de começar?`;

const TASKS = {
  NOVO: { title: '⚡ LIGAR NOVO LEAD', body: (c) =>
    `Procedimento (tudo nesta única tarefa):\n1) Ligação normal — até 2 a 3 tentativas seguidas se não atender\n` +
    `2) 1 ligação pelo WhatsApp\n3) Não atendeu? Envie no WhatsApp:\n${WPP_MSG(c)}\n` +
    `Sem apresentação longa, proposta ou preço agora. Objetivo: conseguir a ligação.\n\n${COMO_REGISTRAR}\n\n${c.resumo}` },
  SLA: { title: '⚠ LEAD SEM CONTATO HÁ 5 MIN', body: (c) =>
    `O lead ${c.nome} entrou há mais de 5 minutos e a tarefa ⚡ LIGAR NOVO LEAD ainda não foi feita.\n` +
    `Ligue AGORA. Este alerta some sozinho quando a ⚡ LIGAR NOVO LEAD for concluída.` },
  F2H: { title: '☎ FOLLOW 2H — LIGAR', body: (c) =>
    `2ª rodada: ligação normal + 1 ligação pelo WhatsApp.\nSe não atender e ainda não mandou a mensagem, envie:\n${WPP_MSG(c)}\n\n${COMO_REGISTRAR}` },
  FD1: { title: '☎ FOLLOW D+1 — LIGAR', body: (c) => `Ligar novamente (normal + WhatsApp).\n\n${COMO_REGISTRAR}` },
  FD2: { title: '✉ FOLLOW D+2 — WHATSAPP', body: (c) =>
    `Mandar mensagem curta no WhatsApp retomando o contato (sem proposta/preço). Ex.:\n` +
    `"${c.oi} Conseguiu ver minha mensagem? Me fala um horário bom que eu te ligo rapidinho."\n\n${COMO_REGISTRAR}` },
  FD4: { title: '☎ FOLLOW D+4 — LIGAR', body: (c) => `Nova tentativa de ligação (normal + WhatsApp).\n\n${COMO_REGISTRAR}` },
  FD7: { title: '✉ ÚLTIMA TENTATIVA', body: (c) =>
    `Última mensagem da cadência. Ex.:\n"${c.oi} Vou encerrar por aqui para não te incomodar. ` +
    `Se em algum momento quiser aumentar as vendas de multifocais da ótica, é só me chamar."\n` +
    `Sem resposta → o robô move para NUTRIÇÃO / GELADEIRA.\n\n${COMO_REGISTRAR}` },
  QUAL: { title: '⭐ QUALIFICAR LEAD', body: (c) =>
    `O lead respondeu. Faça a qualificação (roteiro, não precisa enviar as perguntas):\n${ROTEIRO_QUALIFICACAO}\n\n` +
    `➡ Qualificou: mova para QUALIFICADO. Não qualificado: mova para NÃO QUALIFICADO e preencha o motivo.\n` +
    `➡ Pediu para falar depois: preencha "Retorno combinado em" ou "⏸ Segurar até".\n\n${c.resumo}` },
  AGENDAR: { title: '✍ AGENDAR CALL', body: (c) =>
    `Combine a call com ${c.nome} e preencha o campo "Data/hora da call" (grupo Ótica · Cadência).\n` +
    `Ao preencher, o robô move para CALL AGENDADA e cria a tarefa da reunião + lembrete.` },
  CALL: { title: '▶ REALIZAR CALL', meeting: true, body: (c) =>
    `Call com ${c.nome}. Ao terminar: conclua esta tarefa e preencha "Resultado da call".` },
  LEMBRETE: { title: '⏰ LEMBRETE: CALL EM 1H', body: (c) =>
    `A call com ${c.nome} é daqui a 1 hora. Confirme a presença pelo WhatsApp e envie o link.` },
  RESULT: { title: '✍ REGISTRAR RESULTADO DA CALL', body: (c) =>
    `Preencha o campo "Resultado da call": Qualificado · Proposta apresentada · Contrato solicitado · ` +
    `Pensar/retornar · Não compareceu · Não qualificado · Perdido. O robô move o lead conforme o resultado.` },
  ENVIAR_PROP: { title: '✉ ENVIAR PROPOSTA', body: (c) =>
    `Lead qualificado na call. Envie a proposta e mova para PROPOSTA / CONTRATO ` +
    `(ou preencha "Resultado da call" = Proposta apresentada).` },
  REAGENDAR: { title: '✍ REAGENDAR CALL (não compareceu)', body: (c) =>
    `${c.nome} não compareceu. Chame no WhatsApp e reagende. Preencha a nova "Data/hora da call".` },
  CONTRATO: { title: '✍ ENVIAR CONTRATO', body: (c) =>
    `Contrato solicitado na call. Envie o contrato para ${c.nome}. A cadência de follow começa depois.` },
  P1: { title: '✉ FOLLOW PROPOSTA D+1', body: (c) => `Retomar a proposta com ${c.nome}: tirou alguma dúvida? Faz sentido para a ótica?` },
  P3: { title: '✉ FOLLOW PROPOSTA D+3', body: (c) => `Novo follow da proposta (mensagem curta, reforçar um resultado/case).` },
  P5: { title: '☎ LIGAR — DECISÃO (D+5)', body: (c) => `Ligar para ${c.nome} para conduzir a decisão da proposta.` },
  P7: { title: '✉ FOLLOW DECISÃO (D+7)', body: (c) =>
    `Último follow da proposta. Sem retorno → o robô cria "⚖ DEFINIR DESTINO DO LEAD".` },
  FDEC1: { title: '✉ FOLLOW DECISÃO D+2', body: (c) =>
    `${c.nome} está analisando/pediu tempo. Retome com algo de valor (case, resultado, novidade), sem pressão.` },
  FDEC2: { title: '☎ FOLLOW DECISÃO D+5 — LIGAR', body: (c) => `Ligar para ${c.nome}: já conseguiu decidir? Falou com o sócio?` },
  FDEC3: { title: '✉ FOLLOW DECISÃO D+10', body: (c) =>
    `Último follow de decisão. Sem retorno → o robô cria "⚖ DEFINIR DESTINO DO LEAD".` },
  DEFINIR: { title: '⚖ DEFINIR DESTINO DO LEAD', body: (c) =>
    `A cadência desta etapa terminou sem avanço. Decida: mover de etapa, marcar "Retorno combinado em", ` +
    `mandar para NUTRIÇÃO / GELADEIRA ou FECHADO - PERDIDO (com motivo).` },
  RESPOSTA: { title: '✉ ANALISAR RESPOSTA', body: (c) =>
    `${c.nome} respondeu. A sequência automática foi pausada. Leia a conversa e defina o próximo passo ` +
    `(retorno combinado, call, mover etapa...). Se não fizer nada, a cadência recomeça a partir de agora.` },
  RETORNO: { title: '⏰ RETORNO COMBINADO', body: (c) =>
    `Retorno combinado com ${c.nome} para este horário. Tem prioridade sobre qualquer follow genérico.` },
  SEGURAR: { title: '⏸ RETOMAR CONTATO (pediu para segurar)', body: (c) =>
    `${c.nome} pediu para segurar. Cadência pausada até aqui. Retome o contato com leveza.` },
  REATIVAR: { title: '♻ AVALIAR REATIVAÇÃO', body: (c) =>
    `Lead na geladeira. Tem novidade real para reativar? (Agendamento com IA, novos criativos, novos cases, ` +
    `melhorias no Método LENS, resultados de clientes). Se sim, mande; se não, só conclua.` },
  MOTIVO: { title: '✍ REGISTRAR MOTIVO', body: (c) =>
    `Preencha o motivo (grupo Ótica · Cadência): "Motivo não qualificado" ou "Motivo perda (Ótica)".` },
};
// chave → prefixo; testa os prefixos mais longos primeiro.
// Identidade = título SEM símbolos/emojis: o Kommo apaga emojis de 4 bytes do texto da tarefa
// (ex.: "🔥 LIGAR" vira "LIGAR"), então comparar com o símbolo falharia e geraria duplicadas.
const bare = (s) => String(s || '').replace(/^[^A-Za-zÀ-ÿ0-9]+/, '').trim().toUpperCase();
const KEY_BY_PREFIX = Object.entries(TASKS).map(([k, t]) => [bare(t.title), k]).sort((a, b) => b[0].length - a[0].length);
// tarefa concluída pelo robô (cancelada/duplicada) — reconhecida mesmo se o Kommo tirar o símbolo
const isRobotResult = (text) => /^[^A-Za-zÀ-ÿ0-9]*(CANCELADA|DUPLICADA) pelo robô/i.test(String(text || ''));
function keyOf(text) {
  const first = bare(String(text || '').split('\n')[0]);
  for (const [p, k] of KEY_BY_PREFIX) if (first.startsWith(p)) return k;
  return null;
}
// tarefas que o vendedor pediu explicitamente (via campo) — criadas mesmo com tarefa manual aberta
const EXPLICIT = ['CALL', 'LEMBRETE', 'RETORNO', 'SEGURAR'];
// tarefas com horário fixo vindo de campo: se o horário mudar, recria
const MATCH_DUE = ['CALL', 'LEMBRETE', 'RETORNO', 'SEGURAR'];

// ---------------------------------------------------------------------
// utilidades de data (horário de Brasília)
// ---------------------------------------------------------------------
function fmt(ts) {
  const d = new Date((ts + CFG.TZ_OFFSET_S) * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}
function clampBH(ts) {
  const d = new Date((ts + CFG.TZ_OFFSET_S) * 1000);
  const h = d.getUTCHours() + d.getUTCMinutes() / 60;
  if (h < CFG.BH_START) d.setUTCHours(CFG.BH_START, 0, 0, 0);
  else if (h >= CFG.BH_END) { d.setUTCDate(d.getUTCDate() + 1); d.setUTCHours(CFG.BH_START, 0, 0, 0); }
  if (d.getUTCDay() === 0) { d.setUTCDate(d.getUTCDate() + 1); d.setUTCHours(CFG.BH_START, 0, 0, 0); }
  return Math.floor(d.getTime() / 1000) - CFG.TZ_OFFSET_S;
}

// ---------------------------------------------------------------------
// PLANNER
//   input: { now, leads:[kommo lead], tasks:[kommo task], mode:'motor'|'novo', origin }
//   output: { leadPatches, taskUpdates, taskCreates, notes, log }
// ---------------------------------------------------------------------
function planCadencia({ now, leads, tasks, mode = 'motor', origin = 'motor' }) {
  const out = { leadPatches: [], taskUpdates: [], taskCreates: [], notes: [], log: [] };
  const byLead = {};
  for (const t of tasks || []) {
    if (t.entity_type !== 'leads') continue;
    (byLead[t.entity_id] = byLead[t.entity_id] || []).push(t);
  }
  for (const lead of leads || []) {
    try { planLead(lead, byLead[lead.id] || [], now, mode, origin, out); }
    catch (e) { out.log.push(`lead ${lead.id}: ERRO ${e.message}`); }
  }
  return out;
}

function fieldMap(lead) {
  const m = {};
  for (const cf of lead.custom_fields_values || []) {
    const v = cf.values && cf.values[0];
    if (v) m[cf.field_id] = v.value;
  }
  return m;
}

function planLead(lead, rawTasks, now, mode, origin, out) {
  if (lead.pipeline_id !== CFG.PIPELINE) return;
  const f = fieldMap(lead);
  let st = lead.status_id;
  if (st === S.INCOMING) return;                       // pré-funil: fica fora da cadência até ser aceito
  const ctrl = f[CFG.F.CTRL] ? Number(f[CFG.F.CTRL]) : null;
  if (!ctrl && CLOSED.includes(st)) return;            // lead fechado que o robô nunca acompanhou: não mexe

  // ---- contexto do lead para os textos ----
  const partes = String(lead.name || '').split(' - ');
  let nomeCompleto = (partes.length > 1 ? partes.slice(1).join(' - ') : partes[0]).trim();
  // leads criados pelo WhatsApp vêm como "Lead #123" — sem nome real, a saudação vira só "Oi!"
  if (!nomeCompleto || /^(lead\b|#|\d)/i.test(nomeCompleto)) nomeCompleto = '';
  const primeiro = nomeCompleto.split(' ')[0];
  const nome = primeiro || 'o lead';
  const oi = primeiro ? `Oi, ${primeiro}!` : 'Oi!';
  if (!nomeCompleto) nomeCompleto = String(lead.name || 'lead');
  const resumoLinhas = [
    f[CFG.F.OTICA] && `Ótica: ${f[CFG.F.OTICA]}${f[CFG.F.CIDADE] ? ` (${f[CFG.F.CIDADE]}${f[CFG.F.ESTADO] ? '/' + f[CFG.F.ESTADO] : ''})` : ''}`,
    f[CFG.F.CARGO] && `Cargo: ${f[CFG.F.CARGO]}`,
    f[CFG.F.JA_INVESTE] && `Já investe: ${f[CFG.F.JA_INVESTE]}`,
    f[CFG.F.FAT] && `Faturamento: ${f[CFG.F.FAT]}`,
    f[CFG.F.INVEST] && `Pode investir: ${f[CFG.F.INVEST]}`,
    f[CFG.F.OBJ] && `Objetivo: ${f[CFG.F.OBJ]}`,
    f[CFG.F.QUANDO] && `Quando começar: ${f[CFG.F.QUANDO]}`,
    (f[CFG.F.UTM_SOURCE] || f[CFG.F.UTM_CAMPAIGN]) &&
      `Origem: ${[f[CFG.F.UTM_SOURCE], f[CFG.F.UTM_CAMPAIGN], f[CFG.F.UTM_CONTENT]].filter(Boolean).join(' / ')}`,
  ].filter(Boolean);
  const ctx = { nome, oi, nomeCompleto, resumo: resumoLinhas.length ? '— Dados do lead —\n' + resumoLinhas.join('\n') : '' };

  // ---- tarefas normalizadas ----
  const T = rawTasks.map((t) => {
    const resText = t.result && t.result.text ? String(t.result.text) : '';
    return {
      id: t.id, key: keyOf(t.text), text: t.text, open: !t.is_completed, due: t.complete_till,
      created: t.created_at, updated: t.updated_at, robotClosed: isRobotResult(resText),
    };
  });
  const humanDone = (key, since = 0) => T.filter((t) => t.key === key && !t.open && !t.robotClosed && t.created >= since);
  const lastDoneAt = (keys, since = 0) => {
    let m = 0;
    for (const t of T) if (keys.includes(t.key) && !t.open && !t.robotClosed && t.created >= since) m = Math.max(m, t.updated);
    return m;
  };
  const anyOf = (key, since = 0) => T.filter((t) => t.key === key && t.created >= since);
  const openOf = (key) => T.filter((t) => t.key === key && t.open);

  const notes = [];
  const fieldsPatch = {};
  let newStatus = null;
  let since;
  let moveReason = null;
  let cancelReason = null;

  // ---- detecta mudança de etapa (feita pelo vendedor ou por outra automação) ----
  if (ctrl !== st) {
    since = ctrl ? now : ([S.NOVO, S.TENTANDO].includes(st) ? lead.created_at : now);
    fieldsPatch[CFG.F.CTRL] = String(st);
    fieldsPatch[CFG.F.DESDE] = since;
    notes.push(ctrl ? `Etapa: ${STAGE_NAME[ctrl] || ctrl} → ${STAGE_NAME[st] || st} (movido no Kommo)` :
      `Cadência ativada para este lead (etapa ${STAGE_NAME[st] || st})`);
    if (st === S.CALL_AGENDADA && f[CFG.F.RESULTADO]) { fieldsPatch[CFG.F.RESULTADO] = null; f[CFG.F.RESULTADO] = null; }
  } else {
    since = Number(f[CFG.F.DESDE]) || lead.created_at;
  }

  // ---- modo "novo" (workflow de Eventos): só cria a 1ª tarefa do lead recém-criado ----
  if (mode === 'novo') {
    if (st !== S.NOVO || anyOf('NOVO').length) return;
    const due = Math.max(lead.created_at + CFG.NOVO_DUE_S, now + 30);
    createTask(out, lead, 'NOVO', due, ctx);
    notes.push(`Tarefa criada: ${TASKS.NOVO.title} (vence ${fmt(due)}) — lead novo`);
    flush(out, lead, fieldsPatch, null, notes, now, origin);
    return;
  }

  const moveTo = (to, reason) => {
    notes.push(`Etapa: ${STAGE_NAME[st]} → ${STAGE_NAME[to]} (${reason})`);
    newStatus = to; st = to; since = now; moveReason = reason;
    fieldsPatch[CFG.F.CTRL] = String(to);
    fieldsPatch[CFG.F.DESDE] = now;
    if (to === S.CALL_AGENDADA && f[CFG.F.RESULTADO]) { fieldsPatch[CFG.F.RESULTADO] = null; f[CFG.F.RESULTADO] = null; }
  };
  const setField = (id, v) => { if (f[id] !== v) { fieldsPatch[id] = v; f[id] = v; } };

  // tentativas de contato (histórico)
  const tentativas = T.filter((t) => ['NOVO', 'F2H', 'FD1', 'FD2', 'FD4', 'FD7'].includes(t.key) && !t.open && !t.robotClosed).length;
  if (tentativas && Number(f[CFG.F.TENTATIVAS] || 0) !== tentativas) setField(CFG.F.TENTATIVAS, tentativas);

  const desired = {};      // key -> { due, reason }
  const reply = Number(f[CFG.F.RESPOSTA]) || 0;
  const callAt = Number(f[CFG.F.CALL]) || 0;
  let override = false;

  // ===== máquina de estados (pode mover o lead mais de uma vez no mesmo ciclo) =====
  for (let iter = 0; iter < 4; iter++) {
    const before = st;
    for (const k in desired) delete desired[k];
    override = false;
    const closed = CLOSED.includes(st);

    // --- retorno combinado / segurar: prioridade sobre cadência genérica ---
    if (!closed) {
      for (const [key, fid, label] of [['RETORNO', CFG.F.RETORNO, 'Retorno combinado'], ['SEGURAR', CFG.F.SEGURAR, 'Segurar até']]) {
        const v = Number(f[fid]) || 0;
        if (!v) continue;
        if (T.some((t) => t.key === key && !t.open && !t.robotClosed && t.due === v)) {
          setField(fid, null);
          notes.push(`${label} (${fmt(v)}) concluído — campo limpo, cadência da etapa retomada`);
          continue;
        }
        desired[key] = { due: v };
        override = true;
      }
    }
    if (override && [S.NOVO, S.TENTANDO].includes(st)) { moveTo(S.RESPONDEU, 'retorno combinado registrado = houve contato'); continue; }

    // --- call agendada: tarefa da reunião + lembrete, em qualquer etapa aberta ---
    if (!closed && callAt && (callAt > now - CFG.CALL_STALE_S || openOf('CALL').some((t) => t.due === callAt))) {
      const callDone = T.some((t) => t.key === 'CALL' && !t.open && !t.robotClosed && t.due === callAt);
      if (!callDone) {
        desired.CALL = { due: callAt };
        const lem = callAt - CFG.CALL_REMINDER_S;
        if (openOf('LEMBRETE').some((t) => t.due === lem) || (lem > now && !T.some((t) => t.key === 'LEMBRETE' && t.due === lem))) desired.LEMBRETE = { due: lem };
        if (callAt > now && PRE_CALL.includes(st)) { moveTo(S.CALL_AGENDADA, `call marcada para ${fmt(callAt)}`); continue; }
      }
    }

    // --- mensagem recebida ---
    if (reply && [S.NOVO, S.TENTANDO].includes(st) && reply >= since - 600) { moveTo(S.RESPONDEU, `lead respondeu às ${fmt(reply)}`); continue; }

    const stageSince = since;
    const primary = pickPrimary();
    if (primary && primary.move) { moveTo(primary.move, primary.reason); continue; }
    if (primary && primary.key) desired[primary.key] = { due: primary.due };
    if (st === before) break;

    // ---------- regra de cada etapa ----------
    function pickPrimary() {
      const cyc = (key, afterKeys, gap) => {   // tarefa que se repete enquanto o lead não sai da etapa
        if (openOf(key).length) return { key, due: openOf(key)[0].due };
        const last = lastDoneAt(afterKeys, stageSince);
        if (!last) return { key, due: now + 60 };
        if (now - last < CFG.GRACE_S) return null;
        return { key, due: Math.max(clampBH(last + gap), now + 60) };
      };
      if (override) return null;
      if (desired.CALL && st === S.CALL_AGENDADA) return null;   // a própria call é a próxima ação

      // mensagem recebida em etapa com cadência → pausa e pede análise humana
      if ([S.PROPOSTA, S.FOLLOW_DECISAO, S.NUTRICAO].includes(st)) {
        if (openOf('RESPOSTA').length) return { key: 'RESPOSTA', due: openOf('RESPOSTA')[0].due };
        if (reply && reply >= stageSince && !T.some((t) => t.key === 'RESPOSTA' && t.created >= reply)) {
          notes.push(`Lead respondeu às ${fmt(reply)} — sequência pausada`);
          cancelReason = 'lead respondeu — sequência pausada para análise humana';
          return { key: 'RESPOSTA', due: now + 60 };
        }
      }
      const anchorAfterReply = Math.max(stageSince, reply, lastDoneAt(['RESPOSTA', 'RETORNO', 'SEGURAR'], 0));

      switch (st) {
        case S.NOVO: {
          const all = anyOf('NOVO', stageSince - 5);
          if (!all.length) {
            if (now - lead.created_at < CFG.EVENT_WINDOW_S) return null;   // workflow de Eventos cuida
            return { key: 'NOVO', due: Math.max(lead.created_at + CFG.NOVO_DUE_S, now + 60) };
          }
          const open = all.filter((t) => t.open);
          if (open.length) {
            const age = now - lead.created_at;
            if (age >= CFG.SLA_S && age < CFG.SLA_MAX_AGE_S && !anyOf('SLA').length) {
              desired.SLA = { due: now + 60 };
              notes.push('SLA estourado: lead sem contato há 5 min');
            } else if (openOf('SLA').length) desired.SLA = { due: openOf('SLA')[0].due };
            return { key: 'NOVO', due: open[0].due };
          }
          const done = lastDoneAt(['NOVO'], stageSince - 5);
          if (!done) return null;
          if (now - done < CFG.GRACE_S) return null;
          if (!f[CFG.F.PRIMEIRA]) setField(CFG.F.PRIMEIRA, done);
          return { move: S.TENTANDO, reason: `1ª tentativa concluída ${fmt(done)} sem avanço = não atendeu` };
        }
        case S.TENTANDO: {
          const steps = [['F2H', 0, 2 * 3600], ['FD1', DAY], ['FD2', 2 * DAY], ['FD4', 4 * DAY], ['FD7', 7 * DAY]];
          const r = cadence(steps, lead.created_at, stageSince, ['NOVO', 'F2H', 'FD1', 'FD2', 'FD4', 'FD7']);
          if (r === 'END') return { move: S.NUTRICAO, reason: 'cadência sem resposta encerrada (D+7)' };
          return r;
        }
        case S.RESPONDEU: return cyc('QUAL', ['QUAL'], DAY);
        case S.QUALIFICADO: return cyc('AGENDAR', ['AGENDAR'], DAY);
        case S.CALL_AGENDADA: {
          if (callAt && T.some((t) => t.key === 'CALL' && !t.open && !t.robotClosed && t.due === callAt)) {
            const done = lastDoneAt(['CALL']);
            if (now - done < CFG.GRACE_S) return null;
            return { move: S.CALL_REALIZADA, reason: 'tarefa da call concluída' };
          }
          return cyc('AGENDAR', ['AGENDAR'], DAY);   // sem data válida
        }
        case S.CALL_REALIZADA: {
          const res = f[CFG.F.RESULTADO];
          const map = {
            'Proposta apresentada': S.PROPOSTA, 'Contrato solicitado': S.PROPOSTA, 'Pensar/retornar': S.FOLLOW_DECISAO,
            'Não qualificado': S.NAO_QUALIFICADO, 'Perdido': S.PERDIDO,
          };
          if (res && map[res]) return { move: map[res], reason: `Resultado da call = ${res}` };
          if (res === 'Qualificado') return cyc('ENVIAR_PROP', ['ENVIAR_PROP'], DAY);
          if (res === 'Não compareceu') return cyc('REAGENDAR', ['REAGENDAR'], DAY);
          return cyc('RESULT', ['RESULT'], DAY);
        }
        case S.PROPOSTA: {
          if (f[CFG.F.RESULTADO] === 'Contrato solicitado' && !T.some((t) => t.key === 'CONTRATO' && t.created >= stageSince - 5)) return { key: 'CONTRATO', due: now + 60 };
          if (openOf('CONTRATO').length) return { key: 'CONTRATO', due: openOf('CONTRATO')[0].due };
          const anchor = Math.max(anchorAfterReply, lastDoneAt(['CONTRATO'], stageSince));
          const r = cadence([['P1', DAY], ['P3', 3 * DAY], ['P5', 5 * DAY], ['P7', 7 * DAY]], anchor, anchor, ['P1', 'P3', 'P5', 'P7', 'RESPOSTA', 'CONTRATO']);
          return r === 'END' ? cyc('DEFINIR', ['P7', 'DEFINIR'], DAY) : r;
        }
        case S.FOLLOW_DECISAO: {
          const anchor = anchorAfterReply;
          const r = cadence([['FDEC1', 2 * DAY], ['FDEC2', 5 * DAY], ['FDEC3', 10 * DAY]], anchor, anchor, ['FDEC1', 'FDEC2', 'FDEC3', 'RESPOSTA']);
          return r === 'END' ? cyc('DEFINIR', ['FDEC3', 'DEFINIR'], DAY) : r;
        }
        case S.NUTRICAO: {
          if (openOf('REATIVAR').length) return { key: 'REATIVAR', due: openOf('REATIVAR')[0].due };
          const base = Math.max(anchorAfterReply, lastDoneAt(['REATIVAR'], stageSince));
          return { key: 'REATIVAR', due: Math.max(clampBH(base + 30 * DAY), now + 60) };
        }
        case S.NAO_QUALIFICADO:
        case S.PERDIDO: {
          const temMotivo = st === S.NAO_QUALIFICADO ? !!f[CFG.F.MOTIVO_NQ] : (!!f[CFG.F.MOTIVO_PERDA] || !!lead.loss_reason_id);
          if (temMotivo) return null;
          if (openOf('MOTIVO').length) return { key: 'MOTIVO', due: openOf('MOTIVO')[0].due };
          if (anyOf('MOTIVO', stageSince - 5).length) return null;   // já pediu uma vez nesta etapa
          return { key: 'MOTIVO', due: now + 60 };
        }
        default: return null;
      }

      // cadência sequencial: próximo passo = 1º passo ainda não feito (por humano) desde `countSince`
      function cadence(steps, anchor, countSince, prevKeys) {
        for (const [key, off, afterPrev] of steps) {
          if (humanDone(key, countSince - 5).length) continue;
          if (openOf(key).length) return { key, due: openOf(key)[0].due };
          const lastDone = lastDoneAt(prevKeys, Math.min(countSince, stageSince) - 5);
          if (lastDone && now - lastDone < CFG.GRACE_S) return null;
          const prev = lastDone || stageSince;
          const base = afterPrev ? prev + afterPrev : Math.max(anchor + off, prev + CFG.MIN_GAP_S);
          return { key, due: Math.max(clampBH(base), now + 60) };
        }
        const prev = lastDoneAt(prevKeys, countSince - 5);
        if (prev && now - prev < CFG.GRACE_S) return null;
        return 'END';
      }
    }
  }

  // ===== aplica: cancela o que não serve, remove duplicadas, cria o que falta =====
  const manualOpen = T.some((t) => t.open && !t.key);
  const reasonDefault = cancelReason || (moveReason ? `lead avançou: ${moveReason}` : `incompatível com a etapa ${STAGE_NAME[st]}`);
  const seenKeep = {};
  const openRobot = T.filter((t) => t.open && t.key).sort((a, b) => a.id - b.id);
  for (const t of openRobot) {
    const want = desired[t.key];
    let reason = null;
    if (!want) reason = override && !['CALL', 'LEMBRETE'].includes(t.key) ? 'retorno combinado/segurar tem prioridade' :
      (t.key === 'SLA' ? 'primeira tentativa já feita' : reasonDefault);
    else if (MATCH_DUE.includes(t.key) && t.due !== want.due) reason = `horário alterado para ${fmt(want.due)}`;
    else if (seenKeep[t.key]) reason = 'DUPLICADA';
    if (reason) {
      const txt = reason === 'DUPLICADA' ? '⚙ DUPLICADA pelo robô — removida automaticamente' : `⚙ CANCELADA pelo robô: ${reason}`;
      out.taskUpdates.push({ id: t.id, is_completed: true, result: { text: txt } });
      notes.push(`Tarefa ${reason === 'DUPLICADA' ? 'duplicada removida' : 'cancelada'}: ${t.key && TASKS[t.key].title} — ${reason}`);
      t.open = false; t.robotClosed = true;
    } else seenKeep[t.key] = t;
  }
  for (const [key, want] of Object.entries(desired)) {
    if (seenKeep[key]) continue;
    if (manualOpen && !EXPLICIT.includes(key)) { out.log.push(`lead ${lead.id}: ${key} adiada — há tarefa manual aberta`); continue; }
    createTask(out, lead, key, want.due, ctx);
    notes.push(`Tarefa criada: ${TASKS[key].title} (vence ${fmt(want.due)})`);
  }
  flush(out, lead, fieldsPatch, newStatus, notes, now, origin);
}

function createTask(out, lead, key, due, ctx) {
  const def = TASKS[key];
  const title = ['CALL', 'RETORNO', 'SEGURAR'].includes(key) ? `${def.title} — ${ctx.nomeCompleto}` : def.title;
  const body = def.body(ctx);
  out.taskCreates.push({
    entity_id: lead.id, entity_type: 'leads',
    responsible_user_id: lead.responsible_user_id || CFG.DEFAULT_RESPONSIBLE,
    task_type_id: def.meeting ? CFG.TASK_TYPE.MEETING : CFG.TASK_TYPE.FOLLOW,
    text: (title + (body ? '\n\n' + body : '')).slice(0, 2000),
    complete_till: due,
  });
}

function flush(out, lead, fieldsPatch, newStatus, notes, now, origin) {
  const cfs = Object.entries(fieldsPatch).map(([id, v]) => ({
    field_id: Number(id), values: v === null || v === undefined ? null : [{ value: v }],
  }));
  if (cfs.length || newStatus) {
    const p = { id: lead.id };
    if (newStatus) { p.status_id = newStatus; p.pipeline_id = CFG.PIPELINE; }
    if (cfs.length) p.custom_fields_values = cfs;
    out.leadPatches.push(p);
  }
  if (notes.length) {
    out.notes.push({
      entity_id: lead.id, note_type: 'common',
      params: { text: `🤖 CADÊNCIA ÓTICA · ${fmt(now)} · origem: ${origin}\n• ` + notes.join('\n• ') },
    });
    out.log.push(`lead ${lead.id}: ` + notes.join(' | '));
  }
}

// Transforma o plano em requisições HTTP para a API do Kommo (lotes de 50)
function planToRequests(plan) {
  const reqs = [];
  const chunk = (arr, n = 50) => { const r = []; for (let i = 0; i < arr.length; i += n) r.push(arr.slice(i, i + n)); return r; };
  for (const c of chunk(plan.leadPatches)) reqs.push({ method: 'PATCH', url: '/api/v4/leads', body: c });
  for (const c of chunk(plan.taskUpdates)) reqs.push({ method: 'PATCH', url: '/api/v4/tasks', body: c });
  for (const c of chunk(plan.taskCreates)) reqs.push({ method: 'POST', url: '/api/v4/tasks', body: c });
  for (const c of chunk(plan.notes)) reqs.push({ method: 'POST', url: '/api/v4/leads/notes', body: c });
  return reqs;
}

// Dedupe pós-criação (corrida entre dois webhooks idênticos): mantém a tarefa mais antiga de cada tipo
function dedupeTasks(tasks) {
  const upd = [];
  const seen = {};
  for (const t of (tasks || []).filter((x) => !x.is_completed).sort((a, b) => a.id - b.id)) {
    const key = keyOf(t.text);
    if (!key) continue;
    const k = t.entity_id + ':' + key + (MATCH_DUE.includes(key) ? ':' + t.complete_till : '');
    if (seen[k]) upd.push({ id: t.id, is_completed: true, result: { text: '⚙ DUPLICADA pelo robô — removida automaticamente' } });
    else seen[k] = true;
  }
  return upd;
}

if (typeof module !== 'undefined') module.exports = { CFG, TASKS, keyOf, isRobotResult, clampBH, fmt, planCadencia, planToRequests, dedupeTasks };
