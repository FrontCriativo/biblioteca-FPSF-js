import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  usarServidor, pedir, entrar, entrarV1, entrarPronto, tokenPronto, idDoUsuario, db,
  ADMIN, BEATRIZ, RAFAEL, SENHA_ALUNO, SENHA_RAFAEL,
} from './helpers/servidor.js';
import { limparVencidos } from '../backend/server.js';

usarServidor();

const login = (corpo) => pedir('POST', '/api/v1/auth/login', { corpo });
const tokensDe = (email) => db.prepare('SELECT * FROM tokens_api WHERE usuario_id = ?').all(idDoUsuario(email));
const perfil = (token) => pedir('GET', '/api/v1/usuario', { token });

describe('login', () => {
  test('devolve o token e o usuário, no envelope', async () => {
    const r = await login({ email: BEATRIZ, senha: SENHA_ALUNO });
    assert.equal(r.status, 200);
    assert.equal(r.corpo.success, true);
    assert.equal(r.corpo.mensagem, 'Login realizado com sucesso.');
    assert.match(r.corpo.data.token, /^[0-9a-f]{64}$/);
    assert.deepEqual(r.corpo.data.usuario, {
      id: idDoUsuario(BEATRIZ), nome: 'Beatriz Lima', email: BEATRIZ, papel: 'aluno', turma: '8º ano B', trocar_senha: false,
    });
    assert.equal(r.cookie, null);
  });

  test('o banco guarda só o SHA-256 do token', async () => {
    const token = await entrarV1(BEATRIZ, SENHA_ALUNO);
    const [registro] = tokensDe(BEATRIZ);
    assert.equal(registro.token_hash, createHash('sha256').update(token).digest('hex'));
    assert.ok(!JSON.stringify(registro).includes(token));
  });

  test('o token vale por 7 dias', async () => {
    await entrarV1(BEATRIZ, SENHA_ALUNO);
    const [{ expira_em }] = tokensDe(BEATRIZ);
    const dias = (new Date(`${expira_em.replace(' ', 'T')}Z`) - Date.now()) / 86_400_000;
    assert.ok(dias > 6.9 && dias <= 7);
  });

  test('e-mail é normalizado', async () => {
    const r = await login({ email: `  ${BEATRIZ.toUpperCase()} `, senha: SENHA_ALUNO });
    assert.equal(r.status, 200);
  });

  test('e-mail inexistente e senha errada recebem a mesma resposta', async () => {
    const errada = await login({ email: BEATRIZ, senha: 'errada123' });
    const inexistente = await login({ email: 'ninguem@fpsf.edu.br', senha: 'errada123' });
    assert.equal(errada.status, 401);
    assert.deepEqual(errada.corpo, { success: false, erro: 'E-mail ou senha incorretos.' });
    assert.deepEqual(inexistente.corpo, errada.corpo);
    assert.equal(inexistente.status, 401);
  });

  test('validação é 422', async () => {
    for (const corpo of [{ senha: 'x' }, { email: BEATRIZ }, { email: 'nao-e-email', senha: 'x' }, { email: BEATRIZ, senha: 'x', device_name: 'd'.repeat(101) }]) {
      const r = await login(corpo);
      assert.equal(r.status, 422, JSON.stringify(corpo));
      assert.equal(r.corpo.success, false);
    }
  });

  test('conta desativada é 403, com a senha certa', async () => {
    db.prepare('UPDATE usuarios SET ativo = 0 WHERE email = ?').run(BEATRIZ);
    const r = await login({ email: BEATRIZ, senha: SENHA_ALUNO });
    assert.equal(r.status, 403);
    assert.deepEqual(r.corpo, { success: false, erro: 'Conta desativada. Procure a coordenação.' });
    assert.equal((await login({ email: BEATRIZ, senha: 'errada123' })).status, 401);
    assert.equal(tokensDe(BEATRIZ).length, 0);
  });
});

describe('um token por dispositivo', () => {
  test('novo login no mesmo dispositivo derruba o anterior', async () => {
    const primeiro = await entrarV1(BEATRIZ, SENHA_ALUNO, 'celular');
    const segundo = await entrarV1(BEATRIZ, SENHA_ALUNO, 'celular');
    assert.equal((await perfil(primeiro)).status, 401);
    assert.equal((await perfil(segundo)).status, 200);
    assert.equal(tokensDe(BEATRIZ).length, 1);
  });

  test('dispositivos diferentes convivem; o padrão é "app"', async () => {
    const app = await entrarV1(BEATRIZ, SENHA_ALUNO);
    const tablet = await entrarV1(BEATRIZ, SENHA_ALUNO, 'tablet');
    assert.equal((await perfil(app)).status, 200);
    assert.equal((await perfil(tablet)).status, 200);
    assert.deepEqual(tokensDe(BEATRIZ).map((t) => t.dispositivo).sort(), ['app', 'tablet']);
  });

  test('o mesmo nome de dispositivo em contas diferentes não interfere', async () => {
    const beatriz = await entrarV1(BEATRIZ, SENHA_ALUNO, 'celular');
    await entrarV1(RAFAEL, SENHA_RAFAEL, 'celular');
    assert.equal((await perfil(beatriz)).status, 200);
  });
});

describe('uso do token', () => {
  test('sem token, token inválido e formato errado são 401', async () => {
    const esperado = { success: false, erro: 'Você precisa entrar para fazer isso.' };
    for (const cabecalhos of [{}, { Authorization: 'Bearer abc' }, { Authorization: 'Basic abc' }, { Authorization: 'Bearer' }]) {
      const r = await pedir('GET', '/api/v1/usuario', { cabecalhos });
      assert.equal(r.status, 401);
      assert.deepEqual(r.corpo, esperado);
    }
  });

  test('registra o último uso', async () => {
    const token = await entrarV1(BEATRIZ, SENHA_ALUNO);
    assert.equal(tokensDe(BEATRIZ)[0].ultimo_uso_em, null);
    await perfil(token);
    assert.ok(tokensDe(BEATRIZ)[0].ultimo_uso_em);
  });

  test('token vencido é 401 e a faxina o apaga', async () => {
    const token = await tokenPronto(BEATRIZ);
    const manter = await tokenPronto(RAFAEL);
    db.prepare("UPDATE tokens_api SET expira_em = datetime('now', '-1 minute') WHERE usuario_id = ?").run(idDoUsuario(BEATRIZ));
    assert.equal((await perfil(token)).status, 401);
    assert.equal(tokensDe(BEATRIZ).length, 1);
    limparVencidos();
    assert.equal(tokensDe(BEATRIZ).length, 0);
    assert.equal((await perfil(manter)).status, 200);
  });

  test('o cookie do site em rota da v1 é 401', async () => {
    const cookie = await entrarPronto(BEATRIZ);
    const r = await pedir('GET', '/api/v1/usuario', { cookie });
    assert.equal(r.status, 401);
  });

  test('o token não vale na API do site', async () => {
    const token = await tokenPronto(BEATRIZ);
    assert.equal((await pedir('GET', '/api/reservas', { token })).status, 401);
    assert.equal((await pedir('GET', '/api/eu', { token })).corpo, null);
  });
});

describe('logout', () => {
  test('apaga só o token atual, que depois é 401', async () => {
    const atual = await entrarV1(BEATRIZ, SENHA_ALUNO, 'celular');
    const outro = await entrarV1(BEATRIZ, SENHA_ALUNO, 'tablet');
    const r = await pedir('POST', '/api/v1/auth/logout', { token: atual });
    assert.equal(r.status, 200);
    assert.deepEqual(r.corpo, { success: true, mensagem: 'Logout realizado com sucesso.' });
    assert.equal((await perfil(atual)).status, 401);
    assert.equal((await perfil(outro)).status, 200);
  });

  test('sem token é 401', async () => {
    assert.equal((await pedir('POST', '/api/v1/auth/logout')).status, 401);
  });
});

describe('conta com senha provisória', () => {
  test('pode logar, ver o perfil e sair; o resto é 403', async () => {
    const token = await entrarV1(RAFAEL, SENHA_RAFAEL);
    const eu = await perfil(token);
    assert.equal(eu.status, 200);
    assert.equal(eu.corpo.data.trocar_senha, true);

    const bloqueada = await pedir('PATCH', '/api/v1/usuario', { token, corpo: { nome: 'Outra' } });
    assert.equal(bloqueada.status, 403);
    assert.deepEqual(bloqueada.corpo, { success: false, erro: 'Troque sua senha provisória antes de continuar.' });

    assert.equal((await pedir('POST', '/api/v1/auth/logout', { token })).status, 200);
  });

  test('pode trocar a senha, e aí o bloqueio cai', async () => {
    const token = await entrarV1(RAFAEL, SENHA_RAFAEL);
    const r = await pedir('PUT', '/api/v1/usuario/senha', {
      token, corpo: { senha_atual: SENHA_RAFAEL, nova_senha: 'senhaNova123', nova_senha_confirmation: 'senhaNova123' },
    });
    assert.equal(r.status, 200);
    assert.equal((await perfil(token)).corpo.data.trocar_senha, false);
    assert.equal((await pedir('PATCH', '/api/v1/usuario', { token, corpo: { nome: 'Rafael S.' } })).status, 200);
  });
});

describe('limites', () => {
  test('a 11ª tentativa no minuto é 429 com Retry-After, sem afetar o login do site', async () => {
    // E-mails diferentes: com o mesmo, o bloqueio de 5 erros por e-mail viria antes.
    for (let i = 0; i < 10; i++) {
      const r = await login({ email: `aluno${i}@fpsf.edu.br`, senha: 'errada123' });
      assert.equal(r.status, 401, `tentativa ${i + 1}`);
    }
    const r = await login({ email: BEATRIZ, senha: SENHA_ALUNO });
    assert.equal(r.status, 429);
    assert.equal(r.corpo.success, false);
    const espera = Number(r.cabecalhos.get('retry-after'));
    assert.ok(espera > 0 && espera <= 60);

    const site = await pedir('POST', '/api/login', { corpo: { email: BEATRIZ, senha: SENHA_ALUNO } });
    assert.equal(site.status, 200);
  });

  test('/auth/login e /login dividem o mesmo contador', async () => {
    for (let i = 0; i < 5; i++) await login({ email: `a${i}@fpsf.edu.br`, senha: 'errada123' });
    for (let i = 0; i < 5; i++) await pedir('POST', '/api/v1/login', { corpo: { email: `b${i}@fpsf.edu.br`, password: 'errada123' } });
    assert.equal((await pedir('POST', '/api/v1/login', { corpo: { email: BEATRIZ, password: SENHA_ALUNO } })).status, 429);
  });

  test('tentativas no site não gastam o limite da v1', async () => {
    for (let i = 0; i < 12; i++) await pedir('POST', '/api/login', { corpo: { email: `a${i}@fpsf.edu.br`, senha: 'errada123' } });
    assert.equal((await login({ email: BEATRIZ, senha: SENHA_ALUNO })).status, 200);
  });

  test('o bloqueio por e-mail é o mesmo do site, nos dois sentidos', async () => {
    for (let i = 0; i < 5; i++) await login({ email: BEATRIZ, senha: 'errada123' });
    const v1 = await login({ email: BEATRIZ, senha: SENHA_ALUNO });
    assert.equal(v1.status, 429);
    assert.equal(v1.corpo.erro, 'Muitas tentativas. Tente de novo em alguns minutos.');
    assert.ok(Number(v1.cabecalhos.get('retry-after')) > 60);
    assert.equal((await pedir('POST', '/api/login', { corpo: { email: BEATRIZ, senha: SENHA_ALUNO } })).status, 429);
  });
});

describe('coerência entre site e v1', () => {
  const NOVA = 'senhaNova123';
  const trocaV1 = (token, atual = SENHA_ALUNO) => pedir('PUT', '/api/v1/usuario/senha', {
    token, corpo: { senha_atual: atual, nova_senha: NOVA, nova_senha_confirmation: NOVA },
  });

  test('trocar a senha na v1 derruba os outros tokens e as sessões; o token atual continua', async () => {
    const atual = await tokenPronto(BEATRIZ, 'celular');
    const outro = await entrarV1(BEATRIZ, SENHA_ALUNO, 'tablet');
    const sessao = await entrar(BEATRIZ, SENHA_ALUNO);

    assert.equal((await trocaV1(atual)).status, 200);

    assert.equal((await perfil(outro)).status, 401);
    assert.equal((await pedir('GET', '/api/eu', { cookie: sessao })).corpo, null);
    assert.equal((await perfil(atual)).status, 200);
  });

  test('trocar a senha no site derruba os tokens; a sessão atual continua', async () => {
    const sessao = await entrarPronto(BEATRIZ);
    const token = await entrarV1(BEATRIZ, SENHA_ALUNO);
    await pedir('POST', '/api/eu/senha', { cookie: sessao, corpo: { senha_atual: SENHA_ALUNO, nova_senha: NOVA } });
    assert.equal((await perfil(token)).status, 401);
    assert.equal((await pedir('GET', '/api/eu', { cookie: sessao })).corpo.email, BEATRIZ);
  });

  test('a coordenação redefinir a senha derruba tokens e sessões', async () => {
    const admin = await entrarPronto(ADMIN);
    const token = await tokenPronto(BEATRIZ);
    const sessao = await entrar(BEATRIZ, SENHA_ALUNO);
    await pedir('POST', `/api/admin/usuarios/${idDoUsuario(BEATRIZ)}/senha`, { cookie: admin, corpo: { senha: 'provisoria1' } });
    assert.equal((await perfil(token)).status, 401);
    assert.equal((await pedir('GET', '/api/eu', { cookie: sessao })).corpo, null);
    assert.equal(tokensDe(BEATRIZ).length, 0);
  });

  test('desativar a conta derruba tokens e sessões', async () => {
    const admin = await entrarPronto(ADMIN);
    const token = await tokenPronto(BEATRIZ);
    await pedir('POST', `/api/admin/usuarios/${idDoUsuario(BEATRIZ)}/desativar`, { cookie: admin });
    assert.equal((await perfil(token)).status, 401);
    assert.equal(tokensDe(BEATRIZ).length, 0);
  });

  test('token que sobrou no banco não vale para conta desativada', async () => {
    const token = await tokenPronto(BEATRIZ);
    db.prepare('UPDATE usuarios SET ativo = 0 WHERE email = ?').run(BEATRIZ);
    assert.equal((await perfil(token)).status, 401);
  });

  test('a credencial de outra conta não é afetada', async () => {
    const atual = await tokenPronto(BEATRIZ);
    const rafael = await tokenPronto(RAFAEL);
    await trocaV1(atual);
    assert.equal((await perfil(rafael)).status, 200);
  });
});
