# Publicação

Como colocar o site no ar num servidor Linux com HTTPS. Há dois caminhos: Docker, que é o mais
curto, ou Node com Nginx.

Tanto faz o caminho, o servidor precisa de disco permanente, porque o banco é um arquivo. Serviços
com disco temporário apagam os dados a cada reinício ou atualização.

## Docker com HTTPS automático

Você precisa de um servidor Linux com Docker, com as portas 80 e 443 abertas, e de um domínio já
apontado para o IP dele. O Caddy busca e renova o certificado sozinho.

```bash
git clone https://github.com/FrontCriativo/biblioteca-FPSF-js.git /srv/biblioteca
cd /srv/biblioteca
cp .env.exemplo .env     # preencha DOMINIO, ADMIN_EMAIL e ADMIN_SENHA
docker compose -f docker-compose.producao.yml up -d --build
docker compose -f docker-compose.producao.yml logs -f
```

Na primeira subida, o banco nasce com a conta da coordenação, as matérias e os livros de exemplo.
Nenhuma conta de aluno de exemplo é criada. Sem `ADMIN_EMAIL` e `ADMIN_SENHA`, o contêiner para
e explica o motivo no log.

Entre no site em seguida e troque a senha da coordenação. O passo é obrigatório no primeiro acesso.

Para atualizar:

```bash
git pull
docker compose -f docker-compose.producao.yml exec -T biblioteca npm run backup
docker compose -f docker-compose.producao.yml up -d --build
```

**Nunca rode `down -v`:** esse comando apaga o banco e as capas.

Imagens novas do site entram no volume `capas` sozinhas ao subir, e as capas enviadas ficam como estão.

Se o aplicativo for usado na rede da escola, aumente `V1_LIMITE_POR_MINUTO` no `.env`: o limite é por
IP, e a escola inteira sai pelo mesmo.

Backup diário, no `crontab` do servidor:

```cron
# Banco todo dia às 2h
0 2 * * * cd /srv/biblioteca && docker compose -f docker-compose.producao.yml exec -T biblioteca npm run backup
# Capas enviadas, depois do banco
30 2 * * * cd /srv/biblioteca && docker compose -f docker-compose.producao.yml exec -T biblioteca sh -c 'tar -czf backup/capas-$(date +%F).tar.gz -C frontend assets'
# Apaga backups com mais de 30 dias
0 3 * * * cd /srv/biblioteca && docker compose -f docker-compose.producao.yml exec -T biblioteca find backup -type f -mtime +30 -delete
```

Os backups ficam no volume `backups`, no mesmo disco do banco. Se o disco se perder, eles se perdem
junto. Para tirar uma cópia do contêiner e levá-la para fora do servidor:

```bash
docker compose -f docker-compose.producao.yml cp biblioteca:/app/backup /var/backups/biblioteca
```

## Cadastrar os alunos

No painel, em **Usuários**, use **Importar alunos por planilha**. A planilha vai em CSV, com as
colunas `nome`, `email` e `turma`, até 2000 alunos por vez.

- **Senhas:** o site gera uma senha provisória para cada aluno. A lista só pode ser baixada logo
  depois de importar, e o aluno troca a senha no primeiro acesso. Apague o arquivo depois de entregar.
- **Erros:** uma linha com problema não impede as outras. Corrija e envie a planilha de novo: quem
  já tem conta fica como está.
- **Senha esquecida:** a coordenação redefine pelo painel, porque o site não envia e-mail.

## Node com Nginx

### Antes de começar

- Node.js 22.13 ou mais novo no servidor.
- Crie o banco com `NODE_ENV=production`, `ADMIN_EMAIL` e `ADMIN_SENHA` definidos. Assim, o
  `npm run seed` cria só a conta da coordenação, sem nenhuma senha de exemplo.
- Escolha onde ficam os dados, fora da pasta do código. Aqui: `/var/lib/biblioteca`.

### Variáveis de produção

| Variável | Valor | Por quê |
|---|---|---|
| `NODE_ENV` | `production` | O cookie de sessão sai com `Secure` |
| `HOST` | `127.0.0.1` | Só o Nginx alcança o Node |
| `PORT` | `3000` | |
| `DB_PATH` | `/var/lib/biblioteca/biblioteca.db` | Atualizar o código não mexe no banco |
| `CONFIAR_PROXY` | `1` | Sem isso, todo mundo parece vir do mesmo IP |
| `ADMIN_EMAIL`, `ADMIN_SENHA` | Da conta da coordenação | Só no `npm run seed`, que cria o banco |
| `CORS_ORIGENS` | As origens do aplicativo web | Opcional. O padrão libera todas |
| `V1_LIMITE_POR_MINUTO` | Chamadas à API v1 por IP | Opcional. O padrão é 60 |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Do Google Cloud | Ligam o login com o Google. Veja a seção abaixo |
| `GOOGLE_URL_RETORNO` | `https://SEU-DOMINIO/api/auth/google/retorno` | Igual à cadastrada no Google |

> **`NODE_ENV=production` exige HTTPS.** Em `http://`, o navegador não guarda o cookie e ninguém
> consegue entrar.

> **`CONFIAR_PROXY=1` exige `HOST=127.0.0.1`.** Se o Node puder ser alcançado sem passar pelo
> Nginx, qualquer um inventa o `X-Real-IP` e escapa dos limites de tentativa.

## Login com o Google

É opcional: o login com senha funciona sem ele. No Docker, as variáveis vão no `.env`.

1. No [Google Cloud Console](https://console.cloud.google.com/apis/credentials), crie um projeto e
   configure a tela de consentimento, com os escopos `openid` e `email`.
2. Crie uma credencial **ID do cliente OAuth**, do tipo **Aplicativo da Web**.
3. Em **URIs de redirecionamento autorizados**, cadastre o valor de `GOOGLE_URL_RETORNO`. Para
   testar na sua máquina, cadastre também `http://localhost:3000/api/auth/google/retorno`.
4. Defina `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET` no servidor. O segredo não vai para o Git.

O Google só confirma o e-mail. Para entrar, a pessoa precisa de uma conta ativa no site com
exatamente esse e-mail, e ele precisa ser de um domínio de `GOOGLE_DOMINIOS`. O login com o Google
não cria contas. Quem tem senha provisória continua obrigado a trocá-la no primeiro acesso.

### Nginx com HTTPS

```nginx
server {
    listen 443 ssl;
    server_name biblioteca.fpsf.edu.br;

    ssl_certificate     /etc/letsencrypt/live/biblioteca.fpsf.edu.br/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/biblioteca.fpsf.edu.br/privkey.pem;

    # A capa chega em base64: o Node aceita até 8 MB. O padrão do Nginx, 1 MB, recusaria antes.
    client_max_body_size 8m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}

server {
    listen 80;
    server_name biblioteca.fpsf.edu.br;
    return 301 https://$host$request_uri;
}
```

O certificado pode vir do Let's Encrypt, com o `certbot`.

### Processo gerenciado

O processo precisa voltar sozinho depois de uma queda ou de reiniciar a máquina.

#### systemd

`/etc/systemd/system/biblioteca.service`:

```ini
[Unit]
Description=Biblioteca Virtual FPSF
After=network.target

[Service]
User=biblioteca
WorkingDirectory=/srv/biblioteca
Environment=NODE_ENV=production
Environment=HOST=127.0.0.1
Environment=PORT=3000
Environment=DB_PATH=/var/lib/biblioteca/biblioteca.db
Environment=CONFIAR_PROXY=1
ExecStart=/usr/bin/node backend/server.js
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now biblioteca
journalctl -u biblioteca -f   # logs
```

#### pm2

```bash
NODE_ENV=production HOST=127.0.0.1 DB_PATH=/var/lib/biblioteca/biblioteca.db CONFIAR_PROXY=1 \
  pm2 start backend/server.js --name biblioteca
pm2 save && pm2 startup
```

O pm2 é uma ferramenta do servidor. Ele não entra nas dependências do projeto.

## O que precisa persistir

Só duas coisas não estão no Git. Perdê-las é perder dados.

| O quê | Onde | Observação |
|---|---|---|
| Banco | `biblioteca.db`, `biblioteca.db-wal` e `biblioteca.db-shm` | Os três andam juntos: dados recentes podem estar só no `-wal` |
| Capas enviadas | `frontend/assets/` | Quem atualiza o código não pode apagar esta pasta. O Git só conhece as capas do seed |

Ao atualizar, use `git pull` na pasta do código, sem apagá-la, e reinicie o processo. As migrações
rodam sozinhas ao subir, então faça um backup antes.

## Backup

`npm run backup` faz uma cópia consistente do banco em `backup/`, com o site no ar. Copiar o arquivo
direto não é seguro. Rode com as mesmas variáveis do servidor, para copiar o banco certo:

```bash
cd /srv/biblioteca && DB_PATH=/var/lib/biblioteca/biblioteca.db npm run backup
```

Rotina sugerida, no `crontab` do usuário `biblioteca`:

```cron
# Banco todo dia às 2h
0 2 * * * cd /srv/biblioteca && DB_PATH=/var/lib/biblioteca/biblioteca.db npm run backup
# Capas enviadas, depois do banco
30 2 * * * tar -czf /var/backups/biblioteca-capas-$(date +\%F).tar.gz -C /srv/biblioteca/frontend assets
# Apaga backups com mais de 30 dias
0 3 * * * find /srv/biblioteca/backup -name '*.sqlite' -mtime +30 -delete
```

Guarde uma cópia fora do servidor e teste a restauração de vez em quando: backup que nunca foi
restaurado é só uma esperança. Os passos estão no [README](../README.md#restaurar-um-backup).

Os backups têm e-mails e hashes de senha. Trate-os como o próprio banco.

## Conferência depois de publicar

```bash
curl -I https://biblioteca.fpsf.edu.br/
curl https://biblioteca.fpsf.edu.br/api/v1/status
```

Depois, faça login no site. Se a página recarregar e continuar sem sessão, confira se o acesso é
mesmo por HTTPS.
