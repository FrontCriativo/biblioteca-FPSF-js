import { test } from 'node:test';
import assert from 'node:assert/strict';
import { usarServidor, pedir, entrarPronto, db, ADMIN, BEATRIZ } from './helpers/servidor.js';

usarServidor();

const DEPOIMENTO = { nome: 'Ana', turma: '6º ano A', mensagem: 'A biblioteca é ótima.', nota: 5 };

const enviar = async (cookie) => (await pedir('POST', '/api/depoimentos', { cookie, corpo: DEPOIMENTO })).corpo.id;

test('qualquer pessoa envia e o depoimento entra como pendente', async () => {
  const r = await pedir('POST', '/api/depoimentos', { corpo: DEPOIMENTO });
  assert.equal(r.status, 201);
  assert.equal(r.corpo.status, 'pendente');
  assert.deepEqual((await pedir('GET', '/api/depoimentos')).corpo, []);
});

test('quem está logado fica ligado ao depoimento', async () => {
  const id = await enviar(await entrarPronto(BEATRIZ));
  const { usuario_id } = db.prepare('SELECT usuario_id FROM depoimentos WHERE id = ?').get(id);
  assert.ok(usuario_id);
});

test('valida campos, tamanho e nota', async () => {
  assert.equal((await pedir('POST', '/api/depoimentos', { corpo: { ...DEPOIMENTO, nome: '' } })).status, 400);
  assert.equal((await pedir('POST', '/api/depoimentos', { corpo: { ...DEPOIMENTO, mensagem: 'x'.repeat(1001) } })).status, 400);
  const nota = await pedir('POST', '/api/depoimentos', { corpo: { ...DEPOIMENTO, nota: 6 } });
  assert.equal(nota.status, 400);
  assert.equal(nota.corpo.erro, 'A nota deve ser um número de 1 a 5.');
});

test('o público só vê os aprovados, sem dados de moderação', async () => {
  const admin = await entrarPronto(ADMIN);
  const aprovado = await enviar();
  const recusado = await enviar();
  await enviar();
  await pedir('POST', `/api/admin/depoimentos/${aprovado}/aprovar`, { cookie: admin });
  await pedir('POST', `/api/admin/depoimentos/${recusado}/recusar`, { cookie: admin });

  const { corpo } = await pedir('GET', '/api/depoimentos');
  assert.deepEqual(corpo.map((d) => d.id), [aprovado]);
  assert.deepEqual(Object.keys(corpo[0]).sort(), ['criado_em', 'id', 'mensagem', 'nome', 'nota', 'turma']);
});

test('a moderação filtra por status e traz os pendentes primeiro', async () => {
  const admin = await entrarPronto(ADMIN);
  const aprovado = await enviar();
  const pendente = await enviar();
  await pedir('POST', `/api/admin/depoimentos/${aprovado}/aprovar`, { cookie: admin });

  const todos = await pedir('GET', '/api/admin/depoimentos', { cookie: admin });
  assert.deepEqual(todos.corpo.map((d) => d.id), [pendente, aprovado]);
  const pendentes = await pedir('GET', '/api/admin/depoimentos?status=pendente', { cookie: admin });
  assert.deepEqual(pendentes.corpo.map((d) => d.id), [pendente]);
});

test('moderar é só para a coordenação; depoimento inexistente é 404', async () => {
  const id = await enviar();
  const aluno = await pedir('POST', `/api/admin/depoimentos/${id}/aprovar`, { cookie: await entrarPronto(BEATRIZ) });
  assert.equal(aluno.status, 403);
  const nada = await pedir('POST', '/api/admin/depoimentos/99999/aprovar', { cookie: await entrarPronto(ADMIN) });
  assert.equal(nada.status, 404);
});

test('mais de 20 envios por hora do mesmo IP é 429', async () => {
  for (let i = 0; i < 20; i++) assert.equal((await pedir('POST', '/api/depoimentos', { corpo: DEPOIMENTO })).status, 201);
  const r = await pedir('POST', '/api/depoimentos', { corpo: DEPOIMENTO });
  assert.equal(r.status, 429);
  assert.equal(r.corpo.erro, 'Muitos depoimentos enviados daqui. Tente de novo mais tarde.');
});
