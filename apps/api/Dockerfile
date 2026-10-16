# API image. Build context is the repository root:  docker build -f apps/api/Dockerfile .
# It runs through tsx (like `npm run dev`) so migrations and seeds can run from TypeScript on start.
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/contracts/package.json packages/contracts/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci
COPY packages/contracts packages/contracts
COPY apps/api apps/api
COPY config config
RUN npm run build -w @opshub/contracts
WORKDIR /app/apps/api
ENV NODE_ENV=development API_PORT=4000
EXPOSE 4000
# Apply migrations, seed demo data (idempotent), then serve.
CMD ["sh", "-c", "npm run db:migrate && npm run db:seed && exec npx tsx src/server.ts"]
