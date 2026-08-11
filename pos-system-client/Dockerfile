# pos-system-client — Next.js 15 + Prisma (runtime: build local de testing)
# Diseñado para docker-compose local. NO habilitamos `output: 'standalone'` para no
# alterar el comportamiento del deploy de Vercel (que ignora esa opción pero no
# queremos tocar next.config.ts ahora). Imagen de producción real se define en Fase de VPS.

# ---- stage 1: deps ----
FROM node:22-alpine AS deps
RUN apk add --no-cache libc6-compat openssl
RUN corepack enable && corepack prepare pnpm@10.7.1 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
COPY prisma ./prisma
# postinstall ejecuta `prisma generate` — genera el cliente para la plataforma del contenedor.
RUN pnpm install --frozen-lockfile

# ---- stage 2: build ----
FROM node:22-alpine AS builder
RUN apk add --no-cache libc6-compat openssl
RUN corepack enable && corepack prepare pnpm@10.7.1 --activate
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/src/generated ./src/generated
COPY . .
# El build del client genera el cliente Prisma y compila Next.
RUN pnpm build

# ---- stage 3: runner ----
FROM node:22-alpine AS runner
RUN apk add --no-cache libc6-compat openssl
RUN corepack enable && corepack prepare pnpm@10.7.1 --activate
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Necesitamos node_modules, .next, public, prisma/migrations, next.config y el generado.
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/src/generated ./src/generated
COPY --from=builder /app/tsconfig.json ./tsconfig.json

EXPOSE 3000

# El entrypoint aplica migraciones Prisma y luego levanta `next start`.
# El client es actualmente dueño del schema (hasta Fase 1 de la migración).
CMD ["sh", "-c", "pnpm prisma migrate deploy && pnpm start"]