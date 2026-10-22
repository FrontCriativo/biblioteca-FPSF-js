import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { db } from './db/index.js';

const DURACAO_SESSAO_DIAS = 7;

export function criarHashSenha(senha) {
  const sal = randomBytes(16).toString('hex');
  const derivada = scryptSync(senha, sal, 64).toString('hex');
  return `${sal}:${derivada}`;
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

/** Desloga o usuário em todos os aparelhos, menos na sessão `manter` (se informada). */
export function encerrarSessoesDoUsuario(usuarioId, manter = null) {
  db.prepare('DELETE FROM sessoes WHERE usuario_id = ? AND token IS NOT ?').run(usuarioId, manter);
}

/** Grava uma nova senha. trocarSenha = true obriga a trocá-la no próximo acesso. */
export function definirSenha(usuarioId, senha, { trocarSenha }) {
  db.prepare('UPDATE usuarios SET senha_hash = ?, trocar_senha = ? WHERE id = ?')
    .run(criarHashSenha(senha), trocarSenha ? 1 : 0, usuarioId);
}

export function usuarioDaSessao(token) {
  if (!token) return null;
  return db.prepare(
    `SELECT u.id, u.nome, u.email, u.papel, u.turma, u.trocar_senha
       FROM sessoes s
       JOIN usuarios u ON u.id = s.usuario_id
      WHERE s.token = ? AND s.expira_em > datetime('now')`
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

// Limite de tentativas de login erradas, por e-mail e por IP, numa janela de 15 minutos.
// Fica em memória: reiniciar o servidor zera os contadores.
const MAX_TENTATIVAS_LOGIN = 5;
// Os computadores da escola saem todos pelo mesmo IP: com o limite do e-mail,
// um aluno errando a senha travava a escola inteira. O do IP só pega ataque em massa.
const MAX_TENTATIVAS_IP = 50;
const JANELA_TENTATIVAS_MS = 15 * 60 * 1000;
const falhasLogin = new Map(); // chave → { contagem, inicio }

const chavesLogin = (email, ip) => [`email:${email.toLowerCase()}`, `ip:${ip}`];

function falhasRecentes(chave, agora = Date.now()) {
  const registro = falhasLogin.get(chave);
  if (!registro) return 0;
  if (agora - registro.inicio >= JANELA_TENTATIVAS_MS) {
    falhasLogin.delete(chave);
    return 0;
  }
  return registro.contagem;
}

/** true se o e-mail ou o IP já errou a senha o máximo de vezes na janela atual. */
export function loginBloqueado(email, ip) {
  const [chaveEmail, chaveIp] = chavesLogin(email, ip);
  return falhasRecentes(chaveEmail) >= MAX_TENTATIVAS_LOGIN
    || falhasRecentes(chaveIp) >= MAX_TENTATIVAS_IP;
}

export function registrarFalhaLogin(email, ip) {
  const agora = Date.now();
  for (const chave of chavesLogin(email, ip)) {
    const contagem = falhasRecentes(chave, agora);
    if (contagem === 0) falhasLogin.set(chave, { contagem: 1, inicio: agora });
    else falhasLogin.get(chave).contagem = contagem + 1;
  }
}

/** Login certo zera o contador daquele e-mail (o do IP continua valendo). */
export function limparFalhasLogin(email) {
  falhasLogin.delete(`email:${email.toLowerCase()}`);
}

/** Tira do Map os registros cuja janela já passou, para ele não crescer sem limite. */
export function apagarFalhasLoginVencidas() {
  const agora = Date.now();
  for (const chave of falhasLogin.keys()) falhasRecentes(chave, agora);
}
