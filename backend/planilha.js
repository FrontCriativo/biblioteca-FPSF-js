// Leitura da planilha de alunos, salva como CSV pelo Excel ou pelo Google Planilhas.
import { ErroValidacao } from './http.js';
import { normalizarTexto } from './texto.js';

export const MAXIMO_LINHAS = 2000;

// O Excel em português separa por ";", e o Google Planilhas por ",".
function separadorDe(texto) {
  const cabecalho = texto.split(/\r?\n/, 1)[0];
  const contar = (caractere) => cabecalho.split(caractere).length;
  return [';', ',', '\t'].reduce((melhor, s) => (contar(s) > contar(melhor) ? s : melhor));
}

/** Devolve as linhas como listas de células. Aspas podem guardar separador e quebra de linha. */
export function lerCsv(texto) {
  const conteudo = texto.replace(/^﻿/, '');
  const separador = separadorDe(conteudo);
  const linhas = [];
  let linha = [];
  let celula = '';
  let entreAspas = false;

  for (let i = 0; i < conteudo.length; i++) {
    const c = conteudo[i];
    if (entreAspas) {
      if (c !== '"') celula += c;
      else if (conteudo[i + 1] === '"') { celula += '"'; i++; }
      else entreAspas = false;
    } else if (c === '"') {
      entreAspas = true;
    } else if (c === separador) {
      linha.push(celula);
      celula = '';
    } else if (c === '\n') {
      linhas.push([...linha, celula.replace(/\r$/, '')]);
      linha = [];
      celula = '';
    } else {
      celula += c;
    }
  }
  if (celula || linha.length) linhas.push([...linha, celula]);
  return linhas;
}

const NOMES_DE_COLUNA = { nome: 'nome', aluno: 'nome', email: 'email', 'e-mail': 'email', turma: 'turma' };

/**
 * Devolve { linha, nome, email, turma } de cada aluno, com a linha que ele ocupa na planilha.
 * Só recusa o arquivo inteiro: quem confere cada aluno é a rota.
 */
export function alunosDaPlanilha(texto) {
  const [cabecalho = [], ...resto] = lerCsv(texto);
  const colunas = cabecalho.map((titulo) => NOMES_DE_COLUNA[normalizarTexto(titulo).trim()]);
  if (!colunas.includes('nome') || !colunas.includes('email')) {
    throw new ErroValidacao('A primeira linha da planilha precisa ter as colunas "nome" e "email".');
  }

  const alunos = [];
  resto.forEach((celulas, indice) => {
    if (celulas.every((celula) => !celula.trim())) return; // linha em branco no meio da planilha
    const aluno = { linha: indice + 2 };
    colunas.forEach((coluna, i) => { if (coluna) aluno[coluna] = celulas[i]?.trim() ?? ''; });
    alunos.push(aluno);
  });

  if (!alunos.length) throw new ErroValidacao('A planilha não tem nenhum aluno.');
  if (alunos.length > MAXIMO_LINHAS) {
    throw new ErroValidacao(`Envie no máximo ${MAXIMO_LINHAS} alunos por vez.`);
  }
  return alunos;
}
