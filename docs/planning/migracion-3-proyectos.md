# Plan de Migración a 3 Proyectos

> Migración del monolito `pos-system-client` (Next.js 15 + Prisma + server actions) hacia **3 proyectos**: `pos-system-server` (Node + Express + TS, Clean Architecture), `pos-system-app` (React Native + Expo), y `pos-system-client` (Next.js, solo UI que consume la API).

## Decisiones estratégicas (confirmar antes de la Fase 0)

### D1 — Monorepo con pnpm workspaces (recomendado) vs repos separados

**Recomendado: monorepo.** Los 3 proyectos ya conviven en el workspace padre; un solo lockfile, packages compartidos (`design-tokens`, `api-client`, `dto-types`), y refactors cross-project atomicable en un commit.

Tradeoff: un repo más grande y una sola historia git compartida. Alternativa (repos separados) fuerza versionado manual de packages compartidos y CI por repo.

> Acción requerida: si se acepta el monorepo, el **repo padre debe convertirse en repo git** (hoy no lo es; solo `pos-system-client` lo es). Decisión previa a Fase 0.

### D2 — Migración incremental tipo "strangler fig" (recomendado) vs big-bang

**Recomendado: incremental.** El cliente sigue en producción mientras migramos módulo por módulo. Cada módulo migrado → el cliente deja de llamar esa server action y empieza a llamar la API; la action se elimina. Reversible módulo a módulo.

Tradeoff: coexistencia temporal de server actions + API HTTP durante la transición (complejidad operacional). Alternativa (big-bang) requiere reescribir todo en paralelo y lanzar de golpe — más riesgo, ventana de downtime, sin rollback parcial.

### D3 — Auth: custom JWT + gaps cerrados (vs IdP externo)

**Decidido: mantener custom JWT y cerrar gaps.** Re-evaluar **Better Auth** en Fase 2 como abort-condition (trepar si aparece MFA regulatoria, passkey, SSO federado, multi-org federada o SCIM). Schema target ya alineado con Better Auth → migración barata si se dispara.

Ver [`auth/AUTH_TARGET_SCHEMA.md`](../auth/AUTH_TARGET_SCHEMA.md) para el detalle: decisiones D3.1–D3.10, schema Prisma target, claim shape JWT, rotación de refresh + reuse detection, gaps pendientes.

Descartados: Keycloak (multi-tenant natural es realm por org, no encaja), Clerk (ya migrado fuera, cloud), Auth0 (cloud, choca con self-hosted + offline mobile).

Resumen de impacto:
- **Fase 1**: crea `memberships`, `verifications`, `accounts` (skeleton), reestructura `users`, `sessions`, `audit_logs`; añade `slug` a `organizations` — ver Receta R6.
- **Fase 2**: módulo auth con EdDSA, refresh rotation, stateful session check, jti/sid/ver, account lockout, flows unificados en `verifications`.

---

## Inventario actual (lo que hay que partir)

| Capa | Cantidad | Ubicación |
|------|----------|-----------|
| Modelos Prisma | 21 | `pos-system-client/prisma/schema.prisma` |
| Server actions | 21 (1:1 con modelos) | `pos-system-client/src/actions/<entity>/` |
| Hooks TanStack Query | 23 | `pos-system-client/src/hooks/use*.ts` |
| Rutas dashboard | 17 | `pos-system-client/src/app/dashboard/<entity>/` |
| Auth lib | 8 archivos | `pos-system-client/src/lib/auth/` (jwt, crypto, session, server, validation, authorization, types, index) |
| Reports lib | 3 archivos | `pos-system-client/src/lib/reports/` (calculations, aggregations, comparisons) |
| Export lib | 3 archivos | `pos-system-client/src/lib/export/` (pdf, excel, chart-to-image) |
| RBAC | 1 | `pos-system-client/src/lib/rbac.ts` |
| Store (Zustand) | 2 slices | `pos-system-client/src/store/slices/` (auth, login) |
| Middleware | 1 | `pos-system-client/src/middleware.ts` (verifica `auth-token` cookie con `jose`) |
| Helpers actions | 1 | `pos-system-client/src/actions/utils.ts` (`prisma` singleton, `checkAdminRole`, `checkOrgId`, `unauthorizedResponse`, `ActionResponse<T>`) |

**Convención actual de actions:** toda action retorna `ActionResponse<T> = { status, message, data }`. Auth via headers inyectados por middleware (`x-user-id`, `x-organization-id`, `x-store-id`).

**Equivalencia 1:1 modelo↔action** = la unidad natural de migración. Cada action se convierte en un módulo del server.

---

## Contrato API (define una vez, consumen client + app)

- **Base URL:** `pos-system-server` expone `/api/v1/*`.
- **Auth:** JWT en header `Authorization: Bearer <token>` (mismo secreto/algoritmo que hoy). El server decodifica y carga `AuthContext` (userId, organizationId, storeId, role).
- **Errores:** formato único JSON, mapeo desde `DomainError`:
  ```json
  { "error": { "code": "SALE_NOT_FOUND", "message": "...", "correlationId": "..." } }
  ```
  Status HTTP mapea por tipo (`ValidationError`→422, `NotFound`→404, `Conflict`→409, `Unauthorized`→401, `Forbidden`→403, errores no-domain → 5xx con mensaje genérico).
- **IDs:** UUIDv7 en todas las entidades. Las APIs aceptan y devuelven UUIDs en string.
- **Tenant:** el server setea `SET LOCAL app.tenant_id` por request (RLS). El client/app no necesita enviar el tenant en el body — va en el JWT.
- **DTOs compartidos:** types de request/response viven en un package `packages/dto-types` consumido por client, server y app. Una sola fuente de verdad.
- **Documentación:** OpenAPI generado desde los schemas (Zod → `zod-to-openapi` o equivalente).

---

## Diagrama del estado final

```
pos-system/  (repo git, monorepo pnpm workspaces)
├── packages/
│   ├── dto-types/         # DTOs compartidos server/client/app
│   ├── design-tokens/     # tokens UI compartidos web + app
│   └── api-client/        # cliente HTTP tipado (client + app lo usan)
├── pos-system-server/     # Node 22 + Express + TS + Clean Arch
│   ├── prisma/schema.prisma
│   ├── src/
│   │   ├── modules/<entity>/{domain,use-cases,adapters}
│   │   ├── shared/domain/   # DomainError, Result, Value Objects
│   │   └── config/
│   └── tests/              # unit (usecases) + integration (adapters) + e2e (supertest)
├── pos-system-client/     # Next.js, solo UI
│   └── src/
│       ├── app/dashboard/<entity>/   # páginas (sin actions)
│       ├── hooks/use*.ts             # TanStack Query → api-client
│       └── store/, lib/              # UI-only
└── pos-system-app/       # React Native + Expo
    ├── app/               # expo-router
    └── src/{features,data,store,persistence,ui}
```

---

## Fases

### Fase 0 — Preparación del workspace

1. Convertir el repo padre en repo git (si D1 = monorepo confirmado).
2. `pnpm-workspace.yaml` en la raíz listando `pos-system-*` y `packages/*`.
3. Scaffolding de `pos-system-server/` (Express + TS + ESLint strict + Vitest + Pino + Helmet + express-rate-limit) y `pos-system-app/` (Expo + expo-router + TS strict), vacíos pero buildables.
4. Crear `packages/dto-types/`, `packages/api-client/`, `packages/design-tokens/` (stubs).
5. CI: lint + typecheck + test por proyecto; `pnpm install --frozen-lockfile`.
6. **Definition of done:** `pnpm -r build` verde en los 3 proyectos vacíos + packages.

### Fase 1 — DB foundation (la base sobre la que se construye todo)

1. Mover `prisma/schema.prisma` del client al server. El client deja de ser dueño del schema.
2. Aplicar los **targets de la skill `postgresql-table-design`**:
   - IDs `cuid` → `UUID` v7 (ver Receta cuid→UUIDv7 abajo; mapeo bridge en `legacy_id_map`).
   - `Float` → `Decimal` en `subtotal`/`total`/`amount` (ver Receta Float→Decimal).
   - Identificadores snake_case vía `@map`.
   - Soft-delete uniqueness → índice único parcial `WHERE deleted_at IS NULL` (reemplazar `@@unique([…, deletedAt])`).
   - `updated_at` trigger `BEFORE UPDATE`.
   - **RLS** habilitado en toda tabla tenant-scoped + `FORCE ROW LEVEL SECURITY` + role non-owner para la API. Cross-tenant superadmin vía role/policy aparte.
   - Índices con `organization_id` como leading column; FK indexes explícitos.
3. Aplicar el **schema auth target** (ver [`auth/AUTH_TARGET_SCHEMA.md`](../auth/AUTH_TARGET_SCHEMA.md)):
   - `users`: pierde `organizationId`, `storeId`, `username`, `firstName`, `lastName`, `password`; gana `name`, `image`, `passwordHash` (nullable), email unique parcial.
   - Nueva `memberships` (user↔org + role + defaultStore + status + invitedBy).
   - Mergear `password_resets` + `email_verifications` → `verifications` (ver Receta R6).
   - Nueva `accounts` skeleton (OAuth/passkey/credential, sin datos todavía).
   - `sessions`: añade `refreshTokenHash`, `rotatedFrom`.
   - `audit_logs`: reestructura `actorUserId`, `targetType`, `targetId`, `storeId`, `correlationId`.
   - `organizations`: añade `slug` único global (ver Receta R7 para slug generation).
   - Migración de datos legacy → nuevo shape (ver Receta R6 paso a paso).
4. Migración de datos existentes (ver Recetas R1, R2, R6, R7).
5. Prisma client genera ahora en `pos-system-server/src/generated/prisma`.
6. **Definition of done:** migración aplica limpia sobre un dump de prod; `prisma migrate deploy` verde; tests de RLS prueban que un tenant no ve filas de otro; schema auth target matchea [`auth/AUTH_TARGET_SCHEMA.md`](../auth/AUTH_TARGET_SCHEMA.md).

### Fase 2 — Auth + tenant surface (el primer módulo server)

Primer módulo del server — define los patrones que copiarán los demás. Migrar `lib/auth/` + actions de `auth/`, `organization/`, `store/`, `user/`, `session/`.

El schema auth target ya quedó en Fase 1 (ver [`auth/AUTH_TARGET_SCHEMA.md`](../auth/AUTH_TARGET_SCHEMA.md)). Esta fase cierra los gaps del custom JWT.

1. `shared/domain/`: `DomainError` + subclases, `Result<T>`, value objects (`TenantId`, `UserId`).
2. `modules/auth/`: dominio + usecases (login, logout, refresh, verify, request-password-reset, reset-password, verify-email) + adapters (HTTP controller, `JwtAdapter` EdDSA, `BcryptAdapter`, `PrismaUserRepository`, `PrismaSessionRepository`).
3. Composition root en `server.ts`: wire ports→adapters, registar error-handling middleware, helmet, rate-limit, pino-http, req-id.
4. **Cerrar gaps del custom JWT** (ver [`auth/AUTH_TARGET_SCHEMA.md`](../auth/AUTH_TARGET_SCHEMA.md) § gaps):
   - Algoritmo **HS256 → EdDSA (Ed25519)** con par de claves rotable (`AUTH_PRIVATE_KEY`, `AUTH_PUBLIC_KEY`, `AUTH_KEY_ID`). Migración gradual: middleware acepta both HS256 y EdDSA por un período; ver Receta R8.
   - Access token **15 min** + refresh token **30 días** con **rotación + reuse detection** (ver Receta R8).
   - Claim shape con `jti`, `sid`, `ver` (bump invalida tokens viejos). `sid` habilita revocación stateful contra `sessions.isActive`.
   - **Stateful session check** cacheado 30s en middleware (`lru-cache`). Cache invalidado en `/auth/logout` y `/auth/logout-all`.
   - **Account lockout** enforced en login usecase (5 intentos → lock 15 min, exponencial).
   - **Email verification + password reset** unificados en `verifications` (flows completos end-to-end).
   - **Rate-limit** `/auth/login` y `/auth/refresh` con `express-rate-limit`.
5. Middleware Express: decodifica JWT (EdDSA o HS256 legacy) → carga `AuthContext` → el adapter de persistencia hace `SET LOCAL app.tenant_id = <org>` dentro de la tx por request.
6. Endpoints: `POST /api/v1/auth/login`, `POST /auth/logout`, `POST /auth/logout-all`, `POST /auth/refresh`, `GET /auth/me`, `POST /auth/request-password-reset`, `POST /auth/reset-password`, `POST /auth/verify-email`.
7. El **cliente** cambia su auth para consumir la API: el middleware de Next.js sigue manejando la cookie, pero el login/refresh ahora llama la API. Server actions de auth se eliminan.
8. **Abort-condition check:** si en este punto apareció MFA/passkey/SSO/SCIM/multi-org federada, **detener** y migrar a Better Auth (schema ya alineado → costo mínimo). Registrar la decisión en [`auth/AUTH_TARGET_SCHEMA.md`](../auth/AUTH_TARGET_SCHEMA.md).
9. **Definition of done:** login fluye client→API→DB con RLS; refresh rotation con reuse detection verde; tests e2e de auth (supertest) verde; cliente hace login contra la API y la sesión persiste; lockout y rate-limit verificados.

### Fase 3 — Extracción módulo por módulo (strangler fig)

Orden topológico respetando dependencias FK. Para cada módulo:

1. **Server:** crear `modules/<entity>/{domain, use-cases, adapters}` + endpoints REST. Tests unit (usecases con repo in-memory) + integration (Prisma) + e2e (supertest).
2. **`packages/dto-types`:** agregar DTOs del módulo.
3. **`packages/api-client`:** agregar métodos tipados.
4. **Cliente:** el hook `use<Entity>.ts` deja de llamar la server action y usa `api-client`. La action del client se **elimina**. La página `app/dashboard/<entity>/` no cambia (sigue consumiendo el hook).
5. **Documentación:** actualizar `docs/` si el módulo tiene feature doc.
6. **Definition of done por módulo:** tests server verde, hook migrado, action eliminada, `pnpm build` verde en client y server, smoke test manual del flujo.

Orden recomendado (dependencias antes que dependientes):

```
1. SystemConfig      6. Customer           11. SalePayment
2. UnitMeasure       7. Supplier           12. Purchase
3. Category          8. PaymentMethod      13. PurchaseItem
4. Brand             9. Sale               14. StockMovement
5. Product          10. SaleItem           15. Reports (read-side, sin dominio nuevo)
```

`Reports` va último: es read-side, agrega sobre los datos de todos los demás. La lógica de `lib/reports/` y `lib/export/` se mueve al server (cálculos) o queda en client (presentación PDF/Excel — evaluar caso a caso).

### Fase 4 — App móvil scaffold

1. Scaffold `pos-system-app/` (Expo + expo-router + TS strict + EAS).
2. Auth (consume la API de Fase 2; tokens en `expo-secure-store`).
3. Sync layer: `expo-sqlite` como libro de eventos offline + idempotency keys + reconciliación.
4. Primer feature: **sales + barcode scanner** (mayor valor de negocio para un POS móvil). Ver skill `react-native-expo`.
5. **Definition of done:** login offline-aware, scanner funcional en dev build (Android + iOS), venta creada offline se sincroniza al reconectar.

### Fase 5 — Cleanup

1. Eliminar del cliente: `src/actions/` completo, `prisma/`, `src/lib/auth/`, `src/middleware.ts` (o reemplazar por uno que solo redirige si no hay cookie), `src/generated/`.
2. Mover `lib/rbac.ts` al server si no quedó. `lib/reports/export` queda en client si es solo presentación.
3. Actualizar `pos-system-client/AGENTS.md`: ya no hay Prisma ni server actions; el cliente es UI-only que consume `@pos/api-client`.
4. Actualizar `docs/STATUS.md`: migración completada.
5. **Definition of done:** cliente sin `@prisma/client` en dependencies; `pnpm build` verde en los 3 proyectos; ningún import a `@/generated/prisma` sobrevive.

---

## Recetas para los riesgos duros

### R1 — cuid → UUIDv7 (data migration con datos existentes)

Los `cuid` actuales son strings, no UUIDs. No se pueden "convertir" — hay que **generar UUIDv7 nuevos** y mantener un mapeo.

1. Crear tabla `legacy_id_map (entity TEXT, legacy_id TEXT, new_uuid UUID)`.
2. Script de migración: por cada fila, generar UUIDv7, actualizar PK + todas las FKs que la referencian (cascada manual), insertar en `legacy_id_map`.
3. Durante un período de transición, la API acepta UUID nuevo; si llega un cuid legacy (client viejo), lookup en `legacy_id_map` y mapear. Tras Fase 5, eliminar la tolerancia.
4. Hacer sobre un dump de prod en staging primero; medir tiempo (tablas grandes = ventas).

### R2 — Float → Decimal (redondeo al migrar)

Floats binarios guardan valores como `0.1` de forma imprecisa. Al convertir a `NUMERIC(12,2)`, redondear explícitamente: `ROUND(subtotal::numeric, 2)`. Documentar que valores "se veían bien" pero eran `0.10000000001` se redondean — es el comportamiento correcto, no pérdida.

Ejecutar una pasada de auditoría pre-migración: `SELECT id, subtotal, subtotal::numeric(12,2) AS rounded FROM sale_item WHERE subtotal != subtotal::numeric(12,2)` para dimensionar el impacto.

### R3 — RLS: role non-owner es mandatorio

El superuser y el owner de la tabla bypasean RLS por default. Si la API se conecta como owner, **RLS no hace nada** — silenciosamente inactivo.

1. Crear role `pos_app` non-owner con grants mínimos (SELECT/INSERT/UPDATE/DELETE en tablas de negocio).
2. `ALTER TABLE <cada tabla tenant> FORCE ROW LEVEL SECURITY`.
3. La API se conecta con `pos_app`. Migrations las corre un role separado `pos_migrator` (owner) — fuera del runtime.
4. Queries cross-tenant (reports superadmin): role `pos_admin` con política que permite ver todo si `current_setting('app.is_superadmin')::boolean`.
5. Tests de RLS: dos tenants, query sin filtro explícito, afirmar que cada uno ve solo sus filas.

### R4 — Server actions → HTTP (impacto en el cliente)

Las actions retornan `ActionResponse<T> = { status, message, data }`. La API retorna HTTP status + body. El `api-client` traduce:

```
HTTP 2xx → { data: body }
HTTP 4xx/5xx → throw ApiError(code, message, status)
```

Los hooks TanStack Query ya manejan throw → error state. La migración de un hook es mecánica: reemplazar `await createAction(data)` por `await apiClient.createEntity(data)`, mantener el `queryKey` y las invalidaciones. Las páginas no cambian.

### R5 — Orden topológico

Respetar el orden de Fase 3. Migrar un módulo cuyas FKs apuntan a tablas aún no migradas genera doble-work (mapear IDs legacy dos veces). SystemConfig/UnitMeasure primero (sin deps); Product después de Category/Brand/UnitMeasure; Sale después de Product/Customer/PaymentMethod/Store.

### R6 — Migración de datos auth legacy → schema target

El schema target (ver [`auth/AUTH_TARGET_SCHEMA.md`](../auth/AUTH_TARGET_SCHEMA.md)) cambia el shape de `users`, `sessions`, `audit_logs` y crea `memberships`, `verifications`, `accounts`. La migración de datos existentes se corre como SQL idempotente sobre un dump de prod en staging antes de tocar prod.

Pasos (correr en una sola transacción):

1. **`users` reshape:**
   - `password` → `passwordHash` (rename).
   - `firstName` + `lastName` → `name` = `trim(firstName || ' ' || lastName)`.
   - Drop `username`, `organizationId`, `storeId` (tras crear `memberships` y copiar referencias).
   - `email` → unique parcial `WHERE deleted_at IS NULL` (drop unique viejo `@@unique([email, deletedAt])` zuerst, crear el índice parcial).
2. **`memberships` (nueva):** poblar a partir de `users` legacy:
   ```sql
   INSERT INTO memberships (id, user_id, organization_id, role, default_store_id, status, accepted_at, created_at, updated_at)
   SELECT gen_random_uuid(), u.id, u.organization_id, u.role::text::membershiprole,
          u.store_id, 'ACTIVE', u.created_at, u.created_at, u.created_at
   FROM users u
   WHERE u.organization_id IS NOT NULL AND u.is_deleted = false;
   ```
   Para users con `organizationId IS NULL` (edge): `status = 'INVITED'`, sin org (caso raro, revisar dump).
3. **`verifications` (nueva):** meergear `password_resets` + `email_verifications`:
   ```sql
   INSERT INTO verifications (id, identifier, value_hash, type, expires_at, used, used_at, ip_address, user_agent, created_at)
   SELECT gen_random_uuid(), (SELECT email FROM users WHERE id = user_id), token, 'PASSWORD_RESET',
          expires_at, used, used_at, ip_address, user_agent, created_at
   FROM password_resets;

   INSERT INTO verifications (id, identifier, value_hash, type, expires_at, used, used_at, ip_address, user_agent, created_at)
   SELECT gen_random_uuid(), email, token, 'EMAIL_VERIFY', expires_at, verified, verified_at, ip_address, user_agent, created_at
   FROM email_verifications;
   ```
   Drop `password_resets` y `email_verifications` al final.
4. **`sessions`:** añadir `refresh_token_hash`, `rotated_from` como nullable; rename `token` → `token_hash`. Datos existentes quedan con `refresh_token_hash = NULL` (sesiones legacy sin refresh rotation; se invalidan al expirar).
5. **`audit_logs` reestructure:** rename `userId` → `actor_user_id` (sin datos loss), `entity` → `target_type`, `entity_id` → `target_id` (con cast a uuid si era cuid-string-compatible). Añadir `store_id`, `correlation_id` como nullable. Reordenar índices.
6. **`organizations` añade `slug`:** ver Receta R7.
7. **`accounts`** se crea vacía (skeleton).
8. **Verificación post-migración:**
   - Mismos users, mismo count de memberships¹org.
   - Tokens de reset/verify migrados con `type` correcto.
   - Audit logs reproducen la misma trazabilidad.

### R7 — `Organization.slug` generation

`Organization.slug` es nuevo y único global. Generación durante la migración de datos existentes:

1. **Slugify** `name` por cada organization: lowercase, trim, reemplazar espacios/acentos/specials por `-`, sin trailing/double `-`.
   - Ejemplo: `"Mi Tienda S.A."` → `"mi-tienda-s-a"`.
2. **Garantizar único:** si ya existe, appendar `-2`, `-3`, etc.
3. **Constraint:** `slug TEXT UNIQUE NOT NULL`. Las nuevas organizaciones se crean con slug generado desde el name al insert (trigger o usecase del server).
4. **Edge cases:**
   - `name` vacío o solo specials → fallback `org-{id_prefix}`.
   - Colisión masiva → batch update con窗口 `DISTINCT ON (slug)` después de generar.

### R8 — JWT HS256 → EdDSA (Ed25519) coexistencia

El algoritmo del JWT cambia en Fase 2. Los tokens HS256 futuros (aún válidos, expedidos por el client legacy) deben seguir aceptándose mientras rotan.

1. **Server firma siempre EdDSA** (nuevos tokens).
2. **Middleware verifica both** por un período (2 semanas = max TTL token legacy 7d + refresco):
   - Intentar `jwt.verify(token, ed25519PublicKey, { algorithms: ['EdDSA'] })`.
   - Si falla, fallback `jwt.verify(token, hs256Secret, { algorithms: ['HS256'] })` (legacy).
   - Solo uno aceptado; nunca ambos en mismo request.
3. **Rotación de refresh tokens:** nuevos refresh tokens se almacenan con `rotated_from`, los legacy se marcan `rotated_from = NULL` y se invalidan al primer refresh (fuerza nueva sesión EdDSA).
4. **`ver` bump:** tokens legacy no tienen `ver`; middleware los trata como `ver: 0` y acepta solo si además son HS256. Tokens EdDSA llevan `ver: 1`. Bump futuro invalida家族.
5. **Monitoreo:** loggear ratio HS256/EdDSA en el server. Cuando HS256 → 0, eliminar el fallback (un commit de cleanup).

---

## Cómo actualizar este plan

- Cada fase completada → mover a **Completado** en `docs/STATUS.md` con fecha + tildar la fase acá.
- Cada decisión técnica nueva durante la ejecución → agregar a la Receta correspondiente o crear una nueva.
- Si una fase se divide en sub-tareas, detallarlas acá mismo (no crear docs dispersos).

## Estado del plan

- [x] D1 (monorepo) confirmada
- [x] D2 (strangler fig) confirmada
- [x] D3 (custom JWT + schema auth target) confirmada — ver [`auth/AUTH_TARGET_SCHEMA.md`](../auth/AUTH_TARGET_SCHEMA.md)
- [ ] Fase 0
- [ ] Fase 1
- [ ] Fase 2
- [ ] Fase 3 (15 módulos)
- [ ] Fase 4
- [ ] Fase 5
