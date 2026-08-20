# Estado del Proyecto

> **Fuente de verdad del estado del proyecto.** Toda sesión (humana o agente) empieza leyendo este archivo y termina actualizándolo.

## Estado actual

**Fase: Migración de monolito a 3 proyectos — Fase 0 y Pre-Fase 1 cerradas. Arrancando Fase 1 (DB foundation).**

- Monorepo git con `pnpm-workspace.yaml` activo. Miembro `pos-system-client/` se gestiona con su propio `pnpm-lock.yaml` durante la migración strangler-fig; se absorbe al workspace en Fase 5.
- `pos-system-client/` — Next.js 15 + Prisma/PostgreSQL + auth JWT custom (app POS operativa). Desde el 2026-08-20 ya **no es dueño del schema Prisma**: solo regenera/consume el cliente generado (`src/generated/prisma`) apuntando al schema del server.
- `pos-system-server/` — Express 5 + TypeScript, scaffold con Clean Architecture (`src/app.ts`, `server.ts`, `config/env.ts`, `shared/`, `health/`), vitest + supertest. **Dueño de `prisma/schema.prisma` + migraciones desde Fase 1 paso 1** (aplica `migrate deploy` al arrancar en docker). Módulos de dominio llegan en Fase 2.
- `pos-system-app/` — Expo SDK 57 + expo-router, scaffold limpio. Sin features de negocio aún (Fase 4).
- `packages/` — `dto-types`, `api-client`, `design-tokens` scaffoldeados (vacíos).
- Repo remoto: `https://github.com/EliabLM/pos-system` (privado, branch `main`).
- Decisiones estratégicas confirmadas: **D1 = monorepo pnpm workspaces**, **D2 = migración incremental strangler-fig**, **D3 = custom JWT + schema auth target** (ver [`auth/AUTH_TARGET_SCHEMA.md`](./auth/AUTH_TARGET_SCHEMA.md)).
- Toda la documentación vive en `docs/` de este repo padre.
- **Estrategia de despliegue definida** (ver [`deployment/estrategia-despliegue.md`](./deployment/estrategia-despliegue.md)), ajustada el 2026-08-20:
  - **Local:** `docker compose up` levanta db + server + client (+ app web opcional). Ver [`deployment/docker-local.md`](./deployment/docker-local.md). **Es el único entorno de la migración hasta el deploy a VPS.**
  - **Testing/staging (legacy, congelado):** el deploy Vercel + Supabase existente sigue apuntando al **repo anterior** (pre-monorepo) y no se toca. El monorepo NO se deploya a Vercel.
  - **Producción:** VPS + Coolify + Postgres en el mismo VPS (los 3 proyectos vía `docker-compose.yml`). El VPS se aprovisiona **cuando la migración esté lista para deployar**, no antes.

## Completado

| Fecha | Hito |
|-------|------|
| 2026-08-09 | Documentación centralizada en el repo padre y organizada por categorías |
| 2026-08-09 | Auth JWT custom (migrada desde Clerk) + RBAC Admin/Seller — ver [`auth/`](./auth/) |
| 2026-08-09 | Stack de los 3 proyectos definido + 7 skills de soporte creadas |
| 2026-08-09 | Plan de migración escrito — ver [`planning/migracion-3-proyectos.md`](./planning/migracion-3-proyectos.md) |
| 2026-08-10 | Decisiones D1/D2 confirmadas (monorepo pnpm + strangler-fig incremental) |
| 2026-08-10 | Fase 0 completada: repo git bootstrap, `pos-system-client` importado, server + app + packages scaffoldeados |
| 2026-08-10 | Repo remoto creado y empujado a GitHub (`EliabLM/pos-system`, `main`) |
| 2026-08-10 | Estrategia de despliegue definida: local (docker-compose) + testing (Vercel+Supabase) + prod (VPS+Coolify+Postgres) |
| 2026-08-10 | `docker-compose.yml` + Dockerfiles de los 3 proyectos + Postgres 17 local (pendiente probar `up` end-to-end) |
| 2026-08-10 | D3 confirmada: custom JWT + schema auth target (`Membership`, `Verification` unificada, `Account` skeleton, `AuditLog` reestructurado, EdDSA, refresh rotation). Better Auth re-evaluable en Fase 2 |
| 2026-08-11 | Plan de pruebas E2E (Playwright) — matriz de 180 escenarios (ver [`features/testing/playwright-test-plan.md`](./features/testing/playwright-test-plan.md)) |
| 2026-08-11 | Suite E2E habilitada en `pos-system-client/`: seed Prisma idempotente (`prisma/seed.ts`), config Playwright + `globalSetup` que espera stack docker y resiembra, fixtures de auth, 2 specs P0 smoke (auth login + navegación RBAC seller), runbook en [`features/testing/RUNBOOK.md`](./features/testing/RUNBOOK.md). Pendiente probar `docker compose up` + correr smoke end-to-end e incrementar specs P1/P2 |
| 2026-08-11 | **Plan E2E cerrado**: suposiciones abiertas (§8.5) verificadas contra el código — seller SÍ crea clientes inline, cancelar venta SÍ repone stock, unicidad de org por NIT, `/dashboard/purchases` existe, sin regla de fecha en compras, login público no redirige con sesión, onboarding auto-crea parametrización. Hallazgo canario: `generatePurchaseNumber` no filtra por `organizationId` (bug cross-tenant candidato). Limpieza de restos de `playwright init` en la raíz (tests/, config, package-lock npm) y `.mcp.json` apuntado a `pos-system-client/` |
| 2026-08-20 | **Fase 1 paso 3 completado: schema auth target aplicado** (2 migraciones + refactor del client). 3a aditivo: `memberships` (D3.3, poblada desde users), `verifications` (D3.7, merge de password_resets+email_verifications), `accounts` skeleton (D3.9), `organizations.slug` único con trigger slugify (D3.10/R7), refresh-rotation columns en sessions. 3b/3c: users = identidad global (`name`, `passwordHash` nullable, sin username/org/store/role), `sessions.token_hash`, `audit_logs` actor-action-target, tablas de verificación viejas eliminadas. Client (~30 archivos): auth actions componen la vista user+membership (JWT/middleware sin cambios), RBAC vía membership, user CRUD membership-first, register con campo `name` único, seed con memberships. Migración de datos verificada sobre datos reales del seed. Smoke E2E 17/17 |
| 2026-08-20 | **Fase 1 paso 2 completado: targets de `postgresql-table-design` aplicados** en 6 migraciones verificadas una a una (cada una: drift-check limpio + build client + stack docker desde volumen limpio + smoke E2E 17/17): (2a) snake_case en columnas/índices/FKs/enums vía RENAMEs a mano; (2b) uniques de soft-delete → índices únicos parciales `WHERE deleted_at IS NULL` (Prisma los ignora en el diff — verificado empíricamente; stores también, su unique full bloqueaba reuso de nombre); (2c) `timestamptz` + trigger `BEFORE UPDATE` para `updated_at` + `varchar(n)`→`text`; (2d) índices FK explícitos + compuestos `(organization_id, is_deleted[, fecha])`; (2e) dinero Float→`numeric(12,2)` con `serializeDecimals`/`Serialized<T>` en la frontera de las actions (la UI sigue en `number`; correr auditoría R2 antes de migrar prod); (2f) cuid→UUIDv7 con `legacy_id_map` + función SQL `uuidv7()` (PG17; ids v7 verificados, JWTs activos se invalidan en el cutover de prod); (2g) RLS habilitado con policies `tenant_isolation` (falla cerrada) + test de aislamiento verde (`pos-system-server/scripts/db/rls-test.sql`); rol `pos_app` por entorno (`scripts/db/rls-roles.sql`). ⚠️ `FORCE ROW LEVEL SECURITY` diferido a Fase 2: el client strangler conecta como owner y no setea `app.tenant_id` |
| 2026-08-20 | **Fase 1 paso 1 completado: el server es dueño del schema Prisma.** `schema.prisma` + `migrations/` movidos a `pos-system-server/prisma/` (sin cambios de schema); el generator emite al client (`../../pos-system-client/src/generated/prisma`); scripts del client apuntan al schema del server (`vercel-build` eliminado); el contenedor `server` aplica `migrate deploy` al arrancar (con healthcheck `/api/v1/health`) y el client espera server healthy; build context del client = raíz del repo (+ `.dockerignore` raíz); `prisma`+`@prisma/client` 6.14.0 agregados al server; `packageManager` pineado en el root; `onlyBuiltDependencies` para engines de Prisma. Verificado: build+lint client, typecheck+tests+lint+build server, migraciones desde volumen limpio, smoke E2E 17/17 |
| 2026-08-20 | **Decisión de despliegue (cierra Pre-Fase 1):** el deploy Vercel + Supabase queda congelado apuntando al repo anterior (pre-monorepo); el monorepo no se deploya a Vercel. El sistema migrado se deploya **directo al VPS + Coolify** cuando la migración lo amerite (VPS se aprovisiona en ese momento). La migración se desarrolla y verifica contra el stack docker local. Pasos 2 y 3 de Pre-Fase 1 descartados/diferidos. ⚠️ El caveat de `migrate resolve --applied 20260811000000_...` contra Supabase queda moot salvo que se retome ese deploy |
| 2026-08-11 | **Stack local probado end-to-end + smoke E2E verde (17/17, 2 corridas estables)**. Fixes: (1) migración de auth faltante generada (`20260811000000_migrate_auth_clerk_to_custom_jwt` — el schema Clerk→JWT se había aplicado con `db push` sin archivos; ⚠️ marcarla `migrate resolve --applied` antes del primer deploy contra Supabase), (2) label↔input roto en el login form (ids hardcodeados pisaban el de `FormControl`; password envuelto en div), (3) `globalSetup` inyecta `DATABASE_URL` default al seed, (4) `workers: 1` local (logins concurrentes + bcrypt = timeouts flaky), (5) selectores del fixture corregidos (`/^contraseña$/i`, `cookies()` sin argumento). Ver [`deployment/docker-local.md`](./deployment/docker-local.md) §Fixes y [`features/testing/RUNBOOK.md`](./features/testing/RUNBOOK.md) §Troubleshooting |

## Próximo paso

**Fase 1 — DB foundation** (ver [`planning/migracion-3-proyectos.md`](./planning/migracion-3-proyectos.md) §Fase 1), desarrollada y verificada **contra el stack docker local** (no hay staging remoto; VPS se aprovisiona recién al deployar):

1. ~~Mover `prisma/schema.prisma` del client al server~~ ✅ Hecho el 2026-08-20 (sin cambios de schema; stack docker + smoke E2E 17/17 verdes).
2. ~~Aplicar targets de `postgresql-table-design`~~ ✅ Hecho el 2026-08-20 en 6 migraciones (snake_case, uniques parciales, timestamptz+trigger, índices, Decimal, UUIDv7, RLS). Pendientes que quedan de este paso para Fase 2: `FORCE ROW LEVEL SECURITY` + runtime con rol `pos_app` non-owner + `SET LOCAL app.tenant_id` por request.
3. ~~Aplicar schema auth target (R6, R7)~~ ✅ Hecho el 2026-08-20 en 2 bloques: (3a aditivo) `memberships` poblada, `verifications` con merge de las 2 tablas viejas, `accounts` skeleton, `organizations.slug` con trigger de slugify (R7), `sessions.refresh_token_hash`/`rotated_from`; (3b/3c destructivo + refactor client ~30 archivos) users = identidad global (`name`, `passwordHash` nullable, sin `username`/org/store/role — tenancy en memberships), `sessions.token`→`token_hash`, `audit_logs` actor-action-target (+`store_id`, `correlation_id`; enum extendido), drop de `password_resets`/`email_verifications` y `user_role`. Las auth actions componen la vista legacy (role/org/store) desde el membership ACTIVO → JWT claims y middleware sin cambios; usuario sin membership = dueño en onboarding (ADMIN). Smoke E2E 17/17 (login + RBAC vía memberships). ⚠️ Register ahora pide un solo campo `name` (D3.5) — sin spec E2E aún.
4. **← SIGUIENTE:** ensayar la cadena completa de migraciones sobre un **dump de la Supabase legacy** (datos reales) en staging local: `pg_dump` → restore → `migrate deploy` → verificaciones R1/R2/R6 (counts, redondeos, memberships por user). La cadena ya corrió limpia sobre los datos del seed local.
5. Definition of done: ~~`prisma migrate deploy` verde~~ ✅ · ~~tests RLS de aislamiento~~ ✅ (`scripts/db/rls-test.sql`) · ~~schema matchea `AUTH_TARGET_SCHEMA.md`~~ ✅ (con desvíos deliberados documentados: FORCE RLS diferido a Fase 2, enum audit extendido en vez de reemplazado, `isDeleted` conservado) · falta solo el ensayo sobre dump de prod (paso 4).

> Antes de ejecutar, confirmar el alcance exacto y el orden de sub-tareas de la fase (regla del plan).

**Diferido/descartado de Pre-Fase 1 (decisión 2026-08-20):** el deploy Vercel+Supabase del monorepo se descarta (el existente queda congelado en el repo anterior); el VPS se aprovisiona cuando la migración esté lista para deployar.

## Deuda técnica conocida (a resolver en la migración a `pos-system-server`)

> Schema auth **target ya definido** en [`auth/AUTH_TARGET_SCHEMA.md`](./auth/AUTH_TARGET_SCHEMA.md). Los cambios de DB (no dependientes del IdP) se aplican en Fase 1; los gaps del JWT (algoritmo, refresh rotation, revocación) en Fase 2.

- ~~**Dinero en `Float`**~~ ✅ Resuelto 2026-08-20 — `numeric(12,2)` + `serializeDecimals` en la frontera.
- ~~**IDs `cuid`**~~ ✅ Resuelto 2026-08-20 — UUIDv7 (función SQL `uuidv7()` + `legacy_id_map`).
- **Aislamiento de tenant** — 🟡 RLS habilitado con policies + test verde (2026-08-20). Falta para Fase 2: `FORCE ROW LEVEL SECURITY` + API conectando como `pos_app` non-owner + `SET LOCAL app.tenant_id` por request (el client strangler aún conecta como owner y bypasea).
- ~~**Soft-delete unique con `deletedAt` incluido**~~ ✅ Resuelto 2026-08-20 — índices únicos parciales `WHERE deleted_at IS NULL`.
- ~~**`updated_at` solo vía Prisma**~~ ✅ Resuelto 2026-08-20 — trigger `BEFORE UPDATE` en las 17 tablas con `updated_at`.
- **Auth JWT gaps** — HS256 → EdDSA (Ed25519), access TTL 7d → 15min, refresh rotation + reuse detection, `jti`/`sid`/`ver` en claim, revocación stateful contra `sessions.isActive`, account lockout enforced, email-verify/password-reset unificados en `verifications`. Ver [`auth/AUTH_TARGET_SCHEMA.md`](./auth/AUTH_TARGET_SCHEMA.md).
- ~~**`User` embebe `organizationId`/`storeId`**~~ ✅ Resuelto 2026-08-20 — tabla `memberships` (D3.3).
- ~~**`username` en `User`**~~ ✅ Resuelto 2026-08-20 — login por email (D3.4).
- ~~**`PasswordReset` + `EmailVerification` separadas**~~ ✅ Resuelto 2026-08-20 — unificadas en `verifications` (D3.7; los flows end-to-end llegan en Fase 2).
- ~~**`AuditLog` shape débil**~~ ✅ Resuelto 2026-08-20 — actor-action-target + `store_id` + `correlation_id` (D3.8; enum extendido, valores legacy conservados).
- ~~**`Organization` sin `slug`**~~ ✅ Resuelto 2026-08-20 — slug único global generado por trigger (D3.10/R7).

Ver skill `postgresql-table-design` para el detalle y la justificación de cada decisión.

## Features pendientes

| Feature | Estado | Doc |
|---------|--------|-----|
| Modo offline (PWA) | Plan listo, prioridad alta | [`features/offline-mode/`](./features/offline-mode/) |
| Módulo de compras | Plan listo | [`features/purchase/`](./features/purchase/) |
| **Suite de pruebas E2E (Playwright)** | 🟢 Smoke P0 verde contra el stack docker (17/17 estable). Falta generar specs P1/P2 por suite (usar subagentes generator/healer con el stack arriba). Deuda a11y: patrón `<FormControl><div>` roto en register/onboarding/user-form (mismo fix que login) | [`features/testing/playwright-test-plan.md`](./features/testing/playwright-test-plan.md) · [`features/testing/RUNBOOK.md`](./features/testing/RUNBOOK.md) |
| Programa de lealtad | Sin documentación | — |
| Descuentos | Sin documentación | — |
| Impuestos | Sin documentación | — |

## Regla de mantenimiento

Al terminar cualquier tarea: actualizar **Estado actual**, mover hitos a **Completado** (con fecha) y redefinir **Próximo paso**. Si el próximo paso no está claro, eso es lo primero que hay que resolver.
