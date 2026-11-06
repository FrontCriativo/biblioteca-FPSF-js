import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buscaNormalizadaLivro } from '../texto.js';
import { arquivoBanco } from './caminho.js';

const here = dirname(fileURLToPath(import.meta.url));
if (arquivoBanco !== ':memory:') mkdirSync(dirname(arquivoBanco), { recursive: true });

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

// Tabela nova vem do CREATE TABLE IF NOT EXISTS do schema.sql, que roda antes das
// migrações. A migração só confere que ela está lá, para a versão registrar a mudança.
function exigirTabela(tabela) {
  const existe = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(tabela);
  if (!existe) throw new Error(`Tabela ${tabela} ausente: confira o schema.sql.`);
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
  // 5 — turmas normalizadas. A tabela turmas vem do schema.sql; aqui cada valor
  // distinto da antiga coluna de texto vira uma turma do ano corrente.
  () => {
    if (!colunaExiste('usuarios', 'turma_id')) {
      db.exec('ALTER TABLE usuarios ADD COLUMN turma_id INTEGER REFERENCES turmas(id) ON DELETE SET NULL');
    }
    if (!colunaExiste('usuarios', 'turma')) return; // banco novo: não há o que converter
    // "8º ano B" e "8º ANO B" viram uma turma só: o nome é COLLATE NOCASE.
    db.prepare(`
      INSERT INTO turmas (nome, ano_letivo)
      SELECT DISTINCT trim(turma), ? FROM usuarios WHERE trim(turma) <> ''
      ON CONFLICT(nome) DO NOTHING
    `).run(new Date().getFullYear());
    db.exec(`
      UPDATE usuarios
         SET turma_id = (SELECT t.id FROM turmas t WHERE t.nome = trim(usuarios.turma))
       WHERE trim(turma) <> ''
    `);
  },
  // 6 — sai a coluna de texto, já convertida em turma_id pela migração 5.
  () => {
    if (!colunaExiste('usuarios', 'turma')) return;
    const semVinculo = db.prepare(
      "SELECT COUNT(*) AS n FROM usuarios WHERE trim(turma) <> '' AND turma_id IS NULL"
    ).get().n;
    if (semVinculo) throw new Error(`${semVinculo} usuário(s) com turma sem vínculo: nada foi apagado.`);
    db.exec('ALTER TABLE usuarios DROP COLUMN turma');
  },
  // 7 — conta ativa ou desativada. Toda conta que já existia continua ativa.
  () => {
    if (!colunaExiste('usuarios', 'ativo')) {
      db.exec('ALTER TABLE usuarios ADD COLUMN ativo INTEGER NOT NULL DEFAULT 1');
    }
  },
  // 8 — empréstimo detalhado. Empréstimos retirados antes desta versão ficam sem
  // retirada_em (NULL): a data real não foi registrada.
  () => {
    if (!colunaExiste('reservas', 'retirada_em')) db.exec('ALTER TABLE reservas ADD COLUMN retirada_em TEXT');
    if (!colunaExiste('reservas', 'renovacoes')) {
      db.exec('ALTER TABLE reservas ADD COLUMN renovacoes INTEGER NOT NULL DEFAULT 0');
    }
    if (!colunaExiste('reservas', 'observacao')) db.exec('ALTER TABLE reservas ADD COLUMN observacao TEXT');
  },
  // 9 — lista "Quero ler".
  () => exigirTabela('favoritos'),
  // 10 — mensagens do "Fale conosco".
  () => exigirTabela('mensagens_contato'),
  // 11 — tokens da API v1.
  () => exigirTabela('tokens_api'),
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
