# Biblioteca Virtual FPSF

Site da biblioteca da Escola Prof. Francisco Pereira de Souza Filho: catálogo com busca,
pré-reserva de livros, empréstimos, lista "Quero ler", depoimentos moderados, fale conosco
e painel da coordenação. Tem também uma API pública (v1) para o aplicativo Expo e outros
sistemas.

Feito em Node.js puro, sem dependências: `node:http` no servidor, `node:sqlite` no banco e
HTML, CSS e JavaScript sem framework no front-end.

## Requisitos

Node.js 22.5 ou mais novo. Da 22.5 à 22.12, o `node:sqlite` só funciona com a opção
`--experimental-sqlite`; a partir da 22.13 ela não é necessária.

## Como rodar

```bash
npm run seed   # cria o banco com dados de exemplo
npm start      # sobe o site em http://localhost:3000
```

| Comando | O que faz |
|---|---|
| `npm start` | Sobe o servidor |
| `npm run dev` | Sobe o servidor e reinicia a cada alteração |
| `npm run seed` | Insere os dados de exemplo. Rodar de novo não duplica nada |
| `npm test` | Roda os testes, num banco em memória |
| `npm run expirar` | Cancela as pré-reservas vencidas e informa quantas |
| `npm run backup` | Faz uma cópia consistente do banco em `backup/`, com o site no ar |

### Contas de exemplo

| Perfil | E-mail | Senha |
|---|---|---|
| Coordenação | `admin@fpsf.edu.br` | `admin123` |
| Aluno | `beatriz.lima@fpsf.edu.br` | `aluno123` |
| Aluno | `rafael.souza@fpsf.edu.br` | `aluno123` |

> **Atenção:** essas senhas estão no código, então qualquer pessoa pode conhecê-las. Toda conta
> de exemplo é obrigada a trocar a senha no primeiro acesso. Faça isso antes de colocar o site
> no ar.

## Estrutura

```
backend/
  server.js        servidor HTTP e arquivos estáticos
  rotas.js         API do site, validação e roteador
  api-v1.js        API pública v1
  repositorio.js   SQL do domínio
  auth.js          senhas, sessões e tokens
  http.js          leitura do corpo, respostas e erros
  planilha.js      leitura do CSV de alunos
  limite.js        limites de uso em memória
  texto.js         normalização de texto
  db/              schema.sql, migrações (index.js) e seed.js
  scripts/         tarefas de manutenção (expirar e backup)
frontend/          páginas, css/, js/ e assets/ (capas e ícones)
test/              testes com node:test
docs/              guias da API, do banco e de publicação
docker/            script de início do contêiner e configuração do Caddy
```

## API do site

Usada pelas páginas em `frontend/js/api.js`. Autenticação por cookie de sessão; erros no formato
`{ "erro": "mensagem" }`. Sistemas externos devem usar a [API v1](#api-v1).

| Método | Rota | Acesso | O que faz |
|---|---|---|---|
| POST | `/api/login` | Público | Abre a sessão |
| GET | `/api/auth/google` | Público | Leva ao login com o Google; aceita `?destino=` |
| GET | `/api/auth/google/retorno` | Público | Volta do Google: abre a sessão e redireciona para o login |
| POST | `/api/logout` | Público | Encerra a sessão |
| GET | `/api/eu` | Público | Usuário da sessão, ou `null` |
| POST | `/api/eu/senha` | Logado | Troca a própria senha e derruba os outros acessos |
| GET | `/api/materias` | Público | Matérias |
| GET | `/api/livros` | Público | Livros; filtros `?materia=` e `?busca=` |
| GET | `/api/livros/:slug` | Público | Um livro |
| POST | `/api/livros` | Coordenação | Cria um livro |
| PUT | `/api/livros/:id` | Coordenação | Altera um livro |
| DELETE | `/api/livros/:id` | Coordenação | Remove um livro sem histórico de reservas |
| POST | `/api/livros/:id/exemplares` | Coordenação | Adiciona exemplares |
| POST | `/api/admin/capas` | Coordenação | Envia uma capa |
| GET | `/api/reservas` | Logado | Minhas reservas |
| POST | `/api/reservas` | Logado | Faz uma pré-reserva |
| POST | `/api/reservas/:id/cancelar` | Logado | Cancela; aluno só a própria e ainda não retirada |
| POST | `/api/reservas/:id/renovar` | Logado | Renova o próprio empréstimo |
| GET | `/api/favoritos` | Logado | Lista "Quero ler" |
| PUT | `/api/favoritos/:livroId` | Logado | Adiciona à lista |
| DELETE | `/api/favoritos/:livroId` | Logado | Remove da lista |
| GET | `/api/depoimentos` | Público | Depoimentos aprovados |
| POST | `/api/depoimentos` | Público | Envia um depoimento para moderação |
| POST | `/api/contato` | Público | Envia uma mensagem à biblioteca |
| GET | `/api/admin/resumo` | Coordenação | Números do painel |
| GET | `/api/admin/reservas` | Coordenação | Reservas; filtro `?status=`, inclusive `atrasadas` |
| POST | `/api/admin/reservas/:id/retirar` | Coordenação | Registra a retirada |
| POST | `/api/admin/reservas/:id/devolver` | Coordenação | Registra a devolução |
| POST | `/api/admin/reservas/:id/renovar` | Coordenação | Renova, sem limite de vezes |
| PUT | `/api/admin/reservas/:id/observacao` | Coordenação | Grava a anotação interna |
| GET | `/api/admin/turmas` | Coordenação | Turmas ativas |
| GET | `/api/admin/usuarios` | Coordenação | Usuários |
| POST | `/api/admin/usuarios` | Coordenação | Cria um usuário |
| POST | `/api/admin/usuarios/importar` | Coordenação | Cria alunos a partir de um CSV e devolve as senhas provisórias |
| POST | `/api/admin/usuarios/:id/senha` | Coordenação | Redefine a senha de outro usuário |
| POST | `/api/admin/usuarios/:id/desativar` | Coordenação | Desativa uma conta |
| POST | `/api/admin/usuarios/:id/reativar` | Coordenação | Reativa uma conta |
| GET | `/api/admin/depoimentos` | Coordenação | Depoimentos para moderar |
| POST | `/api/admin/depoimentos/:id/aprovar` | Coordenação | Aprova |
| POST | `/api/admin/depoimentos/:id/recusar` | Coordenação | Recusa |
| GET | `/api/admin/mensagens` | Coordenação | Mensagens; filtro `?status=` |
| POST | `/api/admin/mensagens/:id/status` | Coordenação | Muda a situação de uma mensagem |

## API v1

API pública em `/api/v1`, com autenticação por token, respostas `{ "success": true, "data": ... }`
e CORS. Tem o mesmo contrato da versão Laravel: o mesmo aplicativo Expo funciona com os dois
back-ends.

- Referência completa: abra `/api/documentacao` com o servidor no ar.
- [docs/api-v1.md](docs/api-v1.md): autenticação passo a passo, com `curl`.
- [docs/app-expo.md](docs/app-expo.md): rotas do aplicativo e como testar no celular.
- [docs/postman/](docs/postman/biblioteca-fpsf-v1.postman_collection.json): collection do Postman.

## Variáveis de ambiente

| Variável | Padrão | O que faz |
|---|---|---|
| `PORT` | `3000` | Porta do servidor |
| `HOST` | todas as interfaces | Endereço em que o servidor escuta. Use `127.0.0.1` atrás de proxy reverso |
| `NODE_ENV` | | Com `production`, o cookie de sessão sai com `Secure` e só funciona em HTTPS |
| `DB_PATH` | `backend/db/biblioteca.db` | Arquivo do banco. `:memory:` cria um banco temporário |
| `CORS_ORIGENS` | `*` | Origens liberadas na v1, separadas por vírgula |
| `V1_LIMITE_POR_MINUTO` | `60` | Requisições por minuto, por IP, na v1 |
| `CONFIAR_PROXY` | | Com `1`, o IP do cliente vem do cabeçalho `X-Real-IP`. Só use atrás de proxy reverso (ver [docs/deploy.md](docs/deploy.md)) |
| `ADMIN_EMAIL`, `ADMIN_SENHA` | | Conta da coordenação criada pelo seed com `NODE_ENV=production`. Só valem na criação do banco |
| `GOOGLE_CLIENT_ID` | | Client ID do login com o Google. Sem ele e o segredo, o botão avisa que o login não está disponível (ver [docs/deploy.md](docs/deploy.md#login-com-o-google)) |
| `GOOGLE_CLIENT_SECRET` | | Segredo do mesmo cliente |
| `GOOGLE_URL_RETORNO` | `http://localhost:PORT/api/auth/google/retorno` | URL de retorno, igual à cadastrada no Google |
| `GOOGLE_DOMINIOS` | `al.educacao.sp.gov.br,aluno.educacao.sp.gov.br` | Domínios de e-mail aceitos no login com o Google, separados por vírgula |

## Banco de dados

SQLite, descrito em [docs/banco-de-dados.md](docs/banco-de-dados.md). As migrações rodam sozinhas
quando o servidor sobe.

### Como criar uma migração

1. Acrescente uma função ao fim do array `MIGRACOES`, em `backend/db/index.js`. **Nunca edite uma
   migração que já existe.**
2. Faça a migração conferir o que falta antes de agir, com `colunaExiste()`: ela roda em bancos
   novos e antigos.
3. Reflita a mudança no `backend/db/schema.sql`, que descreve um banco novo completo.
4. O `schema.sql` roda antes das migrações, inclusive em bancos antigos. Por isso, um índice sobre
   coluna nova de tabela que já existia fica na migração, não no `schema.sql`.
5. Rode `npm test`: um teste compara o banco criado do zero com um banco antigo migrado.

### O que nunca fazer no banco de produção

- Não rode `npm test` nem experimente migrações apontando `DB_PATH` para ele.
- Não apague o arquivo para "recomeçar": livros, contas e histórico de empréstimos não voltam.
- Não copie só o `biblioteca.db` com o site no ar: os dados recentes podem estar no `-wal`.
- Não edite migração que já rodou: ela não roda de novo, e o banco fica diferente do código.
- Não publique o banco nem os backups: eles têm e-mails e hashes de senha.

## Backup

`npm run backup` grava `backup/biblioteca-AAAA-MM-DD-HHMM.sqlite`, sem sobrescrever nenhum arquivo.
A cópia é consistente mesmo com o site no ar, e o banco não é migrado. Faça um antes de atualizar o
código. A pasta `backup/` fica fora do Git, porque os backups têm e-mails e hashes de senha.

O backup cobre só o banco. As capas enviadas pelo painel ficam em `frontend/assets/`.

### Restaurar um backup

Com o servidor parado, tire o banco atual do lugar em vez de apagá-lo, inclusive os arquivos
`-wal` e `-shm`, e copie o backup para o lugar dele:

```bash
mkdir -p backup/substituido
mv backend/db/biblioteca.db* backup/substituido/
cp backup/biblioteca-2026-11-06-0200.sqlite backend/db/biblioteca.db
npm start
```

Se o backup for de uma versão anterior, as migrações rodam ao subir. Se o banco estiver em outro
lugar, troque o caminho pelo de `DB_PATH`.

### Voltar aos dados de exemplo

O seed não apaga nada: em cima de um banco existente, ele só insere o que falta. Para recomeçar,
mova o banco para `backup/` e rode o seed, com o servidor parado:

```bash
mkdir -p backup/substituido
mv backend/db/biblioteca.db* backup/substituido/
npm run seed
```

As contas voltam às senhas de exemplo, com a troca obrigatória no primeiro acesso.

## Docker

Esta seção é para rodar na sua máquina. Para publicar, use o `docker-compose.producao.yml`, com
HTTPS automático: veja [docs/deploy.md](docs/deploy.md#docker-com-https-automático).

```bash
docker compose up -d --build
```

O site sobe em `http://localhost:3000`, com usuário sem privilégios. Na primeira subida, se o
banco não existir, o seed roda sozinho.

| Volume | Pasta no contêiner | O que guarda |
|---|---|---|
| `dados` | `/dados` | O banco |
| `capas` | `/app/frontend/assets` | Capas enviadas e imagens do site |
| `backups` | `/app/backup` | Saída do `npm run backup` |

```bash
docker compose exec biblioteca npm run backup    # backup
docker compose exec biblioteca npm run expirar   # cancela as pré-reservas vencidas
docker compose logs -f                           # logs
```

- `docker compose down` mantém os volumes. **`docker compose down -v` apaga o banco e as capas.**
- O volume `capas` é preenchido só na primeira subida. Uma imagem nova em `frontend/assets/` não
  aparece num volume que já existe: copie-a com `docker compose cp`.
- O compose não define `NODE_ENV=production`, porque o cookie `Secure` impede o login em `http://`.
  Defina essa variável só atrás de HTTPS, e veja [docs/deploy.md](docs/deploy.md).

## Publicação

Veja [docs/deploy.md](docs/deploy.md).
