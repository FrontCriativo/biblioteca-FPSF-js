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

/** mensagemOk pode ser uma função, para montar o texto com o resultado da ação. */
async function comFeedback(acao, mensagemOk) {
  try {
    const resultado = await acao();
    aviso(typeof mensagemOk === 'function' ? mensagemOk(resultado) : mensagemOk);
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
      if (aba.dataset.aba === 'depoimentos') carregarDepoimentos();
      if (aba.dataset.aba === 'mensagens') carregarMensagens();
    });
  });

  document.querySelector('[data-filtro-status]').addEventListener('change', carregarReservas);
  document.querySelector('[data-filtro-depoimentos]').addEventListener('change', carregarDepoimentos);
  document.querySelector('[data-filtro-mensagens]').addEventListener('change', carregarMensagens);
  montarFormularioLivro();
  montarDialogoObservacao();
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
    ['Mensagens novas', resumo.mensagens_novas],
    ['Depoimentos pendentes', resumo.depoimentos_pendentes],
  ];
  document.querySelector('[data-resumo]').innerHTML = cartoes.map(([rotulo, valor, alerta]) => `
    <div class="stat-card${alerta ? ' stat-card--alerta' : ''}">
      <span class="stat-card__valor">${valor}</span>
      <span class="stat-card__rotulo">${rotulo}</span>
    </div>`).join('');
}

// Reservas da tabela, por id: o botão "Observação" abre o diálogo a partir daqui.
let reservasDaTabela = new Map();

async function carregarReservas() {
  const status = document.querySelector('[data-filtro-status]').value;
  const reservas = await api.todasReservas(status);
  reservasDaTabela = new Map(reservas.map((r) => [String(r.id), r]));
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
        ${r.retirada_em ? `<span class="cel-sub">retirado em ${formatarData(r.retirada_em)}</span>` : ''}
        ${r.renovacoes ? `<span class="cel-sub">${r.renovacoes} ${r.renovacoes === 1 ? 'renovação' : 'renovações'}</span>` : ''}
      </td>
      <td>
        <span class="selo selo--${r.status}">${ROTULOS_STATUS[r.status]}</span>
        ${r.observacao ? `<span class="cel-sub cel-observacao">${escaparHtml(r.observacao)}</span>` : ''}
      </td>
      <td>
        <div class="cel-acoes">
          ${r.status === 'ativa' ? `<button class="mini-btn" data-retirar="${r.id}">Retirado</button>` : ''}
          ${r.status === 'retirada' ? `<button class="mini-btn" data-devolver="${r.id}">Devolvido</button>` : ''}
          ${r.status === 'retirada' ? `<button class="mini-btn" data-renovar="${r.id}">Renovar</button>` : ''}
          <button class="mini-btn" data-observacao="${r.id}">Observação</button>
          ${['ativa', 'retirada'].includes(r.status)
            ? `<button class="mini-btn mini-btn--perigo" data-cancelar="${r.id}">Cancelar</button>` : ''}
        </div>
      </td>
    </tr>`).join('');
}

function montarDialogoObservacao() {
  const dialogo = document.querySelector('[data-dialogo-observacao]');
  const form = dialogo.querySelector('form');
  let reserva = null;

  document.querySelector('[data-tabela-reservas]').addEventListener('click', (evento) => {
    const botao = evento.target.closest('[data-observacao]');
    reserva = botao && reservasDaTabela.get(botao.dataset.observacao);
    if (!reserva) return;
    dialogo.querySelector('[data-observacao-livro]').textContent = `${reserva.titulo} — ${reserva.usuario_nome}`;
    form.observacao.value = reserva.observacao ?? '';
    dialogo.showModal();
  });

  dialogo.querySelector('[data-fechar-observacao]').addEventListener('click', () => dialogo.close());

  form.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    const salva = await comFeedback(() => api.salvarObservacao(reserva.id, form.observacao.value), 'Observação salva.');
    if (!salva) return;
    dialogo.close();
    carregarReservas();
  });
}

document.addEventListener('click', async (evento) => {
  const alvo = evento.target.closest(
    '[data-retirar], [data-devolver], [data-cancelar], [data-excluir], [data-add-exemplar], [data-aprovar], [data-recusar], [data-renovar], [data-desativar], [data-reativar], [data-marcar-lida], [data-responder], [data-excluir-depoimento]'
  );
  if (!alvo) return;
  alvo.disabled = true;

  const {
    retirar, devolver, cancelar, excluir, addExemplar, aprovar, recusar, renovar, desativar, reativar, nome,
    marcarLida, responder, excluirDepoimento,
  } = alvo.dataset;
  let ok = false;

  if (marcarLida || responder) {
    const id = marcarLida ?? responder;
    const status = marcarLida ? 'lida' : 'respondida';
    ok = await comFeedback(
      () => api.mudarStatusMensagem(id, status),
      marcarLida ? 'Mensagem marcada como lida.' : 'Mensagem marcada como respondida.',
    );
    alvo.disabled = false;
    if (ok) {
      if (responder) abrirResposta(mensagensDaTabela.get(id));
      carregarMensagens();
      carregarResumo();
    }
    return;
  }

  if (desativar || reativar) {
    if (desativar && !confirm(`Desativar a conta de ${nome}? O acesso cai na hora e as pré-reservas ainda não retiradas são canceladas.`)) {
      alvo.disabled = false;
      return;
    }
    ok = desativar
      ? await comFeedback(() => api.desativarUsuario(desativar), ({ reservas_canceladas: n }) => `Conta desativada. Pré-reservas canceladas: ${n}.`)
      : await comFeedback(() => api.reativarUsuario(reativar), 'Conta reativada.');
    alvo.disabled = false;
    if (ok) {
      carregarUsuarios();
      recarregarTudo();
    }
    return;
  }

  if (aprovar) ok = await comFeedback(() => api.aprovarDepoimento(aprovar), 'Depoimento aprovado: ele já aparece no site.');
  if (recusar) ok = await comFeedback(() => api.recusarDepoimento(recusar), 'Depoimento recusado: ele saiu do site.');
  if (excluirDepoimento) {
    if (!confirm('Excluir este depoimento? Ele some do site e do painel, e a ação não pode ser desfeita.')) {
      alvo.disabled = false;
      return;
    }
    ok = await comFeedback(() => api.excluirDepoimento(excluirDepoimento), 'Depoimento excluído.');
  }
  if (aprovar || recusar || excluirDepoimento) {
    alvo.disabled = false;
    if (ok) {
      carregarDepoimentos();
      carregarResumo();
    }
    return;
  }

  if (retirar) ok = await comFeedback(() => api.marcarRetirada(retirar), 'Retirada registrada.');
  if (devolver) ok = await comFeedback(() => api.marcarDevolvida(devolver), 'Devolução registrada.');
  if (renovar) {
    ok = await comFeedback(() => api.renovarEmprestimo(renovar), (r) => `Renovado. Novo prazo: ${formatarData(r.devolver_ate)}.`);
  }
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
      <td>
        <div class="cel-acoes">
          <button class="mini-btn" data-editar="${l.id}">Editar</button>
          <button class="mini-btn" data-add-exemplar="${l.id}">+ exemplar</button>
          <button class="mini-btn mini-btn--perigo" data-excluir="${l.id}">Remover</button>
        </div>
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
  const [usuarios, turmas] = await Promise.all([api.usuarios(), api.turmas()]);
  document.querySelector('[data-lista-turmas]').innerHTML = turmas
    .map((t) => `<option value="${escaparHtml(t.nome)}"></option>`).join('');
  document.querySelector('[data-tabela-usuarios]').innerHTML = usuarios.map((u) => `
    <tr>
      <td><strong>${escaparHtml(u.nome)}</strong></td>
      <td>${escaparHtml(u.email)}</td>
      <td>${escaparHtml(u.turma ?? '—')}</td>
      <td><span class="selo selo--${u.papel === 'admin' ? 'retirada' : 'ativa'}">${u.papel}</span></td>
      <td>${u.reservas_ativas}</td>
      <td><span class="selo selo--${u.ativo ? 'devolvida' : 'cancelada'}">${u.ativo ? 'Ativa' : 'Desativada'}</span></td>
      <td><div class="cel-acoes">${botaoSituacao(u)}</div></td>
    </tr>`).join('');

  const form = document.querySelector('[data-form-usuario]');
  if (form.dataset.pronto) return;
  form.dataset.pronto = '1';
  document.querySelector('[data-form-importar]').addEventListener('submit', importarPlanilha);
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

// O Excel em português salva CSV em Windows-1252; o Google Planilhas, em UTF-8.
async function lerTextoDaPlanilha(arquivo) {
  const bytes = await arquivo.arrayBuffer();
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

async function importarPlanilha(evento) {
  evento.preventDefault();
  const form = evento.target;
  const arquivo = form.planilha.files[0];
  if (!/\.csv$/i.test(arquivo.name)) {
    aviso('Salve a planilha como CSV antes de enviar.', true);
    return;
  }
  const botao = form.querySelector('[data-botao-importar]');
  botao.disabled = true;
  botao.textContent = 'Importando...';
  let resultado;
  const enviado = await comFeedback(async () => {
    resultado = await api.importarAlunos(await lerTextoDaPlanilha(arquivo));
  }, 'Planilha processada.');
  botao.disabled = false;
  botao.textContent = 'Importar';
  if (!enviado) return;
  form.reset();
  mostrarImportacao(resultado);
  carregarUsuarios();
  carregarResumo();
}

function mostrarImportacao({ criados, ignorados, erros }) {
  const caixa = document.querySelector('[data-resultado-importacao]');
  caixa.hidden = false;
  caixa.innerHTML = `
    <p><strong>${criados.length}</strong> aluno(s) cadastrado(s) e <strong>${ignorados.length}</strong> já existente(s), que não mudaram.</p>
    ${criados.length ? `
      <p>As senhas provisórias só aparecem agora. Baixe a lista e entregue a cada aluno a sua senha.</p>
      <button class="btn btn--outline" type="button" data-baixar-senhas>Baixar senhas provisórias</button>` : ''}
    ${erros.length ? `
      <p><strong>${erros.length}</strong> linha(s) com problema. Corrija e envie de novo: quem já entrou não é duplicado.</p>
      <ul>${erros.map((e) => `<li>Linha ${e.linha}: ${escaparHtml(e.motivo)}</li>`).join('')}</ul>` : ''}`;
  caixa.querySelector('[data-baixar-senhas]')?.addEventListener('click', () => baixarSenhas(criados));
}

// O Excel executa como fórmula a célula que começa com estes sinais, e o nome veio de uma planilha.
const celulaCsv = (valor) => {
  const texto = String(valor ?? '');
  return `"${(/^[=+\-@]/.test(texto) ? `'${texto}` : texto).replaceAll('"', '""')}"`;
};

function baixarSenhas(criados) {
  const linhas = [['nome', 'email', 'turma', 'senha provisória'],
    ...criados.map((a) => [a.nome, a.email, a.turma, a.senha])];
  const csv = linhas.map((l) => l.map(celulaCsv).join(';')).join('\r\n');
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' }));
  link.download = 'senhas-provisorias.csv';
  link.click();
  URL.revokeObjectURL(link.href);
}

function botaoSituacao(u) {
  if (u.id === usuario.id) return ''; // a própria conta não pode ser desativada
  return u.ativo
    ? `<button class="mini-btn mini-btn--perigo" data-desativar="${u.id}" data-nome="${escaparHtml(u.nome)}">Desativar</button>`
    : `<button class="mini-btn" data-reativar="${u.id}">Reativar</button>`;
}

const ROTULOS_DEPOIMENTO = {
  pendente: ['Aguardando', 'ativa'],
  aprovado: ['Aprovado', 'devolvida'],
  recusado: ['Recusado', 'cancelada'],
};

async function carregarDepoimentos() {
  const corpo = document.querySelector('[data-tabela-depoimentos]');
  const status = document.querySelector('[data-filtro-depoimentos]').value;
  let depoimentos;
  try {
    depoimentos = await api.depoimentosAdmin(status);
  } catch (erro) {
    corpo.innerHTML = `<tr><td colspan="6" class="tabela-vazia">Não foi possível carregar: ${escaparHtml(erro.message)}</td></tr>`;
    return;
  }

  if (!depoimentos.length) {
    corpo.innerHTML = `<tr><td colspan="6" class="tabela-vazia">Nenhum depoimento neste filtro.</td></tr>`;
    return;
  }

  corpo.innerHTML = depoimentos.map((d) => {
    const [rotulo, selo] = ROTULOS_DEPOIMENTO[d.status];
    return `
    <tr>
      <td>
        <strong>${escaparHtml(d.nome)}</strong>
        <span class="cel-sub">${escaparHtml(d.turma)}</span>
        ${d.usuario_email ? `<span class="cel-sub">${escaparHtml(d.usuario_email)}</span>` : ''}
      </td>
      <td>${'★'.repeat(d.nota)}${'☆'.repeat(5 - d.nota)}</td>
      <td class="cel-mensagem">${escaparHtml(d.mensagem)}</td>
      <td>${formatarData(d.criado_em)}</td>
      <td><span class="selo selo--${selo}">${rotulo}</span></td>
      <td>
        <div class="cel-acoes">
          ${d.status !== 'aprovado' ? `<button class="mini-btn" data-aprovar="${d.id}">Aprovar</button>` : ''}
          ${d.status !== 'recusado' ? `<button class="mini-btn" data-recusar="${d.id}">Recusar</button>` : ''}
          <button class="mini-btn mini-btn--perigo" data-excluir-depoimento="${d.id}">Excluir</button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

const ROTULOS_MENSAGEM = {
  nova: ['Nova', 'ativa'],
  lida: ['Lida', 'retirada'],
  respondida: ['Respondida', 'devolvida'],
};

// Mensagens da tabela, por id: o botão "Responder" monta o e-mail a partir daqui.
let mensagensDaTabela = new Map();

/** Quem escreveu logado pode não ter informado e-mail: vale o da conta. */
const emailDeResposta = (m) => m.email ?? m.usuario_email;

function abrirResposta(mensagem) {
  // O e-mail vem de fora: sem codificar, um "?" nele acrescentaria campos ao mailto.
  const destino = encodeURIComponent(emailDeResposta(mensagem)).replace('%40', '@');
  const assunto = encodeURIComponent(`Re: ${mensagem.assunto} — Biblioteca Virtual FPSF`);
  location.href = `mailto:${destino}?subject=${assunto}`;
}

async function carregarMensagens() {
  const corpo = document.querySelector('[data-tabela-mensagens]');
  const status = document.querySelector('[data-filtro-mensagens]').value;
  let mensagens;
  try {
    mensagens = await api.mensagensAdmin(status);
  } catch (erro) {
    corpo.innerHTML = `<tr><td colspan="6" class="tabela-vazia">Não foi possível carregar: ${escaparHtml(erro.message)}</td></tr>`;
    return;
  }
  mensagensDaTabela = new Map(mensagens.map((m) => [String(m.id), m]));

  if (!mensagens.length) {
    corpo.innerHTML = `<tr><td colspan="6" class="tabela-vazia">Nenhuma mensagem neste filtro.</td></tr>`;
    return;
  }

  corpo.innerHTML = mensagens.map((m) => {
    const [rotulo, selo] = ROTULOS_MENSAGEM[m.status];
    const email = emailDeResposta(m);
    return `
    <tr>
      <td>
        <strong>${escaparHtml(m.nome)}</strong>
        ${m.turma ? `<span class="cel-sub">${escaparHtml(m.turma)}</span>` : ''}
        <span class="cel-sub">${escaparHtml(email ?? 'sem e-mail')}</span>
      </td>
      <td>${escaparHtml(m.assunto)}</td>
      <td class="cel-mensagem">${escaparHtml(m.mensagem)}</td>
      <td>${formatarData(m.criada_em)}</td>
      <td><span class="selo selo--${selo}">${rotulo}</span></td>
      <td>
        <div class="cel-acoes">
          ${m.status === 'nova' ? `<button class="mini-btn" data-marcar-lida="${m.id}">Marcar como lida</button>` : ''}
          ${email ? `<button class="mini-btn" data-responder="${m.id}">Responder por e-mail</button>` : ''}
        </div>
      </td>
    </tr>`;
  }).join('');
}
