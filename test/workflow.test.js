// Roda o código dos nós Code do workflow gerado, simulando o que o n8n entrega
// pra eles ($ e $input). Pega erro de build antes de importar no n8n.
const test = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('child_process');
const path = require('path');
const dados = require('../exemplo/dados.json');

execFileSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'build-workflow.js')]);
const wf = require('../n8n/workflow.json');
const no = (nome) => wf.nodes.find((n) => n.name === nome);

function rodar(nome, saidas, entrada) {
  const $ = (n) => {
    const itens = (saidas[n] || []).map((json) => ({ json }));
    return { first: () => itens[0], all: () => itens };
  };
  const $input = { first: () => ({ json: entrada || {} }), all: () => [{ json: entrada || {} }] };
  return new Function('$', '$input', no(nome).parameters.jsCode)($, $input);
}

const CONFIG = { ...dados.config, evolutionUrl: 'https://evo.exemplo', planilhaId: 'x', segundosDebounce: 8 };
const WEBHOOK = {
  body: {
    event: 'messages.upsert', instance: 'bot',
    data: { key: { remoteJid: '5581999990000@s.whatsapp.net', id: 'M1' }, pushName: 'João Exemplo', message: { conversation: 'oi' } },
  },
};

test('todas as ligações apontam pra nós que existem', () => {
  const nomes = new Set(wf.nodes.map((n) => n.name));
  for (const [de, { main }] of Object.entries(wf.connections)) {
    assert.ok(nomes.has(de), de);
    for (const saida of main) for (const c of saida) assert.ok(nomes.has(c.node), c.node);
  }
});

test('nó Extrair mensagem', () => {
  const r = rodar('Extrair mensagem', { 'Webhook Evolution': [WEBHOOK] });
  assert.equal(r[0].json.chave, 'bot:5581999990000');
  assert.equal(r[0].json.texto, 'oi');
});

test('nó Debounce segura execução antiga', () => {
  const msg = { messageId: 'M1', texto: 'oi', chave: 'bot:1' };
  const buffer = [JSON.stringify({ id: 'M1', texto: 'oi' }), JSON.stringify({ id: 'M2', texto: 'tudo bem' })];
  assert.deepEqual(rodar('Debounce', { 'Extrair mensagem': [msg] }, { buffer }), []);
  const r = rodar('Debounce', { 'Extrair mensagem': [{ ...msg, messageId: 'M2' }] }, { buffer });
  assert.equal(r[0].json.texto, 'oi\ntudo bem');
});

test('nó Máquina de estados com resposta da IA', () => {
  const saidas = {
    'Configuração': [CONFIG],
    'Debounce': [{ chave: 'bot:1', texto: 'quero ver meu crédito', nome: 'João Exemplo' }],
    'Ler sessão': [{}],
    'Ler processos': dados.processos,
    'Ler credores': dados.credores,
  };
  const ia = { candidates: [{ content: { parts: [{ text: 'credito\n' }] } }] };
  const r = rodar('Máquina de estados', saidas, ia)[0].json;
  assert.match(r.resposta, /tipo do processo/);
  assert.equal(JSON.parse(r.sessaoNova).fluxo, 'credito');
});

test('nó Máquina de estados continua sessão salva', () => {
  const sessao = { estado: 'documento', fluxo: 'credito', tipo: 'Recuperação Judicial', uf: 'PE', processoId: 'P001', tentativas: 0 };
  const saidas = {
    'Configuração': [CONFIG],
    'Debounce': [{ chave: 'bot:1', texto: '123.456.789-09', nome: 'João' }],
    'Ler sessão': [{ sessao: JSON.stringify(sessao) }],
    'Ler processos': dados.processos,
    'Ler credores': dados.credores,
  };
  const r = rodar('Máquina de estados', saidas, dados.credores[0])[0].json;
  assert.match(r.resposta, /Trabalhista/);
});
