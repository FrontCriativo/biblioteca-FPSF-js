# Banco de dados

SQLite, pelo módulo `node:sqlite`. Datas em texto `AAAA-MM-DD HH:MM:SS`, em UTC. A estrutura de um
banco novo está em `backend/db/schema.sql`; as mudanças em bancos existentes, nas migrações de
`backend/db/index.js`.

Um livro é a obra; um exemplar é a cópia física. A disponibilidade é a contagem de exemplares sem
reserva aberta, e não um campo do livro.

## Tabelas

### `turmas`

| Coluna | Tipo | Observação |
|---|---|---|
| `id` | INTEGER | Chave primária |
| `nome` | TEXT | Único, sem diferenciar maiúsculas. Limite de 40 caracteres na API |
| `ano_letivo` | INTEGER | |
| `ativa` | INTEGER | 1 por padrão |
| `criada_em` | TEXT | |

### `usuarios`

| Coluna | Tipo | Observação |
|---|---|---|
| `id` | INTEGER | Chave primária |
| `nome` | TEXT | |
| `email` | TEXT | Único, sem diferenciar maiúsculas; gravado em minúsculas |
| `senha_hash` | TEXT | scrypt: `sal:hash` |
| `papel` | TEXT | `aluno` ou `admin` |
| `criado_em` | TEXT | |
| `trocar_senha` | INTEGER | 1 = senha provisória, troca obrigatória |
| `turma_id` | INTEGER | Chave para `turmas` |
| `ativo` | INTEGER | 0 = conta desativada |
| `telefone` | TEXT | Opcional. Só dígitos, com DDD |
| `perfil_confirmado` | INTEGER | 0 = o aluno ainda não conferiu os dados na tela de perfil. Não vale para a coordenação |

### `materias`

| Coluna | Tipo | Observação |
|---|---|---|
| `slug` | TEXT | Chave primária |
| `nome` | TEXT | |
| `icone` | TEXT | Arquivo em `frontend/assets/` |

### `livros`

| Coluna | Tipo | Observação |
|---|---|---|
| `id` | INTEGER | Chave primária |
| `slug` | TEXT | Único |
| `titulo`, `autor` | TEXT | |
| `materia_slug` | TEXT | Chave para `materias` |
| `capa` | TEXT | Só o nome do arquivo em `frontend/assets/` |
| `sinopse` | TEXT | |
| `paginas` | INTEGER | |
| `idioma` | TEXT | `Português` por padrão |
| `criado_em` | TEXT | |
| `busca_normalizada` | TEXT | Título e autor em minúsculas e sem acento, para a busca |

### `exemplares`

| Coluna | Tipo | Observação |
|---|---|---|
| `id` | INTEGER | Chave primária |
| `livro_id` | INTEGER | Chave para `livros` |
| `codigo` | TEXT | Único |
| `estado` | TEXT | `ok` ou `manutencao` |

### `reservas`

| Coluna | Tipo | Observação |
|---|---|---|
| `id` | INTEGER | Chave primária |
| `exemplar_id` | INTEGER | Chave para `exemplares` |
| `usuario_id` | INTEGER | Chave para `usuarios` |
| `status` | TEXT | `ativa`, `retirada`, `devolvida` ou `cancelada` |
| `criada_em` | TEXT | |
| `expira_em` | TEXT | Prazo para retirar: 3 dias |
| `encerrada_em` | TEXT | Devolução ou cancelamento |
| `devolver_ate` | TEXT | Prazo de devolução: 14 dias da retirada, mais as renovações |
| `retirada_em` | TEXT | NULL em empréstimos anteriores à migração 8 |
| `renovacoes` | INTEGER | Quantas vezes o prazo foi renovado |
| `observacao` | TEXT | Anotação interna: nunca sai nas rotas do aluno |

### `sessoes`

| Coluna | Tipo | Observação |
|---|---|---|
| `token` | TEXT | Chave primária |
| `usuario_id` | INTEGER | Chave para `usuarios` |
| `criada_em`, `expira_em` | TEXT | Validade de 7 dias |

### `tokens_api`

| Coluna | Tipo | Observação |
|---|---|---|
| `id` | INTEGER | Chave primária |
| `usuario_id` | INTEGER | Chave para `usuarios` |
| `dispositivo` | TEXT | `device_name` do login |
| `token_hash` | TEXT | Único. SHA-256 do token; o texto não é guardado |
| `criado_em`, `ultimo_uso_em` | TEXT | |
| `expira_em` | TEXT | Validade de 7 dias |

### `depoimentos`

| Coluna | Tipo | Observação |
|---|---|---|
| `id` | INTEGER | Chave primária |
| `usuario_id` | INTEGER | Chave para `usuarios`, se quem escreveu estava logado |
| `nome`, `turma`, `mensagem` | TEXT | `turma` é texto livre: quem escreve pode não ter login |
| `nota` | INTEGER | De 1 a 5 |
| `status` | TEXT | `pendente`, `aprovado` ou `recusado` |
| `criado_em` | TEXT | |

### `favoritos`

Lista "Quero ler".

| Coluna | Tipo | Observação |
|---|---|---|
| `id` | INTEGER | Chave primária |
| `usuario_id` | INTEGER | Chave para `usuarios` |
| `livro_id` | INTEGER | Chave para `livros` |
| `criado_em` | TEXT | |

O par `usuario_id` + `livro_id` é único.

### `mensagens_contato`

| Coluna | Tipo | Observação |
|---|---|---|
| `id` | INTEGER | Chave primária |
| `usuario_id` | INTEGER | Chave para `usuarios`, se quem escreveu estava logado |
| `nome`, `turma`, `email` | TEXT | `turma` e `email` são opcionais |
| `assunto` | TEXT | Sugestão de livro, Dúvida sobre empréstimo, Problema de acesso ou Outro assunto |
| `mensagem` | TEXT | |
| `status` | TEXT | `nova`, `lida` ou `respondida` |
| `criada_em`, `atualizada_em` | TEXT | |

## Chaves estrangeiras

| Coluna | Aponta para | Ao apagar o pai |
|---|---|---|
| `usuarios.turma_id` | `turmas` | Fica NULL: o usuário continua, sem turma |
| `livros.materia_slug` | `materias` | Bloqueado: matéria com livros não pode ser apagada |
| `exemplares.livro_id` | `livros` | Apaga em cascata |
| `reservas.exemplar_id` | `exemplares` | Apaga em cascata |
| `reservas.usuario_id` | `usuarios` | Apaga em cascata |
| `sessoes.usuario_id` | `usuarios` | Apaga em cascata |
| `tokens_api.usuario_id` | `usuarios` | Apaga em cascata |
| `depoimentos.usuario_id` | `usuarios` | Fica NULL: o depoimento continua |
| `favoritos.usuario_id` | `usuarios` | Apaga em cascata |
| `favoritos.livro_id` | `livros` | Apaga em cascata |
| `mensagens_contato.usuario_id` | `usuarios` | Fica NULL: a mensagem continua |

Por causa da cascata de `exemplares` e `reservas`, a API recusa apagar livro com qualquer histórico
de reserva, para o histórico não se perder. Não há rota para apagar usuário: quem sai é desativado.

## Índices

| Índice | Tabela | Para quê |
|---|---|---|
| `idx_reserva_exemplar_ativa` | `reservas(exemplar_id)` | Único e parcial. Ver abaixo |
| `idx_reservas_usuario` | `reservas(usuario_id)` | Reservas de um leitor |
| `idx_livros_materia` | `livros(materia_slug)` | Filtro por matéria |
| `idx_exemplares_livro` | `exemplares(livro_id)` | Exemplares de um livro |
| `idx_depoimentos_status` | `depoimentos(status)` | Moderação |
| `idx_favoritos_livro` | `favoritos(livro_id)` | Cascata ao apagar um livro |
| `idx_mensagens_status` | `mensagens_contato(status)` | Filtro do painel |
| `idx_tokens_usuario` | `tokens_api(usuario_id)` | Tokens de um usuário |

### O índice de reserva aberta

```sql
CREATE UNIQUE INDEX idx_reserva_exemplar_ativa
  ON reservas(exemplar_id)
  WHERE status IN ('ativa', 'retirada');
```

É a regra central do sistema: **um exemplar só pode ter uma reserva aberta**. Como o índice é
parcial, reservas encerradas ficam fora dele, e o mesmo exemplar pode ter um histórico longo. Quem
garante a regra é o próprio SQLite, mesmo com requisições simultâneas. Se o índice disparar, a API
responde 409 "Este exemplar acabou de ser reservado. Tente novamente.".

## Migrações

A versão aplicada fica em `PRAGMA user_version`. Elas rodam sozinhas quando o servidor sobe, cada
uma numa transação. Veja no README [como criar uma nova](../README.md#como-criar-uma-migração).

| Versão | O que muda |
|---|---|
| 1 | `livros.busca_normalizada` |
| 2 | `reservas.devolver_ate` |
| 3 | `usuarios.trocar_senha` |
| 4 | Tabela `depoimentos` |
| 5 | Tabela `turmas` e `usuarios.turma_id`; cada texto distinto de turma vira uma linha |
| 6 | Remove a coluna de texto `usuarios.turma`. Para, sem apagar, se restar turma sem vínculo |
| 7 | `usuarios.ativo` |
| 8 | `reservas.retirada_em`, `renovacoes` e `observacao` |
| 9 | Tabela `favoritos` |
| 10 | Tabela `mensagens_contato` |
| 11 | Tabela `tokens_api` |
| 12 | `usuarios.telefone` e `perfil_confirmado`. Toda conta existente começa sem confirmar |
