import { api, escaparHtml, formatarData, ROTULOS_STATUS, montarSessaoNavbar } from './api.js';

const usuario = await montarSessaoNavbar();

if (!usuario) {
  location.href = 'login.html?destino=admin.html';
} else if (usuario.papel !== 'admin') {
  document.querySelector('[data-admin]').innerHTML = `
    <div class="empty-state">
      Esta área é restrita à coordenação da biblioteca.
      <a href="index.html">Voltar ao início</a>.
    </div>`;
} else {
  iniciar();
}

function aviso(texto, erro = false) {
  const caixa = document.querySelector('[data-aviso-global]');
  caixa.textContent = texto;
  caixa.className = `admin-aviso${erro ? ' admin-aviso--erro' : ''}`;
  caixa.style.display = 'block';
  clearTimeout(aviso.id);
  aviso.id = setTimeout(() => { caixa.style.display = 'none'; }, 4000);
}

async function comFeedback(acao, mensagemOk) {
  try {
    await acao();
    aviso(mensagemOk);
    return true;
  } catch (erro) {
    aviso(erro.message, true);
    return false;
  }
}

function iniciar() {
  document.querySelector('[data-admin]').hidden = false;

  document.querySelectorAll('.admin-tab').forEach((aba) => {
    aba.addEventListener('click', () => {
      document.querySelectorAll('.admin-tab').forEach((a) => a.classList.toggle('is-active', a === aba));
      document.querySelectorAll('[data-painel]').forEach((p) => {
        p.hidden = p.dataset.painel !== aba.dataset.aba;
      });
      if (aba.dataset.aba === 'usuarios') carregarUsuarios();
    });
  });

  document.querySelector('[data-filtro-status]').addEventListener('change', carregarReservas);
  montarFormularioLivro();
  recarregarTudo();
}

async function recarregarTudo() {
  await Promise.all([carregarResumo(), carregarReservas(), carregarLivros()]);
}

async function carregarResumo() {
  const resumo = await api.resumo();
  const cartoes = [
    ['Livros no acervo', resumo.livros],
    ['Exemplares', resumo.exemplares],
    ['Reservas aguardando', resumo.reservas_ativas],
    ['Com leitores', resumo.retiradas],
    ['Atrasados', resumo.atrasadas, resumo.atrasadas > 0],
    ['Alunos cadastrados', resumo.usuarios],
  ];
  document.querySelector('[data-resumo]').innerHTML = cartoes.map(([rotulo, valor, alerta]) => `
    <div class="stat-card${alerta ? ' stat-card--alerta' : ''}">
      <span class="stat-card__valor">${valor}</span>
      <span class="stat-card__rotulo">${rotulo}</span>
    </div>`).join('');
}

async function carregarReservas() {
  const status = document.querySelector('[data-filtro-status]').value;
  const reservas = await api.todasReservas(status);
  const corpo = document.querySelector('[data-tabela-reservas]');

  if (!reservas.length) {
    corpo.innerHTML = `<tr><td colspan="7" class="tabela-vazia">Nenhuma reserva neste filtro.</td></tr>`;
    return;
  }

  corpo.innerHTML = reservas.map((r) => `
    <tr>
      <td>
        <div class="cel-livro">
          <img src="assets/${escaparHtml(r.capa)}" alt="">
          <div>
            <strong>${escaparHtml(r.titulo)}</strong>
            <span>${escaparHtml(r.exemplar_codigo)}</span>
          </div>
        </div>
      </td>
      <td>
        <strong>${escaparHtml(r.usuario_nome)}</strong>
        <span class="cel-sub">${escaparHtml(r.turma ?? r.usuario_email)}</span>
      </td>
      <td>${formatarData(r.criada_em)}</td>
      <td>${r.status === 'ativa' ? formatarData(r.expira_em) : '—'}</td>
      <td${r.atrasada ? ' class="prazo-atrasado"' : ''}>
        ${r.status === 'retirada' && r.devolver_ate ? formatarData(r.devolver_ate) : '—'}
        ${r.atrasada ? '<span class="cel-sub prazo-atrasado">atrasado</span>' : ''}
      </td>
      <td><span class="selo selo--${r.status}">${ROTULOS_STATUS[r.status]}</span></td>
      <td class="cel-acoes">
        ${r.status === 'ativa' ? `<button class="mini-btn" data-retirar="${r.id}">Retirado</button>` : ''}
        ${r.status === 'retirada' ? `<button class="mini-btn" data-devolver="${r.id}">Devolvido</button>` : ''}
        ${['ativa', 'retirada'].includes(r.status)
          ? `<button class="mini-btn mini-btn--perigo" data-cancelar="${r.id}">Cancelar</button>` : ''}
      </td>
    </tr>`).join('');
}

document.addEventListener('click', async (evento) => {
  const alvo = evento.target.closest('[data-retirar], [data-devolver], [data-cancelar], [data-excluir], [data-add-exemplar]');
  if (!alvo) return;
  alvo.disabled = true;

  const { retirar, devolver, cancelar, excluir, addExemplar } = alvo.dataset;
  let ok = false;

  if (retirar) ok = await comFeedback(() => api.marcarRetirada(retirar), 'Retirada registrada.');
  if (devolver) ok = await comFeedback(() => api.marcarDevolvida(devolver), 'Devolução registrada.');
  if (cancelar) ok = await comFeedback(() => api.cancelarReserva(cancelar), 'Reserva cancelada.');
  if (addExemplar) ok = await comFeedback(() => api.adicionarExemplares(addExemplar, 1), 'Exemplar adicionado.');
  if (excluir) {
    if (!confirm('Remover este livro do acervo? A ação não pode ser desfeita.')) {
      alvo.disabled = false;
      return;
    }
    ok = await comFeedback(() => api.removerLivro(excluir), 'Livro removido.');
    if (ok) document.dispatchEvent(new CustomEvent('livro-removido', { detail: excluir }));
  }

  alvo.disabled = false;
  if (ok) recarregarTudo();
});

// Livros da tabela do acervo, por id: o botão "Editar" preenche o formulário a partir daqui.
let livrosDoAcervo = new Map();

async function carregarLivros() {
  const livros = await api.livros();
  livrosDoAcervo = new Map(livros.map((l) => [String(l.id), l]));
  document.querySelector('[data-tabela-livros]').innerHTML = livros.map((l) => `
    <tr>
      <td>
        <div class="cel-livro">
          <img src="assets/${escaparHtml(l.capa)}" alt="">
          <div>
            <strong>${escaparHtml(l.titulo)}</strong>
            <span>${escaparHtml(l.autor)}</span>
          </div>
        </div>
      </td>
      <td>${escaparHtml(l.materia_nome)}</td>
      <td>${l.total_exemplares}</td>
      <td>
        <span class="selo ${l.disponiveis ? 'selo--ativa' : 'selo--cancelada'}">
          ${l.disponiveis} ${l.disponiveis === 1 ? 'livre' : 'livres'}
        </span>
      </td>
      <td class="cel-acoes">
        <button class="mini-btn" data-editar="${l.id}">Editar</button>
        <button class="mini-btn" data-add-exemplar="${l.id}">+ exemplar</button>
        <button class="mini-btn mini-btn--perigo" data-excluir="${l.id}">Remover</button>
      </td>
    </tr>`).join('');
}

async function montarFormularioLivro() {
  const materias = await api.materias();
  const select = document.querySelector('#novo-materia');
  select.innerHTML = materias
    .map((m) => `<option value="${escaparHtml(m.slug)}">${escaparHtml(m.nome)}</option>`)
    .join('');

  const capa = montarDropzoneCapa();
  const form = document.querySelector('[data-form-livro]');
  const titulo = form.querySelector('[data-form-livro-titulo]');
  const botaoEnviar = form.querySelector('[type="submit"]');
  const botaoCancelar = form.querySelector('[data-cancelar-edicao]');
  const campoExemplares = form.querySelector('[data-campo-exemplares]');
  let editando = null; // livro em edição, ou null quando o formulário cria um livro novo

  function modoCriar() {
    editando = null;
    form.reset();
    capa.limpar();
    form.classList.remove('is-editando');
    titulo.textContent = 'Adicionar livro';
    botaoEnviar.textContent = 'Adicionar ao acervo';
    botaoCancelar.hidden = true;
    campoExemplares.hidden = false;
    campoExemplares.querySelector('input').disabled = false;
  }

  function modoEditar(livro) {
    modoCriar();
    editando = livro;
    form.titulo.value = livro.titulo;
    form.autor.value = livro.autor;
    form.materia_slug.value = livro.materia_slug;
    form.paginas.value = livro.paginas ?? '';
    form.sinopse.value = livro.sinopse ?? '';
    capa.mostrarAtual(livro.capa);
    form.classList.add('is-editando');
    titulo.textContent = `Editar “${livro.titulo}”`;
    botaoEnviar.textContent = 'Salvar alterações';
    botaoCancelar.hidden = false;
    campoExemplares.hidden = true;
    campoExemplares.querySelector('input').disabled = true; // fora do FormData e do "required"
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
    form.titulo.focus({ preventScroll: true });
  }

  botaoCancelar.addEventListener('click', modoCriar);

  document.querySelector('[data-tabela-livros]').addEventListener('click', (evento) => {
    const botao = evento.target.closest('[data-editar]');
    const livro = botao && livrosDoAcervo.get(botao.dataset.editar);
    if (livro) modoEditar(livro);
  });

  // Livro removido enquanto estava no formulário: volta ao modo de criação.
  document.addEventListener('livro-removido', (evento) => {
    if (editando && String(editando.id) === evento.detail) modoCriar();
  });

  form.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    botaoEnviar.disabled = true;
    const emEdicao = editando;
    const enviado = await comFeedback(async () => {
      // A imagem só sobe no envio, para não deixar arquivos órfãos em assets/.
      if (capa.arquivo() && !form.querySelector('[data-capa-nome]').value) {
        const { arquivo } = await api.enviarCapa(capa.arquivo().name, await lerBase64(capa.arquivo()));
        form.querySelector('[data-capa-nome]').value = arquivo;
      }
      const dados = Object.fromEntries(new FormData(form));
      if (emEdicao) {
        // O formulário não tem idioma: manda o atual para o PUT não trocá-lo pelo padrão.
        await api.atualizarLivro(emEdicao.id, { ...dados, idioma: emEdicao.idioma });
      } else {
        await api.criarLivro(dados);
      }
    }, emEdicao ? 'Alterações salvas.' : 'Livro adicionado ao acervo.');
    botaoEnviar.disabled = false;
    if (enviado) {
      modoCriar();
      recarregarTudo();
    }
  });
}

const TIPOS_CAPA = ['image/png', 'image/jpeg', 'image/webp'];
const TAMANHO_MAX_CAPA = 5 * 1024 * 1024;

function montarDropzoneCapa() {
  const zona = document.querySelector('[data-dropzone]');
  const entrada = zona.querySelector('input[type="file"]');
  const preview = zona.querySelector('.dropzone__preview');
  const texto = zona.querySelector('.dropzone__texto');
  const textoInicial = texto.innerHTML;
  const nomeSalvo = document.querySelector('[data-capa-nome]');
  let escolhido = null;

  function escolher(arquivo) {
    if (!arquivo) return;
    if (!TIPOS_CAPA.includes(arquivo.type)) return aviso('A capa deve ser uma imagem JPG, PNG ou WEBP.', true);
    if (arquivo.size > TAMANHO_MAX_CAPA) return aviso('A imagem da capa deve ter no máximo 5 MB.', true);
    escolhido = arquivo;
    nomeSalvo.value = '';
    URL.revokeObjectURL(preview.src);
    preview.src = URL.createObjectURL(arquivo);
    preview.hidden = false;
    texto.textContent = `${arquivo.name} — clique ou arraste outra para trocar`;
  }

  entrada.addEventListener('change', () => escolher(entrada.files[0]));
  zona.addEventListener('dragover', (evento) => {
    evento.preventDefault();
    zona.classList.add('is-arrastando');
  });
  zona.addEventListener('dragleave', () => zona.classList.remove('is-arrastando'));
  zona.addEventListener('drop', (evento) => {
    evento.preventDefault();
    zona.classList.remove('is-arrastando');
    escolher(evento.dataTransfer.files[0]);
  });

  return {
    arquivo: () => escolhido,
    /** Edição: mostra a capa já salva; ela continua valendo até outra imagem ser escolhida. */
    mostrarAtual(nomeArquivo) {
      escolhido = null;
      entrada.value = '';
      nomeSalvo.value = nomeArquivo ?? '';
      if (!nomeArquivo) return;
      URL.revokeObjectURL(preview.src);
      preview.src = `assets/${nomeArquivo}`;
      preview.hidden = false;
      texto.textContent = 'Capa atual — clique ou arraste outra imagem para trocar';
    },
    limpar() {
      escolhido = null;
      entrada.value = '';
      nomeSalvo.value = ''; // form.reset() não limpa input hidden
      URL.revokeObjectURL(preview.src);
      preview.removeAttribute('src');
      preview.hidden = true;
      texto.innerHTML = textoInicial;
    },
  };
}

function lerBase64(arquivo) {
  return new Promise((resolver, rejeitar) => {
    const leitor = new FileReader();
    leitor.onload = () => resolver(leitor.result.split(',')[1]);
    leitor.onerror = () => rejeitar(new Error('Não foi possível ler a imagem.'));
    leitor.readAsDataURL(arquivo);
  });
}

async function carregarUsuarios() {
  const usuarios = await api.usuarios();
  document.querySelector('[data-tabela-usuarios]').innerHTML = usuarios.map((u) => `
    <tr>
      <td><strong>${escaparHtml(u.nome)}</strong></td>
      <td>${escaparHtml(u.email)}</td>
      <td>${escaparHtml(u.turma ?? '—')}</td>
      <td><span class="selo selo--${u.papel === 'admin' ? 'retirada' : 'ativa'}">${u.papel}</span></td>
      <td>${u.reservas_ativas}</td>
    </tr>`).join('');

  const form = document.querySelector('[data-form-usuario]');
  if (form.dataset.pronto) return;
  form.dataset.pronto = '1';
  form.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    const dados = Object.fromEntries(new FormData(evento.target));
    const enviado = await comFeedback(() => api.criarUsuario(dados), 'Usuário cadastrado.');
    if (enviado) {
      evento.target.reset();
      carregarUsuarios();
      carregarResumo();
    }
  });
}
