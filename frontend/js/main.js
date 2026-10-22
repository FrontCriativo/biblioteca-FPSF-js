// Biblioteca Virtual — FPSF
// Páginas sem lógica própria: contato.

import { montarSessaoNavbar } from './api.js';

montarSessaoNavbar();

const EMAIL_BIBLIOTECA = 'biblioteca@fpsf.edu.br';

/* Formulário de contato: o site não envia e-mail; ele monta a mensagem e
   abre o programa de e-mail de quem escreve, que é quem de fato envia. */
document.querySelectorAll('form[data-form-contato]').forEach((form) => {
  form.addEventListener('submit', (evento) => {
    evento.preventDefault();
    const dados = Object.fromEntries(new FormData(form));
    const nome = dados.nome.trim();
    const turma = dados.turma.trim();
    const email = dados.email.trim();

    const assinatura = [
      `${nome}${turma ? ` (${turma})` : ''}`,
      email ? `E-mail para resposta: ${email}` : '',
    ].filter(Boolean).join('\n');
    const assunto = `[Biblioteca Virtual] ${dados.assunto}`;
    const corpo = `${dados.mensagem.trim()}\n\n—\n${assinatura}`;

    // encodeURIComponent, e não URLSearchParams: este troca espaço por "+",
    // que alguns programas de e-mail mostram literalmente.
    location.href = `mailto:${EMAIL_BIBLIOTECA}?subject=${encodeURIComponent(assunto)}&body=${encodeURIComponent(corpo)}`;

    const feedback = form.querySelector('.form-feedback');
    feedback.innerHTML = `Abrimos o seu programa de e-mail com a mensagem pronta. Se nada abriu, escreva direto para
      <a href="mailto:${EMAIL_BIBLIOTECA}">${EMAIL_BIBLIOTECA}</a>.`;
    feedback.hidden = false;
  });
});
