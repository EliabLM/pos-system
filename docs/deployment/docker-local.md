# Docker compose local (pruebas del monorepo)

> **Objetivo:** con `docker compose up` levantar localmente los 3 proyectos + una
> Postgres 17, para validar el stack completo antes de avanzar fases de la
> migración o antes de deployar a testing/producción.
>
> **Fecha:** 2026-08-10 · **Estado:** ✅ Probado end-to-end el 2026-08-11 (stack up + seed + suite E2E smoke 17/17)

## Qué levanta

| Servicio  | Imagen/Build              | Host:Container | Notas |
|-----------|---------------------------|----------------|-------|
| `db`      | `postgres:17-alpine`      | 5432:5432      | volumen `pgdata`, healthcheck `pg_isready` |
| `server`  | build `pos-system-server` | 3001:3001      | Express (sin dominio todavía; arranca aunque no haya DB) |
| `client`  | build `pos-system-client` | 3000:3000      | Next.js; entrypoint corre `prisma migrate deploy && next start` |
| `app`     | build `pos-system-app`    | 8082:8082      | **profile `app`** — solo arranca con `--profile app` |

> **Por qué la app tiene un profile:** Expo en docker solo sirve el bundle **web**.
> Para probar en dispositivo/emulador se corre `pnpm start` fuera de docker. Por
> default `docker compose up` levanta `db + server + client`; si querés también la
> app web: `docker compose --profile app up`.

## Archivos involucrados

- `docker-compose.yml` (raíz del repo) — stack base.
- `pos-system-client/Dockerfile` — multi-stage Next.js (non-standalone, su propio
  `pnpm-lock.yaml`). Aplica migraciones al arrancar.
- `pos-system-server/Dockerfile` — multi-stage Express (`tsc` → `node dist/server.js`).
- `pos-system-app/Dockerfile` — single-stage Expo `expo start --web`.
- `.env.example` (raíz) — valores para el compose. `cp .env.example .env` y editar.
- `**/.dockerignore` — excluyen `node_modules`, `.next`, `dist`, logs.

## Cómo correrlo

```bash
# 1. Variables (una sola vez)
cp .env.example .env
#    al menos setea CLIENT_JWT_SECRET con >= 32 chars:
#    openssl rand -base64 48

# 2. Levantar el stack base (db + server + client)
docker compose up --build

# 3. (Opcional) con la app web también
docker compose --profile app up --build
```

URLs locales:
- Client: http://localhost:3000
- Server (health): http://localhost:3001/health
- App web: http://localhost:8082
- Postgres: `localhost:5432` (user/db `pos`/`pos` por defecto del `.env.example`)

## Cómo se conecta cada contenedor (network internals)

- Tanto el `client` como el `server` resuelven la DB por el nombre de servicio `db`
  dentro de la red del compose (`postgresql://pos:pos@db:5432/pos`).
- El `client` no usa pooler externo → `DATABASE_URL == DIRECT_URL` ambas a `db:5432`
  sin `?pgbouncer`. Prisma lo acepta (pooler solo es necesario con PgBouncer real).
- Cuando Fase 2 exponga la API, el `client` llamará a `server` por `http://server:3001`
  (interno) o por `http://localhost:3001` desde tu navegador. El server expone
  `/api/v1/*`.

## Limitaciones conocidas

- **`prisma migrate deploy` en el client:** el contenedor `client` aplica las
  migraciones de `pos-system-client/prisma/migrations/` contra la `db` local al
  arrancar. Si levantás `db` + `client` pero la DB ya estaba en un estado distinto
  (volumen persistente de una corrida anterior con otro schema) `prisma migrate
  deploy` puede fallar con drift. Solución: `docker compose down -v` para borrar
  el volumen y volver a levantar limpio.
- **App móvil en docker = web only.** Expo/device testing va fuera de docker.
- **`pos-system-app` y `pos-system-server` usan `--ignore-workspace --no-frozen-lockfile`
  dentro de su Dockerfile** porque el monorepo raíz no tiene `package.json` raíz y
  el `pnpm-lock.yaml` raíz no tiene importer raíz (el workspace se generó sin él).
  Por lo tanto estas dos imágenes no resuelven desde el lockfile del monorepo:
  instalan la última versión dentro de los rangos del `package.json` de cada
  proyecto. Esto es **aceptable para local**; en Fase 2 (cuando el server tenga
  dependencias workspace como `@pos/dto-types`) se migrará a build context = raíz
  con `pnpm install --filter @pos/server... --frozen-lockfile` — requiere agregar
  un `package.json` raíz y regenerar el lockfile. Documentar esa migración cuando
  llegue.
- **El server no tiene DB todavía.** Arranca aunque `DATABASE_URL` esté vacío
  (`env.ts` lo marca opcional). Hasta Fase 1/2 no usa Prisma.

## Fixes aplicados en la prueba end-to-end (2026-08-11)

1. **Migración de auth faltante.** La migración Clerk→JWT custom se aplicó en su
   momento directo a la DB (estilo `db push`) sin generar archivos de migración,
   así que `prisma migrate deploy` dejaba la DB local en la era Clerk (`users`
   con `clerkId`, sin `password`, y sin `sessions`/`email_verifications`/
   `password_resets`/`audit_logs`). Se generó
   `prisma/migrations/20260811000000_migrate_auth_clerk_to_custom_jwt/` vía
   `prisma migrate diff --from-migrations --to-schema-datamodel` (la vía
   no-interactiva; `migrate dev` requiere TTY).
   - ⚠️ **Al conectar Vercel+Supabase:** la DB de Supabase ya tiene el schema
     nuevo (aplicado por `db push`), y esta migración incluye
     `ADD COLUMN "password" TEXT NOT NULL` sin default — fallaría sobre datos
     existentes. Antes del primer `migrate deploy` contra Supabase, marcarla
     como aplicada: `prisma migrate resolve --applied 20260811000000_migrate_auth_clerk_to_custom_jwt`.
2. **Login form sin asociación label↔input.** Los `id` hardcodeados pisaban el
   `id` que genera `FormControl` (shadcn), y en el password el `FormControl`
   envolvía un `<div>` en vez del `<Input>`. Corregido en
   `src/app/auth/login/login-form.tsx`. El mismo patrón (`<FormControl><div>`)
   sigue pendiente en `register-form.tsx`, `create-organization.tsx` y
   `user-form-sheet.tsx` — corregirlo al escribir los specs P1 de esas suites.

## Verificación post-up

```bash
# Estado de los servicios
docker compose ps

# Logs del client (debería terminar con `next start` Ready)
docker compose logs client

# Health del server
curl -s http://localhost:3001/health

# Conexión a la DB desde el host
docker compose exec db psql -U pos -d pos -c '\dt'   # deberías ver las tablas del schema
```

## Limpiar el stack

```bash
docker compose down          # apaga servicios
docker compose down -v        # apaga + borra el volumen pgdata (DB reinicia vacía la próxima vez)
```