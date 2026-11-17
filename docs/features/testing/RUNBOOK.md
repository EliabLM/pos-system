# Runbook — Pruebas E2E (Playwright) del POS

> **Cómo correr la suite E2E** contra el stack local `docker compose up`.
>
> **Plan completo (180 escenarios E001–E180)**: ver [`playwright-test-plan.md`](./playwright-test-plan.md).
>
> **Fecha:** 2026-08-11 · **Estado:** ✅ Smoke P0 verde end-to-end contra el stack docker (17/17, 2 corridas estables) · Specs P1/P2 por implementar incrementalmente.

## Requisitos

1. **Docker** levantando `db` (Postgres 17) + `client` (Next.js). Ver [`../../deployment/docker-local.md`](../../deployment/docker-local.md).
2. **Node 22+** y **pnpm 10.7.1** (vía `corepack pnpm`).
3. Desde el directorio `pos-system-client/`:
   ```bash
   corepack pnpm install
   corepack pnpm exec playwright install chromium
   ```
4. **No hace falta `.env` en el client para la suite**: `globalSetup` inyecta `DATABASE_URL`/`DIRECT_URL` con default a la DB del compose (`postgresql://pos:pos@localhost:5432/pos`) al correr el seed. Para apuntar a otra DB, exportá esas variables antes de `POS_SEED_ALLOW_RESET=1 pnpm test:e2e`. Si corrés `POS_SEED_ALLOW_RESET=1 pnpm db:seed` a mano (fuera de la suite), sí tenés que pasarlas inline:
   ```bash
   DATABASE_URL="postgresql://pos:pos@localhost:5432/pos" DIRECT_URL="postgresql://pos:pos@localhost:5432/pos" corepack POS_SEED_ALLOW_RESET=1 pnpm db:seed
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
DATABASE_URL="postgresql://pos:pos@localhost:5432/pos" DIRECT_URL="postgresql://pos:pos@localhost:5432/pos" corepack POS_SEED_ALLOW_RESET=1 pnpm db:seed

# 4. Correr la suite
corepack POS_SEED_ALLOW_RESET=1 pnpm test:e2e                    # headless, sirve para CI
corepack POS_SEED_ALLOW_RESET=1 pnpm test:e2e:ui                 # mode UI (Inspector + watch)
corepack POS_SEED_ALLOW_RESET=1 pnpm test:e2e:debug              #uncia test en modo debug
corepack POS_SEED_ALLOW_RESET=1 pnpm test:e2e:report             # abrir último reporte HTML

# 5. Iterar sin reseed entre corridas (mantiene estado para debug manual)
E2E_SKIP_SEED=1 corepack POS_SEED_ALLOW_RESET=1 pnpm test:e2e
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
│   └── seed.ts            # seed idempotente (POS_SEED_ALLOW_RESET=1 pnpm db:seed)
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
- **Lockout accidental de admin/seller durante tests**: los specs de lockout usan `lock@pos.test` dedicado. No dispare lockout con los creds reales admin/seller.
- **El seed falla con `P2021 table does not exist` en tablas de auth**: la imagen del **server** aplica `migrate deploy` al arrancar (dueño del schema desde Fase 1; antes lo hacía el client); asegurate de tener la migración `20260811000000_migrate_auth_clerk_to_custom_jwt` en `pos-system-server/prisma/migrations/` (generada el 2026-08-11 — el schema de auth se había aplicado con `db push` sin archivos de migración). Rebuild + `docker compose down -v` + up.
- **Timeouts flaky de login con tests en paralelo**: la config fija `workers: 1` en local a propósito — la app corre en un solo contenedor y los logins concurrentes (bcrypt cost 12) degradan hasta el timeout. No subir workers sin medir.
- **`getByLabel(/contraseña/i)` matchea 2 elementos**: el botón de mostrar/ocultar tiene `aria-label="Mostrar contraseña"`. Usar el regex anclado `/^contraseña$/i` (así está en `fixtures/auth.ts`).
- **`context().cookies(...)` recibe URLs, no nombres de cookie**: pedir todas con `cookies()` y filtrar por `c.name === 'auth-token'`.

## Convención de specs

- Un spec por módulo del plan, siguiendo el mapeo §4 (auth.spec.ts, sales.spec.ts, etc.).
- Specs de mutación de la misma entidad: `test.describe.configure({ mode: 'serial' })` para evitar race conditions.
- Selectores por role/label/texto (no CSS frágiles) — ver §2.6 del plan.
- Nombres de entidades test creadas con sufijo `Test-${runId}` para no colisionar con el seed.


## CI de pull request (POS-06a)

`.github/workflows/pr-ci.yml` se dispara ante PR hacia `main` en `ubuntu-latest` (GitHub-hosted, Node 22, Corepack pnpm 10.7.1). Instala raíz y cliente **por separado** con `--frozen-lockfile` (`--ignore-workspace` para el cliente), genera Prisma desde `pos-system-server/prisma/schema.prisma`, construye paquetes, verifica typecheck/test/lint del server y lint/build del cliente. `vitest list --json` y `playwright test --list --reporter=json --grep=P0` tienen guard que falla si el conteo es cero.

El servicio PostgreSQL 17 `pos_test` vive solamente durante el job; `DATABASE_URL` y `DIRECT_URL` apuntan a `127.0.0.1`, con usuario/contraseña **sintéticos de CI**. `migrate deploy` del server precede al seed de dos organizaciones. Solo el paso de seed recibe `NODE_ENV=test` y `POS_SEED_ALLOW_RESET=1`; Playwright usa `E2E_SKIP_SEED=1` tras verificar seed, sin reset adicional. Next se construye/arranca exclusivamente en el runner, espera `/auth/login`, corre Chromium P0 con 1 worker, mata el proceso al salir y conserva resultados, trazas y logs al fallar (7 días). No cambiar las URLs por bases externas ni reutilizar el seed con datos reales.

Los 17 smoke existentes prueban login/credenciales inválidas, cookie y navegación RBAC; `regresion-p0.spec.ts` agrega registro UI con `name` + identidad/sesión en BD, compra/recepción UI con stock y movimiento verificados en BD, y manipulación del argumento de proveedor de A por el ID de B en el POST real de la acción Next, con error y comparación de conteos de compras/movimientos/stock antes y después. Este último valida **autorización de aplicación**: el cliente conecta como owner y no prueba `FORCE ROW LEVEL SECURITY` (diferido). Si falta fixture, aserción o descubrimiento de tests, el job falla. [PR #5, run 43665310757](https://github.com/EliabLM/pos-system/actions/runs/43665310757): check verde, Vitest 3/3 y Playwright Chromium 20/20 contra PostgreSQL 17 efímero; lint/build cliente, typecheck/test/lint server, migraciones y seed pasaron. Lint cliente conserva 3 warnings previos (0 errores). En la VM compartida no se corrió Next build ni Playwright/BD por ADR-014; el smoke **manual** de instalación limpia de app/BD sigue pendiente donde se disponga de stack aislado. POS-03 no se declara cerrado.



## Instalación limpia y segundo tenant (2026-11-14)

Ver [SEED-DESDE-CERO.md](./SEED-DESDE-CERO.md). Se requiere confirmación explícita `POS_SEED_ALLOW_RESET=1` para el reseed automático de Playwright. El seed conserva los fixtures originales y añade `Pos Isolation Org`, con admin/seller de aislamiento y datos propios. No ejecutar contra bases con datos de usuario.
