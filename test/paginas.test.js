import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { usarServidor, pedir, BEATRIZ, SENHA_ALUNO } from './helpers/servidor.js';

usarServidor();

const ler = (caminho) => readFileSync(fileURLToPath(new URL(`../${caminho}`, import.meta.url)), 'utf8');

/** As rotas que o código realmente declara, como "GET /api/v1/status". */
const rotasDe = (arquivo) => [...ler(arquivo).matchAll(/^ {2}'((?:GET|POST|PUT|PATCH|DELETE) \/api\/[^']+)':/gm)].map((m) => m[1]);

describe('página 404', () => {
  test('sai com status 404 e no visual do site, em qualquer caminho fora de /api/', async () => {
    for (const caminho of ['/nao-existe.html', '/a/b/c', '/assets/nada.png', '/api']) {
      const r = await pedir('GET', caminho);
      assert.equal(r.status, 404, caminho);
      assert.match(r.cabecalhos.get('content-type'), /text\/html/);
      assert.match(r.corpo, /Página não encontrada/);
      assert.match(r.corpo, /site-footer/);
      assert.match(r.corpo, /class="navbar"/);
    }
  });

  test('funciona em caminho aninhado: os links não dependem da URL', async () => {
    const { corpo } = await pedir('GET', '/a/b/c');
    assert.match(corpo, /<base href="\/">/);
  });

  test('dentro de /api/ continua JSON', async () => {
    const r = await pedir('GET', '/api/nao-existe');
    assert.deepEqual(r.corpo, { erro: 'Rota não encontrada.' });
  });
});

describe('/api/documentacao', () => {
  test('é uma página HTML no estilo do site, entregue antes do roteador de /api/', async () => {
    const r = await pedir('GET', '/api/documentacao');
    assert.equal(r.status, 200);
    assert.match(r.cabecalhos.get('content-type'), /text\/html/);
    assert.match(r.corpo, /css\/style\.css/);
    assert.match(r.corpo, /<base href="\/">/);
  });

  test('documenta todas as rotas da v1', async () => {
    const { corpo } = await pedir('GET', '/api/documentacao');
    const rotas = rotasDe('backend/api-v1.js');
    assert.equal(rotas.length, 24);
    for (const rota of rotas) assert.ok(corpo.includes(`<code>${rota}</code>`), rota);
  });

  test('os links do índice apontam para seções que existem', async () => {
    const { corpo } = await pedir('GET', '/api/documentacao');
    const alvos = [...corpo.matchAll(/href="\/api\/documentacao#([\w-]+)"/g)].map((m) => m[1]);
    assert.ok(alvos.length >= 8);
    for (const alvo of alvos) assert.ok(corpo.includes(`id="${alvo}"`), alvo);
  });

  test('o exemplo de status confere com a resposta real', async () => {
    const { corpo } = await pedir('GET', '/api/documentacao');
    const status = (await pedir('GET', '/api/v1/status')).corpo.data;
    assert.match(corpo, new RegExp(`"aplicacao": "${status.aplicacao}"`));
  });
});

describe('README e docs/', () => {
  test('o README lista todas as rotas da API do site', () => {
    const readme = ler('README.md');
    for (const rota of rotasDe('backend/rotas.js')) {
      const [metodo, caminho] = rota.split(' ');
      assert.ok(readme.includes(`| ${metodo} | \`${caminho}\``), rota);
    }
  });

  test('o README lista os scripts do package.json e as variáveis de ambiente usadas no código', () => {
    const readme = ler('README.md');
    for (const script of Object.keys(JSON.parse(ler('package.json')).scripts)) {
      assert.ok(readme.includes(`npm ${script === 'start' || script === 'test' ? '' : 'run '}${script}`), script);
    }
    const codigo = ['backend/server.js', 'backend/http.js', 'backend/auth.js', 'backend/google.js', 'backend/api-v1.js', 'backend/db/caminho.js']
      .map(ler).join('\n');
    const variaveis = new Set([...codigo.matchAll(/process\.env\.([A-Z_0-9]+)/g)].map((m) => m[1]));
    assert.ok(variaveis.size >= 7);
    for (const variavel of variaveis) assert.ok(readme.includes(`\`${variavel}\``), variavel);
  });

  test('docs/banco-de-dados.md cobre todas as tabelas e migrações', () => {
    const doc = ler('docs/banco-de-dados.md');
    const tabelas = [...ler('backend/db/schema.sql').matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map((m) => m[1]);
    assert.ok(tabelas.length >= 11);
    for (const tabela of tabelas) assert.ok(doc.includes(`\`${tabela}\``), tabela);
    const migracoes = [...ler('backend/db/index.js').matchAll(/^ {2}\/\/ (\d+) — /gm)].map((m) => m[1]);
    assert.ok(migracoes.length >= 11);
    for (const numero of migracoes) assert.ok(doc.includes(`| ${numero} |`), `migração ${numero}`);
  });

  test('docs/api-v1.md e docs/app-expo.md existem com o que prometem', () => {
    assert.match(ler('docs/api-v1.md'), /curl/);
    const expo = ler('docs/app-expo.md');
    assert.match(expo, /HOST=0\.0\.0\.0/);
    assert.match(expo, /networkingMode=mirrored/);
    for (const rota of ['/api/v1/login', '/api/v1/produto', '/api/v1/categoria', '/api/v1/cliente/senha']) {
      assert.ok(expo.includes(rota), rota);
    }
  });

  test('a collection do Postman é v2.1, grava o token no login e não leva token real', () => {
    const collection = JSON.parse(ler('docs/postman/biblioteca-fpsf-v1.postman_collection.json'));
    assert.match(collection.info.schema, /v2\.1\.0/);
    const variaveis = Object.fromEntries(collection.variable.map((v) => [v.key, v.value]));
    assert.ok('base_url' in variaveis);
    assert.equal(variaveis.token, '');

    const requisicoes = [];
    const percorrer = (itens) => itens.forEach((i) => (i.item ? percorrer(i.item) : requisicoes.push(i)));
    percorrer(collection.item);
    const login = requisicoes.find((i) => i.name === 'Login');
    const script = login.event.find((e) => e.listen === 'test').script.exec.join('\n');
    assert.match(script, /collectionVariables\.set\('token'/);

    const emColecao = requisicoes.map((i) => `${i.request.method} ${i.request.url.raw.replace('{{base_url}}', '/api/v1').split('?')[0]}`);
    for (const rota of rotasDe('backend/api-v1.js')) {
      const comExemplo = rota.replace(':id', '1').replace(':slug', 'dom-quixote').replace(':livroId', '3');
      const alternativa = rota.replace(':slug', 'filosofia');
      assert.ok(emColecao.includes(comExemplo) || emColecao.includes(alternativa), rota);
    }
  });
});

describe('IP atrás de proxy reverso', () => {
  const errarLogin = (ip, email) => pedir('POST', '/api/login', {
    corpo: { email, senha: 'errada123' }, cabecalhos: { 'X-Real-IP': ip },
  });

  test('sem CONFIAR_PROXY, o cabeçalho é ignorado: não dá para burlar o limite trocando de IP', async () => {
    for (let i = 0; i < 50; i++) await errarLogin(`10.0.0.${i}`, `a${i}@fpsf.edu.br`);
    const r = await pedir('POST', '/api/login', { corpo: { email: BEATRIZ, senha: SENHA_ALUNO } });
    assert.equal(r.status, 429);
  });

  test('com CONFIAR_PROXY=1, cada cliente real tem a própria contagem', async (t) => {
    process.env.CONFIAR_PROXY = '1';
    t.after(() => { delete process.env.CONFIAR_PROXY; });
    for (let i = 0; i < 50; i++) await errarLogin('10.0.0.1', `a${i}@fpsf.edu.br`);
    const bloqueado = await pedir('POST', '/api/login', {
      corpo: { email: BEATRIZ, senha: SENHA_ALUNO }, cabecalhos: { 'X-Real-IP': '10.0.0.1' },
    });
    assert.equal(bloqueado.status, 429);
    const outroCliente = await pedir('POST', '/api/login', {
      corpo: { email: BEATRIZ, senha: SENHA_ALUNO }, cabecalhos: { 'X-Real-IP': '10.0.0.2' },
    });
    assert.equal(outroCliente.status, 200);
  });
});
