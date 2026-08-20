# pos-system-client — Next.js 15 + Prisma (runtime: build local de testing)
# Diseñado para docker-compose local. NO habilitamos `output: 'standalone'` para no
# alterar next.config.ts. Imagen de producción real se define en la fase de VPS.
#
# BUILD CONTEXT = raíz del repo (ver docker-compose.yml). Desde Fase 1 el schema
# Prisma vive en pos-system-server/prisma/ y el client solo consume el cliente
# generado — la imagen replica el layout del monorepo (/app/pos-system-client y
# /app/pos-system-server/prisma) para que las rutas relativas del generator
# funcionen igual que en el host. Las migraciones las aplica el contenedor server.

# ---- stage 1: deps ----
FROM node:22-alpine AS deps
RUN apk add --no-cache libc6-compat openssl
RUN corepack enable && corepack prepare pnpm@10.7.1 --activate
WORKDIR /app/pos-system-client
# El schema debe existir antes del install: postinstall corre `prisma generate`.
COPY pos-system-server/prisma /app/pos-system-server/prisma
COPY pos-system-client/package.json pos-system-client/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# ---- stage 2: build ----
FROM node:22-alpine AS builder
RUN apk add --no-cache libc6-compat openssl
RUN corepack enable && corepack prepare pnpm@10.7.1 --activate
WORKDIR /app/pos-system-client
COPY --from=deps /app/pos-system-client/node_modules ./node_modules
COPY --from=deps /app/pos-system-client/src/generated ./src/generated
COPY --from=deps /app/pos-system-server/prisma /app/pos-system-server/prisma
COPY pos-system-client/ ./
# El build del client regenera el cliente Prisma (para la plataforma del contenedor)
# y compila Next.
RUN pnpm build

# ---- stage 3: runner ----
FROM node:22-alpine AS runner
RUN apk add --no-cache libc6-compat openssl
RUN corepack enable && corepack prepare pnpm@10.7.1 --activate
WORKDIR /app/pos-system-client
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Necesitamos node_modules, .next, public, next.config y el cliente generado.
# Ya NO se copia prisma/ ni se corre migrate deploy: eso es del server (Fase 1).
COPY --from=builder /app/pos-system-client/node_modules ./node_modules
COPY --from=builder /app/pos-system-client/.next ./.next
COPY --from=builder /app/pos-system-client/public ./public
COPY --from=builder /app/pos-system-client/next.config.ts ./next.config.ts
COPY --from=builder /app/pos-system-client/package.json ./package.json
COPY --from=builder /app/pos-system-client/src/generated ./src/generated
COPY --from=builder /app/pos-system-client/tsconfig.json ./tsconfig.json

EXPOSE 3000

CMD ["pnpm", "start"]
