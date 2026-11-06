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
    if (tamanho > limite) throw new ErroHttp(413, 'Corpo da requisição grande demais.');
    partes.push(pedaco);
  }
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
export const ipDe = (req) => req.socket.remoteAddress ?? 'desconhecido';
