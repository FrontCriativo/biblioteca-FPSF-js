import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolverRota, ErroHttp } from './rotas.js';
import { expirarReservasVencidas } from './repositorio.js';

const PORTA = Number(process.env.PORT) || 3000;
const RAIZ_FRONT = fileURLToPath(new URL('../frontend/', import.meta.url));
const LIMITE_CORPO = 1_000_000;
// A capa chega em base64 (~33% maior que o arquivo): cabe uma imagem de até ~6 MB.
const LIMITE_CORPO_UPLOAD = 8_000_000;

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function responderJson(res, status, dados, cabecalhos = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...cabecalhos });
  res.end(JSON.stringify(dados));
}

async function lerCorpo(req, limite = LIMITE_CORPO) {
  const partes = [];
  let tamanho = 0;
  for await (const pedaco of req) {
    tamanho += pedaco.length;
    if (tamanho > limite) throw new ErroHttp(413, 'Corpo da requisição grande demais.');
    partes.push(pedaco);
  }
  if (!partes.length) return {};
  try {
    return JSON.parse(Buffer.concat(partes).toString('utf8'));
  } catch {
    throw new ErroHttp(400, 'JSON inválido.');
  }
}

async function servirArquivo(res, caminhoUrl) {
  const relativo = normalize(decodeURIComponent(caminhoUrl)).replace(/^(\.\.[/\\])+/, '');
  let destino = join(RAIZ_FRONT, relativo);

  // Impede escapar da pasta frontend/ via caminhos como /../backend/db/biblioteca.db
  if (!destino.startsWith(RAIZ_FRONT.replace(new RegExp(`\\${sep}$`), '') + sep)) {
    return responderJson(res, 403, { erro: 'Acesso negado.' });
  }

  try {
    let info = await stat(destino);
    if (info.isDirectory()) {
      destino = join(destino, 'index.html');
      info = await stat(destino);
    }
    const conteudo = await readFile(destino);
    res.writeHead(200, {
      'Content-Type': TIPOS[extname(destino).toLowerCase()] ?? 'application/octet-stream',
      'Content-Length': info.size,
    });
    res.end(conteudo);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<h1>404 — Página não encontrada</h1><p><a href="/">Voltar ao início</a></p>');
  }
}

const servidor = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);

  if (!url.pathname.startsWith('/api/')) {
    const caminho = url.pathname === '/' ? '/index.html' : url.pathname;
    return servirArquivo(res, caminho);
  }

  const rota = resolverRota(req.method, url.pathname);
  if (!rota) return responderJson(res, 404, { erro: 'Rota não encontrada.' });

  try {
    expirarReservasVencidas();
    const limite = url.pathname === '/api/admin/capas' ? LIMITE_CORPO_UPLOAD : LIMITE_CORPO;
    const corpo = req.method === 'GET' || req.method === 'DELETE' ? {} : await lerCorpo(req, limite);
    const resultado = rota.handler(req, { corpo, params: rota.params, query: url.searchParams });
    responderJson(res, resultado.status ?? 200, resultado.corpo, resultado.cabecalhos);
  } catch (erro) {
    const status = erro.status ?? 500;
    if (status === 500) console.error('Erro interno:', erro);
    responderJson(res, status, {
      erro: status === 500 ? 'Erro interno do servidor.' : erro.message,
    });
  }
});

servidor.listen(PORTA, () => {
  console.log(`\n  Biblioteca Virtual FPSF`);
  console.log(`  Servidor em http://localhost:${PORTA}\n`);
});
