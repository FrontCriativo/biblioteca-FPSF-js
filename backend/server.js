import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolverRota, ErroHttp, apagarEnviosDepoimentoVencidos } from './rotas.js';
import { expirarReservasVencidas } from './repositorio.js';
import { apagarSessoesVencidas, apagarFalhasLoginVencidas } from './auth.js';

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
  let relativo;
  try {
    relativo = normalize(decodeURIComponent(caminhoUrl)).replace(/^(\.\.[/\\])+/, '');
  } catch {
    // "%E0%A4%A" e afins: escape de URL malformado.
    return responderJson(res, 400, { erro: 'Requisição inválida.' });
  }
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

async function atender(req, res) {
  // Lança com Host inválido ("a b"): quem trata é o catch de createServer.
  const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);

  if (!url.pathname.startsWith('/api/')) {
    const caminho = url.pathname === '/' ? '/index.html' : url.pathname;
    return servirArquivo(res, caminho);
  }

  try {
    const rota = resolverRota(req.method, url.pathname);
    if (!rota) return responderJson(res, 404, { erro: 'Rota não encontrada.' });

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
}

// O handler é async: um erro solto aqui viraria rejeição não tratada e derrubaria
// o processo. Nenhuma requisição, por mais estranha, pode tirar o site do ar.
const servidor = createServer(async (req, res) => {
  try {
    await atender(req, res);
  } catch (erro) {
    console.error('Requisição recusada:', erro.message);
    if (!res.headersSent) responderJson(res, 400, { erro: 'Requisição inválida.' });
    else res.end();
  }
});

// Rede de segurança: registra no log em vez de encerrar o processo.
process.on('unhandledRejection', (motivo) => {
  console.error('Promessa rejeitada sem tratamento:', motivo);
});

// Faxina: sessões vencidas saem do banco na inicialização e depois a cada hora.
function limparVencidos() {
  try {
    const sessoes = apagarSessoesVencidas();
    apagarFalhasLoginVencidas();
    apagarEnviosDepoimentoVencidos();
    if (sessoes) console.log(`  ${sessoes} sessão(ões) vencida(s) apagada(s).`);
  } catch (erro) {
    console.error('Erro ao apagar sessões vencidas:', erro);
  }
}
limparVencidos();
setInterval(limparVencidos, 60 * 60 * 1000).unref();

servidor.listen(PORTA, () => {
  console.log(`\n  Biblioteca Virtual FPSF`);
  console.log(`  Servidor em http://localhost:${PORTA}\n`);
});
