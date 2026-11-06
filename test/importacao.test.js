import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { usarServidor, pedir, entrar, entrarPronto, db, ADMIN, BEATRIZ } from './helpers/servidor.js';
import { lerCsv, alunosDaPlanilha, MAXIMO_LINHAS } from '../backend/planilha.js';

usarServidor();

const importar = async (csv, cookie) => pedir('POST', '/api/admin/usuarios/importar', {
  cookie: cookie ?? await entrarPronto(ADMIN), corpo: { csv },
});

describe('leitura do CSV', () => {
  test('aceita o ";" do Excel, a "," do Google e a tabulação', () => {
    for (const s of [';', ',', '\t']) {
      assert.deepEqual(lerCsv(`nome${s}email\nAna${s}a@b.c`), [['nome', 'email'], ['Ana', 'a@b.c']]);
    }
  });

  test('ignora o BOM e entende CRLF', () => {
    assert.deepEqual(lerCsv('﻿nome;email\r\nAna;a@b.c\r\n'), [['nome', 'email'], ['Ana', 'a@b.c']]);
  });

  test('aspas guardam separador, quebra de linha e aspas', () => {
    assert.deepEqual(lerCsv('nome;email\n"Silva; Ana ""Aninha""\nsegunda";a@b.c'),
      [['nome', 'email'], ['Silva; Ana "Aninha"\nsegunda', 'a@b.c']]);
  });

  test('o título da coluna não depende de maiúsculas, acento nem ordem', () => {
    assert.deepEqual(alunosDaPlanilha('Turma;E-MAIL;Aluno\n8º A;a@b.c;Ana'),
      [{ linha: 2, turma: '8º A', email: 'a@b.c', nome: 'Ana' }]);
  });

  test('a linha informada é a da planilha, mesmo com linha em branco no meio', () => {
    const alunos = alunosDaPlanilha('nome;email\nAna;a@b.c\n;\nBia;b@b.c');
    assert.deepEqual(alunos.map((a) => a.linha), [2, 4]);
  });
});

describe('POST /api/admin/usuarios/importar', () => {
  test('só a coordenação importa', async () => {
    assert.equal((await pedir('POST', '/api/admin/usuarios/importar', { corpo: { csv: 'nome;email' } })).status, 401);
    const r = await importar('nome;email\nAna;ana@escola.br', await entrarPronto(BEATRIZ));
    assert.equal(r.status, 403);
    assert.equal(db.prepare('SELECT 1 FROM usuarios WHERE email = ?').get('ana@escola.br'), undefined);
  });

  test('cria o aluno com turma, senha provisória de uso único e troca obrigatória', async () => {
    const { status, corpo } = await importar('nome;email;turma\nAna Reis;ANA@escola.br;8º ANO B');
    assert.equal(status, 200);
    assert.equal(corpo.criados.length, 1);
    const [aluna] = corpo.criados;
    assert.equal(aluna.email, 'ana@escola.br');
    assert.ok(aluna.senha.length >= 8);

    const conta = db.prepare(`
      SELECT u.papel, u.trocar_senha, t.nome AS turma FROM usuarios u
        LEFT JOIN turmas t ON t.id = u.turma_id WHERE u.email = ?
    `).get('ana@escola.br');
    assert.equal(conta.papel, 'aluno');
    assert.equal(conta.trocar_senha, 1);
    assert.equal(conta.turma, '8º ano B'); // a turma já existia: não duplica

    const cookie = await entrar(aluna.email, aluna.senha);
    assert.equal((await pedir('GET', '/api/reservas', { cookie })).status, 403);
  });

  test('cada aluno recebe uma senha diferente', async () => {
    const { corpo } = await importar('nome;email\nAna;ana@escola.br\nBia;bia@escola.br');
    assert.notEqual(corpo.criados[0].senha, corpo.criados[1].senha);
  });

  test('uma coluna "papel" não cria conta da coordenação', async () => {
    await importar('nome;email;papel\nAna;ana@escola.br;admin');
    assert.equal(db.prepare('SELECT papel FROM usuarios WHERE email = ?').get('ana@escola.br').papel, 'aluno');
  });

  test('e-mail já cadastrado é ignorado, e a conta e a senha continuam como estavam', async () => {
    const antes = db.prepare('SELECT nome, senha_hash FROM usuarios WHERE email = ?').get(BEATRIZ);
    const { corpo } = await importar(`nome;email\nOutro Nome;${BEATRIZ.toUpperCase()}\nAna;ana@escola.br`);
    assert.deepEqual(corpo.ignorados, [{ linha: 2, email: BEATRIZ }]);
    assert.equal(corpo.criados.length, 1);
    assert.deepEqual(db.prepare('SELECT nome, senha_hash FROM usuarios WHERE email = ?').get(BEATRIZ), antes);
  });

  test('enviar a mesma planilha de novo não duplica', async () => {
    const admin = await entrarPronto(ADMIN);
    await importar('nome;email\nAna;ana@escola.br', admin);
    const { corpo } = await importar('nome;email\nAna;ana@escola.br', admin);
    assert.equal(corpo.criados.length, 0);
    assert.equal(corpo.ignorados.length, 1);
  });

  test('linha ruim vira erro com o número da linha, e as boas entram', async () => {
    const csv = 'nome;email;turma\nAna;ana@escola.br;\n;sem-nome@escola.br;\nBia;nao-e-email;\nCia;ana@escola.br;\n'
      + `Dani;dani@escola.br;${'x'.repeat(41)}`;
    const { status, corpo } = await importar(csv);
    assert.equal(status, 200);
    assert.deepEqual(corpo.criados.map((a) => a.email), ['ana@escola.br']);
    assert.deepEqual(corpo.erros.map((e) => e.linha), [3, 4, 5, 6]);
    assert.match(corpo.erros[2].motivo, /repetido/);
  });

  test('sem as colunas, o arquivo inteiro é recusado', async () => {
    const r = await importar('primeiro;segundo\nAna;ana@escola.br');
    assert.equal(r.status, 400);
    assert.match(r.corpo.erro, /"nome" e "email"/);
  });

  test('planilha só com o cabeçalho é recusada', async () => {
    assert.equal((await importar('nome;email\n')).status, 400);
  });

  test('acima do limite de linhas, nada entra', async () => {
    const linhas = Array.from({ length: MAXIMO_LINHAS + 1 }, (_, i) => `A${i};a${i}@escola.br`);
    const r = await importar(`nome;email\n${linhas.join('\n')}`);
    assert.equal(r.status, 400);
    assert.equal(db.prepare('SELECT 1 FROM usuarios WHERE email = ?').get('a0@escola.br'), undefined);
  });
});
