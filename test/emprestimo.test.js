import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  usarServidor, pedir, entrarPronto, reservar, db, ADMIN, BEATRIZ, RAFAEL,
} from './helpers/servidor.js';

usarServidor();

const DIA = 86_400_000;
const data = (texto) => new Date(`${texto.replace(' ', 'T')}Z`).getTime();

async function emprestar(aluno, admin, slug = 'dom-quixote') {
  const reserva = await reservar(aluno, slug);
  return (await pedir('POST', `/api/admin/reservas/${reserva.id}/retirar`, { cookie: admin })).corpo;
}

const atrasar = (id) => db.prepare("UPDATE reservas SET devolver_ate = datetime('now', '-1 day') WHERE id = ?").run(id);

describe('retirada', () => {
  test('grava retirada_em e começa com zero renovações', async () => {
    const r = await emprestar(await entrarPronto(BEATRIZ), await entrarPronto(ADMIN));
    assert.ok(Math.abs(data(r.retirada_em) - Date.now()) < 5000);
    assert.equal(r.renovacoes, 0);
  });
});

describe('renovação pelo aluno', () => {
  test('soma 7 dias ao prazo atual, não a hoje', async () => {
    const aluno = await entrarPronto(BEATRIZ);
    const emprestimo = await emprestar(aluno, await entrarPronto(ADMIN));
    const r = await pedir('POST', `/api/reservas/${emprestimo.id}/renovar`, { cookie: aluno });
    assert.equal(r.status, 200);
    assert.equal(r.corpo.renovacoes, 1);
    assert.equal(data(r.corpo.devolver_ate) - data(emprestimo.devolver_ate), 7 * DIA);
  });

  test('a lista avisa se pode renovar e até quando iria o prazo', async () => {
    const aluno = await entrarPronto(BEATRIZ);
    const emprestimo = await emprestar(aluno, await entrarPronto(ADMIN));
    const [antes] = (await pedir('GET', '/api/reservas', { cookie: aluno })).corpo;
    assert.equal(antes.pode_renovar, 1);
    assert.equal(data(antes.novo_prazo) - data(antes.devolver_ate), 7 * DIA);
    const renovada = await pedir('POST', `/api/reservas/${emprestimo.id}/renovar`, { cookie: aluno });
    assert.equal(renovada.corpo.devolver_ate, antes.novo_prazo);
    const [depois] = (await pedir('GET', '/api/reservas', { cookie: aluno })).corpo;
    assert.equal(depois.pode_renovar, 0);
    assert.equal(depois.novo_prazo, null);
  });

  test('reserva ainda não retirada não renova', async () => {
    const aluno = await entrarPronto(BEATRIZ);
    const reserva = await reservar(aluno, 'dom-quixote');
    assert.equal(reserva.pode_renovar, 0);
    const r = await pedir('POST', `/api/reservas/${reserva.id}/renovar`, { cookie: aluno });
    assert.equal(r.status, 409);
    assert.equal(r.corpo.erro, 'Só é possível renovar um livro que está com o leitor.');
  });

  test('só uma vez por empréstimo', async () => {
    const aluno = await entrarPronto(BEATRIZ);
    const { id } = await emprestar(aluno, await entrarPronto(ADMIN));
    await pedir('POST', `/api/reservas/${id}/renovar`, { cookie: aluno });
    const r = await pedir('POST', `/api/reservas/${id}/renovar`, { cookie: aluno });
    assert.equal(r.status, 409);
    assert.equal(r.corpo.erro, 'Este empréstimo já foi renovado. Procure a biblioteca.');
  });

  test('atrasada não renova', async () => {
    const aluno = await entrarPronto(BEATRIZ);
    const { id } = await emprestar(aluno, await entrarPronto(ADMIN));
    atrasar(id);
    assert.equal((await pedir('GET', '/api/reservas', { cookie: aluno })).corpo[0].pode_renovar, 0);
    const r = await pedir('POST', `/api/reservas/${id}/renovar`, { cookie: aluno });
    assert.equal(r.status, 409);
    assert.match(r.corpo.erro, /atrasado/);
  });

  test('só a própria reserva', async () => {
    const { id } = await emprestar(await entrarPronto(BEATRIZ), await entrarPronto(ADMIN));
    const r = await pedir('POST', `/api/reservas/${id}/renovar`, { cookie: await entrarPronto(RAFAEL) });
    assert.equal(r.status, 403);
    assert.equal(r.corpo.erro, 'Esta reserva não é sua.');
  });

  test('empréstimo antigo sem prazo conta a partir de agora', async () => {
    const aluno = await entrarPronto(BEATRIZ);
    const { id } = await emprestar(aluno, await entrarPronto(ADMIN));
    db.prepare('UPDATE reservas SET devolver_ate = NULL WHERE id = ?').run(id);
    const [lista] = (await pedir('GET', '/api/reservas', { cookie: aluno })).corpo;
    assert.equal(lista.pode_renovar, 1);
    const r = await pedir('POST', `/api/reservas/${id}/renovar`, { cookie: aluno });
    assert.equal(r.status, 200);
    const dias = (data(r.corpo.devolver_ate) - Date.now()) / DIA;
    assert.ok(dias > 6.9 && dias <= 7);
  });

  test('reserva inexistente é 404 e sem login é 401', async () => {
    assert.equal((await pedir('POST', '/api/reservas/99999/renovar', { cookie: await entrarPronto(BEATRIZ) })).status, 404);
    assert.equal((await pedir('POST', '/api/reservas/1/renovar')).status, 401);
  });
});

describe('renovação pela coordenação', () => {
  test('não tem limite de vezes e aceita atrasada', async () => {
    const admin = await entrarPronto(ADMIN);
    const emprestimo = await emprestar(await entrarPronto(BEATRIZ), admin);
    for (let vez = 1; vez <= 3; vez++) {
      const r = await pedir('POST', `/api/admin/reservas/${emprestimo.id}/renovar`, { cookie: admin });
      assert.equal(r.status, 200);
      assert.equal(r.corpo.renovacoes, vez);
    }
    atrasar(emprestimo.id);
    assert.equal((await pedir('POST', `/api/admin/reservas/${emprestimo.id}/renovar`, { cookie: admin })).status, 200);
  });

  test('também só vale para livro retirado, e aluno não usa essa rota', async () => {
    const admin = await entrarPronto(ADMIN);
    const aluno = await entrarPronto(BEATRIZ);
    const reserva = await reservar(aluno, 'dom-quixote');
    assert.equal((await pedir('POST', `/api/admin/reservas/${reserva.id}/renovar`, { cookie: admin })).status, 409);
    assert.equal((await pedir('POST', `/api/admin/reservas/${reserva.id}/renovar`, { cookie: aluno })).status, 403);
  });
});

describe('observação', () => {
  const salvar = (cookie, id, observacao) =>
    pedir('PUT', `/api/admin/reservas/${id}/observacao`, { cookie, corpo: { observacao } });

  test('a coordenação grava, troca e apaga com texto vazio', async () => {
    const admin = await entrarPronto(ADMIN);
    const { id } = await reservar(await entrarPronto(BEATRIZ), 'dom-quixote');
    const gravada = await salvar(admin, id, '  capa rasgada ');
    assert.equal(gravada.status, 200);
    assert.equal(gravada.corpo.observacao, 'capa rasgada');
    const lista = await pedir('GET', '/api/admin/reservas?status=ativa', { cookie: admin });
    assert.equal(lista.corpo[0].observacao, 'capa rasgada');
    assert.equal((await salvar(admin, id, '')).corpo.observacao, null);
  });

  test('valida tamanho, presença do campo e reserva', async () => {
    const admin = await entrarPronto(ADMIN);
    const { id } = await reservar(await entrarPronto(BEATRIZ), 'dom-quixote');
    assert.equal((await salvar(admin, id, 'x'.repeat(500))).status, 200);
    assert.equal((await salvar(admin, id, 'x'.repeat(501))).status, 400);
    assert.equal((await pedir('PUT', `/api/admin/reservas/${id}/observacao`, { cookie: admin, corpo: {} })).status, 400);
    assert.equal((await salvar(admin, 99999, 'x')).status, 404);
  });

  test('nunca aparece para o aluno, em nenhuma resposta', async () => {
    const admin = await entrarPronto(ADMIN);
    const aluno = await entrarPronto(BEATRIZ);
    const { id } = await emprestar(aluno, admin);
    await salvar(admin, id, 'SEGREDO');
    assert.equal((await pedir('PUT', `/api/admin/reservas/${id}/observacao`, { cookie: aluno, corpo: { observacao: 'x' } })).status, 403);

    const respostas = [
      await pedir('GET', '/api/reservas', { cookie: aluno }),
      await pedir('POST', `/api/reservas/${id}/renovar`, { cookie: aluno }),
      await pedir('POST', `/api/reservas/${id}/cancelar`, { cookie: aluno }), // 409: já retirado
    ];
    const outra = await reservar(aluno, 'vidas-secas');
    await salvar(admin, outra.id, 'SEGREDO');
    respostas.push(await pedir('POST', `/api/reservas/${outra.id}/cancelar`, { cookie: aluno }));
    for (const r of respostas) assert.doesNotMatch(JSON.stringify(r.corpo), /SEGREDO|observacao/);
  });

  test('as rotas da coordenação devolvem a observação', async () => {
    const admin = await entrarPronto(ADMIN);
    const { id } = await reservar(await entrarPronto(BEATRIZ), 'dom-quixote');
    await salvar(admin, id, 'nota');
    const retirada = await pedir('POST', `/api/admin/reservas/${id}/retirar`, { cookie: admin });
    assert.equal(retirada.corpo.observacao, 'nota');
    const renovada = await pedir('POST', `/api/admin/reservas/${id}/renovar`, { cookie: admin });
    assert.equal(renovada.corpo.observacao, 'nota');
  });
});
