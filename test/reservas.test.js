import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  usarServidor, pedir, entrarPronto, reservar, idDoLivro, db, ADMIN, BEATRIZ, RAFAEL,
} from './helpers/servidor.js';

usarServidor();

const disponiveis = async (slug) => (await pedir('GET', `/api/livros/${slug}`)).corpo.disponiveis;

describe('reserva', () => {
  test('precisa de login', async () => {
    const r = await pedir('POST', '/api/reservas', { corpo: { livro_id: idDoLivro('dom-quixote') } });
    assert.equal(r.status, 401);
    assert.equal(r.corpo.erro, 'Você precisa entrar para fazer isso.');
  });

  test('reserva um exemplar e tira um da disponibilidade', async () => {
    const cookie = await entrarPronto(BEATRIZ);
    const reserva = await reservar(cookie, 'dom-quixote');
    assert.equal(reserva.status, 'ativa');
    assert.equal(reserva.titulo, 'Dom Quixote');
    assert.equal(await disponiveis('dom-quixote'), 1);
    const lista = await pedir('GET', '/api/reservas', { cookie });
    assert.deepEqual(lista.corpo.map((r) => r.id), [reserva.id]);
  });

  test('não reserva duas vezes o mesmo livro', async () => {
    const cookie = await entrarPronto(BEATRIZ);
    await reservar(cookie, 'dom-quixote');
    const r = await pedir('POST', '/api/reservas', { cookie, corpo: { livro_id: idDoLivro('dom-quixote') } });
    assert.equal(r.status, 409);
    assert.equal(r.corpo.erro, 'Você já tem uma reserva ativa deste livro.');
  });

  test('aluno tem limite de 3 reservas simultâneas; a coordenação não', async () => {
    const aluno = await entrarPronto(BEATRIZ);
    for (const slug of ['dom-quixote', 'vidas-secas', 'a-republica']) await reservar(aluno, slug);
    const r = await pedir('POST', '/api/reservas', { cookie: aluno, corpo: { livro_id: idDoLivro('romeu-e-julieta') } });
    assert.equal(r.status, 409);
    assert.match(r.corpo.erro, /já tem 3 livros/);

    const admin = await entrarPronto(ADMIN);
    for (const slug of ['dom-quixote', 'vidas-secas', 'a-republica', 'romeu-e-julieta']) await reservar(admin, slug);
  });

  test('sem exemplar livre é 409', async () => {
    const beatriz = await entrarPronto(BEATRIZ);
    const rafael = await entrarPronto(RAFAEL);
    const admin = await entrarPronto(ADMIN);
    await reservar(beatriz, 'dom-quixote');
    await reservar(rafael, 'dom-quixote');
    const r = await pedir('POST', '/api/reservas', { cookie: admin, corpo: { livro_id: idDoLivro('dom-quixote') } });
    assert.equal(r.status, 409);
    assert.equal(r.corpo.erro, 'Não há exemplares disponíveis no momento.');
  });

  test('pré-reserva vencida expira na requisição seguinte e libera o exemplar', async () => {
    const cookie = await entrarPronto(BEATRIZ);
    const reserva = await reservar(cookie, 'dom-quixote');
    db.prepare("UPDATE reservas SET expira_em = datetime('now', '-1 minute') WHERE id = ?").run(reserva.id);
    assert.equal(await disponiveis('dom-quixote'), 2);
    const [expirada] = (await pedir('GET', '/api/reservas', { cookie })).corpo;
    assert.equal(expirada.status, 'cancelada');
  });
});

describe('cancelamento', () => {
  test('aluno cancela a própria reserva ativa', async () => {
    const cookie = await entrarPronto(BEATRIZ);
    const reserva = await reservar(cookie, 'dom-quixote');
    const r = await pedir('POST', `/api/reservas/${reserva.id}/cancelar`, { cookie });
    assert.equal(r.status, 200);
    assert.equal(r.corpo.status, 'cancelada');
    assert.equal(await disponiveis('dom-quixote'), 2);
  });

  test('aluno não cancela reserva de outro', async () => {
    const reserva = await reservar(await entrarPronto(BEATRIZ), 'dom-quixote');
    const r = await pedir('POST', `/api/reservas/${reserva.id}/cancelar`, { cookie: await entrarPronto(RAFAEL) });
    assert.equal(r.status, 403);
    assert.equal(r.corpo.erro, 'Esta reserva não é sua.');
  });

  test('aluno não cancela livro já retirado; a coordenação cancela', async () => {
    const aluno = await entrarPronto(BEATRIZ);
    const admin = await entrarPronto(ADMIN);
    const reserva = await reservar(aluno, 'dom-quixote');
    await pedir('POST', `/api/admin/reservas/${reserva.id}/retirar`, { cookie: admin });

    const r = await pedir('POST', `/api/reservas/${reserva.id}/cancelar`, { cookie: aluno });
    assert.equal(r.status, 409);
    assert.match(r.corpo.erro, /já retirou este livro/);

    const pelaCoordenacao = await pedir('POST', `/api/reservas/${reserva.id}/cancelar`, { cookie: admin });
    assert.equal(pelaCoordenacao.status, 200);
    assert.equal(pelaCoordenacao.corpo.status, 'cancelada');
  });

  test('reserva inexistente é 404', async () => {
    const r = await pedir('POST', '/api/reservas/99999/cancelar', { cookie: await entrarPronto(ADMIN) });
    assert.equal(r.status, 404);
    assert.equal(r.corpo.erro, 'Reserva não encontrada.');
  });
});

describe('retirada, devolução e atrasadas', () => {
  test('retirar grava o prazo de 14 dias; devolver libera o exemplar', async () => {
    const aluno = await entrarPronto(BEATRIZ);
    const admin = await entrarPronto(ADMIN);
    const reserva = await reservar(aluno, 'dom-quixote');

    const retirada = await pedir('POST', `/api/admin/reservas/${reserva.id}/retirar`, { cookie: admin });
    assert.equal(retirada.corpo.status, 'retirada');
    const dias = (new Date(`${retirada.corpo.devolver_ate.replace(' ', 'T')}Z`) - Date.now()) / 86_400_000;
    assert.ok(dias > 13.9 && dias <= 14);
    assert.equal(await disponiveis('dom-quixote'), 1);

    const devolvida = await pedir('POST', `/api/admin/reservas/${reserva.id}/devolver`, { cookie: admin });
    assert.equal(devolvida.corpo.status, 'devolvida');
    assert.ok(devolvida.corpo.encerrada_em);
    assert.equal(await disponiveis('dom-quixote'), 2);
  });

  test('transição inválida é 409', async () => {
    const reserva = await reservar(await entrarPronto(BEATRIZ), 'dom-quixote');
    const r = await pedir('POST', `/api/admin/reservas/${reserva.id}/devolver`, { cookie: await entrarPronto(ADMIN) });
    assert.equal(r.status, 409);
  });

  test('prazo vencido aparece em atrasadas, na lista e no resumo', async () => {
    const aluno = await entrarPronto(BEATRIZ);
    const admin = await entrarPronto(ADMIN);
    const reserva = await reservar(aluno, 'dom-quixote');
    await pedir('POST', `/api/admin/reservas/${reserva.id}/retirar`, { cookie: admin });
    assert.deepEqual((await pedir('GET', '/api/admin/reservas?status=atrasadas', { cookie: admin })).corpo, []);

    db.prepare("UPDATE reservas SET devolver_ate = datetime('now', '-1 day') WHERE id = ?").run(reserva.id);
    const atrasadas = await pedir('GET', '/api/admin/reservas?status=atrasadas', { cookie: admin });
    assert.deepEqual(atrasadas.corpo.map((r) => r.id), [reserva.id]);
    assert.equal(atrasadas.corpo[0].atrasada, 1);
    assert.equal((await pedir('GET', '/api/admin/resumo', { cookie: admin })).corpo.atrasadas, 1);
    assert.equal((await pedir('GET', '/api/reservas', { cookie: aluno })).corpo[0].atrasada, 1);
  });

  test('o resumo conta o acervo, as reservas e os alunos', async () => {
    const admin = await entrarPronto(ADMIN);
    await reservar(await entrarPronto(BEATRIZ), 'dom-quixote');
    const { corpo } = await pedir('GET', '/api/admin/resumo', { cookie: admin });
    assert.equal(corpo.livros, 8);
    assert.equal(corpo.exemplares, 23);
    assert.equal(corpo.reservas_ativas, 1);
    assert.equal(corpo.retiradas, 0);
    assert.equal(corpo.usuarios, 2);
  });
});
