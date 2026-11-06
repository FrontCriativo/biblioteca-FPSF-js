// Normalização de texto usada na busca e na geração de slugs.

/** Minúsculas e sem acentos: "Revolução" → "revolucao". */
export function normalizarTexto(texto) {
  return String(texto ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/** Texto pesquisável de um livro: título + autor, normalizados. */
export function buscaNormalizadaLivro(titulo, autor) {
  return normalizarTexto(`${titulo} ${autor}`);
}

/** Forma canônica do e-mail: é como ele é gravado e consultado. */
export function normalizarEmail(email) {
  return String(email ?? '').trim().toLowerCase();
}
