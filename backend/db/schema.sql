-- Biblioteca Virtual FPSF — schema
--
-- Um livro (obra) tem N exemplares (cópias físicas na prateleira).
-- Disponibilidade é a contagem de exemplares sem reserva ativa,
-- e não um booleano no próprio livro.
--
-- Este arquivo descreve um banco novo, completo. Mudanças em bancos que
-- já existem são feitas pelas migrações em db/index.js.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS usuarios (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  nome        TEXT NOT NULL,
  email       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  senha_hash  TEXT NOT NULL,
  papel       TEXT NOT NULL DEFAULT 'aluno' CHECK (papel IN ('aluno', 'admin')),
  turma       TEXT,
  criado_em   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS materias (
  slug  TEXT PRIMARY KEY,
  nome  TEXT NOT NULL,
  icone TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS livros (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  slug         TEXT NOT NULL UNIQUE,
  titulo       TEXT NOT NULL,
  autor        TEXT NOT NULL,
  materia_slug TEXT NOT NULL REFERENCES materias(slug),
  capa         TEXT,
  sinopse      TEXT,
  paginas      INTEGER,
  idioma       TEXT DEFAULT 'Português',
  criado_em    TEXT NOT NULL DEFAULT (datetime('now')),
  -- Título + autor em minúsculas e sem acentos, para a busca (ver backend/texto.js).
  busca_normalizada TEXT
);

CREATE INDEX IF NOT EXISTS idx_livros_materia ON livros(materia_slug);

CREATE TABLE IF NOT EXISTS exemplares (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  livro_id  INTEGER NOT NULL REFERENCES livros(id) ON DELETE CASCADE,
  codigo    TEXT NOT NULL UNIQUE,
  estado    TEXT NOT NULL DEFAULT 'ok' CHECK (estado IN ('ok', 'manutencao'))
);

CREATE INDEX IF NOT EXISTS idx_exemplares_livro ON exemplares(livro_id);

CREATE TABLE IF NOT EXISTS reservas (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  exemplar_id  INTEGER NOT NULL REFERENCES exemplares(id) ON DELETE CASCADE,
  usuario_id   INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'ativa'
                 CHECK (status IN ('ativa', 'retirada', 'devolvida', 'cancelada')),
  criada_em    TEXT NOT NULL DEFAULT (datetime('now')),
  expira_em    TEXT NOT NULL,
  encerrada_em TEXT,
  -- Prazo de devolução, gravado quando a reserva vira 'retirada'.
  devolver_ate TEXT
);

-- Invariante central: um exemplar só pode ter UMA reserva não-encerrada.
-- O índice parcial faz o próprio SQLite recusar reserva dupla, mesmo sob
-- requisições simultâneas — a garantia não depende de checagem no JS.
CREATE UNIQUE INDEX IF NOT EXISTS idx_reserva_exemplar_ativa
  ON reservas(exemplar_id)
  WHERE status IN ('ativa', 'retirada');

CREATE INDEX IF NOT EXISTS idx_reservas_usuario ON reservas(usuario_id);

CREATE TABLE IF NOT EXISTS sessoes (
  token      TEXT PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  criada_em  TEXT NOT NULL DEFAULT (datetime('now')),
  expira_em  TEXT NOT NULL
);
