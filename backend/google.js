// Login com o Google (OAuth 2.0, fluxo de código). O Google só confirma de quem é o e-mail:
// a conta continua sendo a do banco, cadastrada pela escola.
import { normalizarEmail } from './texto.js';

const URL_AUTORIZACAO = 'https://accounts.google.com/o/oauth2/v2/auth';
const URL_TOKEN = 'https://oauth2.googleapis.com/token';
const EMISSORES = ['https://accounts.google.com', 'accounts.google.com'];
const DOMINIOS_PADRAO = 'al.educacao.sp.gov.br,aluno.educacao.sp.gov.br';
const TEMPO_MAXIMO_MS = 10_000;

// Vem da configuração, e não do cabeçalho Host, que o próprio cliente escolhe.
const urlRetorno = () => process.env.GOOGLE_URL_RETORNO
  || `http://localhost:${process.env.PORT || 3000}/api/auth/google/retorno`;

export function googleConfigurado() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

export function urlDeAutorizacao(estado) {
  const parametros = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: urlRetorno(),
    response_type: 'code',
    scope: 'openid email',
    state: estado,
    // Em computador compartilhado, a conta aberta no navegador pode ser a de outro aluno.
    prompt: 'select_account',
  });
  return `${URL_AUTORIZACAO}?${parametros}`;
}

/** Compara o domínio inteiro: "x@falso-al.educacao.sp.gov.br" não pode passar. */
export function dominioPermitido(email) {
  const dominios = (process.env.GOOGLE_DOMINIOS || DOMINIOS_PADRAO)
    .split(',').map((d) => d.trim().toLowerCase()).filter(Boolean);
  return dominios.includes(email.split('@')[1]);
}

/** Troca o código pelo e-mail confirmado. Lança erro em qualquer resposta que não dê para confiar. */
export async function emailConfirmadoPeloGoogle(codigo) {
  const resposta = await fetch(URL_TOKEN, {
    method: 'POST',
    body: new URLSearchParams({
      code: codigo,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: urlRetorno(),
      grant_type: 'authorization_code',
    }),
    signal: AbortSignal.timeout(TEMPO_MAXIMO_MS),
  });
  if (!resposta.ok) throw new Error(`Google recusou o código: ${resposta.status}`);

  // O token veio direto do Google por HTTPS, e não pelo navegador: por isso a
  // assinatura não precisa ser conferida. Os campos, sim.
  const { id_token: idToken } = await resposta.json();
  const dados = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64url').toString('utf8'));
  if (!EMISSORES.includes(dados.iss)) throw new Error('Emissor inesperado no token do Google.');
  if (dados.aud !== process.env.GOOGLE_CLIENT_ID) throw new Error('Token do Google emitido para outro cliente.');
  if (!(dados.exp * 1000 > Date.now())) throw new Error('Token do Google vencido.');
  if (dados.email_verified !== true) throw new Error('E-mail não verificado pelo Google.');
  return normalizarEmail(dados.email);
}
