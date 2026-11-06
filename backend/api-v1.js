// API pública v1 (/api/v1), para o aplicativo e outros sistemas.
//
// O contrato é o mesmo da versão Laravel: o aplicativo Expo funciona com qualquer um
// dos dois back-ends. Não troque nomes de campo sem combinar com quem consome a API.
//
// Diferenças em relação à API do site (rotas.js):
//   - envelope { success, data } e erros { success: false, erro };
//   - validação responde 422, e não 400;
//   - autenticação só por token Bearer: o cookie de sessão não vale aqui;
//   - CORS liberado e limite de requisições por IP.

import { ErroHttp, ErroValidacao, responderJson, lerCorpo, ipDe } from './http.js';
import { criarLimitador } from './limite.js';
import {
  criarRoteador, autenticar, senhaAtualConfere, MENSAGEM_TROCA_PENDENTE,
  campoObrigatorio, textoLimitado, textoOpcional, emailValido, senhaNova, inteiroPositivo,
} from './rotas.js';
import { definirSenha, emitirToken, apagarToken, usuarioDoToken, encerrarAcessos } from './auth.js';
import { transacao } from './db/index.js';
import * as repo from './repositorio.js';

const MINUTO_MS = 60 * 1000;
const TOTAL_DESTAQUES = 6;

// Contadores próprios: o uso da v1 não gasta os limites do site, e vice-versa.
const limiteGeral = criarLimitador({
  janelaMs: MINUTO_MS,
  maximo: Number(process.env.V1_LIMITE_POR_MINUTO) || 60,
});
const limiteLogin = criarLimitador({ janelaMs: MINUTO_MS, maximo: 10 });

function consumirLimite(limite, ip) {
  if (limite.consumir(ip)) return;
  throw new ErroHttp(429, 'Muitas tentativas. Aguarde um minuto e tente de novo.', {
    'Retry-After': String(limite.segundosRestantes(ip)),
  });
}

/** Sem cookie envolvido (Allow-Credentials fica de fora), liberar a origem não expõe sessão nenhuma. */
function cabecalhosCors(req) {
  const origens = (process.env.CORS_ORIGENS ?? '*').split(',').map((o) => o.trim()).filter(Boolean);
  const comuns = {
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, Accept',
    'Access-Control-Expose-Headers': 'Retry-After',
  };
  if (origens.includes('*')) return { ...comuns, 'Access-Control-Allow-Origin': '*' };
  const origem = req.headers.origin;
  return {
    ...comuns,
    Vary: 'Origin',
    ...(origens.includes(origem) ? { 'Access-Control-Allow-Origin': origem } : {}),
  };
}

const sucesso = (data) => ({ corpo: { success: true, data } });

function sucessoComMensagem(mensagem, data) {
  return { corpo: { success: true, mensagem, ...(data === undefined ? {} : { data }) } };
}

/** O SQLite guarda "AAAA-MM-DD HH:MM:SS" em UTC. */
const dataIso = (texto) => (texto ? `${texto.replace(' ', 'T')}Z` : null);

function tokenDe(req) {
  return /^Bearer\s+(\S+)$/i.exec(req.headers.authorization ?? '')?.[1] ?? null;
}

/** permitirTrocaPendente: rotas que a conta com senha provisória ainda pode usar. */
function exigirToken(req, { permitirTrocaPendente = false } = {}) {
  const usuario = usuarioDoToken(tokenDe(req));
  if (!usuario) throw new ErroHttp(401, 'Você precisa entrar para fazer isso.');
  if (usuario.trocar_senha && !permitirTrocaPendente) throw new ErroHttp(403, MENSAGEM_TROCA_PENDENTE);
  return usuario;
}

const usuarioV1 = ({ id, nome, email, papel, turma, trocar_senha }) => ({
  id, nome, email, papel, turma, trocar_senha: Boolean(trocar_senha),
});

const depoimentoV1 = ({ id, nome, turma, mensagem, nota, criado_em }) => ({
  id, nome, descricao_autor: turma, texto: mensagem, nota, criado_em: dataIso(criado_em),
});

/** Só o que é do leitor: sem a observação interna e sem repetir os dados da conta. */
const reservaV1 = (r) => ({
  id: r.id,
  status: r.status,
  criada_em: dataIso(r.criada_em),
  expira_em: dataIso(r.expira_em),
  encerrada_em: dataIso(r.encerrada_em),
  retirada_em: dataIso(r.retirada_em),
  devolver_ate: dataIso(r.devolver_ate),
  renovacoes: r.renovacoes,
  atrasada: Boolean(r.atrasada),
  pode_renovar: Boolean(r.pode_renovar),
  novo_prazo: dataIso(r.novo_prazo),
  exemplar_codigo: r.exemplar_codigo,
  livro_slug: r.livro_slug,
  titulo: r.titulo,
  autor: r.autor,
  capa: r.capa,
});

function produtoV1(livro, destaques) {
  return {
    id: livro.id,
    slug: livro.slug,
    titulo: livro.titulo,
    autor: livro.autor,
    categoria_produto: { id_categoria: livro.materia_slug, nome_categoria: livro.materia_nome },
    genero: livro.materia_nome,
    imagem: livro.capa,
    status: livro.disponiveis > 0 ? 'disponivel' : 'emprestado',
    // O acervo não tem livro inativo: quem sai do catálogo é removido.
    status_produto: 'ATIVO',
    livrosDestaque: destaques.has(livro.id) ? 'SIM' : 'NAO',
    descricao: livro.sinopse,
    total_exemplares: livro.total_exemplares,
    disponiveis: livro.disponiveis,
  };
}

const idsEmDestaque = () => new Set(repo.idsDosLivrosMaisRecentes(TOTAL_DESTAQUES));

function iniciarSessaoDeToken(req, corpo, email, senha) {
  const dispositivo = textoOpcional(corpo, 'device_name', 100) ?? 'app';
  const usuario = autenticar(email, senha, ipDe(req));
  return { token: emitirToken(usuario.id, dispositivo), usuario: usuarioV1(usuario) };
}

function atualizarPerfil(req, corpo, { parcial }) {
  const usuario = exigirToken(req);
  const dados = {};
  if (!parcial || 'nome' in corpo) dados.nome = textoLimitado(corpo, 'nome', 80);
  if (!parcial || 'email' in corpo) dados.email = emailValido(corpo, 'email', 120);
  if (dados.email && repo.emailEmUso(dados.email, usuario.id)) {
    throw new ErroValidacao('Já existe um usuário com esse e-mail.');
  }
  repo.atualizarPerfil(usuario.id, dados);
  return sucessoComMensagem('Perfil atualizado com sucesso.', usuarioV1({ ...usuario, ...dados }));
}

function trocarSenha(req, { corpo }) {
  const usuario = exigirToken(req, { permitirTrocaPendente: true });
  const senhaAtual = campoObrigatorio(corpo, 'senha_atual');
  const nova = senhaNova(corpo, 'nova_senha');
  if (String(corpo.nova_senha_confirmation ?? '').trim() !== nova) {
    throw new ErroValidacao('A confirmação da nova senha não confere.');
  }
  if (nova === senhaAtual) throw new ErroValidacao('A nova senha precisa ser diferente da atual.');
  if (!senhaAtualConfere(usuario, senhaAtual, ipDe(req))) throw new ErroValidacao('Senha atual incorreta.');
  // Quem tinha a senha antiga perde o acesso, no site e nos aparelhos; este token continua.
  transacao(() => {
    definirSenha(usuario.id, nova, { trocarSenha: false });
    encerrarAcessos(usuario.id, { manterToken: usuario.token_id });
  });
  return sucessoComMensagem('Senha alterada com sucesso.');
}

const rotas = {
  'GET /api/v1/status': () => sucesso({
    aplicacao: 'Biblioteca Virtual FPSF',
    api: 'v1',
    status: 'online',
    data_hora: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
  }),

  'GET /api/v1/depoimentos': () => sucesso(repo.listarDepoimentosAprovados().map(depoimentoV1)),

  'GET /api/v1/materias': () => sucesso(repo.listarMaterias()),

  'GET /api/v1/materias/:slug/livros': (req, { params }) => {
    if (!repo.materiaExiste(params.slug)) throw new ErroHttp(404, 'Matéria não encontrada.');
    return sucesso(repo.listarLivros({ materia: params.slug }));
  },

  'GET /api/v1/livros': (req, { query }) => sucesso(
    repo.listarLivros({ materia: query.get('materia'), busca: query.get('busca') })
  ),

  'GET /api/v1/livros/:slug': (req, { params }) => {
    const livro = repo.buscarLivroPorSlug(params.slug);
    if (!livro) throw new ErroHttp(404, 'Livro não encontrado.');
    return sucesso(livro);
  },

  'POST /api/v1/auth/login': (req, { corpo }) => {
    consumirLimite(limiteLogin, ipDe(req));
    const email = emailValido(corpo, 'email', 255);
    const senha = campoObrigatorio(corpo, 'senha');
    return sucessoComMensagem('Login realizado com sucesso.', iniciarSessaoDeToken(req, corpo, email, senha));
  },

  'POST /api/v1/auth/logout': (req) => {
    const usuario = exigirToken(req, { permitirTrocaPendente: true });
    apagarToken(usuario.token_id);
    return sucessoComMensagem('Logout realizado com sucesso.');
  },

  'GET /api/v1/usuario': (req) => sucesso(usuarioV1(exigirToken(req, { permitirTrocaPendente: true }))),

  'PUT /api/v1/usuario': (req, { corpo }) => atualizarPerfil(req, corpo, { parcial: false }),

  'PATCH /api/v1/usuario': (req, { corpo }) => atualizarPerfil(req, corpo, { parcial: true }),

  'PUT /api/v1/usuario/senha': trocarSenha,

  // Rotas do aplicativo Expo: as mesmas operações, com os nomes de rota e de campo do app.

  'POST /api/v1/login': (req, { corpo }) => {
    consumirLimite(limiteLogin, ipDe(req));
    const email = emailValido(corpo, 'email', 255);
    const senha = campoObrigatorio(corpo, 'password');
    return {
      corpo: {
        success: true,
        mensagem: 'Login realizado com sucesso.',
        ...iniciarSessaoDeToken(req, corpo, email, senha),
      },
    };
  },

  'GET /api/v1/produto': () => {
    const destaques = idsEmDestaque();
    return sucesso(repo.listarLivros().map((livro) => produtoV1(livro, destaques)));
  },

  'GET /api/v1/produto/:id': (req, { params }) => {
    // Como no Laravel: id que não é número não chega a ser um livro inexistente.
    if (!/^\d+$/.test(params.id)) throw new ErroHttp(404, 'Rota não encontrada.');
    const livro = repo.buscarLivroPorId(Number(params.id));
    if (!livro) throw new ErroHttp(404, 'Livro não encontrado.');
    return sucesso(produtoV1(livro, idsEmDestaque()));
  },

  'GET /api/v1/categoria': () => {
    const materias = repo.listarMaterias().sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    return sucesso(materias.map((m, i) => ({
      id_categoria: m.slug,
      nome_categoria: m.nome,
      status_categoria: 'ATIVO',
      ordem_categoria: i + 1,
      icone: m.icone,
    })));
  },

  'PUT /api/v1/cliente/senha': trocarSenha,

  // Reservas e lista "Quero ler" do próprio usuário: mesmas regras da API do site.
  // Não existem no Laravel. Aqui até a coordenação age só nas próprias reservas.

  'GET /api/v1/reservas': (req) => {
    const usuario = exigirToken(req);
    return sucesso(repo.listarReservasDoUsuario(usuario.id).map(reservaV1));
  },

  'POST /api/v1/reservas': (req, { corpo }) => {
    const usuario = exigirToken(req);
    const livroId = inteiroPositivo(corpo.livro_id, 'livro_id');
    const limite = usuario.papel === 'admin' ? null : repo.LIMITE_RESERVAS_ALUNO;
    const reserva = repo.criarReserva(livroId, usuario.id, { limite });
    return { ...sucessoComMensagem('Reserva realizada com sucesso.', reservaV1(reserva)), status: 201 };
  },

  'POST /api/v1/reservas/:id/cancelar': (req, { params }) => {
    const usuario = exigirToken(req);
    const reserva = repo.mudarStatusReserva(inteiroPositivo(params.id, 'id'), 'cancelada', usuario.id);
    return sucessoComMensagem('Reserva cancelada com sucesso.', reservaV1(reserva));
  },

  'POST /api/v1/reservas/:id/renovar': (req, { params }) => {
    const usuario = exigirToken(req);
    const reserva = repo.renovarReserva(inteiroPositivo(params.id, 'id'), usuario.id);
    return sucessoComMensagem('Empréstimo renovado com sucesso.', reservaV1(reserva));
  },

  'GET /api/v1/favoritos': (req) => sucesso(repo.listarFavoritos(exigirToken(req).id)),

  'PUT /api/v1/favoritos/:livroId': (req, { params }) => {
    const usuario = exigirToken(req);
    const livroId = inteiroPositivo(params.livroId, 'livroId');
    if (!repo.livroExiste(livroId)) throw new ErroHttp(404, 'Livro não encontrado.');
    repo.adicionarFavorito(usuario.id, livroId);
    return sucessoComMensagem('Livro adicionado à lista.');
  },

  'DELETE /api/v1/favoritos/:livroId': (req, { params }) => {
    const usuario = exigirToken(req);
    repo.removerFavorito(usuario.id, inteiroPositivo(params.livroId, 'livroId'));
    return sucessoComMensagem('Livro removido da lista.');
  },
};

const roteador = criarRoteador(rotas);

function rotaDaRequisicao(metodo, caminho) {
  const rota = roteador.resolver(metodo, caminho);
  if (rota) return rota;
  const permitidos = roteador.metodosDe(caminho);
  if (!permitidos.length) throw new ErroHttp(404, 'Rota não encontrada.');
  throw new ErroHttp(405, 'Método não permitido nesta rota.', { Allow: permitidos.join(', ') });
}

/** Atende toda requisição a /api/v1, sempre com o envelope da v1, inclusive nos erros. */
export async function atenderV1(req, res, url) {
  const cors = cabecalhosCors(req);
  try {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, cors);
      res.end();
      return;
    }

    consumirLimite(limiteGeral, ipDe(req));

    const metodo = req.method === 'HEAD' ? 'GET' : req.method;
    const rota = rotaDaRequisicao(metodo, url.pathname);

    repo.expirarReservasVencidas();
    const corpo = metodo === 'GET' || metodo === 'DELETE' ? {} : await lerCorpo(req);
    const resultado = rota.handler(req, { corpo, params: rota.params, query: url.searchParams });
    responderJson(res, resultado.status ?? 200, resultado.corpo, cors);
  } catch (erro) {
    const status = erro instanceof ErroValidacao ? 422 : erro.status ?? 500;
    if (status === 500) console.error('Erro interno:', erro);
    responderJson(res, status, {
      success: false,
      erro: status === 500 ? 'Erro interno do servidor.' : erro.message,
    }, { ...cors, ...erro.cabecalhos });
  }
}
