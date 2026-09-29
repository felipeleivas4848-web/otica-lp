// Testes offline do planner: simula o Kommo em memória, aplica os planos e avança o relógio.
// Rodar: node test-planner.js
const P = require('./planner.js');
const { CFG, planCadencia, keyOf, dedupeTasks } = P;
const S = CFG.ST, F = CFG.F;

let fails = 0, passes = 0;
function ok(cond, msg) { if (cond) { passes++; console.log('  ✔', msg); } else { fails++; console.log('  ✘', msg); } }

function sim(startIso = '2026-09-29T13:00:00Z') {   // 10:00 em Brasília (terça)
  const K = { now: Math.floor(Date.parse(startIso) / 1000), leads: {}, tasks: [], notes: [], nextTask: 1 };
  K.addLead = (id, extra = {}) => { K.leads[id] = { id, name: 'Ótica Teste - Maria Silva', pipeline_id: CFG.PIPELINE, status_id: S.NOVO, created_at: K.now, responsible_user_id: 13146959, custom_fields_values: [], ...extra }; return K.leads[id]; };
  K.setField = (id, fid, v) => { const l = K.leads[id]; l.custom_fields_values = l.custom_fields_values.filter((c) => c.field_id !== fid); if (v !== null && v !== undefined) l.custom_fields_values.push({ field_id: fid, values: [{ value: v }] }); };
  K.field = (id, fid) => { const c = K.leads[id].custom_fields_values.find((x) => x.field_id === fid); return c ? c.values[0].value : undefined; };
  K.apply = (plan) => {
    for (const p of plan.leadPatches) { const l = K.leads[p.id]; if (p.status_id) l.status_id = p.status_id; for (const c of p.custom_fields_values || []) K.setField(p.id, c.field_id, c.values ? c.values[0].value : null); }
    for (const u of plan.taskUpdates) { const t = K.tasks.find((x) => x.id === u.id); t.is_completed = true; t.result = u.result; t.updated_at = K.now; }
    for (const c of plan.taskCreates) K.tasks.push({ ...c, id: K.nextTask++, is_completed: false, created_at: K.now, updated_at: K.now, result: [] });
    K.notes.push(...plan.notes);
  };
  K.run = (mode = 'motor') => { const plan = planCadencia({ now: K.now, leads: Object.values(K.leads).map((l) => JSON.parse(JSON.stringify(l))), tasks: JSON.parse(JSON.stringify(K.tasks)), mode }); K.apply(plan); return plan; };
  K.tick = (sec, runs = true) => { const end = K.now + sec; while (K.now < end) { K.now = Math.min(end, K.now + 60); if (runs) K.run(); } };
  K.open = (id) => K.tasks.filter((t) => t.entity_id === id && !t.is_completed).map((t) => keyOf(t.text) || 'MANUAL');
  K.openT = (id, key) => K.tasks.find((t) => t.entity_id === id && !t.is_completed && keyOf(t.text) === key);
  K.done = (id, key, txt = 'feito') => { const t = K.openT(id, key); if (!t) throw new Error('sem tarefa aberta ' + key); t.is_completed = true; t.result = { text: txt }; t.updated_at = K.now; };
  K.cancelled = (id, key) => K.tasks.filter((t) => t.entity_id === id && keyOf(t.text) === key && t.result && P.isRobotResult(t.result.text));
  return K;
}

console.log('\nTESTE 1 — lead entra → tarefa em 1 minuto');
{ const K = sim(); K.addLead(1); const p = K.run('novo');
  ok(p.taskCreates.length === 1 && keyOf(p.taskCreates[0].text) === 'NOVO', 'Eventos cria 🔥 LIGAR NOVO LEAD na hora');
  ok(p.taskCreates[0].complete_till - K.leads[1].created_at <= 60, 'prazo = até 1 min após a criação');
  K.run('novo'); ok(K.open(1).length === 1, 'rodar o evento de novo não duplica');
  K.tick(60); ok(K.open(1).join() === 'NOVO', 'motor não cria outra tarefa'); }

console.log('\nTESTE 1b — webhook perdido: motor cria a tarefa sozinho');
{ const K = sim(); K.addLead(1); K.tick(60); ok(K.open(1).length === 0, 'antes de 90s o motor espera o Eventos'); K.tick(60); ok(K.open(1).join() === 'NOVO', 'depois de 90s o motor cria (fallback)'); }

console.log('\nTESTE 2 — 5 min sem contato → alerta SLA (1 só)');
{ const K = sim(); K.addLead(1); K.run('novo'); K.tick(240); ok(!K.open(1).includes('SLA'), 'sem alerta com 4 min');
  K.tick(120); ok(K.open(1).filter((k) => k === 'SLA').length === 1, 'alerta 🚨 criado após 5 min');
  K.tick(600); ok(K.tasks.filter((t) => keyOf(t.text) === 'SLA').length === 1, 'continua 1 alerta só, mesmo 10 min depois');
  K.done(1, 'NOVO'); K.tick(60); ok(!K.open(1).includes('SLA') && K.cancelled(1, 'SLA').length === 1, 'alerta cancelado quando a 1ª tentativa é feita'); }

console.log('\nTESTE 3 — não atendeu → TENTANDO CONTATO + FOLLOW 2H');
{ const K = sim(); K.addLead(1); K.run('novo'); K.tick(60); K.done(1, 'NOVO'); const doneAt = K.now;
  K.tick(60); ok(K.leads[1].status_id === S.NOVO, 'espera 2 min de carência (vendedor pode mover)');
  K.tick(120); ok(K.leads[1].status_id === S.TENTANDO, 'moveu para TENTANDO CONTATO');
  K.tick(60); const t = K.openT(1, 'F2H'); ok(!!t, 'criou 📞 FOLLOW 2H — LIGAR');
  ok(t && Math.abs(t.complete_till - (doneAt + 7200)) <= 300, 'prazo ≈ 2h depois da 1ª tentativa');
  ok(K.field(1, F.PRIMEIRA) === doneAt && K.field(1, F.TENTATIVAS) === 1, 'registrou 1ª tentativa e nº de tentativas'); }

console.log('\nTESTE 4 — responde antes das 2h → follow cancelado');
{ const K = sim(); K.addLead(1); K.run('novo'); K.tick(60); K.done(1, 'NOVO'); K.tick(300);
  ok(K.open(1).includes('F2H'), 'FOLLOW 2H aberto'); K.tick(1800); K.setField(1, F.RESPOSTA, K.now); K.tick(60);
  ok(!K.open(1).includes('F2H') && K.cancelled(1, 'F2H').length === 1, 'FOLLOW 2H cancelado (🤖 CANCELADA)');
  console.log('\nTESTE 5 — respondeu → RESPONDEU + QUALIFICAR');
  ok(K.leads[1].status_id === S.RESPONDEU, 'moveu para RESPONDEU');
  ok(K.open(1).join() === 'QUAL', 'só 🎯 QUALIFICAR LEAD aberta');
  K.tick(3600); ok(K.open(1).join() === 'QUAL', 'nada de follow de contato depois da resposta (1h depois)');
  console.log('\nTESTE 6 — qualificado → cadência anterior cancelada, AGENDAR CALL');
  K.leads[1].status_id = S.QUALIFICADO; K.tick(60);
  ok(K.open(1).join() === 'AGENDAR' && K.cancelled(1, 'QUAL').length === 1, 'QUALIFICAR cancelada, 📅 AGENDAR CALL criada');
  console.log('\nTESTE 7 — call agendada → tarefa da reunião + lembrete');
  const call = K.now + 2 * 86400; K.setField(1, F.CALL, call); K.tick(60);
  ok(K.leads[1].status_id === S.CALL_AGENDADA, 'moveu para CALL AGENDADA');
  const ct = K.openT(1, 'CALL'); ok(ct && ct.complete_till === call && ct.task_type_id === 2, '📹 REALIZAR CALL no horário, tipo Reunião');
  ok(ct && ct.text.startsWith('▶ REALIZAR CALL — Maria Silva'), 'título com o nome do lead');
  ok(K.openT(1, 'LEMBRETE') && K.openT(1, 'LEMBRETE').complete_till === call - 3600, 'lembrete 1h antes');
  ok(K.open(1).sort().join() === 'CALL,LEMBRETE', 'AGENDAR cancelada, nada de prospecção aberto');
  const call2 = call + 3600; K.setField(1, F.CALL, call2); K.tick(60);
  ok(K.openT(1, 'CALL').complete_till === call2 && K.open(1).length === 2, 'reagendou: call antiga cancelada, nova criada, sem duplicar');
  K.now = call2 + 1800; K.done(1, 'LEMBRETE'); K.done(1, 'CALL'); K.tick(180);
  ok(K.leads[1].status_id === S.CALL_REALIZADA && K.open(1).join() === 'RESULT', 'call concluída → CALL REALIZADA + 📝 REGISTRAR RESULTADO');
  console.log('\nTESTE 8 — proposta enviada → cadência de proposta');
  K.setField(1, F.RESULTADO, 'Proposta apresentada'); K.tick(60);
  ok(K.leads[1].status_id === S.PROPOSTA, 'Resultado da call = Proposta apresentada → PROPOSTA / CONTRATO');
  const p1 = K.openT(1, 'P1'); ok(p1 && p1.complete_till >= K.now + 86400 - 120, '💬 FOLLOW PROPOSTA D+1 criado para ~D+1');
  K.now = p1.complete_till + 600; K.done(1, 'P1'); K.tick(180); ok(K.open(1).join() === 'P3', 'após D+1 feito → D+3');
  console.log('\nTESTE 9 — lead responde durante o follow → sequência pausada');
  K.setField(1, F.RESPOSTA, K.now); K.tick(60);
  ok(K.open(1).join() === 'RESPOSTA' && K.cancelled(1, 'P3').length === 1, 'P3 cancelada, 💬 ANALISAR RESPOSTA criada');
  K.tick(3 * 86400); ok(K.open(1).join() === 'RESPOSTA', 'nenhum follow automático enquanto a resposta não é analisada (3 dias)');
  K.done(1, 'RESPOSTA'); K.tick(180); const again = K.openT(1, 'P1');
  ok(again && again.complete_till >= K.now + 86400 - 400, 'após análise, cadência recomeça do D+1 a partir de agora');
  console.log('\nTESTE 10 — retorno combinado → genérico cancelado, retorno agendado');
  const ret = K.now + 3 * 3600; K.setField(1, F.RETORNO, ret); K.tick(60);
  ok(K.open(1).length === 1 && K.openT(1, 'RETORNO') && K.openT(1, 'RETORNO').complete_till === ret, 'só 📌 RETORNO COMBINADO no horário combinado');
  ok(K.cancelled(1, 'P1').length >= 1, 'follow genérico cancelado');
  K.now = ret + 60; K.done(1, 'RETORNO'); K.tick(180);
  ok(!K.field(1, F.RETORNO) && K.open(1).join() === 'P1', 'retorno feito → campo limpo e cadência retomada');
  console.log('\nTESTE 12 — fechado → tarefas comerciais canceladas');
  K.leads[1].status_id = S.GANHO; K.tick(60); ok(K.open(1).length === 0, 'nenhuma tarefa do robô aberta após FECHADO - GANHO'); }

console.log('\nTESTE 5b — "estou ocupado" não qualifica (regra 19)');
{ const K = sim(); K.addLead(1); K.run('novo'); K.setField(1, F.RESPOSTA, K.now + 30); K.tick(120);
  ok(K.leads[1].status_id === S.RESPONDEU, 'mensagem move só até RESPONDEU, nunca QUALIFICADO');
  ok(K.cancelled(1, 'NOVO').length === 1, '🔥 LIGAR NOVO LEAD cancelada (lead respondeu)'); }

console.log('\nTESTE 11 — mesmo webhook duas vezes → não duplica');
{ const K = sim(); K.addLead(1);
  const a = planCadencia({ now: K.now, leads: [K.leads[1]], tasks: [], mode: 'novo' });   // duas execuções simultâneas
  const b = planCadencia({ now: K.now, leads: [K.leads[1]], tasks: [], mode: 'novo' });   // vendo o mesmo estado
  K.apply(a); K.apply(b); ok(K.open(1).length === 2, '(corrida simulada: 2 criadas ao mesmo tempo)');
  const upd = dedupeTasks(K.tasks); K.apply({ leadPatches: [], taskUpdates: upd, taskCreates: [], notes: [] });
  ok(K.open(1).length === 1, 'dedupe pós-criação deixa só 1'); K.tick(120);
  ok(K.open(1).length === 1, 'motor mantém 1'); K.run('novo'); ok(K.open(1).length === 1, 'reenvio sequencial não cria'); }

console.log('\nTESTE 13 — perdido / não qualificado → motivo');
{ const K = sim(); K.addLead(1); K.run('novo'); K.tick(60); K.leads[1].status_id = S.NAO_QUALIFICADO; K.tick(60);
  ok(K.open(1).join() === 'MOTIVO', 'NÃO QUALIFICADO sem motivo → 📝 REGISTRAR MOTIVO (e LIGAR cancelada)');
  K.setField(1, F.MOTIVO_NQ, 'Não possui ótica'); K.tick(60); ok(K.open(1).length === 0, 'motivo preenchido → tarefa de motivo cancelada');
  const K2 = sim(); K2.addLead(2); K2.run('novo'); K2.tick(60); K2.leads[2].status_id = S.PERDIDO; K2.tick(60);
  ok(K2.open(2).join() === 'MOTIVO', 'FECHADO - PERDIDO sem motivo → pede motivo');
  K2.done(2, 'MOTIVO'); K2.tick(600); ok(K2.open(2).length === 0, 'não fica pedindo de novo'); }

console.log('\nCADÊNCIA COMPLETA sem resposta → NUTRIÇÃO');
{ const K = sim(); K.addLead(1); K.run('novo'); K.tick(60); K.done(1, 'NOVO'); K.tick(300);
  const seen = [];
  for (const key of ['F2H', 'FD1', 'FD2', 'FD4', 'FD7']) { const t = K.openT(1, key); if (!t) { seen.push(key + '?'); break; } seen.push(key + '@' + P.fmt(t.complete_till)); K.now = Math.max(K.now, t.complete_till) + 300; K.done(1, key); K.tick(300); }
  console.log('   ', seen.join('  '));
  ok(seen.length === 5 && !seen.some((s) => s.endsWith('?')), 'passou por 2H, D+1, D+2, D+4, D+7 (um de cada vez)');
  ok(K.leads[1].status_id === S.NUTRICAO && K.open(1).join() === 'REATIVAR', 'foi para NUTRIÇÃO / GELADEIRA com ♻️ AVALIAR REATIVAÇÃO em 30 dias');
  ok(K.field(1, F.TENTATIVAS) === 6, 'registrou 6 tentativas');
  const hours = K.tasks.map((t) => new Date((t.complete_till - 3 * 3600) * 1000)).filter((d) => d.getUTCDay() === 0);
  ok(hours.length === 0, 'nenhum follow no domingo'); }

console.log('\nREGRA — tarefa manual aberta é respeitada');
{ const K = sim(); K.addLead(1); K.leads[1].status_id = S.RESPONDEU; K.tasks.push({ id: 999, entity_id: 1, entity_type: 'leads', text: 'FOLLOW', is_completed: false, complete_till: K.now + 3600, created_at: K.now, updated_at: K.now, result: [] });
  K.tick(60); ok(K.open(1).join() === 'MANUAL', 'não cria QUALIFICAR enquanto houver tarefa manual');
  K.tasks.find((t) => t.id === 999).is_completed = true; K.tasks.find((t) => t.id === 999).updated_at = K.now; K.tick(60); ok(K.open(1).join() === 'QUAL', 'concluiu a manual → robô assume'); }

console.log('\nREGRA — segurar (pausa) em FOLLOW DECISÃO');
{ const K = sim(); K.addLead(1); K.leads[1].status_id = S.FOLLOW_DECISAO; K.tick(60); ok(K.open(1).join() === 'FDEC1', 'FOLLOW DECISÃO tem cadência própria (D+2)');
  const h = K.now + 10 * 86400; K.setField(1, F.SEGURAR, h); K.tick(60);
  ok(K.open(1).join() === 'SEGURAR' && K.openT(1, 'SEGURAR').complete_till === h, 'segurar: cadência pausada, 1 tarefa na data definida'); }

console.log(`\n${passes} ok, ${fails} falhas`);
process.exit(fails ? 1 : 0);
