// Sobe a aplicação numa porta aleatória, com banco em memória já populado.
// Cada arquivo de teste roda no próprio processo, então tem o próprio banco.
import { before, after, beforeEach } from 'node:test';

process.env.DB_PATH = ':memory:';

// Import dinâmico: o banco lê DB_PATH ao carregar, e um import estático rodaria antes da linha acima.
const { criarServidor } = await import('../../backend/server.js');
const { db, transacao } = await import('../../backend/db/index.js');
const { popular } = await import('../../backend/db/seed.js');
const { zerarLimites } = await import('../../backend/limite.js');

export { db };

export const SENHA_ADMIN = 'admin123';
export const SENHA_ALUNO = 'aluno123';
export const ADMIN = 'admin@fpsf.edu.br';
export const BEATRIZ = 'beatriz.lima@fpsf.edu.br';
export const RAFAEL = 'rafael.souza@fpsf.edu.br';

let servidor;
let base;
let foto; // conteúdo das tabelas logo depois do seed

function tirarFoto() {
  const tabelas = db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
  ).all().map((t) => t.name);
  foto = tabelas.map((tabela) => [tabela, db.prepare(`SELECT * FROM ${tabela}`).all()]);
}

// Volta o banco ao estado do seed sem recalcular os hashes de senha, que são lentos de propósito.
function restaurarFoto() {
  db.exec('PRAGMA foreign_keys = OFF');
  transacao(() => {
    for (const [tabela, linhas] of foto) {
      db.exec(`DELETE FROM ${tabela}`);
      for (const linha of linhas) {
        const colunas = Object.keys(linha);
        db.prepare(
          `INSERT INTO ${tabela} (${colunas.join(', ')}) VALUES (${colunas.map(() => '?').join(', ')})`
        ).run(...Object.values(linha));
      }
    }
  });
  db.exec('PRAGMA foreign_keys = ON');
}

/** Chame no topo do arquivo de teste: sobe o servidor e isola um caso do outro. */
export function usarServidor() {
  before(async () => {
    popular();
    tirarFoto();
    servidor = criarServidor();
    await new Promise((pronto) => servidor.listen(0, '127.0.0.1', pronto));
    base = `http://127.0.0.1:${servidor.address().port}`;
  });

  beforeEach(() => {
    restaurarFoto();
    zerarLimites();
  });

  after(async () => {
    servidor.closeAllConnections();
    await new Promise((pronto) => servidor.close(pronto));
  });
}

export const portaDoServidor = () => servidor.address().port;

/** Faz uma requisição e devolve { status, corpo, cabecalhos, cookie }. */
export async function pedir(metodo, caminho, { corpo, cookie, token, cabecalhos = {} } = {}) {
  const resposta = await fetch(base + caminho, {
    method: metodo,
    headers: {
      ...(corpo !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...cabecalhos,
    },
    body: corpo === undefined ? undefined : (typeof corpo === 'string' ? corpo : JSON.stringify(corpo)),
  });
  const texto = await resposta.text();
  let dados = texto;
  try {
    dados = JSON.parse(texto);
  } catch {
    // HTML ou corpo vazio: fica o texto
  }
  return {
    status: resposta.status,
    corpo: dados,
    cabecalhos: resposta.headers,
    cookie: resposta.headers.get('set-cookie')?.split(';')[0] ?? null,
  };
}

/** Login sem mexer em nada: a conta continua com a troca de senha pendente, se tiver. */
export async function entrar(email, senha) {
  const { status, cookie } = await pedir('POST', '/api/login', { corpo: { email, senha } });
  if (status !== 200) throw new Error(`Login de ${email} falhou com ${status}`);
  return cookie;
}

/** Login de uma conta que já passou pela troca de senha obrigatória. */
export async function entrarPronto(email) {
  db.prepare('UPDATE usuarios SET trocar_senha = 0 WHERE email = ?').run(email);
  return entrar(email, email === ADMIN ? SENHA_ADMIN : SENHA_ALUNO);
}

export const idDoLivro = (slug) => db.prepare('SELECT id FROM livros WHERE slug = ?').get(slug).id;
export const idDoUsuario = (email) => db.prepare('SELECT id FROM usuarios WHERE email = ?').get(email).id;

/** Reserva um livro pela API e devolve o corpo da resposta. */
export async function reservar(cookie, slug) {
  const { status, corpo } = await pedir('POST', '/api/reservas', { cookie, corpo: { livro_id: idDoLivro(slug) } });
  if (status !== 201) throw new Error(`Reserva de ${slug} falhou com ${status}: ${corpo.erro}`);
  return corpo;
}
