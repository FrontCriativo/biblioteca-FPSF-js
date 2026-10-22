// Biblioteca Virtual — FPSF
// Páginas sem lógica própria: contato.

import { montarSessaoNavbar } from './api.js';

montarSessaoNavbar();

/* Formulário de contato: ainda sem back-end próprio. */
document.querySelectorAll('form[data-demo-form]').forEach((form) => {
  form.addEventListener('submit', (evento) => {
    evento.preventDefault();
    const feedback = form.querySelector('.form-feedback');
    if (feedback) {
      feedback.textContent = form.getAttribute('data-demo-form');
      feedback.style.display = 'block';
    }
  });
});
