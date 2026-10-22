import {
  criarHashSenha, conferirSenha, abrirSessao, encerrarSessao,
  usuarioDaSessao, lerCookie, cabecalhoCookieSessao, cookieSessaoExpirado,
} from './auth.js';
import { existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { db } from './db/index.js';
import * as repo from './repositorio.js';
import { normalizarTexto } from './texto.js';

const PASTA_ASSETS = fileURLToPath(new URL('../frontend/assets/', import.meta.url));

// Assinaturas (magic bytes) das imagens aceitas como capa.
const FORMATOS_CAPA = [
  { ext: '.jpg', confere: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: '.png', confere: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { ext: '.webp', confere: (b) => b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP' },
];

class ErroHttp extends Error {
  constructor(status, mensagem) {
    super(mensagem);
    this.status = status;
  }
}

function exigirLogin(req) {
  const usuario = usuarioDaSessao(lerCookie(req, 'sessao'));
  if (!usuario) throw new ErroHttp(401, 'Você precisa entrar para fazer isso.');
  return usuario;
}

function exigirAdmin(req) {
  const usuario = exigirLogin(req);
  if (usuario.papel !== 'admin') throw new ErroHttp(403, 'Acesso restrito à coordenação.');
  return usuario;
}

function campoObrigatorio(corpo, campo) {
  const valor = corpo?.[campo];
  if (typeof valor !== 'string' || !valor.trim()) {
    throw new ErroHttp(400, `O campo "${campo}" é obrigatório.`);
  }
  return valor.trim();
}

function inteiroPositivo(valor, campo, padrao = null) {
  if (valor === undefined || valor === '') {
    if (padrao !== null) return padrao;
    throw new ErroHttp(400, `O campo "${campo}" é obrigatório.`);
  }
  const n = Number(valor);
  if (!Number.isInteger(n) || n < 1) {
    throw new ErroHttp(400, `O campo "${campo}" deve ser um número inteiro positivo.`);
  }
  return n;
}

function gerarSlug(titulo) {
  return normalizarTexto(titulo)
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// Cada rota devolve { corpo } ou { corpo, cabecalhos }.
const rotas = {
  'POST /api/login': (req, { corpo }) => {
    const email = campoObrigatorio(corpo, 'email');
    const senha = campoObrigatorio(corpo, 'senha');
    const usuario = db.prepare('SELECT * FROM usuarios WHERE email = ?').get(email);
    if (!usuario || !conferirSenha(senha, usuario.senha_hash)) {
      throw new ErroHttp(401, 'E-mail ou senha incorretos.');
    }
    const token = abrirSessao(usuario.id);
    return {
      corpo: {
        id: usuario.id, nome: usuario.nome, email: usuario.email,
        papel: usuario.papel, turma: usuario.turma,
      },
      cabecalhos: { 'Set-Cookie': cabecalhoCookieSessao(token) },
    };
  },

  'POST /api/logout': (req) => {
    const token = lerCookie(req, 'sessao');
    if (token) encerrarSessao(token);
    return { corpo: { ok: true }, cabecalhos: { 'Set-Cookie': cookieSessaoExpirado } };
  },

  'GET /api/eu': (req) => ({ corpo: usuarioDaSessao(lerCookie(req, 'sessao')) }),

  'GET /api/materias': () => ({ corpo: repo.listarMaterias() }),

  'GET /api/livros': (req, { query }) => ({
    corpo: repo.listarLivros({ materia: query.get('materia'), busca: query.get('busca') }),
  }),

  'GET /api/livros/:slug': (req, { params }) => {
    const livro = repo.buscarLivroPorSlug(params.slug);
    if (!livro) throw new ErroHttp(404, 'Livro não encontrado.');
    return { corpo: livro };
  },

  'POST /api/livros': (req, { corpo }) => {
    exigirAdmin(req);
    const titulo = campoObrigatorio(corpo, 'titulo');
    const dados = {
      slug: gerarSlug(titulo),
      titulo,
      autor: campoObrigatorio(corpo, 'autor'),
      materia_slug: campoObrigatorio(corpo, 'materia_slug'),
      capa: corpo.capa?.trim() || null,
      sinopse: corpo.sinopse?.trim() || null,
      paginas: corpo.paginas ? inteiroPositivo(corpo.paginas, 'paginas') : null,
      idioma: corpo.idioma?.trim() || 'Português',
      exemplares: inteiroPositivo(corpo.exemplares, 'exemplares', 1),
    };
    if (repo.buscarLivroPorSlug(dados.slug)) {
      throw new ErroHttp(409, 'Já existe um livro com esse título.');
    }
    return { corpo: repo.criarLivro(dados), status: 201 };
  },

  'PUT /api/livros/:id': (req, { corpo, params }) => {
    exigirAdmin(req);
    return {
      corpo: repo.atualizarLivro(inteiroPositivo(params.id, 'id'), {
        titulo: campoObrigatorio(corpo, 'titulo'),
        autor: campoObrigatorio(corpo, 'autor'),
        materia_slug: campoObrigatorio(corpo, 'materia_slug'),
        capa: corpo.capa?.trim() || null,
        sinopse: corpo.sinopse?.trim() || null,
        paginas: corpo.paginas ? inteiroPositivo(corpo.paginas, 'paginas') : null,
        idioma: corpo.idioma?.trim() || 'Português',
      }),
    };
  },

  'DELETE /api/livros/:id': (req, { params }) => {
    exigirAdmin(req);
    repo.removerLivro(inteiroPositivo(params.id, 'id'));
    return { corpo: { ok: true } };
  },

  'POST /api/livros/:id/exemplares': (req, { corpo, params }) => {
    exigirAdmin(req);
    const quantidade = inteiroPositivo(corpo.quantidade, 'quantidade', 1);
    repo.adicionarExemplares(inteiroPositivo(params.id, 'id'), quantidade);
    return { corpo: { ok: true, adicionados: quantidade } };
  },

  'POST /api/admin/capas': (req, { corpo }) => {
    exigirAdmin(req);
    const bytes = Buffer.from(campoObrigatorio(corpo, 'dados'), 'base64');
    const formato = FORMATOS_CAPA.find((f) => f.confere(bytes));
    if (!formato) throw new ErroHttp(400, 'Envie uma imagem JPG, PNG ou WEBP.');

    // O nome vem do arquivo original, limpo; se já existir, ganha um sufixo numérico.
    const base = gerarSlug(String(corpo.nome ?? '').replace(/\.[^.]*$/, '')) || 'capa';
    let arquivo = `${base}${formato.ext}`;
    for (let i = 2; existsSync(PASTA_ASSETS + arquivo); i++) arquivo = `${base}-${i}${formato.ext}`;

    writeFileSync(PASTA_ASSETS + arquivo, bytes);
    return { corpo: { arquivo }, status: 201 };
  },

  'GET /api/reservas': (req) => {
    const usuario = exigirLogin(req);
    return { corpo: repo.listarReservasDoUsuario(usuario.id) };
  },

  'POST /api/reservas': (req, { corpo }) => {
    const usuario = exigirLogin(req);
    const livroId = inteiroPositivo(corpo.livro_id, 'livro_id');
    return { corpo: repo.criarReserva(livroId, usuario.id), status: 201 };
  },

  'POST /api/reservas/:id/cancelar': (req, { params }) => {
    const usuario = exigirLogin(req);
    const id = inteiroPositivo(params.id, 'id');
    // Admin cancela qualquer reserva; aluno, só a própria.
    const dono = usuario.papel === 'admin' ? null : usuario.id;
    return { corpo: repo.mudarStatusReserva(id, 'cancelada', dono) };
  },

  'GET /api/admin/resumo': (req) => {
    exigirAdmin(req);
    return { corpo: repo.resumoAdmin() };
  },

  'GET /api/admin/reservas': (req, { query }) => {
    exigirAdmin(req);
    return { corpo: repo.listarTodasReservas(query.get('status')) };
  },

  'POST /api/admin/reservas/:id/retirar': (req, { params }) => {
    exigirAdmin(req);
    return { corpo: repo.mudarStatusReserva(inteiroPositivo(params.id, 'id'), 'retirada') };
  },

  'POST /api/admin/reservas/:id/devolver': (req, { params }) => {
    exigirAdmin(req);
    return { corpo: repo.mudarStatusReserva(inteiroPositivo(params.id, 'id'), 'devolvida') };
  },

  'GET /api/admin/usuarios': (req) => {
    exigirAdmin(req);
    return { corpo: repo.listarUsuarios() };
  },

  'POST /api/admin/usuarios': (req, { corpo }) => {
    exigirAdmin(req);
    const nome = campoObrigatorio(corpo, 'nome');
    const email = campoObrigatorio(corpo, 'email');
    const senha = campoObrigatorio(corpo, 'senha');
    if (senha.length < 6) throw new ErroHttp(400, 'A senha precisa ter ao menos 6 caracteres.');
    const papel = corpo.papel === 'admin' ? 'admin' : 'aluno';
    if (db.prepare('SELECT 1 FROM usuarios WHERE email = ?').get(email)) {
      throw new ErroHttp(409, 'Já existe um usuário com esse e-mail.');
    }
    const { lastInsertRowid } = db.prepare(`
      INSERT INTO usuarios (nome, email, senha_hash, papel, turma)
      VALUES (?, ?, ?, ?, ?)
    `).run(nome, email, criarHashSenha(senha), papel, corpo.turma?.trim() || null);
    return {
      corpo: { id: Number(lastInsertRowid), nome, email, papel, turma: corpo.turma?.trim() || null },
      status: 201,
    };
  },
};

const tabela = Object.entries(rotas).map(([chave, handler]) => {
  const [metodo, molde] = chave.split(' ');
  const nomes = [];
  const padrao = molde.replace(/:([a-zA-Z]+)/g, (_, nome) => {
    nomes.push(nome);
    return '([^/]+)';
  });
  return { metodo, regex: new RegExp(`^${padrao}$`), nomes, handler };
});

export function resolverRota(metodo, caminho) {
  for (const rota of tabela) {
    if (rota.metodo !== metodo) continue;
    const achado = caminho.match(rota.regex);
    if (!achado) continue;
    const params = Object.fromEntries(
      rota.nomes.map((nome, i) => [nome, decodeURIComponent(achado[i + 1])])
    );
    return { handler: rota.handler, params };
  }
  return null;
}

export { ErroHttp };
