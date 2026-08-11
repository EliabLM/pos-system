# Estado del Proyecto

> **Fuente de verdad del estado del proyecto.** Toda sesión (humana o agente) empieza leyendo este archivo y termina actualizándolo.

## Estado actual

**Fase: Migración de monolito a 3 proyectos — Fase 0 completada. Pre-Fase 1: dejar el despliegue operativo antes de migrar.**

- Monorepo git con `pnpm-workspace.yaml` activo. Miembro `pos-system-client/` se gestiona con su propio `pnpm-lock.yaml` durante la migración strangler-fig; se absorbe al workspace en Fase 5.
- `pos-system-client/` — Next.js 15 + Prisma/PostgreSQL + auth JWT custom (app POS operativa).
- `pos-system-server/` — Express 5 + TypeScript, scaffold con Clean Architecture (`src/app.ts`, `server.ts`, `config/env.ts`, `shared/`, `health/`), vitest + supertest. Listo para agregar módulos de dominio en Fase 2.
- `pos-system-app/` — Expo SDK 57 + expo-router, scaffold limpio. Sin features de negocio aún (Fase 4).
- `packages/` — `dto-types`, `api-client`, `design-tokens` scaffoldeados (vacíos).
- Repo remoto: `https://github.com/EliabLM/pos-system` (privado, branch `main`).
- Decisiones estratégicas confirmadas: **D1 = monorepo pnpm workspaces**, **D2 = migración incremental strangler-fig**, **D3 = custom JWT + schema auth target** (ver [`auth/AUTH_TARGET_SCHEMA.md`](./auth/AUTH_TARGET_SCHEMA.md)).
- Toda la documentación vive en `docs/` de este repo padre.
- **Estrategia de despliegue definida** (ver [`deployment/estrategia-despliegue.md`](./deployment/estrategia-despliegue.md)):
  - **Local:** `docker compose up` levanta db + server + client (+ app web opcional). Ver [`deployment/docker-local.md`](./deployment/docker-local.md).
  - **Testing/staging:** Vercel + Supabase (solo el client; server y app sin deployar hasta tener dominio). Ver [`deployment/deploy-vercel-monorepo.md`](./deployment/deploy-vercel-monorepo.md).
  - **Producción:** VPS + Coolify + Postgres en el mismo VPS (los 3 proyectos vía `docker-compose.yml`).

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

## Próximo paso

**Pre-Fase 1 — dejar el despliegue operativo antes de migrar.**

1. **Probar el stack local:** `cp .env.example .env`, `docker compose up --build` y validarlo end-to-end (client en :3000, server en :3001, DB migrada). Documentar cualquier fix en [`deployment/docker-local.md`](./deployment/docker-local.md).
2. **Deployar el client en Vercel (testing) + Supabase:** seguir paso a paso [`deployment/deploy-vercel-monorepo.md`](./deployment/deploy-vercel-monorepo.md). Confirmar login y un flujo de smoke.
3. **Aprovisionar el VPS de producción + Coolify + Postgres** (sin migratear todavía — el schema actual es el legacy). Definir dominio, apuntar DNS.

Una vez que esos tres estén verdes, arrancar la **Fase 1 del plan de migración** (`docs/planning/migracion-3-proyectos.md`) sobre la DB del VPS: mover el schema al server, aplicar los targets de la skill `postgresql-table-design` (Float→Decimal, cuid→UUIDv7, RLS, índices), y empezarla extracción strangler-fig.

> Antes de avanzar a Fase 1, revisar el plan para confirmar el alcance exacto de la fase.

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
| **Suite de pruebas E2E (Playwright)** | 🟡 Plan cerrado y validado contra código + infraestructura lista (seed + config + specs P0). Falta probar stack docker + correr smoke, y generar specs P1/P2 por suite (usar subagentes generator/healer con el stack arriba) | [`features/testing/playwright-test-plan.md`](./features/testing/playwright-test-plan.md) · [`features/testing/RUNBOOK.md`](./features/testing/RUNBOOK.md) |
| Programa de lealtad | Sin documentación | — |
| Descuentos | Sin documentación | — |
| Impuestos | Sin documentación | — |

## Regla de mantenimiento

Al terminar cualquier tarea: actualizar **Estado actual**, mover hitos a **Completado** (con fecha) y redefinir **Próximo paso**. Si el próximo paso no está claro, eso es lo primero que hay que resolver.
