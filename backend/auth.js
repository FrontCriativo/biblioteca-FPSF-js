import { createHash, randomBytes, randomInt, scrypt, scryptSync, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { db, transacao } from './db/index.js';
import { criarLimitador } from './limite.js';
import { normalizarEmail } from './texto.js';

const DURACAO_SESSAO_DIAS = 7;
const DURACAO_TOKEN_DIAS = 7;

export function criarHashSenha(senha) {
  const sal = randomBytes(16).toString('hex');
  const derivada = scryptSync(senha, sal, 64).toString('hex');
  return `${sal}:${derivada}`;
}

const scryptAssincrono = promisify(scrypt);

/** Para hashes em lote: o scrypt roda fora da thread principal, e o site não para enquanto isso. */
export async function criarHashSenhaEmSegundoPlano(senha) {
  const sal = randomBytes(16).toString('hex');
  const derivada = await scryptAssincrono(senha, sal, 64);
  return `${sal}:${derivada.toString('hex')}`;
}

// Sem 0/O e 1/l/I: a senha é lida no papel, e o aluno digita.
const CARACTERES_SENHA = 'abcdefghjkmnpqrstuvwxyz23456789';

/** Senha aleatória para a conta nova. Vale até o primeiro acesso, quando a troca é obrigatória. */
export function gerarSenhaProvisoria(tamanho = 10) {
  return Array.from({ length: tamanho }, () => CARACTERES_SENHA[randomInt(CARACTERES_SENHA.length)]).join('');
}

export function conferirSenha(senha, hashArmazenado) {
  const [sal, derivadaEsperada] = hashArmazenado.split(':');
  if (!sal || !derivadaEsperada) return false;
  const derivada = scryptSync(senha, sal, 64);
  const esperada = Buffer.from(derivadaEsperada, 'hex');
  return derivada.length === esperada.length && timingSafeEqual(derivada, esperada);
}

export function abrirSessao(usuarioId) {
  const token = randomBytes(32).toString('hex');
  db.prepare(
    `INSERT INTO sessoes (token, usuario_id, expira_em)
     VALUES (?, ?, datetime('now', '+${DURACAO_SESSAO_DIAS} days'))`
  ).run(token, usuarioId);
  return token;
}

export function encerrarSessao(token) {
  db.prepare('DELETE FROM sessoes WHERE token = ?').run(token);
}

/**
 * Desloga o usuário em todo lugar, no site e na API v1, menos na credencial usada na
 * requisição atual (se informada). Vale para troca de senha e para conta desativada:
 * quem tinha o acesso antigo não pode continuar entrando por nenhum dos dois caminhos.
 */
export function encerrarAcessos(usuarioId, { manterSessao = null, manterToken = null } = {}) {
  db.prepare('DELETE FROM sessoes WHERE usuario_id = ? AND token IS NOT ?').run(usuarioId, manterSessao);
  db.prepare('DELETE FROM tokens_api WHERE usuario_id = ? AND id IS NOT ?').run(usuarioId, manterToken);
}

/** Grava uma nova senha. trocarSenha = true obriga a trocá-la no próximo acesso. */
export function definirSenha(usuarioId, senha, { trocarSenha }) {
  db.prepare('UPDATE usuarios SET senha_hash = ?, trocar_senha = ? WHERE id = ?')
    .run(criarHashSenha(senha), trocarSenha ? 1 : 0, usuarioId);
}

/** A conta com a senha, para conferir o login. Inclui as desativadas: quem decide é a rota. */
export function buscarContaPorEmail(email) {
  return db.prepare(
    `SELECT u.*, t.nome AS turma
       FROM usuarios u
       LEFT JOIN turmas t ON t.id = u.turma_id
      WHERE u.email = ?`
  ).get(email) ?? null;
}

// Filtrar u.ativo aqui faz a desativação valer na hora, mesmo para uma sessão aberta.
export function usuarioDaSessao(token) {
  if (!token) return null;
  return db.prepare(
    `SELECT u.id, u.nome, u.email, u.papel, t.nome AS turma, u.trocar_senha
       FROM sessoes s
       JOIN usuarios u ON u.id = s.usuario_id
       LEFT JOIN turmas t ON t.id = u.turma_id
      WHERE s.token = ? AND s.expira_em > datetime('now') AND u.ativo = 1`
  ).get(token) ?? null;
}

export function lerCookie(req, nome) {
  const bruto = req.headers.cookie;
  if (!bruto) return null;
  for (const parte of bruto.split(';')) {
    const [chave, ...resto] = parte.trim().split('=');
    if (chave !== nome) continue;
    try {
      return decodeURIComponent(resto.join('='));
    } catch {
      return null; // cookie malformado vale como "sem sessão", e não como erro 500
    }
  }
  return null;
}

const hashDoToken = (token) => createHash('sha256').update(token).digest('hex');

/** Cria o token do dispositivo, no lugar do anterior. O texto só existe nesta resposta. */
export function emitirToken(usuarioId, dispositivo) {
  const token = randomBytes(32).toString('hex');
  transacao(() => {
    db.prepare('DELETE FROM tokens_api WHERE usuario_id = ? AND dispositivo = ?').run(usuarioId, dispositivo);
    db.prepare(
      `INSERT INTO tokens_api (usuario_id, dispositivo, token_hash, expira_em)
       VALUES (?, ?, ?, datetime('now', '+${DURACAO_TOKEN_DIAS} days'))`
    ).run(usuarioId, dispositivo, hashDoToken(token));
  });
  return token;
}

export function usuarioDoToken(token) {
  if (!token) return null;
  const usuario = db.prepare(
    `SELECT u.id, u.nome, u.email, u.papel, t.nome AS turma, u.trocar_senha, k.id AS token_id
       FROM tokens_api k
       JOIN usuarios u ON u.id = k.usuario_id
       LEFT JOIN turmas t ON t.id = u.turma_id
      WHERE k.token_hash = ? AND k.expira_em > datetime('now') AND u.ativo = 1`
  ).get(hashDoToken(token));
  if (!usuario) return null;
  // No máximo uma escrita por minuto: o aplicativo pode fazer várias chamadas em seguida.
  db.prepare(
    `UPDATE tokens_api SET ultimo_uso_em = datetime('now')
      WHERE id = ? AND (ultimo_uso_em IS NULL OR ultimo_uso_em < datetime('now', '-1 minute'))`
  ).run(usuario.token_id);
  return usuario;
}

export function apagarToken(tokenId) {
  db.prepare('DELETE FROM tokens_api WHERE id = ?').run(tokenId);
}

/** Apaga do banco os tokens vencidos. Devolve quantos foram removidos. */
export function apagarTokensVencidos() {
  return db.prepare("DELETE FROM tokens_api WHERE expira_em <= datetime('now')").run().changes;
}

/** Apaga do banco as sessões vencidas. Devolve quantas foram removidas. */
export function apagarSessoesVencidas() {
  return db.prepare("DELETE FROM sessoes WHERE expira_em <= datetime('now')").run().changes;
}

// Em produção o site roda sob HTTPS: o cookie só trafega cifrado.
// Em localhost (http://) a flag impediria o navegador de guardar o cookie.
const FLAG_SECURE = process.env.NODE_ENV === 'production' ? '; Secure' : '';

export function cabecalhoCookieSessao(token) {
  const maxAge = DURACAO_SESSAO_DIAS * 24 * 60 * 60;
  return `sessao=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${FLAG_SECURE}`;
}

export const cookieSessaoExpirado = `sessao=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${FLAG_SECURE}`;

// Liga a volta do Google ao navegador que pediu o login. Lax, e não Strict como o da sessão:
// a volta é uma navegação vinda de outro site, e com Strict o cookie não chegaria.
export const COOKIE_GOOGLE = 'login_google';
const ATRIBUTOS_COOKIE_GOOGLE = `HttpOnly; SameSite=Lax; Path=/api/auth/google${FLAG_SECURE}`;

export function cabecalhoCookieGoogle(valor) {
  return `${COOKIE_GOOGLE}=${encodeURIComponent(valor)}; ${ATRIBUTOS_COOKIE_GOOGLE}; Max-Age=600`;
}

export const cookieGoogleExpirado = `${COOKIE_GOOGLE}=; ${ATRIBUTOS_COOKIE_GOOGLE}; Max-Age=0`;

// Limite de tentativas de login erradas, por e-mail e por IP, numa janela de 15 minutos.
const JANELA_TENTATIVAS_MS = 15 * 60 * 1000;
const falhasPorEmail = criarLimitador({ janelaMs: JANELA_TENTATIVAS_MS, maximo: 5 });
// Os computadores da escola saem todos pelo mesmo IP: com o limite do e-mail,
// um aluno errando a senha travava a escola inteira. O do IP só pega ataque em massa.
const falhasPorIp = criarLimitador({ janelaMs: JANELA_TENTATIVAS_MS, maximo: 50 });

/** true se o e-mail ou o IP já errou a senha o máximo de vezes na janela atual. */
export function loginBloqueado(email, ip) {
  return falhasPorEmail.esgotado(normalizarEmail(email)) || falhasPorIp.esgotado(ip);
}

/** Quanto falta para o bloqueio de loginBloqueado() acabar (cabeçalho Retry-After). */
export function segundosDeBloqueioLogin(email, ip) {
  const chave = normalizarEmail(email);
  return Math.max(
    falhasPorEmail.esgotado(chave) ? falhasPorEmail.segundosRestantes(chave) : 0,
    falhasPorIp.esgotado(ip) ? falhasPorIp.segundosRestantes(ip) : 0,
  );
}

export function registrarFalhaLogin(email, ip) {
  falhasPorEmail.registrar(normalizarEmail(email));
  falhasPorIp.registrar(ip);
}

/** Login certo zera o contador daquele e-mail (o do IP continua valendo). */
export function limparFalhasLogin(email) {
  falhasPorEmail.limpar(normalizarEmail(email));
}
