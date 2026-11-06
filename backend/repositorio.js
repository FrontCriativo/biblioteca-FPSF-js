import { db, transacao } from './db/index.js';
import { normalizarTexto, buscaNormalizadaLivro } from './texto.js';

const DIAS_PARA_RETIRAR = 3;
const DIAS_PARA_DEVOLVER = 14;
// Reservas simultâneas (ativa + retirada) que um aluno pode ter. A coordenação não tem limite.
export const LIMITE_RESERVAS_ALUNO = 3;
// Cada renovação soma estes dias ao prazo. Só a coordenação passa do limite de vezes.
export const DIAS_RENOVACAO = 7;
export const LIMITE_RENOVACOES_ALUNO = 1;

// Livro retirado cujo prazo de devolução já passou.
const ATRASADA = "r.status = 'retirada' AND r.devolver_ate < datetime('now')";

// Empréstimo antigo sem prazo (devolver_ate NULL) nunca está atrasado: pode renovar.
const PODE_RENOVAR = `r.status = 'retirada' AND r.renovacoes < ${LIMITE_RENOVACOES_ALUNO}
  AND (r.devolver_ate IS NULL OR r.devolver_ate >= datetime('now'))`;

const NOVO_PRAZO = `datetime(COALESCE(r.devolver_ate, 'now'), '+${DIAS_RENOVACAO} days')`;

const COLUNAS_RESERVA = `
  r.id, r.status, r.criada_em, r.expira_em, r.encerrada_em, r.devolver_ate,
  r.retirada_em, r.renovacoes,
  (${ATRASADA}) AS atrasada,
  e.codigo AS exemplar_codigo,
  l.slug AS livro_slug, l.titulo, l.autor, l.capa`;

// Para o aluno: se pode renovar e até quando o prazo iria, para a tela confirmar antes.
const COLUNAS_RENOVACAO = `
  (${PODE_RENOVAR}) AS pode_renovar,
  CASE WHEN ${PODE_RENOVAR} THEN ${NOVO_PRAZO} END AS novo_prazo`;

// Extended result code do SQLite para violação de índice único.
const SQLITE_CONSTRAINT_UNIQUE = 2067;

const COLUNAS_LIVRO = `
  l.id, l.slug, l.titulo, l.autor, l.materia_slug, l.capa,
  l.sinopse, l.paginas, l.idioma,
  m.nome AS materia_nome, m.icone AS materia_icone,
  (SELECT COUNT(*) FROM exemplares e
    WHERE e.livro_id = l.id AND e.estado = 'ok') AS total_exemplares,
  (SELECT COUNT(*) FROM exemplares e
    WHERE e.livro_id = l.id AND e.estado = 'ok'
      AND NOT EXISTS (
        SELECT 1 FROM reservas r
         WHERE r.exemplar_id = e.id AND r.status IN ('ativa', 'retirada')
      )) AS disponiveis`;

export function listarMaterias() {
  return db.prepare(`
    SELECT m.slug, m.nome, m.icone,
           (SELECT COUNT(*) FROM livros l WHERE l.materia_slug = m.slug) AS total_livros
      FROM materias m
     ORDER BY m.nome
  `).all();
}

export function materiaExiste(slug) {
  return Boolean(db.prepare('SELECT 1 FROM materias WHERE slug = ?').get(slug));
}

export function livroExiste(id) {
  return Boolean(db.prepare('SELECT 1 FROM livros WHERE id = ?').get(id));
}

export function listarLivros({ materia, busca } = {}) {
  const condicoes = [];
  const params = [];
  if (materia && materia !== 'todos') {
    condicoes.push('l.materia_slug = ?');
    params.push(materia);
  }
  if (busca) {
    // % e _ digitados pelo usuário valem como texto, não como curinga do LIKE.
    const termo = normalizarTexto(busca).replace(/[\\%_]/g, (c) => `\\${c}`);
    condicoes.push("l.busca_normalizada LIKE ? ESCAPE '\\'");
    params.push(`%${termo}%`);
  }
  const onde = condicoes.length ? `WHERE ${condicoes.join(' AND ')}` : '';
  return db.prepare(`
    SELECT ${COLUNAS_LIVRO}
      FROM livros l
      JOIN materias m ON m.slug = l.materia_slug
      ${onde}
     ORDER BY l.titulo
  `).all(...params);
}

export function buscarLivroPorSlug(slug) {
  return db.prepare(`
    SELECT ${COLUNAS_LIVRO}
      FROM livros l
      JOIN materias m ON m.slug = l.materia_slug
     WHERE l.slug = ?
  `).get(slug) ?? null;
}

export function buscarLivroPorId(id) {
  return db.prepare(`
    SELECT ${COLUNAS_LIVRO}
      FROM livros l
      JOIN materias m ON m.slug = l.materia_slug
     WHERE l.id = ?
  `).get(id) ?? null;
}

/** Os livros cadastrados por último. */
export function idsDosLivrosMaisRecentes(quantidade) {
  return db.prepare('SELECT id FROM livros ORDER BY criado_em DESC, id DESC LIMIT ?')
    .all(quantidade).map((l) => l.id);
}

export function criarLivro(dados) {
  const { slug, titulo, autor, materia_slug, capa, sinopse, paginas, idioma, exemplares = 1 } = dados;
  return transacao(() => {
    const { lastInsertRowid } = db.prepare(`
      INSERT INTO livros (slug, titulo, autor, materia_slug, capa, sinopse, paginas, idioma,
                          busca_normalizada)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(slug, titulo, autor, materia_slug, capa ?? null, sinopse ?? null,
           paginas ?? null, idioma ?? 'Português', buscaNormalizadaLivro(titulo, autor));
    adicionarExemplares(Number(lastInsertRowid), exemplares);
    return buscarLivroPorSlug(slug);
  });
}

export function atualizarLivro(id, dados) {
  const { titulo, autor, materia_slug, capa, sinopse, paginas, idioma } = dados;
  db.prepare(`
    UPDATE livros
       SET titulo = ?, autor = ?, materia_slug = ?, capa = ?,
           sinopse = ?, paginas = ?, idioma = ?, busca_normalizada = ?
     WHERE id = ?
  `).run(titulo, autor, materia_slug, capa ?? null, sinopse ?? null,
         paginas ?? null, idioma ?? 'Português', buscaNormalizadaLivro(titulo, autor), id);
  return buscarLivroPorId(id);
}

export function removerLivro(id) {
  // Apagar o livro apagaria em cascata exemplares e reservas, e o histórico se perderia.
  // Por isso só sai do acervo o livro que nunca teve reserva, em qualquer status.
  const temHistorico = db.prepare(`
    SELECT 1 FROM reservas r
      JOIN exemplares e ON e.id = r.exemplar_id
     WHERE e.livro_id = ?
     LIMIT 1
  `).get(id);
  if (temHistorico) {
    throw Object.assign(new Error('Este livro tem histórico de reservas e não pode ser removido.'), { status: 409 });
  }
  db.prepare('DELETE FROM livros WHERE id = ?').run(id);
}

export function adicionarExemplares(livroId, quantidade) {
  const inserir = db.prepare('INSERT INTO exemplares (livro_id, codigo) VALUES (?, ?)');
  for (let i = 0; i < quantidade; i++) {
    inserir.run(livroId, `L${livroId}-${Date.now().toString(36)}-${i}`);
  }
}

/** limite: máximo de reservas simultâneas do usuário; null = sem limite (coordenação). */
export function criarReserva(livroId, usuarioId, { limite = LIMITE_RESERVAS_ALUNO } = {}) {
  return transacao(() => {
    const jaReservado = db.prepare(`
      SELECT 1 FROM reservas r
        JOIN exemplares e ON e.id = r.exemplar_id
       WHERE e.livro_id = ? AND r.usuario_id = ? AND r.status IN ('ativa', 'retirada')
    `).get(livroId, usuarioId);
    if (jaReservado) {
      throw Object.assign(new Error('Você já tem uma reserva ativa deste livro.'), { status: 409 });
    }

    if (limite !== null) {
      const emAberto = db.prepare(`
        SELECT COUNT(*) AS n FROM reservas
         WHERE usuario_id = ? AND status IN ('ativa', 'retirada')
      `).get(usuarioId).n;
      if (emAberto >= limite) {
        throw Object.assign(
          new Error(`Você já tem ${limite} livros reservados ou emprestados. Devolva ou cancele um para reservar outro.`),
          { status: 409 }
        );
      }
    }

    const livre = db.prepare(`
      SELECT e.id FROM exemplares e
       WHERE e.livro_id = ? AND e.estado = 'ok'
         AND NOT EXISTS (
           SELECT 1 FROM reservas r
            WHERE r.exemplar_id = e.id AND r.status IN ('ativa', 'retirada')
         )
       LIMIT 1
    `).get(livroId);
    if (!livre) {
      throw Object.assign(new Error('Não há exemplares disponíveis no momento.'), { status: 409 });
    }

    try {
      const { lastInsertRowid } = db.prepare(`
        INSERT INTO reservas (exemplar_id, usuario_id, expira_em)
        VALUES (?, ?, datetime('now', '+${DIAS_PARA_RETIRAR} days'))
      `).run(livre.id, usuarioId);
      return buscarReserva(Number(lastInsertRowid));
    } catch (erro) {
      // Outro processo pegou o exemplar entre a consulta acima e este INSERT:
      // é o índice idx_reserva_exemplar_ativa fazendo o trabalho dele, e não um defeito.
      if (erro.errcode === SQLITE_CONSTRAINT_UNIQUE) {
        throw Object.assign(new Error('Este exemplar acabou de ser reservado. Tente novamente.'), { status: 409 });
      }
      throw erro;
    }
  });
}

/** comObservacao: só nas respostas à coordenação; a anotação é interna. */
export function buscarReserva(id, { comObservacao = false } = {}) {
  return db.prepare(`
    SELECT ${COLUNAS_RESERVA}, ${COLUNAS_RENOVACAO},
           ${comObservacao ? 'r.observacao,' : ''}
           u.nome AS usuario_nome, u.email AS usuario_email, t.nome AS turma
      FROM reservas r
      JOIN exemplares e ON e.id = r.exemplar_id
      JOIN livros l ON l.id = e.livro_id
      JOIN usuarios u ON u.id = r.usuario_id
      LEFT JOIN turmas t ON t.id = u.turma_id
     WHERE r.id = ?
  `).get(id) ?? null;
}

export function listarReservasDoUsuario(usuarioId) {
  return db.prepare(`
    SELECT ${COLUNAS_RESERVA}, ${COLUNAS_RENOVACAO}
      FROM reservas r
      JOIN exemplares e ON e.id = r.exemplar_id
      JOIN livros l ON l.id = e.livro_id
     WHERE r.usuario_id = ?
     ORDER BY r.criada_em DESC
  `).all(usuarioId);
}

export function listarTodasReservas(status) {
  let filtro = '';
  let params = [];
  if (status === 'atrasadas') {
    filtro = `WHERE ${ATRASADA}`;
  } else if (status && status !== 'todas') {
    filtro = 'WHERE r.status = ?';
    params = [status];
  }
  return db.prepare(`
    SELECT ${COLUNAS_RESERVA}, r.observacao,
           u.nome AS usuario_nome, u.email AS usuario_email, t.nome AS turma
      FROM reservas r
      JOIN exemplares e ON e.id = r.exemplar_id
      JOIN livros l ON l.id = e.livro_id
      JOIN usuarios u ON u.id = r.usuario_id
      LEFT JOIN turmas t ON t.id = u.turma_id
      ${filtro}
     ORDER BY r.criada_em DESC
  `).all(...params);
}

// Transições feitas pela coordenação.
const TRANSICOES = {
  retirada: ['ativa'],
  devolvida: ['retirada'],
  cancelada: ['ativa', 'retirada'],
};

// O aluno só cancela o que ainda não retirou: se cancelasse um livro que está
// com ele, o exemplar voltaria a aparecer como disponível.
const TRANSICOES_ALUNO = {
  cancelada: ['ativa'],
};

/** usuarioId = null: ação da coordenação. Com usuarioId: ação do próprio aluno. */
export function mudarStatusReserva(id, novoStatus, usuarioId = null) {
  const permitidos = (usuarioId === null ? TRANSICOES : TRANSICOES_ALUNO)[novoStatus];
  if (!permitidos) {
    throw Object.assign(new Error('Status inválido.'), { status: 400 });
  }
  const atual = db.prepare('SELECT status, usuario_id FROM reservas WHERE id = ?').get(id);
  if (!atual) {
    throw Object.assign(new Error('Reserva não encontrada.'), { status: 404 });
  }
  if (usuarioId !== null && atual.usuario_id !== usuarioId) {
    throw Object.assign(new Error('Esta reserva não é sua.'), { status: 403 });
  }
  if (usuarioId !== null && novoStatus === 'cancelada' && atual.status === 'retirada') {
    throw Object.assign(
      new Error('Você já retirou este livro, então a reserva não pode ser cancelada. Devolva o exemplar na biblioteca.'),
      { status: 409 }
    );
  }
  if (!permitidos.includes(atual.status)) {
    throw Object.assign(
      new Error(`Não é possível mudar de "${atual.status}" para "${novoStatus}".`),
      { status: 409 }
    );
  }
  const retira = novoStatus === 'retirada';
  // Na retirada começa a contar o prazo de devolução; os outros status encerram a reserva.
  db.prepare(`
    UPDATE reservas
       SET status = ?,
           encerrada_em = ${retira ? 'NULL' : "datetime('now')"}
           ${retira ? `, retirada_em = datetime('now'),
                        devolver_ate = datetime('now', '+${DIAS_PARA_DEVOLVER} days')` : ''}
     WHERE id = ?
  `).run(novoStatus, id);
  return buscarReserva(id, { comObservacao: usuarioId === null });
}

/** usuarioId = null: ação da coordenação, sem limite de vezes e valendo para atrasada. */
export function renovarReserva(id, usuarioId = null) {
  const atual = db.prepare(`
    SELECT r.status, r.usuario_id, r.renovacoes, (${ATRASADA}) AS atrasada
      FROM reservas r
     WHERE r.id = ?
  `).get(id);
  if (!atual) {
    throw Object.assign(new Error('Reserva não encontrada.'), { status: 404 });
  }
  if (usuarioId !== null && atual.usuario_id !== usuarioId) {
    throw Object.assign(new Error('Esta reserva não é sua.'), { status: 403 });
  }
  if (atual.status !== 'retirada') {
    throw Object.assign(new Error('Só é possível renovar um livro que está com o leitor.'), { status: 409 });
  }
  if (usuarioId !== null && atual.atrasada) {
    throw Object.assign(new Error('Este empréstimo está atrasado. Procure a biblioteca para renovar.'), { status: 409 });
  }
  if (usuarioId !== null && atual.renovacoes >= LIMITE_RENOVACOES_ALUNO) {
    throw Object.assign(new Error('Este empréstimo já foi renovado. Procure a biblioteca.'), { status: 409 });
  }
  db.prepare(`
    UPDATE reservas AS r
       SET devolver_ate = ${NOVO_PRAZO}, renovacoes = r.renovacoes + 1
     WHERE r.id = ?
  `).run(id);
  return buscarReserva(id, { comObservacao: usuarioId === null });
}

/** texto = null apaga a anotação. */
export function definirObservacao(id, texto) {
  const { changes } = db.prepare('UPDATE reservas SET observacao = ? WHERE id = ?').run(texto, id);
  if (!changes) {
    throw Object.assign(new Error('Reserva não encontrada.'), { status: 404 });
  }
  return buscarReserva(id, { comObservacao: true });
}

/** Devolve quantas reservas foram canceladas. As retiradas ficam: o livro ainda está com a pessoa. */
export function cancelarReservasAtivasDoUsuario(usuarioId) {
  return db.prepare(`
    UPDATE reservas
       SET status = 'cancelada', encerrada_em = datetime('now')
     WHERE usuario_id = ? AND status = 'ativa'
  `).run(usuarioId).changes;
}

export function expirarReservasVencidas() {
  const { changes } = db.prepare(`
    UPDATE reservas
       SET status = 'cancelada', encerrada_em = datetime('now')
     WHERE status = 'ativa' AND expira_em < datetime('now')
  `).run();
  return changes;
}

export function resumoAdmin() {
  const contar = (sql, ...p) => db.prepare(sql).get(...p).n;
  return {
    livros: contar('SELECT COUNT(*) AS n FROM livros'),
    exemplares: contar("SELECT COUNT(*) AS n FROM exemplares WHERE estado = 'ok'"),
    reservas_ativas: contar("SELECT COUNT(*) AS n FROM reservas WHERE status = 'ativa'"),
    retiradas: contar("SELECT COUNT(*) AS n FROM reservas WHERE status = 'retirada'"),
    atrasadas: contar(`SELECT COUNT(*) AS n FROM reservas r WHERE ${ATRASADA}`),
    usuarios: contar("SELECT COUNT(*) AS n FROM usuarios WHERE papel = 'aluno' AND ativo = 1"),
    mensagens_novas: contar("SELECT COUNT(*) AS n FROM mensagens_contato WHERE status = 'nova'"),
    depoimentos_pendentes: contar("SELECT COUNT(*) AS n FROM depoimentos WHERE status = 'pendente'"),
  };
}

export function listarUsuarios() {
  return db.prepare(`
    SELECT u.id, u.nome, u.email, u.papel, t.nome AS turma, u.ativo, u.criado_em,
           (SELECT COUNT(*) FROM reservas r
             WHERE r.usuario_id = u.id AND r.status IN ('ativa', 'retirada')) AS reservas_ativas
      FROM usuarios u
      LEFT JOIN turmas t ON t.id = u.turma_id
     ORDER BY u.nome
  `).all();
}

export function usuarioExiste(id) {
  return Boolean(db.prepare('SELECT 1 FROM usuarios WHERE id = ?').get(id));
}

/** nome: da turma, em texto. Devolve o usuário com o nome da turma como está cadastrado. */
export function criarUsuario({ nome, email, senhaHash, papel, turma }) {
  return transacao(() => {
    const registro = turma ? buscarOuCriarTurma(turma) : null;
    // A senha cadastrada pela coordenação é provisória: o usuário troca no primeiro acesso.
    const { lastInsertRowid } = db.prepare(`
      INSERT INTO usuarios (nome, email, senha_hash, papel, turma_id, trocar_senha)
      VALUES (?, ?, ?, ?, ?, 1)
    `).run(nome, email, senhaHash, papel, registro?.id ?? null);
    return { id: Number(lastInsertRowid), nome, email, papel, turma: registro?.nome ?? null };
  });
}

/**
 * alunos: { nome, email, turma, senhaHash }. Devolve os que entraram: um e-mail que já
 * existe fica de fora sem erro, para a mesma planilha poder ser enviada de novo.
 */
export function criarAlunosEmLote(alunos) {
  const inserir = db.prepare(`
    INSERT INTO usuarios (nome, email, senha_hash, papel, turma_id, trocar_senha)
    VALUES (?, ?, ?, 'aluno', ?, 1)
    ON CONFLICT(email) DO NOTHING
  `);
  return transacao(() => alunos.filter(({ nome, email, turma, senhaHash }) => {
    const turmaId = turma ? buscarOuCriarTurma(turma).id : null;
    return inserir.run(nome, email, senhaHash, turmaId).changes > 0;
  }));
}

export function emailEmUso(email, ignorarUsuarioId) {
  return Boolean(db.prepare('SELECT 1 FROM usuarios WHERE email = ? AND id <> ?').get(email, ignorarUsuarioId));
}

/** Só nome e e-mail mudam por aqui; o campo ausente fica como está. */
export function atualizarPerfil(id, { nome, email }) {
  db.prepare('UPDATE usuarios SET nome = COALESCE(?, nome), email = COALESCE(?, email) WHERE id = ?')
    .run(nome ?? null, email ?? null, id);
}

export function definirContaAtiva(id, ativo) {
  db.prepare('UPDATE usuarios SET ativo = ? WHERE id = ?').run(ativo ? 1 : 0, id);
}

export function listarTurmas() {
  return db.prepare(`
    SELECT id, nome, ano_letivo, ativa
      FROM turmas
     WHERE ativa = 1
     ORDER BY nome
  `).all();
}

/** O nome não diferencia maiúsculas: "8º ANO B" encontra "8º ano B". */
export function buscarOuCriarTurma(nome) {
  db.prepare(`
    INSERT INTO turmas (nome, ano_letivo) VALUES (?, ?)
    ON CONFLICT(nome) DO NOTHING
  `).run(nome, new Date().getFullYear());
  return db.prepare('SELECT id, nome FROM turmas WHERE nome = ?').get(nome);
}

export function criarDepoimento({ usuarioId, nome, turma, mensagem, nota }) {
  const { lastInsertRowid } = db.prepare(`
    INSERT INTO depoimentos (usuario_id, nome, turma, mensagem, nota)
    VALUES (?, ?, ?, ?, ?)
  `).run(usuarioId ?? null, nome, turma, mensagem, nota);
  return { id: Number(lastInsertRowid), status: 'pendente' };
}

/** Só os aprovados, sem dados de quem enviou além do nome e da turma. */
export function listarDepoimentosAprovados() {
  return db.prepare(`
    SELECT id, nome, turma, mensagem, nota, criado_em
      FROM depoimentos
     WHERE status = 'aprovado'
     ORDER BY criado_em DESC, id DESC
  `).all();
}

/** Para a moderação: status = null traz todos, com os pendentes primeiro. */
export function listarDepoimentos(status = null) {
  const filtro = status ? 'WHERE d.status = ?' : '';
  return db.prepare(`
    SELECT d.id, d.nome, d.turma, d.mensagem, d.nota, d.status, d.criado_em,
           u.email AS usuario_email
      FROM depoimentos d
      LEFT JOIN usuarios u ON u.id = d.usuario_id
      ${filtro}
     ORDER BY d.status = 'pendente' DESC, d.criado_em DESC, d.id DESC
  `).all(...(status ? [status] : []));
}

export function moderarDepoimento(id, status) {
  const { changes } = db.prepare('UPDATE depoimentos SET status = ? WHERE id = ?').run(status, id);
  if (!changes) {
    throw Object.assign(new Error('Depoimento não encontrado.'), { status: 404 });
  }
  return db.prepare('SELECT id, status FROM depoimentos WHERE id = ?').get(id);
}

/** Os livros da lista "Quero ler", do mais recente para o mais antigo, no formato do catálogo. */
export function listarFavoritos(usuarioId) {
  return db.prepare(`
    SELECT ${COLUNAS_LIVRO}
      FROM favoritos f
      JOIN livros l ON l.id = f.livro_id
      JOIN materias m ON m.slug = l.materia_slug
     WHERE f.usuario_id = ?
     ORDER BY f.criado_em DESC, f.id DESC
  `).all(usuarioId);
}

export function adicionarFavorito(usuarioId, livroId) {
  db.prepare(`
    INSERT INTO favoritos (usuario_id, livro_id) VALUES (?, ?)
    ON CONFLICT(usuario_id, livro_id) DO NOTHING
  `).run(usuarioId, livroId);
}

export function removerFavorito(usuarioId, livroId) {
  db.prepare('DELETE FROM favoritos WHERE usuario_id = ? AND livro_id = ?').run(usuarioId, livroId);
}

export function criarMensagem({ usuarioId, nome, turma, email, assunto, mensagem }) {
  const { lastInsertRowid } = db.prepare(`
    INSERT INTO mensagens_contato (usuario_id, nome, turma, email, assunto, mensagem)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(usuarioId ?? null, nome, turma, email, assunto, mensagem);
  return { id: Number(lastInsertRowid), status: 'nova' };
}

/** status = null traz todas, com as novas primeiro. */
export function listarMensagens(status = null) {
  const filtro = status ? 'WHERE c.status = ?' : '';
  return db.prepare(`
    SELECT c.id, c.nome, c.turma, c.email, c.assunto, c.mensagem, c.status,
           c.criada_em, c.atualizada_em, u.email AS usuario_email
      FROM mensagens_contato c
      LEFT JOIN usuarios u ON u.id = c.usuario_id
      ${filtro}
     ORDER BY c.status = 'nova' DESC, c.criada_em DESC, c.id DESC
  `).all(...(status ? [status] : []));
}

export function mudarStatusMensagem(id, status) {
  const { changes } = db.prepare(`
    UPDATE mensagens_contato SET status = ?, atualizada_em = datetime('now') WHERE id = ?
  `).run(status, id);
  if (!changes) {
    throw Object.assign(new Error('Mensagem não encontrada.'), { status: 404 });
  }
  return db.prepare('SELECT id, status FROM mensagens_contato WHERE id = ?').get(id);
}
