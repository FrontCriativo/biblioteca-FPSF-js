import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  usarServidor, pedir, entrarPronto, reservar, idDoLivro, idDoUsuario, db, ADMIN, BEATRIZ, RAFAEL, SENHA_ALUNO,
} from './helpers/servidor.js';

usarServidor();

const CAMPOS_PRODUTO = [
  'autor', 'categoria_produto', 'descricao', 'disponiveis', 'genero', 'id', 'imagem', 'livrosDestaque',
  'slug', 'status', 'status_produto', 'titulo', 'total_exemplares',
];

describe('POST /api/v1/login', () => {
  test('recebe password e devolve o token no topo, sem data', async () => {
    const r = await pedir('POST', '/api/v1/login', { corpo: { email: BEATRIZ, password: SENHA_ALUNO } });
    assert.equal(r.status, 200);
    assert.deepEqual(Object.keys(r.corpo).sort(), ['mensagem', 'success', 'token', 'usuario']);
    assert.equal(r.corpo.success, true);
    assert.equal(r.corpo.mensagem, 'Login realizado com sucesso.');
    assert.equal(r.corpo.usuario.id, idDoUsuario(BEATRIZ));
    assert.equal((await pedir('GET', '/api/v1/usuario', { token: r.corpo.token })).status, 200);
  });

  test('o campo senha não vale aqui, e password errada é 401', async () => {
    const semPassword = await pedir('POST', '/api/v1/login', { corpo: { email: BEATRIZ, senha: SENHA_ALUNO } });
    assert.equal(semPassword.status, 422);
    assert.match(semPassword.corpo.erro, /"password"/);
    const errada = await pedir('POST', '/api/v1/login', { corpo: { email: BEATRIZ, password: 'errada123' } });
    assert.equal(errada.status, 401);
    assert.deepEqual(errada.corpo, { success: false, erro: 'E-mail ou senha incorretos.' });
  });

  test('aceita device_name e segue um token por dispositivo', async () => {
    const corpo = { email: BEATRIZ, password: SENHA_ALUNO, device_name: 'celular' };
    const primeiro = await pedir('POST', '/api/v1/login', { corpo });
    await pedir('POST', '/api/v1/login', { corpo });
    assert.equal((await pedir('GET', '/api/v1/usuario', { token: primeiro.corpo.token })).status, 401);
  });
});

describe('GET /api/v1/produto', () => {
  test('cada item tem exatamente os campos do app', async () => {
    const { corpo } = await pedir('GET', '/api/v1/produto');
    assert.equal(corpo.success, true);
    assert.equal(corpo.data.length, 8);
    for (const item of corpo.data) assert.deepEqual(Object.keys(item).sort(), CAMPOS_PRODUTO);
  });

  test('mapeia os dados do livro', async () => {
    const { corpo } = await pedir('GET', '/api/v1/produto');
    const dom = corpo.data.find((p) => p.slug === 'dom-quixote');
    assert.deepEqual(dom, {
      id: idDoLivro('dom-quixote'),
      slug: 'dom-quixote',
      titulo: 'Dom Quixote',
      autor: 'Miguel de Cervantes',
      categoria_produto: { id_categoria: 'literatura', nome_categoria: 'Literatura' },
      genero: 'Literatura',
      imagem: 'domQuixote.jpg',
      status: 'disponivel',
      status_produto: 'ATIVO',
      livrosDestaque: 'SIM',
      descricao: 'Um fidalgo enlouquecido pelas novelas de cavalaria sai pelo campo em busca de aventuras, acompanhado do escudeiro Sancho Pança.',
      total_exemplares: 2,
      disponiveis: 2,
    });
  });

  test('status vira emprestado quando não sobra exemplar', async () => {
    await reservar(await entrarPronto(BEATRIZ), 'a-republica');
    await reservar(await entrarPronto(RAFAEL), 'a-republica');
    const { corpo } = await pedir('GET', '/api/v1/produto');
    const republica = corpo.data.find((p) => p.slug === 'a-republica');
    assert.equal(republica.status, 'emprestado');
    assert.equal(republica.disponiveis, 0);
    assert.equal(republica.total_exemplares, 2);
    assert.equal(republica.status_produto, 'ATIVO');
  });

  test('destaque são os 6 livros cadastrados por último', async () => {
    const { corpo } = await pedir('GET', '/api/v1/produto');
    const destaques = corpo.data.filter((p) => p.livrosDestaque === 'SIM').map((p) => p.id).sort((a, b) => a - b);
    const esperados = db.prepare('SELECT id FROM livros ORDER BY id DESC LIMIT 6').all().map((l) => l.id).sort((a, b) => a - b);
    assert.deepEqual(destaques, esperados);
    assert.equal(corpo.data.filter((p) => p.livrosDestaque === 'NAO').length, 2);
  });

  test('um livro novo entra nos destaques e empurra o mais antigo para fora', async () => {
    const antigoDestaque = db.prepare('SELECT id FROM livros ORDER BY id DESC LIMIT 1 OFFSET 5').get().id;
    const { corpo: criado } = await pedir('POST', '/api/livros', {
      cookie: await entrarPronto(ADMIN), corpo: { titulo: 'Novo', autor: 'Autor', materia_slug: 'literatura' },
    });
    const { corpo } = await pedir('GET', '/api/v1/produto');
    const destaque = (id) => corpo.data.find((p) => p.id === id).livrosDestaque;
    assert.equal(destaque(criado.id), 'SIM');
    assert.equal(destaque(antigoDestaque), 'NAO');
  });
});

describe('GET /api/v1/produto/:id', () => {
  test('um item por id numérico, com o destaque calculado', async () => {
    const { corpo: lista } = await pedir('GET', '/api/v1/produto');
    const naoDestaque = lista.data.find((p) => p.livrosDestaque === 'NAO');
    const r = await pedir('GET', `/api/v1/produto/${naoDestaque.id}`);
    assert.equal(r.status, 200);
    assert.deepEqual(r.corpo.data, naoDestaque);
  });

  test('id inexistente é 404 de livro; id que não é número é 404 de rota', async () => {
    const nada = await pedir('GET', '/api/v1/produto/99999');
    assert.equal(nada.status, 404);
    assert.deepEqual(nada.corpo, { success: false, erro: 'Livro não encontrado.' });
    const slug = await pedir('GET', '/api/v1/produto/dom-quixote');
    assert.equal(slug.status, 404);
    assert.deepEqual(slug.corpo, { success: false, erro: 'Rota não encontrada.' });
  });
});

describe('GET /api/v1/categoria', () => {
  test('em ordem alfabética, com a posição em ordem_categoria', async () => {
    const { corpo } = await pedir('GET', '/api/v1/categoria');
    assert.equal(corpo.success, true);
    assert.equal(corpo.data.length, 10);
    assert.deepEqual(corpo.data[0], {
      id_categoria: 'artes', nome_categoria: 'Artes', status_categoria: 'ATIVO', ordem_categoria: 1, icone: 'artes.png',
    });
    assert.deepEqual(corpo.data.map((c) => c.ordem_categoria), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const nomes = corpo.data.map((c) => c.nome_categoria);
    assert.deepEqual(nomes, [...nomes].sort((a, b) => a.localeCompare(b, 'pt-BR')));
  });

  test('id_categoria é o mesmo de categoria_produto', async () => {
    const categorias = (await pedir('GET', '/api/v1/categoria')).corpo.data.map((c) => c.id_categoria);
    const produtos = (await pedir('GET', '/api/v1/produto')).corpo.data;
    for (const p of produtos) assert.ok(categorias.includes(p.categoria_produto.id_categoria));
  });

  test('acento não joga a matéria para o fim da lista', async () => {
    db.prepare("INSERT INTO materias (slug, nome, icone) VALUES ('etica', 'Ética', 'livro.png')").run();
    const { corpo } = await pedir('GET', '/api/v1/categoria');
    const nomes = corpo.data.map((c) => c.nome_categoria);
    assert.ok(nomes.indexOf('Ética') < nomes.indexOf('Filosofia'));
  });
});
