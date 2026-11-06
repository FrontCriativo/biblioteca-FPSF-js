// Cópia consistente do banco em backup/, com o site no ar. Copiar o arquivo direto não
// serve: os dados mais recentes podem estar só no -wal.

import { DatabaseSync } from 'node:sqlite';
import { chmodSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { arquivoBanco } from '../db/caminho.js';

const doisDigitos = (n) => String(n).padStart(2, '0');

function carimbo(agora = new Date()) {
  const data = [agora.getFullYear(), doisDigitos(agora.getMonth() + 1), doisDigitos(agora.getDate())].join('-');
  return `${data}-${doisDigitos(agora.getHours())}${doisDigitos(agora.getMinutes())}`;
}

/** Dois backups no mesmo minuto não podem ter o mesmo nome: um nunca sobrescreve o outro. */
function caminhoLivre(pasta) {
  const base = `biblioteca-${carimbo()}`;
  let destino = join(pasta, `${base}.sqlite`);
  for (let i = 2; existsSync(destino); i++) destino = join(pasta, `${base}-${i}.sqlite`);
  return destino;
}

if (arquivoBanco === ':memory:' || !existsSync(arquivoBanco)) {
  console.error(`Banco não encontrado: ${arquivoBanco}`);
  process.exit(1);
}

// npm run sempre roda na raiz do projeto.
const pasta = resolve('backup');
mkdirSync(pasta, { recursive: true });
const destino = caminhoLivre(pasta);

// Abre sem passar por db/index.js: a cópia precisa ser do banco como ele está, sem migrar.
const banco = new DatabaseSync(arquivoBanco);
banco.exec(`VACUUM INTO '${destino.replaceAll("'", "''")}'`);
banco.close();

// O backup tem e-mails e hashes de senha.
chmodSync(destino, 0o600);
console.log(`Backup criado: ${destino}`);
