import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * true quando o módulo é o arquivo que o `node` recebeu na linha de comando, e não
 * um import (é o caso dos testes, que precisam do módulo sem os efeitos de executá-lo).
 * Compara caminhos reais: no Windows o mesmo arquivo pode chegar com "c:\" ou "C:\".
 */
export function executadoDiretamente(urlDoModulo) {
  if (!process.argv[1]) return false;
  let chamado = process.argv[1];
  try {
    chamado = realpathSync(chamado);
  } catch {
    chamado = `${chamado}.js`; // `node backend/server`, sem a extensão
  }
  const modulo = fileURLToPath(urlDoModulo);
  return process.platform === 'win32'
    ? chamado.toLowerCase() === modulo.toLowerCase()
    : chamado === modulo;
}
