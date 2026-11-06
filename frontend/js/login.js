import { api, ligarNavbarBasica } from './api.js';

ligarNavbarBasica();

const form = document.querySelector('[data-form-login]');
const aviso = form.querySelector('.form-feedback');
const destino = new URLSearchParams(location.search).get('destino');

// Páginas internas apenas: um destino externo viraria redirecionamento aberto.
const paginaSegura = destino && /^[a-z0-9-]+\.html$/.test(destino) ? destino : 'index.html';

// Senha provisória (seed ou definida pela coordenação): primeiro a troca, depois o site.
const PAGINA_TROCA = 'trocar-senha.html';

// Códigos que a volta do login com o Google traz na URL.
const ERROS_GOOGLE = {
  'google-indisponivel': 'O login com o Google ainda não está disponível. Use seu e-mail e senha.',
  'google-cancelado': 'O login com o Google foi cancelado.',
  'google-falhou': 'Não foi possível entrar com o Google. Tente de novo.',
  'google-dominio': 'Use o seu e-mail institucional, terminado em @aluno.educacao.sp.gov.br ou @al.educacao.sp.gov.br.',
  'google-sem-conta': 'Este e-mail ainda não tem conta na biblioteca. Fale com a secretaria.',
  'conta-desativada': 'Conta desativada. Procure a coordenação.',
};

function mostrarErro(mensagem) {
  aviso.textContent = mensagem;
  aviso.style.color = '#B3261E';
  aviso.style.display = 'block';
}

function paginaDepoisDoLogin(usuario) {
  if (usuario.trocar_senha) return PAGINA_TROCA;
  return destino ? paginaSegura : (usuario.papel === 'admin' ? 'admin.html' : 'index.html');
}

const erroGoogle = ERROS_GOOGLE[new URLSearchParams(location.search).get('erro')];
if (erroGoogle) mostrarErro(erroGoogle);

if (paginaSegura === destino) {
  form.querySelector('[data-login-google]').search = new URLSearchParams({ destino }).toString();
}

api.eu().then((usuario) => {
  if (usuario) location.href = paginaDepoisDoLogin(usuario);
});

form.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  const botao = form.querySelector('button[type="submit"]');
  const { email, senha } = Object.fromEntries(new FormData(form));

  botao.disabled = true;
  aviso.style.display = 'none';

  try {
    const usuario = await api.entrar(email, senha);
    location.href = paginaDepoisDoLogin(usuario);
  } catch (erro) {
    mostrarErro(erro.message);
    botao.disabled = false;
  }
});
