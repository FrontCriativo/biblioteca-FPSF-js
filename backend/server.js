import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolverRota } from './rotas.js';
import { atenderV1 } from './api-v1.js';
import { responderJson, lerCorpo, LIMITE_CORPO } from './http.js';
import { faxinarLimites } from './limite.js';
import { expirarReservasVencidas } from './repositorio.js';
import { apagarSessoesVencidas, apagarTokensVencidos } from './auth.js';
import { executadoDiretamente } from './execucao.js';

const PORTA = Number(process.env.PORT) || 3000;
const RAIZ_FRONT = fileURLToPath(new URL('../frontend/', import.meta.url));
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

  if (url.pathname === '/api/v1' || url.pathname.startsWith('/api/v1/')) {
    return atenderV1(req, res, url);
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
    }, erro.cabecalhos);
  }
}

// O handler é async: um erro solto aqui viraria rejeição não tratada e derrubaria
// o processo. Nenhuma requisição, por mais estranha, pode tirar o site do ar.
export function criarServidor() {
  return createServer(async (req, res) => {
    try {
      await atender(req, res);
    } catch (erro) {
      console.error('Requisição recusada:', erro.message);
      if (res.headersSent) return res.end();
      const envelope = req.url.startsWith('/api/v1') ? { success: false } : {};
      responderJson(res, 400, { ...envelope, erro: 'Requisição inválida.' });
    }
  });
}

// Faxina: sessões e tokens vencidos saem do banco na inicialização e depois a cada hora.
export function limparVencidos() {
  try {
    const sessoes = apagarSessoesVencidas();
    const tokens = apagarTokensVencidos();
    faxinarLimites();
    if (sessoes) console.log(`  ${sessoes} sessão(ões) vencida(s) apagada(s).`);
    if (tokens) console.log(`  ${tokens} token(s) vencido(s) apagado(s).`);
  } catch (erro) {
    console.error('Erro ao apagar sessões e tokens vencidos:', erro);
  }
}

// Só quando executado com `node backend/server.js`: quem importa (os testes) escolhe
// a própria porta e não pode herdar timers nem o tratamento global de erros.
if (executadoDiretamente(import.meta.url)) {
  // Rede de segurança: registra no log em vez de encerrar o processo.
  process.on('unhandledRejection', (motivo) => {
    console.error('Promessa rejeitada sem tratamento:', motivo);
  });

  limparVencidos();
  setInterval(limparVencidos, 60 * 60 * 1000).unref();

  criarServidor().listen(PORTA, () => {
    console.log(`\n  Biblioteca Virtual FPSF`);
    console.log(`  Servidor em http://localhost:${PORTA}\n`);
  });
}
