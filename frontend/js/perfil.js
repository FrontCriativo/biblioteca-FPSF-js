// Perfil do aluno: obrigatório até a primeira confirmação, depois fica pelo menu do usuário.

import { api, escaparHtml, montarSessaoNavbar } from './api.js';

const usuario = await montarSessaoNavbar();
const form = document.querySelector('[data-form-perfil]');
const feedback = form.querySelector('[data-feedback]');

/** "11912345678" → "(11) 91234-5678", conforme a pessoa digita. */
function mascararTelefone(valor) {
  const digitos = valor.replace(/\D/g, '').slice(0, 11);
  if (digitos.length <= 2) return digitos && `(${digitos}`;
  const ddd = `(${digitos.slice(0, 2)}) `;
  if (digitos.length <= 6) return ddd + digitos.slice(2);
  const corte = digitos.length === 11 ? 7 : 6;
  return `${ddd}${digitos.slice(2, corte)}-${digitos.slice(corte)}`;
}

function mostrar(texto, erro = false) {
  feedback.textContent = texto;
  feedback.classList.toggle('form-feedback--erro', erro);
  feedback.hidden = false;
}

if (!usuario) {
  location.href = 'login.html?destino=perfil.html';
} else if (usuario.papel === 'admin') {
  location.href = 'admin.html';
} else {
  form.nome.value = usuario.nome;
  form.turma.value = usuario.turma ?? '';
  form.querySelector('#email').value = usuario.email;
  form.telefone.value = mascararTelefone(usuario.telefone ?? '');
  form.querySelector('[data-aviso-perfil]').hidden = !usuario.completar_perfil;
  // Com o perfil pendente, o link só traria o aluno de volta para cá.
  form.querySelector('[data-link-senha]').hidden = Boolean(usuario.completar_perfil);
  form.hidden = false;
  form.nome.focus();

  // Só sugestão: sem ela o campo continua funcionando, então a falha não atrapalha o aluno.
  api.sugestoesDeTurma().then((turmas) => {
    form.querySelector('[data-lista-turmas]').innerHTML = turmas
      .map((nome) => `<option value="${escaparHtml(nome)}"></option>`).join('');
  }).catch(() => {});
}

form.telefone.addEventListener('input', () => {
  form.telefone.value = mascararTelefone(form.telefone.value);
});

form.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  const botao = form.querySelector('button[type="submit"]');
  botao.disabled = true;
  feedback.hidden = true;
  try {
    await api.salvarPerfil(Object.fromEntries(new FormData(form)));
  } catch (erro) {
    mostrar(erro.message, true);
    botao.disabled = false;
    return;
  }

  if (usuario.completar_perfil) {
    location.href = 'index.html';
    return;
  }
  mostrar('Perfil salvo.');
  botao.disabled = false;
});
