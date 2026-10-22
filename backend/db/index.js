import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buscaNormalizadaLivro } from '../texto.js';

const here = dirname(fileURLToPath(import.meta.url));
const arquivoBanco = join(here, 'biblioteca.db');

mkdirSync(here, { recursive: true });

export const db = new DatabaseSync(arquivoBanco);

db.exec(readFileSync(join(here, 'schema.sql'), 'utf8'));

export function transacao(fn) {
  db.exec('BEGIN');
  try {
    const resultado = fn();
    db.exec('COMMIT');
    return resultado;
  } catch (erro) {
    db.exec('ROLLBACK');
    throw erro;
  }
}

function colunaExiste(tabela, coluna) {
  return db.prepare(`PRAGMA table_info(${tabela})`).all().some((c) => c.name === coluna);
}

// Migrações para bancos que já existiam antes de cada mudança.
// O schema.sql cria um banco novo já completo; cada migração confere o que
// falta antes de agir, então rodar sobre um banco novo não faz nada.
// A versão aplicada fica em PRAGMA user_version.
const MIGRACOES = [
  // 1 — busca sem acento
  () => {
    if (!colunaExiste('livros', 'busca_normalizada')) {
      db.exec('ALTER TABLE livros ADD COLUMN busca_normalizada TEXT');
    }
  },
  // 2 — prazo de devolução. Empréstimos retirados antes desta versão ficam
  // sem prazo (NULL): não dá para saber quando foram retirados.
  () => {
    if (!colunaExiste('reservas', 'devolver_ate')) {
      db.exec('ALTER TABLE reservas ADD COLUMN devolver_ate TEXT');
    }
  },
  // 3 — troca de senha obrigatória. Contas que já existiam ficam com 0:
  // não dá para saber se a senha delas ainda é a padrão.
  () => {
    if (!colunaExiste('usuarios', 'trocar_senha')) {
      db.exec('ALTER TABLE usuarios ADD COLUMN trocar_senha INTEGER NOT NULL DEFAULT 0');
    }
  },
  // 4 — depoimentos moderados. Tabela nova: o CREATE TABLE IF NOT EXISTS do
  // schema.sql já a cria ao abrir qualquer banco, antes das migrações. Aqui só
  // se confere que ela está lá, para a versão do banco registrar a mudança.
  () => {
    const existe = db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'depoimentos'"
    ).get();
    if (!existe) throw new Error('Tabela depoimentos ausente: confira o schema.sql.');
  },
];

function migrar() {
  const versao = db.prepare('PRAGMA user_version').get().user_version;
  for (let i = versao; i < MIGRACOES.length; i++) {
    transacao(() => {
      MIGRACOES[i]();
      db.exec(`PRAGMA user_version = ${i + 1}`);
    });
  }
}

// Livros gravados sem a coluna (banco antigo ou servidor desatualizado) ganham o valor aqui.
function preencherBuscaNormalizada() {
  const pendentes = db.prepare(
    'SELECT id, titulo, autor FROM livros WHERE busca_normalizada IS NULL'
  ).all();
  const atualizar = db.prepare('UPDATE livros SET busca_normalizada = ? WHERE id = ?');
  for (const l of pendentes) atualizar.run(buscaNormalizadaLivro(l.titulo, l.autor), l.id);
}

migrar();
preencherBuscaNormalizada();
