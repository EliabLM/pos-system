# Auth target schema y decisiones

> **Objetivo:** fijar la postura de target de autenticación/autorización antes de
> empezar la Fase 1 de la migración. Define schema de DB, forma del JWT, gaps a
> cerrar en el custom JWT actual, y(unificación de tablas. Es la fuente de verdad
> que reemplaza a las decisiones implícitas del client legacy.
>
> **Fecha:** 2026-08-10 · **Estado:** Decidido (D3 confirmada)

## Decisiones (D3)

| # | Decisión | Alternativa descartada | Razón |
|---|----------|------------------------|-------|
| **D3.1** | **Mantener custom JWT** y cerrar gaps (refresh rotation, EdDSA, jti+revocación, MFA opcional). Re-evaluar **Better Auth** en Fase 2 como abort-condition. | Keycloak, Clerk, Auth0, Better Auth ahora | Keycloak no encaja en multi-tenant por Organization (su unidad natural es realm por org). Clerk ya se migró fuera hace 2 semanas. Auth0/cloud no encaja con self-hosted VPS ni offline-first mobile. Better Auth es técnicamente viable pero ahora no hay SSO/MFA/passkey/multi-org federada que lo justifique. |
| **D3.2** | **JWT algoritmo → EdDSA (Ed25519)** con par de claves rotable desde secrets. | HS256 (actual), RS256 | HS256 no escala para rotación ni verificación multi-servicio. RS256 es opción válida; Ed25519 mejor (claves más chicas, más rápido, moderno). Rotación por versión de clave. |
| **D3.3** | **`Membership` desacoplada** user↔organization (tabla nueva). `User` pierde `organizationId`/`storeId`. | `User.organizationId` embebido (actual) | Prepara multi-org, member-roles, invitaciones, `defaultStoreId` por sesión. Costo trivial ahora, caro después. |
| **D3.4** | **Eliminar `username`** de `User`. Login por **email** + password. | mantener `username` | Email es canónico en POS; `username` es dead weight y deja un unique extra que Pflege. |
| **D3.5** | **`User.firstName` + `lastName`** → `name` (ún campo). | mantener dos campos | POS no necesita distinguishing; formularios más simples; mejor alineado con Better Auth/OAuth (gender "name"). |
| **D3.6** | **`User.password`** → `passwordHash` (nullable). | obligatorio | Habilita futuro OAuth/passkey sin escribir user alternativo. Nullable = "usuario solo credencial externa". |
| **D3.7** | **Unificar `PasswordReset` + `EmailVerification`** en una sola tabla `Verification` con `type` discriminator. | mantener dos tablas | Reduces tableras, agrega tipos nuevos (magic-link, change-email) sin migración. Formato compatible con Better Auth. |
| **D3.8** | **Restructurar `AuditLog`** al estándar actor-action-target + tenancy context. | shape actual | Alinea con tabla troncal (campo), agregables por filtros de `organizationId+createdAt`, soporta `correlationId` para trace distribuido. |
| **D3.9** | **Nueva tabla `Account`** (OAuth/passkey/credential linkeada a user). Schema creada en Fase 1, datos solo en Fase 2 cuando se active OAuth. | postergar schema | Definir el schema ahora elimina migración dolorosa después. |
| **D3.10** | **`Organization`** añade `slug` único global (URL-friendly). | sin slug | Soporta URLs multi-tenant (`/{slug}/…`), switch de org en UI, y evita exponer el UUID en paths. |

### Abort-condition: cuándo se re-evalúa Better Auth

Re-evaluar formalmente en Fase 2 **si** aparece alguno:

- Requisito de **MFA** regulatorio o solicitado por cliente pagador.
- **Passkey / WebAuthn** solicitado.
- **SSO federado** (cliente enterprise quiere login Google/Microsoft de su empresa).
- **Multi-org federada** real (un usuario pertenece a organizaciones con IdPs distintos).
- **SCIM / provisioning** de usuarios desde el lado de la enterprise.

Si se da, la migración custom→Better Auth es barata porque el **schema target aquí
definido ya está alineado** con el de Better Auth (`User`, `Account`, `Session`,
`Verification` son las mismas cuatro tablas base de su plugin core).

---

## Migración a Better Auth (#19, 2026-11-26)

Decisión del usuario 4 (D2 del informe): la autenticación pasa a **Better Auth**; D3.1 (JWT propio) y D3.2 (EdDSA) quedan reemplazadas y la sección "JWT target" de abajo es histórica.

Diff de schema (migración `20261126000000_better_auth`, aditiva):

- `sessions`: columna `token` única (Better Auth busca la sesión por ella); `token_hash` pasa a opcional y deja de escribirse. Se borran las sesiones del JWT.
- `accounts`: `password`, `id_token`, `scope`, `access_token_expires_at`, `refresh_token_expires_at`. La contraseña vive en la cuenta `credential` (bcrypt).
- `verifications`: `value` y `updated_at`; `value_hash` y `type` pasan a opcionales (Better Auth valida al arrancar que puede insertar aquí).
- Trigger `users_sync_credential_account`: copia `users.password_hash` a la cuenta `credential` en cada escritura. Puente hasta #20, cuando la gestión de usuarios escriba la cuenta directamente.

Columnas que quedan sin uso: `sessions.token_hash/refresh_token_hash/rotated_from/is_active/revoked_at/revoked_by/device_id/last_activity_at`, `users.login_attempts/locked_until` (el límite de intentos es por IP en Better Auth). Se pueden borrar en un issue de limpieza.

## JWT target

### Claim shape

```jsonc
{
  "iss": "pos-system-server",
  "sub": "<userId uuid v7>",
  "sid": "<sessionId uuid v7>",      // habilita revocación stateful
  "org": "<organizationId uuid>",   // RLS: SET LOCAL app.tenant_id
  "store": "<defaultStoreId uuid|null>",
  "role": "ADMIN|SELLER",
  "email": "user@example.com",
  "name": "Ada Lovelace",
  "ver": 1,                          // versión de claim; bump invalida todos los tokens
  "iat": 1690000000,
  "exp": 1690000000 + 900,            // access 15 min
  "jti": "<random uuid>"              // id único por token
}
```

- **Access token: 15 min.** Corto, no cacheable, re-validado contra `sessions.isActive` en middleware (cache 30s).
- **Refresh token: 30 días**, rotable, guardado como **hash** en `sessions.refreshTokenHash`. Rotación detecta reuse: si entra un refresh token que ya fue rotado (`rotatedFrom` chain), se **revoke toda la familia de sesiones** de ese user+device.
- **`jti`** único por token, validable contra denylist si queremos MFA-revocation puntual.
- **`ver`** se bump cuando cambia el shape del claim; invalida todos los tokens viejos.
- **`iss`** siempre `"pos-system-server"` — reserva para futuros servicios que emitan tokens propios.

### Algoritmo: EdDSA (Ed25519)

- Servidor posee par de claves: `AUTH_PRIVATE_KEY` y `AUTH_PUBLIC_KEY` (PEM) en secrets. Rotación por versión (`AUTH_KEY_ID`).
- `jsonwebtoken` soporta EdDSA desde Node 12+. Para verificar en middleware Next.js (jose) también.
- Migración: durante Fase 2, token viejo HS256 y nuevo EdDSA conviven (middleware acepta ambos por un período; ver Receta R8).

### Revocación

- `Session.isActive = false` o `revokedAt IS NOT NULL` → token inválido inmediatamente (aunque `exp` no haya vencido).
- Middleware caches `(sid → isActive)` por 30s en memoria (Node `lru-cache`). Cache invalidado en `/auth/logout` y `/auth/logout-all`.
- **Account lockout:** mantener `loginAttempts`, `lockedUntil` en `User` (ya está). Regla: 5 intentos → lock 15 min, exponencial en sucesivos.

### Refresh rotation + reuse detection

```
[login] → refresh token R0 (Hash refresh_0 in sessions row)
[refresh with R0] → R0.revokedAt = now, new R1, sessions refresh_1_saved, rotatedFrom = R0.id
[refresh with R0 again] → detect: R0 already rotated → revoke all sessions where userId+deviceId match
```

Implementación Fase 2 — adapter Express `RefreshTokenService.rotate(oldRefresh)`:

1. Hash oldRefresh, buscar `sessions.refreshTokenHash == hash AND isActive = true`.
2. Si no encontrado: intentar buscarlo en `rotatedFrom` chain → si está, **reuse detected**. Revoke familia.
3. Si encontrado: marcar `revokedAt = now`, crear nuevo refresh, actualizar `refreshTokenHash`, `rotatedFrom = row.id`.

### Gaps a cerrar en el custom JWT (postergados al module auth de Fase 2)

| Gap | Estado actual | Target |
|-----|---------------|---------|
| Algoritmo | HS256 single secret | Ed25519, par de claves |
| Access token TTL | 7 días | 15 min |
| Refresh token | implícito (mismo token reusado hasta expirar cercana) | explicit, stored hash, rotación + reuse detection |
| Revocación | invalidate JWT_SECRET válido si DB abajo | stateful: `sessions.isActive` check cacheado |
| `jti` | no hay | sí, id por token |
| `ver` | no hay | sí, invalida tokens por shape |
| Account lockout | modelado, sin usar | enforced en login usecase |
| Rate-limit `/auth/login` | scaffold `express-rate-limit` awaits | aplicado en Fase 2 |
| Email verification flow | tablas existentes, sin usar end-to-end | unificado en `verifications`, endpoint Fase 2 |
| Password reset flow | tabla existente, sin usar | unificado en `verifications`, endpoint Fase 2 |
| MFA | no | skull: `accounts` con providerId="totp"/"passkey" si abort-condition |
| Passkey | no | skull: `accounts` con providerId="passkey" si abort-condition |

---

## Schema target (Prisma)

> Marco con **★** los cambios que hay que aplicar en Fase 1 (DB foundation). Sin ★
> son tablas que se llenan en Fase 2 (auth module) pero el **schema** se crea ahora
> para evitar migración dolorosa.

```prisma
// ===== TENANCY =====

model Organization {
  id      String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  slug    String   @unique                              // D3.10 — URL-friendly, unico global
  name    String
  email   String?
  nit     String?
  phone   String?
  address String?
  city    String?
  department String?
  taxId   String?
  isActive    Boolean   @default(true)
  createdAt   DateTime  @default(now()) @db.Timestamptz
  updatedAt   DateTime  @updatedAt       @db.Timestamptz
  deletedAt   DateTime? @db.Timestamptz

  stores       Store[]
  users        User[]
  memberships  Membership[]
  // …todas las FKs tenant-scoped del dominio (product, sale, etc.)
  brands        Brand[]
  categories    Category[]
  customers     Customer[]
  paymentMethods PaymentMethod[]
  products      Product[]
  stockMovements StockMovement[]
  suppliers     Supplier[]
  systemConfigs SystemConfig[]
  unitMeasures  UnitMeasure[]

  @@map("organizations")
  @@index([slug])
}

model Store {
  id              String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  organizationId  String   @db.Uuid
  name            String
  description     String?
  address         String
  city            String?
  department      String?
  phone           String?
  saleNumberPrefix String   @default("")
  lastSaleNumber  Int      @default(0)
  isActive        Boolean  @default(true)
  createdAt       DateTime @default(now()) @db.Timestamptz
  updatedAt       DateTime @updatedAt       @db.Timestamptz
  deletedAt       DateTime? @db.Timestamptz

  organization Organization @relation(fields: [organizationId], references: [id])
  users        User[]
  sales        Sale[]

  @@unique([organizationId, name])            // sin deleted_at: nombre unico por org mientras viva
  @@index([organizationId, deletedAt])
  @@map("stores")
}

// ===== AUTH =====

model User {
  id              String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  email           String                                      // D3.4 unique global
  emailVerified   Boolean  @default(false)
  name            String                                      // D3.5 (first+last → name)
  image           String?                                     // avatar URL
  // D3.6 nullable para futuro OAuth/passkey
  passwordHash    String?
  lastLoginAt     DateTime? @db.Timestamptz
  passwordChangedAt DateTime? @db.Timestamptz
  loginAttempts   Int       @default(0)
  lockedUntil     DateTime? @db.Timestamptz
  isActive        Boolean   @default(true)
  createdAt       DateTime  @default(now()) @db.Timestamptz
  updatedAt       DateTime  @updatedAt    @db.Timestamptz
  deletedAt       DateTime? @db.Timestamptz

  memberships Membership[]
  sessions    Session[]
  accounts    Account[]
  auditLogs   AuditLog[]
  sales       Sale[]
  stockMovements StockMovement[]

  // unique parcial: email unico entre usuarios no-borrados
  @@unique([email], where: "deleted_at IS NULL")
  @@index([email])
  @@index([lastLoginAt])
  @@map("users")
}

// D3.3 ★ — decouple user/org, member-roles, default-store por sesión, invitaciones.
model Membership {
  id              String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  userId          String   @db.Uuid
  organizationId  String   @db.Uuid
  role            MembershipRole @default(SELLER)
  defaultStoreId  String?  @db.Uuid
  status          MembershipStatus @default(ACTIVE)
  invitedBy       String?  @db.Uuid
  acceptedAt      DateTime? @db.Timestamptz
  createdAt       DateTime  @default(now()) @db.Timestamptz
  updatedAt       DateTime  @updatedAt       @db.Timestamptz
  deletedAt       DateTime? @db.Timestamptz

  user          User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  organization  Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  defaultStore   Store?       @relation(fields: [defaultStoreId], references: [id])

  @@unique([userId, organizationId], where: "deleted_at IS NULL")
  @@index([organizationId, role])
  @@map("memberships")
}

model Session {
  id               String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  userId           String   @db.Uuid
  tokenHash        String   @unique                       // hash del access token jti (o session token)
  refreshTokenHash String?  @unique                       // D3 — refresh rotation separado
  rotatedFrom      String?  @db.Uuid                      // reuse detection chain
  expiresAt        DateTime @db.Timestamptz
  ipAddress        String?  @db.VarChar(45)
  userAgent        String?  @db.VarChar(500)
  deviceId         String?
  isActive         Boolean  @default(true)
  revokedAt        DateTime? @db.Timestamptz
  revokedBy        String?  @db.Uuid
  lastActivityAt   DateTime @default(now()) @db.Timestamptz
  createdAt        DateTime @default(now()) @db.Timestamptz
  updatedAt        DateTime @updatedAt       @db.Timestamptz

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, isActive])
  @@index([expiresAt])
  @@index([lastActivityAt])
  @@map("sessions")
}

// D3.7 ★ — unifica password_reset + email_verification (+ futuros magic-link/chg-email).
model Verification {
  id          String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  identifier  String                              // email o userId
  valueHash   String   @unique                     // hash del token
  type        VerificationType                    // PASSWORD_RESET | EMAIL_VERIFY | MAGIC_LINK | CHANGE_EMAIL
  expiresAt   DateTime  @db.Timestamptz
  used        Boolean   @default(false)
  usedAt      DateTime? @db.Timestamptz
  ipAddress   String?  @db.VarChar(45)
  userAgent   String?  @db.VarChar(500)
  createdAt   DateTime  @default(now()) @db.Timestamptz

  @@index([identifier, type, used])
  @@index([expiresAt])
  @@map("verifications")
}

// D3.9 — skull: OAuth/passkey/credential provider linkado a user (se llena en Fase 2+).
model Account {
  id          String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  userId      String   @db.Uuid
  providerId  String                                 // "google" | "apple" | "passkey" | "credential" | "totp"
  accountId   String                                 // external id (sub, credentialId)
  // paskeys: publicKey, counter (columnas json o en metadata)
  // oauth: accessToken, refreshToken (encrypted at rest)
  accessToken   String?
  refreshToken  String?
  expiresAt     DateTime? @db.Timestamptz
  metadata      Json?
  createdAt     DateTime  @default(now()) @db.Timestamptz
  updatedAt     DateTime  @updatedAt       @db.Timestamptz

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([providerId, accountId])
  @@index([userId])
  @@map("accounts")
}

// ===== AUDIT (D3.8) =====

model AuditLog {
  id              String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  actorUserId     String?  @db.Uuid
  action          AuditAction
  targetType      String?                   // table name ('sale', 'user', 'membership'…)
  targetId        String?  @db.Uuid
  oldValues       Json?
  newValues       Json?
  organizationId  String?  @db.Uuid         // tenancy del evento
  storeId         String?  @db.Uuid
  ipAddress       String?  @db.VarChar(45)
  userAgent       String?  @db.VarChar(500)
  correlationId   String?                   // distributed trace id
  metadata        Json?
  createdAt       DateTime @default(now()) @db.Timestamptz

  user User? @relation(fields: [actorUserId], references: [id], onDelete: SetNull)

  @@index([organizationId, createdAt])
  @@index([actorUserId])
  @@index([action, createdAt])
  @@index([targetType, targetId])
  @@map("audit_logs")
}
```

### Enums

```prisma
enum MembershipRole   { ADMIN  SELLER }                 // extensible: MANAGER, ACCOUNTANT
enum MembershipStatus  { INVITED ACTIVE REVOKED }
enum VerificationType  { PASSWORD_RESET EMAIL_VERIFY MAGIC_LINK CHANGE_EMAIL }
enum AuditAction       { LOGIN LOGOUT LOGOUT_ALL PASSWORD_CHANGE ROLE_CHANGE CREATE UPDATE DELETE SOFT_DELETE RESTORE EXPORT VIEW_SENSITIVE }
```

---

## Resumen de cambios vs schema actual (checklist de Fase 1)

| # | Cambio | Aplica a |
|---|--------|----------|
| ★ | `cuid` → `UUID v7` (`gen_random_uuid()`) | todas las tablas |
| ★ | `Float` → `Decimal` en `subtotal`/`total`/`amount` | `Sale`, `SaleItem`, `SalePayment` |
| ★ | Unique con `WHERE deleted_at IS NULL` (parcial) | todas con soft-delete |
| ★ | `updated_at` por trigger `BEFORE UPDATE` | todas |
| ★ | RLS con role non-owner + `FORCE ROW LEVEL SECURITY` | tenant-scoped |
| ★ | Índices con `organization_id` como leading column | tenant-scoped |
| ★ | `User` pierde `organizationId`, `storeId`, `username`, `firstName`, `lastName`, `password` | `users` |
| ★ | `User` gana `name`, `image`, `passwordHash` nullable | `users` |
| ★ | Nueva `Membership` | — |
| ★ | `PasswordReset` + `EmailVerification` → `Verification` | merge |
| ★ | Nueva `Account` (schema only, sin datos en Fase 1) | — |
| ★ | `AuditLog` reestructurado (`actorUserId`, `targetType`, `storeId`, `correlationId`) | `audit_logs` |
| ★ | `Organization` gana `slug` único | `organizations` |
| ★ | `Session` gana `refreshTokenHash`, `rotatedFrom` | `sessions` |

JWT (postergado a módulo auth Fase 2):

| # | Gap | Cuándo |
|---|-----|--------|
| ★ | Algoritmo HS256 → EdDSA | Fase 2 |
| ★ | Access TTL 7d → 15min + refresh 30d | Fase 2 |
| ★ | Refresh rotation + reuse detection | Fase 2 |
| ★ | `jti`, `sid`, `ver` en claim | Fase 2 |
| ★ | Stateful session check cacheado en middleware | Fase 2 |
| ★ | Account lockout enforced | Fase 2 |
| ★ | Email verification flow unificado en `verifications` | Fase 2 |
| ★ | Password reset flow unificado en `verifications` | Fase 2 |

---

## Migración de datos existentes (R6/receta)

Cuando se aplique Fase 1 sobre la DB legacy:

1. **Crear `memberships`** a partir de `users.organizationId` + `users.storeId`:
   - `userId = users.id`, `organizationId = users.organizationId`, `role = users.role`,
     `defaultStoreId = users.storeId`, `status = ACTIVE`, `acceptedAt = users.createdAt`.
   - Para users con `organizationId IS NULL` (si los hay): `status = INVITED` sin org (caso edge a revisar dump).
2. **Migrar `password_resets` + `email_verifications`** a `verifications`:
   - tipo `PASSWORD_RESET` para los de `password_resets`; `EMAIL_VERIFY` para los de `email_verifications`.
   - `valueHash = token` (hash futuro en Fase 2; ahora se mueve como está).
3. **Renombrar columnas** en `users`: `password` → `passwordHash`, `firstName+lastName` → `name` (concatenar trim).
4. **Eliminar `username`** (drop column) tras verificar que ningún login lo usa (solo email).
5. **`AuditLog`** renombrar: `userId` → `actorUserId`, `entity` → `targetType`, `entityId` → `targetId`. Añadir `storeId` NULL, `correlationId` NULL. Datos existentes se mueven 1:1.
6. **`Organization.slug`**: generar a partir de `name` (slugify), garantizar único. Si hay conflicto, appendar `-2`, `-3`.
7. **cuid → UUIDv7**: ver Receta R1 del plan de migración. La tabla `legacy_id_map` es el puente.

Estos pasos se corren en una migración SQL idempotente sobre un dump de prod en staging antes de tocar prod.

---

## Cómo actualizar este doc

- Cada gap cerrado en Fase 2 → marcar hecho en la tabla de gaps.
- Si abort-condition se dispara → documentar la migración a Better Auth aquí mismo (con su diff de schema) y linkear el plan.
- Si cambia el claim → bump `ver` en el ejemplo y documentar el cambio.