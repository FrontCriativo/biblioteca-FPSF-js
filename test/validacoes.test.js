import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  usarServidor, pedir, entrarPronto, reservar, idDoLivro, idDoUsuario, db, ADMIN, BEATRIZ, RAFAEL, SENHA_ALUNO,
} from './helpers/servidor.js';

usarServidor();

const LIVRO = { titulo: 'Capitães da Areia', autor: 'Jorge Amado', materia_slug: 'literatura' };

describe('livro', () => {
  const recusados = [
    ['titulo acima de 255', { titulo: 'x'.repeat(256) }, /"titulo".*255/],
    ['autor acima de 255', { autor: 'x'.repeat(256) }, /"autor".*255/],
    ['sinopse acima de 5000', { sinopse: 'x'.repeat(5001) }, /"sinopse".*5000/],
    ['idioma acima de 60', { idioma: 'x'.repeat(61) }, /"idioma".*60/],
    ['paginas zero', { paginas: 0 }, /"paginas"/],
    ['paginas negativas', { paginas: -1 }, /"paginas"/],
    ['paginas acima de 100000', { paginas: 100_001 }, /"paginas".*100000/],
    ['paginas fracionadas', { paginas: 1.5 }, /"paginas"/],
    ['matéria inexistente', { materia_slug: 'astrologia' }, /matéria informada não existe/],
    ['capa com caminho', { capa: '../../backend/db/biblioteca.db' }, /nome de um arquivo/],
    ['capa com barra', { capa: 'pasta/capa.jpg' }, /nome de um arquivo/],
    ['capa com barra invertida', { capa: 'pasta\\capa.jpg' }, /nome de um arquivo/],
    ['capa ".."', { capa: '..' }, /nome de um arquivo/],
    ['capa acima de 255', { capa: `${'x'.repeat(252)}.jpg` }, /"capa".*255/],
    ['capa que não é texto', { capa: 123 }, /"capa"/],
    ['sinopse que não é texto', { sinopse: {} }, /"sinopse"/],
  ];

  for (const [nome, campos, mensagem] of recusados) {
    test(`recusa ${nome} na criação e na edição`, async () => {
      const cookie = await entrarPronto(ADMIN);
      const corpo = { ...LIVRO, ...campos };
      const criado = await pedir('POST', '/api/livros', { cookie, corpo });
      assert.equal(criado.status, 400);
      assert.match(criado.corpo.erro, mensagem);
      const editado = await pedir('PUT', `/api/livros/${idDoLivro('dom-quixote')}`, { cookie, corpo });
      assert.equal(editado.status, 400);
      assert.match(editado.corpo.erro, mensagem);
    });
  }

  test('aceita os valores no limite', async () => {
    const r = await pedir('POST', '/api/livros', {
      cookie: await entrarPronto(ADMIN),
      corpo: {
        titulo: 'x'.repeat(255), autor: 'y'.repeat(255), materia_slug: 'literatura', capa: 'minha_capa-1.final.jpg',
        sinopse: 'z'.repeat(5000), idioma: 'i'.repeat(60), paginas: '100000', exemplares: '200',
      },
    });
    assert.equal(r.status, 201);
    assert.equal(r.corpo.total_exemplares, 200);
  });

  test('campos opcionais em branco continuam valendo (é o que o formulário manda)', async () => {
    const r = await pedir('POST', '/api/livros', {
      cookie: await entrarPronto(ADMIN), corpo: { ...LIVRO, capa: '', sinopse: '', paginas: '', exemplares: '1' },
    });
    assert.equal(r.status, 201);
    assert.equal(r.corpo.capa, null);
    assert.equal(r.corpo.paginas, null);
    assert.equal(r.corpo.idioma, 'Português');
  });

  test('exemplares e quantidade vão de 1 a 200', async () => {
    const cookie = await entrarPronto(ADMIN);
    for (const exemplares of [0, 201]) {
      assert.equal((await pedir('POST', '/api/livros', { cookie, corpo: { ...LIVRO, exemplares } })).status, 400);
    }
    const caminho = `/api/livros/${idDoLivro('dom-quixote')}/exemplares`;
    for (const quantidade of [0, 201]) {
      assert.equal((await pedir('POST', caminho, { cookie, corpo: { quantidade } })).status, 400);
    }
    assert.equal((await pedir('POST', caminho, { cookie, corpo: { quantidade: 200 } })).status, 200);
  });

  test('livro inexistente é 404 ao editar e ao adicionar exemplares', async () => {
    const cookie = await entrarPronto(ADMIN);
    const editado = await pedir('PUT', '/api/livros/99999', { cookie, corpo: LIVRO });
    assert.equal(editado.status, 404);
    assert.deepEqual(editado.corpo, { erro: 'Livro não encontrado.' });
    assert.equal((await pedir('POST', '/api/livros/99999/exemplares', { cookie, corpo: {} })).status, 404);
  });
});

describe('usuário criado pela coordenação', () => {
  const USUARIO = { nome: 'Caio', email: 'caio@fpsf.edu.br', senha: 'provisoria1' };

  test('recusa e-mail mal formado', async () => {
    const cookie = await entrarPronto(ADMIN);
    for (const email of ['caio', 'caio@', '@fpsf.edu.br', 'caio @fpsf.edu.br', 'caio@fpsf', 'a@b@c.br']) {
      const r = await pedir('POST', '/api/admin/usuarios', { cookie, corpo: { ...USUARIO, email } });
      assert.equal(r.status, 400, email);
      assert.match(r.corpo.erro, /e-mail válido/, email);
    }
  });

  test('recusa campos acima do limite', async () => {
    const cookie = await entrarPronto(ADMIN);
    const longo = `${'x'.repeat(250)}@fpsf.edu.br`;
    assert.equal((await pedir('POST', '/api/admin/usuarios', { cookie, corpo: { ...USUARIO, email: longo } })).status, 400);
    assert.equal((await pedir('POST', '/api/admin/usuarios', { cookie, corpo: { ...USUARIO, nome: 'x'.repeat(256) } })).status, 400);
    assert.equal((await pedir('POST', '/api/admin/usuarios', { cookie, corpo: { ...USUARIO, turma: 'x'.repeat(41) } })).status, 400);
  });

  test('grava o e-mail em minúsculas e sem espaços', async () => {
    const cookie = await entrarPronto(ADMIN);
    const r = await pedir('POST', '/api/admin/usuarios', { cookie, corpo: { ...USUARIO, email: '  Caio.PRADO@FPSF.edu.br ' } });
    assert.equal(r.status, 201);
    assert.equal(r.corpo.email, 'caio.prado@fpsf.edu.br');
    const duplicado = await pedir('POST', '/api/admin/usuarios', { cookie, corpo: { ...USUARIO, email: 'CAIO.prado@fpsf.edu.br' } });
    assert.equal(duplicado.status, 409);
  });
});

describe('login', () => {
  test('e-mail com espaços e maiúsculas entra na mesma conta', async () => {
    const r = await pedir('POST', '/api/login', { corpo: { email: `  ${BEATRIZ.toUpperCase()} `, senha: SENHA_ALUNO } });
    assert.equal(r.status, 200);
    assert.equal(r.corpo.id, idDoUsuario(BEATRIZ));
  });

  test('variações do e-mail contam no mesmo limite de tentativas', async () => {
    for (const email of [BEATRIZ, BEATRIZ.toUpperCase(), ` ${BEATRIZ}`, `${BEATRIZ} `, BEATRIZ]) {
      assert.equal((await pedir('POST', '/api/login', { corpo: { email, senha: 'errada123' } })).status, 401);
    }
    assert.equal((await pedir('POST', '/api/login', { corpo: { email: BEATRIZ, senha: SENHA_ALUNO } })).status, 429);
  });
});

describe('reserva sob concorrência', () => {
  test('índice único disparado vira 409, e não 500', async (t) => {
    const aluno = await entrarPronto(BEATRIZ);
    // Simula outro processo: o gatilho reserva o exemplar logo antes do INSERT da API.
    db.exec(`
      CREATE TEMP TRIGGER corrida BEFORE INSERT ON reservas WHEN NEW.usuario_id = ${idDoUsuario(BEATRIZ)}
      BEGIN
        INSERT INTO reservas (exemplar_id, usuario_id, expira_em)
        VALUES (NEW.exemplar_id, ${idDoUsuario(RAFAEL)}, datetime('now', '+3 days'));
      END`);
    t.after(() => db.exec('DROP TRIGGER corrida'));

    const r = await pedir('POST', '/api/reservas', { cookie: aluno, corpo: { livro_id: idDoLivro('dom-quixote') } });
    assert.equal(r.status, 409);
    assert.deepEqual(r.corpo, { erro: 'Este exemplar acabou de ser reservado. Tente novamente.' });
  });

  test('a reserva recusada não deixa transação aberta', async (t) => {
    const aluno = await entrarPronto(BEATRIZ);
    db.exec(`
      CREATE TEMP TRIGGER corrida2 BEFORE INSERT ON reservas WHEN NEW.usuario_id = ${idDoUsuario(BEATRIZ)}
      BEGIN
        INSERT INTO reservas (exemplar_id, usuario_id, expira_em)
        VALUES (NEW.exemplar_id, ${idDoUsuario(RAFAEL)}, datetime('now', '+3 days'));
      END`);
    await pedir('POST', '/api/reservas', { cookie: aluno, corpo: { livro_id: idDoLivro('dom-quixote') } });
    db.exec('DROP TRIGGER corrida2');
    const reserva = await reservar(aluno, 'dom-quixote');
    assert.equal(reserva.status, 'ativa');
  });
});

describe('corpo da requisição', () => {
  test('JSON que não é objeto é 400, e não 500', async () => {
    const cookie = await entrarPronto(ADMIN);
    for (const corpo of ['null', '[]', '1', '"texto"']) {
      const r = await pedir('POST', '/api/livros', { cookie, corpo });
      assert.equal(r.status, 400, corpo);
      assert.deepEqual(r.corpo, { erro: 'JSON inválido.' });
    }
  });
});
