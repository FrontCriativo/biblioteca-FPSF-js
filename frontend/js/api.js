// Cliente da API da Biblioteca Virtual.
// Todas as chamadas mandam o cookie de sessão e normalizam o erro do servidor.

async function pedir(caminho, opcoes = {}) {
  const resposta = await fetch(`/api${caminho}`, {
    credentials: 'same-origin',
    headers: opcoes.corpo ? { 'Content-Type': 'application/json' } : {},
    method: opcoes.metodo ?? 'GET',
    body: opcoes.corpo ? JSON.stringify(opcoes.corpo) : undefined,
  });

  const dados = resposta.status === 204 ? null : await resposta.json().catch(() => null);
  if (!resposta.ok) {
    throw new Error(dados?.erro ?? 'Não foi possível completar a operação.');
  }
  return dados;
}

export const api = {
  eu: () => pedir('/eu'),
  entrar: (email, senha) => pedir('/login', { metodo: 'POST', corpo: { email, senha } }),
  sair: () => pedir('/logout', { metodo: 'POST' }),
  trocarSenha: (senhaAtual, novaSenha) =>
    pedir('/eu/senha', { metodo: 'POST', corpo: { senha_atual: senhaAtual, nova_senha: novaSenha } }),

  materias: () => pedir('/materias'),
  livros: ({ materia, busca } = {}) => {
    const q = new URLSearchParams();
    if (materia && materia !== 'todos') q.set('materia', materia);
    if (busca) q.set('busca', busca);
    const sufixo = q.toString() ? `?${q}` : '';
    return pedir(`/livros${sufixo}`);
  },
  livro: (slug) => pedir(`/livros/${encodeURIComponent(slug)}`),
  criarLivro: (dados) => pedir('/livros', { metodo: 'POST', corpo: dados }),
  atualizarLivro: (id, dados) => pedir(`/livros/${id}`, { metodo: 'PUT', corpo: dados }),
  removerLivro: (id) => pedir(`/livros/${id}`, { metodo: 'DELETE' }),
  adicionarExemplares: (id, quantidade) =>
    pedir(`/livros/${id}/exemplares`, { metodo: 'POST', corpo: { quantidade } }),

  minhasReservas: () => pedir('/reservas'),
  reservar: (livroId) => pedir('/reservas', { metodo: 'POST', corpo: { livro_id: livroId } }),
  cancelarReserva: (id) => pedir(`/reservas/${id}/cancelar`, { metodo: 'POST' }),
  renovarReserva: (id) => pedir(`/reservas/${id}/renovar`, { metodo: 'POST' }),

  favoritos: () => pedir('/favoritos'),
  adicionarFavorito: (livroId) => pedir(`/favoritos/${livroId}`, { metodo: 'PUT' }),
  removerFavorito: (livroId) => pedir(`/favoritos/${livroId}`, { metodo: 'DELETE' }),

  enviarContato: (dados) => pedir('/contato', { metodo: 'POST', corpo: dados }),

  resumo: () => pedir('/admin/resumo'),
  todasReservas: (status) => {
    const sufixo = status && status !== 'todas' ? `?status=${status}` : '';
    return pedir(`/admin/reservas${sufixo}`);
  },
  marcarRetirada: (id) => pedir(`/admin/reservas/${id}/retirar`, { metodo: 'POST' }),
  marcarDevolvida: (id) => pedir(`/admin/reservas/${id}/devolver`, { metodo: 'POST' }),
  renovarEmprestimo: (id) => pedir(`/admin/reservas/${id}/renovar`, { metodo: 'POST' }),
  salvarObservacao: (id, observacao) =>
    pedir(`/admin/reservas/${id}/observacao`, { metodo: 'PUT', corpo: { observacao } }),
  enviarCapa: (nome, dados) => pedir('/admin/capas', { metodo: 'POST', corpo: { nome, dados } }),
  usuarios: () => pedir('/admin/usuarios'),
  criarUsuario: (dados) => pedir('/admin/usuarios', { metodo: 'POST', corpo: dados }),
  desativarUsuario: (id) => pedir(`/admin/usuarios/${id}/desativar`, { metodo: 'POST' }),
  reativarUsuario: (id) => pedir(`/admin/usuarios/${id}/reativar`, { metodo: 'POST' }),
  turmas: () => pedir('/admin/turmas'),

  depoimentos: () => pedir('/depoimentos'),
  enviarDepoimento: (dados) => pedir('/depoimentos', { metodo: 'POST', corpo: dados }),
  depoimentosAdmin: (status) => {
    const sufixo = status && status !== 'todos' ? `?status=${status}` : '';
    return pedir(`/admin/depoimentos${sufixo}`);
  },
  aprovarDepoimento: (id) => pedir(`/admin/depoimentos/${id}/aprovar`, { metodo: 'POST' }),
  recusarDepoimento: (id) => pedir(`/admin/depoimentos/${id}/recusar`, { metodo: 'POST' }),

  mensagensAdmin: (status) => {
    const sufixo = status && status !== 'todas' ? `?status=${status}` : '';
    return pedir(`/admin/mensagens${sufixo}`);
  },
  mudarStatusMensagem: (id, status) =>
    pedir(`/admin/mensagens/${id}/status`, { metodo: 'POST', corpo: { status } }),
};

export function escaparHtml(texto) {
  return String(texto ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

export function formatarData(iso) {
  if (!iso) return '—';
  // O SQLite devolve "YYYY-MM-DD HH:MM:SS" em UTC.
  const data = new Date(iso.replace(' ', 'T') + 'Z');
  return data.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/** Cartão de livro com capa e disponibilidade (catálogo e prateleiras da página inicial). */
export function cartaoLivro(livro) {
  const esgotado = livro.disponiveis === 0;
  const rotulo = esgotado
    ? 'Sem exemplar livre'
    : `${livro.disponiveis} de ${livro.total_exemplares} ${livro.disponiveis === 1 ? 'disponível' : 'disponíveis'}`;

  return `
    <a class="book" href="livro.html?titulo=${encodeURIComponent(livro.slug)}">
      <div class="book__cover">
        <img src="assets/${escaparHtml(livro.capa)}" alt="Capa de ${escaparHtml(livro.titulo)}">
      </div>
      <span class="book__title">${escaparHtml(livro.titulo)}</span>
      <span class="book__author">${escaparHtml(livro.autor)}</span>
      <span class="disp-tag ${esgotado ? 'disp-tag--fora' : 'disp-tag--ok'}">${rotulo}</span>
    </a>`;
}

const ESTRELA_VAZIA = 'assets/estrela.png';
const ESTRELA_CHEIA = 'assets/depoimentoPreenchido.png';

/** Cartão de depoimento aprovado (página inicial e página de depoimentos). */
export function cartaoDepoimento({ nome, turma, mensagem, nota }) {
  const estrelas = [1, 2, 3, 4, 5].map((n) => (n <= nota
    ? `<img class="estrela estrela--cheia" src="${ESTRELA_CHEIA}" alt="">`
    : `<img class="estrela" src="${ESTRELA_VAZIA}" alt="">`)).join('');

  return `
    <div class="quote-card">
      <div class="quote-card__stars" role="img" aria-label="Nota ${Number(nota)} de 5">${estrelas}</div>
      <p>${escaparHtml(mensagem)}</p>
      <div class="quote-card__who">
        <img src="assets/userRoxo.png" alt="">
        <div><strong>${escaparHtml(nome)}</strong><span>${escaparHtml(turma)}</span></div>
      </div>
    </div>`;
}

export const ROTULOS_STATUS = {
  ativa: 'Aguardando retirada',
  retirada: 'Com o leitor',
  devolvida: 'Devolvida',
  cancelada: 'Cancelada',
};

function ligarMenuMobile() {
  const toggle = document.querySelector('.nav-toggle');
  const links = document.querySelector('.nav-links');
  toggle?.addEventListener('click', () => links?.classList.toggle('is-aberto'));
}

function ligarBotaoTema() {
  const botao = document.querySelector('[data-toggle-tema]');
  if (!botao) return;

  const icone = botao.querySelector('span');
  const atualizarIcone = (escuro) => {
    if (icone) icone.textContent = escuro ? '☀️' : '🌙';
    botao.setAttribute('aria-label', escuro ? 'Ativar modo claro' : 'Ativar modo escuro');
  };
  atualizarIcone(document.documentElement.getAttribute('data-tema') === 'escuro');

  botao.addEventListener('click', () => {
    const escuro = document.documentElement.getAttribute('data-tema') !== 'escuro';
    document.documentElement.setAttribute('data-tema', escuro ? 'escuro' : 'claro');
    localStorage.setItem('tema', escuro ? 'escuro' : 'claro');
    atualizarIcone(escuro);
  });
}

function ligarMostrarSenha() {
  document.querySelectorAll('[data-toggle-password]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const input = document.querySelector(btn.getAttribute('data-toggle-password'));
      if (!input) return;
      const escondida = input.type === 'password';
      input.type = escondida ? 'text' : 'password';
      const img = btn.querySelector('img');
      if (img) img.src = escondida ? 'assets/esconder.png' : 'assets/mostrar.png';
    });
  });
}

/**
 * Prepara a navbar da página: comportamentos comuns e o estado de sessão.
 * Devolve o usuário logado, ou null.
 */
export function ligarNavbarBasica() {
  ligarMenuMobile();
  ligarMostrarSenha();
  ligarBotaoTema();
}

export async function montarSessaoNavbar() {
  ligarNavbarBasica();

  let usuario = null;
  try {
    usuario = await api.eu();
  } catch {
    usuario = null;
  }

  const paginaAtual = location.pathname.split('/').pop();

  // Senha provisória: o resto do site fica fechado até a troca.
  if (usuario?.trocar_senha && paginaAtual !== 'trocar-senha.html') {
    location.replace('trocar-senha.html');
    return new Promise(() => {}); // a página para aqui enquanto o navegador muda de endereço
  }

  const acoes = document.querySelector('.nav-actions');
  if (!acoes) return usuario;

  const entrar = acoes.querySelector('a[href="login.html"]');
  if (!usuario) {
    entrar?.style.removeProperty('display');
    return null;
  }

  entrar?.style.setProperty('display', 'none');

  const ehAdmin = usuario.papel === 'admin';
  const links = document.querySelector('.nav-links');

  // "Minhas reservas" fica no menu central. Admin: tira "Início" e "Fale conosco" e ganha também "Admin".
  if (links) {
    if (ehAdmin) {
      links.querySelectorAll('a[href="index.html"], a[href="contato.html"]').forEach((a) => a.closest('li')?.remove());
    }
    const itens = [['minhas-reservas.html', 'Minhas reservas']];
    if (ehAdmin) itens.push(['admin.html', 'Admin']);
    // No celular o menu do usuário esconde o link: ele entra no menu sanduíche.
    itens.push(['trocar-senha.html', 'Trocar senha', 'nav-links__so-mobile']);
    itens.forEach(([href, texto, classe]) => {
      if (links.querySelector(`a[href="${href}"]`)) return;
      const li = document.createElement('li');
      if (classe) li.className = classe;
      li.innerHTML = `<a href="${href}"${paginaAtual === href ? ' class="active"' : ''}>${texto}</a>`;
      links.appendChild(li);
    });
  }

  const menu = document.createElement('div');
  menu.className = 'nav-user';
  menu.innerHTML = `
    <span class="nav-user__nome">${escaparHtml(usuario.nome.split(' ')[0])}</span>
    <a class="nav-user__link" href="trocar-senha.html">Trocar senha</a>
    <button class="btn btn--ghost-light" type="button" data-sair>Sair</button>
  `;
  acoes.insertBefore(menu, acoes.querySelector('.nav-toggle'));

  menu.querySelector('[data-sair]').addEventListener('click', async () => {
    await api.sair();
    location.href = 'index.html';
  });

  return usuario;
}
