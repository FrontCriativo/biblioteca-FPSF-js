import { api, cartaoLivro, escaparHtml, montarSessaoNavbar } from './api.js';

const grade = document.querySelector('[data-catalogo]');
const filtros = document.querySelector('[data-filtros]');
const campoBusca = document.querySelector('[data-catalog-search]');

let materias = [];
let materiaAtiva = 'todos';
let termoBusca = '';

/** Matéria indicada no hash da URL (catalogo.html#ciencias); hash desconhecido vale "todos". */
function materiaDoHash() {
  const slug = decodeURIComponent(location.hash.slice(1));
  return materias.some((m) => m.slug === slug) ? slug : 'todos';
}

function blocoMateria(materia, livros) {
  const plural = livros.length === 1 ? 'livro' : 'livros';
  return `
    <div class="category-block" id="${escaparHtml(materia.slug)}">
      <div class="category-block__head">
        <img src="assets/${escaparHtml(materia.icone)}" alt="">
        <h3>${escaparHtml(materia.nome)}</h3>
        <span>${livros.length} ${plural}</span>
      </div>
      <div class="book-grid">${livros.map(cartaoLivro).join('')}</div>
    </div>`;
}

function blocoVazio(materia) {
  return `
    <div class="category-block" id="${escaparHtml(materia.slug)}">
      <div class="category-block__head">
        <img src="assets/${escaparHtml(materia.icone)}" alt="">
        <h3>${escaparHtml(materia.nome)}</h3>
        <span>em breve</span>
      </div>
      <div class="empty-state">
        Ainda não adicionamos livros de ${escaparHtml(materia.nome)} à estante virtual.
        Assim que chegarem, eles aparecem aqui.
      </div>
    </div>`;
}

// Na visão "Todos", as matérias sem livros viram uma única linha no fim.
function linhaEmBreve(vazias) {
  return `<p class="em-breve">Em breve: ${vazias.map((m) => escaparHtml(m.nome)).join(', ')}.</p>`;
}

async function desenhar() {
  const livros = await api.livros({ materia: materiaAtiva, busca: termoBusca });

  const porMateria = new Map();
  for (const livro of livros) {
    if (!porMateria.has(livro.materia_slug)) porMateria.set(livro.materia_slug, []);
    porMateria.get(livro.materia_slug).push(livro);
  }

  if (termoBusca && livros.length === 0) {
    grade.innerHTML = `<div class="empty-state">Nenhum título encontrado para “${escaparHtml(termoBusca)}”.</div>`;
    return;
  }

  // Uma matéria específica: a API já devolveu só os livros dela.
  if (materiaAtiva !== 'todos') {
    const materia = materias.find((m) => m.slug === materiaAtiva);
    grade.innerHTML = livros.length ? blocoMateria(materia, livros) : blocoVazio(materia);
    return;
  }

  const comLivros = materias.filter((m) => porMateria.has(m.slug));
  const vazias = materias.filter((m) => !porMateria.has(m.slug));
  grade.innerHTML = comLivros.map((m) => blocoMateria(m, porMateria.get(m.slug))).join('')
    + (vazias.length && !termoBusca ? linhaEmBreve(vazias) : '');
}

function marcarChipAtivo() {
  filtros.querySelectorAll('.chip').forEach((c) => {
    c.classList.toggle('is-active', c.dataset.subject === materiaAtiva);
  });
}

function selecionarMateria(slug) {
  if (slug === materiaAtiva) return;
  materiaAtiva = slug;
  marcarChipAtivo();
  desenhar();
}

function montarFiltros() {
  filtros.innerHTML = [
    `<button class="chip${materiaAtiva === 'todos' ? ' is-active' : ''}" data-subject="todos">Todos</button>`,
    ...materias.map((m) => `
      <button class="chip${materiaAtiva === m.slug ? ' is-active' : ''}" data-subject="${escaparHtml(m.slug)}">
        <img src="assets/${escaparHtml(m.icone)}" alt="">${escaparHtml(m.nome)}
      </button>`),
  ].join('');

  // O filtro vai para o hash da URL (catalogo.html#ciencias), para o link poder ser
  // copiado e o "voltar" do navegador desfazer o filtro.
  filtros.addEventListener('click', (evento) => {
    const chip = evento.target.closest('.chip');
    if (!chip) return;
    const slug = chip.dataset.subject;
    const hash = slug === 'todos' ? '' : `#${encodeURIComponent(slug)}`;
    if (location.hash !== hash) history.pushState(null, '', location.pathname + location.search + hash);
    selecionarMateria(slug);
  });
}

// Links do rodapé (catalogo.html#historia) clicados com o catálogo já aberto, e o
// "voltar"/"avançar" do navegador, só mudam o hash: a página não recarrega.
function aoMudarHash() {
  const slug = materiaDoHash();
  if (slug === materiaAtiva) return;
  selecionarMateria(slug);
  filtros.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
window.addEventListener('hashchange', aoMudarHash);
window.addEventListener('popstate', aoMudarHash);

let idDebounce;
campoBusca?.addEventListener('input', () => {
  clearTimeout(idDebounce);
  idDebounce = setTimeout(() => {
    termoBusca = campoBusca.value.trim();
    desenhar();
  }, 220);
});

const buscaInicial = new URLSearchParams(location.search).get('busca');
if (buscaInicial && campoBusca) {
  termoBusca = buscaInicial;
  campoBusca.value = buscaInicial;
}

montarSessaoNavbar();
materias = await api.materias();
materiaAtiva = materiaDoHash();
montarFiltros();
await desenhar();
