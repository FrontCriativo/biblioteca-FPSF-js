import { api, ligarNavbarBasica } from './api.js';

ligarNavbarBasica();

const form = document.querySelector('[data-form-login]');
const aviso = form.querySelector('.form-feedback');
const destino = new URLSearchParams(location.search).get('destino');

// Páginas internas apenas: um destino externo viraria redirecionamento aberto.
const paginaSegura = destino && /^[a-z0-9-]+\.html$/.test(destino) ? destino : 'index.html';

// Senha provisória (seed ou definida pela coordenação): primeiro a troca, depois o site.
const PAGINA_TROCA = 'trocar-senha.html';

api.eu().then((usuario) => {
  if (usuario) location.href = usuario.trocar_senha ? PAGINA_TROCA : paginaSegura;
});

form.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  const botao = form.querySelector('button[type="submit"]');
  const { email, senha } = Object.fromEntries(new FormData(form));

  botao.disabled = true;
  aviso.style.display = 'none';

  try {
    const usuario = await api.entrar(email, senha);
    if (usuario.trocar_senha) location.href = PAGINA_TROCA;
    else location.href = destino ? paginaSegura : (usuario.papel === 'admin' ? 'admin.html' : 'index.html');
  } catch (erro) {
    aviso.textContent = erro.message;
    aviso.style.color = '#B3261E';
    aviso.style.display = 'block';
    botao.disabled = false;
  }
});
