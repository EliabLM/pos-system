# POS desde cero con datos sintéticos

Fecha: 2026-11-14. Estado: mecanismo implementado; ver evidencia de validación en STATUS.

## Objetivo

El usuario confirmó que no hay datos reales ni respaldo legacy que preservar. Se sustituye el ensayo sobre dump por una instalación limpia: migraciones existentes → seed sintético → comprobación → segunda ejecución → regresión de aplicación. Esto no demuestra migración de datos históricos y no cierra automáticamente los gaps de auth/RLS.

Se conserva la historia de migraciones. No usar `db push`, no consolidar migraciones y no ejecutar `migrate reset` para este recorrido.

## Datos incluidos

- `Pos Demo Org`: dos tiendas; usuarios admin/seller y auxiliares conflict/lock/trash; categorías, marcas, unidades, medios de pago, proveedores y clientes; siete productos con stock normal/bajo/cero, inactivo y borrado; una venta PAID con pago/movimientos y una compra PENDING.
- `Pos Isolation Org`: tienda, admin/seller propios, categoría, proveedor, producto y compra propios. Repite códigos/nombres intencionalmente para detectar filtros de tenant ausentes. Incluye precios con centavos para comprobar Decimal.
- IDs generados por UUIDv7. No son fijos entre ejecuciones; resolverlos por claves de fixture o consulta.
- Contraseñas de desarrollo existentes: `admin@pos.test` y `admin.isolation@pos.test` usan `Admin123!`; seller y seller.isolation usan `Seller123!`. Son fixtures públicos, nunca cuentas de producción.

## Arranque en PC personal

Desde la raíz del repo, con Docker y pnpm 10.7.1 disponibles:

```bash
docker compose -f compose.seed.yml up -d --wait seed-db
export DATABASE_URL='postgresql://pos:pos@127.0.0.1:55432/pos_seed?schema=public'
export DIRECT_URL="$DATABASE_URL"
export POS_SEED_ALLOW_RESET=1

# Respeta los dos lockfiles: workspace raíz y client independiente.
pnpm install --frozen-lockfile
pnpm -C pos-system-client install --frozen-lockfile
pnpm --filter @pos/server db:deploy
pnpm -C pos-system-client db:generate
pnpm -C pos-system-client test:seed:guard
pnpm -C pos-system-client db:seed
pnpm -C pos-system-client db:seed:verify
pnpm -C pos-system-client db:seed
pnpm -C pos-system-client db:seed:verify
```

En PowerShell, establecer variables con `$env:DATABASE_URL = '...'`, `$env:DIRECT_URL = $env:DATABASE_URL` y `$env:POS_SEED_ALLOW_RESET = '1'`. Después ejecutar los mismos comandos pnpm.

El compose usa proyecto/volumen `pos-seed` y puerto **127.0.0.1:55432**. No reutiliza `pgdata` del stack normal. Las contraseñas `pos` son únicamente para esta base local de pruebas. Para volver al trabajo normal, retirar las variables del seed de la sesión.

El seed es un **reemplazo completo**, no un upsert de datos del usuario: requiere `POS_SEED_ALLOW_RESET=1`, rechaza NODE_ENV=production y destinos fuera de una lista local restringida de DB de desarrollo (`pos`, `pos_seed`, `pos_test`, schema public). La lista permite el stack local anterior `db/pos`; no convierte cualquier localhost en una base segura si se usan túneles o un destino ajeno. Usar el compose dedicado para este recorrido.

El borrado y la carga comparten una transacción: al fallar no debe quedar una base parcialmente sembrada. No ejecutar dos seeds ni pruebas que muten la base simultáneamente.

## Comprobaciones

`db:seed:verify` comprueba dos organizaciones, tres tiendas, siete usuarios/memberships, ocho productos, dos compras y una venta; memberships y defaultStore coherentes por tenant; hashes de contraseñas; UUIDv7/slugs; códigos repetidos entre tenants; centavos exactos; totales de compra/venta/pago y stock base. Es una comprobación de fixtures, no de autorización HTTP ni de RLS efectivo.

Después ejecutar build/lint y Playwright contra una app apuntada a esta misma base (no basta cambiar DATABASE_URL del proceso de tests si la app usa otro destino). No se levanta ni configura la app automáticamente con este compose. Para E2E, `POS_SEED_ALLOW_RESET=1` también debe estar presente; `E2E_SKIP_SEED=1` omite la carga cuando se requiere conservar estado para diagnosticar.

La prioridad funcional sigue siendo probar que usuarios de una organización no pueden leer/modificar compras de la otra. FORCE RLS, runtime non-owner y modernización JWT permanecen en actividades separadas.

## Detener

`docker compose -f compose.seed.yml down` detiene el entorno y conserva su volumen sintético. Una nueva ejecución del seed reemplaza esos fixtures. No borrar volúmenes de otros proyectos para repetir la prueba.
