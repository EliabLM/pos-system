# Estado del Proyecto

> **Fuente de verdad del estado del proyecto.** Toda sesión (humana o agente) empieza leyendo este archivo y termina actualizándolo.

## Estado actual

**Fase: Migración de monolito a 3 proyectos** (`pos-system-client` / `pos-system-server` / `pos-system-app`).

- Todo el código vive en `pos-system-client/` (Next.js 15 + Prisma/PostgreSQL + auth JWT custom).
- `pos-system-server/` y `pos-system-app/` existen pero están **vacíos** — no scaffold hasta tener plan.
- Toda la documentación vive en `docs/` de este repo padre.

## Completado

| Fecha | Hito |
|-------|------|
| 2026-08-09 | Documentación centralizada en el repo padre y organizada por categorías |
| 2026-08-09 | Auth JWT custom (migrada desde Clerk) + RBAC Admin/Seller — ver [`auth/`](./auth/) |
| 2026-08-09 | Stack de los 3 proyectos definido + 7 skills de soporte creadas |
| 2026-08-09 | Plan de migración escrito — ver [`planning/migracion-3-proyectos.md`](./planning/migracion-3-proyectos.md) |

## Próximo paso

**Ejecutar la Fase 0 del plan de migración** (`docs/planning/migracion-3-proyectos.md`):

1. **Confirmar las 2 decisiones estratégicas** antes de arrancar:
   - **D1 — Monorepo con pnpm workspaces** (recomendado) vs repos separados. Requiere convertir el repo padre en repo git.
   - **D2 — Migración incremental "strangler fig"** (recomendado) vs big-bang.
2. Una vez confirmadas, ejecutar Fase 0: workspace setup, scaffolding de `pos-system-server/` y `pos-system-app/` vacíos, packages compartidos, CI.

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
