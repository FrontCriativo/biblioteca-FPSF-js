import { test } from 'node:test';
import assert from 'node:assert/strict';
import { usarServidor, pedir } from './helpers/servidor.js';

usarServidor();

test('lista as matérias com a contagem de livros', async () => {
  const r = await pedir('GET', '/api/materias');
  assert.equal(r.status, 200);
  assert.equal(r.corpo.length, 10);
  const literatura = r.corpo.find((m) => m.slug === 'literatura');
  assert.deepEqual(literatura, { slug: 'literatura', nome: 'Literatura', icone: 'livro.png', total_livros: 6 });
});

test('lista os livros com disponibilidade, em ordem de título', async () => {
  const r = await pedir('GET', '/api/livros');
  assert.equal(r.status, 200);
  assert.equal(r.corpo.length, 8);
  assert.deepEqual(r.corpo.map((l) => l.titulo), [...r.corpo.map((l) => l.titulo)].sort());
  const dom = r.corpo.find((l) => l.slug === 'dom-quixote');
  assert.equal(dom.total_exemplares, 2);
  assert.equal(dom.disponiveis, 2);
  assert.equal(dom.materia_nome, 'Literatura');
});

test('filtra por matéria', async () => {
  const r = await pedir('GET', '/api/livros?materia=filosofia');
  assert.deepEqual(r.corpo.map((l) => l.slug), ['a-republica']);
});

test('busca ignora acento e caixa, no título e no autor', async () => {
  for (const termo of ['revolucao', 'REVOLUÇÃO', 'Revolução']) {
    const r = await pedir('GET', `/api/livros?busca=${encodeURIComponent(termo)}`);
    assert.deepEqual(r.corpo.map((l) => l.slug), ['a-revolucao-dos-bichos'], termo);
  }
  const autor = await pedir('GET', `/api/livros?busca=${encodeURIComponent('platao')}`);
  assert.deepEqual(autor.corpo.map((l) => l.slug), ['a-republica']);
});

test('% e _ na busca valem como texto', async () => {
  const r = await pedir('GET', `/api/livros?busca=${encodeURIComponent('%')}`);
  assert.deepEqual(r.corpo, []);
});

test('detalhe do livro e 404', async () => {
  const r = await pedir('GET', '/api/livros/vidas-secas');
  assert.equal(r.status, 200);
  assert.equal(r.corpo.autor, 'Graciliano Ramos');
  const nada = await pedir('GET', '/api/livros/nao-existe');
  assert.equal(nada.status, 404);
  assert.deepEqual(nada.corpo, { erro: 'Livro não encontrado.' });
});
