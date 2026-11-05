// Extrai o que interessa do webhook da Evolution API (evento messages.upsert).
// Devolve null quando a mensagem deve ser ignorada.

function extrairMensagem(body) {
  const evento = String(body.event || '').toLowerCase().replace('_', '.');
  if (evento !== 'messages.upsert') return null;

  const data = body.data || {};
  const key = data.key || {};

  // Mensagem enviada pelo próprio bot também volta pelo webhook.
  // Sem esse filtro o bot responde a si mesmo em loop.
  if (key.fromMe) return null;

  const jid = key.remoteJid || '';
  if (jid.endsWith('@g.us') || jid === 'status@broadcast') return null;

  const m = data.message || {};
  const texto =
    m.conversation ||
    (m.extendedTextMessage && m.extendedTextMessage.text) ||
    (m.imageMessage && m.imageMessage.caption) ||
    (m.listResponseMessage && m.listResponseMessage.singleSelectReply &&
      m.listResponseMessage.singleSelectReply.selectedRowId) ||
    (m.buttonsResponseMessage && m.buttonsResponseMessage.selectedButtonId) ||
    '';

  return {
    instancia: body.instance || '',
    jid,
    numero: jid.split('@')[0],
    nome: data.pushName || '',
    messageId: key.id || '',
    texto: String(texto).trim(),
    temMidia: !texto && Object.keys(m).some((k) => /Message$/.test(k)),
  };
}

// Debounce: quem digita "oi" / "tudo bem?" / "quero ver meu processo" em três
// mensagens seguidas tem que receber UMA resposta. Cada mensagem entra num
// buffer; depois de alguns segundos, só a execução da última continua.
function juntarBuffer(buffer, messageIdAtual) {
  const itens = (buffer || []).map((s) => (typeof s === 'string' ? JSON.parse(s) : s));
  if (!itens.length) return null;
  const ultimo = itens[itens.length - 1];
  if (ultimo.id !== messageIdAtual) return null;
  return itens.map((i) => i.texto).filter(Boolean).join('\n');
}

// <exports>
if (typeof module !== 'undefined') {
  module.exports = { extrairMensagem, juntarBuffer };
}
// </exports>
