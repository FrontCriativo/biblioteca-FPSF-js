# API v1: autenticação passo a passo

Roteiro para testar a autenticação pelo terminal. A referência de todas as rotas fica em
`/api/documentacao`, com o servidor no ar.

> Nunca coloque um token real em documentação, commit ou print. Nos exemplos ele aparece como
> `SEU_TOKEN`.

## Como funciona

```
Aplicativo                                     API
    │ POST /api/v1/auth/login                   │
    │ { email, senha, device_name }      ─────► │ confere a senha e se a conta está ativa
    │                                           │ grava o SHA-256 do token em tokens_api
    │ ◄───── { data: { token, usuario } }       │ devolve o token em texto, só desta vez
    │                                           │
    │ GET /api/v1/usuario                       │
    │ Authorization: Bearer SEU_TOKEN    ─────► │ calcula o hash e acha o usuário
    │ ◄───── { data: { id, nome, ... } }        │
```

O servidor não guarda o token: quem lê o banco não consegue usá-lo. Se o aplicativo perder o
token, faz login de novo.

## 1. Entrar

Com o servidor no ar e o banco populado (`npm run seed`):

```bash
curl -s -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"beatriz.lima@fpsf.edu.br","senha":"Aluno1.2026","device_name":"terminal"}'
```

Para não copiar o token à mão, guarde-o numa variável do terminal:

```bash
TOKEN=$(curl -s -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"beatriz.lima@fpsf.edu.br","senha":"Aluno1.2026","device_name":"terminal"}' \
  | node -p 'JSON.parse(require("fs").readFileSync(0)).data.token')
```

## 2. Usar o token

```bash
curl -s http://localhost:3000/api/v1/usuario -H "Authorization: Bearer $TOKEN"
```

## 3. Trocar a senha provisória

Conta com senha provisória nasce com `trocar_senha: true`. Até a troca, só funcionam o perfil, a
troca de senha e o logout; o resto responde 403. Entre os exemplos, é o caso do Rafael
(`rafael.souza@fpsf.edu.br` / `aluno123`): faça o login acima com ele e troque a senha assim:

```bash
curl -s -X PUT http://localhost:3000/api/v1/usuario/senha \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"senha_atual":"aluno123","nova_senha":"UMA_SENHA_NOVA","nova_senha_confirmation":"UMA_SENHA_NOVA"}'
```

O token usado aqui continua valendo. Os tokens dos outros dispositivos e as sessões do site caem.

## 4. Alterar o perfil

```bash
curl -s -X PATCH http://localhost:3000/api/v1/usuario \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"nome":"Bia Lima"}'
```

Só `nome` e `email` mudam por aqui. Outros campos, como `papel`, são ignorados.

## 5. Sair

```bash
curl -s -X POST http://localhost:3000/api/v1/auth/logout -H "Authorization: Bearer $TOKEN"
```

Depois disso, o mesmo token responde 401.

## Regras do token

| Regra | Valor |
|---|---|
| Validade | 7 dias |
| Tokens por dispositivo | 1: novo login com o mesmo `device_name` substitui o anterior |
| `device_name` padrão | `app` |
| No banco | Só o SHA-256 |
| Cookie do site na v1 | Não vale |
| Token na API do site | Não vale |

Trocar a senha (no site ou na v1), ter a senha redefinida pela coordenação e ter a conta desativada
apagam os tokens e as sessões do usuário, menos a credencial usada na própria requisição. A faxina
de hora em hora do servidor apaga os tokens vencidos.

## Limites

| Limite | Valor | Resposta |
|---|---|---|
| Requisições | 60 por minuto, por IP (`V1_LIMITE_POR_MINUTO`) | 429 com `Retry-After` |
| Logins | 10 por minuto, por IP | 429 com `Retry-After` |
| Senhas erradas | 5 por e-mail e 50 por IP, em 15 minutos | 429 com `Retry-After` |

O limite de logins conta só a v1, e `/auth/login` e `/login` dividem o mesmo contador. O bloqueio
por senha errada é o mesmo do site: um e-mail bloqueado na v1 também fica bloqueado no site. Como
ele é mais rígido, cinco erros seguidos no mesmo e-mail respondem 429 antes de chegar às 10
tentativas por minuto.

## Postman

Importe [postman/biblioteca-fpsf-v1.postman_collection.json](postman/biblioteca-fpsf-v1.postman_collection.json)
(**Import** → arquivo). Rode **Autenticação > Login** primeiro: o script dele guarda o token na
variável `token` da collection, usada pelas requisições protegidas. **Logout** limpa a variável.

Antes de exportar a collection, apague o *Current value* de `token`: o arquivo não pode levar um
token real.
