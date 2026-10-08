FROM node:24-alpine AS client
WORKDIR /harness/client
COPY client/package.json client/package-lock.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

FROM node:24-alpine AS server
WORKDIR /harness/server
COPY server/package.json server/package-lock.json ./
RUN npm ci
COPY server/ ./

# `docker compose run --rm test` (see docker-compose.yml)
FROM node:24-alpine AS test
WORKDIR /harness
COPY --from=client /harness/client ./client
COPY --from=server /harness/server ./server
CMD ["sh", "-c", "npm --prefix client test && npm --prefix server test"]

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production CLIENT_DIST=/app/public
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev
COPY server/server.js ./
COPY --from=client /harness/client/dist ./public
USER node
EXPOSE 3000
CMD ["node", "server.js"]
