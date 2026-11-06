#!/bin/sh
set -e

# Primeira subida: o volume do banco está vazio.
if [ ! -f "$DB_PATH" ]; then
    echo "> Banco não encontrado: criando."
    # O banco nasce antes de o seed conferir a configuração. Sem apagá-lo, a próxima subida
    # acharia o arquivo e abriria o site sem nenhuma conta.
    npm run seed || { rm -f "$DB_PATH" "$DB_PATH-wal" "$DB_PATH-shm"; exit 1; }
fi

exec "$@"
