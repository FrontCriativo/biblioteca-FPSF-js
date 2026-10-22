// Página de depoimentos: lista os aprovados e envia novos para a moderação.

import { api, montarSessaoNavbar, cartaoDepoimento, escaparHtml } from './api.js';

const ESTRELA_VAZIA = 'assets/estrela.png';
const ESTRELA_CHEIA = 'assets/depoimentoPreenchido.png';
const ROTULOS_NOTA = ['', 'Ruim', 'Regular', 'Boa', 'Muito boa', 'Excelente'];
const TEXTO_PADRAO = 'Escolha de 1 a 5 estrelas';

const grade = document.querySelector('[data-depoimentos]');
const form = document.querySelector('[data-depoimento-form]');

montarSessaoNavbar().then((usuario) => {
  const nome = form?.querySelector('[name="nome"]');
  if (usuario && nome && !nome.value) nome.value = usuario.nome;
});

desenharDepoimentos();
if (form) ligarFormulario(form);

async function desenharDepoimentos() {
  let depoimentos;
  try {
    depoimentos = await api.depoimentos();
  } catch (erro) {
    grade.innerHTML = `<div class="empty-state">Não foi possível carregar os depoimentos: ${escaparHtml(erro.message)}</div>`;
    return;
  }
  grade.innerHTML = depoimentos.length
    ? depoimentos.map(cartaoDepoimento).join('')
    : `<div class="empty-state">
        Ainda não há depoimentos publicados.
        <a href="#deixar-depoimento">Seja o primeiro a contar</a> como a biblioteca entrou na sua rotina.
      </div>`;
}

function pintarEstrelas(imagens, nota) {
  imagens.forEach((img, i) => {
    const cheia = i < nota;
    img.src = cheia ? ESTRELA_CHEIA : ESTRELA_VAZIA;
    img.classList.toggle('estrela--cheia', cheia);
  });
}

function ligarFormulario(form) {
  const grupo = form.querySelector('.nota-input__estrelas');
  const radios = [...grupo.querySelectorAll('input[name="nota"]')];
  const imagens = [...grupo.querySelectorAll('.estrela')];
  const texto = form.querySelector('.nota-input__texto');
  const feedback = form.querySelector('.form-feedback');
  const botao = form.querySelector('button[type="submit"]');

  const notaAtual = () => Number(radios.find((r) => r.checked)?.value ?? 0);
  const mostrarNota = (nota) => {
    pintarEstrelas(imagens, nota);
    texto.textContent = nota ? `${nota} de 5 — ${ROTULOS_NOTA[nota]}` : TEXTO_PADRAO;
    texto.classList.remove('is-erro');
  };
  const mostrarFeedback = (mensagem, erro = false) => {
    feedback.textContent = mensagem;
    feedback.classList.toggle('form-feedback--erro', erro);
    feedback.hidden = false;
  };

  // Passar o mouse mostra a prévia; ao sair, volta para a nota escolhida.
  radios.forEach((radio) => {
    radio.addEventListener('change', () => mostrarNota(notaAtual()));
    radio.closest('label').addEventListener('mouseenter', () => pintarEstrelas(imagens, Number(radio.value)));
  });
  grupo.addEventListener('mouseleave', () => pintarEstrelas(imagens, notaAtual()));

  form.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    const nota = notaAtual();
    if (!nota) {
      texto.textContent = 'Escolha uma nota antes de enviar.';
      texto.classList.add('is-erro');
      radios[0].focus();
      return;
    }

    const dados = new FormData(form);
    botao.disabled = true;
    try {
      await api.enviarDepoimento({
        nome: dados.get('nome').trim(),
        turma: dados.get('turma').trim(),
        mensagem: dados.get('mensagem').trim(),
        nota,
      });
    } catch (erro) {
      mostrarFeedback(erro.message, true);
      botao.disabled = false;
      return;
    }

    form.reset();
    mostrarNota(0);
    botao.disabled = false;
    mostrarFeedback('Obrigado! Seu depoimento foi enviado e vai aparecer aqui depois de aprovado pela biblioteca.');
  });
}
