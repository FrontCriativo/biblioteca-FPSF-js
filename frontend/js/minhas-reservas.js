import { api, escaparHtml, formatarData, ROTULOS_STATUS, montarSessaoNavbar } from './api.js';

const usuario = await montarSessaoNavbar();
const alvo = document.querySelector('[data-reservas]');

if (!usuario) {
  location.href = 'login.html?destino=minhas-reservas.html';
} else {
  desenhar();
}

async function desenhar() {
  const reservas = await api.minhasReservas();

  if (!reservas.length) {
    alvo.innerHTML = `
      <div class="empty-state">
        Você ainda não reservou nenhum livro.
        <a href="catalogo.html">Explore o catálogo</a> e faça sua primeira pré-reserva.
      </div>`;
    return;
  }

  alvo.innerHTML = reservas.map((r) => `
    <article class="reserva-card">
      <img class="reserva-card__capa" src="assets/${escaparHtml(r.capa)}" alt="Capa de ${escaparHtml(r.titulo)}">
      <div class="reserva-card__info">
        <span class="selo selo--${r.status}">${ROTULOS_STATUS[r.status]}</span>
        <h3><a href="livro.html?titulo=${encodeURIComponent(r.livro_slug)}">${escaparHtml(r.titulo)}</a></h3>
        <p class="reserva-card__autor">${escaparHtml(r.autor)}</p>
        <dl class="reserva-card__dados">
          <div><dt>Exemplar</dt><dd>${escaparHtml(r.exemplar_codigo)}</dd></div>
          <div><dt>Reservado em</dt><dd>${formatarData(r.criada_em)}</dd></div>
          ${r.status === 'ativa'
            ? `<div><dt>Retirar até</dt><dd>${formatarData(r.expira_em)}</dd></div>` : ''}
        </dl>
      </div>
      ${['ativa', 'retirada'].includes(r.status)
        ? `<button class="btn btn--outline" type="button" data-cancelar="${r.id}">Cancelar</button>` : ''}
    </article>`).join('');
}

alvo.addEventListener('click', async (evento) => {
  const botao = evento.target.closest('[data-cancelar]');
  if (!botao) return;
  botao.disabled = true;
  try {
    await api.cancelarReserva(botao.dataset.cancelar);
    await desenhar();
  } catch (erro) {
    alert(erro.message);
    botao.disabled = false;
  }
});
