import { db, transacao } from './index.js';
import { criarHashSenha } from '../auth.js';
import { buscaNormalizadaLivro } from '../texto.js';
import { executadoDiretamente } from '../execucao.js';
import { buscarOuCriarTurma } from '../repositorio.js';
import { emailValido, senhaNova } from '../rotas.js';

const MATERIAS = [
  ['literatura', 'Literatura', 'livro.png'],
  ['matematica', 'Matemática', 'matematica.png'],
  ['historia', 'História', 'historia.png'],
  ['geografia', 'Geografia', 'geografia.png'],
  ['ciencias', 'Ciências', 'ciencias.png'],
  ['filosofia', 'Filosofia', 'filosofia.png'],
  ['artes', 'Artes', 'artes.png'],
  ['musica', 'Música', 'musica.png'],
  ['tecnologia', 'Tecnologia', 'tecnologia.png'],
  ['meio-ambiente', 'Meio Ambiente', 'meioAmbiente.png'],
];

const LIVROS = [
  {
    slug: 'a-revolucao-dos-bichos', titulo: 'A Revolução dos Bichos', autor: 'George Orwell',
    materia: 'literatura', capa: 'aRevolucaoDosBichos.jpg', paginas: 152, exemplares: 3,
    sinopse: 'Os animais de uma granja expulsam o dono e passam a governar a si mesmos. A promessa de igualdade vai se desfazendo conforme os porcos assumem o comando.',
  },
  {
    slug: 'diario-de-um-banana', titulo: 'Diário de um Banana', autor: 'Jeff Kinney',
    materia: 'literatura', capa: 'diarioDeUmBanana.jpg', paginas: 224, exemplares: 4,
    sinopse: 'Greg Heffley registra em forma de diário as confusões do primeiro ano no ensino fundamental II, entre amizades atrapalhadas e planos que nunca saem como esperado.',
  },
  {
    slug: 'dom-quixote', titulo: 'Dom Quixote', autor: 'Miguel de Cervantes',
    materia: 'literatura', capa: 'domQuixote.jpg', paginas: 863, exemplares: 2,
    sinopse: 'Um fidalgo enlouquecido pelas novelas de cavalaria sai pelo campo em busca de aventuras, acompanhado do escudeiro Sancho Pança.',
  },
  {
    slug: 'o-pequeno-principe', titulo: 'O Pequeno Príncipe', autor: 'Antoine de Saint-Exupéry',
    materia: 'literatura', capa: 'oPequenoPrincipe.jpg', paginas: 96, exemplares: 5,
    sinopse: 'Um piloto perdido no deserto encontra um menino vindo de um pequeno planeta distante. Entre uma pergunta e outra, o pequeno viajante conta sobre a rosa que deixou para trás e os lugares estranhos que visitou até chegar à Terra.',
  },
  {
    slug: 'romeu-e-julieta', titulo: 'Romeu e Julieta', autor: 'William Shakespeare',
    materia: 'literatura', capa: 'RomeuAndJulieta.jpg', paginas: 160, exemplares: 2,
    sinopse: 'Duas famílias rivais de Verona e dois jovens que se apaixonam no meio dessa disputa antiga.',
  },
  {
    slug: 'vidas-secas', titulo: 'Vidas Secas', autor: 'Graciliano Ramos',
    materia: 'literatura', capa: 'vidasSecas.jpg', paginas: 176, exemplares: 3,
    sinopse: 'Fabiano, Sinhá Vitória e os dois filhos atravessam o sertão fugindo da seca, carregando pouco mais do que a cachorra Baleia e a esperança de um lugar melhor.',
  },
  {
    slug: 'a-origem-das-especies', titulo: 'A Origem das Espécies', autor: 'Charles Darwin',
    materia: 'ciencias', capa: 'aOrigemDasEspecies.jpg', paginas: 504, exemplares: 2,
    sinopse: 'A obra que apresentou a seleção natural como explicação para a diversidade da vida, reunindo observações feitas ao longo da viagem do Beagle.',
  },
  {
    slug: 'a-republica', titulo: 'A República', autor: 'Platão',
    materia: 'filosofia', capa: 'aRepublica.png', paginas: 416, exemplares: 2,
    sinopse: 'Em diálogos conduzidos por Sócrates, Platão investiga o que é a justiça e como seria uma cidade organizada de forma justa.',
  },
];

// O último campo diz se a conta nasce obrigada a trocar a senha. A coordenação e a Beatriz têm
// senha fixa, sem troca obrigatória.
const USUARIOS = [
  ['Coordenação da Biblioteca', 'admin@fpsf.edu.br', 'Admin.2026', 'admin', null, false],
  ['Beatriz Lima', 'beatriz.lima@fpsf.edu.br', 'Aluno1.2026', 'aluno', '8º ano B', false],
  ['Rafael Souza', 'rafael.souza@fpsf.edu.br', 'aluno123', 'aluno', '9º ano A', true],
];

// Em produção não há conta com senha conhecida: quem publica escolhe a da coordenação.
function contaDeProducao() {
  const email = emailValido(process.env, 'ADMIN_EMAIL', 255);
  const senha = senhaNova(process.env, 'ADMIN_SENHA');
  return ['Coordenação da Biblioteca', email, senha, 'admin', null, true];
}

/** Insere os dados de exemplo. Rodar de novo não duplica nem altera o que já existe. */
export function popular({ usuarios = USUARIOS } = {}) {
  transacao(() => {
    const inserirMateria = db.prepare(
      'INSERT INTO materias (slug, nome, icone) VALUES (?, ?, ?) ON CONFLICT(slug) DO NOTHING'
    );
    for (const m of MATERIAS) inserirMateria.run(...m);

    const inserirLivro = db.prepare(`
      INSERT INTO livros (slug, titulo, autor, materia_slug, capa, sinopse, paginas, busca_normalizada)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(slug) DO NOTHING
    `);
    const inserirExemplar = db.prepare(
      'INSERT INTO exemplares (livro_id, codigo) VALUES (?, ?) ON CONFLICT(codigo) DO NOTHING'
    );

    for (const l of LIVROS) {
      inserirLivro.run(l.slug, l.titulo, l.autor, l.materia, l.capa, l.sinopse, l.paginas,
                       buscaNormalizadaLivro(l.titulo, l.autor));
      const { id } = db.prepare('SELECT id FROM livros WHERE slug = ?').get(l.slug);
      for (let i = 1; i <= l.exemplares; i++) {
        inserirExemplar.run(id, `${l.slug.toUpperCase().slice(0, 8)}-${String(i).padStart(3, '0')}`);
      }
    }

    const inserirUsuario = db.prepare(`
      INSERT INTO usuarios (nome, email, senha_hash, papel, turma_id, trocar_senha)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(email) DO NOTHING
    `);
    for (const [nome, email, senha, papel, turma, trocarSenha] of usuarios) {
      inserirUsuario.run(nome, email, criarHashSenha(senha), papel, turma ? buscarOuCriarTurma(turma).id : null,
                         trocarSenha ? 1 : 0);
    }
  });
}

function popularProducao() {
  let conta;
  try {
    conta = contaDeProducao();
  } catch (erro) {
    console.error(`Seed de produção recusado. ${erro.message}`);
    console.error('Defina ADMIN_EMAIL e ADMIN_SENHA: nenhuma conta de exemplo é criada em produção.');
    process.exit(1);
  }
  popular({ usuarios: [conta] });
  console.log(`Banco populado. Coordenação: ${conta[1]}, com troca de senha no primeiro acesso.`);
}

if (executadoDiretamente(import.meta.url) && process.env.NODE_ENV === 'production') {
  popularProducao();
} else if (executadoDiretamente(import.meta.url)) {
  popular();
  console.log('Banco populado com sucesso.');
  console.log(`  ${MATERIAS.length} matérias, ${LIVROS.length} livros, ${USUARIOS.length} usuários.`);
  console.log('\n  Contas criadas (se ainda não existiam):');
  console.log('    Admin:  admin@fpsf.edu.br / Admin.2026');
  console.log('    Aluno:  beatriz.lima@fpsf.edu.br / Aluno1.2026');
  console.log('    Aluno:  rafael.souza@fpsf.edu.br / aluno123 (troca no primeiro acesso)');
  console.log('\n  Essas senhas estão no código: qualquer pessoa que o leia consegue entrar.');
  console.log('  Em produção (NODE_ENV=production) nenhuma delas é criada.\n');
}
