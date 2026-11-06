import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { usarServidor, pedir, entrarPronto, db, idDoUsuario, ADMIN, BEATRIZ } from './helpers/servidor.js';

usarServidor();

const MENSAGEM = { nome: 'Ana', assunto: 'Sugestão de livro', mensagem: 'Comprem mais Machado de Assis.' };

const enviar = async (extra = {}, cookie) =>
  (await pedir('POST', '/api/contato', { cookie, corpo: { ...MENSAGEM, ...extra } })).corpo.id;

describe('envio', () => {
  test('é público e entra como nova', async () => {
    const r = await pedir('POST', '/api/contato', { corpo: { ...MENSAGEM, turma: '6º ano A', email: 'ana@email.com' } });
    assert.equal(r.status, 201);
    assert.equal(r.corpo.status, 'nova');
    const salva = db.prepare('SELECT * FROM mensagens_contato WHERE id = ?').get(r.corpo.id);
    assert.equal(salva.nome, 'Ana');
    assert.equal(salva.turma, '6º ano A');
    assert.equal(salva.usuario_id, null);
  });

  test('turma e e-mail são opcionais, mesmo em branco (é o que o formulário manda)', async () => {
    const r = await pedir('POST', '/api/contato', { corpo: { ...MENSAGEM, turma: '', email: '   ' } });
    assert.equal(r.status, 201);
    const salva = db.prepare('SELECT * FROM mensagens_contato WHERE id = ?').get(r.corpo.id);
    assert.equal(salva.turma, null);
    assert.equal(salva.email, null);
  });

  test('quem está logado fica ligado à mensagem', async () => {
    const id = await enviar({}, await entrarPronto(BEATRIZ));
    assert.equal(db.prepare('SELECT usuario_id FROM mensagens_contato WHERE id = ?').get(id).usuario_id, idDoUsuario(BEATRIZ));
  });

  const recusados = [
    ['sem nome', { nome: '' }, /"nome"/],
    ['nome acima de 80', { nome: 'x'.repeat(81) }, /"nome".*80/],
    ['turma acima de 40', { turma: 'x'.repeat(41) }, /"turma".*40/],
    ['e-mail mal formado', { email: 'ana' }, /e-mail válido/],
    ['e-mail acima de 120', { email: `${'x'.repeat(120)}@a.br` }, /"email".*120/],
    ['assunto fora da lista', { assunto: 'Reclamação' }, /assunto da lista/],
    ['sem assunto', { assunto: '' }, /"assunto"/],
    ['sem mensagem', { mensagem: '   ' }, /"mensagem"/],
    ['mensagem acima de 2000', { mensagem: 'x'.repeat(2001) }, /"mensagem".*2000/],
  ];

  for (const [nome, campos, mensagem] of recusados) {
    test(`recusa ${nome}`, async () => {
      const r = await pedir('POST', '/api/contato', { corpo: { ...MENSAGEM, ...campos } });
      assert.equal(r.status, 400);
      assert.match(r.corpo.erro, mensagem);
    });
  }

  test('os quatro assuntos do formulário são aceitos', async () => {
    for (const assunto of ['Sugestão de livro', 'Dúvida sobre empréstimo', 'Problema de acesso', 'Outro assunto']) {
      assert.equal((await pedir('POST', '/api/contato', { corpo: { ...MENSAGEM, assunto } })).status, 201, assunto);
    }
  });

  test('mais de 20 por hora do mesmo IP é 429, sem gastar o limite dos depoimentos', async () => {
    for (let i = 0; i < 20; i++) assert.equal((await pedir('POST', '/api/contato', { corpo: MENSAGEM })).status, 201);
    const r = await pedir('POST', '/api/contato', { corpo: MENSAGEM });
    assert.equal(r.status, 429);
    assert.equal(r.corpo.erro, 'Muitas mensagens enviadas daqui. Tente de novo mais tarde.');
    const depoimento = await pedir('POST', '/api/depoimentos', { corpo: { nome: 'Ana', turma: '6º', mensagem: 'Boa.', nota: 5 } });
    assert.equal(depoimento.status, 201);
  });

  test('envio recusado na validação não gasta o limite', async () => {
    for (let i = 0; i < 25; i++) await pedir('POST', '/api/contato', { corpo: { ...MENSAGEM, nome: '' } });
    assert.equal((await pedir('POST', '/api/contato', { corpo: MENSAGEM })).status, 201);
  });
});

describe('painel', () => {
  test('é só para a coordenação', async () => {
    const id = await enviar();
    const aluno = await entrarPronto(BEATRIZ);
    assert.equal((await pedir('GET', '/api/admin/mensagens')).status, 401);
    assert.equal((await pedir('GET', '/api/admin/mensagens', { cookie: aluno })).status, 403);
    const r = await pedir('POST', `/api/admin/mensagens/${id}/status`, { cookie: aluno, corpo: { status: 'lida' } });
    assert.equal(r.status, 403);
  });

  test('lista com as novas primeiro e filtra por status', async () => {
    const admin = await entrarPronto(ADMIN);
    const lida = await enviar();
    const nova = await enviar();
    await pedir('POST', `/api/admin/mensagens/${lida}/status`, { cookie: admin, corpo: { status: 'lida' } });
    const ids = async (sufixo = '') => (await pedir('GET', `/api/admin/mensagens${sufixo}`, { cookie: admin })).corpo.map((m) => m.id);
    assert.deepEqual(await ids(), [nova, lida]);
    assert.deepEqual(await ids('?status=nova'), [nova]);
    assert.deepEqual(await ids('?status=lida'), [lida]);
    assert.deepEqual(await ids('?status=respondida'), []);
    assert.deepEqual(await ids('?status=qualquer'), [nova, lida]);
  });

  test('a lista traz o e-mail da conta de quem escreveu logado', async () => {
    const admin = await entrarPronto(ADMIN);
    await enviar({}, await entrarPronto(BEATRIZ));
    const [mensagem] = (await pedir('GET', '/api/admin/mensagens', { cookie: admin })).corpo;
    assert.equal(mensagem.email, null);
    assert.equal(mensagem.usuario_email, BEATRIZ);
  });

  test('muda o status e registra quando', async () => {
    const admin = await entrarPronto(ADMIN);
    const id = await enviar();
    db.prepare("UPDATE mensagens_contato SET atualizada_em = '2020-01-01 00:00:00' WHERE id = ?").run(id);
    const r = await pedir('POST', `/api/admin/mensagens/${id}/status`, { cookie: admin, corpo: { status: 'respondida' } });
    assert.equal(r.status, 200);
    assert.deepEqual(r.corpo, { id, status: 'respondida' });
    const { atualizada_em } = db.prepare('SELECT atualizada_em FROM mensagens_contato WHERE id = ?').get(id);
    assert.notEqual(atualizada_em, '2020-01-01 00:00:00');
  });

  test('status inválido é 400 e mensagem inexistente é 404', async () => {
    const admin = await entrarPronto(ADMIN);
    const id = await enviar();
    assert.equal((await pedir('POST', `/api/admin/mensagens/${id}/status`, { cookie: admin, corpo: { status: 'apagada' } })).status, 400);
    assert.equal((await pedir('POST', `/api/admin/mensagens/${id}/status`, { cookie: admin, corpo: {} })).status, 400);
    const r = await pedir('POST', '/api/admin/mensagens/99999/status', { cookie: admin, corpo: { status: 'lida' } });
    assert.equal(r.status, 404);
    assert.equal(r.corpo.erro, 'Mensagem não encontrada.');
  });

  test('o resumo conta mensagens novas e depoimentos pendentes', async () => {
    const admin = await entrarPronto(ADMIN);
    const id = await enviar();
    await enviar();
    await pedir('POST', '/api/depoimentos', { corpo: { nome: 'Ana', turma: '6º', mensagem: 'Boa.', nota: 5 } });
    await pedir('POST', `/api/admin/mensagens/${id}/status`, { cookie: admin, corpo: { status: 'lida' } });
    const { corpo } = await pedir('GET', '/api/admin/resumo', { cookie: admin });
    assert.equal(corpo.mensagens_novas, 1);
    assert.equal(corpo.depoimentos_pendentes, 1);
  });
});
