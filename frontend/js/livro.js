import { api, escaparHtml, formatarData, montarSessaoNavbar } from './api.js';

const alvo = document.querySelector('[data-livro]');
const slug = new URLSearchParams(location.search).get('titulo');

const usuario = await montarSessaoNavbar();

if (!slug) {
  alvo.innerHTML = `<div class="empty-state">Nenhum livro informado. <a href="catalogo.html">Voltar ao catálogo</a>.</div>`;
} else {
  await desenhar();
}

async function desenhar() {
  let livro;
  try {
    livro = await api.livro(slug);
  } catch (erro) {
    alvo.innerHTML = `<div class="empty-state">${escaparHtml(erro.message)} <a href="catalogo.html">Voltar ao catálogo</a>.</div>`;
    return;
  }

  document.title = `${livro.titulo} — Biblioteca Virtual FPSF`;

  let minhaReserva = null;
  let naMinhaLista = false;
  if (usuario) {
    const [reservas, favoritos] = await Promise.all([api.minhasReservas(), api.favoritos()]);
    minhaReserva = reservas.find(
      (r) => r.livro_slug === livro.slug && ['ativa', 'retirada'].includes(r.status)
    ) ?? null;
    naMinhaLista = favoritos.some((f) => f.id === livro.id);
  }

  const esgotado = livro.disponiveis === 0;

  alvo.innerHTML = `
    <a href="catalogo.html" class="back-link"><img src="assets/voltar.png" alt="">Voltar ao catálogo</a>
    <div class="detail-grid">
      <div class="detail-grid__cover">
        <img src="assets/${escaparHtml(livro.capa)}" alt="Capa de ${escaparHtml(livro.titulo)}">
      </div>
      <div class="detail-info">
        <span class="detail-tag">
          <img src="assets/${escaparHtml(livro.materia_icone)}" alt="">${escaparHtml(livro.materia_nome)}
        </span>
        <h1>${escaparHtml(livro.titulo)}</h1>
        <p class="author">${escaparHtml(livro.autor)}</p>

        <div class="disp-painel ${esgotado ? 'disp-painel--fora' : 'disp-painel--ok'}">
          <strong>${esgotado ? 'Sem exemplar livre agora' : `${livro.disponiveis} de ${livro.total_exemplares} disponíveis`}</strong>
          <span>${esgotado
            ? 'Todos os exemplares estão reservados ou emprestados. Volte em alguns dias.'
            : 'Faça a pré-reserva e retire na biblioteca em até 3 dias.'}</span>
        </div>

        ${livro.sinopse ? `<p class="synopsis">${escaparHtml(livro.sinopse)}</p>` : ''}

        <div class="detail-actions" data-acoes></div>
        <p class="form-feedback" data-aviso style="display:none;"></p>

        <div class="detail-meta">
          <div><strong>Matéria</strong><span>${escaparHtml(livro.materia_nome)}</span></div>
          <div><strong>Páginas</strong><span>${livro.paginas ?? '—'}</span></div>
          <div><strong>Idioma</strong><span>${escaparHtml(livro.idioma)}</span></div>
        </div>
      </div>
    </div>`;

  montarAcoes(livro, minhaReserva, esgotado);
  montarBotaoQueroLer(livro, naMinhaLista);
}

function mostrarAviso(texto, erro = false) {
  const aviso = alvo.querySelector('[data-aviso]');
  aviso.textContent = texto;
  aviso.style.display = 'block';
  aviso.style.color = erro ? '#B3261E' : 'var(--lilac-deep)';
}

function montarBotaoQueroLer(livro, naMinhaLista) {
  const acoes = alvo.querySelector('[data-acoes]');

  if (!usuario) {
    acoes.insertAdjacentHTML('beforeend', '<a href="login.html" class="btn btn--outline">Quero ler</a>');
    return;
  }

  acoes.insertAdjacentHTML('beforeend', '<button class="btn btn--outline" type="button" data-quero-ler></button>');
  const botao = acoes.querySelector('[data-quero-ler]');
  const atualizar = () => {
    botao.textContent = naMinhaLista ? 'Na minha lista' : 'Quero ler';
    botao.setAttribute('aria-pressed', String(naMinhaLista));
  };
  atualizar();

  botao.addEventListener('click', async () => {
    botao.disabled = true;
    try {
      await (naMinhaLista ? api.removerFavorito(livro.id) : api.adicionarFavorito(livro.id));
      naMinhaLista = !naMinhaLista;
      atualizar();
    } catch (erro) {
      mostrarAviso(erro.message, true);
    }
    botao.disabled = false;
  });
}

function montarAcoes(livro, minhaReserva, esgotado) {
  const acoes = alvo.querySelector('[data-acoes]');

  if (!usuario) {
    acoes.innerHTML = `
      <a href="login.html" class="btn btn--lilac">Entrar para reservar</a>
      <a href="catalogo.html#${escaparHtml(livro.materia_slug)}" class="btn btn--outline">
        Ver outros de ${escaparHtml(livro.materia_nome)}
      </a>`;
    return;
  }

  if (minhaReserva) {
    // Livro já retirado não se cancela: só a biblioteca registra a devolução.
    const podeCancelar = minhaReserva.status === 'ativa';
    acoes.innerHTML = `
      ${podeCancelar ? '<button class="btn btn--outline" type="button" data-cancelar>Cancelar minha reserva</button>' : ''}
      <a href="minhas-reservas.html" class="btn btn--lilac">Ver minhas reservas</a>`;
    mostrarAviso(
      podeCancelar
        ? `Reserva feita. Retire na biblioteca até ${formatarData(minhaReserva.expira_em)} (exemplar ${minhaReserva.exemplar_codigo}).`
        : `Você está com este livro (exemplar ${minhaReserva.exemplar_codigo}).`
    );
    if (!podeCancelar) return;
    acoes.querySelector('[data-cancelar]').addEventListener('click', async (evento) => {
      evento.target.disabled = true;
      try {
        await api.cancelarReserva(minhaReserva.id);
        await desenhar();
      } catch (erro) {
        mostrarAviso(erro.message, true);
        evento.target.disabled = false;
      }
    });
    return;
  }

  acoes.innerHTML = `
    <button class="btn btn--lilac" type="button" data-reservar ${esgotado ? 'disabled' : ''}>
      ${esgotado ? 'Indisponível' : 'Fazer pré-reserva'}
    </button>
    <a href="catalogo.html#${escaparHtml(livro.materia_slug)}" class="btn btn--outline">
      Ver outros de ${escaparHtml(livro.materia_nome)}
    </a>`;

  if (esgotado) return;

  acoes.querySelector('[data-reservar]').addEventListener('click', async (evento) => {
    evento.target.disabled = true;
    try {
      await api.reservar(livro.id);
      await desenhar();
    } catch (erro) {
      mostrarAviso(erro.message, true);
      evento.target.disabled = false;
    }
  });
}
