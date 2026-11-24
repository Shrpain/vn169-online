FROM node:20-slim

WORKDIR /app

COPY vn169/package.json vn169/package-lock.json ./vn169/
RUN npm --prefix vn169 ci --omit=dev

COPY vn169 ./vn169

COPY vn169-web/package.json vn169-web/package-lock.json ./vn169-web/
RUN npm --prefix vn169-web ci --omit=dev

COPY vn169-web ./vn169-web

ENV HOST=0.0.0.0
ENV PORT=3000
ENV WATCHER_DIR=/app/vn169
ENV AUTO_START=1

EXPOSE 3000

CMD ["node", "vn169-web/server.js"]
