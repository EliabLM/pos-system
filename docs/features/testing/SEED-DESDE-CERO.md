# POS desde cero con datos sintéticos

Fecha: 2026-11-15. Estado: POS-03c implementa smoke automatizado en PR; resultados de runner y revisión CTO pendientes hasta comprobar el HEAD exacto. El smoke manual separado no se ha realizado. Ver evidencia y límites en [STATUS](../../STATUS.md).

## Objetivo

El usuario confirmó que no hay datos reales ni respaldo legacy que preservar. Se sustituye el ensayo sobre dump por una instalación limpia: migraciones existentes → seed sintético → comprobación → segunda ejecución → regresión de aplicación. Esto no demuestra migración de datos históricos y no cierra automáticamente los gaps de auth/RLS.

Se conserva la historia de migraciones. No usar `db push`, no consolidar migraciones y no ejecutar `migrate reset` para este recorrido.

## Datos incluidos

- `Pos Demo Org`: dos tiendas; usuarios admin/seller y auxiliares conflict/lock/trash; categorías, marcas, unidades, medios de pago, proveedores y clientes; siete productos con stock normal/bajo/cero, inactivo y borrado; una venta PAID con pago/movimientos y una compra PENDING.
- `Pos Isolation Org`: tienda, admin/seller propios, categoría, proveedor, producto y compra propios. Repite códigos/nombres intencionalmente para detectar filtros de tenant ausentes. Incluye precios con centavos para comprobar Decimal.
- IDs generados por UUIDv7. No son fijos entre ejecuciones; resolverlos por claves de fixture o consulta.
- Contraseñas de desarrollo existentes: `admin@pos.test` y `admin.isolation@pos.test` usan `Admin123!`; seller y seller.isolation usan `Seller123!`. Son fixtures públicos, nunca cuentas de producción.

## Arranque aislado autorizado (PC o runner temporal)

**Solo en un equipo/runner autorizado**, con Node 22, pnpm 10.7.1, Docker/Compose y Chromium disponibles; nunca en la VM compartida, producción, staging legacy, túneles o bases ajenas. Desde la raíz del checkout del commit a verificar, confirmar que `compose.seed.yml` crea exclusivamente `pos-seed`/`seed-data`, que el puerto `127.0.0.1:55432` está libre y que ese volumen está vacío. Si ya existe, **no ejecutar seed ni borrar el volumen hasta verificar que es exclusivamente sintético y autorizar su eliminación**. El guard comprueba nombre/host, no propiedad ni vaciedad de la base. No usar `db push`, `migrate reset`, `docker compose down -v` sin `-f compose.seed.yml` ni comandos contra el stack normal.

En una terminal de esta PC/runner, fijar `DATABASE_URL` y `DIRECT_URL` **al mismo destino dedicado**, solo de esta sesión. Sustituir `<clave-local-de-compose>` por el valor sintético local de `compose.seed.yml`, no por credenciales reales; no registrar la URL completa ni secretos en logs/capturas:

```bash
docker compose -f compose.seed.yml up -d --wait seed-db
export DATABASE_URL='postgresql://pos:<clave-local-de-compose>@127.0.0.1:55432/pos_seed?schema=public'
export DIRECT_URL="$DATABASE_URL"
export POS_SEED_ALLOW_RESET=1
export JWT_SECRET="$(openssl rand -hex 32)" # sintético de esta sesión; no imprimir
export HTTPS_ENABLED=false
export E2E_BASE_URL=http://127.0.0.1:3000

# Respeta los dos lockfiles: workspace raíz y client independiente.
pnpm install --frozen-lockfile
pnpm -C pos-system-client install --ignore-workspace --frozen-lockfile
pnpm --filter @pos/server db:deploy
pnpm -C pos-system-client --ignore-workspace db:generate
pnpm -C pos-system-client --ignore-workspace test:seed:guard
pnpm -C pos-system-client --ignore-workspace db:seed
pnpm -C pos-system-client --ignore-workspace db:seed:verify
pnpm -C pos-system-client --ignore-workspace db:seed
pnpm -C pos-system-client --ignore-workspace db:seed:verify
```

Registrar commit, versión de PostgreSQL, resultado de `db:deploy`, salida/resumen de **cada** `db:seed:verify` y fallo si lo hay. Las verificaciones deben pasar en ambas cargas con las mismas cantidades y relaciones, sin duplicados; los UUIDv7 cambian entre cargas. No ejecutar dos semillas simultáneas. `test:seed:guard` verifica reglas sin hacer un reemplazo real; **no** equivale a probar rechazo sin consentimiento contra la BD ni rollback inyectado.

En PowerShell, establecer variables con `$env:DATABASE_URL = 'postgresql://pos:<clave-local-de-compose>@127.0.0.1:55432/pos_seed?schema=public'`, `$env:DIRECT_URL = $env:DATABASE_URL` y `$env:POS_SEED_ALLOW_RESET = '1'`. Después ejecutar los comandos pnpm equivalentes. La URL de ejemplo es una plantilla, no una contraseña válida.

El compose usa proyecto/volumen `pos-seed` y puerto **127.0.0.1:55432**. No reutiliza `pgdata` del stack normal. Para volver al trabajo normal, retirar las variables del seed de todas las sesiones.

El seed es un **reemplazo completo**, no un upsert de datos del usuario: requiere `POS_SEED_ALLOW_RESET=1`, rechaza NODE_ENV=production y destinos fuera de una lista local restringida de DB de desarrollo (`pos`, `pos_seed`, `pos_test`, schema public). La lista permite el stack local anterior `db/pos`; no convierte cualquier localhost en una base segura si se usan túneles o un destino ajeno. Usar el compose dedicado para este recorrido.

El borrado y la carga comparten una transacción: al fallar no debe quedar una base parcialmente sembrada. No ejecutar dos seeds ni pruebas que muten la base simultáneamente.

## Comprobaciones

`db:seed:verify` comprueba dos organizaciones, tres tiendas, siete usuarios/memberships, ocho productos, dos compras y una venta; memberships y defaultStore coherentes por tenant; hashes de contraseñas; UUIDv7/slugs; códigos repetidos entre tenants; centavos exactos; totales de compra/venta/pago y stock base. Es una comprobación de fixtures, no de autorización HTTP ni de RLS efectivo.

### Smoke de aplicación sobre la misma base

`compose.seed.yml` **solo** levanta PostgreSQL; no arranca Next. Mantener las variables `DATABASE_URL`/`DIRECT_URL` de arriba en **la terminal de build, la de la app y la de Playwright**; si son terminales distintas, exportarlas de nuevo con el mismo valor (sin pegarlas en el informe). Usar `JWT_SECRET` sintético exclusivo de esta ejecución (longitud válida), `HTTPS_ENABLED=false` y `E2E_BASE_URL=http://127.0.0.1:3000`; no apuntar la app a otro `.env` o DB del stack habitual. Desde la raíz, tras la segunda verificación, ejecutar secuencialmente:

```bash
pnpm -r --filter './packages/*' build
(cd pos-system-client && pnpm --ignore-workspace lint && pnpm --ignore-workspace build)
(cd pos-system-client && pnpm --ignore-workspace exec playwright install chromium)
# En otra terminal con LAS MISMAS variables, dejar Next activo hasta terminar las pruebas:
(cd pos-system-client && pnpm --ignore-workspace start)
# En la terminal de pruebas: esperar HTTP 200 en http://127.0.0.1:3000/auth/login
E2E_SKIP_SEED=1 pnpm -C pos-system-client --ignore-workspace test:e2e --project=chromium --grep='P0' --workers=1
```

Antes de lanzar Playwright, comprobar por separado que Next y el proceso de pruebas apuntan a `pos_seed` en `127.0.0.1:55432` (sin imprimir la clave) y que `/auth/login` responde 200. `E2E_SKIP_SEED=1` evita que `globalSetup` reemplace la segunda carga; `POS_SEED_ALLOW_RESET=1` sigue siendo necesario para las dos cargas **previas**. No ejecutar tests y seed en paralelo. La suite P0 incluye registro con `name`/sesión, compra y recepción con stock/movimiento, y rechazo de una compra de A manipulando el proveedor de B; comprobar conteos de compras A/B, movimientos y stock B **antes y después** sin cambios en el caso negativo (aserciones de `e2e/regresion-p0.spec.ts`). Como smoke operado por una persona, además entrar en la app con admin de cada organización en sesiones separadas, comprobar que cada lista de compras muestra sus propios datos y observar el flujo de compra/recepción de A; para el rechazo de un ID de B y la ausencia de escrituras, usar el P0 automatizado anterior, ya que la UI normal no expone ese argumento manipulado. Registrar evidencia separada para observaciones manuales y aserciones automatizadas. En caso de error, guardar resultado y trazas sin secretos; no declarar verde por una mera respuesta visual.

El seed/verificador solo acredita fixtures; estas pruebas P0 acreditan **autorización de aplicación** frente a la BD de prueba, no RLS efectivo. El cliente usa el owner de las tablas: no se ha probado `FORCE ROW LEVEL SECURITY`, rol non-owner ni `SET LOCAL app.tenant_id`. Los tests de guard y el rollback con fallo inyectado y preservación de IDs tienen evidencia **histórica** (STATUS, 2026-11-14), no figuran en el run verde del [PR #5](https://github.com/EliabLM/pos-system/pull/5) ([run 43665745175](https://github.com/EliabLM/pos-system/actions/runs/43665745175), HEAD `b7e114f42f0a2a59076fda9bfd4c5cab5a13efc8`) ni se deben declarar repetidos sin ejecutarlos y documentar método/resultado. Este protocolo ejecuta guard unitario, pero no prescribe inyección de fallo ni edición de scripts en este PR documental. El merge `29f98bca56ee944b5781051fa8f053e223fe5aff` no tuvo check propio.

La prioridad funcional sigue siendo probar que usuarios de una organización no pueden leer/modificar compras de la otra. FORCE RLS, runtime non-owner y modernización JWT permanecen en actividades separadas.

## Smoke CI POS-03c (GitHub Actions, PostgreSQL 17 efímero)

El job único `.github/workflows/pr-ci.yml` conserva su servicio PG17 `pos_test` y ejecuta **secuencialmente**: `pnpm install --frozen-lockfile`; `pnpm -C pos-system-client install --ignore-workspace --frozen-lockfile`; `pnpm -r --filter './packages/*' build`; `pnpm --filter @pos/server typecheck`, `test`, `lint`; `pnpm -C pos-system-client --ignore-workspace lint`, `pnpm -C pos-system-client --ignore-workspace exec tsc -p e2e/tsconfig.json`, `pnpm -C pos-system-client --ignore-workspace build`; `pnpm --filter @pos/server db:deploy`; `pnpm -C pos-system-client --ignore-workspace test:seed:guard`; `pnpm -C pos-system-client --ignore-workspace db:seed` y `db:seed:verify` **dos veces** (salidas separadas en el run); `bash scripts/ci/seed-rollback.sh`; Chromium `pnpm --ignore-workspace test:e2e --project=chromium --grep='P0' --workers=1` con `E2E_SKIP_SEED=1` y Next sobre **la misma base**; finalmente `psql "$DATABASE_URL" -X -q -v ON_ERROR_STOP=1 -f pos-system-server/scripts/db/force-rls-ci.sql` después de detener Next. El runner elimina el servicio al acabar el job; la trampa detiene Next y no se suben artifacts/trazas ni logs de Next que puedan contener sesiones. No correr este harness contra bases persistentes: exige `CI=true`, `NODE_ENV=test`, `POS_SEED_ALLOW_RESET=1`, URL local `127.0.0.1/pos_test` (schema público por defecto o `?schema=public`) idéntica a `DIRECT_URL`.

El script de rollback toma una huella estable de **todas las filas completas e IDs** de cada tabla pública con columna `id`, ordenadas por ID (conteo y digest por tabla, sin exponer valores): intenta seed sin consentimiento y comprueba igualdad; instala un trigger temporal `BEFORE DELETE` sobre `products`, fuerza error **dentro** de la fase destructiva de la transacción de seed, comprueba igualdad bit a bit de las huellas, retira el trigger y reintenta seed+verify. Si falla cualquier comparación, falla el job. La verificación existente comprueba relaciones, cuentas y duplicados tras cada carga. Los UUID cambian entre cargas deliberadamente; la igualdad de IDs solo se exige **antes/después de rollback y rechazo**.

`force-rls-ci.sql` requiere la BD `pos_test`, owner superuser del runner, policy existente `tenant_isolation`, RLS habilitado y `relforcerowsecurity=false` antes del ensayo. Dentro de **una transacción que termina en ROLLBACK**, crea rol NOLOGIN non-owner sin BYPASSRLS, le otorga acceso temporal, aplica `ALTER TABLE categories FORCE ROW LEVEL SECURITY`, comprueba FORCE y el rol, sin tenant (0 filas), tenant A (3 categorías), tenant B (1), y deniega INSERT A→B; después verifica FORCE desactivado, rol eliminado y ausencia de fila extra. No cambia migraciones ni activa FORCE en Next: el owner superuser del servicio **puede eludir FORCE**, y el client no configura `app.tenant_id`; esto no acredita protección RLS en runtime. JWT/SET LOCAL y runtime non-owner siguen pendientes de diseño Fase 2.

**Evidencia inicial:** [run 43754733134](https://github.com/EliabLM/pos-system/actions/runs/43754733134), SHA `0446f3d856bd5988648bd05a288fb165e2009394`: build/lint, migraciones, guard 2/2 y las dos verificaciones de fixtures pasaron; el harness falló ANTES del rechazo/rollback porque `PGDATABASE` no interpreta una URL y `psql` buscó un socket local. Se corrigió para pasar la URL directamente a `psql`; no se atribuye rollback, P0 ni FORCE a ese run. Un commit posterior debe tener su propio check exact-head; el SHA de ese HEAD no puede estar contenido en el propio commit sin cambiarlo y se registra en el PR/revisión CTO.

## Detener

Detener primero Next (Ctrl-C); luego `docker compose -f compose.seed.yml down` detiene **solo** este entorno y conserva el volumen sintético. Si la PC/runner debe quedar limpia, tras confirmar nuevamente que `pos-seed`/`seed-data` contienen **solo fixtures descartables**, usar `docker compose -f compose.seed.yml down -v` únicamente con este archivo (destruye ese volumen). Retirar `DATABASE_URL`, `DIRECT_URL`, `POS_SEED_ALLOW_RESET`, `JWT_SECRET` y `E2E_SKIP_SEED` de las terminales; no guardar credenciales ni logs con URL completa. Documentar commit, entorno, pasos/resultado y limpieza. No borrar volúmenes de otros proyectos.
