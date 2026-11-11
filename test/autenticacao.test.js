import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  usarServidor, db, pedir, entrar, entrarPronto, idDoUsuario,
  ADMIN, BEATRIZ, RAFAEL, SENHA_ALUNO, SENHA_ADMIN, SENHA_RAFAEL,
} from './helpers/servidor.js';

usarServidor();

describe('login, logout e /api/eu', () => {
  test('login certo devolve o usuário e abre a sessão no cookie', async () => {
    const r = await pedir('POST', '/api/login', { corpo: { email: BEATRIZ, senha: SENHA_ALUNO } });
    assert.equal(r.status, 200);
    assert.equal(r.corpo.email, BEATRIZ);
    assert.equal(r.corpo.turma, '8º ano B');
    assert.equal(r.corpo.senha_hash, undefined);
    const cookie = r.cabecalhos.get('set-cookie');
    assert.match(cookie, /^sessao=[0-9a-f]{64}; HttpOnly; SameSite=Strict; Path=\/; Max-Age=604800$/);

    const eu = await pedir('GET', '/api/eu', { cookie: r.cookie });
    assert.equal(eu.status, 200);
    assert.deepEqual(Object.keys(eu.corpo).sort(), [
      'completar_perfil', 'email', 'id', 'nome', 'papel', 'telefone', 'trocar_senha', 'turma',
    ]);
  });

  test('senha errada e e-mail inexistente recebem a mesma resposta', async () => {
    const errada = await pedir('POST', '/api/login', { corpo: { email: BEATRIZ, senha: 'errada123' } });
    const inexistente = await pedir('POST', '/api/login', { corpo: { email: 'ninguem@fpsf.edu.br', senha: 'errada123' } });
    assert.equal(errada.status, 401);
    assert.equal(inexistente.status, 401);
    assert.deepEqual(errada.corpo, { erro: 'E-mail ou senha incorretos.' });
    assert.deepEqual(inexistente.corpo, errada.corpo);
  });

  test('login sem campo obrigatório é 400', async () => {
    const r = await pedir('POST', '/api/login', { corpo: { email: BEATRIZ } });
    assert.equal(r.status, 400);
    assert.match(r.corpo.erro, /senha/);
  });

  test('/api/eu sem sessão responde null', async () => {
    const r = await pedir('GET', '/api/eu');
    assert.equal(r.status, 200);
    assert.equal(r.corpo, null);
  });

  test('logout derruba a sessão e expira o cookie', async () => {
    const cookie = await entrar(BEATRIZ, SENHA_ALUNO);
    const r = await pedir('POST', '/api/logout', { cookie });
    assert.equal(r.status, 200);
    assert.match(r.cabecalhos.get('set-cookie'), /Max-Age=0/);
    assert.equal((await pedir('GET', '/api/eu', { cookie })).corpo, null);
  });
});

describe('troca de senha', () => {
  test('conta nova só acessa o que permite a troca, até trocar a senha', async () => {
    db.prepare('UPDATE usuarios SET perfil_confirmado = 1 WHERE email = ?').run(RAFAEL);
    const cookie = await entrar(RAFAEL, SENHA_RAFAEL);
    const eu = await pedir('GET', '/api/eu', { cookie });
    assert.equal(eu.corpo.trocar_senha, 1);

    const bloqueada = await pedir('GET', '/api/reservas', { cookie });
    assert.equal(bloqueada.status, 403);
    assert.equal(bloqueada.corpo.erro, 'Troque sua senha provisória antes de continuar.');

    const troca = await pedir('POST', '/api/eu/senha', {
      cookie, corpo: { senha_atual: SENHA_RAFAEL, nova_senha: 'senhaNova123' },
    });
    assert.equal(troca.status, 200);
    assert.equal((await pedir('GET', '/api/reservas', { cookie })).status, 200);
    assert.equal((await pedir('GET', '/api/eu', { cookie })).corpo.trocar_senha, 0);
  });

  test('trocar a senha derruba as outras sessões e mantém a atual', async () => {
    const atual = await entrarPronto(BEATRIZ);
    const outra = await entrar(BEATRIZ, SENHA_ALUNO);
    await pedir('POST', '/api/eu/senha', { cookie: atual, corpo: { senha_atual: SENHA_ALUNO, nova_senha: 'senhaNova123' } });
    assert.equal((await pedir('GET', '/api/eu', { cookie: outra })).corpo, null);
    assert.equal((await pedir('GET', '/api/eu', { cookie: atual })).corpo.email, BEATRIZ);
  });

  test('senha atual errada, senha curta e senha repetida são recusadas', async () => {
    const cookie = await entrarPronto(BEATRIZ);
    const errada = await pedir('POST', '/api/eu/senha', { cookie, corpo: { senha_atual: 'outra-coisa', nova_senha: 'senhaNova123' } });
    assert.equal(errada.status, 400);
    assert.equal(errada.corpo.erro, 'A senha atual está incorreta.');
    const curta = await pedir('POST', '/api/eu/senha', { cookie, corpo: { senha_atual: SENHA_ALUNO, nova_senha: 'curta' } });
    assert.equal(curta.status, 400);
    const repetida = await pedir('POST', '/api/eu/senha', { cookie, corpo: { senha_atual: SENHA_ALUNO, nova_senha: SENHA_ALUNO } });
    assert.equal(repetida.status, 400);
    assert.equal(repetida.corpo.erro, 'A nova senha precisa ser diferente da atual.');
  });

  test('coordenação redefine a senha: sessões caem e a troca volta a ser obrigatória', async () => {
    const admin = await entrarPronto(ADMIN);
    const aluno = await entrarPronto(BEATRIZ);
    const r = await pedir('POST', `/api/admin/usuarios/${idDoUsuario(BEATRIZ)}/senha`, { cookie: admin, corpo: { senha: 'provisoria1' } });
    assert.equal(r.status, 200);
    assert.equal((await pedir('GET', '/api/eu', { cookie: aluno })).corpo, null);
    const nova = await entrar(BEATRIZ, 'provisoria1');
    assert.equal((await pedir('GET', '/api/eu', { cookie: nova })).corpo.trocar_senha, 1);
  });

  test('coordenação não redefine a própria senha por essa rota', async () => {
    const admin = await entrarPronto(ADMIN);
    const r = await pedir('POST', `/api/admin/usuarios/${idDoUsuario(ADMIN)}/senha`, { cookie: admin, corpo: { senha: 'provisoria1' } });
    assert.equal(r.status, 400);
  });

  test('aluno não usa rota da coordenação', async () => {
    const aluno = await entrarPronto(BEATRIZ);
    const r = await pedir('POST', `/api/admin/usuarios/${idDoUsuario(RAFAEL)}/senha`, { cookie: aluno, corpo: { senha: 'provisoria1' } });
    assert.equal(r.status, 403);
    assert.equal(r.corpo.erro, 'Acesso restrito à coordenação.');
  });
});

describe('limite de tentativas (429)', () => {
  test('5 erros bloqueiam o e-mail, mesmo com a senha certa depois', async () => {
    for (let i = 0; i < 5; i++) {
      const r = await pedir('POST', '/api/login', { corpo: { email: BEATRIZ, senha: 'errada123' } });
      assert.equal(r.status, 401);
    }
    const r = await pedir('POST', '/api/login', { corpo: { email: BEATRIZ, senha: SENHA_ALUNO } });
    assert.equal(r.status, 429);
    assert.equal(r.corpo.erro, 'Muitas tentativas. Tente de novo em alguns minutos.');
  });

  test('o bloqueio de um e-mail não atinge outra conta no mesmo IP', async () => {
    for (let i = 0; i < 5; i++) await pedir('POST', '/api/login', { corpo: { email: BEATRIZ, senha: 'errada123' } });
    const r = await pedir('POST', '/api/login', { corpo: { email: RAFAEL, senha: SENHA_RAFAEL } });
    assert.equal(r.status, 200);
  });

  test('login certo zera o contador do e-mail', async () => {
    for (let i = 0; i < 4; i++) await pedir('POST', '/api/login', { corpo: { email: BEATRIZ, senha: 'errada123' } });
    assert.equal((await pedir('POST', '/api/login', { corpo: { email: BEATRIZ, senha: SENHA_ALUNO } })).status, 200);
    for (let i = 0; i < 4; i++) {
      assert.equal((await pedir('POST', '/api/login', { corpo: { email: BEATRIZ, senha: 'errada123' } })).status, 401);
    }
  });

  test('50 erros do mesmo IP bloqueiam qualquer e-mail', async () => {
    for (let i = 0; i < 50; i++) {
      await pedir('POST', '/api/login', { corpo: { email: `aluno${i}@fpsf.edu.br`, senha: 'errada123' } });
    }
    const r = await pedir('POST', '/api/login', { corpo: { email: ADMIN, senha: SENHA_ADMIN } });
    assert.equal(r.status, 429);
  });

  test('a troca de senha conta no mesmo limite', async () => {
    const cookie = await entrarPronto(BEATRIZ);
    for (let i = 0; i < 5; i++) {
      await pedir('POST', '/api/eu/senha', { cookie, corpo: { senha_atual: 'errada123', nova_senha: 'senhaNova123' } });
    }
    const r = await pedir('POST', '/api/eu/senha', { cookie, corpo: { senha_atual: SENHA_ALUNO, nova_senha: 'senhaNova123' } });
    assert.equal(r.status, 429);
  });
});
