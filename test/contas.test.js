import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  usarServidor, pedir, entrar, entrarPronto, reservar, idDoUsuario, db, ADMIN, BEATRIZ, RAFAEL, SENHA_ALUNO,
} from './helpers/servidor.js';

usarServidor();

describe('turmas', () => {
  test('no JSON a chave continua sendo turma, com o nome', async () => {
    const r = await pedir('POST', '/api/login', { corpo: { email: BEATRIZ, senha: SENHA_ALUNO } });
    assert.equal(r.corpo.turma, '8º ano B');
    assert.equal(r.corpo.turma_id, undefined);
    assert.equal((await pedir('GET', '/api/eu', { cookie: r.cookie })).corpo.turma, '8º ano B');
  });

  test('as reservas do painel mostram o nome da turma', async () => {
    const admin = await entrarPronto(ADMIN);
    const reserva = await reservar(await entrarPronto(BEATRIZ), 'dom-quixote');
    assert.equal(reserva.turma, '8º ano B');
    const { corpo } = await pedir('GET', '/api/admin/reservas?status=ativa', { cookie: admin });
    assert.equal(corpo[0].turma, '8º ano B');
  });

  test('o usuário sem turma continua com null', async () => {
    const { corpo } = await pedir('GET', '/api/admin/usuarios', { cookie: await entrarPronto(ADMIN) });
    assert.equal(corpo.find((u) => u.email === ADMIN).turma, null);
  });

  test('criar usuário reaproveita a turma pelo nome, sem diferenciar maiúsculas', async () => {
    const cookie = await entrarPronto(ADMIN);
    const antes = (await pedir('GET', '/api/admin/turmas', { cookie })).corpo.length;
    const r = await pedir('POST', '/api/admin/usuarios', {
      cookie, corpo: { nome: 'Caio', email: 'caio@fpsf.edu.br', senha: 'provisoria1', turma: '8º ANO b' },
    });
    assert.equal(r.status, 201);
    assert.equal(r.corpo.turma, '8º ano B');
    assert.equal((await pedir('GET', '/api/admin/turmas', { cookie })).corpo.length, antes);
  });

  test('criar usuário com turma nova cria a turma no ano corrente', async () => {
    const cookie = await entrarPronto(ADMIN);
    await pedir('POST', '/api/admin/usuarios', {
      cookie, corpo: { nome: 'Caio', email: 'caio@fpsf.edu.br', senha: 'provisoria1', turma: '7º ano A' },
    });
    const { corpo } = await pedir('GET', '/api/admin/turmas', { cookie });
    assert.deepEqual(corpo.map((t) => t.nome), ['7º ano A', '8º ano B', '9º ano A']);
    assert.equal(corpo[0].ano_letivo, new Date().getFullYear());
  });

  test('a lista de turmas é só para a coordenação', async () => {
    assert.equal((await pedir('GET', '/api/admin/turmas')).status, 401);
    assert.equal((await pedir('GET', '/api/admin/turmas', { cookie: await entrarPronto(BEATRIZ) })).status, 403);
  });
});

describe('conta desativada', () => {
  const desativar = (cookie, email) => pedir('POST', `/api/admin/usuarios/${idDoUsuario(email)}/desativar`, { cookie });
  const reativar = (cookie, email) => pedir('POST', `/api/admin/usuarios/${idDoUsuario(email)}/reativar`, { cookie });

  test('não entra: 403 com a senha certa, 401 com a errada', async () => {
    await desativar(await entrarPronto(ADMIN), BEATRIZ);
    const certa = await pedir('POST', '/api/login', { corpo: { email: BEATRIZ, senha: SENHA_ALUNO } });
    assert.equal(certa.status, 403);
    assert.deepEqual(certa.corpo, { erro: 'Conta desativada. Procure a coordenação.' });
    assert.equal(certa.cookie, null);
    const errada = await pedir('POST', '/api/login', { corpo: { email: BEATRIZ, senha: 'errada123' } });
    assert.equal(errada.status, 401);
    assert.equal(errada.corpo.erro, 'E-mail ou senha incorretos.');
  });

  test('desativar derruba a sessão aberta na hora', async () => {
    const aluno = await entrarPronto(BEATRIZ);
    await desativar(await entrarPronto(ADMIN), BEATRIZ);
    assert.equal((await pedir('GET', '/api/eu', { cookie: aluno })).corpo, null);
    assert.equal((await pedir('GET', '/api/reservas', { cookie: aluno })).status, 401);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sessoes WHERE usuario_id = ?').get(idDoUsuario(BEATRIZ)).n, 0);
  });

  test('sessão que sobrou no banco não vale para conta desativada', async () => {
    const aluno = await entrarPronto(BEATRIZ);
    db.prepare('UPDATE usuarios SET ativo = 0 WHERE email = ?').run(BEATRIZ);
    assert.equal((await pedir('GET', '/api/eu', { cookie: aluno })).corpo, null);
  });

  test('cancela as reservas ativas e mantém as retiradas', async () => {
    const admin = await entrarPronto(ADMIN);
    const aluno = await entrarPronto(BEATRIZ);
    const ativa = await reservar(aluno, 'dom-quixote');
    const retirada = await reservar(aluno, 'vidas-secas');
    await pedir('POST', `/api/admin/reservas/${retirada.id}/retirar`, { cookie: admin });

    const r = await desativar(admin, BEATRIZ);
    assert.deepEqual(r.corpo, { ok: true, reservas_canceladas: 1 });
    const status = (id) => db.prepare('SELECT status FROM reservas WHERE id = ?').get(id).status;
    assert.equal(status(ativa.id), 'cancelada');
    assert.equal(status(retirada.id), 'retirada');
    assert.equal((await pedir('GET', '/api/livros/dom-quixote')).corpo.disponiveis, 2);
    assert.equal((await pedir('GET', '/api/livros/vidas-secas')).corpo.disponiveis, 2);
  });

  test('a coordenação não desativa a própria conta', async () => {
    const r = await desativar(await entrarPronto(ADMIN), ADMIN);
    assert.equal(r.status, 400);
    assert.equal(r.corpo.erro, 'Você não pode desativar a própria conta.');
  });

  test('só a coordenação desativa; usuário inexistente é 404', async () => {
    assert.equal((await desativar(await entrarPronto(RAFAEL), BEATRIZ)).status, 403);
    const admin = await entrarPronto(ADMIN);
    assert.equal((await pedir('POST', '/api/admin/usuarios/99999/desativar', { cookie: admin })).status, 404);
    assert.equal((await pedir('POST', '/api/admin/usuarios/99999/reativar', { cookie: admin })).status, 404);
  });

  test('reativar devolve o acesso; a lista e o resumo acompanham', async () => {
    const admin = await entrarPronto(ADMIN);
    await desativar(admin, BEATRIZ);
    const situacao = async () => (await pedir('GET', '/api/admin/usuarios', { cookie: admin })).corpo.find((u) => u.email === BEATRIZ).ativo;
    const alunos = async () => (await pedir('GET', '/api/admin/resumo', { cookie: admin })).corpo.usuarios;
    assert.equal(await situacao(), 0);
    assert.equal(await alunos(), 1);
    assert.equal((await reativar(admin, BEATRIZ)).status, 200);
    assert.equal(await situacao(), 1);
    assert.equal(await alunos(), 2);
    assert.ok(await entrar(BEATRIZ, SENHA_ALUNO));
  });
});
