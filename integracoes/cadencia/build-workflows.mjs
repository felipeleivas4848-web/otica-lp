// Gera (e opcionalmente publica) os 2 workflows n8n da cadência, embutindo planner.js.
//   node build-workflows.mjs            → só gera dist/*.json
//   node build-workflows.mjs --deploy   → gera + cria/atualiza no n8n + ativa
// IDs dos workflows publicados ficam em workflows.json (não é segredo).
// Tokens são lidos de ../.env.secrets (gitignorado).
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const PLANNER = fs.readFileSync(path.join(DIR, 'planner.js'), 'utf8');
const KOMMO = 'https://poloads.kommo.com';
const CRED = { kommoOAuth2Api: { id: 'rLBADkjMCx59OD4I', name: '2.0 Kommo N8n' } };
const IDS_FILE = path.join(DIR, 'workflows.json');
const ids = fs.existsSync(IDS_FILE) ? JSON.parse(fs.readFileSync(IDS_FILE, 'utf8')) : {};
if (!ids.eventsWebhookPath) ids.eventsWebhookPath = crypto.randomUUID();

const PARSE = `const parseBody = (j) => { let b = j && (j.body !== undefined ? j.body : (j.data !== undefined ? j.data : j)); if (typeof b === 'string') { try { b = b ? JSON.parse(b) : {}; } catch (e) { b = {}; } } return b || {}; };`;

let y = 0;
const node = (name, type, typeVersion, parameters, x, extra = {}) => ({ id: crypto.randomUUID(), name, type, typeVersion, position: [x, y], parameters, ...extra });
const code = (name, js, x) => node(name, 'n8n-nodes-base.code', 2, { jsCode: js }, x);
const http = (name, x, { method = '={{ $json.method }}', body = true } = {}) => node(name, 'n8n-nodes-base.httpRequest', 4.2, {
  method, url: `={{ '${KOMMO}' + $json.url }}`,
  authentication: 'predefinedCredentialType', nodeCredentialType: 'kommoOAuth2Api',
  ...(body ? { sendBody: true, specifyBody: 'json', jsonBody: '={{ JSON.stringify($json.body) }}' } : {}),
  options: { response: { response: { fullResponse: true, neverError: true, responseFormat: 'json' } } },
}, x, { credentials: CRED });
const checkErrors = (name, x) => code(name, `${PARSE}
// neverError=true no HTTP: aqui transformamos resposta 4xx/5xx do Kommo em erro visível no n8n
const erros = [];
for (const it of $input.all()) { const s = it.json.statusCode; if (s >= 400) erros.push(s + ' ' + JSON.stringify(parseBody(it.json)).slice(0, 400)); }
if (erros.length) throw new Error('Kommo recusou ' + erros.length + ' requisição(ões): ' + erros.join(' | '));
return [{ json: { ok: true, requisicoes: $input.all().length } }];`, x);
const connect = (...names) => { const c = {}; for (let i = 0; i < names.length - 1; i++) c[names[i]] = { main: [[{ node: names[i + 1], type: 'main', index: 0 }]] }; return c; };

// =====================================================================
// MOTOR — roda a cada 1 minuto, reconcilia todos os leads ativos da Ótica
// =====================================================================
y = 0;
const ACTIVE = [107441747, 112334559, 108142683, 107441751, 107442027, 112334563, 107442031, 107442039, 112334567, 112334571];
const motorNodes = [
  node('A cada 1 minuto', 'n8n-nodes-base.scheduleTrigger', 1.2, { rule: { interval: [{ field: 'minutes', minutesInterval: 1 }] } }, 0),
  code('Montar busca de leads', `// Leads ativos do funil ÓTICA COM IA + fechados alterados nos últimos 3 dias
const P = 13923191;
const ativos = ${JSON.stringify(ACTIVE)}.map((s, i) => 'filter[statuses][' + i + '][pipeline_id]=' + P + '&filter[statuses][' + i + '][status_id]=' + s).join('&');
const fechados = [142, 143].map((s, i) => 'filter[statuses][' + i + '][pipeline_id]=' + P + '&filter[statuses][' + i + '][status_id]=' + s).join('&');
const desde = Math.floor(Date.now() / 1000) - 3 * 86400;
return [
  { json: { method: 'GET', url: '/api/v4/leads?limit=250&' + ativos } },
  { json: { method: 'GET', url: '/api/v4/leads?limit=250&filter[updated_at][from]=' + desde + '&' + fechados } },
];`, 220),
  http('Kommo · Buscar leads', 440, { body: false }),
  code('Montar busca de tarefas', `${PARSE}
const ids = new Set();
for (const it of $input.all()) { const b = parseBody(it.json); const arr = (b._embedded && b._embedded.leads) || []; if (arr.length >= 250) throw new Error('mais de 250 leads — implementar paginação'); arr.forEach((l) => ids.add(l.id)); }
const list = [...ids];
const out = [];
for (let i = 0; i < list.length; i += 10) out.push({ json: { method: 'GET', url: '/api/v4/tasks?limit=250&filter[entity_type]=leads&' + list.slice(i, i + 10).map((id) => 'filter[entity_id][]=' + id).join('&') } });
return out;`, 660),
  http('Kommo · Buscar tarefas', 880, { body: false }),
  code('Planejar cadência', `${PLANNER}
// ---------------- runner (Motor) ----------------
${PARSE}
const leadsById = {};
for (const it of $('Kommo · Buscar leads').all()) { const b = parseBody(it.json); for (const l of ((b._embedded && b._embedded.leads) || [])) leadsById[l.id] = l; }
const tasks = [];
for (const it of $input.all()) { const b = parseBody(it.json); const arr = (b._embedded && b._embedded.tasks) || []; if (arr.length >= 250) throw new Error('mais de 250 tarefas num lote — reduzir o lote'); tasks.push(...arr); }
const plan = planCadencia({ now: Math.floor(Date.now() / 1000), leads: Object.values(leadsById), tasks, mode: 'motor', origin: 'motor (a cada 1 min)' });
const reqs = planToRequests(plan);
return reqs.map((r, i) => ({ json: i === 0 ? { ...r, log: plan.log } : r }));`, 1100),
  http('Kommo · Executar ações', 1320),
  checkErrors('Verificar erros', 1540),
];
const motor = {
  name: 'CADÊNCIA ÓTICA · Motor (1 min)',
  nodes: motorNodes,
  connections: connect(...motorNodes.map((n) => n.name)),
  settings: { executionOrder: 'v1', saveDataSuccessExecution: 'none', saveDataErrorExecution: 'all', saveManualExecutions: true },
};

// =====================================================================
// EVENTOS — webhook da conta Kommo (add_lead + add_message)
// =====================================================================
y = 0;
const ev = [];
ev.push(node('Webhook Kommo', 'n8n-nodes-base.webhook', 2.1, { httpMethod: 'POST', path: ids.eventsWebhookPath, options: {} }, 0, { webhookId: ids.eventsWebhookPath }));
ev.push(code('Extrair eventos', `// Kommo manda x-www-form-urlencoded: chaves "leads[add][0][id]", "message[add][0][type]"...
const out = []; const msgs = {};
for (const it of $input.all()) {
  const b = it.json.body || {};
  const get = (p) => b[p];
  for (let i = 0; i < 100; i++) {
    const id = get('leads[add][' + i + '][id]'); if (!id) break;
    if (String(get('leads[add][' + i + '][pipeline_id]')) === '13923191') out.push({ json: { kind: 'novo', lead_id: Number(id) } });
  }
  for (let i = 0; i < 100; i++) {
    if (!get('message[add][' + i + '][id]')) break;
    if (get('message[add][' + i + '][type]') !== 'incoming') continue;          // só mensagem DO lead
    if (get('message[add][' + i + '][entity_type]') !== 'lead') continue;
    const lid = Number(get('message[add][' + i + '][entity_id]'));
    const at = Number(get('message[add][' + i + '][created_at]')) || Math.floor(Date.now() / 1000);
    msgs[lid] = Math.max(msgs[lid] || 0, at);
  }
}
for (const [lid, at] of Object.entries(msgs)) out.push({ json: { kind: 'msg', lead_id: Number(lid), at } });
return out;`, 220));
ev.push(node('É mensagem?', 'n8n-nodes-base.if', 2.2, {
  conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 }, combinator: 'and',
    conditions: [{ id: crypto.randomUUID(), leftValue: '={{ $json.kind }}', rightValue: 'msg', operator: { type: 'string', operation: 'equals' } }] },
  options: {},
}, 440));
// ramo mensagem (y=-200)
y = -200;
ev.push(code('URL lead (msg)', `return $input.all().map((it) => ({ json: { method: 'GET', url: '/api/v4/leads/' + it.json.lead_id } }));`, 660));
ev.push(http('Kommo · Lead (msg)', 880, { body: false }));
ev.push(code('Registrar resposta', `${PARSE}
// Grava "🤖 Última resposta do lead em" — o Motor usa isso para cancelar a cadência / pausar follows.
const FIELD = 1143230;
const at = {}; for (const it of $('Extrair eventos').all()) if (it.json.kind === 'msg') at[it.json.lead_id] = it.json.at;
const patches = [];
for (const it of $input.all()) {
  const l = parseBody(it.json);
  if (!l || l.pipeline_id !== 13923191 || !at[l.id]) continue;
  const cf = (l.custom_fields_values || []).find((c) => c.field_id === FIELD);
  const atual = cf ? Number(cf.values[0].value) : 0;
  if (at[l.id] > atual) patches.push({ id: l.id, custom_fields_values: [{ field_id: FIELD, values: [{ value: at[l.id] }] }] });
}
return patches.length ? [{ json: { method: 'PATCH', url: '/api/v4/leads', body: patches } }] : [];`, 1100));
ev.push(http('Kommo · Gravar resposta', 1320));
ev.push(checkErrors('Verificar erros (msg)', 1540));
// ramo lead novo (y=200)
y = 200;
ev.push(node('Espera aleatória', 'n8n-nodes-base.wait', 1.1, { amount: '={{ Math.round(Math.random() * 30) / 10 }}', unit: 'seconds' }, 660, { webhookId: crypto.randomUUID() }));
ev.push(code('URL lead (novo)', `return $input.all().map((it) => ({ json: { method: 'GET', url: '/api/v4/leads/' + it.json.lead_id } }));`, 880));
ev.push(http('Kommo · Lead (novo)', 1100, { body: false }));
ev.push(code('URL tarefas (novo)', `${PARSE}
const out = [];
for (const it of $input.all()) { const l = parseBody(it.json); if (l && l.id) out.push({ json: { method: 'GET', url: '/api/v4/tasks?limit=250&filter[entity_type]=leads&filter[entity_id][]=' + l.id, lead: l } }); }
return out;`, 1320));
ev.push(http('Kommo · Tarefas (novo)', 1540, { body: false }));
ev.push(code('Planejar 1ª tarefa', `${PLANNER}
// ---------------- runner (Eventos / lead novo) ----------------
${PARSE}
const leads = $('URL tarefas (novo)').all().map((it) => it.json.lead);
const tasks = []; for (const it of $input.all()) { const b = parseBody(it.json); tasks.push(...((b._embedded && b._embedded.tasks) || [])); }
const plan = planCadencia({ now: Math.floor(Date.now() / 1000), leads, tasks, mode: 'novo', origin: 'webhook add_lead (tempo real)' });
return planToRequests(plan).map((r) => ({ json: r }));`, 1760));
ev.push(http('Kommo · Criar 1ª tarefa', 1980));
ev.push(checkErrors('Verificar erros (novo)', 2200));
ev.push(node('Espera 3s', 'n8n-nodes-base.wait', 1.1, { amount: 3, unit: 'seconds' }, 2420, { webhookId: crypto.randomUUID() }));
ev.push(code('URL verificação', `return $('URL tarefas (novo)').all().map((it) => ({ json: { method: 'GET', url: it.json.url } }));`, 2640));
ev.push(http('Kommo · Tarefas (verificação)', 2860, { body: false }));
ev.push(code('Remover duplicadas', `${PLANNER}
// ---------------- runner (dedupe pós-criação) ----------------
${PARSE}
const tasks = []; for (const it of $input.all()) { const b = parseBody(it.json); tasks.push(...((b._embedded && b._embedded.tasks) || [])); }
const upd = dedupeTasks(tasks);
return upd.length ? [{ json: { method: 'PATCH', url: '/api/v4/tasks', body: upd } }] : [];`, 3080));
ev.push(http('Kommo · Concluir duplicadas', 3300));
ev.push(checkErrors('Verificar erros (dedupe)', 3520));

const evConn = connect('Webhook Kommo', 'Extrair eventos', 'É mensagem?');
evConn['É mensagem?'] = { main: [[{ node: 'URL lead (msg)', type: 'main', index: 0 }], [{ node: 'Espera aleatória', type: 'main', index: 0 }]] };
Object.assign(evConn, connect('URL lead (msg)', 'Kommo · Lead (msg)', 'Registrar resposta', 'Kommo · Gravar resposta', 'Verificar erros (msg)'));
Object.assign(evConn, connect('Espera aleatória', 'URL lead (novo)', 'Kommo · Lead (novo)', 'URL tarefas (novo)', 'Kommo · Tarefas (novo)', 'Planejar 1ª tarefa',
  'Kommo · Criar 1ª tarefa', 'Verificar erros (novo)', 'Espera 3s', 'URL verificação', 'Kommo · Tarefas (verificação)', 'Remover duplicadas', 'Kommo · Concluir duplicadas', 'Verificar erros (dedupe)'));
const eventos = {
  name: 'CADÊNCIA ÓTICA · Eventos Kommo (lead novo + mensagem)',
  nodes: ev, connections: evConn,
  settings: { executionOrder: 'v1', saveDataSuccessExecution: 'all', saveDataErrorExecution: 'all' },
};

fs.mkdirSync(path.join(DIR, 'dist'), { recursive: true });
fs.writeFileSync(path.join(DIR, 'dist', 'motor.json'), JSON.stringify(motor, null, 1));
fs.writeFileSync(path.join(DIR, 'dist', 'eventos.json'), JSON.stringify(eventos, null, 1));
fs.writeFileSync(IDS_FILE, JSON.stringify(ids, null, 1));
console.log('gerado dist/motor.json e dist/eventos.json');

if (process.argv.includes('--deploy')) {
  const env = {};
  for (const l of fs.readFileSync(path.join(DIR, '..', '.env.secrets'), 'utf8').split(/\r?\n/)) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim(); }
  const base = env.N8N_BASE_URL.replace(/\/$/, '');
  const api = async (method, p, body) => {
    const r = await fetch(base + p, { method, headers: { 'X-N8N-API-KEY': env.N8N_API_KEY, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
    if (r.status >= 300) throw new Error(`${method} ${p} → ${r.status} ${t.slice(0, 500)}`);
    return j;
  };
  for (const [key, wf] of [['motorId', motor], ['eventosId', eventos]]) {
    if (ids[key]) { await api('PUT', `/api/v1/workflows/${ids[key]}`, wf); console.log('atualizado', wf.name, ids[key]); }
    else { const c = await api('POST', '/api/v1/workflows', wf); ids[key] = c.id; console.log('criado', wf.name, c.id); }
    fs.writeFileSync(IDS_FILE, JSON.stringify(ids, null, 1));
    if (!process.argv.includes('--no-activate')) { const a = await api('POST', `/api/v1/workflows/${ids[key]}/activate`); console.log('  ativo:', a.active); }
  }
  console.log('URL do webhook de eventos:', `${base}/webhook/${ids.eventsWebhookPath}`);
}
