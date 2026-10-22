// Página inicial: prateleiras montadas a partir do acervo real.

import { api, cartaoLivro, escaparHtml, montarSessaoNavbar } from './api.js';

// Cada prateleira junta os livros de uma ou mais matérias.
// Prateleira sem nenhum livro não aparece.
const PRATELEIRAS = [
  { titulo: 'Clássicos da Literatura', materias: ['literatura'] },
  { titulo: 'Ciência & Pensamento', materias: ['ciencias', 'filosofia'] },
];

const alvo = document.querySelector('[data-prateleiras]');

function prateleira({ titulo, materias }, livros) {
  return `
    <section class="shelf container">
      <div class="shelf__head">
        <h2>${escaparHtml(titulo)}</h2>
        <a href="catalogo.html#${escaparHtml(materias[0])}">Ver todos →</a>
      </div>
      <div class="shelf__row">${livros.map(cartaoLivro).join('')}</div>
      <div class="shelf__wood"></div>
    </section>`;
}

async function desenharPrateleiras() {
  let livros;
  try {
    livros = await api.livros();
  } catch (erro) {
    alvo.innerHTML = `
      <section class="shelf container">
        <div class="empty-state">Não foi possível carregar os livros: ${escaparHtml(erro.message)}</div>
      </section>`;
    return;
  }

  alvo.innerHTML = PRATELEIRAS.map((p) => {
    const doGrupo = livros.filter((l) => p.materias.includes(l.materia_slug));
    return doGrupo.length ? prateleira(p, doGrupo) : '';
  }).join('');
}

// Cada botão de "Explore por matéria" ganha a quantidade de livros da matéria.
async function contarLivrosPorMateria() {
  let materias;
  try {
    materias = await api.materias();
  } catch {
    return; // sem a contagem, os botões continuam funcionando
  }
  for (const m of materias) {
    const botao = document.querySelector(`.subject-chip[href="catalogo.html#${m.slug}"]`);
    if (!botao) continue;
    const qtd = document.createElement('span');
    qtd.className = 'subject-chip__qtd';
    qtd.textContent = m.total_livros === 0 ? 'em breve'
      : `${m.total_livros} ${m.total_livros === 1 ? 'livro' : 'livros'}`;
    botao.appendChild(qtd);
  }
}

montarSessaoNavbar();
desenharPrateleiras();
contarLivrosPorMateria();
