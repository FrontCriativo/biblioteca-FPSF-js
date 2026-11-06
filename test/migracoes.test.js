import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
const SCHEMA_V4 = fileURLToPath(new URL('./fixtures/schema-v4.sql', import.meta.url));

let pasta;

before(() => { pasta = mkdtempSync(join(tmpdir(), 'biblioteca-migracao-')); });
after(() => rmSync(pasta, { recursive: true, force: true }));

/** O código real abre o banco num processo novo, como o `npm start` faria. */
function abrirComOCodigoAtual(arquivo) {
  const r = spawnSync(process.execPath, ['--no-warnings', '--input-type=module', '-e', "await import('./backend/db/index.js')"], {
    cwd: RAIZ, env: { ...process.env, DB_PATH: arquivo }, encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stderr);
}

/** Banco como o da versão anterior (user_version 4), com dados de verdade. */
function criarBancoAntigo(nome) {
  const arquivo = join(pasta, nome);
  const db = new DatabaseSync(arquivo);
  db.exec(readFileSync(SCHEMA_V4, 'utf8'));
  db.exec(`
    PRAGMA user_version = 4;
    INSERT INTO usuarios (id, nome, email, senha_hash, papel, turma, trocar_senha) VALUES
      (1, 'Coordenação', 'admin@fpsf.edu.br', 'sal:hash', 'admin', NULL, 0),
      (2, 'Beatriz', 'beatriz@fpsf.edu.br', 'sal:hash', 'aluno', '8º ano B', 1),
      (3, 'Rafael', 'rafael@fpsf.edu.br', 'sal:hash', 'aluno', '  8º ANO B ', 0),
      (4, 'Carla', 'carla@fpsf.edu.br', 'sal:hash', 'aluno', '', 0),
      (5, 'Davi', 'davi@fpsf.edu.br', 'sal:hash', 'aluno', 'Turma com um nome muito maior que quarenta caracteres', 0);
    INSERT INTO materias (slug, nome, icone) VALUES ('literatura', 'Literatura', 'livro.png');
    INSERT INTO livros (id, slug, titulo, autor, materia_slug, busca_normalizada)
      VALUES (1, 'dom-quixote', 'Dom Quixote', 'Cervantes', 'literatura', 'dom quixote cervantes');
    INSERT INTO exemplares (id, livro_id, codigo) VALUES (1, 1, 'A'), (2, 1, 'B'), (3, 1, 'C');
    INSERT INTO reservas (id, exemplar_id, usuario_id, status, expira_em, devolver_ate) VALUES
      (1, 1, 2, 'retirada', '2026-01-01 00:00:00', '2026-01-15 00:00:00'),
      (2, 2, 3, 'ativa', '2099-01-01 00:00:00', NULL),
      (3, 3, 2, 'devolvida', '2026-01-01 00:00:00', NULL);
    INSERT INTO sessoes (token, usuario_id, expira_em) VALUES ('abc', 2, '2099-01-01 00:00:00');
    INSERT INTO depoimentos (id, usuario_id, nome, turma, mensagem, nota, status)
      VALUES (1, 2, 'Beatriz', '8º ano B', 'Ótima.', 5, 'aprovado');
  `);
  db.close();
  return arquivo;
}

function consultar(arquivo, fn) {
  const db = new DatabaseSync(arquivo);
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

describe('banco antigo', () => {
  let arquivo;

  before(() => {
    arquivo = criarBancoAntigo('antigo.db');
    abrirComOCodigoAtual(arquivo);
  });

  test('não perde livros, usuários, reservas, sessões nem depoimentos', () => {
    consultar(arquivo, (db) => {
      const contar = (t) => db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
      assert.equal(contar('usuarios'), 5);
      assert.equal(contar('livros'), 1);
      assert.equal(contar('exemplares'), 3);
      assert.equal(contar('reservas'), 3);
      assert.equal(contar('sessoes'), 1);
      assert.equal(contar('depoimentos'), 1);
      const reserva = db.prepare('SELECT * FROM reservas WHERE id = 1').get();
      assert.equal(reserva.status, 'retirada');
      assert.equal(reserva.devolver_ate, '2026-01-15 00:00:00');
    });
  });

  test('cada turma distinta vira uma linha e os usuários ficam ligados', () => {
    consultar(arquivo, (db) => {
      const turmas = db.prepare('SELECT nome, ano_letivo, ativa FROM turmas ORDER BY id').all();
      assert.equal(turmas.length, 2, 'variações de espaço e caixa são a mesma turma');
      assert.equal(turmas[0].ano_letivo, new Date().getFullYear());
      assert.equal(turmas[0].ativa, 1);
      const turmaDe = (id) => db.prepare(
        'SELECT t.nome FROM usuarios u LEFT JOIN turmas t ON t.id = u.turma_id WHERE u.id = ?'
      ).get(id).nome;
      assert.equal(turmaDe(2).toLowerCase(), '8º ano b');
      assert.equal(turmaDe(3).toLowerCase(), '8º ano b');
      assert.equal(turmaDe(1), null);
      assert.equal(turmaDe(4), null, 'texto vazio não vira turma');
      assert.equal(turmaDe(5), 'Turma com um nome muito maior que quarenta caracteres');
    });
  });

  test('a coluna de texto saiu e as contas continuam ativas', () => {
    consultar(arquivo, (db) => {
      const colunas = db.prepare('PRAGMA table_info(usuarios)').all().map((c) => c.name);
      assert.ok(!colunas.includes('turma'));
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM usuarios WHERE ativo = 1').get().n, 5);
      assert.equal(db.prepare('SELECT trocar_senha FROM usuarios WHERE id = 2').get().trocar_senha, 1);
    });
  });

  test('empréstimos antigos ficam sem data de retirada e sem renovações', () => {
    consultar(arquivo, (db) => {
      const { retirada_em, renovacoes, observacao } = db.prepare('SELECT * FROM reservas WHERE id = 1').get();
      assert.equal(retirada_em, null);
      assert.equal(renovacoes, 0);
      assert.equal(observacao, null);
    });
  });

  test('abrir de novo não muda nada', () => {
    const fotografar = () => consultar(arquivo, (db) => JSON.stringify([
      db.prepare('PRAGMA user_version').get(),
      db.prepare('SELECT * FROM usuarios ORDER BY id').all(),
      db.prepare('SELECT * FROM turmas ORDER BY id').all(),
    ]));
    const antes = fotografar();
    abrirComOCodigoAtual(arquivo);
    assert.equal(fotografar(), antes);
  });

  test('a migração falha sem apagar nada se restar turma sem vínculo', () => {
    // Simula o que a migração 6 protege: usuário com texto de turma e sem turma_id.
    const copia = criarBancoAntigo('quebrado.db');
    consultar(copia, (db) => {
      db.exec(`
        ALTER TABLE usuarios ADD COLUMN turma_id INTEGER;
        PRAGMA user_version = 5;
      `);
    });
    const r = spawnSync(process.execPath, ['--no-warnings', '--input-type=module', '-e', "await import('./backend/db/index.js')"], {
      cwd: RAIZ, env: { ...process.env, DB_PATH: copia }, encoding: 'utf8',
    });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /turma sem vínculo/);
    consultar(copia, (db) => {
      assert.equal(db.prepare('SELECT turma FROM usuarios WHERE id = 2').get().turma, '8º ano B');
      assert.equal(db.prepare('PRAGMA user_version').get().user_version, 5);
    });
  });
});

describe('banco novo', () => {
  /** Colunas e índices, sem depender da ordem em que foram criados. */
  function estrutura(arquivo) {
    return consultar(arquivo, (db) => {
      const tabelas = db.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
      ).all().map((t) => t.name);
      return {
        versao: db.prepare('PRAGMA user_version').get().user_version,
        indices: db.prepare(
          "SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%' ORDER BY name"
        ).all().map((i) => i.name),
        tabelas: Object.fromEntries(tabelas.map((tabela) => [
          tabela,
          db.prepare(`PRAGMA table_info(${tabela})`).all()
            .map(({ name, type, notnull, dflt_value }) => `${name} ${type} ${notnull} ${dflt_value}`)
            .sort(),
        ])),
        chaves: Object.fromEntries(tabelas.map((tabela) => [
          tabela,
          db.prepare(`PRAGMA foreign_key_list(${tabela})`).all()
            .map((f) => `${f.from} → ${f.table}.${f.to} ${f.on_delete}`)
            .sort(),
        ])),
      };
    });
  }

  test('schema.sql e as migrações chegam à mesma estrutura', () => {
    const novo = join(pasta, 'novo.db');
    abrirComOCodigoAtual(novo);
    const antigo = criarBancoAntigo('comparar.db');
    abrirComOCodigoAtual(antigo);
    assert.deepEqual(estrutura(antigo), estrutura(novo));
  });

  test('não sobra coluna de texto da turma', () => {
    const novo = join(pasta, 'novo2.db');
    abrirComOCodigoAtual(novo);
    consultar(novo, (db) => {
      const colunas = db.prepare('PRAGMA table_info(usuarios)').all().map((c) => c.name);
      assert.ok(colunas.includes('turma_id'));
      assert.ok(!colunas.includes('turma'));
    });
  });
});
