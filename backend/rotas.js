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
import { normalizarTexto, normalizarEmail } from './texto.js';
import { ErroHttp, ErroValidacao, ipDe } from './http.js';
import { criarLimitador } from './limite.js';

const PASTA_ASSETS = fileURLToPath(new URL('../frontend/assets/', import.meta.url));

// Assinaturas (magic bytes) das imagens aceitas como capa.
const FORMATOS_CAPA = [
  { ext: '.jpg', confere: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: '.png', confere: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { ext: '.webp', confere: (b) => b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP' },
];

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

export function campoObrigatorio(corpo, campo) {
  const valor = corpo?.[campo];
  if (typeof valor !== 'string' || !valor.trim()) {
    throw new ErroValidacao(`O campo "${campo}" é obrigatório.`);
  }
  return valor.trim();
}

export function textoLimitado(corpo, campo, maximo) {
  const valor = campoObrigatorio(corpo, campo);
  if (valor.length > maximo) {
    throw new ErroValidacao(`O campo "${campo}" aceita no máximo ${maximo} caracteres.`);
  }
  return valor;
}

/** Texto que pode faltar: ausente ou em branco vira null. */
export function textoOpcional(corpo, campo, maximo) {
  const valor = corpo?.[campo];
  if (valor === undefined || valor === null) return null;
  if (typeof valor !== 'string') throw new ErroValidacao(`O campo "${campo}" deve ser um texto.`);
  return valor.trim() ? textoLimitado(corpo, campo, maximo) : null;
}

const FORMATO_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Devolve o e-mail já normalizado, que é a forma gravada no banco. */
export function emailValido(corpo, campo, maximo) {
  const email = normalizarEmail(textoLimitado(corpo, campo, maximo));
  if (!FORMATO_EMAIL.test(email)) {
    throw new ErroValidacao(`O campo "${campo}" deve ser um e-mail válido.`);
  }
  return email;
}

const TAMANHO_MINIMO_SENHA = 8;

export function senhaNova(corpo, campo) {
  const senha = campoObrigatorio(corpo, campo);
  if (senha.length < TAMANHO_MINIMO_SENHA) {
    throw new ErroValidacao(`A senha precisa ter ao menos ${TAMANHO_MINIMO_SENHA} caracteres.`);
  }
  return senha;
}

// Envios de depoimento por IP. O limite é folgado porque a escola inteira sai pelo mesmo IP.
const enviosDepoimento = criarLimitador({ janelaMs: 60 * 60 * 1000, maximo: 20 });

const STATUS_DEPOIMENTO = ['pendente', 'aprovado', 'recusado'];

export function inteiroPositivo(valor, campo, padrao = null) {
  if (valor === undefined || valor === '') {
    if (padrao !== null) return padrao;
    throw new ErroValidacao(`O campo "${campo}" é obrigatório.`);
  }
  const n = Number(valor);
  if (!Number.isInteger(n) || n < 1) {
    throw new ErroValidacao(`O campo "${campo}" deve ser um número inteiro positivo.`);
  }
  return n;
}

function inteiroAte(valor, campo, maximo, padrao) {
  const n = inteiroPositivo(valor, campo, padrao);
  if (n > maximo) throw new ErroValidacao(`O campo "${campo}" aceita no máximo ${maximo}.`);
  return n;
}

// Só o nome: a capa vira parte de um caminho em assets/ e não pode apontar para fora de lá.
const FORMATO_NOME_ARQUIVO = /^[\w.\-]+$/;

function nomeDeArquivo(corpo, campo) {
  const nome = textoOpcional(corpo, campo, 255);
  if (nome !== null && (!FORMATO_NOME_ARQUIVO.test(nome) || /^\.+$/.test(nome))) {
    throw new ErroValidacao(`O campo "${campo}" deve ser só o nome de um arquivo.`);
  }
  return nome;
}

/** Campos comuns à criação e à edição de um livro. */
function dadosDoLivro(corpo) {
  const materia_slug = campoObrigatorio(corpo, 'materia_slug');
  if (!repo.materiaExiste(materia_slug)) {
    throw new ErroValidacao('A matéria informada não existe.');
  }
  const semPaginas = corpo.paginas === undefined || corpo.paginas === null || corpo.paginas === '';
  return {
    titulo: textoLimitado(corpo, 'titulo', 255),
    autor: textoLimitado(corpo, 'autor', 255),
    materia_slug,
    capa: nomeDeArquivo(corpo, 'capa'),
    sinopse: textoOpcional(corpo, 'sinopse', 5000),
    paginas: semPaginas ? null : inteiroAte(corpo.paginas, 'paginas', 100_000),
    idioma: textoOpcional(corpo, 'idioma', 60) ?? 'Português',
  };
}

function gerarSlug(titulo) {
  return normalizarTexto(titulo)
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// Cada rota devolve { corpo } ou { corpo, cabecalhos }.
const rotas = {
  'POST /api/login': (req, { corpo }) => {
    const email = normalizarEmail(campoObrigatorio(corpo, 'email'));
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
    const livro = dadosDoLivro(corpo);
    const dados = {
      ...livro,
      slug: gerarSlug(livro.titulo),
      exemplares: inteiroAte(corpo.exemplares, 'exemplares', 200, 1),
    };
    if (repo.buscarLivroPorSlug(dados.slug)) {
      throw new ErroHttp(409, 'Já existe um livro com esse título.');
    }
    return { corpo: repo.criarLivro(dados), status: 201 };
  },

  'PUT /api/livros/:id': (req, { corpo, params }) => {
    exigirAdmin(req);
    const id = inteiroPositivo(params.id, 'id');
    const dados = dadosDoLivro(corpo);
    if (!repo.livroExiste(id)) throw new ErroHttp(404, 'Livro não encontrado.');
    return { corpo: repo.atualizarLivro(id, dados) };
  },

  'DELETE /api/livros/:id': (req, { params }) => {
    exigirAdmin(req);
    repo.removerLivro(inteiroPositivo(params.id, 'id'));
    return { corpo: { ok: true } };
  },

  'POST /api/livros/:id/exemplares': (req, { corpo, params }) => {
    exigirAdmin(req);
    const id = inteiroPositivo(params.id, 'id');
    const quantidade = inteiroAte(corpo.quantidade, 'quantidade', 200, 1);
    if (!repo.livroExiste(id)) throw new ErroHttp(404, 'Livro não encontrado.');
    repo.adicionarExemplares(id, quantidade);
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
    const nome = textoLimitado(corpo, 'nome', 255);
    const email = emailValido(corpo, 'email', 255);
    const senha = senhaNova(corpo, 'senha');
    const turma = textoOpcional(corpo, 'turma', 40);
    const papel = corpo.papel === 'admin' ? 'admin' : 'aluno';
    if (db.prepare('SELECT 1 FROM usuarios WHERE email = ?').get(email)) {
      throw new ErroHttp(409, 'Já existe um usuário com esse e-mail.');
    }
    // A senha cadastrada pela coordenação é provisória: o usuário troca no primeiro acesso.
    const { lastInsertRowid } = db.prepare(`
      INSERT INTO usuarios (nome, email, senha_hash, papel, turma, trocar_senha)
      VALUES (?, ?, ?, ?, ?, 1)
    `).run(nome, email, criarHashSenha(senha), papel, turma);
    return { corpo: { id: Number(lastInsertRowid), nome, email, papel, turma }, status: 201 };
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
    if (!enviosDepoimento.consumir(ipDe(req))) {
      throw new ErroHttp(429, 'Muitos depoimentos enviados daqui. Tente de novo mais tarde.');
    }
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

/**
 * Monta um roteador a partir de { 'MÉTODO /caminho/:param': handler }.
 * resolver() devolve { handler, params } ou null; metodosDe() lista os métodos que um
 * caminho aceita, para quem responde 405 em vez de 404.
 */
export function criarRoteador(tabelaDeRotas) {
  const tabela = Object.entries(tabelaDeRotas).map(([chave, handler]) => {
    const [metodo, molde] = chave.split(' ');
    const nomes = [];
    const padrao = molde.replace(/:([a-zA-Z]+)/g, (_, nome) => {
      nomes.push(nome);
      return '([^/]+)';
    });
    return { metodo, regex: new RegExp(`^${padrao}$`), nomes, handler };
  });

  return {
    resolver(metodo, caminho) {
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
    },

    metodosDe: (caminho) => tabela.filter((rota) => rota.regex.test(caminho)).map((rota) => rota.metodo),
  };
}

const roteador = criarRoteador(rotas);

export const resolverRota = roteador.resolver;
