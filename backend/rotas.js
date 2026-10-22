import {
  criarHashSenha, conferirSenha, abrirSessao, encerrarSessao,
  usuarioDaSessao, lerCookie, cabecalhoCookieSessao, cookieSessaoExpirado,
  loginBloqueado, registrarFalhaLogin, limparFalhasLogin,
  definirSenha, encerrarSessoesDoUsuario,
} from './auth.js';
import { existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { db, transacao } from './db/index.js';
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

/** permitirTrocaPendente: rotas que a conta com senha provisória ainda pode usar. */
function exigirLogin(req, { permitirTrocaPendente = false } = {}) {
  const usuario = usuarioDaSessao(lerCookie(req, 'sessao'));
  if (!usuario) throw new ErroHttp(401, 'Você precisa entrar para fazer isso.');
  if (usuario.trocar_senha && !permitirTrocaPendente) {
    throw new ErroHttp(403, 'Troque sua senha provisória antes de continuar.');
  }
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

function textoLimitado(corpo, campo, maximo) {
  const valor = campoObrigatorio(corpo, campo);
  if (valor.length > maximo) {
    throw new ErroHttp(400, `O campo "${campo}" aceita no máximo ${maximo} caracteres.`);
  }
  return valor;
}

const TAMANHO_MINIMO_SENHA = 8;

function senhaNova(corpo, campo) {
  const senha = campoObrigatorio(corpo, campo);
  if (senha.length < TAMANHO_MINIMO_SENHA) {
    throw new ErroHttp(400, `A senha precisa ter ao menos ${TAMANHO_MINIMO_SENHA} caracteres.`);
  }
  return senha;
}

// Endereço da conexão, e não X-Forwarded-For: esse cabeçalho o próprio cliente pode inventar.
const ipDe = (req) => req.socket.remoteAddress ?? 'desconhecido';

// Envios de depoimento por IP, em memória (mesma ideia do limite de login em auth.js).
// O limite é folgado porque a escola inteira sai pelo mesmo IP.
const MAX_DEPOIMENTOS_IP = 20;
const JANELA_DEPOIMENTOS_MS = 60 * 60 * 1000;
const enviosDepoimento = new Map(); // ip → { contagem, inicio }

function registrarEnvioDepoimento(ip) {
  const agora = Date.now();
  const registro = enviosDepoimento.get(ip);
  if (!registro || agora - registro.inicio >= JANELA_DEPOIMENTOS_MS) {
    enviosDepoimento.set(ip, { contagem: 1, inicio: agora });
    return;
  }
  if (registro.contagem >= MAX_DEPOIMENTOS_IP) {
    throw new ErroHttp(429, 'Muitos depoimentos enviados daqui. Tente de novo mais tarde.');
  }
  registro.contagem++;
}

/** Tira do Map os registros cuja janela já passou, para ele não crescer sem limite. */
export function apagarEnviosDepoimentoVencidos() {
  const agora = Date.now();
  for (const [ip, registro] of enviosDepoimento) {
    if (agora - registro.inicio >= JANELA_DEPOIMENTOS_MS) enviosDepoimento.delete(ip);
  }
}

const STATUS_DEPOIMENTO = ['pendente', 'aprovado', 'recusado'];

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
    const ip = ipDe(req);
    if (loginBloqueado(email, ip)) {
      throw new ErroHttp(429, 'Muitas tentativas. Tente de novo em alguns minutos.');
    }
    const usuario = db.prepare('SELECT * FROM usuarios WHERE email = ?').get(email);
    if (!usuario || !conferirSenha(senha, usuario.senha_hash)) {
      registrarFalhaLogin(email, ip);
      throw new ErroHttp(401, 'E-mail ou senha incorretos.');
    }
    limparFalhasLogin(email);
    const token = abrirSessao(usuario.id);
    return {
      corpo: {
        id: usuario.id, nome: usuario.nome, email: usuario.email,
        papel: usuario.papel, turma: usuario.turma, trocar_senha: usuario.trocar_senha,
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

  'POST /api/eu/senha': (req, { corpo }) => {
    const usuario = exigirLogin(req, { permitirTrocaPendente: true });
    const senhaAtual = campoObrigatorio(corpo, 'senha_atual');
    const nova = senhaNova(corpo, 'nova_senha');
    // Conta no mesmo limite do login: uma sessão roubada não pode testar senhas à vontade.
    const ip = ipDe(req);
    if (loginBloqueado(usuario.email, ip)) {
      throw new ErroHttp(429, 'Muitas tentativas. Tente de novo em alguns minutos.');
    }
    const { senha_hash } = db.prepare('SELECT senha_hash FROM usuarios WHERE id = ?').get(usuario.id);
    if (!conferirSenha(senhaAtual, senha_hash)) {
      registrarFalhaLogin(usuario.email, ip);
      throw new ErroHttp(400, 'A senha atual está incorreta.');
    }
    if (nova === senhaAtual) throw new ErroHttp(400, 'A nova senha precisa ser diferente da atual.');
    // As outras sessões caem (quem tinha a senha antiga perde o acesso); esta continua.
    transacao(() => {
      definirSenha(usuario.id, nova, { trocarSenha: false });
      encerrarSessoesDoUsuario(usuario.id, lerCookie(req, 'sessao'));
    });
    return { corpo: { ok: true } };
  },

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
    const limite = usuario.papel === 'admin' ? null : repo.LIMITE_RESERVAS_ALUNO;
    return { corpo: repo.criarReserva(livroId, usuario.id, { limite }), status: 201 };
  },

  'POST /api/reservas/:id/cancelar': (req, { params }) => {
    const usuario = exigirLogin(req);
    const id = inteiroPositivo(params.id, 'id');
    // Admin cancela qualquer reserva, ativa ou retirada; aluno, só a própria e ainda ativa.
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
    const senha = senhaNova(corpo, 'senha');
    const papel = corpo.papel === 'admin' ? 'admin' : 'aluno';
    if (db.prepare('SELECT 1 FROM usuarios WHERE email = ?').get(email)) {
      throw new ErroHttp(409, 'Já existe um usuário com esse e-mail.');
    }
    // A senha cadastrada pela coordenação é provisória: o usuário troca no primeiro acesso.
    const { lastInsertRowid } = db.prepare(`
      INSERT INTO usuarios (nome, email, senha_hash, papel, turma, trocar_senha)
      VALUES (?, ?, ?, ?, ?, 1)
    `).run(nome, email, criarHashSenha(senha), papel, corpo.turma?.trim() || null);
    return {
      corpo: { id: Number(lastInsertRowid), nome, email, papel, turma: corpo.turma?.trim() || null },
      status: 201,
    };
  },

  'POST /api/admin/usuarios/:id/senha': (req, { corpo, params }) => {
    const admin = exigirAdmin(req);
    const id = inteiroPositivo(params.id, 'id');
    if (id === admin.id) {
      throw new ErroHttp(400, 'Para mudar a sua própria senha, use "Trocar senha" no menu.');
    }
    const senha = senhaNova(corpo, 'senha');
    if (!db.prepare('SELECT 1 FROM usuarios WHERE id = ?').get(id)) {
      throw new ErroHttp(404, 'Usuário não encontrado.');
    }
    transacao(() => {
      definirSenha(id, senha, { trocarSenha: true });
      encerrarSessoesDoUsuario(id);
    });
    return { corpo: { ok: true } };
  },

  'GET /api/depoimentos': () => ({ corpo: repo.listarDepoimentosAprovados() }),

  'POST /api/depoimentos': (req, { corpo }) => {
    const dados = {
      nome: textoLimitado(corpo, 'nome', 80),
      turma: textoLimitado(corpo, 'turma', 60),
      mensagem: textoLimitado(corpo, 'mensagem', 1000),
      nota: Number(corpo.nota),
      usuarioId: usuarioDaSessao(lerCookie(req, 'sessao'))?.id,
    };
    if (!Number.isInteger(dados.nota) || dados.nota < 1 || dados.nota > 5) {
      throw new ErroHttp(400, 'A nota deve ser um número de 1 a 5.');
    }
    registrarEnvioDepoimento(ipDe(req));
    // Sempre entra como pendente: só aparece no site depois da moderação.
    return { corpo: repo.criarDepoimento(dados), status: 201 };
  },

  'GET /api/admin/depoimentos': (req, { query }) => {
    exigirAdmin(req);
    const status = query.get('status');
    return { corpo: repo.listarDepoimentos(STATUS_DEPOIMENTO.includes(status) ? status : null) };
  },

  'POST /api/admin/depoimentos/:id/aprovar': (req, { params }) => {
    exigirAdmin(req);
    return { corpo: repo.moderarDepoimento(inteiroPositivo(params.id, 'id'), 'aprovado') };
  },

  'POST /api/admin/depoimentos/:id/recusar': (req, { params }) => {
    exigirAdmin(req);
    return { corpo: repo.moderarDepoimento(inteiroPositivo(params.id, 'id'), 'recusado') };
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
    let params;
    try {
      params = Object.fromEntries(
        rota.nomes.map((nome, i) => [nome, decodeURIComponent(achado[i + 1])])
      );
    } catch {
      throw new ErroHttp(400, 'Requisição inválida.'); // escape malformado, ex.: /api/livros/%E0%A4%A
    }
    return { handler: rota.handler, params };
  }
  return null;
}

export { ErroHttp };
