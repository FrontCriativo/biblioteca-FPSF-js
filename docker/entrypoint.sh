#!/bin/sh
set -e

# Imagens do site que vieram numa versão nova. As capas enviadas têm outros nomes e ficam como estão.
cp -r /app/assets-da-imagem/. /app/frontend/assets/

# Primeira subida: o volume do banco está vazio.
if [ ! -f "$DB_PATH" ]; then
    echo "> Banco não encontrado: criando."
    # O banco nasce antes de o seed conferir a configuração. Sem apagá-lo, a próxima subida
    # acharia o arquivo e abriria o site sem nenhuma conta.
    npm run seed || { rm -f "$DB_PATH" "$DB_PATH-wal" "$DB_PATH-shm"; exit 1; }
fi

exec "$@"
