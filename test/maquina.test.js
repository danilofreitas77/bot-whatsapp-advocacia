const test = require('node:test');
const assert = require('node:assert');
const { processar, escolher } = require('../src/maquina');
const { documentoValido, mascararDocumento } = require('../src/documento');
const { extrairMensagem, juntarBuffer } = require('../src/mensagem');
const dados = require('../exemplo/dados.json');

// Simula uma conversa: manda as mensagens em sequência carregando a sessão.
function conversa(mensagens, opcoes = {}) {
  let sessao = null;
  const respostas = [];
  for (const m of mensagens) {
    const texto = typeof m === 'string' ? m : m.texto;
    const r = processar({
      sessao, texto, nome: 'João Exemplo',
      intencao: typeof m === 'string' ? null : m.intencao,
      processos: dados.processos, credores: dados.credores, config: dados.config,
      agora: opcoes.agora,
    });
    sessao = r.sessao;
    respostas.push(r.resposta);
  }
  return { sessao, respostas, ultima: respostas[respostas.length - 1] };
}

test('primeira mensagem mostra o menu', () => {
  const { ultima } = conversa(['oi']);
  assert.match(ultima, /Olá, João!/);
  assert.match(ultima, /1\. Andamento/);
});

test('consulta de andamento completa', () => {
  const { ultima, sessao } = conversa(['oi', '1', 'recuperação judicial', 'PE', '1']);
  assert.match(ultima, /Construtora Beta/);
  assert.match(ultima, /homologação/);
  assert.equal(sessao.estado, 'fim');
});

test('pula a pergunta de estado quando só existe um', () => {
  const { respostas } = conversa(['oi', '1', 'falencia']);
  assert.match(respostas[2], /Indústria Delta/);
  assert.match(respostas[2], /Leilão/);
});

test('consulta de crédito com documento certo', () => {
  const { ultima } = conversa(['oi', '2', 'recuperacao', 'PE', 'transportes', '12345678909']);
  assert.match(ultima, /Trabalhista/);
  assert.match(ultima, /12\.450,00/);
  assert.match(ultima, /\*\*\*\.456\.\*\*\*-\*\*/);
  assert.doesNotMatch(ultima, /12345678909/);
});

test('não confirma documento que existe em outro processo', () => {
  // Maria é credora no P004, mas está consultando o P001.
  const { ultima } = conversa(['oi', '2', 'recuperacao', 'PE', 'transportes', '98765432100']);
  assert.match(ultima, /Não encontramos crédito/);
  assert.doesNotMatch(ultima, /Maria|8\.900/);
});

test('bloqueia depois de 3 documentos inválidos', () => {
  const agora = Date.now();
  const { ultima, sessao } = conversa(['oi', '2', 'recuperacao', 'PE', 'transportes', '111', '222', '333'], { agora });
  assert.match(ultima, /bloqueada/);
  assert.ok(sessao.bloqueadoAte > agora);
  const depois = processar({
    sessao, texto: '0', processos: dados.processos, credores: dados.credores, config: dados.config, agora,
  });
  assert.match(depois.resposta, /bloqueada/);
});

test('intenção da IA leva direto ao fluxo certo', () => {
  const { ultima } = conversa([{ texto: 'quero saber do meu crédito', intencao: 'credito' }]);
  assert.match(ultima, /tipo do processo/);
});

test('0 volta ao menu no meio do fluxo', () => {
  const { ultima, sessao } = conversa(['oi', '1', '1', '0']);
  assert.match(ultima, /Sobre o que você quer saber/);
  assert.equal(sessao.estado, 'menu');
});

test('depois de uma resposta, número inicia nova consulta', () => {
  const { ultima } = conversa(['oi', '1', 'falencia', '3']);
  assert.match(ultima, /E-mail: atendimento@/);
});

test('escolher aceita número, nome sem acento e trecho único', () => {
  const opcoes = ['Dissolução Societária', 'Falência', 'Recuperação Judicial'];
  assert.equal(escolher('2', opcoes), 'Falência');
  assert.equal(escolher('falencia', opcoes), 'Falência');
  assert.equal(escolher('recup', opcoes), 'Recuperação Judicial');
  assert.equal(escolher('9', opcoes), null);
});

test('documentos', () => {
  assert.ok(documentoValido('123.456.789-09'));
  assert.ok(documentoValido('11.222.333/0001-81'));
  assert.ok(!documentoValido('111.111.111-11'));
  assert.ok(!documentoValido('123.456.789-00'));
  assert.equal(mascararDocumento('11222333000181'), '**.222.***/****-**');
});

test('extrair mensagem ignora o próprio bot e grupos', () => {
  const base = { event: 'messages.upsert', instance: 'bot', data: { key: { remoteJid: '5581999990000@s.whatsapp.net', id: 'A1' }, pushName: 'João', message: { conversation: 'oi' } } };
  assert.equal(extrairMensagem(base).texto, 'oi');
  assert.equal(extrairMensagem({ ...base, data: { ...base.data, key: { ...base.data.key, fromMe: true } } }), null);
  assert.equal(extrairMensagem({ ...base, data: { ...base.data, key: { remoteJid: '123@g.us', id: 'A2' } } }), null);
  assert.equal(extrairMensagem({ ...base, event: 'MESSAGES_UPSERT' }).numero, '5581999990000');
  assert.equal(extrairMensagem({ ...base, event: 'connection.update' }), null);
});

test('debounce: só a última mensagem segue e junta o texto', () => {
  const buffer = [{ id: 'A', texto: 'oi' }, { id: 'B', texto: 'quero ver meu processo' }].map((x) => JSON.stringify(x));
  assert.equal(juntarBuffer(buffer, 'A'), null);
  assert.equal(juntarBuffer(buffer, 'B'), 'oi\nquero ver meu processo');
});
