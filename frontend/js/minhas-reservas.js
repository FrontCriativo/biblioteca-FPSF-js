import { api, cartaoLivro, escaparHtml, formatarData, ROTULOS_STATUS, montarSessaoNavbar } from './api.js';

const usuario = await montarSessaoNavbar();
const alvo = document.querySelector('[data-reservas]');
const queroLer = document.querySelector('[data-quero-ler]');

if (!usuario) {
  location.href = 'login.html?destino=minhas-reservas.html';
} else {
  desenhar();
}

async function desenhar() {
  const reservas = await api.minhasReservas();
  desenharReservas(reservas);
  await desenharQueroLer(reservas);
}

async function desenharQueroLer(reservas) {
  const livros = await api.favoritos();
  queroLer.hidden = false;
  const lista = queroLer.querySelector('[data-quero-ler-lista]');

  if (!livros.length) {
    lista.className = '';
    lista.innerHTML = `
      <div class="empty-state">
        Sua lista está vazia. Na página de um livro, use o botão “Quero ler” para guardá-lo aqui.
      </div>`;
    return;
  }

  const emAberto = new Set(
    reservas.filter((r) => ['ativa', 'retirada'].includes(r.status)).map((r) => r.livro_slug)
  );
  lista.className = 'book-grid';
  lista.innerHTML = livros.map((l) => `
    <div class="quero-ler__item">
      ${cartaoLivro(l)}
      <div class="quero-ler__acoes">
        ${l.disponiveis > 0 && !emAberto.has(l.slug)
          ? `<button class="mini-btn" type="button" data-reservar="${l.id}">Reservar</button>` : ''}
        <button class="mini-btn" type="button" data-remover="${l.id}">Remover</button>
      </div>
    </div>`).join('');
}

function desenharReservas(reservas) {
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

queroLer.addEventListener('click', async (evento) => {
  const botao = evento.target.closest('[data-reservar], [data-remover]');
  if (!botao) return;
  const { reservar, remover } = botao.dataset;
  botao.disabled = true;
  try {
    await (reservar ? api.reservar(reservar) : api.removerFavorito(remover));
    await desenhar();
  } catch (erro) {
    alert(erro.message);
    botao.disabled = false;
  }
});
