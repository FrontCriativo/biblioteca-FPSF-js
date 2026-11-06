import {
  criarHashSenha, criarHashSenhaEmSegundoPlano, gerarSenhaProvisoria, conferirSenha, abrirSessao, encerrarSessao,
  usuarioDaSessao, lerCookie, cabecalhoCookieSessao, cookieSessaoExpirado,
  loginBloqueado, segundosDeBloqueioLogin, registrarFalhaLogin, limparFalhasLogin,
  definirSenha, encerrarAcessos, buscarContaPorEmail,
  COOKIE_GOOGLE, cabecalhoCookieGoogle, cookieGoogleExpirado,
} from './auth.js';
import { googleConfigurado, urlDeAutorizacao, dominioPermitido, emailConfirmadoPeloGoogle } from './google.js';
import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { db, transacao } from './db/index.js';
import * as repo from './repositorio.js';
import { normalizarTexto, normalizarEmail } from './texto.js';
import { ErroHttp, ErroValidacao, ipDe } from './http.js';
import { criarLimitador } from './limite.js';
import { alunosDaPlanilha } from './planilha.js';

const PASTA_ASSETS = fileURLToPath(new URL('../frontend/assets/', import.meta.url));

// Assinaturas (magic bytes) das imagens aceitas como capa.
const FORMATOS_CAPA = [
  { ext: '.jpg', confere: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: '.png', confere: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { ext: '.webp', confere: (b) => b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP' },
];

export const MENSAGEM_TROCA_PENDENTE = 'Troque sua senha provisória antes de continuar.';

function erroLoginBloqueado(email, ip) {
  return new ErroHttp(429, 'Muitas tentativas. Tente de novo em alguns minutos.', {
    'Retry-After': String(segundosDeBloqueioLogin(email, ip)),
  });
}

/** Regra de login do site e da v1. Devolve a conta, ou lança o erro que a rota deve responder. */
export function autenticar(email, senha, ip) {
  if (loginBloqueado(email, ip)) throw erroLoginBloqueado(email, ip);
  const usuario = buscarContaPorEmail(email);
  if (!usuario || !conferirSenha(senha, usuario.senha_hash)) {
    registrarFalhaLogin(email, ip);
    throw new ErroHttp(401, 'E-mail ou senha incorretos.');
  }
  limparFalhasLogin(email);
  // Só depois da senha: a resposta não pode revelar quais e-mails existem.
  if (!usuario.ativo) throw new ErroHttp(403, 'Conta desativada. Procure a coordenação.');
  return usuario;
}

/** Conta no mesmo limite do login: uma credencial roubada não pode testar senhas à vontade. */
export function senhaAtualConfere(usuario, senhaAtual, ip) {
  if (loginBloqueado(usuario.email, ip)) throw erroLoginBloqueado(usuario.email, ip);
  const { senha_hash } = db.prepare('SELECT senha_hash FROM usuarios WHERE id = ?').get(usuario.id);
  if (conferirSenha(senhaAtual, senha_hash)) return true;
  registrarFalhaLogin(usuario.email, ip);
  return false;
}

/** permitirTrocaPendente: rotas que a conta com senha provisória ainda pode usar. */
function exigirLogin(req, { permitirTrocaPendente = false } = {}) {
  const usuario = usuarioDaSessao(lerCookie(req, 'sessao'));
  if (!usuario) throw new ErroHttp(401, 'Você precisa entrar para fazer isso.');
  if (usuario.trocar_senha && !permitirTrocaPendente) {
    throw new ErroHttp(403, MENSAGEM_TROCA_PENDENTE);
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

/** Confere cada linha da planilha: uma linha ruim não impede as outras de entrarem. */
function separarAlunos(alunos) {
  const validos = [];
  const ignorados = [];
  const erros = [];
  const vistos = new Set();
  for (const aluno of alunos) {
    try {
      const nome = textoLimitado(aluno, 'nome', 255);
      const email = emailValido(aluno, 'email', 255);
      const turma = textoOpcional(aluno, 'turma', 40);
      if (vistos.has(email)) throw new ErroValidacao('E-mail repetido na planilha.');
      vistos.add(email);
      if (buscarContaPorEmail(email)) ignorados.push({ linha: aluno.linha, email });
      else validos.push({ linha: aluno.linha, nome, email, turma });
    } catch (erro) {
      if (!(erro instanceof ErroValidacao)) throw erro;
      erros.push({ linha: aluno.linha, motivo: erro.message });
    }
  }
  return { validos, ignorados, erros };
}

// Envios de depoimento por IP. O limite é folgado porque a escola inteira sai pelo mesmo IP.
const enviosDepoimento = criarLimitador({ janelaMs: 60 * 60 * 1000, maximo: 20 });

const STATUS_DEPOIMENTO = ['pendente', 'aprovado', 'recusado'];

// Mesma lógica dos depoimentos, com contagem própria: a escola inteira sai pelo mesmo IP.
const enviosContato = criarLimitador({ janelaMs: 60 * 60 * 1000, maximo: 20 });

const ASSUNTOS_CONTATO = ['Sugestão de livro', 'Dúvida sobre empréstimo', 'Problema de acesso', 'Outro assunto'];
const STATUS_MENSAGEM = ['nova', 'lida', 'respondida'];

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

/**
 * Fim do login com o Google, que é uma navegação e não uma chamada da página: o erro vai
 * como código na URL. Com a sessão aberta, a própria login.html leva ao destino.
 */
function voltarAoLogin({ destino, erro, cookies = [] }) {
  const parametros = new URLSearchParams();
  if (destino) parametros.set('destino', destino);
  if (erro) parametros.set('erro', erro);
  const busca = parametros.size ? `?${parametros}` : '';
  return {
    status: 302,
    corpo: null,
    cabecalhos: { Location: `/login.html${busca}`, 'Set-Cookie': [cookieGoogleExpirado, ...cookies] },
  };
}

// Cada rota devolve { corpo } ou { corpo, cabecalhos }. status é opcional, e a rota pode ser async.
const rotas = {
  'POST /api/login': (req, { corpo }) => {
    const email = normalizarEmail(campoObrigatorio(corpo, 'email'));
    const senha = campoObrigatorio(corpo, 'senha');
    const usuario = autenticar(email, senha, ipDe(req));
    const token = abrirSessao(usuario.id);
    return {
      corpo: {
        id: usuario.id, nome: usuario.nome, email: usuario.email,
        papel: usuario.papel, turma: usuario.turma, trocar_senha: usuario.trocar_senha,
      },
      cabecalhos: { 'Set-Cookie': cabecalhoCookieSessao(token) },
    };
  },

  'GET /api/auth/google': (req, { query }) => {
    // Mesma regra da login.js: só páginas internas.
    const pedido = query.get('destino') ?? '';
    const destino = /^[a-z0-9-]+\.html$/.test(pedido) ? pedido : '';
    if (!googleConfigurado()) return voltarAoLogin({ destino, erro: 'google-indisponivel' });
    const estado = randomBytes(32).toString('hex');
    return {
      status: 302,
      corpo: null,
      cabecalhos: {
        Location: urlDeAutorizacao(estado),
        'Set-Cookie': cabecalhoCookieGoogle(`${estado}:${destino}`),
      },
    };
  },

  'GET /api/auth/google/retorno': async (req, { query }) => {
    const [estado, destino] = (lerCookie(req, COOKIE_GOOGLE) ?? '').split(':');
    // Sem esta conferência, um link pronto poderia entrar na conta de outra pessoa
    // no navegador da vítima, que passaria a usar o site achando que a conta é a dela.
    if (!estado || query.get('state') !== estado) return voltarAoLogin({ erro: 'google-falhou' });

    const codigo = query.get('code');
    if (!codigo) return voltarAoLogin({ destino, erro: 'google-cancelado' });

    let email;
    try {
      email = await emailConfirmadoPeloGoogle(codigo);
    } catch (erro) {
      console.error('Login com o Google falhou:', erro.message);
      return voltarAoLogin({ destino, erro: 'google-falhou' });
    }
    if (!dominioPermitido(email)) return voltarAoLogin({ destino, erro: 'google-dominio' });

    const usuario = buscarContaPorEmail(email);
    if (!usuario) return voltarAoLogin({ destino, erro: 'google-sem-conta' });
    if (!usuario.ativo) return voltarAoLogin({ destino, erro: 'conta-desativada' });
    return voltarAoLogin({ destino, cookies: [cabecalhoCookieSessao(abrirSessao(usuario.id))] });
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
    if (!senhaAtualConfere(usuario, senhaAtual, ipDe(req))) {
      throw new ErroHttp(400, 'A senha atual está incorreta.');
    }
    if (nova === senhaAtual) throw new ErroHttp(400, 'A nova senha precisa ser diferente da atual.');
    // Quem tinha a senha antiga perde o acesso, nas outras sessões e no aplicativo; esta continua.
    transacao(() => {
      definirSenha(usuario.id, nova, { trocarSenha: false });
      encerrarAcessos(usuario.id, { manterSessao: lerCookie(req, 'sessao') });
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

  'GET /api/favoritos': (req) => {
    const usuario = exigirLogin(req);
    return { corpo: repo.listarFavoritos(usuario.id) };
  },

  'PUT /api/favoritos/:livroId': (req, { params }) => {
    const usuario = exigirLogin(req);
    const livroId = inteiroPositivo(params.livroId, 'livroId');
    if (!repo.livroExiste(livroId)) throw new ErroHttp(404, 'Livro não encontrado.');
    repo.adicionarFavorito(usuario.id, livroId);
    return { corpo: { ok: true } };
  },

  'DELETE /api/favoritos/:livroId': (req, { params }) => {
    const usuario = exigirLogin(req);
    repo.removerFavorito(usuario.id, inteiroPositivo(params.livroId, 'livroId'));
    return { corpo: { ok: true } };
  },

  'POST /api/reservas/:id/renovar': (req, { params }) => {
    const usuario = exigirLogin(req);
    return { corpo: repo.renovarReserva(inteiroPositivo(params.id, 'id'), usuario.id) };
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

  'POST /api/admin/reservas/:id/renovar': (req, { params }) => {
    exigirAdmin(req);
    return { corpo: repo.renovarReserva(inteiroPositivo(params.id, 'id')) };
  },

  'PUT /api/admin/reservas/:id/observacao': (req, { corpo, params }) => {
    exigirAdmin(req);
    if (!('observacao' in corpo)) throw new ErroValidacao('O campo "observacao" é obrigatório.');
    const observacao = textoOpcional(corpo, 'observacao', 500);
    return { corpo: repo.definirObservacao(inteiroPositivo(params.id, 'id'), observacao) };
  },

  'GET /api/admin/turmas': (req) => {
    exigirAdmin(req);
    return { corpo: repo.listarTurmas() };
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
    return { corpo: repo.criarUsuario({ nome, email, senhaHash: criarHashSenha(senha), papel, turma }), status: 201 };
  },

  // Só cria alunos: conta da coordenação continua sendo cadastrada uma a uma.
  'POST /api/admin/usuarios/importar': async (req, { corpo }) => {
    exigirAdmin(req);
    const { validos, ignorados, erros } = separarAlunos(alunosDaPlanilha(campoObrigatorio(corpo, 'csv')));

    const preparados = await Promise.all(validos.map(async (aluno) => {
      const senha = gerarSenhaProvisoria();
      return { ...aluno, senha, senhaHash: await criarHashSenhaEmSegundoPlano(senha) };
    }));
    const criados = repo.criarAlunosEmLote(preparados);

    // Quem foi cadastrado por outra pessoa enquanto os hashes eram calculados também é ignorado.
    const entraram = new Set(criados.map((a) => a.email));
    for (const { linha, email } of preparados) {
      if (!entraram.has(email)) ignorados.push({ linha, email });
    }
    return {
      corpo: {
        criados: criados.map(({ nome, email, turma, senha }) => ({ nome, email, turma, senha })),
        ignorados,
        erros,
      },
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
      encerrarAcessos(id);
    });
    return { corpo: { ok: true } };
  },

  'POST /api/admin/usuarios/:id/desativar': (req, { params }) => {
    const admin = exigirAdmin(req);
    const id = inteiroPositivo(params.id, 'id');
    if (id === admin.id) throw new ErroHttp(400, 'Você não pode desativar a própria conta.');
    if (!repo.usuarioExiste(id)) throw new ErroHttp(404, 'Usuário não encontrado.');
    const reservasCanceladas = transacao(() => {
      repo.definirContaAtiva(id, false);
      encerrarAcessos(id);
      return repo.cancelarReservasAtivasDoUsuario(id);
    });
    return { corpo: { ok: true, reservas_canceladas: reservasCanceladas } };
  },

  'POST /api/admin/usuarios/:id/reativar': (req, { params }) => {
    exigirAdmin(req);
    const id = inteiroPositivo(params.id, 'id');
    if (!repo.usuarioExiste(id)) throw new ErroHttp(404, 'Usuário não encontrado.');
    repo.definirContaAtiva(id, true);
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

  'POST /api/contato': (req, { corpo }) => {
    const assunto = campoObrigatorio(corpo, 'assunto');
    if (!ASSUNTOS_CONTATO.includes(assunto)) throw new ErroValidacao('Escolha um assunto da lista.');
    const dados = {
      nome: textoLimitado(corpo, 'nome', 80),
      turma: textoOpcional(corpo, 'turma', 40),
      email: textoOpcional(corpo, 'email', 120) && emailValido(corpo, 'email', 120),
      assunto,
      mensagem: textoLimitado(corpo, 'mensagem', 2000),
      usuarioId: usuarioDaSessao(lerCookie(req, 'sessao'))?.id,
    };
    if (!enviosContato.consumir(ipDe(req))) {
      throw new ErroHttp(429, 'Muitas mensagens enviadas daqui. Tente de novo mais tarde.');
    }
    return { corpo: repo.criarMensagem(dados), status: 201 };
  },

  'GET /api/admin/mensagens': (req, { query }) => {
    exigirAdmin(req);
    const status = query.get('status');
    return { corpo: repo.listarMensagens(STATUS_MENSAGEM.includes(status) ? status : null) };
  },

  'POST /api/admin/mensagens/:id/status': (req, { corpo, params }) => {
    exigirAdmin(req);
    const status = campoObrigatorio(corpo, 'status');
    if (!STATUS_MENSAGEM.includes(status)) throw new ErroValidacao('Status inválido.');
    return { corpo: repo.mudarStatusMensagem(inteiroPositivo(params.id, 'id'), status) };
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
