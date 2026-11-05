// Máquina de estados do atendimento.
//
// Função pura: recebe a sessão atual, o texto do usuário e os dados das
// planilhas, e devolve a resposta e a sessão nova. Não chama API, não lê
// banco. Por isso dá pra testar o fluxo inteiro sem n8n e sem WhatsApp.
//
// A IA não decide nada aqui. Ela só classifica a primeira mensagem livre
// ("quero saber do meu crédito") pra pular direto pro fluxo certo. Todo o
// resto é caminho fixo, e o bot nunca responde com dado que não veio da
// planilha.

// <imports>
if (typeof module !== 'undefined') {
  var { documentoValido, soDigitos, mascararDocumento } = require('./documento');
}
// </imports>

const MAX_TENTATIVAS_DOCUMENTO = 3;
const BLOQUEIO_MINUTOS = 30;
const LIMITE_OPCOES_NA_LISTA = 10;

function normalizar(texto) {
  return String(texto || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function unicos(lista) {
  return [...new Set(lista)].sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

function listar(opcoes) {
  return opcoes.map((o, i) => `${i + 1}. ${o}`).join('\n');
}

// Aceita o número da opção ou um pedaço do nome ("2", "falencia", "Falência").
function escolher(texto, opcoes) {
  const t = normalizar(texto);
  const n = Number(t);
  if (Number.isInteger(n) && n >= 1 && n <= opcoes.length) return opcoes[n - 1];
  const exata = opcoes.find((o) => normalizar(o) === t);
  if (exata) return exata;
  const parciais = opcoes.filter((o) => normalizar(o).includes(t));
  return t.length >= 3 && parciais.length === 1 ? parciais[0] : null;
}

function formatarValor(valor) {
  const n = Number(String(valor).replace(/\./g, '').replace(',', '.'));
  if (!Number.isFinite(n)) return String(valor);
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

const RODAPE = '\n\nDigite *0* para voltar ao menu.';

function menu(config, nome) {
  const ola = nome ? `Olá, ${nome.split(' ')[0]}!` : 'Olá!';
  return (
    `${ola} Aqui é o atendimento automático do ${config.escritorio}.\n\n` +
    'Sobre o que você quer saber?\n' +
    '1. Andamento de um processo\n' +
    '2. Situação do meu crédito\n' +
    '3. Falar com a equipe'
  );
}

function contato(config) {
  return (
    'Para falar com a nossa equipe:\n' +
    `E-mail: ${config.email}\n` +
    `Telefone: ${config.telefone}\n` +
    `Horário: ${config.horario}` +
    RODAPE
  );
}

function sessaoNova() {
  return { estado: 'menu', fluxo: null, tipo: null, uf: null, processoId: null, tentativas: 0, bloqueadoAte: null };
}

// Processo definido: no fluxo de andamento já responde; no de crédito pede o documento.
function escolherProcesso(sessao, processo) {
  const nova = { ...sessao, processoId: processo.id };
  if (sessao.fluxo === 'andamento') {
    const quando = processo.atualizado_em ? `\nÚltima atualização: ${processo.atualizado_em}` : '';
    return {
      sessao: { ...nova, estado: 'fim' },
      resposta: `*${processo.empresa}* (${processo.tipo}, ${processo.uf})\n\n${processo.andamento}${quando}${RODAPE}`,
    };
  }
  return {
    sessao: { ...nova, estado: 'documento' },
    resposta: `Para consultar o seu crédito no processo de *${processo.empresa}*, informe o CPF ou CNPJ do credor (só números).`,
  };
}

// Avança pelos filtros tipo -> UF -> empresa, pulando a pergunta quando só
// existe uma opção possível.
function proximaPergunta(sessao, processos) {
  const doTipo = processos.filter((p) => !sessao.tipo || p.tipo === sessao.tipo);

  if (!sessao.tipo) {
    const tipos = unicos(processos.map((p) => p.tipo));
    if (tipos.length === 1) return proximaPergunta({ ...sessao, tipo: tipos[0] }, processos);
    return { sessao: { ...sessao, estado: 'tipo' }, resposta: `Qual o tipo do processo?\n${listar(tipos)}` };
  }

  if (!sessao.uf) {
    const ufs = unicos(doTipo.map((p) => p.uf));
    if (ufs.length === 1) return proximaPergunta({ ...sessao, uf: ufs[0] }, processos);
    return { sessao: { ...sessao, estado: 'uf' }, resposta: `Em qual estado corre o processo?\n${listar(ufs)}` };
  }

  const empresas = unicos(doTipo.filter((p) => p.uf === sessao.uf).map((p) => p.empresa));
  if (empresas.length === 1) {
    return escolherProcesso(sessao, doTipo.find((p) => p.uf === sessao.uf));
  }
  if (empresas.length > LIMITE_OPCOES_NA_LISTA) {
    return { sessao: { ...sessao, estado: 'empresa' }, resposta: 'Digite o nome da empresa do processo.' };
  }
  return { sessao: { ...sessao, estado: 'empresa' }, resposta: `Qual a empresa?\n${listar(empresas)}` };
}

function iniciarFluxo(fluxo, sessao, processos, config) {
  if (fluxo === 'contato') return { sessao: { ...sessaoNova(), estado: 'fim' }, resposta: contato(config) };
  return proximaPergunta({ ...sessaoNova(), fluxo }, processos);
}

function processar({ sessao, texto, nome, intencao, processos, credores, config, agora }) {
  agora = agora || Date.now();
  sessao = sessao ? { ...sessao } : null;
  const t = normalizar(texto);

  if (sessao && sessao.bloqueadoAte && agora < sessao.bloqueadoAte) {
    return {
      sessao,
      resposta: 'Por segurança, a consulta de crédito está bloqueada por alguns minutos. ' +
        `Se precisar, fale com a equipe: ${config.telefone}.`,
    };
  }

  // Primeira mensagem ou pedido de voltar ao menu.
  if (!sessao || ['0', 'menu', 'inicio', 'voltar'].includes(t)) {
    if (sessao === null && intencao && ['andamento', 'credito', 'contato'].includes(intencao)) {
      return iniciarFluxo(intencao, null, processos, config);
    }
    return { sessao: sessaoNova(), resposta: menu(config, nome) };
  }

  if (['sair', 'encerrar', 'tchau', 'obrigado', 'obrigada'].includes(t)) {
    return { sessao: null, resposta: 'Atendimento encerrado. Se precisar, é só mandar mensagem de novo.', encerrar: true };
  }

  const doFiltro = processos.filter((p) => p.tipo === sessao.tipo && p.uf === sessao.uf);

  switch (sessao.estado) {
    case 'menu': {
      const fluxo = { 1: 'andamento', 2: 'credito', 3: 'contato' }[t] || intencao;
      if (!['andamento', 'credito', 'contato'].includes(fluxo)) {
        return { sessao, resposta: 'Não entendi. Responda com o número da opção:\n1. Andamento de um processo\n2. Situação do meu crédito\n3. Falar com a equipe' };
      }
      return iniciarFluxo(fluxo, sessao, processos, config);
    }

    case 'tipo': {
      const opcoes = unicos(processos.map((p) => p.tipo));
      const tipo = escolher(texto, opcoes);
      if (!tipo) return { sessao, resposta: `Não encontrei essa opção. Escolha uma:\n${listar(opcoes)}` };
      return proximaPergunta({ ...sessao, tipo }, processos);
    }

    case 'uf': {
      const opcoes = unicos(processos.filter((p) => p.tipo === sessao.tipo).map((p) => p.uf));
      const uf = escolher(texto, opcoes);
      if (!uf) return { sessao, resposta: `Não encontrei esse estado. Escolha um:\n${listar(opcoes)}` };
      return proximaPergunta({ ...sessao, uf }, processos);
    }

    case 'empresa': {
      const opcoes = unicos(doFiltro.map((p) => p.empresa));
      const empresa = escolher(texto, opcoes);
      if (!empresa) {
        const parecidas = opcoes.filter((o) => normalizar(o).includes(t)).slice(0, LIMITE_OPCOES_NA_LISTA);
        if (parecidas.length > 1) {
          return { sessao, resposta: `Encontrei mais de uma. Qual delas?\n${listar(parecidas)}` };
        }
        return { sessao, resposta: 'Não encontrei essa empresa nesse tipo de processo e estado. Confira o nome ou digite *0* para recomeçar.' };
      }
      return escolherProcesso(sessao, doFiltro.find((p) => p.empresa === empresa));
    }

    case 'documento': {
      if (!documentoValido(texto)) {
        const tentativas = (sessao.tentativas || 0) + 1;
        if (tentativas >= MAX_TENTATIVAS_DOCUMENTO) {
          return {
            sessao: { ...sessao, tentativas: 0, bloqueadoAte: agora + BLOQUEIO_MINUTOS * 60000 },
            resposta: `Documento inválido ${MAX_TENTATIVAS_DOCUMENTO} vezes. Por segurança, a consulta foi bloqueada por ${BLOQUEIO_MINUTOS} minutos.`,
          };
        }
        return { sessao: { ...sessao, tentativas }, resposta: 'Esse CPF/CNPJ não é válido. Confira os números e envie de novo.' };
      }

      const doc = soDigitos(texto);
      const credor = credores.find((c) => String(c.processo_id) === String(sessao.processoId) && soDigitos(c.documento) === doc);
      const mascara = mascararDocumento(doc);
      const fim = { ...sessao, estado: 'fim', tentativas: 0 };

      // Resposta igual pra "documento não existe" e "documento existe em outro
      // processo": o bot não confirma pra ninguém em quais processos um CPF aparece.
      if (!credor) {
        return {
          sessao: fim,
          resposta: `Não encontramos crédito para o documento ${mascara} nesse processo.\n` +
            `Se você acha que é um erro, fale com a equipe: ${config.email}${RODAPE}`,
        };
      }
      return {
        sessao: fim,
        resposta:
          `Crédito encontrado para ${mascara}:\n\n` +
          `Classe: ${credor.classe}\n` +
          `Valor: ${formatarValor(credor.valor)}\n` +
          `Situação: ${credor.situacao}${RODAPE}`,
      };
    }

    case 'fim':
    default: {
      // Depois de uma resposta, "2" já começa outra consulta sem passar pelo menu.
      const fluxo = { 1: 'andamento', 2: 'credito', 3: 'contato' }[t];
      if (fluxo) return iniciarFluxo(fluxo, sessao, processos, config);
      return { sessao: sessaoNova(), resposta: menu(config, nome) };
    }
  }
}

// <exports>
if (typeof module !== 'undefined') {
  module.exports = { processar, escolher, normalizar, sessaoNova };
}
// </exports>
