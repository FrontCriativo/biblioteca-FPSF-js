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
          ${r.status === 'retirada' && r.devolver_ate
            ? `<div${r.atrasada ? ' class="prazo-atrasado"' : ''}>
                <dt>${r.atrasada ? 'Devolução atrasada' : 'Prazo'}</dt>
                <dd>Devolver até ${formatarData(r.devolver_ate)}</dd>
              </div>` : ''}
          ${r.status === 'retirada' && r.renovacoes
            ? `<div><dt>Renovações</dt><dd>${r.renovacoes}</dd></div>` : ''}
        </dl>
      </div>
      ${r.status === 'ativa'
        ? `<button class="btn btn--outline" type="button" data-cancelar="${r.id}">Cancelar</button>` : ''}
      ${r.pode_renovar
        ? `<button class="btn btn--lilac" type="button" data-renovar="${r.id}" data-novo-prazo="${escaparHtml(r.novo_prazo)}">Renovar</button>` : ''}
    </article>`).join('');
}

alvo.addEventListener('click', async (evento) => {
  const botao = evento.target.closest('[data-cancelar], [data-renovar]');
  if (!botao) return;
  const { cancelar, renovar, novoPrazo } = botao.dataset;
  if (renovar && !confirm(`Renovar este empréstimo? O novo prazo de devolução será ${formatarData(novoPrazo)}.`)) return;
  botao.disabled = true;
  try {
    await (renovar ? api.renovarReserva(renovar) : api.cancelarReserva(cancelar));
    await desenhar();
  } catch (erro) {
    alert(erro.message);
    botao.disabled = false;
  }
});
