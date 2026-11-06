# Conectar o aplicativo Expo

O aplicativo funciona com este back-end sem mudança de código: basta apontar
`EXPO_PUBLIC_API_URL` para este servidor. As rotas têm o mesmo contrato da versão Laravel.

## Rotas e formatos

| Método | Rota | Acesso | Equivale a |
|---|---|---|---|
| POST | `/api/v1/login` | Público | `/api/v1/auth/login` |
| GET | `/api/v1/produto` | Público | `/api/v1/livros` |
| GET | `/api/v1/produto/:id` | Público | `/api/v1/livros/:slug` |
| GET | `/api/v1/categoria` | Público | `/api/v1/materias` |
| PUT | `/api/v1/cliente/senha` | Token | `/api/v1/usuario/senha` |

O aplicativo também usa `GET` e `PUT /api/v1/usuario`, `POST /api/v1/auth/logout` e
`GET /api/v1/depoimentos`.

**POST /api/v1/login** recebe `{ email, password, device_name? }` e devolve o token no topo:

```json
{ "success": true, "mensagem": "Login realizado com sucesso.", "token": "SEU_TOKEN", "usuario": { "id": 2, "nome": "Beatriz Lima" } }
```

**GET /api/v1/produto** (e `/produto/:id`, com um livro só em `data`):

```json
{ "success": true, "data": [ {
    "id": 3,
    "slug": "dom-quixote",
    "titulo": "Dom Quixote",
    "autor": "Miguel de Cervantes",
    "categoria_produto": { "id_categoria": "literatura", "nome_categoria": "Literatura" },
    "genero": "Literatura",
    "imagem": "domQuixote.jpg",
    "status": "disponivel",
    "status_produto": "ATIVO",
    "livrosDestaque": "SIM",
    "descricao": "...",
    "total_exemplares": 2,
    "disponiveis": 2
} ] }
```

- `status`: `disponivel` se há exemplar livre; senão, `emprestado`.
- `status_produto`: sempre `ATIVO`. Livro retirado do catálogo é removido.
- `livrosDestaque`: `SIM` nos 6 livros cadastrados por último.
- `id_categoria`: o slug da matéria, em texto, porque as matérias não têm id numérico.
- `imagem`: o nome do arquivo. A capa fica em `http://<servidor>/assets/<imagem>`.

**GET /api/v1/categoria**, em ordem alfabética:

```json
{ "success": true, "data": [ { "id_categoria": "artes", "nome_categoria": "Artes", "status_categoria": "ATIVO", "ordem_categoria": 1, "icone": "artes.png" } ] }
```

**PUT /api/v1/cliente/senha** recebe `{ senha_atual, nova_senha, nova_senha_confirmation }`.

**Erros** de qualquer rota saem como `{ "success": false, "erro": "mensagem" }`. A mensagem para
mostrar ao usuário está em `erro`.

## Diferença em relação ao Laravel

O Laravel devolve também `imagem_url` em `/produto` e `capa_url` em `/livros`. Aqui eles não
existem: o aplicativo monta a URL com `imagem`, e todas as capas ficam em `/assets/`.

Conta com senha provisória (`trocar_senha: true`) recebe 403 ao editar o perfil, até trocar a
senha. As contas de exemplo do seed nascem assim.

## Subir o servidor para o celular

O celular precisa alcançar o computador pela rede. Com os dois na mesma rede:

```bash
HOST=0.0.0.0 PORT=8080 npm start
```

No PowerShell:

```powershell
$env:HOST = "0.0.0.0"; $env:PORT = "8080"; npm start
```

Sem `HOST`, o servidor já escuta em todas as interfaces; `HOST=0.0.0.0` só deixa isso explícito.
Se usar `HOST=127.0.0.1`, o celular não alcança o servidor. Libere a porta no firewall do Windows,
se ele perguntar.

No aplicativo, crie o `.env` com o IP do computador e reinicie o Expo:

```bash
EXPO_PUBLIC_API_URL=http://192.168.0.10:8080
```

> No celular, `localhost` é o próprio celular: use o IP do computador. O aplicativo usa a porta
> 8080 por padrão, e o servidor, a 3000. Ajuste um dos dois.

Para testar, abra `http://<IP do computador>:8080/api/v1/produto` no navegador do celular.

### Rodando dentro do WSL 2

Por padrão, o WSL fica atrás de uma rede própria (NAT), e o celular não alcança o servidor pelo IP
do Windows. Ative o modo espelhado em `C:\Users\<você>\.wslconfig`:

```ini
[wsl2]
networkingMode=mirrored
```

Depois rode `wsl --shutdown` no PowerShell e abra o Ubuntu de novo.

## CORS

O padrão de `CORS_ORIGENS` é `*`, o que basta para rodar o aplicativo no navegador. Em produção,
informe só as origens que precisam de acesso:

```bash
CORS_ORIGENS=https://app.fpsf.edu.br,https://outro.fpsf.edu.br
```

Aplicativos nativos não usam CORS: isso só vale para a versão web.
