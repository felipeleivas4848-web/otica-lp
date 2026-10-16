/* ============================================================
   ÓTICA COM IA — landing page
   Envio do formulário -> N8N (Kommo CRM + Meta CAPI).
   ============================================================ */

/* Página para onde o visitante vai depois de enviar o formulário. */
const PAGINA_OBRIGADO = "obrigado.html";

/* Webhooks do N8N: recebem o lead e cadastram no Kommo + Meta CAPI. */
const WEBHOOK_LEAD_PRINCIPAL = "https://n8n-n8n-start.uqrrdf.easypanel.host/webhook/95ea5f29-eaec-4304-8122-4ba50b4c0b2b";
const WEBHOOK_NEWSLETTER = "https://n8n-n8n-start.uqrrdf.easypanel.host/webhook/3f09c1f4-f606-45dd-87b2-41c9001c9e5d";

/* ---------- rastreamento: UTMs, fbclid, fbp, event_id ----------
   Guarda UTMs/fbclid da URL de chegada em sessionStorage, pra não perder
   se a pessoa navegar por outras páginas do site antes de preencher o
   formulário. */
const TRACKING_STORAGE_KEY = "oticaComIA_tracking_v1";
function capturarTrackingDaURL() {
  const params = new URLSearchParams(location.search);
  const campos = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "fbclid"];
  const capturado = {};
  let temAlgum = false;
  campos.forEach((c) => {
    const v = params.get(c);
    if (v) { capturado[c] = v; temAlgum = true; }
  });
  if (temAlgum) {
    try { sessionStorage.setItem(TRACKING_STORAGE_KEY, JSON.stringify(capturado)); } catch (e) {}
  }
}
function getTrackingSalvo() {
  try {
    return JSON.parse(sessionStorage.getItem(TRACKING_STORAGE_KEY) || "{}");
  } catch (e) { return {}; }
}
capturarTrackingDaURL();

function getCookie(nome) {
  const match = document.cookie.match(new RegExp("(?:^|; )" + nome + "=([^;]*)"));
  return match ? decodeURIComponent(match[1]) : "";
}
function gerarEventId() {
  if (window.crypto && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return "evt_" + Date.now() + "_" + Math.random().toString(16).slice(2);
}
function adicionarDadosDeRastreamento(dados) {
  const tracking = getTrackingSalvo();
  dados.set("utm_source", tracking.utm_source || "");
  dados.set("utm_medium", tracking.utm_medium || "");
  dados.set("utm_campaign", tracking.utm_campaign || "");
  dados.set("utm_content", tracking.utm_content || "");
  dados.set("utm_term", tracking.utm_term || "");
  dados.set("fbclid", tracking.fbclid || "");
  dados.set("fbp", getCookie("_fbp"));
  const eventId = gerarEventId();
  dados.set("event_id", eventId);
  return eventId;
}

/* ViewContent: dispara uma vez por carregamento de página (client-side). */
if (typeof fbq === "function") {
  fbq("track", "ViewContent", { content_name: document.title });
}

/* Grupos de resposta obrigatória (radios). */
const GRUPOS_OBRIGATORIOS = [
  "cargo", "ja_investe", "faturamento",
  "investimento_mensal", "objetivo", "inicio"
];

const form = document.getElementById("form-analise");
const statusEl = document.getElementById("form-status");

/* ============================================================
   Dados de contato: WhatsApp, telefone, Instagram, cidade/estado.
   Só confere o formato do que a pessoa digitou. Não existe consulta
   externa para saber se o número tem WhatsApp: quem confirma isso é a
   própria pessoa, na caixa "Confirmo que este número... possui WhatsApp".
   ============================================================ */
const DDDS_VALIDOS = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 24, 27, 28,
  31, 32, 33, 34, 35, 37, 38, 41, 42, 43, 44, 45, 46, 47, 48, 49,
  51, 53, 54, 55, 61, 62, 63, 64, 65, 66, 67, 68, 69,
  71, 73, 74, 75, 77, 79, 81, 82, 83, 84, 85, 86, 87, 88, 89,
  91, 92, 93, 94, 95, 96, 97, 98, 99
].map(String));

/* Só os dígitos de DDD + número (tira +55 e zeros na frente, se colarem). */
function digitosTelefone(valor) {
  let d = String(valor || "").replace(/\D/g, "");
  if (d.length > 11 && d.startsWith("55")) d = d.slice(2);
  d = d.replace(/^0+/, "");
  return d.slice(0, 11);
}
/* (38) 98552-1349 -> 5538985521349 (vazio se não tiver número). */
function normalizarTelefone(valor) {
  const d = digitosTelefone(valor);
  return d ? "55" + d : "";
}
function formatarTelefone(d) {
  if (d.length > 10)     return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length > 6)      return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  if (d.length > 2)      return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length > 0)      return `(${d}`;
  return "";
}
/* Mensagem de erro do número, ou "" se o formato está certo. */
function erroTelefone(valor, { soCelular }) {
  const d = digitosTelefone(valor);
  if (!d) return "Digite o número com DDD.";
  if (!DDDS_VALIDOS.has(d.slice(0, 2))) return "Confira o DDD: ele não existe.";
  if (soCelular) {
    if (d.length < 11) return "Número incompleto. Digite DDD + 9 dígitos, ex.: (38) 98552-1349.";
    if (d[2] !== "9") return "Esse não parece um número de celular. Digite o celular que você usa no WhatsApp.";
  } else {
    if (d.length < 10) return "Número incompleto. Digite DDD + número.";
    if (d.length === 11 && d[2] !== "9") return "Confira o número: celular começa com 9 depois do DDD.";
  }
  if (/^(\d)\1+$/.test(d.slice(2))) return "Confira o número digitado.";
  return "";
}

/* Instagram: aceita @usuario, usuario ou link do perfil -> devolve só o usuario. */
const IG_CAMINHOS_RESERVADOS = new Set(["p", "reel", "reels", "stories", "explore", "accounts", "tv", "direct"]);
function normalizarInstagram(valor) {
  let v = String(valor || "").trim();
  if (!v) return { usuario: "", erro: "" };
  const link = v.match(/(?:instagram\.com|instagr\.am)\/([^?#]*)/i);
  if (link) {
    const partes = link[1].split("/").filter(Boolean);
    if (!partes.length) return { usuario: "", erro: "Cole o link do perfil da ótica, ex.: instagram.com/suaotica" };
    if (IG_CAMINHOS_RESERVADOS.has(partes[0].toLowerCase()))
      return { usuario: "", erro: "Esse link é de uma publicação. Cole o link do perfil ou o @ da ótica." };
    v = partes[0];
  } else if (/^https?:|^www\.|\.com\b/i.test(v)) {
    return { usuario: "", erro: "Use o @ da ótica ou o link do perfil no Instagram." };
  }
  v = v.replace(/^@+/, "").toLowerCase();
  if (/\s/.test(v)) return { usuario: "", erro: "Digite o @ do perfil (sem espaços), não o nome da ótica." };
  if (!/^[a-z0-9._]{1,30}$/.test(v) || /^\.|\.$|\.\./.test(v))
    return { usuario: "", erro: "Esse @ não parece válido. Use só letras, números, ponto e _ (ex.: @suaotica)." };
  return { usuario: v, erro: "" };
}

/* Cidades do IBGE por estado (assets/municipios.json), pra só aceitar
   cidade que existe no estado escolhido. Se o arquivo não carregar,
   o campo vira texto livre (como era antes) pra não travar o envio. */
const scriptAtual = document.currentScript;
let CIDADES_POR_UF = null;
function normalizarNome(s) {
  return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[-'’`´]/g, " ").replace(/\s+/g, " ").trim();
}
function erroCidade(cidadeEl, estadoEl) {
  const uf = estadoEl.value;
  const nome = cidadeEl.value.trim();
  if (!uf) return "Escolha o estado primeiro.";
  if (!nome) return "Digite a cidade da ótica.";
  if (!CIDADES_POR_UF) return "";
  const alvo = normalizarNome(nome);
  const certa = (CIDADES_POR_UF[uf] || []).find((c) => normalizarNome(c) === alvo);
  if (certa) { cidadeEl.value = certa; return ""; } // grava com a grafia oficial
  const outrasUFs = Object.keys(CIDADES_POR_UF)
    .filter((k) => CIDADES_POR_UF[k].some((c) => normalizarNome(c) === alvo));
  if (outrasUFs.length)
    return `${nome} não fica em ${uf}. Ela fica em ${outrasUFs.join(" / ")}. Confira o estado.`;
  return `Não encontramos "${nome}" em ${uf}. Escolha a cidade na lista.`;
}

/* Aplica as regras nos campos que existirem na página. Devolve o 1º campo com erro. */
function validarContato(escopo) {
  const regras = [
    ["whatsapp", (el) => erroTelefone(el.value, { soCelular: true })],
    ["telefone_comercial", (el) => erroTelefone(el.value, { soCelular: false })],
    ["instagram", (el) => normalizarInstagram(el.value).erro],
    ["cidade", (el) => erroCidade(el, document.getElementById("estado"))],
    ["whatsapp_confirmado_usuario", (el) => el.checked ? "" :
      "Marque a confirmação de que o número está correto e possui WhatsApp."]
  ];
  let primeiro = null;
  for (const [id, regra] of regras) {
    const el = escopo.querySelector("#" + id);
    if (!el) continue;
    const erro = regra(el);
    el.setCustomValidity(erro);
    el.setAttribute("aria-invalid", erro ? "true" : "false");
    if (erro && !primeiro) primeiro = el;
  }
  return primeiro;
}

["whatsapp", "telefone_comercial"].forEach((id) => {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener("input", () => {
    const d = digitosTelefone(el.value);
    el.value = formatarTelefone(d);
    el.setCustomValidity("");
    el.removeAttribute("aria-invalid");
  });
});
["instagram", "cidade", "whatsapp_confirmado_usuario"].forEach((id) => {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener(el.type === "checkbox" ? "change" : "input", () => {
    el.setCustomValidity("");
    el.removeAttribute("aria-invalid");
  });
});

(function () {
  const estadoEl = document.getElementById("estado");
  const cidadeEl = document.getElementById("cidade");
  const lista = document.getElementById("cidades-lista");
  if (!estadoEl || !cidadeEl) return;

  function preencherLista() {
    if (!lista) return;
    lista.textContent = "";
    if (!CIDADES_POR_UF || !estadoEl.value) return;
    const frag = document.createDocumentFragment();
    (CIDADES_POR_UF[estadoEl.value] || []).forEach((c) => {
      const op = document.createElement("option");
      op.value = c;
      frag.appendChild(op);
    });
    lista.appendChild(frag);
  }
  function atualizarCidade() {
    const temUF = !!estadoEl.value;
    cidadeEl.disabled = !temUF;
    cidadeEl.placeholder = temUF ? "Digite a cidade" : "Escolha o estado primeiro";
    preencherLista();
    if (temUF && cidadeEl.value) {
      const erro = erroCidade(cidadeEl, estadoEl);
      cidadeEl.setCustomValidity(erro);
      cidadeEl.setAttribute("aria-invalid", erro ? "true" : "false");
    }
  }
  estadoEl.addEventListener("change", () => {
    atualizarCidade();
    if (!cidadeEl.value) cidadeEl.focus();
  });
  atualizarCidade();

  const urlCidades = new URL("municipios.json", (scriptAtual && scriptAtual.src) || location.href);
  fetch(urlCidades)
    .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then((dados) => { CIDADES_POR_UF = dados; atualizarCidade(); })
    .catch((err) => console.warn("[Ótica com IA] lista de cidades indisponível:", err));
})();

/* ---------- sombra no header ao rolar a página ---------- */
const siteHeader = document.querySelector(".site-header");
if (siteHeader) {
  const onScroll = () => siteHeader.classList.toggle("is-scrolled", window.scrollY > 8);
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });
}

/* ---------- números da faixa "contam" ao entrar na tela ----------
   O texto final já está no HTML (funciona sem JS); isto só troca por
   uns instantes por uma contagem crescente até o mesmo valor. */
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const statNumbers = document.querySelectorAll(".stats__v[data-target]");
if (statNumbers.length && !reduceMotion && "IntersectionObserver" in window) {
  const animateCount = (el) => {
    const target = parseFloat(el.dataset.target);
    const prefix = el.dataset.prefix || "";
    const suffix = el.dataset.suffix || "";
    const finalText = el.textContent;
    const duration = 900;
    const start = performance.now();

    function frame(now) {
      const p = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      el.textContent = prefix + Math.round(target * eased) + suffix;
      if (p < 1) requestAnimationFrame(frame);
      else el.textContent = finalText; // garante o texto/espaço exatos no final
    }
    requestAnimationFrame(frame);
  };

  const statsObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          animateCount(entry.target);
          statsObserver.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.6 }
  );
  statNumbers.forEach((el) => statsObserver.observe(el));
}

/* ---------- popup de captura de e-mail ---------- */
const POPUP_STORAGE_KEY = "oticaComIA_popup_v1";
(function () {
  const backdrop = document.getElementById("popup-backdrop");
  if (!backdrop) return; // não existe nesta página (ex.: obrigado.html)

  const closeBtn = document.getElementById("popup-close");
  const popupForm = document.getElementById("popup-form");
  const popupStatus = document.getElementById("popup-status");
  let disparado = false;

  const jaViu = () => {
    try { return localStorage.getItem(POPUP_STORAGE_KEY) === "1"; }
    catch (e) { return false; }
  };
  const marcarVisto = () => {
    try { localStorage.setItem(POPUP_STORAGE_KEY, "1"); } catch (e) {}
  };

  function abrirPopup() {
    if (disparado || jaViu()) return;
    disparado = true;
    backdrop.hidden = false;
    document.body.style.overflow = "hidden";
    setTimeout(() => document.getElementById("popup-email")?.focus(), 50);
  }
  function fecharPopup() {
    backdrop.hidden = true;
    document.body.style.overflow = "";
    marcarVisto();
  }

  closeBtn.addEventListener("click", fecharPopup);
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) fecharPopup(); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !backdrop.hidden) fecharPopup();
  });

  // dispara pelo que vier primeiro: 12s na página ou metade da rolagem
  setTimeout(abrirPopup, 12000);
  function onScroll() {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    if (max > 0 && window.scrollY / max > 0.5) {
      abrirPopup();
      window.removeEventListener("scroll", onScroll);
    }
  }
  window.addEventListener("scroll", onScroll, { passive: true });

  popupForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    popupStatus.textContent = "";
    popupStatus.removeAttribute("data-error");

    if (popupForm.querySelector('[name="_gotcha"]').value) return;
    if (!popupForm.checkValidity()) { popupForm.reportValidity(); return; }

    const btn = popupForm.querySelector('button[type="submit"]');
    const labelOriginal = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Enviando...";

    const dados = new URLSearchParams(new FormData(popupForm));
    dados.delete("_gotcha");
    dados.set("utm", location.search.replace(/^\?/, ""));
    dados.set("pagina", location.href);
    const eventId = adicionarDadosDeRastreamento(dados);

    try {
      // Cadastra o lead no Kommo + dispara Subscribe pro Meta CAPI (servidor).
      await fetch(WEBHOOK_NEWSLETTER, { method: "POST", mode: "no-cors", body: dados });
      // Meta Pixel: Advanced Matching (navegador). Só dispara se o Pixel já
      // estiver instalado na página (função fbq definida) — ver README-LP.md.
      // event_id igual ao mandado pro servidor -> Meta deduplica os dois.
      if (typeof fbq === "function") {
        fbq("track", "Subscribe", {}, { eventID: eventId });
      }
      popupStatus.textContent = "Prontinho! Fica de olho no seu e-mail.";
      setTimeout(fecharPopup, 1600);
    } catch (err) {
      console.error("[Ótica com IA] popup:", err);
      btn.disabled = false;
      btn.textContent = labelOriginal;
      popupStatus.textContent = "Não consegui enviar agora. Tenta de novo.";
      popupStatus.setAttribute("data-error", "");
    }
  });
})();

/* ---------- destaque visual da opção marcada (fallback p/ :has) ---------- */
if (form) {
  form.querySelectorAll(".opt input").forEach((inp) => {
    inp.addEventListener("change", () => {
      form.querySelectorAll(`.opt input[name="${inp.name}"]`).forEach((i) => {
        i.closest(".opt").classList.toggle("is-checked", i.checked);
      });
    });
  });
}

/* ---------- formulário em etapas: uma pergunta por vez ---------- */
if (form) {
  const passos = Array.from(form.querySelectorAll(".form-step"));
  const btnVoltar = document.getElementById("btn-voltar");
  const btnProxima = document.getElementById("btn-proxima");
  const btnEnviar = document.getElementById("btn-enviar");
  const progressoAtual = document.getElementById("form-progress-atual");
  const progressoBarra = document.getElementById("form-progress-bar");
  let passoAtual = 0;

  document.getElementById("form-progress-total").textContent = passos.length;

  function validarPasso(passo) {
    validarContato(passo);
    const campos = passo.querySelectorAll("input, select");
    for (const campo of campos) {
      if (!campo.checkValidity()) {
        campo.reportValidity();
        return false;
      }
    }
    return true;
  }

  function irParaPasso(indice) {
    fecharRevisao();
    passos[passoAtual].hidden = true;
    passoAtual = Math.max(0, Math.min(indice, passos.length - 1));
    passos[passoAtual].hidden = false;
    statusEl.textContent = "";

    progressoAtual.textContent = passoAtual + 1;
    progressoBarra.style.width = `${((passoAtual + 1) / passos.length) * 100}%`;

    btnVoltar.hidden = passoAtual === 0;
    const ultimoPasso = passoAtual === passos.length - 1;
    btnProxima.hidden = ultimoPasso;
    btnEnviar.hidden = !ultimoPasso;

    passos[passoAtual].scrollIntoView({ behavior: "smooth", block: "center" });
  }

  /* ---------- revisão dos dados antes do envio final ---------- */
  const revisao = document.getElementById("form-review");
  const revisaoLista = document.getElementById("form-review-list");
  const btnCorrigir = document.getElementById("btn-corrigir");
  const btnConfirmar = document.getElementById("btn-confirmar");
  const progresso = form.querySelector(".form-progress");

  function valorCampo(nome) {
    const el = form.elements[nome];
    return el && el.value ? el.value.trim() : "";
  }
  function passoDoCampo(nome) {
    const el = form.querySelector(`[name="${nome}"]`);
    return el ? passos.indexOf(el.closest(".form-step")) : -1;
  }

  function abrirRevisao() {
    const linhas = [
      ["Nome", valorCampo("nome"), "nome"],
      ["Ótica", valorCampo("otica"), "otica"],
      ["WhatsApp", valorCampo("whatsapp"), "whatsapp"],
      ["Telefone da ótica", valorCampo("telefone_comercial"), "telefone_comercial"],
      ["Cidade/Estado", `${valorCampo("cidade")}/${valorCampo("estado")}`, "cidade"],
      ["Instagram", form.elements.instagram
        ? (normalizarInstagram(valorCampo("instagram")).usuario
            ? "@" + normalizarInstagram(valorCampo("instagram")).usuario : "Não informado")
        : null, "instagram"]
    ].filter(([, , nome]) => form.elements[nome]);

    revisaoLista.textContent = "";
    linhas.forEach(([rotulo, valor, nome]) => {
      const linha = document.createElement("div");
      linha.className = "form-review__row";
      const dt = document.createElement("dt");
      dt.textContent = rotulo;
      const dd = document.createElement("dd");
      dd.textContent = valor;
      const alterar = document.createElement("button");
      alterar.type = "button";
      alterar.textContent = "Alterar";
      alterar.setAttribute("aria-label", `Alterar ${rotulo}`);
      alterar.addEventListener("click", () => irParaPasso(passoDoCampo(nome)));
      linha.append(dt, dd, alterar);
      revisaoLista.appendChild(linha);
    });

    passos[passoAtual].hidden = true;
    revisao.hidden = false;
    progresso.hidden = true;
    statusEl.textContent = "";
    btnVoltar.hidden = btnProxima.hidden = btnEnviar.hidden = true;
    btnCorrigir.hidden = btnConfirmar.hidden = false;
    revisao.scrollIntoView({ behavior: "smooth", block: "center" });
  }
  function fecharRevisao() {
    revisao.hidden = true;
    progresso.hidden = false;
    btnCorrigir.hidden = btnConfirmar.hidden = true;
  }
  form.emRevisao = () => !revisao.hidden;
  form.abrirRevisao = abrirRevisao;
  form.irParaPasso = (passo) => irParaPasso(passos.indexOf(passo));
  btnCorrigir.addEventListener("click", () => irParaPasso(0));

  btnProxima.addEventListener("click", () => {
    if (!validarPasso(passos[passoAtual])) return;
    irParaPasso(passoAtual + 1);
  });
  btnVoltar.addEventListener("click", () => irParaPasso(passoAtual - 1));

  // avança sozinho ao escolher uma opção (exceto na última pergunta)
  passos.forEach((passo, indice) => {
    passo.querySelectorAll('input[type="radio"]').forEach((radio) => {
      radio.addEventListener("change", () => {
        if (indice === passos.length - 1) return;
        setTimeout(() => irParaPasso(indice + 1), 350);
      });
    });
  });

  // Enter em campo de texto avança em vez de tentar enviar o formulário
  form.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const tag = e.target.tagName;
    if (tag !== "INPUT" && tag !== "SELECT") return;
    if (passoAtual === passos.length - 1) return;
    e.preventDefault();
    btnProxima.click();
  });
}

/* ---------- envio ---------- */
if (form) {
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    statusEl.textContent = "";

    // honeypot anti-spam: se preenchido, ignora silenciosamente
    if (form.querySelector('[name="_gotcha"]').value) return;

    // valida grupos de radio
    for (const nome of GRUPOS_OBRIGATORIOS) {
      if (!form.querySelector(`input[name="${nome}"]:checked`)) {
        statusEl.textContent = "Responda todas as perguntas para enviar.";
        form.querySelector(`input[name="${nome}"]`)
            .closest("fieldset")
            .scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }
    }

    // valida WhatsApp/telefone/Instagram/cidade + campos nativos (texto, select, tel)
    const campoComErro = validarContato(form);
    if (campoComErro || !form.checkValidity()) {
      const alvo = campoComErro || form.querySelector(":invalid");
      const passo = alvo && alvo.closest(".form-step");
      // volta para a pergunta com problema antes de mostrar o aviso
      if (passo && passo.hidden && form.irParaPasso) form.irParaPasso(passo);
      setTimeout(() => (alvo || form).reportValidity(), 50);
      return;
    }

    // 1º clique: mostra "Confirme seus dados". O lead só é criado no
    // "Confirmar e enviar".
    if (form.emRevisao && !form.emRevisao()) {
      form.abrirRevisao();
      return;
    }

    const btn = document.getElementById("btn-confirmar") || form.querySelector('button[type="submit"]');
    const labelOriginal = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Enviando...";

    // monta o payload
    const dados = new URLSearchParams(new FormData(form));
    dados.delete("_gotcha");
    // contato limpo: Instagram só com o usuário, telefones só com dígitos (55 + DDD + número)
    if (form.elements.instagram) dados.set("instagram", normalizarInstagram(form.elements.instagram.value).usuario);
    dados.set("whatsapp_normalizado", normalizarTelefone(form.elements.whatsapp.value));
    if (form.elements.telefone_comercial)
      dados.set("telefone_comercial_normalizado", normalizarTelefone(form.elements.telefone_comercial.value));
    // true = a pessoa DECLAROU que o número tem WhatsApp (não é validação por API)
    const confirmou = form.elements.whatsapp_confirmado_usuario;
    dados.set("whatsapp_confirmado_usuario", confirmou && confirmou.checked ? "true" : "false");
    dados.set("utm", location.search.replace(/^\?/, ""));
    dados.set("pagina", location.href);
    dados.set("enviado_em", new Date().toISOString());
    const eventId = adicionarDadosDeRastreamento(dados);

    try {
      // Cadastra o lead no Kommo (com UTMs/fbclid/fbp) e dispara Lead pro Meta CAPI (servidor).
      await fetch(WEBHOOK_LEAD_PRINCIPAL, { method: "POST", mode: "no-cors", body: dados });
      // Meta Pixel (navegador) com o mesmo event_id -> Meta deduplica client x servidor.
      if (typeof fbq === "function") {
        fbq("track", "Lead", {}, { eventID: eventId });
      }
      // já converteu -> não precisa mais do popup de e-mail
      try { localStorage.setItem(POPUP_STORAGE_KEY, "1"); } catch (err) {}
      // deu certo -> vai para a página de obrigado
      window.location.href = PAGINA_OBRIGADO;
    } catch (err) {
      console.error("[Ótica com IA] Falha ao enviar:", err);
      btn.disabled = false;
      btn.textContent = labelOriginal;
      statusEl.textContent =
        "Não consegui enviar agora. Confira sua conexão e tente novamente.";
    }
  });
}

/* Celular: o botão do formulário é fixo no rodapé (styles.css). Só mostra com o formulário na tela. */
(function () {
  const secao = document.querySelector(".section--form");
  if (!secao) return;
  function confere() {
    const r = secao.getBoundingClientRect();
    document.body.classList.toggle("form-na-tela", r.top < window.innerHeight * 0.85 && r.bottom > 0);
  }
  window.addEventListener("scroll", confere, { passive: true });
  window.addEventListener("resize", confere);
  confere();
})();
