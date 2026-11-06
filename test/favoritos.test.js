import { test } from 'node:test';
import assert from 'node:assert/strict';
import { usarServidor, pedir, entrar, entrarPronto, reservar, idDoLivro, db, ADMIN, BEATRIZ, RAFAEL, SENHA_ALUNO } from './helpers/servidor.js';

usarServidor();

const favoritar = (cookie, slug) => pedir('PUT', `/api/favoritos/${idDoLivro(slug)}`, { cookie });
const slugs = async (cookie) => (await pedir('GET', '/api/favoritos', { cookie })).corpo.map((l) => l.slug);

test('precisa de login e da senha já trocada', async () => {
  const id = idDoLivro('dom-quixote');
  assert.equal((await pedir('GET', '/api/favoritos')).status, 401);
  assert.equal((await pedir('PUT', `/api/favoritos/${id}`)).status, 401);
  assert.equal((await pedir('DELETE', `/api/favoritos/${id}`)).status, 401);
  const provisoria = await entrar(BEATRIZ, SENHA_ALUNO);
  assert.equal((await pedir('GET', '/api/favoritos', { cookie: provisoria })).status, 403);
});

test('a lista vem no formato do catálogo, com a disponibilidade atual', async () => {
  const cookie = await entrarPronto(BEATRIZ);
  await favoritar(cookie, 'dom-quixote');
  await reservar(await entrarPronto(RAFAEL), 'dom-quixote');
  const [favorito] = (await pedir('GET', '/api/favoritos', { cookie })).corpo;
  const catalogo = (await pedir('GET', '/api/livros/dom-quixote')).corpo;
  assert.deepEqual(favorito, catalogo);
  assert.equal(favorito.disponiveis, 1);
});

test('adicionar duas vezes não duplica', async () => {
  const cookie = await entrarPronto(BEATRIZ);
  assert.equal((await favoritar(cookie, 'dom-quixote')).status, 200);
  assert.equal((await favoritar(cookie, 'dom-quixote')).status, 200);
  assert.deepEqual(await slugs(cookie), ['dom-quixote']);
});

test('remover tira da lista e repetir não é erro', async () => {
  const cookie = await entrarPronto(BEATRIZ);
  await favoritar(cookie, 'dom-quixote');
  const caminho = `/api/favoritos/${idDoLivro('dom-quixote')}`;
  assert.equal((await pedir('DELETE', caminho, { cookie })).status, 200);
  assert.equal((await pedir('DELETE', caminho, { cookie })).status, 200);
  assert.deepEqual(await slugs(cookie), []);
});

test('o mais recente vem primeiro', async () => {
  const cookie = await entrarPronto(BEATRIZ);
  await favoritar(cookie, 'dom-quixote');
  await favoritar(cookie, 'vidas-secas');
  assert.deepEqual(await slugs(cookie), ['vidas-secas', 'dom-quixote']);
});

test('cada leitor tem a própria lista', async () => {
  const beatriz = await entrarPronto(BEATRIZ);
  const rafael = await entrarPronto(RAFAEL);
  await favoritar(beatriz, 'dom-quixote');
  assert.deepEqual(await slugs(rafael), []);
  await pedir('DELETE', `/api/favoritos/${idDoLivro('dom-quixote')}`, { cookie: rafael });
  assert.deepEqual(await slugs(beatriz), ['dom-quixote']);
});

test('livro inexistente é 404 e id inválido é 400', async () => {
  const cookie = await entrarPronto(BEATRIZ);
  const r = await pedir('PUT', '/api/favoritos/99999', { cookie });
  assert.equal(r.status, 404);
  assert.deepEqual(r.corpo, { erro: 'Livro não encontrado.' });
  assert.equal((await pedir('PUT', '/api/favoritos/abc', { cookie })).status, 400);
});

test('favoritar não conta como histórico: o livro ainda pode sair do acervo', async () => {
  const aluno = await entrarPronto(BEATRIZ);
  await favoritar(aluno, 'dom-quixote');
  const r = await pedir('DELETE', `/api/livros/${idDoLivro('dom-quixote')}`, { cookie: await entrarPronto(ADMIN) });
  assert.equal(r.status, 200);
  assert.deepEqual(await slugs(aluno), []);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM favoritos').get().n, 0);
});
