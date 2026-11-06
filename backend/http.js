// Peças de HTTP usadas pela API do site e pela API v1.

export const LIMITE_CORPO = 1_000_000;

export class ErroHttp extends Error {
  constructor(status, mensagem, cabecalhos = {}) {
    super(mensagem);
    this.status = status;
    this.cabecalhos = cabecalhos;
  }
}

// Dado recusado pelos helpers de validação. É 400 na API do site; a v1 responde 422.
export class ErroValidacao extends ErroHttp {
  constructor(mensagem) {
    super(400, mensagem);
  }
}

export function responderJson(res, status, dados, cabecalhos = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...cabecalhos });
  res.end(JSON.stringify(dados));
}

export async function lerCorpo(req, limite = LIMITE_CORPO) {
  const partes = [];
  let tamanho = 0;
  for await (const pedaco of req) {
    tamanho += pedaco.length;
    // Lê até o fim sem guardar o excedente. Parar no meio deixaria o resto do corpo
    // na conexão keep-alive, e a próxima requisição dela ficaria presa até o timeout.
    if (tamanho <= limite) partes.push(pedaco);
  }
  if (tamanho > limite) throw new ErroHttp(413, 'Corpo da requisição grande demais.');
  if (!partes.length) return {};
  let corpo;
  try {
    corpo = JSON.parse(Buffer.concat(partes).toString('utf8'));
  } catch {
    throw new ErroHttp(400, 'JSON inválido.');
  }
  // "null" e "[]" são JSON válido, mas as rotas leem campos: quebrariam como erro 500.
  if (corpo === null || typeof corpo !== 'object' || Array.isArray(corpo)) {
    throw new ErroHttp(400, 'JSON inválido.');
  }
  return corpo;
}

// Endereço da conexão, e não X-Forwarded-For: esse cabeçalho o próprio cliente pode inventar.
// Atrás de proxy reverso toda conexão vem dele, e os limites por IP tratariam a escola
// inteira como um só cliente. CONFIAR_PROXY=1 lê o X-Real-IP que o proxy grava, e só
// é seguro quando o servidor não pode ser alcançado sem passar por ele.
export function ipDe(req) {
  const ipDoProxy = process.env.CONFIAR_PROXY === '1' ? req.headers['x-real-ip'] : undefined;
  return ipDoProxy ?? req.socket.remoteAddress ?? 'desconhecido';
}
