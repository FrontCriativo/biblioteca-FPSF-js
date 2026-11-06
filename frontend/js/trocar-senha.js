// Troca de senha: obrigatória para senha provisória, opcional pelo perfil (ou pela barra, na coordenação).

import { api, montarSessaoNavbar } from './api.js';

const usuario = await montarSessaoNavbar();
const form = document.querySelector('[data-form-senha]');
const feedback = form.querySelector('[data-feedback]');

if (!usuario) {
  location.href = 'login.html?destino=trocar-senha.html';
} else {
  form.hidden = false;
  form.querySelector('[data-aviso-provisoria]').hidden = !usuario.trocar_senha;
  form.senha_atual.focus();
}

function mostrar(texto, erro = false) {
  feedback.textContent = texto;
  feedback.classList.toggle('form-feedback--erro', erro);
  feedback.hidden = false;
}

form.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  const { senha_atual: atual, nova_senha: nova, confirmar } = Object.fromEntries(new FormData(form));
  if (nova !== confirmar) {
    mostrar('A confirmação não é igual à nova senha.', true);
    form.confirmar.focus();
    return;
  }

  const botao = form.querySelector('button[type="submit"]');
  botao.disabled = true;
  try {
    await api.trocarSenha(atual, nova);
  } catch (erro) {
    mostrar(erro.message, true);
    botao.disabled = false;
    return;
  }

  form.reset();
  if (usuario.trocar_senha) {
    // Troca obrigatória feita: segue para onde o login levaria.
    if (usuario.completar_perfil) location.href = 'perfil.html';
    else location.href = usuario.papel === 'admin' ? 'admin.html' : 'index.html';
    return;
  }
  mostrar('Senha alterada. Os outros aparelhos conectados à sua conta foram desconectados.');
  botao.disabled = false;
});
