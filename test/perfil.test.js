import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  usarServidor, pedir, entrar, entrarPronto, tokenPronto, db, ADMIN, BEATRIZ, RAFAEL, SENHA_ADMIN, SENHA_ALUNO,
} from './helpers/servidor.js';

usarServidor();

const contaDe = (email) => db.prepare(`
  SELECT u.*, t.nome AS turma FROM usuarios u LEFT JOIN turmas t ON t.id = u.turma_id WHERE u.email = ?
`).get(email);

/** Aluno que já trocou a senha, mas ainda não conferiu o perfil. */
async function entrarComPerfilPendente(email) {
  db.prepare('UPDATE usuarios SET trocar_senha = 0, perfil_confirmado = 0 WHERE email = ?').run(email);
  return entrar(email, SENHA_ALUNO);
}

const DADOS = { nome: 'Beatriz Lima Souza', turma: '9º ano A', telefone: '(11) 91234-5678' };

describe('perfil obrigatório', () => {
  test('login e /api/eu avisam que o perfil está pendente', async () => {
    db.prepare('UPDATE usuarios SET trocar_senha = 0 WHERE email = ?').run(BEATRIZ);
    const login = await pedir('POST', '/api/login', { corpo: { email: BEATRIZ, senha: SENHA_ALUNO } });
    assert.equal(login.corpo.completar_perfil, 1);
    const eu = await pedir('GET', '/api/eu', { cookie: login.cookie });
    assert.equal(eu.corpo.completar_perfil, 1);
  });

  test('o site fica fechado até o aluno salvar o perfil', async () => {
    const cookie = await entrarComPerfilPendente(BEATRIZ);
    const bloqueada = await pedir('GET', '/api/reservas', { cookie });
    assert.equal(bloqueada.status, 403);
    assert.equal(bloqueada.corpo.erro, 'Complete seu perfil antes de continuar.');

    assert.equal((await pedir('PUT', '/api/eu/perfil', { cookie, corpo: DADOS })).status, 200);

    assert.equal((await pedir('GET', '/api/reservas', { cookie })).status, 200);
    assert.equal((await pedir('GET', '/api/eu', { cookie })).corpo.completar_perfil, 0);
  });

  test('depois de confirmado, o próximo login não pede de novo', async () => {
    const cookie = await entrarComPerfilPendente(BEATRIZ);
    await pedir('PUT', '/api/eu/perfil', { cookie, corpo: DADOS });
    const login = await pedir('POST', '/api/login', { corpo: { email: BEATRIZ, senha: SENHA_ALUNO } });
    assert.equal(login.corpo.completar_perfil, 0);
  });

  test('senha provisória vem antes do perfil', async () => {
    const cookie = await entrar(BEATRIZ, SENHA_ALUNO);
    const r = await pedir('PUT', '/api/eu/perfil', { cookie, corpo: DADOS });
    assert.equal(r.status, 403);
    assert.equal(r.corpo.erro, 'Troque sua senha provisória antes de continuar.');

    const troca = await pedir('POST', '/api/eu/senha', {
      cookie, corpo: { senha_atual: SENHA_ALUNO, nova_senha: 'senhaNova123' },
    });
    assert.equal(troca.status, 200);
    assert.equal((await pedir('PUT', '/api/eu/perfil', { cookie, corpo: DADOS })).status, 200);
  });

  test('a coordenação não passa pela tela de perfil', async () => {
    db.prepare('UPDATE usuarios SET trocar_senha = 0 WHERE email = ?').run(ADMIN);
    const login = await pedir('POST', '/api/login', { corpo: { email: ADMIN, senha: SENHA_ADMIN } });
    assert.equal(login.corpo.completar_perfil, 0);
    assert.equal((await pedir('GET', '/api/admin/resumo', { cookie: login.cookie })).status, 200);
  });

  test('o aplicativo continua funcionando: a v1 não conhece essa pendência', async () => {
    const token = await tokenPronto(BEATRIZ);
    assert.equal(contaDe(BEATRIZ).perfil_confirmado, 0);
    assert.equal((await pedir('GET', '/api/v1/reservas', { token })).status, 200);
    const eu = await pedir('GET', '/api/v1/usuario', { token });
    assert.deepEqual(Object.keys(eu.corpo.data).sort(), ['email', 'id', 'nome', 'papel', 'trocar_senha', 'turma']);
  });
});

describe('salvar o perfil', () => {
  test('grava nome, série e telefone só com dígitos', async () => {
    const cookie = await entrarComPerfilPendente(BEATRIZ);
    const r = await pedir('PUT', '/api/eu/perfil', { cookie, corpo: DADOS });
    assert.equal(r.corpo.nome, 'Beatriz Lima Souza');
    assert.equal(r.corpo.turma, '9º ano A');
    assert.equal(r.corpo.telefone, '11912345678');
    const conta = contaDe(BEATRIZ);
    assert.equal(conta.turma, '9º ano A');
    assert.equal(conta.perfil_confirmado, 1);
  });

  test('o e-mail não muda, mesmo que venha no corpo', async () => {
    const cookie = await entrarComPerfilPendente(BEATRIZ);
    const r = await pedir('PUT', '/api/eu/perfil', { cookie, corpo: { ...DADOS, email: 'outro@fpsf.edu.br', papel: 'admin' } });
    assert.equal(r.status, 200);
    assert.equal(r.corpo.email, BEATRIZ);
    assert.equal(contaDe(BEATRIZ).papel, 'aluno');
  });

  test('série já cadastrada é reaproveitada, sem diferenciar maiúsculas', async () => {
    const cookie = await entrarComPerfilPendente(BEATRIZ);
    const total = () => db.prepare('SELECT COUNT(*) AS n FROM turmas').get().n;
    const antes = total();
    const r = await pedir('PUT', '/api/eu/perfil', { cookie, corpo: { ...DADOS, turma: '8º ANO B' } });
    assert.equal(r.corpo.turma, '8º ano B');
    assert.equal(total(), antes);
  });

  test('telefone é opcional e pode ser apagado depois', async () => {
    const cookie = await entrarComPerfilPendente(BEATRIZ);
    await pedir('PUT', '/api/eu/perfil', { cookie, corpo: DADOS });
    for (const corpo of [{ ...DADOS, telefone: '' }, { nome: DADOS.nome, turma: DADOS.turma }]) {
      const r = await pedir('PUT', '/api/eu/perfil', { cookie, corpo });
      assert.equal(r.status, 200);
      assert.equal(r.corpo.telefone, null);
    }
  });

  test('nome e série são obrigatórios, e o erro não confirma o perfil', async () => {
    const cookie = await entrarComPerfilPendente(BEATRIZ);
    const casos = [
      { ...DADOS, nome: '  ' }, { ...DADOS, turma: '' }, { telefone: DADOS.telefone },
      { ...DADOS, nome: 'x'.repeat(81) }, { ...DADOS, turma: 'x'.repeat(41) },
    ];
    for (const corpo of casos) {
      assert.equal((await pedir('PUT', '/api/eu/perfil', { cookie, corpo })).status, 400, JSON.stringify(corpo));
    }
    assert.equal(contaDe(BEATRIZ).perfil_confirmado, 0);
  });

  test('telefone precisa ter DDD', async () => {
    const cookie = await entrarComPerfilPendente(BEATRIZ);
    for (const telefone of ['91234-5678', '123', '(11) 91234-56789', 123]) {
      const r = await pedir('PUT', '/api/eu/perfil', { cookie, corpo: { ...DADOS, telefone } });
      assert.equal(r.status, 400, String(telefone));
    }
    const fixo = await pedir('PUT', '/api/eu/perfil', { cookie, corpo: { ...DADOS, telefone: '1133334444' } });
    assert.equal(fixo.corpo.telefone, '1133334444');
  });

  test('sem login não salva nem lista as séries', async () => {
    assert.equal((await pedir('PUT', '/api/eu/perfil', { corpo: DADOS })).status, 401);
    assert.equal((await pedir('GET', '/api/turmas')).status, 401);
  });

  test('um aluno só altera o próprio perfil', async () => {
    const cookie = await entrarPronto(BEATRIZ);
    const antes = contaDe(RAFAEL);
    await pedir('PUT', '/api/eu/perfil', { cookie, corpo: DADOS });
    assert.deepEqual(contaDe(RAFAEL), antes);
  });
});

describe('sugestões de série', () => {
  test('devolve só os nomes, e o aluno com perfil pendente consegue ler', async () => {
    const cookie = await entrarComPerfilPendente(BEATRIZ);
    const r = await pedir('GET', '/api/turmas', { cookie });
    assert.equal(r.status, 200);
    assert.ok(r.corpo.includes('8º ano B'));
    assert.ok(r.corpo.every((nome) => typeof nome === 'string'));
  });
});
