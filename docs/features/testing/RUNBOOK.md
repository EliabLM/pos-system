# Runbook — Pruebas E2E (Playwright) del POS

> **Cómo correr la suite E2E** contra el stack local `docker compose up`.
>
> **Plan completo (180 escenarios E001–E180)**: ver [`playwright-test-plan.md`](./playwright-test-plan.md).
>
> **Fecha:** 2026-08-11 · **Estado:** Plan cerrado (suposiciones §8.5 verificadas contra el código) · Infraestructura lista · Specs P0 escritos · Resto por implementar incrementalmente cuando el stack docker esté disponible.

## Requisitos

1. **Docker** levantando `db` (Postgres 17) + `client` (Next.js). Ver [`../../deployment/docker-local.md`](../../deployment/docker-local.md).
2. **Node 22+** y **pnpm 10.7.1** (vía `corepack pnpm`).
3. Desde el directorio `pos-system-client/`:
   ```bash
   corepack pnpm install
   corepack pnpm exec playwright install chromium
   ```
4. El `.env` del client debe apuntar `DATABASE_URL` y `DIRECT_URL` a la DB local del compose (`postgresql://pos:pos@localhost:5432/pos`). Si el `.env` apunta a Supabase, sobreescribí temporalmente antes del seed:
   ```bash
   DATABASE_URL="postgresql://pos:pos@localhost:5432/pos" DIRECT_URL="postgresql://pos:pos@localhost:5432/pos" corepack pnpm db:seed
   ```

> PTSD pnpm: en este host `pnpm` no está en PATH global. Usar siempre `corepack pnpm ...`.

## Flujo recomendado

```bash
# 1. Levantar el stack (desde la raíz del monorepo)
docker compose up -d --build db client    # server y app son opcionales para E2E

# 2. Esperar a que /auth/login responda (≈30s tras build)
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/auth/login    # debe dar 200

# 3. Sembrar (idempotente) desde el directorio del client
cd pos-system-client
DATABASE_URL="postgresql://pos:pos@localhost:5432/pos" DIRECT_URL="postgresql://pos:pos@localhost:5432/pos" corepack pnpm db:seed

# 4. Correr la suite
corepack pnpm test:e2e                    # headless, sirve para CI
corepack pnpm test:e2e:ui                 # mode UI (Inspector + watch)
corepack pnpm test:e2e:debug              #uncia test en modo debug
corepack pnpm test:e2e:report             # abrir último reporte HTML

# 5. Iterar sin reseed entre corridas (mantiene estado para debug manual)
E2E_SKIP_SEED=1 corepack pnpm test:e2e
```

> Nota: por defecto `globalSetup` espera el stack y resiembra antes de cada corrida. Si el stack ya está up y querés iterar specs sin perder estado, seteá `E2E_SKIP_SEED=1`.

## Datos sembrados (credenciales)

| Email | Password | Rol | Notas |
|-------|----------|-----|-------|
| `admin@pos.test` | `Admin123!` | ADMIN | Login admin full-access. |
| `seller@pos.test` | `Seller123!` | SELLER | Login seller — solo `/dashboard` y `/dashboard/sales`. |
| `conflict@pos.test` | `Conflict123!` | SELLER | Auxiliar para tests de unique de email/username en registro. |
| `lock@pos.test` | `Lock123!` | SELLER | Auxiliar para tests de lockout (`MAX_LOGIN_ATTEMPTS=5`). |
| `trash@pos.test` | `Trash123!` | SELLER | `isDeleted=true` — tests de "email usado previamente". |

Organización: `Pos Demo Org` · Stores: `Store Central` (prefix `SC`, `lastSaleNumber=1`), `Store Sucursal Norte` (prefix `SN`). Sale histórica `SC-000001` PAID lista para poblar el dashboard y reports.

## Estructura

```
pos-system-client/
├── prisma/
│   └── seed.ts            # seed idempotente (pnpm db:seed)
├── playwright.config.ts   # config (base URL :3000, 1 worker chromium, globalSetup)
├── package.json           # scripts test:e2e*, db:seed, prisma.seed
├── tsconfig.json          # exclude e2e + playwright.config (no rompe next build)
└── e2e/
    ├── globalSetup.ts     # espera stack + reseed (skip con E2E_SKIP_SEED=1)
    ├── fixtures/
    │   └── auth.ts        # ADMIN/SELLER creds + loginUI / loginAs / logout
    ├── auth.smoke.spec.ts # P0: E001/E002 (login admin+seller), E006 (bad creds), logout
    └── navigation-rbac.smoke.spec.ts  # P0: seller redirigido de 12 rutas + permitidas
```

## Qué está cubierto vs. qué falta

- ✅ **Plan**: matriz de 180 escenarios en [`playwright-test-plan.md`](./playwright-test-plan.md) (E001–E180), con suites, prioridades P0/P1/P2, riesgos. **Suposiciones abiertas (§8.5) resueltas contra el código el 2026-08-11** — destacadas: el seller SÍ puede crear clientes (inline en venta), cancelar venta SÍ repone stock, la unicidad de organización es por NIT (no name), y `generatePurchaseNumber` tiene un candidato a bug cross-tenant.
- ✅ **Seed idempotente** completa todas las entidades listadas en §5 del plan.
- ✅ **Infraestructura Playwright** lista (config + globalSetup + fixtures).
- ✅ **Specs P0 escritos**: `auth.smoke.spec.ts` (E001, E002, E006), `navigation-rbac.smoke.spec.ts` (E158–E173 para seller).
- 🔲 **Resto de specs** (P1 / P2): implementar incrementalmente siguiendo el plan — un `.spec.ts` por suite listada en §4 del plan. Helpers reutilizables: `CrudPageActions<T>` y `SaleActions` sugeridos en §2.3.

## Troubleshooting

- **`corepack pnpm` no encontrado**: ensure `corepack` is in PATH (vino con Node). `corepack --version` debería responder.
- **El stack no responde en :3000**: revisá `docker compose ps` y `docker compose logs client`. La primera vez tarda en build.
- **El seed falla con drift de Prisma** (volumen persistente en otro schema): `docker compose down -v` y rehacé.
- **`pnpm add` falla con `xlsx@^0.20.3`**: la versión no existe en npm (latest es `0.18.5`). El `pnpm install` funciona por el lockfile existente, pero `pnpm add`/`update` no. Pendiente de fix en el `package.json` del client (cambiar `xlsx` a `^0.18.5`).
- **Lockout accidental de admin/seller durante tests**: los specs de lockout usan `lock@pos.test` dedicado. No dispare lockout con los creds reales admin/seller.

## Convención de specs

- Un spec por módulo del plan, siguiendo el mapeo §4 (auth.spec.ts, sales.spec.ts, etc.).
- Specs de mutación de la misma entidad: `test.describe.configure({ mode: 'serial' })` para evitar race conditions.
- Selectores por role/label/texto (no CSS frágiles) — ver §2.6 del plan.
- Nombres de entidades test creadas con sufijo `Test-${runId}` para no colisionar con el seed.