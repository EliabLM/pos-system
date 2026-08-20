# Estado del Proyecto

> **Fuente de verdad del estado del proyecto.** Toda sesión (humana o agente) empieza leyendo este archivo y termina actualizándolo.

## Estado actual

**Fase: Migración de monolito a 3 proyectos — Fase 0 y Pre-Fase 1 cerradas. Arrancando Fase 1 (DB foundation).**

- Monorepo git con `pnpm-workspace.yaml` activo. Miembro `pos-system-client/` se gestiona con su propio `pnpm-lock.yaml` durante la migración strangler-fig; se absorbe al workspace en Fase 5.
- `pos-system-client/` — Next.js 15 + Prisma/PostgreSQL + auth JWT custom (app POS operativa).
- `pos-system-server/` — Express 5 + TypeScript, scaffold con Clean Architecture (`src/app.ts`, `server.ts`, `config/env.ts`, `shared/`, `health/`), vitest + supertest. Listo para agregar módulos de dominio en Fase 2.
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
| 2026-08-20 | **Decisión de despliegue (cierra Pre-Fase 1):** el deploy Vercel + Supabase queda congelado apuntando al repo anterior (pre-monorepo); el monorepo no se deploya a Vercel. El sistema migrado se deploya **directo al VPS + Coolify** cuando la migración lo amerite (VPS se aprovisiona en ese momento). La migración se desarrolla y verifica contra el stack docker local. Pasos 2 y 3 de Pre-Fase 1 descartados/diferidos. ⚠️ El caveat de `migrate resolve --applied 20260811000000_...` contra Supabase queda moot salvo que se retome ese deploy |
| 2026-08-11 | **Stack local probado end-to-end + smoke E2E verde (17/17, 2 corridas estables)**. Fixes: (1) migración de auth faltante generada (`20260811000000_migrate_auth_clerk_to_custom_jwt` — el schema Clerk→JWT se había aplicado con `db push` sin archivos; ⚠️ marcarla `migrate resolve --applied` antes del primer deploy contra Supabase), (2) label↔input roto en el login form (ids hardcodeados pisaban el de `FormControl`; password envuelto en div), (3) `globalSetup` inyecta `DATABASE_URL` default al seed, (4) `workers: 1` local (logins concurrentes + bcrypt = timeouts flaky), (5) selectores del fixture corregidos (`/^contraseña$/i`, `cookies()` sin argumento). Ver [`deployment/docker-local.md`](./deployment/docker-local.md) §Fixes y [`features/testing/RUNBOOK.md`](./features/testing/RUNBOOK.md) §Troubleshooting |

## Próximo paso

**Fase 1 — DB foundation** (ver [`planning/migracion-3-proyectos.md`](./planning/migracion-3-proyectos.md) §Fase 1), desarrollada y verificada **contra el stack docker local** (no hay staging remoto; VPS se aprovisiona recién al deployar):

1. Mover `prisma/schema.prisma` del client al server (el client deja de ser dueño del schema).
2. Aplicar targets de `postgresql-table-design`: cuid→UUIDv7 (Receta R1), Float→Decimal (R2), snake_case `@map`, unique parcial `WHERE deleted_at IS NULL`, trigger `updated_at`, RLS + `FORCE` + role non-owner (R3), índices con `organization_id` leading.
3. Aplicar schema auth target (R6, R7): `memberships`, `verifications`, `accounts`, reshape de `users`/`sessions`/`audit_logs`, `slug` en `organizations`.
4. Migración de datos legacy → nuevo shape, probada sobre un dump.
5. Definition of done: `prisma migrate deploy` verde, tests RLS de aislamiento de tenant, schema matchea [`auth/AUTH_TARGET_SCHEMA.md`](./auth/AUTH_TARGET_SCHEMA.md).

> Antes de ejecutar, confirmar el alcance exacto y el orden de sub-tareas de la fase (regla del plan).

**Diferido/descartado de Pre-Fase 1 (decisión 2026-08-20):** el deploy Vercel+Supabase del monorepo se descarta (el existente queda congelado en el repo anterior); el VPS se aprovisiona cuando la migración esté lista para deployar.

## Deuda técnica conocida (a resolver en la migración a `pos-system-server`)

> Schema auth **target ya definido** en [`auth/AUTH_TARGET_SCHEMA.md`](./auth/AUTH_TARGET_SCHEMA.md). Los cambios de DB (no dependientes del IdP) se aplican en Fase 1; los gaps del JWT (algoritmo, refresh rotation, revocación) en Fase 2.

- **Dinero en `Float`** — sale/sale-item/payment usan `Float` para `subtotal`/`total`/`amount`. Migrar a `Decimal`/`NUMERIC(p,s)`.
- **IDs `cuid`** — migrar a `UUID` v7 (globalmente único, generable offline por la app, no filtra volumen).
- **Aislamiento de tenant solo en app** — agregar Postgres RLS sobre `organization_id` (decidido; ver skill `postgresql-table-design` — caveats: conectar como role non-owner + `FORCE ROW LEVEL SECURITY`; queries cross-tenant via rol superadmin aparte; tests deben setear el session var).
- **Soft-delete unique con `deletedAt` incluido** — reemplazar por índice único parcial `WHERE deleted_at IS NULL`.
- **`updated_at` solo vía Prisma** — agregar trigger `BEFORE UPDATE`.
- **Auth JWT gaps** — HS256 → EdDSA (Ed25519), access TTL 7d → 15min, refresh rotation + reuse detection, `jti`/`sid`/`ver` en claim, revocación stateful contra `sessions.isActive`, account lockout enforced, email-verify/password-reset unificados en `verifications`. Ver [`auth/AUTH_TARGET_SCHEMA.md`](./auth/AUTH_TARGET_SCHEMA.md).
- **`User` embebe `organizationId`/`storeId`** — desacoplar via tabla `Membership` (prepara multi-org, member-roles, invitaciones).
- **`username` en `User`** — eliminar; login por email.
- **`PasswordReset` + `EmailVerification` separadas** — unificar en `Verification` con `type` discriminator.
- **`AuditLog` shape débil** — reestructurar a actor-action-target + `storeId` + `correlationId`.
- **`Organization` sin `slug`** — añadir slug único global para URLs multi-tenant.

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
