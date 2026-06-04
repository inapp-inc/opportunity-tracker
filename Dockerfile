# syntax=docker/dockerfile:1

FROM node:20-bookworm-slim AS server-deps
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY server/package*.json ./server/
RUN npm ci --prefix server --omit=dev --no-audit --no-fund

FROM node:20-bookworm-slim AS web-build
WORKDIR /app
ARG VITE_BASE_PATH=/ps/
ENV VITE_BASE_PATH=${VITE_BASE_PATH}
COPY web/package*.json ./web/
RUN npm ci --prefix web --no-audit --no-fund
COPY web ./web
RUN npm --prefix web run build

FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
  SERVE_STATIC=1 \
  APP_BASE_PATH=/ps \
  PUBLIC_BASE_PATH=/ps \
  PORT=4000
COPY --from=server-deps /app/server/node_modules ./server/node_modules
COPY server ./server
COPY --from=web-build /app/web/dist ./web/dist
EXPOSE 4000
CMD ["npm", "--prefix", "server", "start"]
