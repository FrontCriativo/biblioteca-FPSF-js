import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer, request } from 'node:http';
import { connect } from 'node:net';
import { fileURLToPath } from 'node:url';
import { usarServidor, pedir, portaDoServidor } from './helpers/servidor.js';

usarServidor();

const RAIZ = fileURLToPath(new URL('..', import.meta.url));

test('entrega os arquivos do front-end', async () => {
  const pagina = await pedir('GET', '/');
  assert.equal(pagina.status, 200);
  assert.match(pagina.cabecalhos.get('content-type'), /text\/html/);
  const css = await pedir('GET', '/css/style.css');
  assert.match(css.cabecalhos.get('content-type'), /text\/css/);
});

test('não sai da pasta frontend/ por path traversal', async () => {
  // fetch normaliza "..": o caminho precisa ir cru, como um cliente malicioso mandaria.
  const caminhos = [
    '/../backend/db/schema.sql',
    '/..%2f..%2fbackend%2fdb%2fschema.sql',
    '/%2e%2e/%2e%2e/package.json',
    '/..\\backend\\auth.js',
  ];
  for (const caminho of caminhos) {
    const { status, texto } = await pedirCru(portaDoServidor(), caminho);
    assert.notEqual(status, 200, caminho);
    assert.doesNotMatch(texto, /CREATE TABLE|"scripts"|scryptSync/, caminho);
  }
});

test('escape de URL malformado não derruba nada', async () => {
  assert.equal((await pedir('GET', '/%E0%A4%A')).status, 400);
  assert.equal((await pedir('GET', '/api/livros/%E0%A4%A')).status, 400);
});

test('rota desconhecida da API é 404 em JSON', async () => {
  const r = await pedir('GET', '/api/nao-existe');
  assert.equal(r.status, 404);
  assert.deepEqual(r.corpo, { erro: 'Rota não encontrada.' });
});

test('JSON inválido é 400', async () => {
  const r = await pedir('POST', '/api/login', { corpo: '{ quebrado' });
  assert.equal(r.status, 400);
  assert.deepEqual(r.corpo, { erro: 'JSON inválido.' });
});

test('corpo grande demais é 413', async () => {
  const r = await pedir('POST', '/api/login', { corpo: { email: 'x'.repeat(1_100_000), senha: 'y' } });
  assert.equal(r.status, 413);
});

test('depois de um 413 a mesma conexão continua atendendo', async (t) => {
  // Socket cru para controlar o tempo: o fim do corpo só chega depois de o servidor já ter
  // passado do limite, e a requisição seguinte vai na mesma conexão, como faz o keep-alive.
  const socket = connect(portaDoServidor(), '127.0.0.1');
  t.after(() => socket.destroy());
  socket.setEncoding('utf8');
  let recebido = '';
  socket.on('data', (d) => { recebido += d; });

  const tamanho = 1_100_000;
  socket.write(`POST /api/login HTTP/1.1\r\nHost: x\r\nContent-Length: ${tamanho}\r\n\r\n`);
  socket.write('x'.repeat(tamanho - 1000));
  await new Promise((pronto) => setTimeout(pronto, 150));
  socket.write('x'.repeat(1000));
  socket.write('GET /api/materias HTTP/1.1\r\nHost: x\r\n\r\n');

  const limite = Date.now() + 2000;
  while (!recebido.includes('literatura') && Date.now() < limite) {
    await new Promise((pronto) => setTimeout(pronto, 20));
  }
  assert.match(recebido, /^HTTP\/1\.1 413/);
  assert.match(recebido, /HTTP\/1\.1 200[\s\S]*literatura/, 'a requisição seguinte ficou presa na conexão');
});

test('cookie malformado vale como sem sessão', async () => {
  const r = await pedir('GET', '/api/eu', { cookie: 'sessao=%E0%A4%A' });
  assert.equal(r.status, 200);
  assert.equal(r.corpo, null);
});

test('em produção o cookie sai com Secure', () => {
  const { stdout } = spawnSync(process.execPath, [
    '--no-warnings', '--input-type=module', '-e',
    "const { cabecalhoCookieSessao } = await import('./backend/auth.js'); console.log(cabecalhoCookieSessao('abc'));",
  ], { cwd: RAIZ, env: { ...process.env, DB_PATH: ':memory:', NODE_ENV: 'production' }, encoding: 'utf8' });
  assert.match(stdout, /HttpOnly; SameSite=Strict.*; Secure/);
});

test('`node backend/server.js` escuta na porta informada', async () => {
  const porta = await portaLivre();
  const processo = spawn(process.execPath, ['--no-warnings', 'backend/server.js'], {
    cwd: RAIZ, env: { ...process.env, DB_PATH: ':memory:', PORT: String(porta) },
  });
  try {
    await new Promise((pronto, falhou) => {
      processo.stdout.on('data', (d) => String(d).includes('Servidor em') && pronto());
      processo.on('exit', (codigo) => falhou(new Error(`Servidor saiu com ${codigo}`)));
    });
    const resposta = await fetch(`http://127.0.0.1:${porta}/api/materias`);
    assert.equal(resposta.status, 200);
  } finally {
    processo.removeAllListeners('exit');
    processo.kill();
  }
});

function pedirCru(port, path) {
  return new Promise((pronto, falhou) => {
    const req = request({ host: '127.0.0.1', port, path, method: 'GET' }, (res) => {
      let texto = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { texto += d; });
      res.on('end', () => pronto({ status: res.statusCode, texto }));
    });
    req.on('error', falhou);
    req.end();
  });
}

function portaLivre() {
  return new Promise((pronto) => {
    const s = createServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => pronto(port));
    });
  });
}
