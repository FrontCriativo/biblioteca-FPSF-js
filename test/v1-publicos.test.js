import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { usarServidor, pedir, entrarPronto, reservar, db, ADMIN, BEATRIZ } from './helpers/servidor.js';

usarServidor();

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

describe('status', () => {
  test('responde no envelope, com a data em ISO 8601 UTC', async () => {
    const r = await pedir('GET', '/api/v1/status');
    assert.equal(r.status, 200);
    assert.equal(r.corpo.success, true);
    const { data_hora, ...resto } = r.corpo.data;
    assert.deepEqual(resto, { aplicacao: 'Biblioteca Virtual FPSF', api: 'v1', status: 'online' });
    assert.match(data_hora, ISO_UTC);
  });
});

describe('depoimentos', () => {
  test('só aprovados, mais recentes primeiro, com os nomes do Laravel', async () => {
    const admin = await entrarPronto(ADMIN);
    const ids = [];
    for (const mensagem of ['Primeiro.', 'Segundo.', 'Recusado.']) {
      const { corpo } = await pedir('POST', '/api/depoimentos', { corpo: { nome: 'Ana', turma: '6º ano A', mensagem, nota: 4 } });
      ids.push(corpo.id);
    }
    await pedir('POST', `/api/admin/depoimentos/${ids[2]}/recusar`, { cookie: admin });

    const { corpo } = await pedir('GET', '/api/v1/depoimentos');
    assert.equal(corpo.success, true);
    assert.deepEqual(corpo.data.map((d) => d.id), [ids[1], ids[0]]);
    const { criado_em, ...resto } = corpo.data[0];
    assert.deepEqual(resto, { id: ids[1], nome: 'Ana', descricao_autor: '6º ano A', texto: 'Segundo.', nota: 4 });
    assert.match(criado_em, ISO_UTC);
  });
});

describe('matérias e livros', () => {
  test('matérias com a contagem de livros', async () => {
    const { corpo } = await pedir('GET', '/api/v1/materias');
    assert.equal(corpo.data.length, 10);
    assert.deepEqual(corpo.data.find((m) => m.slug === 'filosofia'), {
      slug: 'filosofia', nome: 'Filosofia', icone: 'filosofia.png', total_livros: 1,
    });
  });

  test('livros de uma matéria e matéria inexistente', async () => {
    const { corpo } = await pedir('GET', '/api/v1/materias/filosofia/livros');
    assert.deepEqual(corpo.data.map((l) => l.slug), ['a-republica']);
    const nada = await pedir('GET', '/api/v1/materias/astrologia/livros');
    assert.equal(nada.status, 404);
    assert.deepEqual(nada.corpo, { success: false, erro: 'Matéria não encontrada.' });
  });

  test('/livros tem o mesmo formato de /api/livros', async () => {
    const v1 = await pedir('GET', '/api/v1/livros');
    const site = await pedir('GET', '/api/livros');
    assert.deepEqual(v1.corpo.data, site.corpo);
  });

  test('a busca continua sem acento e o filtro de matéria vale', async () => {
    const busca = await pedir('GET', '/api/v1/livros?busca=revolucao');
    assert.deepEqual(busca.corpo.data.map((l) => l.slug), ['a-revolucao-dos-bichos']);
    const materia = await pedir('GET', '/api/v1/livros?materia=ciencias');
    assert.deepEqual(materia.corpo.data.map((l) => l.slug), ['a-origem-das-especies']);
  });

  test('detalhe do livro e 404', async () => {
    const r = await pedir('GET', '/api/v1/livros/dom-quixote');
    assert.equal(r.corpo.data.autor, 'Miguel de Cervantes');
    const nada = await pedir('GET', '/api/v1/livros/nao-existe');
    assert.equal(nada.status, 404);
    assert.deepEqual(nada.corpo, { success: false, erro: 'Livro não encontrado.' });
  });

  test('a disponibilidade considera pré-reservas vencidas', async () => {
    const reserva = await reservar(await entrarPronto(BEATRIZ), 'dom-quixote');
    db.prepare("UPDATE reservas SET expira_em = datetime('now', '-1 minute') WHERE id = ?").run(reserva.id);
    assert.equal((await pedir('GET', '/api/v1/livros/dom-quixote')).corpo.data.disponiveis, 2);
  });
});

describe('erros', () => {
  test('rota desconhecida é 404 no envelope, e /api/v1 sozinho também', async () => {
    for (const caminho of ['/api/v1/nao-existe', '/api/v1', '/api/v1/']) {
      const r = await pedir('GET', caminho);
      assert.equal(r.status, 404, caminho);
      assert.deepEqual(r.corpo, { success: false, erro: 'Rota não encontrada.' });
    }
  });

  test('método errado é 405 no envelope, com Allow', async () => {
    const r = await pedir('DELETE', '/api/v1/status');
    assert.equal(r.status, 405);
    assert.deepEqual(r.corpo, { success: false, erro: 'Método não permitido nesta rota.' });
    assert.equal(r.cabecalhos.get('allow'), 'GET');
    const usuario = await pedir('DELETE', '/api/v1/usuario');
    assert.equal(usuario.status, 405);
    assert.equal(usuario.cabecalhos.get('allow'), 'GET, PUT, PATCH');
  });

  test('erro interno é 500 no envelope, sem detalhes', async (t) => {
    const original = console.error;
    console.error = () => {};
    t.after(() => { console.error = original; });
    db.exec('ALTER TABLE depoimentos RENAME TO depoimentos_fora');
    t.after(() => db.exec('ALTER TABLE depoimentos_fora RENAME TO depoimentos'));
    const r = await pedir('GET', '/api/v1/depoimentos');
    assert.equal(r.status, 500);
    assert.deepEqual(r.corpo, { success: false, erro: 'Erro interno do servidor.' });
    assert.equal(r.cabecalhos.get('access-control-allow-origin'), '*');
  });

  test('JSON inválido, escape malformado e corpo grande demais saem no envelope', async () => {
    const json = await pedir('POST', '/api/v1/auth/login', { corpo: '{ quebrado' });
    assert.equal(json.status, 400);
    assert.deepEqual(json.corpo, { success: false, erro: 'JSON inválido.' });
    const escape = await pedir('GET', '/api/v1/livros/%E0%A4%A');
    assert.equal(escape.status, 400);
    assert.equal(escape.corpo.success, false);
    const grande = await pedir('POST', '/api/v1/auth/login', { corpo: { email: 'x'.repeat(1_100_000) } });
    assert.equal(grande.status, 413);
    assert.equal(grande.corpo.success, false);
  });

  test('HEAD funciona nas rotas GET', async () => {
    assert.equal((await pedir('HEAD', '/api/v1/status')).status, 200);
  });
});

describe('CORS', () => {
  test('responde 204 ao preflight, sem gastar o limite', async () => {
    const r = await pedir('OPTIONS', '/api/v1/usuario', {
      cabecalhos: { Origin: 'http://localhost:8081', 'Access-Control-Request-Method': 'PUT' },
    });
    assert.equal(r.status, 204);
    assert.equal(r.corpo, '');
    assert.equal(r.cabecalhos.get('access-control-allow-origin'), '*');
    assert.equal(r.cabecalhos.get('access-control-allow-headers'), 'Authorization, Content-Type, Accept');
    assert.match(r.cabecalhos.get('access-control-allow-methods'), /PATCH/);
    assert.equal(r.cabecalhos.get('access-control-allow-credentials'), null);
  });

  test('vale nas respostas normais e nos erros', async () => {
    assert.equal((await pedir('GET', '/api/v1/status')).cabecalhos.get('access-control-allow-origin'), '*');
    assert.equal((await pedir('GET', '/api/v1/nao-existe')).cabecalhos.get('access-control-allow-origin'), '*');
  });

  test('a API do site não ganha CORS', async () => {
    const r = await pedir('GET', '/api/livros', { cabecalhos: { Origin: 'http://outro.site' } });
    assert.equal(r.cabecalhos.get('access-control-allow-origin'), null);
    const preflight = await pedir('OPTIONS', '/api/livros');
    assert.equal(preflight.status, 404);
    assert.equal(preflight.cabecalhos.get('access-control-allow-origin'), null);
  });
});

describe('limite geral', () => {
  test('a 61ª requisição no minuto é 429 com Retry-After, sem afetar o site', async () => {
    for (let i = 0; i < 60; i++) assert.equal((await pedir('GET', '/api/v1/status')).status, 200);
    const r = await pedir('GET', '/api/v1/status');
    assert.equal(r.status, 429);
    assert.deepEqual(r.corpo, { success: false, erro: 'Muitas tentativas. Aguarde um minuto e tente de novo.' });
    const espera = Number(r.cabecalhos.get('retry-after'));
    assert.ok(espera > 0 && espera <= 60);
    assert.equal(r.cabecalhos.get('access-control-allow-origin'), '*');
    assert.equal((await pedir('GET', '/api/livros')).status, 200);
  });
});

describe('variáveis de ambiente', () => {
  test('V1_LIMITE_POR_MINUTO e CORS_ORIGENS mudam o comportamento', async (t) => {
    const porta = await portaLivre();
    const processo = spawn(process.execPath, ['--no-warnings', 'backend/server.js'], {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      env: {
        ...process.env, DB_PATH: ':memory:', PORT: String(porta),
        V1_LIMITE_POR_MINUTO: '2', CORS_ORIGENS: 'https://app.fpsf.edu.br, https://outro.fpsf.edu.br',
      },
    });
    t.after(() => processo.kill());
    await new Promise((pronto) => processo.stdout.on('data', (d) => String(d).includes('Servidor em') && pronto()));

    const url = `http://127.0.0.1:${porta}/api/v1/status`;
    const liberada = await fetch(url, { headers: { Origin: 'https://outro.fpsf.edu.br' } });
    assert.equal(liberada.headers.get('access-control-allow-origin'), 'https://outro.fpsf.edu.br');
    assert.equal(liberada.headers.get('vary'), 'Origin');
    const recusada = await fetch(url, { headers: { Origin: 'https://invasor.com' } });
    assert.equal(recusada.headers.get('access-control-allow-origin'), null);
    assert.equal((await fetch(url)).status, 429);
  });
});

function portaLivre() {
  return new Promise((pronto) => {
    const s = createServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => pronto(port));
    });
  });
}
