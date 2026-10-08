FROM node:24-alpine AS client
WORKDIR /client
COPY client/package.json client/package-lock.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production CLIENT_DIST=/app/public
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev
COPY server/server.js ./
COPY --from=client /client/dist ./public
USER node
EXPOSE 3000
CMD ["node", "server.js"]
