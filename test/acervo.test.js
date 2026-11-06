import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  usarServidor, pedir, entrarPronto, reservar, idDoLivro, ADMIN, BEATRIZ,
} from './helpers/servidor.js';

usarServidor();

const NOVO = { titulo: 'Capitães da Areia', autor: 'Jorge Amado', materia_slug: 'literatura', exemplares: 2 };

describe('CRUD de livro', () => {
  test('só a coordenação cria, altera e remove', async () => {
    const aluno = await entrarPronto(BEATRIZ);
    const id = idDoLivro('dom-quixote');
    assert.equal((await pedir('POST', '/api/livros', { corpo: NOVO })).status, 401);
    assert.equal((await pedir('POST', '/api/livros', { cookie: aluno, corpo: NOVO })).status, 403);
    assert.equal((await pedir('PUT', `/api/livros/${id}`, { cookie: aluno, corpo: NOVO })).status, 403);
    assert.equal((await pedir('DELETE', `/api/livros/${id}`, { cookie: aluno })).status, 403);
    assert.equal((await pedir('POST', `/api/livros/${id}/exemplares`, { cookie: aluno, corpo: {} })).status, 403);
  });

  test('cria com slug sem acento, exemplares e busca normalizada', async () => {
    const cookie = await entrarPronto(ADMIN);
    const r = await pedir('POST', '/api/livros', { cookie, corpo: NOVO });
    assert.equal(r.status, 201);
    assert.equal(r.corpo.slug, 'capitaes-da-areia');
    assert.equal(r.corpo.total_exemplares, 2);
    assert.equal(r.corpo.idioma, 'Português');
    const busca = await pedir('GET', '/api/livros?busca=capitaes');
    assert.deepEqual(busca.corpo.map((l) => l.slug), ['capitaes-da-areia']);
  });

  test('título repetido é 409', async () => {
    const cookie = await entrarPronto(ADMIN);
    const r = await pedir('POST', '/api/livros', { cookie, corpo: { ...NOVO, titulo: 'Dom Quixote' } });
    assert.equal(r.status, 409);
    assert.equal(r.corpo.erro, 'Já existe um livro com esse título.');
  });

  test('atualiza os dados e a busca acompanha', async () => {
    const cookie = await entrarPronto(ADMIN);
    const r = await pedir('PUT', `/api/livros/${idDoLivro('dom-quixote')}`, {
      cookie, corpo: { titulo: 'Dom Quixote de la Mancha', autor: 'Miguel de Cervantes', materia_slug: 'literatura', paginas: 900 },
    });
    assert.equal(r.status, 200);
    assert.equal(r.corpo.paginas, 900);
    const busca = await pedir('GET', '/api/livros?busca=mancha');
    assert.equal(busca.corpo.length, 1);
  });

  test('remove o livro sem histórico', async () => {
    const cookie = await entrarPronto(ADMIN);
    const r = await pedir('DELETE', `/api/livros/${idDoLivro('dom-quixote')}`, { cookie });
    assert.equal(r.status, 200);
    assert.equal((await pedir('GET', '/api/livros/dom-quixote')).status, 404);
  });

  test('livro com qualquer histórico de reserva não é removido', async () => {
    const admin = await entrarPronto(ADMIN);
    const aluno = await entrarPronto(BEATRIZ);
    const reserva = await reservar(aluno, 'dom-quixote');
    await pedir('POST', `/api/reservas/${reserva.id}/cancelar`, { cookie: aluno });
    const r = await pedir('DELETE', `/api/livros/${idDoLivro('dom-quixote')}`, { cookie: admin });
    assert.equal(r.status, 409);
    assert.equal(r.corpo.erro, 'Este livro tem histórico de reservas e não pode ser removido.');
  });

  test('adiciona exemplares', async () => {
    const cookie = await entrarPronto(ADMIN);
    const r = await pedir('POST', `/api/livros/${idDoLivro('dom-quixote')}/exemplares`, { cookie, corpo: { quantidade: 3 } });
    assert.equal(r.status, 200);
    assert.deepEqual(r.corpo, { ok: true, adicionados: 3 });
    assert.equal((await pedir('GET', '/api/livros/dom-quixote')).corpo.total_exemplares, 5);
  });
});

describe('upload de capa', () => {
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]).toString('base64');
  const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]).toString('base64');
  const WEBP = Buffer.from('RIFF\0\0\0\0WEBPVP8 ', 'latin1').toString('base64');
  const pasta = fileURLToPath(new URL('../frontend/assets/', import.meta.url));

  test('a extensão vem da assinatura da imagem, não do nome enviado', async (t) => {
    const cookie = await entrarPronto(ADMIN);
    for (const [dados, ext] of [[PNG, 'png'], [JPG, 'jpg'], [WEBP, 'webp']]) {
      const r = await pedir('POST', '/api/admin/capas', { cookie, corpo: { nome: 'Teste Ção.exe', dados } });
      assert.equal(r.status, 201);
      t.after(() => rmSync(pasta + r.corpo.arquivo, { force: true }));
      assert.match(r.corpo.arquivo, new RegExp(`^teste-cao(-\\d+)?\\.${ext}$`));
    }
  });

  test('não sobrescreve arquivo com o mesmo nome', async (t) => {
    const cookie = await entrarPronto(ADMIN);
    const corpo = { nome: 'capa-repetida.png', dados: PNG };
    const primeira = await pedir('POST', '/api/admin/capas', { cookie, corpo });
    const segunda = await pedir('POST', '/api/admin/capas', { cookie, corpo });
    t.after(() => {
      rmSync(pasta + primeira.corpo.arquivo, { force: true });
      rmSync(pasta + segunda.corpo.arquivo, { force: true });
    });
    assert.notEqual(primeira.corpo.arquivo, segunda.corpo.arquivo);
  });

  test('recusa o que não é imagem e quem não é coordenação', async () => {
    const dados = Buffer.from('<script>alert(1)</script>').toString('base64');
    const r = await pedir('POST', '/api/admin/capas', { cookie: await entrarPronto(ADMIN), corpo: { nome: 'a.png', dados } });
    assert.equal(r.status, 400);
    assert.equal(r.corpo.erro, 'Envie uma imagem JPG, PNG ou WEBP.');
    const aluno = await pedir('POST', '/api/admin/capas', { cookie: await entrarPronto(BEATRIZ), corpo: { nome: 'a.png', dados: PNG } });
    assert.equal(aluno.status, 403);
  });
});

describe('usuários pela coordenação', () => {
  const USUARIO = { nome: 'Caio Prado', email: 'caio.prado@fpsf.edu.br', senha: 'provisoria1', turma: '7º ano A' };

  test('cria aluno com senha provisória e recusa e-mail repetido', async () => {
    const cookie = await entrarPronto(ADMIN);
    const r = await pedir('POST', '/api/admin/usuarios', { cookie, corpo: USUARIO });
    assert.equal(r.status, 201);
    assert.equal(r.corpo.papel, 'aluno');
    assert.equal(r.corpo.turma, '7º ano A');
    const repetido = await pedir('POST', '/api/admin/usuarios', { cookie, corpo: USUARIO });
    assert.equal(repetido.status, 409);
    const login = await pedir('POST', '/api/login', { corpo: { email: USUARIO.email, senha: USUARIO.senha } });
    assert.equal(login.corpo.trocar_senha, 1);
  });

  test('lista os usuários com as reservas em aberto', async () => {
    const admin = await entrarPronto(ADMIN);
    await reservar(await entrarPronto(BEATRIZ), 'dom-quixote');
    const { corpo } = await pedir('GET', '/api/admin/usuarios', { cookie: admin });
    assert.equal(corpo.length, 3);
    const beatriz = corpo.find((u) => u.email === BEATRIZ);
    assert.equal(beatriz.reservas_ativas, 1);
    assert.equal(beatriz.turma, '8º ano B');
    assert.equal(beatriz.senha_hash, undefined);
  });
});
