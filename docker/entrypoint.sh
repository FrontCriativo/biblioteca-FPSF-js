#!/bin/sh
set -e

# Primeira subida: o volume do banco está vazio.
if [ ! -f "$DB_PATH" ]; then
    echo "> Banco não encontrado: criando com os dados de exemplo."
    npm run seed
fi

exec "$@"
