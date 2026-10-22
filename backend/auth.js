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

export function usuarioDaSessao(token) {
  if (!token) return null;
  return db.prepare(
    `SELECT u.id, u.nome, u.email, u.papel, u.turma
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
    if (chave === nome) return decodeURIComponent(resto.join('='));
  }
  return null;
}

export function cabecalhoCookieSessao(token) {
  const maxAge = DURACAO_SESSAO_DIAS * 24 * 60 * 60;
  return `sessao=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}`;
}

export const cookieSessaoExpirado = 'sessao=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0';
