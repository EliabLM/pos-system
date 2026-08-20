# pos-system-server — Express 5 + TypeScript (Clean Architecture scaffold)
# Build local para docker-compose. Sin dominio todavía (Fase 2+); arranca en :3001.
# Fase 1: el server es dueño del schema Prisma — este contenedor aplica las
# migraciones (`prisma migrate deploy`) antes de levantar el proceso.
# Nota: `--ignore-workspace` instala el server como proyecto standalone dentro de la
# imagen, sin depender del pnpm-lock.yaml del monorepo raíz (que no tiene importer raíz).
# En Fase 1 (cuando el server tenga deps workspace como @pos/dto-types) se migrará a
# build context = repo root con `pnpm install --filter @pos/server... --frozen-lockfile`.

# ---- stage 1: deps ----
FROM node:22-alpine AS deps
RUN apk add --no-cache libc6-compat openssl
RUN corepack enable && corepack prepare pnpm@10.7.1 --activate
WORKDIR /app
COPY package.json ./
RUN pnpm install --ignore-workspace --no-frozen-lockfile

# ---- stage 2: build ----
FROM node:22-alpine AS builder
RUN apk add --no-cache libc6-compat openssl
RUN corepack enable && corepack prepare pnpm@10.7.1 --activate
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build

# ---- stage 3: runner ----
FROM node:22-alpine AS runner
RUN apk add --no-cache libc6-compat openssl
RUN corepack enable && corepack prepare pnpm@10.7.1 --activate
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3001

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/prisma ./prisma

EXPOSE 3001

# Aplica migraciones Prisma (el server es dueño del schema desde Fase 1) y arranca.
CMD ["sh", "-c", "pnpm prisma migrate deploy && node dist/server.js"]