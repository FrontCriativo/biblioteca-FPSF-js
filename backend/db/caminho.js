import { fileURLToPath } from 'node:url';

// Fora de db/index.js porque importar aquele módulo roda as migrações, e o backup não
// pode migrar o banco que está copiando. DB_PATH=:memory: dá aos testes um banco que
// some quando o processo termina.
export const arquivoBanco = process.env.DB_PATH
  || fileURLToPath(new URL('./biblioteca.db', import.meta.url));
