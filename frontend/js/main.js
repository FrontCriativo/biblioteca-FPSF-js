// Biblioteca Virtual — FPSF
// Páginas sem lógica própria: contato, documentação da API e 404.

import { api, escaparHtml, montarSessaoNavbar } from './api.js';

montarSessaoNavbar();

const EMAIL_BIBLIOTECA = 'biblioteca@fpsf.edu.br';

/* Formulário de contato: a mensagem fica registrada para a coordenação ler no painel.
   Se o envio falhar, o e-mail da biblioteca continua sendo a alternativa. */
document.querySelectorAll('form[data-form-contato]').forEach((form) => {
  const feedback = form.querySelector('.form-feedback');
  const botao = form.querySelector('button[type="submit"]');

  form.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    botao.disabled = true;
    feedback.hidden = true;
    try {
      await api.enviarContato(Object.fromEntries(new FormData(form)));
      form.reset();
      feedback.classList.remove('form-feedback--erro');
      feedback.textContent = 'Mensagem enviada. A equipe da biblioteca vai ler em breve.';
    } catch (erro) {
      feedback.classList.add('form-feedback--erro');
      feedback.innerHTML = `${escaparHtml(erro.message)} Você também pode escrever para
        <a href="mailto:${EMAIL_BIBLIOTECA}">${EMAIL_BIBLIOTECA}</a>.`;
    }
    feedback.hidden = false;
    botao.disabled = false;
  });
});
