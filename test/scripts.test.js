import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
const BACKUP = join(RAIZ, 'backend/scripts/backup.js');
const SCHEMA_V4 = fileURLToPath(new URL('./fixtures/schema-v4.sql', import.meta.url));

let pasta;

before(() => { pasta = mkdtempSync(join(tmpdir(), 'biblioteca-scripts-')); });
after(() => rmSync(pasta, { recursive: true, force: true }));

const rodar = (arquivo, dbPath, cwd = RAIZ) => spawnSync(process.execPath, ['--no-warnings', arquivo], {
  cwd, env: { ...process.env, DB_PATH: dbPath }, encoding: 'utf8',
});

describe('npm run expirar', () => {
  test('cancela só as pré-reservas vencidas e informa quantas', () => {
    const arquivo = join(pasta, 'expirar.db');
    rodar('backend/db/seed.js', arquivo);
    const db = new DatabaseSync(arquivo);
    db.exec(`
      INSERT INTO reservas (exemplar_id, usuario_id, expira_em) VALUES
        (1, 2, datetime('now', '-1 hour')), (2, 2, datetime('now', '-1 day')), (3, 2, datetime('now', '+1 day'));
    `);
    db.close();

    const r = rodar('backend/scripts/expirar.js', arquivo);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /2 pré-reserva\(s\) vencida\(s\) cancelada\(s\)/);

    const depois = new DatabaseSync(arquivo);
    const contar = (status) => depois.prepare('SELECT COUNT(*) AS n FROM reservas WHERE status = ?').get(status).n;
    assert.equal(contar('cancelada'), 2);
    assert.equal(contar('ativa'), 1);
    depois.close();
    assert.match(rodar('backend/scripts/expirar.js', arquivo).stdout, /^0 pré-reserva/);
  });
});

describe('npm run backup', () => {
  const backups = (cwd) => readdirSync(join(cwd, 'backup')).sort();

  test('copia os dados que ainda estão no -wal, com o banco aberto por outro processo', () => {
    const cwd = mkdtempSync(join(pasta, 'wal-'));
    const arquivo = join(pasta, 'no-ar.db');
    // Esta conexão fica aberta durante o backup, como a do servidor no ar.
    const noAr = new DatabaseSync(arquivo);
    noAr.exec("PRAGMA journal_mode = WAL; CREATE TABLE t (v TEXT); INSERT INTO t VALUES ('recente');");
    assert.ok(statSync(`${arquivo}-wal`).size > 0, 'o dado precisa estar no -wal para o teste valer');

    const r = rodar(BACKUP, arquivo, cwd);
    assert.equal(r.status, 0, r.stderr);
    noAr.close();

    const [nome] = backups(cwd);
    assert.match(nome, /^biblioteca-\d{4}-\d{2}-\d{2}-\d{4}\.sqlite$/);
    assert.ok(r.stdout.includes(nome));
    const copia = new DatabaseSync(join(cwd, 'backup', nome));
    assert.equal(copia.prepare('SELECT v FROM t').get().v, 'recente');
    copia.close();
  });

  test('não sobrescreve backup existente, nem no mesmo minuto', () => {
    const cwd = mkdtempSync(join(pasta, 'duplo-'));
    const arquivo = join(pasta, 'duplo.db');
    const db = new DatabaseSync(arquivo);
    db.exec("CREATE TABLE t (v TEXT); INSERT INTO t VALUES ('primeiro');");
    assert.equal(rodar(BACKUP, arquivo, cwd).status, 0);
    db.exec("UPDATE t SET v = 'segundo'");
    assert.equal(rodar(BACKUP, arquivo, cwd).status, 0);
    db.close();

    const nomes = backups(cwd);
    assert.equal(nomes.length, 2);
    const valores = nomes.map((nome) => {
      const copia = new DatabaseSync(join(cwd, 'backup', nome));
      const { v } = copia.prepare('SELECT v FROM t').get();
      copia.close();
      return v;
    });
    assert.deepEqual([...valores].sort(), ['primeiro', 'segundo']);
  });

  test('não migra o banco copiado: quem faz backup antes de atualizar guarda a versão antiga', () => {
    const cwd = mkdtempSync(join(pasta, 'antigo-'));
    const arquivo = join(pasta, 'antigo.db');
    const db = new DatabaseSync(arquivo);
    db.exec(readFileSync(SCHEMA_V4, 'utf8'));
    db.exec('PRAGMA user_version = 4');
    db.close();

    assert.equal(rodar(BACKUP, arquivo, cwd).status, 0);

    const versao = (caminho) => {
      const banco = new DatabaseSync(caminho);
      const { user_version } = banco.prepare('PRAGMA user_version').get();
      banco.close();
      return user_version;
    };
    assert.equal(versao(arquivo), 4);
    assert.equal(versao(join(cwd, 'backup', backups(cwd)[0])), 4);
  });

  test('banco inexistente é erro, e nada é criado', () => {
    const cwd = mkdtempSync(join(pasta, 'sem-banco-'));
    const arquivo = join(pasta, 'nao-existe.db');
    const r = rodar(BACKUP, arquivo, cwd);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /Banco não encontrado/);
    assert.equal(existsSync(arquivo), false);
    assert.equal(existsSync(join(cwd, 'backup')), false);
  });

  test('backup/ fica fora do Git e da imagem Docker', () => {
    const ler = (nome) => readFileSync(join(RAIZ, nome), 'utf8');
    assert.match(ler('.gitignore'), /^backup\/$/m);
    assert.match(ler('.dockerignore'), /^backup$/m);
    assert.match(ler('.dockerignore'), /biblioteca\.db/);
  });
});

describe('package.json', () => {
  test('continua sem dependências', () => {
    const pacote = JSON.parse(readFileSync(join(RAIZ, 'package.json'), 'utf8'));
    assert.equal(pacote.dependencies, undefined);
    assert.equal(pacote.devDependencies, undefined);
    for (const script of ['start', 'dev', 'seed', 'test', 'expirar', 'backup']) assert.ok(pacote.scripts[script], script);
  });
});
