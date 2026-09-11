/**
 * ÓTICA COM IA — recebe os envios da landing page e grava na planilha,
 * automaticamente. Dois formulários usam este mesmo endpoint:
 *   1) o formulário completo de qualificação -> aba "Leads"
 *   2) o popup de e-mail (captura rápida)     -> aba "Emails"
 *
 * ---------------------------------------------------------------
 * INSTALAÇÃO (uma vez)
 * ---------------------------------------------------------------
 * 1. Crie/abra a planilha do Google Sheets que vai receber os leads.
 * 2. Menu: Extensões > Apps Script.
 * 3. Apague o conteúdo padrão e cole este arquivo inteiro. Salve (Ctrl+S).
 * 4. Botão "Implantar" > "Nova implantação".
 *      - Tipo:               App da Web
 *      - Descrição:          Ótica com IA - formulário
 *      - Executar como:      Eu (seu e-mail)
 *      - Quem pode acessar:  Qualquer pessoa
 *    "Implantar" > autorize o acesso à sua conta quando pedir.
 * 5. Copie a URL do App da Web (termina em /exec).
 * 6. Cole essa URL em  assets/script.js  na constante SHEETS_ENDPOINT.
 * 7. Teste: preencha o formulário e o popup no site. Deve aparecer uma
 *    linha nova nas abas "Leads" e "Emails" em 1 a 2 segundos.
 *
 * ---------------------------------------------------------------
 * QUANDO ALTERAR ESTE SCRIPT DEPOIS
 * ---------------------------------------------------------------
 * "Implantar" > "Gerenciar implantações" > (ícone de lápis) >
 * Versão: "Nova versão" > "Implantar".  A URL continua a mesma.
 */

var SHEET_NAME = 'Leads';
var SHEET_EMAILS = 'Emails';

// Ordem das colunas na aba "Leads". O cabeçalho é criado automaticamente.
var COLUNAS = [
  'data_hora', 'nome', 'otica', 'cidade', 'estado', 'whatsapp',
  'cargo', 'ja_investe', 'faturamento', 'investimento_mensal',
  'objetivo', 'inicio', 'origem', 'utm', 'pagina', 'enviado_em'
];

// Ordem das colunas na aba "Emails" (popup de captura rápida).
var COLUNAS_EMAIL = ['data_hora', 'email', 'origem', 'utm', 'pagina'];

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var p = (e && e.parameter) || {};

    // honeypot anti-spam
    if (p._gotcha) {
      return _json({ ok: true, ignored: true });
    }

    var ss = SpreadsheetApp.getActiveSpreadsheet();

    if (p.tipo === 'popup_email') {
      _appendRow(ss, SHEET_EMAILS, COLUNAS_EMAIL, p);
      return _json({ ok: true });
    }

    _appendRow(ss, SHEET_NAME, COLUNAS, p);
    return _json({ ok: true });
  } catch (err) {
    return _json({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function _appendRow(ss, nomeAba, colunas, p) {
  var sheet = ss.getSheetByName(nomeAba);
  if (!sheet) sheet = ss.insertSheet(nomeAba);
  if (sheet.getLastRow() === 0) sheet.appendRow(colunas);

  var linha = colunas.map(function (col) {
    if (col === 'data_hora') return new Date();
    return p[col] || '';
  });
  sheet.appendRow(linha);
}

// Só para testar no navegador se a implantação está de pé.
function doGet() {
  return _json({ ok: true, service: 'otica-com-ia', hint: 'envie via POST' });
}

function _json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
