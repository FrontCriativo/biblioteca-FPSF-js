FROM node:22-alpine

WORKDIR /app

# Sem dependências de runtime: não há npm install.
COPY package.json ./
COPY backend ./backend
COPY frontend ./frontend
# O volume de capas esconde frontend/assets: o entrypoint copia estas imagens para ele a cada subida.
COPY frontend/assets ./assets-da-imagem
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh

# As pastas de dados precisam ser do usuário "node": o Docker copia dono e conteúdo
# para o volume nomeado na primeira subida, e o processo não roda como root.
RUN chmod +x /usr/local/bin/entrypoint.sh \
    && mkdir -p /dados /app/backup \
    && chown -R node:node /dados /app/backup /app/frontend/assets

ENV HOST=0.0.0.0 \
    PORT=3000 \
    DB_PATH=/dados/biblioteca.db

USER node

EXPOSE 3000

ENTRYPOINT ["entrypoint.sh"]
CMD ["npm", "start"]
