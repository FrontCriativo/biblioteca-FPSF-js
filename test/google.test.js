import { test, describe, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { usarServidor, pedir, db, idDoUsuario, BEATRIZ } from './helpers/servidor.js';

usarServidor();

const CLIENT_ID = 'cliente-de-teste';
const ALUNA = '00001111111111sp@al.educacao.sp.gov.br';
const ALUNO = '00002222222222sp@aluno.educacao.sp.gov.br';
const fetchReal = globalThis.fetch;

let pedidosAoGoogle;

const idToken = (dados) => `cabecalho.${Buffer.from(JSON.stringify(dados)).toString('base64url')}.assinatura`;

const dadosValidos = (extras = {}) => ({
  iss: 'https://accounts.google.com',
  aud: CLIENT_ID,
  exp: Math.floor(Date.now() / 1000) + 3600,
  email: ALUNA,
  email_verified: true,
  ...extras,
});

/** Só o endereço do Google é falso: as chamadas ao servidor de teste passam direto. */
function googleResponde(responder) {
  mock.method(globalThis, 'fetch', async (url, opcoes) => {
    if (String(url) !== 'https://oauth2.googleapis.com/token') return fetchReal(url, opcoes);
    pedidosAoGoogle.push(new URLSearchParams(opcoes.body));
    return responder();
  });
}

const googleConfirma = (dados) => googleResponde(() => Response.json({ id_token: idToken(dados) }));

function criarConta(email, { ativo = 1, trocarSenha = 0 } = {}) {
  db.prepare('INSERT INTO usuarios (nome, email, senha_hash, ativo, trocar_senha) VALUES (?, ?, ?, ?, ?)')
    .run('Aluna Institucional', email, 'sal:hash', ativo, trocarSenha);
}

/** Faz o caminho do navegador: pede o login e volta do Google com o state certo. */
async function voltarDoGoogle({ destino, busca = 'code=codigo-do-google' } = {}) {
  const inicio = await pedir('GET', `/api/auth/google${destino ? `?destino=${destino}` : ''}`);
  const estado = new URL(inicio.cabecalhos.get('location')).searchParams.get('state');
  return pedir('GET', `/api/auth/google/retorno?state=${estado}&${busca}`, { cookie: inicio.cookie });
}

const cookieDeSessao = (r) => r.cabecalhos.getSetCookie().find((c) => c.startsWith('sessao='))?.split(';')[0];

beforeEach(() => {
  pedidosAoGoogle = [];
  process.env.GOOGLE_CLIENT_ID = CLIENT_ID;
  process.env.GOOGLE_CLIENT_SECRET = 'segredo-de-teste';
  delete process.env.GOOGLE_DOMINIOS;
});

afterEach(() => mock.restoreAll());

describe('GET /api/auth/google', () => {
  test('leva ao Google com o state guardado num cookie que sobrevive à volta', async () => {
    const r = await pedir('GET', '/api/auth/google');
    assert.equal(r.status, 302);
    const url = new URL(r.cabecalhos.get('location'));
    assert.equal(url.origin + url.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
    assert.equal(url.searchParams.get('client_id'), CLIENT_ID);
    assert.equal(url.searchParams.get('response_type'), 'code');
    assert.equal(url.searchParams.get('scope'), 'openid email');
    assert.equal(url.searchParams.get('redirect_uri'), 'http://localhost:3000/api/auth/google/retorno');
    assert.match(url.searchParams.get('state'), /^[0-9a-f]{64}$/);

    const cookie = r.cabecalhos.get('set-cookie');
    assert.ok(cookie.includes(url.searchParams.get('state')));
    assert.match(cookie, /HttpOnly; SameSite=Lax; Path=\/api\/auth\/google; Max-Age=600$/);
  });

  test('o segredo nunca vai para o navegador', async () => {
    const r = await pedir('GET', '/api/auth/google');
    assert.ok(!r.cabecalhos.get('location').includes('segredo-de-teste'));
  });

  test('sem configuração, volta ao login com o aviso e guarda o destino', async () => {
    delete process.env.GOOGLE_CLIENT_ID;
    const r = await pedir('GET', '/api/auth/google?destino=minhas-reservas.html');
    assert.equal(r.status, 302);
    assert.equal(r.cabecalhos.get('location'), '/login.html?destino=minhas-reservas.html&erro=google-indisponivel');
  });

  test('destino externo é descartado', async () => {
    googleConfirma(dadosValidos());
    criarConta(ALUNA);
    const r = await voltarDoGoogle({ destino: encodeURIComponent('https://site-falso.com/x.html') });
    assert.equal(r.cabecalhos.get('location'), '/login.html');
  });
});

describe('GET /api/auth/google/retorno', () => {
  test('conta da escola entra, com a mesma sessão do login por senha', async () => {
    googleConfirma(dadosValidos());
    criarConta(ALUNA);
    const r = await voltarDoGoogle();
    assert.equal(r.status, 302);
    assert.equal(r.cabecalhos.get('location'), '/login.html');

    const cookies = r.cabecalhos.getSetCookie();
    assert.ok(cookies.some((c) => c.startsWith('login_google=;') && c.includes('Max-Age=0')));
    assert.ok(cookies.some((c) => /^sessao=[0-9a-f]{64}; HttpOnly; SameSite=Strict/.test(c)));

    const eu = await pedir('GET', '/api/eu', { cookie: cookieDeSessao(r) });
    assert.equal(eu.corpo.email, ALUNA);
    assert.equal(pedidosAoGoogle[0].get('code'), 'codigo-do-google');
    assert.equal(pedidosAoGoogle[0].get('client_secret'), 'segredo-de-teste');
    assert.equal(pedidosAoGoogle[0].get('grant_type'), 'authorization_code');
  });

  test('aceita os dois domínios institucionais, sem diferenciar maiúsculas', async () => {
    googleConfirma(dadosValidos({ email: ALUNO.toUpperCase() }));
    criarConta(ALUNO);
    const r = await voltarDoGoogle();
    assert.ok(cookieDeSessao(r));
  });

  test('o destino pedido antes do Google continua na volta', async () => {
    googleConfirma(dadosValidos());
    criarConta(ALUNA);
    const r = await voltarDoGoogle({ destino: 'minhas-reservas.html' });
    assert.equal(r.cabecalhos.get('location'), '/login.html?destino=minhas-reservas.html');
  });

  test('sem o cookie, ou com state diferente, nem chega a falar com o Google', async () => {
    googleConfirma(dadosValidos());
    criarConta(ALUNA);
    const inicio = await pedir('GET', '/api/auth/google');
    const tentativas = [
      pedir('GET', '/api/auth/google/retorno?state=abc&code=x'),
      pedir('GET', '/api/auth/google/retorno?code=x', { cookie: inicio.cookie }),
      pedir('GET', '/api/auth/google/retorno?state=abc&code=x', { cookie: inicio.cookie }),
    ];
    for (const r of await Promise.all(tentativas)) {
      assert.equal(r.cabecalhos.get('location'), '/login.html?erro=google-falhou');
      assert.equal(cookieDeSessao(r), undefined);
    }
    assert.equal(pedidosAoGoogle.length, 0);
  });

  test('quem desiste na tela do Google volta com o aviso', async () => {
    googleConfirma(dadosValidos());
    const r = await voltarDoGoogle({ busca: 'error=access_denied' });
    assert.equal(r.cabecalhos.get('location'), '/login.html?erro=google-cancelado');
    assert.equal(pedidosAoGoogle.length, 0);
  });

  test('e-mail fora dos domínios institucionais é recusado, mesmo com conta no site', async () => {
    for (const email of [BEATRIZ, 'x@falso-al.educacao.sp.gov.br', 'x@al.educacao.sp.gov.br.falso.com']) {
      googleConfirma(dadosValidos({ email }));
      const r = await voltarDoGoogle();
      assert.equal(r.cabecalhos.get('location'), '/login.html?erro=google-dominio', email);
      assert.equal(cookieDeSessao(r), undefined);
      mock.restoreAll();
    }
  });

  test('GOOGLE_DOMINIOS troca a lista de domínios aceitos', async () => {
    process.env.GOOGLE_DOMINIOS = 'fpsf.edu.br';
    googleConfirma(dadosValidos({ email: BEATRIZ }));
    const r = await voltarDoGoogle();
    assert.ok(cookieDeSessao(r));
  });

  test('e-mail institucional sem conta no site não cria conta', async () => {
    googleConfirma(dadosValidos());
    const r = await voltarDoGoogle();
    assert.equal(r.cabecalhos.get('location'), '/login.html?erro=google-sem-conta');
    assert.equal(cookieDeSessao(r), undefined);
    assert.equal(db.prepare('SELECT 1 FROM usuarios WHERE email = ?').get(ALUNA), undefined);
  });

  test('conta desativada não entra', async () => {
    googleConfirma(dadosValidos());
    criarConta(ALUNA, { ativo: 0 });
    const r = await voltarDoGoogle();
    assert.equal(r.cabecalhos.get('location'), '/login.html?erro=conta-desativada');
    assert.equal(cookieDeSessao(r), undefined);
  });

  test('senha provisória continua exigindo a troca', async () => {
    googleConfirma(dadosValidos());
    criarConta(ALUNA, { trocarSenha: 1 });
    const cookie = cookieDeSessao(await voltarDoGoogle());
    const eu = await pedir('GET', '/api/eu', { cookie });
    assert.equal(eu.corpo.trocar_senha, 1);
    assert.equal((await pedir('GET', '/api/reservas', { cookie })).status, 403);
  });

  test('token que não dá para confiar é recusado', async () => {
    criarConta(ALUNA);
    const invalidos = {
      'outro cliente': { aud: 'outro-cliente' },
      'outro emissor': { iss: 'https://emissor-falso.com' },
      vencido: { exp: Math.floor(Date.now() / 1000) - 60 },
      'sem validade': { exp: undefined },
      'e-mail não verificado': { email_verified: false },
    };
    mock.method(console, 'error', () => {});
    for (const [caso, extras] of Object.entries(invalidos)) {
      googleConfirma(dadosValidos(extras));
      const r = await voltarDoGoogle();
      assert.equal(r.cabecalhos.get('location'), '/login.html?erro=google-falhou', caso);
      assert.equal(cookieDeSessao(r), undefined, caso);
      globalThis.fetch.mock.restore();
    }
  });

  test('Google recusando o código, fora do ar ou com resposta estranha não vira erro 500', async () => {
    criarConta(ALUNA);
    mock.method(console, 'error', () => {});
    const falhas = [
      () => Response.json({ error: 'invalid_grant' }, { status: 400 }),
      () => { throw new Error('sem rede'); },
      () => Response.json({}),
      () => new Response('não é json'),
    ];
    for (const falha of falhas) {
      googleResponde(falha);
      const r = await voltarDoGoogle();
      assert.equal(r.status, 302);
      assert.equal(r.cabecalhos.get('location'), '/login.html?erro=google-falhou');
      globalThis.fetch.mock.restore();
    }
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sessoes WHERE usuario_id = ?').get(idDoUsuario(ALUNA)).n, 0);
  });
});

describe('tela de login', () => {
  test('tem o botão do Google e a orientação do e-mail institucional', async () => {
    const { corpo } = await pedir('GET', '/login.html');
    assert.match(corpo, /href="\/api\/auth\/google"/);
    assert.match(corpo, /00001111111111sp@aluno\.educacao\.sp\.gov\.br/);
    assert.match(corpo, /00001111111111sp@al\.educacao\.sp\.gov\.br/);
  });
});
