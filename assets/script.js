/* ============================================================
   ÓTICA COM IA — landing page
   Envio do formulário -> Google Sheets (via Apps Script Web App).
   ============================================================ */

/* 1) Crie a planilha e o Apps Script (passo a passo no README.md).
   2) Cole aqui a URL do App da Web (termina em /exec). */
const SHEETS_ENDPOINT = "https://script.google.com/macros/s/AKfycbyY5_-0vs8Q1y0WaJOzcwF3cgWOd3KUJW2AhjRwT3ckiCC0MRZ354IqCx80XDmlMR9Dng/exec"; // <-- COLE A URL AQUI

/* Página para onde o visitante vai depois de enviar o formulário. */
const PAGINA_OBRIGADO = "obrigado.html";

/* Grupos de resposta obrigatória (radios). */
const GRUPOS_OBRIGATORIOS = [
  "cargo", "ja_investe", "faturamento",
  "investimento_mensal", "objetivo", "inicio"
];

const form = document.getElementById("form-analise");
const statusEl = document.getElementById("form-status");

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

    const email = popupForm.querySelector("#popup-email").value.trim();
    const dados = new URLSearchParams(new FormData(popupForm));
    dados.delete("_gotcha");
    dados.set("utm", location.search.replace(/^\?/, ""));
    dados.set("pagina", location.href);

    try {
      if (SHEETS_ENDPOINT) {
        await fetch(SHEETS_ENDPOINT, { method: "POST", mode: "no-cors", body: dados });
      }
      // Meta Pixel: Advanced Matching. Só dispara se o Pixel já estiver
      // instalado na página (função fbq definida) — ver README-LP.md.
      if (typeof fbq === "function") {
        fbq("track", "Lead", {}, { em: email });
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
