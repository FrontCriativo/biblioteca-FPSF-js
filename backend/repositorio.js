import { db, transacao } from './db/index.js';
import { normalizarTexto, buscaNormalizadaLivro } from './texto.js';

const DIAS_PARA_RETIRAR = 3;

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
  return db.prepare(`
    SELECT ${COLUNAS_LIVRO}
      FROM livros l JOIN materias m ON m.slug = l.materia_slug
     WHERE l.id = ?
  `).get(id);
}

export function removerLivro(id) {
  const reservasAtivas = db.prepare(`
    SELECT COUNT(*) AS n FROM reservas r
      JOIN exemplares e ON e.id = r.exemplar_id
     WHERE e.livro_id = ? AND r.status IN ('ativa', 'retirada')
  `).get(id).n;
  if (reservasAtivas > 0) {
    throw Object.assign(new Error('Este livro tem reservas ativas e não pode ser removido.'), { status: 409 });
  }
  db.prepare('DELETE FROM livros WHERE id = ?').run(id);
}

export function adicionarExemplares(livroId, quantidade) {
  const inserir = db.prepare('INSERT INTO exemplares (livro_id, codigo) VALUES (?, ?)');
  for (let i = 0; i < quantidade; i++) {
    inserir.run(livroId, `L${livroId}-${Date.now().toString(36)}-${i}`);
  }
}

export function criarReserva(livroId, usuarioId) {
  return transacao(() => {
    const jaReservado = db.prepare(`
      SELECT 1 FROM reservas r
        JOIN exemplares e ON e.id = r.exemplar_id
       WHERE e.livro_id = ? AND r.usuario_id = ? AND r.status IN ('ativa', 'retirada')
    `).get(livroId, usuarioId);
    if (jaReservado) {
      throw Object.assign(new Error('Você já tem uma reserva ativa deste livro.'), { status: 409 });
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

    const { lastInsertRowid } = db.prepare(`
      INSERT INTO reservas (exemplar_id, usuario_id, expira_em)
      VALUES (?, ?, datetime('now', '+${DIAS_PARA_RETIRAR} days'))
    `).run(livre.id, usuarioId);
    return buscarReserva(Number(lastInsertRowid));
  });
}

export function buscarReserva(id) {
  return db.prepare(`
    SELECT r.id, r.status, r.criada_em, r.expira_em, r.encerrada_em,
           e.codigo AS exemplar_codigo,
           l.slug AS livro_slug, l.titulo, l.autor, l.capa,
           u.nome AS usuario_nome, u.email AS usuario_email, u.turma
      FROM reservas r
      JOIN exemplares e ON e.id = r.exemplar_id
      JOIN livros l ON l.id = e.livro_id
      JOIN usuarios u ON u.id = r.usuario_id
     WHERE r.id = ?
  `).get(id) ?? null;
}

export function listarReservasDoUsuario(usuarioId) {
  return db.prepare(`
    SELECT r.id, r.status, r.criada_em, r.expira_em,
           e.codigo AS exemplar_codigo,
           l.slug AS livro_slug, l.titulo, l.autor, l.capa
      FROM reservas r
      JOIN exemplares e ON e.id = r.exemplar_id
      JOIN livros l ON l.id = e.livro_id
     WHERE r.usuario_id = ?
     ORDER BY r.criada_em DESC
  `).all(usuarioId);
}

export function listarTodasReservas(status) {
  const filtro = status && status !== 'todas' ? 'WHERE r.status = ?' : '';
  const params = filtro ? [status] : [];
  return db.prepare(`
    SELECT r.id, r.status, r.criada_em, r.expira_em, r.encerrada_em,
           e.codigo AS exemplar_codigo,
           l.slug AS livro_slug, l.titulo, l.autor, l.capa,
           u.nome AS usuario_nome, u.email AS usuario_email, u.turma
      FROM reservas r
      JOIN exemplares e ON e.id = r.exemplar_id
      JOIN livros l ON l.id = e.livro_id
      JOIN usuarios u ON u.id = r.usuario_id
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
  const encerra = novoStatus !== 'retirada';
  db.prepare(`
    UPDATE reservas
       SET status = ?, encerrada_em = ${encerra ? "datetime('now')" : 'NULL'}
     WHERE id = ?
  `).run(novoStatus, id);
  return buscarReserva(id);
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
    usuarios: contar("SELECT COUNT(*) AS n FROM usuarios WHERE papel = 'aluno'"),
  };
}

export function listarUsuarios() {
  return db.prepare(`
    SELECT u.id, u.nome, u.email, u.papel, u.turma, u.criado_em,
           (SELECT COUNT(*) FROM reservas r
             WHERE r.usuario_id = u.id AND r.status IN ('ativa', 'retirada')) AS reservas_ativas
      FROM usuarios u
     ORDER BY u.nome
  `).all();
}
