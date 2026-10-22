import { api, cartaoLivro, escaparHtml, montarSessaoNavbar } from './api.js';

const grade = document.querySelector('[data-catalogo]');
const filtros = document.querySelector('[data-filtros]');
const campoBusca = document.querySelector('[data-catalog-search]');

let materiaAtiva = location.hash.slice(1) || 'todos';
let termoBusca = '';

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

async function desenhar() {
  const [materias, livros] = await Promise.all([
    api.materias(),
    api.livros({ materia: materiaAtiva, busca: termoBusca }),
  ]);

  const porMateria = new Map();
  for (const livro of livros) {
    if (!porMateria.has(livro.materia_slug)) porMateria.set(livro.materia_slug, []);
    porMateria.get(livro.materia_slug).push(livro);
  }

  const visiveis = materiaAtiva === 'todos'
    ? materias
    : materias.filter((m) => m.slug === materiaAtiva);

  if (termoBusca && livros.length === 0) {
    grade.innerHTML = `<div class="empty-state">Nenhum título encontrado para “${escaparHtml(termoBusca)}”.</div>`;
    return;
  }

  grade.innerHTML = visiveis.map((materia) => {
    const doGrupo = porMateria.get(materia.slug) ?? [];
    if (doGrupo.length) return blocoMateria(materia, doGrupo);
    return termoBusca ? '' : blocoVazio(materia);
  }).join('');
}

async function montarFiltros() {
  const materias = await api.materias();
  filtros.innerHTML = [
    `<button class="chip${materiaAtiva === 'todos' ? ' is-active' : ''}" data-subject="todos">Todos</button>`,
    ...materias.map((m) => `
      <button class="chip${materiaAtiva === m.slug ? ' is-active' : ''}" data-subject="${escaparHtml(m.slug)}">
        <img src="assets/${escaparHtml(m.icone)}" alt="">${escaparHtml(m.nome)}
      </button>`),
  ].join('');

  filtros.addEventListener('click', (evento) => {
    const chip = evento.target.closest('.chip');
    if (!chip) return;
    materiaAtiva = chip.dataset.subject;
    filtros.querySelectorAll('.chip').forEach((c) => c.classList.toggle('is-active', c === chip));
    desenhar();
  });
}

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
await montarFiltros();
await desenhar();
