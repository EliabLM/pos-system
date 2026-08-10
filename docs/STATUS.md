# Estado del Proyecto

> **Fuente de verdad del estado del proyecto.** Toda sesión (humana o agente) empieza leyendo este archivo y termina actualizándolo.

## Estado actual

**Fase: Migración de monolito a 3 proyectos — Fase 0 completada, pendiente Fase 1.**

- Monorepo git con `pnpm-workspace.yaml` activo. Miembro `pos-system-client/` se gestiona con su propio `pnpm-lock.yaml` durante la migración strangler-fig; se absorbe al workspace en Fase 5.
- `pos-system-client/` — Next.js 15 + Prisma/PostgreSQL + auth JWT custom (app POS operativa).
- `pos-system-server/` — Express 5 + TypeScript, scaffold con Clean Architecture (`src/app.ts`, `server.ts`, `config/env.ts`, `shared/`, `health/`), vitest + supertest. Listo para agregar módulos de dominio en Fase 2.
- `pos-system-app/` — Expo SDK 57 + expo-router, scaffold limpio. Sin features de negocio aún (Fase 4).
- `packages/` — `dto-types`, `api-client`, `design-tokens` scaffoldeados (vacíos).
- Repo remoto: `https://github.com/EliabLM/pos-system` (privado, branch `main`).
- Decisiones estratégicas confirmadas: **D1 = monorepo pnpm workspaces**, **D2 = migración incremental strangler-fig**.
- Toda la documentación vive en `docs/` de este repo padre.

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

## Próximo paso

**Ejecutar la Fase 1 del plan de migración** (`docs/planning/migracion-3-proyectos.md`).

Antes de avanzar, revisar el plan para confirmar el alcance exacto de Fase 1 (típicamente: CI del monorepo, shared packages con contenido real `dto-types`/`design-tokens`, y el primer módulo de dominio del server que inicia la extracción strangler-fig).

## Deuda técnica conocida (a resolver en la migración a `pos-system-server`)

- **Dinero en `Float`** — sale/sale-item/payment usan `Float` para `subtotal`/`total`/`amount`. Migrar a `Decimal`/`NUMERIC(p,s)`.
- **IDs `cuid`** — migrar a `UUID` v7 (globalmente único, generable offline por la app, no filtra volumen).
- **Aislamiento de tenant solo en app** — agregar Postgres RLS sobre `organization_id` (decidido; ver skill `postgresql-table-design` — caveats: conectar como role non-owner + `FORCE ROW LEVEL SECURITY`; queries cross-tenant via rol superadmin aparte; tests deben setear el session var).
- **Soft-delete unique con `deletedAt` incluido** — reemplazar por índice único parcial `WHERE deleted_at IS NULL`.
- **`updated_at` solo vía Prisma** — agregar trigger `BEFORE UPDATE`.

Ver skill `postgresql-table-design` para el detalle y la justificación de cada decisión.

## Features pendientes

| Feature | Estado | Doc |
|---------|--------|-----|
| Modo offline (PWA) | Plan listo, prioridad alta | [`features/offline-mode/`](./features/offline-mode/) |
| Módulo de compras | Plan listo | [`features/purchase/`](./features/purchase/) |
| Programa de lealtad | Sin documentación | — |
| Descuentos | Sin documentación | — |
| Impuestos | Sin documentación | — |

## Regla de mantenimiento

Al terminar cualquier tarea: actualizar **Estado actual**, mover hitos a **Completado** (con fecha) y redefinir **Próximo paso**. Si el próximo paso no está claro, eso es lo primero que hay que resolver.
