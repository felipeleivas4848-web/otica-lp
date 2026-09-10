/**
 * ÓTICA COM IA — recebe os envios do formulário da landing page
 * e grava uma linha na aba "Leads" da planilha, automaticamente.
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
 * 7. Teste: preencha o formulário no site. Deve aparecer uma linha nova
 *    na aba "Leads" em 1 a 2 segundos.
 *
 * ---------------------------------------------------------------
 * QUANDO ALTERAR ESTE SCRIPT DEPOIS
 * ---------------------------------------------------------------
 * "Implantar" > "Gerenciar implantações" > (ícone de lápis) >
 * Versão: "Nova versão" > "Implantar".  A URL continua a mesma.
 */

var SHEET_NAME = 'Leads';

// Ordem das colunas na planilha. O cabeçalho é criado automaticamente.
var COLUNAS = [
  'data_hora', 'nome', 'otica', 'cidade', 'estado', 'whatsapp',
  'cargo', 'ja_investe', 'faturamento', 'investimento_mensal',
  'objetivo', 'inicio', 'origem', 'utm', 'pagina', 'enviado_em'
];

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
    var sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet) sheet = ss.insertSheet(SHEET_NAME);
    if (sheet.getLastRow() === 0) sheet.appendRow(COLUNAS);

    var linha = COLUNAS.map(function (col) {
      if (col === 'data_hora') return new Date();
      return p[col] || '';
    });
    sheet.appendRow(linha);

    return _json({ ok: true });
  } catch (err) {
    return _json({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
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
