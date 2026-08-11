# Despliegue del client en Vercel (desde el monorepo)

> **Objetivo:** dejar el POS (`pos-system-client`) corriendo en Vercel **antes** de
> tocar nada de la migración, apuntando el repo ya importado como subcarpeta del
> monorepo `pos-system`. El objetivo es que el app siga funcionando igual que ahora,
> sin regenerar desde otro lado.
>
> **Fecha:** 2026-08-10 · **Estado:** Pendiente de ejecución
>
> **Entorno:** testing (no producción). La DB de pruebas es **Supabase** (PostgreSQL
> gestionado). Producción va por VPS + Coolify — ver
> [`estrategia-despliegue.md`](./estrategia-despliegue.md).

## Contexto

- El monolito `pos-system-client` (Next.js 15 App Router + Prisma + server actions
  + auth JWT custom) fue importado como subcarpeta del repo `pos-system`
  (`https://github.com/EliabLM/pos-system`, branch `main`).
- El cliente **no es miembro del workspace pnpm** durante la migración (tiene su
  propio `pnpm-lock.yaml`). Vercel lo trata como un proyecto standalone: le
  apuntamos el **Root Directory** y listo.
- La arquitectura del cliente sigue siendo **server actions → Prisma → DB directa**.
  No hay server HTTP todavía (el `pos-system-server` se conecta en Fase 2). Por eso
  en este entorno de testing solo conectamos Vercel ↔ Supabase.
- `pos-system-client/vercel.json` ya define `buildCommand: pnpm vercel-build` y el
  includeFiles del cliente Prisma generado. **No hay que tocar ese archivo.**
- `pnpm` está pinneado en `package.json` (`packageManager: pnpm@10.7.1`), así que
  Vercel autodetecta la versión correcta.

## Pre-requisitos

1. Repo `EliabLM/pos-system` pushado en `main` (ya está).
2. Una cuenta en Supabase (plan free alcanza para pruebas) y una en Vercel.
3. Tu cuenta de Vercel linkeada a GitHub con acceso al repo `pos-system`.
4. Localmente: `pnpm` 10.7.1 y Node 22 para probar el build antes de pushar.

## Paso a paso

### 1. Crear el proyecto Postgres en Supabase

1. https://supabase.com → New Project. Nombre sugerido: `pos-system-testing`.
   Región cercana a tus usuarios de prueba.
2. Anotar **Database Password** (la vas a usar en las connection strings).
3. Esperar a que el proyecto termine de provisionar (~2 min).
4. Ir a **Project Settings → Connect** (o **Database → Connection string**). Copiar
   las dos connection strings que vamos a usar:

   | Vercel env var | Modo de Supabase | Puerto | ¿pgbouncer? |
   |----------------|------------------|-------|-------------|
   | `DATABASE_URL`  | **Transaction pooler** (pooler) | 6543 | **sí** — añadir `?pgbouncer=true&connection_limit=1` |
   | `DIRECT_URL`    | **Session pooler** (`Direct connection` o Session mode) | 5432 (pooler) o 5432 host directo | **no** — sin `pgbouncer` |

   > Prisma 6 exige que la URL de runtime (que usa el pooler) lleve
   > `?pgbouncer=true&connection_limit=1` cuando pase por PgBouncer. Las migraciones
   > corren por `DIRECT_URL` (sin PgBouncer) o por el pooler en **Session mode**.

   Ejemplo (reemplazar placeholders):
   ```
   DATABASE_URL=postgresql://postgres.xxxx:PASSWORD@aws-0-region.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1
   DIRECT_URL=postgresql://postgres.xxxx:PASSWORD@aws-0-region.pooler.supabase.com:5432/postgres
   ```

### 2. Importar el repo en Vercel

1. https://vercel.com/new
2. **Import Git Repository** → elegir `EliabLM/pos-system`.
3. En **Configure Project**:

   - **Framework Preset:** Next.js
   - **Root Directory:** clic en **Edit** → seleccionar `pos-system-client`.
     (Esto hace que Vercel use el `pnpm-lock.yaml` y `vercel.json` de esa carpeta.)
   - **Build Command:** deja el autodetectado (`pnpm vercel-build`) — viene del
     `vercel.json`.
   - **Install Command:** deja el autodetectado (`pnpm install`).
   - **Node.js Version:** abrí **Settings → General → Node.js Version** antes de
     deployar y **fija 22.x**. (`next` 15 + `prisma` 6 → Node ≥ 18, usamos 22 que
     es el LTS actual y el mismo que el server / docker.)

4. **Environment Variables** (Project → Settings → Environment Variables) — añadir
   todas para **Production + Preview + Development** (al menos Production y Preview):

   | Key | Value | Notas |
   |-----|-------|-------|
   | `DATABASE_URL`     | connection string pooling (puerto 6543, `?pgbouncer=true&connection_limit=1`) | Runtime Prisma |
   | `DIRECT_URL`       | connection string session/direct (puerto 5432) | Migraciones |
   | `JWT_SECRET`       | `<mínimo 32 chars, generado con openssl rand -base64 48>` | Auth JWT |
   | `UPLOADTHING_TOKEN`| tu token de UploadThing | Subida de imágenes. Vacío si todavía no la usás. |
   | `HTTPS_ENABLED`    | `true` | Lo lee el middleware del client |

5. **Deploy.**

### 3. Qué pasa en ese primer build

El `vercel-build` del client ejecuta, en orden:

```
prisma generate          # genera @/generated/prisma (también está commiteado)
prisma migrate deploy    # aplica TODAS las migraciones en prisma/migrations/ contra la DB
next build               # compila la app
```

- Como el `DATABASE_URL` va por PgBouncer y `DIRECT_URL` no, `prisma migrate deploy`
  usa `DIRECT_URL` y no choca con el modo transaction del pooler.
- Si la DB de Supabase está vacía (caso normal), se aplican todas las migraciones y
  queda el schema completo.
- Si algún seed manual dependiente existiera, por ahora **no corre** en build (el
  `vercel-build` no invoca seeds). Para seed inicial ver paso 5.

### 4. Verificar

1. Abrir la URL de Vercel (`.vercel.app`). Login con un usuario válido.
   → Si no tenés usuarios, la DB está recién migrada y vacía: ejecutá el seed
   manual (paso 5).
2. Flujos a smoke-testear: login, dashboard, crear una entidad de prueba, logout.
3. Revisar **Functions logs** en Vercel si algo falla en server actions → vease
   errores típicos más abajo.

### 5. Seed inicial de la DB (si la DB está vacía)

Vercel **no** corre seeds por default. Opciones:

- **Local, una sola vez:** apuntá tu `.env` local a la Supabase de pruebas (las
  mismas connection strings) y corré el seed que ya exista en el repo del client
  (ej. `pnpm tsx prisma/seed.ts` o el script que use el proyecto). Como el schema
  ya quedó aplicado por el primer deploy, el seed solo inserta datos.
- **Opción Vercel:** agregar temporalmente un script `postbuild` que corra el seed
  **solo en environments no-production**. No recomendado para testing: seed por
  local es más simple y predecible.

### 6. Configurar dominio y branches (opcional, recommendedado)

- **Production domain:** Settings → Domains → añadir el custom domain que uses para
  pruebas. Vercel gestiona DNS + HTTPS automático.
- **Preview branches:** por default cada PR/branch abre una preview con sus propias
  DBs si las agregás a `DATABASE_URL`/`DIRECT_URL` con el target *Preview*. Mientras
  tengas una sola Supabase, todas las previews comparten la misma DB — aceptable
  para pruebas. Si querés aislamiento por preview, crear DBs separadas en Supabase
  (más trabajo; definir más adelante).

### 7. Flujo continuo

- Cada push a `main` → redeploy Production.
- Cada PR → deploy Preview contra la misma DB de pruebas.
- **El `pos-system-server` y `pos-system-app` no se deployan todavía** (sin dominio).
  A partir de Fase 2 (auth surface) se evalúa desplegar el server en VPS con
  Coolify — ver [`estrategia-despliegue.md`](./estrategia-despliegue.md).

## Errores típicos y soluciones

| Síntoma en logs de Vercel | Causa | Fix |
|---------------------------|-------|-----|
| `PrismaClientInitializationError: number of prepared statements` | `DATABASE_URL` apunta al pooler sin `?pgbouncer=true` | añadir `?pgbouncer=true&connection_limit=1` |
| `relation does not exist` en server actions | Las migraciones no aplicaron (DIRECT_URL mal o bloqueado) | revisar `DIRECT_URL` (Session/direct, sin pgbouncer) y redeploy |
| `JWT_SECRET` / 401 en todas las rutas | `JWT_SECRET` distinto entre Vercel y el que firmó el token | setear mismo `JWT_SECRET`; limpiar cookie y relogear |
| Build falla en `prisma migrate deploy` con `migration failed` | Hay drift entre `prisma/migrations/` y la DB de Supabase (alguien aplicó algo manual) | resetear DB de Supabase desde el panel (Database → Reset) y redeploy |
| `Error: … cannot run prisma generate` en build | Falta `openssl` en runtime | No debería ocurrir (Vercel lo provee); verificar que `serverExternalPackages` siga en `next.config.ts`. No tocarlo. |
| Next 15 build toma >45s por Prisma | esperable en first deploy | solo pasa en el primer build; siguientes usarán cache |

## Qué falta para que este deploy sea "el real de producción"

Este deploy de Vercel + Supabase queda como entorno de **pruebas/staging**. La
producción final Vive en un VPS con Coolify + Postgres en el mismo VPS,deployando
los 3 proyectos con el mismo `docker-compose.yml`. Ver
[`estrategia-despliegue.md`](./estrategia-despliegue.md).

## Puntos de no-regresión

- No borrar/modificar `pos-system-client/vercel.json`.
- No sacar `serverExternalPackages` / `outputFileTracingIncludes` / `PrismaPlugin`
  de `next.config.ts` — son necesarios para Prisma en Vercel.
- No agregar `output: 'standalone'` a `next.config.ts` solo por Docker: Vercel no lo
  necesita y cambia el output. La imagen de Docker del client usa build non-standalone.
- `JWT_SECRET` siempre ≥ 32 caracteres. No commitear `.env`.