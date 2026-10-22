// Página de depoimentos: formulário com nota em estrelas.
// Ainda sem back-end próprio: o depoimento enviado aparece só nesta visita.

import { montarSessaoNavbar, escaparHtml } from './api.js';

const ESTRELA_VAZIA = 'assets/estrela.png';
const ESTRELA_CHEIA = 'assets/depoimentoPreenchido.png';
const ROTULOS_NOTA = ['', 'Ruim', 'Regular', 'Boa', 'Muito boa', 'Excelente'];
const TEXTO_PADRAO = 'Escolha de 1 a 5 estrelas';

const form = document.querySelector('[data-depoimento-form]');

montarSessaoNavbar().then((usuario) => {
  const nome = form?.querySelector('[name="nome"]');
  if (usuario && nome && !nome.value) nome.value = usuario.nome;
});

if (form) ligarFormulario(form);

function pintarEstrelas(imagens, nota) {
  imagens.forEach((img, i) => {
    const cheia = i < nota;
    img.src = cheia ? ESTRELA_CHEIA : ESTRELA_VAZIA;
    img.classList.toggle('estrela--cheia', cheia);
  });
}

function cartaoDepoimento({ nome, turma, mensagem, nota }) {
  const estrelas = [1, 2, 3, 4, 5].map((n) => (n <= nota
    ? `<img class="estrela estrela--cheia" src="${ESTRELA_CHEIA}" alt="">`
    : `<img class="estrela" src="${ESTRELA_VAZIA}" alt="">`)).join('');

  return `
    <div class="quote-card">
      <div class="quote-card__stars" role="img" aria-label="Nota ${nota} de 5">${estrelas}</div>
      <p>${escaparHtml(mensagem)}</p>
      <div class="quote-card__who">
        <img src="assets/userRoxo.png" alt="">
        <div><strong>${escaparHtml(nome)}</strong><span>${escaparHtml(turma)}</span></div>
      </div>
    </div>`;
}

function ligarFormulario(form) {
  const grupo = form.querySelector('.nota-input__estrelas');
  const radios = [...grupo.querySelectorAll('input[name="nota"]')];
  const imagens = [...grupo.querySelectorAll('.estrela')];
  const texto = form.querySelector('.nota-input__texto');
  const feedback = form.querySelector('.form-feedback');

  const notaAtual = () => Number(radios.find((r) => r.checked)?.value ?? 0);
  const mostrarNota = (nota) => {
    pintarEstrelas(imagens, nota);
    texto.textContent = nota ? `${nota} de 5 — ${ROTULOS_NOTA[nota]}` : TEXTO_PADRAO;
    texto.classList.remove('is-erro');
  };

  // Passar o mouse mostra a prévia; ao sair, volta para a nota escolhida.
  radios.forEach((radio) => {
    radio.addEventListener('change', () => mostrarNota(notaAtual()));
    radio.closest('label').addEventListener('mouseenter', () => pintarEstrelas(imagens, Number(radio.value)));
  });
  grupo.addEventListener('mouseleave', () => pintarEstrelas(imagens, notaAtual()));

  form.addEventListener('submit', (evento) => {
    evento.preventDefault();
    const nota = notaAtual();
    if (!nota) {
      texto.textContent = 'Escolha uma nota antes de enviar.';
      texto.classList.add('is-erro');
      radios[0].focus();
      return;
    }

    const dados = new FormData(form);
    document.querySelector('.testimonials__grid')?.insertAdjacentHTML('afterbegin', cartaoDepoimento({
      nome: dados.get('nome').trim(),
      turma: dados.get('turma').trim(),
      mensagem: dados.get('mensagem').trim(),
      nota,
    }));

    form.reset();
    mostrarNota(0);
    feedback.textContent = 'Obrigado! Seu depoimento apareceu no topo da lista. Este é um protótipo — ele ainda não fica salvo.';
    feedback.style.display = 'block';
  });
}
