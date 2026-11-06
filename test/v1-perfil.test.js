import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  usarServidor, pedir, entrarV1, tokenPronto, idDoUsuario, db, BEATRIZ, RAFAEL, SENHA_ALUNO,
} from './helpers/servidor.js';

usarServidor();

const contaDe = (email) => db.prepare('SELECT * FROM usuarios WHERE email = ?').get(email);

describe('perfil', () => {
  test('GET devolve exatamente os campos do contrato', async () => {
    const token = await tokenPronto(BEATRIZ);
    const r = await pedir('GET', '/api/v1/usuario', { token });
    assert.deepEqual(r.corpo, {
      success: true,
      data: { id: idDoUsuario(BEATRIZ), nome: 'Beatriz Lima', email: BEATRIZ, papel: 'aluno', turma: '8º ano B', trocar_senha: false },
    });
  });

  test('PUT grava nome e e-mail', async () => {
    const token = await tokenPronto(BEATRIZ);
    const r = await pedir('PUT', '/api/v1/usuario', { token, corpo: { nome: 'Bia Lima', email: 'BIA@fpsf.edu.br' } });
    assert.equal(r.status, 200);
    assert.equal(r.corpo.mensagem, 'Perfil atualizado com sucesso.');
    assert.equal(r.corpo.data.nome, 'Bia Lima');
    assert.equal(r.corpo.data.email, 'bia@fpsf.edu.br');
    assert.equal(contaDe('bia@fpsf.edu.br').nome, 'Bia Lima');
  });

  test('PUT exige os dois campos', async () => {
    const token = await tokenPronto(BEATRIZ);
    assert.equal((await pedir('PUT', '/api/v1/usuario', { token, corpo: { nome: 'Bia' } })).status, 422);
    assert.equal((await pedir('PUT', '/api/v1/usuario', { token, corpo: { email: 'bia@fpsf.edu.br' } })).status, 422);
    assert.equal(contaDe(BEATRIZ).nome, 'Beatriz Lima');
  });

  test('PATCH valida só o que vier', async () => {
    const token = await tokenPronto(BEATRIZ);
    const r = await pedir('PATCH', '/api/v1/usuario', { token, corpo: { nome: 'Bia' } });
    assert.equal(r.status, 200);
    assert.equal(r.corpo.data.nome, 'Bia');
    assert.equal(r.corpo.data.email, BEATRIZ);
    const soEmail = await pedir('PATCH', '/api/v1/usuario', { token, corpo: { email: 'bia@fpsf.edu.br' } });
    assert.equal(soEmail.corpo.data.nome, 'Bia');
    assert.equal(soEmail.corpo.data.email, 'bia@fpsf.edu.br');
    assert.equal((await pedir('PATCH', '/api/v1/usuario', { token, corpo: {} })).status, 200);
  });

  test('PATCH com campo vazio é 422', async () => {
    const token = await tokenPronto(BEATRIZ);
    assert.equal((await pedir('PATCH', '/api/v1/usuario', { token, corpo: { nome: '' } })).status, 422);
    assert.equal((await pedir('PATCH', '/api/v1/usuario', { token, corpo: { email: null } })).status, 422);
  });

  test('limites: nome até 80 e e-mail válido até 120', async () => {
    const token = await tokenPronto(BEATRIZ);
    const casos = [{ nome: 'x'.repeat(81) }, { email: 'invalido' }, { email: `${'x'.repeat(120)}@a.br` }];
    for (const corpo of casos) {
      const r = await pedir('PATCH', '/api/v1/usuario', { token, corpo });
      assert.equal(r.status, 422, JSON.stringify(corpo));
      assert.equal(r.corpo.success, false);
    }
    assert.equal((await pedir('PATCH', '/api/v1/usuario', { token, corpo: { nome: 'x'.repeat(80) } })).status, 200);
  });

  test('e-mail de outra conta é 422; o próprio e-mail não conta como repetido', async () => {
    const token = await tokenPronto(BEATRIZ);
    for (const email of [RAFAEL, RAFAEL.toUpperCase()]) {
      const r = await pedir('PATCH', '/api/v1/usuario', { token, corpo: { email } });
      assert.equal(r.status, 422);
      assert.deepEqual(r.corpo, { success: false, erro: 'Já existe um usuário com esse e-mail.' });
    }
    assert.equal((await pedir('PATCH', '/api/v1/usuario', { token, corpo: { email: BEATRIZ } })).status, 200);
  });

  test('outros campos são ignorados', async () => {
    const token = await tokenPronto(BEATRIZ);
    const antes = contaDe(BEATRIZ);
    const r = await pedir('PUT', '/api/v1/usuario', {
      token,
      corpo: {
        nome: 'Bia', email: BEATRIZ, papel: 'admin', ativo: 0, turma: 'Outra', turma_id: 999,
        senha: 'hackeada1', senha_hash: 'x', trocar_senha: 1, id: 1,
      },
    });
    assert.equal(r.status, 200);
    assert.equal(r.corpo.data.papel, 'aluno');
    assert.equal(r.corpo.data.turma, '8º ano B');
    const depois = contaDe(BEATRIZ);
    assert.deepEqual({ ...depois, nome: antes.nome }, { ...antes });
  });

  test('e-mail novo vale no login seguinte', async () => {
    const token = await tokenPronto(BEATRIZ);
    await pedir('PATCH', '/api/v1/usuario', { token, corpo: { email: 'bia@fpsf.edu.br' } });
    assert.ok(await entrarV1('bia@fpsf.edu.br', SENHA_ALUNO));
  });

  test('sem token é 401', async () => {
    assert.equal((await pedir('PUT', '/api/v1/usuario', { corpo: { nome: 'x', email: 'a@b.br' } })).status, 401);
    assert.equal((await pedir('PATCH', '/api/v1/usuario', { corpo: { nome: 'x' } })).status, 401);
  });
});

describe('senha', () => {
  const NOVA = 'senhaNova123';
  const corpo = (extra = {}) => ({ senha_atual: SENHA_ALUNO, nova_senha: NOVA, nova_senha_confirmation: NOVA, ...extra });

  for (const rota of ['/api/v1/usuario/senha', '/api/v1/cliente/senha']) {
    describe(rota, () => {
      test('troca a senha', async () => {
        const token = await tokenPronto(BEATRIZ);
        const r = await pedir('PUT', rota, { token, corpo: corpo() });
        assert.equal(r.status, 200);
        assert.deepEqual(r.corpo, { success: true, mensagem: 'Senha alterada com sucesso.' });
        assert.ok(await entrarV1(BEATRIZ, NOVA));
        const antiga = await pedir('POST', '/api/v1/auth/login', { corpo: { email: BEATRIZ, senha: SENHA_ALUNO } });
        assert.equal(antiga.status, 401);
      });

      test('senha atual errada é 422', async () => {
        const token = await tokenPronto(BEATRIZ);
        const r = await pedir('PUT', rota, { token, corpo: corpo({ senha_atual: 'errada123' }) });
        assert.equal(r.status, 422);
        assert.deepEqual(r.corpo, { success: false, erro: 'Senha atual incorreta.' });
      });

      test('recusa senha curta, confirmação diferente e senha igual à atual', async () => {
        const token = await tokenPronto(BEATRIZ);
        const casos = [
          corpo({ nova_senha: 'curta', nova_senha_confirmation: 'curta' }),
          corpo({ nova_senha_confirmation: 'outraSenha1' }),
          corpo({ nova_senha_confirmation: undefined }),
          corpo({ nova_senha: SENHA_ALUNO, nova_senha_confirmation: SENHA_ALUNO }),
          corpo({ senha_atual: undefined }),
        ];
        for (const c of casos) {
          const r = await pedir('PUT', rota, { token, corpo: c });
          assert.equal(r.status, 422, JSON.stringify(c));
          assert.equal(r.corpo.success, false);
        }
        assert.ok(await entrarV1(BEATRIZ, SENHA_ALUNO, 'conferencia'));
      });

      test('sem token é 401', async () => {
        assert.equal((await pedir('PUT', rota, { corpo: corpo() })).status, 401);
      });
    });
  }

  test('senha atual errada conta no limite de tentativas, junto com o login', async () => {
    const token = await tokenPronto(BEATRIZ);
    for (let i = 0; i < 5; i++) {
      const r = await pedir('PUT', '/api/v1/usuario/senha', { token, corpo: corpo({ senha_atual: 'errada123' }) });
      assert.equal(r.status, 422);
    }
    const certa = await pedir('PUT', '/api/v1/usuario/senha', { token, corpo: corpo() });
    assert.equal(certa.status, 429);
    assert.ok(Number(certa.cabecalhos.get('retry-after')) > 0);
    assert.equal((await pedir('POST', '/api/login', { corpo: { email: BEATRIZ, senha: SENHA_ALUNO } })).status, 429);
  });
});
