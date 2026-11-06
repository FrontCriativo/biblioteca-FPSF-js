# Publicação

Como colocar o site no ar num servidor Linux, com Nginx na frente e HTTPS. Para usar contêiner,
veja a seção Docker do [README](../README.md#docker).

## Antes de começar

- Node.js 22.13 ou mais novo no servidor.
- Troque as senhas das contas de exemplo, ou não rode o seed em produção.
- Escolha onde ficam os dados, fora da pasta do código. Aqui: `/var/lib/biblioteca`.

## Variáveis de produção

| Variável | Valor | Por quê |
|---|---|---|
| `NODE_ENV` | `production` | O cookie de sessão sai com `Secure` |
| `HOST` | `127.0.0.1` | Só o Nginx alcança o Node |
| `PORT` | `3000` | |
| `DB_PATH` | `/var/lib/biblioteca/biblioteca.db` | Atualizar o código não mexe no banco |
| `CONFIAR_PROXY` | `1` | Sem isso, todo mundo parece vir do mesmo IP |
| `CORS_ORIGENS` | As origens do aplicativo web | Opcional. O padrão libera todas |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Do Google Cloud | Ligam o login com o Google. Veja a seção abaixo |
| `GOOGLE_URL_RETORNO` | `https://SEU-DOMINIO/api/auth/google/retorno` | Igual à cadastrada no Google |

> **`NODE_ENV=production` exige HTTPS.** Em `http://`, o navegador não guarda o cookie e ninguém
> consegue entrar.

> **`CONFIAR_PROXY=1` exige `HOST=127.0.0.1`.** Se o Node puder ser alcançado sem passar pelo
> Nginx, qualquer um inventa o `X-Real-IP` e escapa dos limites de tentativa.

## Login com o Google

1. No [Google Cloud Console](https://console.cloud.google.com/apis/credentials), crie um projeto e
   configure a tela de consentimento, com os escopos `openid` e `email`.
2. Crie uma credencial **ID do cliente OAuth**, do tipo **Aplicativo da Web**.
3. Em **URIs de redirecionamento autorizados**, cadastre o valor de `GOOGLE_URL_RETORNO`. Para
   testar na sua máquina, cadastre também `http://localhost:3000/api/auth/google/retorno`.
4. Defina `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET` no servidor. O segredo não vai para o Git.

O Google só confirma o e-mail. Para entrar, a pessoa precisa de uma conta ativa no site com
exatamente esse e-mail, e ele precisa ser de um domínio de `GOOGLE_DOMINIOS`. O login com o Google
não cria contas. Quem tem senha provisória continua obrigado a trocá-la no primeiro acesso.

## Nginx com HTTPS

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

## Processo gerenciado

O processo precisa voltar sozinho depois de uma queda ou de reiniciar a máquina.

### systemd

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

### pm2

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
