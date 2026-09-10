/* ============================================================
   ÓTICA COM IA — landing page
   Envio do formulário -> Google Sheets (via Apps Script Web App).
   ============================================================ */

/* 1) Crie a planilha e o Apps Script (passo a passo no README.md).
   2) Cole aqui a URL do App da Web (termina em /exec). */
const SHEETS_ENDPOINT = "https://script.google.com/macros/s/AKfycbyY5_-0vs8Q1y0WaJOzcwF3cgWOd3KUJW2AhjRwT3ckiCC0MRZ354IqCx80XDmlMR9Dng/exec"; // <-- COLE A URL AQUI

/* Grupos de resposta obrigatória (radios). */
const GRUPOS_OBRIGATORIOS = [
  "cargo", "ja_investe", "faturamento",
  "investimento_mensal", "objetivo", "inicio"
];

const form = document.getElementById("form-analise");
const statusEl = document.getElementById("form-status");
const successEl = document.getElementById("form-success");

/* ---------- máscara de WhatsApp: (00) 00000-0000 ---------- */
const wpp = document.getElementById("whatsapp");
if (wpp) {
  wpp.addEventListener("input", () => {
    let v = wpp.value.replace(/\D/g, "").slice(0, 11);
    if (v.length > 6)      v = `(${v.slice(0, 2)}) ${v.slice(2, 7)}-${v.slice(7)}`;
    else if (v.length > 2) v = `(${v.slice(0, 2)}) ${v.slice(2)}`;
    else if (v.length > 0) v = `(${v}`;
    wpp.value = v;
  });
}

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

    // valida campos nativos (texto, select, tel)
    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }

    const btn = form.querySelector('button[type="submit"]');
    const labelOriginal = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Enviando...";

    // monta o payload
    const dados = new URLSearchParams(new FormData(form));
    dados.delete("_gotcha");
    dados.set("utm", location.search.replace(/^\?/, ""));
    dados.set("pagina", location.href);
    dados.set("enviado_em", new Date().toISOString());

    try {
      if (SHEETS_ENDPOINT) {
        await fetch(SHEETS_ENDPOINT, {
          method: "POST",
          mode: "no-cors",
          body: dados
        });
      } else {
        console.warn(
          "[Ótica com IA] SHEETS_ENDPOINT está vazio. " +
          "Configure a URL do Apps Script em assets/script.js. Envio simulado."
        );
      }
      form.hidden = true;
      successEl.hidden = false;
      successEl.scrollIntoView({ behavior: "smooth", block: "center" });
    } catch (err) {
      console.error("[Ótica com IA] Falha ao enviar:", err);
      btn.disabled = false;
      btn.textContent = labelOriginal;
      statusEl.textContent =
        "Não consegui enviar agora. Confira sua conexão e tente novamente.";
    }
  });
}
