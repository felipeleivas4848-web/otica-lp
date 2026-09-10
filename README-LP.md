# Ótica com IA — Landing Page (página de vendas)

Página de vendas estática (HTML/CSS/JS puro) para captar donos de óticas.
O formulário final envia os leads **direto para uma planilha do Google Sheets**,
automaticamente, sem backend.

> Esta LP é separada do app SaaS (`PROMPT-MESTRE-LOVABLE.md` / `supabase-schema.sql`).
> É só o site de captação.

## Arquivos

```
index.html            → a página inteira (15 seções + rodapé)
obrigado.html          → página de agradecimento (destino do formulário)
assets/styles.css      → tema dark premium (cores em variáveis no topo)
assets/script.js       → máscara de WhatsApp, validação e envio pro Sheets
apps-script/Codigo.gs   → script que recebe o formulário e escreve na planilha
```

Ao enviar o formulário com sucesso, o visitante é redirecionado para
`obrigado.html`. Para mudar o destino, edite `PAGINA_OBRIGADO` em `assets/script.js`.

## Testar no seu computador

- Abra `index.html` no navegador (duplo clique), **ou**
- No VS Code, use a extensão **Live Server** (recomendado).

Sem a URL do Apps Script configurada, o formulário funciona em modo simulado:
valida os campos e mostra a tela de sucesso, mas não grava em lugar nenhum
(aparece um aviso no Console do navegador).

## Ligar o envio para o Google Sheets (automático)

1. Crie uma planilha nova no Google Sheets.
2. Menu **Extensões → Apps Script**.
3. Apague o código padrão, cole todo o conteúdo de `apps-script/Codigo.gs`, salve.
4. **Implantar → Nova implantação**:
   - Tipo: **App da Web**
   - Executar como: **Eu**
   - Quem pode acessar: **Qualquer pessoa**
   - **Implantar** e autorize o acesso à sua conta Google.
5. Copie a **URL do App da Web** (termina em `/exec`).
6. Abra `assets/script.js` e cole a URL na constante:
   ```js
   const SHEETS_ENDPOINT = "https://script.google.com/macros/s/XXXX/exec";
   ```
7. Recarregue o site, preencha o formulário. Em 1–2 segundos aparece uma
   linha nova na aba **Leads** da planilha.

**Se editar o `Codigo.gs` depois:** Implantar → Gerenciar implantações → editar →
Versão: Nova versão → Implantar. A URL não muda.

### Colunas que chegam na planilha

`data_hora`, `nome`, `otica`, `cidade`, `estado`, `whatsapp`, `cargo`,
`ja_investe`, `faturamento`, `investimento_mensal`, `objetivo`, `inicio`,
`origem`, `utm`, `pagina`, `enviado_em`.

## Publicar a LP

Qualquer host de site estático serve:

- **Netlify / Vercel:** arraste a pasta ou conecte o repositório do GitHub.
- **GitHub Pages:** suba os arquivos, ative Pages na branch `main`.
- **Lovable:** importe como projeto estático.

O envio para o Sheets funciona igual em qualquer um (é um POST externo).

## Personalização rápida

| O que | Onde |
|---|---|
| Cores / tema | `assets/styles.css`, bloco `:root` no topo |
| Botões de CTA | hoje todos rolam até o formulário (`href="#formulario"`) |
| Seção **Garantia (11)** | está `hidden` no `index.html` (conforme observação da copy). Remova o atributo `hidden` da `<section id="garantia">` para exibir |
| Prints dos cases (seção 8) | trocar os blocos `[ Inserir case / print ]` por `<img>` |
| Links do rodapé | Política de Privacidade / Termos / Contato apontam para `#` |

## Observações da copy ainda em aberto

- **Garantia (seção 11):** critérios não definidos → seção começa oculta.
- **Cases (seção 8):** faltam os prints/telas de comprovação.
- **Botões de CTA:** definir se levam ao formulário (atual) ou a um WhatsApp.
