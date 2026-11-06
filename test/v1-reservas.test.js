import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  usarServidor, pedir, entrarV1, tokenPronto, entrarPronto, idDoLivro, db, ADMIN, BEATRIZ, RAFAEL, SENHA_ALUNO,
} from './helpers/servidor.js';

usarServidor();

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

const reservar = (token, slug) => pedir('POST', '/api/v1/reservas', { token, corpo: { livro_id: idDoLivro(slug) } });

async function emprestar(token, slug = 'dom-quixote') {
  const { corpo } = await reservar(token, slug);
  await pedir('POST', `/api/admin/reservas/${corpo.data.id}/retirar`, { cookie: await entrarPronto(ADMIN) });
  return corpo.data.id;
}

describe('acesso', () => {
  const rotas = [
    ['GET', '/api/v1/reservas'], ['POST', '/api/v1/reservas'], ['POST', '/api/v1/reservas/1/cancelar'],
    ['POST', '/api/v1/reservas/1/renovar'], ['GET', '/api/v1/favoritos'], ['PUT', '/api/v1/favoritos/1'],
    ['DELETE', '/api/v1/favoritos/1'],
  ];

  test('todas exigem token', async () => {
    for (const [metodo, caminho] of rotas) {
      const r = await pedir(metodo, caminho);
      assert.equal(r.status, 401, `${metodo} ${caminho}`);
      assert.equal(r.corpo.success, false);
    }
  });

  test('o cookie do site não vale', async () => {
    const cookie = await entrarPronto(BEATRIZ);
    assert.equal((await pedir('GET', '/api/v1/reservas', { cookie })).status, 401);
  });

  test('conta com senha provisória recebe 403 em todas', async () => {
    const token = await entrarV1(BEATRIZ, SENHA_ALUNO);
    for (const [metodo, caminho] of rotas) {
      const r = await pedir(metodo, caminho, { token });
      assert.equal(r.status, 403, `${metodo} ${caminho}`);
      assert.equal(r.corpo.erro, 'Troque sua senha provisória antes de continuar.');
    }
  });
});

describe('reservas', () => {
  test('reserva e lista, com datas ISO e booleanos', async () => {
    const token = await tokenPronto(BEATRIZ);
    const r = await reservar(token, 'dom-quixote');
    assert.equal(r.status, 201);
    assert.equal(r.corpo.success, true);
    assert.equal(r.corpo.mensagem, 'Reserva realizada com sucesso.');
    const { data } = r.corpo;
    assert.equal(data.status, 'ativa');
    assert.equal(data.titulo, 'Dom Quixote');
    assert.equal(data.livro_slug, 'dom-quixote');
    assert.match(data.criada_em, ISO_UTC);
    assert.match(data.expira_em, ISO_UTC);
    assert.equal(data.devolver_ate, null);
    assert.equal(data.atrasada, false);
    assert.equal(data.pode_renovar, false);

    const lista = await pedir('GET', '/api/v1/reservas', { token });
    assert.deepEqual(lista.corpo.data, [data]);
  });

  test('não expõe observação nem dados da conta', async () => {
    const token = await tokenPronto(BEATRIZ);
    const id = await emprestar(token);
    await pedir('PUT', `/api/admin/reservas/${id}/observacao`, {
      cookie: await entrarPronto(ADMIN), corpo: { observacao: 'SEGREDO' },
    });
    const respostas = [
      await pedir('GET', '/api/v1/reservas', { token }),
      await pedir('POST', `/api/v1/reservas/${id}/renovar`, { token }),
    ];
    for (const r of respostas) {
      assert.equal(r.status, 200);
      assert.doesNotMatch(JSON.stringify(r.corpo), /SEGREDO|observacao|usuario_email|usuario_nome/);
    }
  });

  test('mantém as regras do site: duplicada, limite de 3 e sem exemplar', async () => {
    const token = await tokenPronto(BEATRIZ);
    await reservar(token, 'dom-quixote');
    const duplicada = await reservar(token, 'dom-quixote');
    assert.equal(duplicada.status, 409);
    assert.deepEqual(duplicada.corpo, { success: false, erro: 'Você já tem uma reserva ativa deste livro.' });

    await reservar(token, 'vidas-secas');
    await reservar(token, 'a-republica');
    const limite = await reservar(token, 'romeu-e-julieta');
    assert.equal(limite.status, 409);
    assert.match(limite.corpo.erro, /já tem 3 livros/);

    await reservar(await tokenPronto(RAFAEL), 'dom-quixote');
    const esgotado = await reservar(await tokenPronto(ADMIN), 'dom-quixote');
    assert.equal(esgotado.status, 409);
    assert.equal(esgotado.corpo.erro, 'Não há exemplares disponíveis no momento.');
  });

  test('o limite conta reservas feitas pelo site e pelo aplicativo juntas', async () => {
    const token = await tokenPronto(BEATRIZ);
    const cookie = await entrarPronto(BEATRIZ);
    await reservar(token, 'dom-quixote');
    await reservar(token, 'vidas-secas');
    await pedir('POST', '/api/reservas', { cookie, corpo: { livro_id: idDoLivro('a-republica') } });
    assert.equal((await reservar(token, 'romeu-e-julieta')).status, 409);
  });

  test('livro_id inválido é 422', async () => {
    const token = await tokenPronto(BEATRIZ);
    for (const corpo of [{}, { livro_id: 'abc' }, { livro_id: 0 }]) {
      assert.equal((await pedir('POST', '/api/v1/reservas', { token, corpo })).status, 422, JSON.stringify(corpo));
    }
  });

  test('cancela a própria reserva ativa, e nada além disso', async () => {
    const token = await tokenPronto(BEATRIZ);
    const { corpo } = await reservar(token, 'dom-quixote');
    const alheia = await pedir('POST', `/api/v1/reservas/${corpo.data.id}/cancelar`, { token: await tokenPronto(RAFAEL) });
    assert.equal(alheia.status, 403);

    const r = await pedir('POST', `/api/v1/reservas/${corpo.data.id}/cancelar`, { token });
    assert.equal(r.status, 200);
    assert.equal(r.corpo.mensagem, 'Reserva cancelada com sucesso.');
    assert.equal(r.corpo.data.status, 'cancelada');
    assert.match(r.corpo.data.encerrada_em, ISO_UTC);
  });

  test('a coordenação pela v1 só mexe na própria reserva', async () => {
    const { corpo } = await reservar(await tokenPronto(BEATRIZ), 'dom-quixote');
    const r = await pedir('POST', `/api/v1/reservas/${corpo.data.id}/cancelar`, { token: await tokenPronto(ADMIN) });
    assert.equal(r.status, 403);
  });

  test('livro retirado não se cancela', async () => {
    const token = await tokenPronto(BEATRIZ);
    const id = await emprestar(token);
    const r = await pedir('POST', `/api/v1/reservas/${id}/cancelar`, { token });
    assert.equal(r.status, 409);
    assert.match(r.corpo.erro, /já retirou este livro/);
  });

  test('renova uma vez, informa o novo prazo e recusa a segunda', async () => {
    const token = await tokenPronto(BEATRIZ);
    const id = await emprestar(token);
    const [antes] = (await pedir('GET', '/api/v1/reservas', { token })).corpo.data;
    assert.equal(antes.pode_renovar, true);
    assert.match(antes.novo_prazo, ISO_UTC);
    assert.match(antes.retirada_em, ISO_UTC);

    const r = await pedir('POST', `/api/v1/reservas/${id}/renovar`, { token });
    assert.equal(r.status, 200);
    assert.equal(r.corpo.mensagem, 'Empréstimo renovado com sucesso.');
    assert.equal(r.corpo.data.renovacoes, 1);
    assert.equal(r.corpo.data.devolver_ate, antes.novo_prazo);
    assert.equal(r.corpo.data.pode_renovar, false);
    assert.equal(r.corpo.data.novo_prazo, null);

    assert.equal((await pedir('POST', `/api/v1/reservas/${id}/renovar`, { token })).status, 409);
  });

  test('atrasada não renova e aparece como atrasada', async () => {
    const token = await tokenPronto(BEATRIZ);
    const id = await emprestar(token);
    db.prepare("UPDATE reservas SET devolver_ate = datetime('now', '-1 day') WHERE id = ?").run(id);
    const [reserva] = (await pedir('GET', '/api/v1/reservas', { token })).corpo.data;
    assert.equal(reserva.atrasada, true);
    assert.equal((await pedir('POST', `/api/v1/reservas/${id}/renovar`, { token })).status, 409);
  });

  test('reserva inexistente é 404 no envelope', async () => {
    const r = await pedir('POST', '/api/v1/reservas/99999/renovar', { token: await tokenPronto(BEATRIZ) });
    assert.equal(r.status, 404);
    assert.deepEqual(r.corpo, { success: false, erro: 'Reserva não encontrada.' });
  });
});

describe('lista Quero ler', () => {
  test('adiciona de forma idempotente, lista como /livros e remove', async () => {
    const token = await tokenPronto(BEATRIZ);
    const caminho = `/api/v1/favoritos/${idDoLivro('dom-quixote')}`;
    for (let i = 0; i < 2; i++) {
      const r = await pedir('PUT', caminho, { token });
      assert.equal(r.status, 200);
      assert.equal(r.corpo.mensagem, 'Livro adicionado à lista.');
    }
    const lista = await pedir('GET', '/api/v1/favoritos', { token });
    assert.equal(lista.corpo.success, true);
    assert.deepEqual(lista.corpo.data, [(await pedir('GET', '/api/v1/livros/dom-quixote')).corpo.data]);

    for (let i = 0; i < 2; i++) {
      const r = await pedir('DELETE', caminho, { token });
      assert.equal(r.status, 200);
      assert.equal(r.corpo.mensagem, 'Livro removido da lista.');
    }
    assert.deepEqual((await pedir('GET', '/api/v1/favoritos', { token })).corpo.data, []);
  });

  test('é a mesma lista do site', async () => {
    const token = await tokenPronto(BEATRIZ);
    const cookie = await entrarPronto(BEATRIZ);
    await pedir('PUT', `/api/v1/favoritos/${idDoLivro('dom-quixote')}`, { token });
    const site = await pedir('GET', '/api/favoritos', { cookie });
    assert.deepEqual(site.corpo.map((l) => l.slug), ['dom-quixote']);
  });

  test('livro inexistente é 404 e id inválido é 422', async () => {
    const token = await tokenPronto(BEATRIZ);
    const nada = await pedir('PUT', '/api/v1/favoritos/99999', { token });
    assert.equal(nada.status, 404);
    assert.deepEqual(nada.corpo, { success: false, erro: 'Livro não encontrado.' });
    assert.equal((await pedir('PUT', '/api/v1/favoritos/abc', { token })).status, 422);
  });
});
