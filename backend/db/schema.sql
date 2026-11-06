-- Biblioteca Virtual FPSF — schema
--
-- Um livro (obra) tem N exemplares (cópias físicas na prateleira).
-- Disponibilidade é a contagem de exemplares sem reserva ativa,
-- e não um booleano no próprio livro.
--
-- Este arquivo descreve um banco novo, completo. Mudanças em bancos que
-- já existem são feitas pelas migrações em db/index.js.
--
-- Ele também roda em bancos antigos, antes das migrações. Por isso não pode ter
-- índice sobre coluna nova de tabela que já existia: a coluna ainda não estaria lá.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- O limite de 40 caracteres do nome é conferido em rotas.js. Não é um CHECK porque
-- turmas de bancos antigos, vindas de texto livre, podem ser maiores.
CREATE TABLE IF NOT EXISTS turmas (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  nome       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  ano_letivo INTEGER,
  ativa      INTEGER NOT NULL DEFAULT 1,
  criada_em  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS usuarios (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  nome        TEXT NOT NULL,
  email       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  senha_hash  TEXT NOT NULL,
  papel       TEXT NOT NULL DEFAULT 'aluno' CHECK (papel IN ('aluno', 'admin')),
  criado_em   TEXT NOT NULL DEFAULT (datetime('now')),
  -- 1 = senha provisória (seed ou definida pela coordenação): trocar no próximo acesso.
  trocar_senha INTEGER NOT NULL DEFAULT 0,
  turma_id    INTEGER REFERENCES turmas(id) ON DELETE SET NULL,
  -- 0 = conta desativada pela coordenação: não entra nem mantém sessão.
  ativo       INTEGER NOT NULL DEFAULT 1
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
  devolver_ate TEXT,
  retirada_em  TEXT,
  renovacoes   INTEGER NOT NULL DEFAULT 0,
  -- Anotação interna da coordenação: nunca sai nas rotas do aluno.
  observacao   TEXT
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

-- Depoimentos chegam pelo site e só aparecem depois de aprovados pela biblioteca.
-- usuario_id fica preenchido quando quem escreveu estava logado.
CREATE TABLE IF NOT EXISTS depoimentos (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  nome       TEXT NOT NULL,
  turma      TEXT NOT NULL,
  mensagem   TEXT NOT NULL,
  nota       INTEGER NOT NULL CHECK (nota BETWEEN 1 AND 5),
  status     TEXT NOT NULL DEFAULT 'pendente'
               CHECK (status IN ('pendente', 'aprovado', 'recusado')),
  criado_em  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_depoimentos_status ON depoimentos(status);

-- Lista "Quero ler" de cada leitor.
CREATE TABLE IF NOT EXISTS favoritos (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  livro_id   INTEGER NOT NULL REFERENCES livros(id) ON DELETE CASCADE,
  criado_em  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (usuario_id, livro_id)
);

CREATE INDEX IF NOT EXISTS idx_favoritos_livro ON favoritos(livro_id);

-- Mensagens do "Fale conosco". usuario_id fica preenchido quando quem escreveu estava logado.
CREATE TABLE IF NOT EXISTS mensagens_contato (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id    INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  nome          TEXT NOT NULL,
  turma         TEXT,
  email         TEXT,
  assunto       TEXT NOT NULL CHECK (assunto IN (
                  'Sugestão de livro', 'Dúvida sobre empréstimo', 'Problema de acesso', 'Outro assunto'
                )),
  mensagem      TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'nova' CHECK (status IN ('nova', 'lida', 'respondida')),
  criada_em     TEXT NOT NULL DEFAULT (datetime('now')),
  atualizada_em TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_mensagens_status ON mensagens_contato(status);
