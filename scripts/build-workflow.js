// Gera n8n/workflow.json a partir do código em src/.
// Assim a lógica que roda dentro dos nós Code é a mesma que os testes cobrem.
//
//   node scripts/build-workflow.js

const fs = require('fs');
const path = require('path');

const raiz = path.join(__dirname, '..');
const ler = (arquivo) =>
  fs.readFileSync(path.join(raiz, 'src', arquivo), 'utf8')
    .replace(/\/\/ <exports>[\s\S]*?\/\/ <\/exports>\n?/g, '')
    .replace(/\/\/ <imports>[\s\S]*?\/\/ <\/imports>\n?/g, '')
    .trim();

const SRC_MENSAGEM = ler('mensagem.js');
const SRC_DOCUMENTO = ler('documento.js');
const SRC_MAQUINA = ler('maquina.js');

const EVOLUTION_CRED = { httpHeaderAuth: { id: '', name: 'Evolution API (header apikey)' } };
const GEMINI_CRED = { httpHeaderAuth: { id: '', name: 'Gemini API (header x-goog-api-key)' } };
const REDIS_CRED = { redis: { id: '', name: 'Redis' } };
const SHEETS_CRED = { googleSheetsOAuth2Api: { id: '', name: 'Google Sheets' } };

const MSG = "$('Debounce').first().json";
const CFG = "$('Configuração').first().json";

let x = 0;
const pos = () => [(x++) * 220, 300];

const code = (name, jsCode, extra = {}) => ({
  parameters: { jsCode }, name, type: 'n8n-nodes-base.code', typeVersion: 2, position: pos(), ...extra,
});

const redis = (name, parameters, extra = {}) => ({
  parameters, name, type: 'n8n-nodes-base.redis', typeVersion: 1, position: pos(), credentials: REDIS_CRED, ...extra,
});

const enviar = (name, texto) => ({
  parameters: {
    method: 'POST',
    url: `={{ ${CFG}.evolutionUrl }}/message/sendText/{{ $('Extrair mensagem').first().json.instancia }}`,
    authentication: 'genericCredentialType',
    genericAuthType: 'httpHeaderAuth',
    sendBody: true,
    specifyBody: 'json',
    jsonBody: `={{ JSON.stringify({ number: $('Extrair mensagem').first().json.numero, text: ${texto} }) }}`,
    options: { timeout: 15000 },
  },
  name, type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: pos(),
  credentials: EVOLUTION_CRED, retryOnFail: true, maxTries: 3, waitBetweenTries: 2000,
});

const sheets = (name, aba) => ({
  parameters: {
    documentId: { __rl: true, mode: 'id', value: `={{ ${CFG}.planilhaId }}` },
    sheetName: { __rl: true, mode: 'name', value: aba },
    options: {},
  },
  name, type: 'n8n-nodes-base.googleSheets', typeVersion: 4.5, position: pos(),
  credentials: SHEETS_CRED, executeOnce: true, alwaysOutputData: true,
});

const PROMPT =
  'Classifique a mensagem de um cliente de escritório de advocacia. ' +
  'Responda só com uma palavra: andamento (quer saber como está um processo), ' +
  'credito (quer saber do próprio crédito, pagamento, valor a receber), ' +
  'contato (quer falar com uma pessoa) ou outro.\\n\\nMensagem: ';

const nodes = [
  {
    parameters: { httpMethod: 'POST', path: 'bot-advocacia', options: {} },
    name: 'Webhook Evolution', type: 'n8n-nodes-base.webhook', typeVersion: 2, position: pos(),
    webhookId: 'bot-advocacia',
  },
  code('Configuração', `// Edite aqui os dados do escritório e da integração.
return [{ json: {
  escritorio: 'Escritório Exemplo Advocacia',
  email: 'atendimento@escritorio-exemplo.com.br',
  telefone: '(81) 3000-0000',
  horario: 'segunda a sexta, das 8h às 17h',
  evolutionUrl: 'https://evolution.seu-dominio.com.br',
  planilhaId: 'COLE_AQUI_O_ID_DA_PLANILHA',
  segundosDebounce: 8,
} }];`),
  code('Extrair mensagem', `${SRC_MENSAGEM}

const m = extrairMensagem($('Webhook Evolution').first().json.body || {});
if (!m) return [];
return [{ json: { ...m, chave: m.instancia + ':' + m.numero } }];`),
  {
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
        conditions: [{ id: 'tem-texto', leftValue: '={{ $json.texto }}', rightValue: '', operator: { type: 'string', operation: 'notEmpty', singleValue: true } }],
        combinator: 'and',
      },
      options: {},
    },
    name: 'Tem texto?', type: 'n8n-nodes-base.if', typeVersion: 2.2, position: pos(),
  },
  enviar('Avisar: só texto', "'Por enquanto eu consigo entender só mensagens de texto. Pode escrever sua dúvida?'"),
  redis('Guardar no buffer', {
    operation: 'push',
    list: "=buffer:{{ $('Extrair mensagem').first().json.chave }}",
    messageData: "={{ JSON.stringify({ id: $('Extrair mensagem').first().json.messageId, texto: $('Extrair mensagem').first().json.texto }) }}",
    tail: true,
  }),
  {
    parameters: { amount: `={{ ${CFG}.segundosDebounce }}`, unit: 'seconds' },
    name: 'Esperar mensagens', type: 'n8n-nodes-base.wait', typeVersion: 1.1, position: pos(), webhookId: 'bot-advocacia-wait',
  },
  redis('Ler buffer', {
    operation: 'get', propertyName: 'buffer', keyType: 'list',
    key: "=buffer:{{ $('Extrair mensagem').first().json.chave }}", options: {},
  }, { alwaysOutputData: true }),
  code('Debounce', `${SRC_MENSAGEM.match(/function juntarBuffer[\s\S]*?\n}\n?/)[0]}

const msg = $('Extrair mensagem').first().json;
let buffer = $input.first().json.buffer || [];
if (!Array.isArray(buffer)) buffer = [buffer];
const texto = juntarBuffer(buffer, msg.messageId);
// Chegou mensagem mais nova: esta execução para aqui e a da última responde.
if (texto === null) return [];
return [{ json: { ...msg, texto } }];`),
  redis('Limpar buffer', { operation: 'delete', key: `=buffer:{{ ${MSG}.chave }}` }),
  redis('Ler sessão', {
    operation: 'get', propertyName: 'sessao', keyType: 'string',
    key: `=sessao:{{ ${MSG}.chave }}`, options: {},
  }, { alwaysOutputData: true }),
  sheets('Ler processos', 'processos'),
  sheets('Ler credores', 'credores'),
  {
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
        conditions: [{ id: 'sem-sessao', leftValue: "={{ $('Ler sessão').first().json.sessao }}", rightValue: '', operator: { type: 'string', operation: 'empty', singleValue: true } }],
        combinator: 'and',
      },
      options: {},
    },
    name: 'Primeira mensagem?', type: 'n8n-nodes-base.if', typeVersion: 2.2, position: pos(),
  },
  {
    parameters: {
      method: 'POST',
      url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      sendBody: true,
      specifyBody: 'json',
      jsonBody: `={{ JSON.stringify({ contents: [{ parts: [{ text: '${PROMPT}' + ${MSG}.texto }] }], generationConfig: { temperature: 0, maxOutputTokens: 5 } }) }}`,
      options: { timeout: 10000 },
    },
    name: 'IA: classificar intenção', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: pos(),
    credentials: GEMINI_CRED, onError: 'continueRegularOutput',
  },
  code('Máquina de estados', `${SRC_DOCUMENTO}

${SRC_MAQUINA}

const cfg = ${CFG};
const msg = ${MSG};

let sessao = null;
try { sessao = JSON.parse($('Ler sessão').first().json.sessao || 'null'); } catch (e) { sessao = null; }

// Se a IA respondeu, pega a palavra. Se falhou ou não rodou, segue sem intenção.
let intencao = null;
const ia = $input.first().json || {};
if (ia.candidates) {
  const t = (((ia.candidates[0] || {}).content || {}).parts || [{}])[0].text || '';
  intencao = t.toLowerCase().normalize('NFD').replace(/[^a-z]/g, '');
}

const processos = $('Ler processos').all().map((i) => i.json).filter((p) => p.id);
const credores = $('Ler credores').all().map((i) => i.json).filter((c) => c.processo_id);

const r = processar({ sessao, texto: msg.texto, nome: msg.nome, intencao, processos, credores, config: cfg });
return [{ json: { ...msg, resposta: r.resposta, sessaoNova: JSON.stringify(r.sessao || null) } }];`),
  redis('Salvar sessão', {
    operation: 'set', keyType: 'string', expire: true, ttl: 1800,
    key: "=sessao:{{ $('Máquina de estados').first().json.chave }}",
    value: "={{ $('Máquina de estados').first().json.sessaoNova }}",
  }),
  enviar('Enviar resposta', "$('Máquina de estados').first().json.resposta"),
];

const liga = (de, para, saida = 0) => ({ de, para, saida });
const ligacoes = [
  liga('Webhook Evolution', 'Configuração'),
  liga('Configuração', 'Extrair mensagem'),
  liga('Extrair mensagem', 'Tem texto?'),
  liga('Tem texto?', 'Guardar no buffer', 0),
  liga('Tem texto?', 'Avisar: só texto', 1),
  liga('Guardar no buffer', 'Esperar mensagens'),
  liga('Esperar mensagens', 'Ler buffer'),
  liga('Ler buffer', 'Debounce'),
  liga('Debounce', 'Limpar buffer'),
  liga('Limpar buffer', 'Ler sessão'),
  liga('Ler sessão', 'Ler processos'),
  liga('Ler processos', 'Ler credores'),
  liga('Ler credores', 'Primeira mensagem?'),
  liga('Primeira mensagem?', 'IA: classificar intenção', 0),
  liga('Primeira mensagem?', 'Máquina de estados', 1),
  liga('IA: classificar intenção', 'Máquina de estados'),
  liga('Máquina de estados', 'Salvar sessão'),
  liga('Salvar sessão', 'Enviar resposta'),
];

const connections = {};
for (const { de, para, saida } of ligacoes) {
  connections[de] = connections[de] || { main: [] };
  while (connections[de].main.length <= saida) connections[de].main.push([]);
  connections[de].main[saida].push({ node: para, type: 'main', index: 0 });
}

// O nó "Avisar: só texto" fica abaixo da linha principal.
nodes.find((n) => n.name === 'Avisar: só texto').position[1] = 520;
nodes.find((n) => n.name === 'IA: classificar intenção').position[1] = 120;

nodes.forEach((n, i) => { n.id = `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`; });

const workflow = { name: 'Bot WhatsApp - Escritório de Advocacia', nodes, connections, settings: { executionOrder: 'v1' }, pinData: {} };
fs.mkdirSync(path.join(raiz, 'n8n'), { recursive: true });
fs.writeFileSync(path.join(raiz, 'n8n', 'workflow.json'), JSON.stringify(workflow, null, 2) + '\n');
console.log(`n8n/workflow.json gerado com ${nodes.length} nós.`);
