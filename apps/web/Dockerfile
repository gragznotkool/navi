# Web image: build the SPA, serve it with nginx, and proxy /api to the API container.
# Build context is the repository root:  docker build -f apps/web/Dockerfile .
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/contracts/package.json packages/contracts/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci
COPY packages/contracts packages/contracts
COPY apps/web apps/web
RUN npm run build -w @opshub/contracts && npm run build -w @opshub/web

FROM nginx:1.27-alpine
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=10s --timeout=3s --retries=10 CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
