# Plan de Pruebas E2E — POS System (Playwright)

> Sistema POS multi-tenant construido con **Next.js 15 (App Router)**, probado vía stack local
> `docker compose up` (Postgres 17 + client en `http://localhost:3000`).
>
> ** STACK bajo prueba (`pos-system-client/`)** · **DB**: `pos`/`pos` en `localhost:5432` ·
> **Auth**: JWT custom en cookie httpOnly `auth-token` (verificado con `jose` en middleware Edge) ·
> **RBAC**: `ADMIN` / `SELLER` definido en `src/lib/rbac.ts` y reforzado por `checkAdminRole` en cada server action.

---

## 1. Resumen y objetivos

 Este plan define la estrategia y la **matriz exhaustiva de escenarios E2E** para validar el POS antes de cada
release. Cubre la totalidad de los flujos funcionales del monolito `pos-system-client` (única app con lógica de
negocio hoy), con énfasis en los ejes de mayor riesgo del sistema:

- **Autenticación JWT custom** embebida en cookie httpOnly (registro público → onboarding; login con lockout; reset
  de password).
- **Onboarding obligatorio**: un ADMIN sin `organizationId` es redirigido a `/onboarding` por el middleware hasta
  crear Organization + Store + SystemConfig.
- **RBAC de 2 niveles** (ADMIN vs SELLER) con **dos capas** de control que deben probarse por separado:
  1. **Middleware (Edge)**: redirige rutas prohibidas (`hasRouteAccess` en `src/lib/rbac.ts`).
  2. **Server Action**: `checkAdminRole(userId)` en cada acción mutativa (`src/actions/utils.ts`) → responde
     `403 "Acción no autorizada. Se requiere rol de Administrador."`.
- **Multi-tenancy**: uniques por organización (`barcode`, `sku`, `name`, `email`, `document`, `taxId`, etc.) y
  aislamiento de datos por `organizationId`.
- **Cascada de inventario**: crear venta descuenta stock y genera `StockMovement OUT`; recibir `Purchase` PENDING →
  RECEIVED genera `StockMovement IN`. Validación de stock insuficiente.
- **Soft-delete** con índices únicos que incluyen `deletedAt`: el borrado libera el nombre único pero el activo lo
  retiene — patrón que debe ejercitarse en ambos sentidos.
- **Validaciones de formularios** (React Hook Form + Yup) mensajes en español, toasts `sonner`, confirmaciones
  destructivas `sweetalert2`.

### Objetivos cuantitativos
- ≥ 1 happy path por módulo (12 módulos dashboard).
- ≥ 1 escenario de validación por campo crítico de cada formulario.
- 100 % de las rutas del dashboard cubiertas por al menos un caso ADMIN (permitido) y un caso SELLER (bloqueado).
- 100 % de las server actions mutativas con un caso de defensa RBAC (`checkAdminRole`).
- Cobertura de los 4 estados de venta (`PAID / PENDING / OVERDUE / CANCELLED`) y de los 3 tipos de movimiento
  (`IN / OUT / ADJUSTMENT`).

### Fuera de alcance (este plan)
- App Expo (`pos-system-app`) — sin features aún (Fase 4 del migration).
- API `pos-system-server` — sin módulos de dominio aún.
- Pruebas de carga / performance / seguridad ofensiva (pentesting).
- Subida de imágenes reales (se omite la imagen o se usa un archivo local pequeño; se guardan en `UPLOADS_DIR`).

---

## 2. Estrategia global

### 2.1 Entorno y arranque
- El stack se levanta con `docker compose up --build` desde la raíz del monorepo. La app Expo es opcional
  (`--profile app`) y **no se activa** para esta suite.
- Variable `HTTPS_ENABLED=false` en local → la cookie `auth-token` se setea con `secure: false` (Playwright debe
  poder leerla y limpiarla sin restricciones de HTTPS).
- `JWT_SECRET` (alias `CLIENT_JWT_SECRET` en `.env`) debe tener ≥ 32 chars — si no, el middleware loguea error y
  redirige a login eliminando la cookie (caso E098 cubre esto).
- URL base: `http://localhost:3000`. La PR debe esperar a que `/auth/login` responda 200 antes de iniciar (poll de
  readiness en `globalSetup`).

### 2.2 Datos sembrados (seed idempotente)
- **Precondición de infraestructura**: aún **no existe** `prisma/seed.ts`. Este plan asume que se crea como parte de
  la habilitación de pruebas (ver §6 y §8 "dependencias"). El seed debe ser **idempotente**: `deleteMany` ordenado
  (respetando FKs) seguido de `create` en una transacción, o `upsert` por `where` único por organización. Cada
  corrida del plan arranca desde el **mismo estado conocido**.
- Seed mínimo (ver §5 para detalle de cada entidad):
  - 1 Organization (`Pos Demo Org`) con 2 Stores (`Store Central`, `Store Sucursal Norte`).
  - 3 Users: ADMIN `admin@pos.test` / `Admin123!`; SELLER `seller@pos.test` / `Seller123!`; un tercero
    `conflict@pos.test` para pruebas de uniques de email/username en registro.
  - 3 Categories, 3 Brands, 3 UnitMeasures (`unidad`, `kg`, `litro`), 3 PaymentMethods (`Efectivo/CASH`,
    `Tarjeta/CARD`, `Transferencia/TRANSFER`), 2 Suppliers, 3 Customers, 5 Products con stock > 0.
  - 1 Sale histórica `PAID` en `Store Central` para poblar reports y dashboard.

### 2.3 Fixtures y page objects sugeridos
Implementar un **page-object-model** en `e2e/pages/` y **fixtures** en `e2e/fixtures/`:

- **`AuthActions`** — `login(email, password)`, `logout()`, `loginAs(role)`, `getToken()`, `clearToken()`,
  `injectTokenFor(role)` (set directo de cookie para saltar el form en specs que no prueban el login mismo).
- **`OnboardingActions`** — `fillOrganization(data)`, `fillStore(data)`, `fillSystemConfig(data)`, `submit()`.
- **`CrudPageActions<T>`** — genérico para módulos de listado: `openList(module)`, `openCreateSheet()`,
  `fillForm(data)`, `submit()`, `expectToast(text)`, `openEditSheet(row)`, `softDelete(row)`, `confirmSweetAlert()`.
- **`SaleActions`** — `openNew()`, `addCustomer(data)`, `selectExistingCustomer(name)`, `addItem(product, qty)`,
  `addPayment(method, amount)`, `submit()`, `expectSaleNumber(prefix)`.
- **`PurchaseActions`** — `openCreate()`, `selectSupplier(name)`, `addItem(product, qty, unitPrice)`, `submit()`,
  `receivePurchase(row)`.
- Page objects concretos: `LoginPage`, `RegisterPage`, `OnboardingPage`, `DashboardPage`, `ProductsPage`,
  `CategoriesPage`, `BrandsPage`, `UnitMeasuresPage`, `PaymentMethodsPage`, `CustomersPage`, `SuppliersPage`,
  `StoresPage`, `UsersPage`, `MovementsPage`, `PurchasesPage`, `SalesPage`, `NewSalePage`, `SaleDetailPage`,
  `ReportsPage`.

### 2.4 Helpers de datos
- `e2e/data/factories.ts` — generadores de payloads para cada formulario (variantes válidas/inválidas).
- `e2e/data/expected-errors.ts` — catálogo de mensajes de error en español que devuelve el backend (para asserts
  estables frente a cambios menores de copy).
- `e2e/utils/db.ts` — helpers opcionales para leer/escribir Postgres directamente vía `pg` (validación de stock,
  `lastSaleNumber` incrementado, `loginAttempts` reseteado tras lockout expirado). Usar **solo en asserts
  pos-acción**, no para saltar UI en happy paths.

### 2.5 Paralelismo y aislamiento
- **Workers**: 2 paralelos por defecto. Specs que mutan datos compartidos (`users-rbac.spec.ts`, `sales.spec.ts`,
  `purchases.spec.ts`) corren en `test.describe.configure({ mode: 'serial' })` dentro del worker para evitar
  interferencia. Specs de solo-lectura (RBAC navigation, reports) corren en paralelo.
- **Reset entre specs**: reseed selectivo vía `globalSetup` (corre una vez). Cada spec que mute estado
  **destructor** (borrar entidad, bloquear cuenta, consumir stock) debería restaurar via:
  - `test.afterAll` → llamado a un script `pnpm db:seed:partial <entidad>` (a implementar), O
  - Aislamiento por **nombre único con sufijo de timestamp/uuid** en specs de validación (ej:
    `Categoría-Test-${runId}`), de modo que nunca colisionan con datos sembrados.
- **Lockout**: los specs que disparan bloqueo de cuenta usan un **usuario dedicado** (`lock@pos.test`/`Lock123!`)
  añadido al seed para no bloquear `admin`/`seller` y ensuciar specs posteriores. El spec resetea `loginAttempts` y
  `lockedUntil` vía helper DB en `afterAll`.

### 2.6 Selectores y estabilidad
- Preferir **role/accessible-name** (`getByRole`, `getByLabel`, `getByText`) sobre selectores CSS frágiles.
- `data-testid` solo cuando el rol es ambiguo (filas de data-table, items de combobox de productos). Se permite
  añadir `data-testid` en componentes clave como parte de la habilitación de pruebas.
- Timeouts base `30s` para acciones, `15s` para asserts de toast (SweetAlert2 tiene animaciones).
- `console.error` y `console.warn` capturados a nivel de page → un error no atrapado falla el test (a menos que el
  spec espere un error específico, en cuyo caso se allowlista via `page.on('console')`).

### 2.7 Aserciones de red (opcional pero recomendado)
- Validar respuestas de server actions que retornan `{status, message, data}` interceptando `fetch` a `/actions`
  cuando se usen RPCs, o navegando por el form submit clásico. Para server actions Next 15 el payload es opaco por
  diseño; los asserts se hacen sobre **UI resultante** (toast, redirección, fila en tabla).

---

## 3. Matriz de escenarios

> Convenciones: **Rol** = ADMIN | SELLER | GUEST (sin sesión). **Tipo** = happy | validation | error | rbac | state.
> **Precondición** asume **estado fresco sembrado** salvo excepción marcada con `(persist)`.

### 3.1 Autenticación — `auth.spec.ts`

| ID | Módulo | Rol | Tipo | Precondición | Pasos (resumido) | Resultado esperado | Datos sembrados |
|----|--------|-----|------|--------------|------------------|--------------------|-----------------|
| E001 | Login | GUEST | happy | Sin cookie | Navegar `/auth/login`, llenar `admin@pos.test` / `Admin123!`, submit | Redirect `/dashboard`, cookie `auth-token` presente, header muestra nombre ADMIN | admin, seller |
| E002 | Login | GUEST | happy | Sin cookie | Login como `seller@pos.test` / `Seller123!` | Redirect `/dashboard`, UI de seller (sin nav a reports/users/etc.) | seller |
| E003 | Login | GUEST | validation | — | Submit con email vacío | `FormMessage` "El correo electrónico es requerido", no hay redirect | — |
| E004 | Login | GUEST | validation | — | Submit con password vacío | `FormMessage` "La contraseña es requerida" | — |
| E005 | Login | GUEST | validation | — | Email mal formado (`admin`) | `FormMessage` "Formato de correo electrónico inválido" | — |
| E006 | Login | GUEST | error | — | Credenciales válidas pero email inexistente (`nobody@pos.test`) | Toast/error 401 "Correo electrónico o contraseña inválidos", sin cookie | — |
| E007 | Login | GUEST | error | — | Email válido + password incorrecto (1er fallo) | 401, `attemptsRemaining: 4` visible, sin lock | — |
| E008 | Login | GUEST | error | usuario `lock@pos.test` | 5 intentos consecutivos fallidos | En el 5º: 423, "Cuenta bloqueada… Intente nuevamente en 15 minutos", `lockedUntil` set en DB | lock@pos.test |
| E009 | Login | GUEST | state | `lockedUntil` futuro en `lock@pos.test` | Intentar login con credenciales **correctas** mientras bloqueado | 423, "Cuenta bloqueada…", sin sesión sin importar credenciales correctas | lock@pos.test |
| E010 | Login | GUEST | state | `lockedUntil` **pasado** en `lock@pos.test` | Login con credenciales correctas tras expirar bloqueo | Éxito 200 (el login resetea `loginAttempts`/`lockedUntil` y permite entrada), `loginAttempts=0` en DB | lock@pos.test |
| E011 | Login | USER desactivado | error | `admin` con `isActive=false` (helper DB) | Login con credenciales correctas | 403 "Su cuenta ha sido desactivada. Por favor contacte a soporte", sin sesión. (restaurar `isActive` en afterAll) | admin |
| E012 | Login | USER org inactiva | error | Organization `isActive=false` | Login admin | 403 "Su organización ha sido desactivada…" (restaurar en afterAll) | admin |
| E013 | Login | USER tienda inactiva | error | Store asignada `isActive=false` | Login seller con `storeId` inactivo | 403 "Su tienda ha sido desactivada…" (restaurar) | seller |
| E014 | Login | GUEST | happy | redirect param | GET `/auth/login?redirect=/dashboard/sales`, login seller | Redirect a `/dashboard/sales` (no a `/dashboard`) | seller |
| E015 | Login | SELLER | state | Sesión activa | Navegar `/auth/login` estando logueado | **RESUELTO (código)**: el middleware retorna `next()` en rutas públicas sin verificar sesión (`src/middleware.ts` — `isPublicRoute` se evalúa antes del JWT) → muestra el formulario de login, NO redirige a dashboard | — |
| E016 | Logout | ADMIN | happy | Sesión ADMIN | Click en logout | Cookie `auth-token` eliminada, sesión DB marcada revoked, redirect `/auth/login` | admin |
| E017 | Registro | GUEST | happy | Email/username libres | Llenar formulario completo válido SIN `organizationId`, submit | 201, redirect `/onboarding`, cookie set, usuario creado con `role=ADMIN`, `organizationId=null` | conflict@pos.test |
| E018 | Registro | GUEST | validation | — | `username` < 3 chars (`ab`) | Mensaje español de longitud mínima | — |
| E019 | Registro | GUEST | validation | — | `username` 21 chars | Mensaje longitud máxima | — |
| E020 | Registro | GUEST | validation | — | `username` con char no alfanumérico (`admin!`) | Mensaje "solo letras, números y guion bajo" | — |
| E021 | Registro | GUEST | validation | — | `firstName` con números (`Juan1`) | Mensaje "solo letras" | — |
| E022 | Registro | GUEST | validation | — | `firstName` 1 char | Mensaje mínimo 2 | — |
| E023 | Registro | GUEST | validation | — | `lastName` 51 chars | Mensaje máximo 50 | — |
| E024 | Registro | GUEST | validation | — | email `not-an-email` | "Formato de correo electrónico inválido" | — |
| E025 | Registro | GUEST | validation | — | email desechable (`admin@mailinator.com`) | Rechazado por `allowDisposable:false` | — |
| E026 | Registro | GUEST | validation | — | password `short1A!` (7 chars) | "La contraseña debe tener al menos 8 caracteres" | — |
| E027 | Registro | GUEST | validation | — | password sin mayúscula (`admin123!`) | "debe contener al menos una mayúscula" | — |
| E028 | Registro | GUEST | validation | — | password sin minúscula (`ADMIN123!`) | "al menos una minúscula" | — |
| E029 | Registro | GUEST | validation | — | password sin número (`AdminPass!`) | "al menos un número" | — |
| E030 | Registro | GUEST | validation | — | password sin especial (`Admin1234`) | "al menos un carácter especial de @$!%*?&#" | — |
| E031 | Registro | GUEST | validation | — | `confirmPassword` distinto al password | "Las contraseñas no coinciden" | — |
| E032 | Registro | GUEST | error | `admin@pos.test` existe | Registrar con ese email (sin org) | 409, "Ya existe un usuario con este correo electrónico" | admin |
| E033 | Registro | GUEST | error | `admin` username existe | Registrar con ese username (sin org) | 409, "Ya existe un usuario con este nombre de usuario" | admin |
| E034 | Registro | GUEST | error | existe usuario `isDeleted=true` con email `trash@pos.test` | Registrar con mismo email | 409, "Este correo electrónico fue usado previamente. Por favor contacte a soporte para reactivar su cuenta" | trash@pos.test |
| E035 | Registro | ADMIN | happy | ADMIN logueado con `organizationId` | Desde `/dashboard/users` crear seller vía `registerUser` con `organizationId` | Usuario creado con `role=SELLER`, redirect/refresh lista, sin pasar por onboarding | — |

### 3.2 Onboarding — `onboarding.spec.ts`

| ID | Módulo | Rol | Tipo | Precondición | Pasos | Resultado | Datos |
|----|--------|-----|------|--------------|-------|-----------|-------|
| E036 | Onboarding | ADMIN sin org | happy | ADMIN recién registrado (E017) | Completar Organization + Store + SystemConfig, submit | Redirect `/dashboard`, JWT ahora contiene `organizationId`, `storeId`. **Además** (verificado en `createOrganization`): se auto-crea la parametrización inicial — categorías, marcas, unidades y métodos de pago según `businessType` (`liquor_store` / `shoe_store` / genérico) — y el `businessType` se persiste en `SystemConfig`. Assert: las listas de parametrización NO están vacías tras el onboarding | — |
| E037 | Onboarding | ADMIN sin org | validation | — | Submit Organization sin nombre | FormMessage error, no avanza | — |
| E038 | Onboarding | ADMIN sin org | validation | — | Store sin nombre o sin `saleNumberPrefix` | Error por campo, no avanza | — |
| E039 | Onboarding | GUEST | rbac | Sin cookie | Navegar `/onboarding` | Redirect `/auth/login?redirect=/onboarding` | — |
| E040 | Onboarding | ADMIN con org | rbac | ADMIN ya Completo | Navegar `/onboarding` | Middleware redirige a `/dashboard` (regla `isOnboardingRoute && organizationId`) | admin |
| E041 | Onboarding | ADMIN sin org | state | JWT sin `organizationId` | Navegar `/dashboard` directamente | Redirect `/onboarding` (regla `isDashboardRoute && !organizationId`) | — |
| E042 | Onboarding | ADMIN sin org | error | org sembrada con `nit=900123456-7` | Llenar Organization con **NIT duplicado** de otra org activa | 409 "Ya existe una organización con ese NIT", no avanza. **RESUELTO (código)**: `Organization.name` NO tiene unique — la unicidad validada en `createOrganization` es por `nit` (query `findFirst` + catch P2002) | org seed |

### 3.3 Dashboard home — `dashboard.spec.ts`

| ID | Módulo | Rol | Tipo | Precondición | Pasos | Resultado | Datos |
|----|--------|-----|------|--------------|-------|-----------|-------|
| E043 | Dashboard | ADMIN | happy | Login admin | Navegar `/dashboard` | KPIs visibles, cash status por método de pago, widgets cargados, sin errores console | admin, venta histórica |
| E044 | Dashboard | SELLER | happy | Login seller | Navegar `/dashboard` (permitido) | KPIs visibles en modo solo lectura, ningún botón de mutación visible (crear/editar/eliminar) | seller |
| E045 | Dashboard | GUEST | rbac | Sin sesión | Navegar `/dashboard` | Redirect `/auth/login?redirect=/dashboard` | — |

### 3.4 Productos — `products.spec.ts`

| ID | Módulo | Rol | Tipo | Precondición | Pasos | Resultado | Datos |
|----|--------|-----|------|--------------|-------|-----------|-------|
| E046 | Products | ADMIN | happy | Login admin | Listar `/dashboard/products` | DataTable renderiza 5 productos sembrados, búsqueda/paginación funcionan | 5 productos |
| E047 | Products | ADMIN | happy | — | Abrir sheet "Nuevo", llenar todos los campos válidos incl. barcode/sku únicos, submit | Toast "éxito", fila aparece en tabla | — |
| E048 | Products | ADMIN | happy | — | Editar un producto (cambiar `salePrice`), submit | Toast éxito, fila reflejada | 1 producto |
| E049 | Products | ADMIN | happy | — | Soft-delete un producto de prueba | SweetAlert2 confirm, toast, fila desaparece (o marca inactivo según UI), `isDeleted=true` en DB | producto test |
| E050 | Products | ADMIN | validation | — | Submit sin `name` | FormMessage "nombre requerido" | — |
| E051 | Products | ADMIN | validation | — | Submit `barcode` duplicado de otro producto activo | Error unique, "Ya existe un producto con ese código de barras" | 1 producto |
| E052 | Products | ADMIN | validation | — | Submit `sku` duplicado activo | Error unique | 1 producto |
| E053 | Products | ADMIN | validation | — | `salePrice` negativo o no numérico | FormMessage | — |
| E054 | Products | ADMIN | validation | — | `currentStock` negativo | FormMessage | — |
| E055 | Products | ADMIN | state | producto soft-deleted con barcode `X` | Crear nuevo producto con barcode `X` (libre por soft-delete) | Éxito — el unique incluye `deletedAt`, el nombre borrado libera | producto borrado |
| E056 | Products | ADMIN | error | — | Crear producto con `categoryId` inexistente/FK rota | Error 400 "referencia no existe" o validación de formulario | — |
| E057 | Products | SELLER | rbac | Login seller | Navegar `/dashboard/products` | Middleware redirige a `/dashboard` | — |
| E058 | Products | SELLER | rbac | Login seller, token inyectado | Llamar server action createProduct via UI bloqueada (no reachza) | No se puede alcanzar la UI; si se empuja request directo: server action `checkAdminRole` retorna 403 | — |

### 3.5 Parametrización — `parametrization.spec.ts` (Categories, Brands, UnitMeasures, PaymentMethods, Stores)

| ID | Módulo | Rol | Tipo | Precondición | Pasos | Resultado | Datos |
|----|--------|-----|------|--------------|-------|-----------|-------|
| E059 | Categories | ADMIN | happy | — | Crear categoría válida | Toast, fila aparece | 3 categorías |
| E060 | Categories | ADMIN | validation | — | `name` duplicado activo | Error "Ya existe una categoría con ese nombre" | 1 categoría |
| E061 | Categories | ADMIN | validation | — | `name` vacío o `isActive` toggle | FormMessage | — |
| E062 | Categories | ADMIN | state | categoría borrada con `name="X"` | Recrear con `name="X"` | Éxito (unique incluye `deletedAt`) | — |
| E063 | Categories | SELLER | rbac | seller | GET `/dashboard/categories` | Redirect `/dashboard` | — |
| E064 | Categories | SELLER | rbac | seller | createCategory via server action directo | 403 `checkAdminRole` | — |
| E065 | Brands | ADMIN | happy | — | Crear brand válida con logo (mock/no upload) | Toast, fila aparece | 3 brands |
| E066 | Brands | ADMIN | validation | — | `name` duplicado activo | Error unique | 1 brand |
| E067 | Brands | SELLER | rbac | seller | `/dashboard/brands` | Redirect `/dashboard` | — |
| E068 | UnitMeasures | ADMIN | happy | — | Crear `name`+`abbreviation` únicos | Toast, fila aparece | 3 unidades |
| E069 | UnitMeasures | ADMIN | validation | — | `abbreviation` duplicado activo | Error unique abbreviation | 1 unidad |
| E070 | UnitMeasures | ADMIN | validation | — | `name` duplicado | Error unique name | 1 unidad |
| E071 | UnitMeasures | SELLER | rbac | seller | `/dashboard/unit-measures` | Redirect `/dashboard` | — |
| E072 | PaymentMethods | ADMIN | happy | — | Crear método con `type=CASH` y `name` único | Toast, fila aparece | 3 métodos |
| E073 | PaymentMethods | ADMIN | validation | — | `type` inválido (no en enum) | FormMessage/validación | — |
| E074 | PaymentMethods | ADMIN | validation | — | `name` duplicado activo | Error unique | 1 método |
| E075 | PaymentMethods | SELLER | rbac | seller | `/dashboard/payment-methods` | Redirect `/dashboard` | — |
| E076 | Stores | ADMIN | happy | — | Crear store con `address`, `saleNumberPrefix` único | Toast, fila aparece, `lastSaleNumber=0` inicial | 2 stores |
| E077 | Stores | ADMIN | validation | — | `name` duplicado activo | Error unique | 1 store |
| E078 | Stores | ADMIN | validation | — | `saleNumberPrefix` repetido o inválido | FormMessage | — |
| E079 | Stores | SELLER | rbac | seller | `/dashboard/stores` | Redirect `/dashboard` | — |

### 3.6 Clientes y Proveedores — `customers-suppliers.spec.ts`

| ID | Módulo | Rol | Tipo | Precondición | Pasos | Resultado | Datos |
|----|--------|-----|------|--------------|-------|-----------|-------|
| E080 | Customers | ADMIN | happy | — | Crear cliente válido | Toast, fila aparece | 3 customers |
| E081 | Customers | ADMIN | happy | — | Editar cliente (cambiar phone) | Toast, fila refleja | 1 customer |
| E082 | Customers | ADMIN | validation | — | `email` duplicado activo | Error "Ya existe un cliente con ese email" | 1 customer |
| E083 | Customers | ADMIN | validation | — | `document` duplicado activo | Error unique document | 1 customer |
| E084 | Customers | ADMIN | validation | — | `email` mal formado | FormMessage | — |
| E085 | Customers | ADMIN | validation | — | `documentType` no seleccionado | FormMessage | — |
| E086 | Customers | ADMIN | happy | — | Soft-delete cliente de prueba | SweetAlert2, fila fuera, `isDeleted=true` | — |
| E087 | Customers | SELLER | rbac | seller | `/dashboard/customers` | Redirect `/dashboard` | — |
| E088 | Customers | SELLER | state | seller, `createCustomer` via server action | Llamar directo | **RESUELTO (código)**: `createCustomer` usa `checkAdminOrSellerRole` — el SELLER **SÍ puede** crear clientes (201). Es la excepción intencional que habilita el diálogo inline de `/dashboard/sales/new`. La ruta UI `/dashboard/customers` sigue bloqueada por middleware (E087). El resto del CRUD de customers (update/delete) queda por verificar guard por guard al escribir el spec | — |
| E089 | Suppliers | ADMIN | happy | — | Listar `/dashboard/suppliers`, crear proveedor válido | Toast, fila aparece | 2 suppliers |
| E090 | Suppliers | ADMIN | validation | — | `taxId` duplicado activo | Error unique taxId | 1 supplier |
| E091 | Suppliers | ADMIN | validation | — | `email` mal formado | FormMessage | — |
| E092 | Suppliers | SELLER | rbac | seller | `/dashboard/suppliers` | Redirect `/dashboard` (suppliers ADMIN-only) | — |
| E093 | Suppliers | SELLER | rbac | seller | `createSupplier` server action directo | 403 `checkAdminRole` | — |

### 3.7 Inventario (movimientos + stock) — `inventory.spec.ts`

| ID | Módulo | Rol | Tipo | Precondición | Pasos | Resultado | Datos |
|----|--------|-----|------|--------------|-------|-----------|-------|
| E094 | Movements | ADMIN | happy | Login admin | Listar `/dashboard/movements` | DataTable muestra movimientos históricos (incl. OUT de venta sembrada) | venta histórica |
| E095 | Movements | ADMIN | happy | producto con stock 100 | Crear movimiento `ADJUSTMENT` qty +20, reason "conteo" | Toast, `currentStock` pasa a 120, `previousStock`/`newStock` correctos | producto test |
| E096 | Movements | ADMIN | happy | producto stock 120 | Movimiento `IN` qty 30, reason "compra manual" | Stock → 150 | — |
| E097 | Movements | ADMIN | happy | producto stock 150 | Movimiento `OUT` qty 10, reason "merma" | Stock → 140 | — |
| E098 | Movements | ADMIN | validation | — | Movimiento `quantity <= 0` | FormMessage "mayor a 0" | — |
| E099 | Movements | ADMIN | validation | — | Movimiento sin `productId` | FormMessage | — |
| E100 | Movements | ADMIN | validation | — | Movimiento sin `type` | FormMessage | — |
| E101 | Movements | ADMIN | happy | — | Abrir detalle de movimiento (dialog/drawer) | Muestra `previousStock`, `newStock`, `reference`, `user` | — |
| E102 | Movements | SELLER | rbac | seller | `/dashboard/movements` | Redirect `/dashboard` | — |
| E103 | Movements | SELLER | rbac | seller | `createStockMovement` action directo | 403 | — |
| E104 | Stock | ADMIN | state | Producto A stock 5 | Intentar movimiento `OUT` qty 10 vía UI | Error "Stock insuficiente" (validación de formulario o backend), stock sin cambios | producto A |

### 3.8 Compras — `purchases.spec.ts`

| ID | Módulo | Rol | Tipo | Precondición | Pasos | Resultado | Datos |
|----|--------|-----|------|--------------|-------|-----------|-------|
| E105 | Purchases | ADMIN | happy | — | Listar `/dashboard/purchases` | DataTable vacía o con sembradas | — |
| E106 | Purchases | ADMIN | happy | supplier + producto activos | Crear purchase PENDING con 2 items, submit | Toast, fila aparece `status=PENDING`, `purchaseNumber` auto, stock **sin cambios todavía** | 1 supplier, 1 producto |
| E107 | Purchases | ADMIN | happy | purchase PENDING existe | Acción "Recibir" | `status=RECEIVED`, **stock IN** generado por cada item (`StockMovement` type=IN, `reference` = purchase), `currentStock` incrementado | 1 purchase PENDING |
| E108 | Purchases | ADMIN | happy | purchase PENDING existe | Cancelarla (`status=CANCELLED`) | `status=CANCELLED`, **stock sin cambios** | 1 purchase |
| E109 | Purchases | ADMIN | validation | — | Submit sin `supplierId` | FormMessage | — |
| E110 | Purchases | ADMIN | validation | — | Submit sin `purchaseItems` | "La compra debe tener al menos un item" | — |
| E111 | Purchases | ADMIN | validation | — | Item con `quantity <= 0` | FormMessage | — |
| E112 | Purchases | ADMIN | validation | — | Item con `unitPrice < 0` | FormMessage | — |
| E113 | Purchases | ADMIN | error | — | `productId` inexistente/inactivo | Error 400 "producto no existe o está inactivo" | — |
| E114 | Purchases | ADMIN | validation | — | ~~`purchaseDate` futura~~ **DESCARTADO (código)**: `createPurchase` no valida la fecha (solo items: cantidad > 0, precio ≥ 0). El ID se conserva sin reemplazo para no renumerar | — |
| E115 | Purchases | SELLER | rbac | seller | `/dashboard/purchases` (**ruta confirmada**: existe `page.tsx` + `/new/page.tsx`) | Redirect `/dashboard` (sellers no tienen purchases en `ROLE_ROUTES.SELLER`) | — |
| E116 | Purchases | SELLER | rbac | seller | `receivePurchase`/`createPurchase` action directo | 403 | — |

### 3.9 Ventas — `sales.spec.ts`

| ID | Módulo | Rol | Tipo | Precondición | Pasos | Resultado | Datos |
|----|--------|-----|------|--------------|-------|-----------|-------|
| E117 | Sales | ADMIN | happy | — | Listar `/dashboard/sales` | DataTable muestra venta histórica sembrada `PAID` | venta histórica |
| E118 | Sales | ADMIN | happy | productos con stock, store con `lastSaleNumber=1` | `/dashboard/sales/new`, seleccionar customer, agregar 2 items con cantidades, agregar 1 pago (Efectivo) que cubra total, submit | Toast "Venta creada exitosamente", redirect a detalle, `saleNumber` = `<prefix>-000002` (autoincrementa de `store.lastSaleNumber`), `status=PAID` | productos, store |
| E119 | Sales | ADMIN | happy | — | Verificar stock decrementado tras E118 | DB: cada producto `currentStock` reducido; `StockMovement` `OUT` creado con `reference=saleId` y `reason=Venta <saleNumber>` | — |
| E120 | Sales | ADMIN | happy | venta PENDING existe | Marcar PAID (add pago) | `status=PAID` | — |
| E121 | Sales | ADMIN | happy | — | Editar estado de venta a `OVERDUE` (ADMIN `canEditSaleStatus`) | Toast, estado actualizado | — |
| E122 | Sales | ADMIN | happy | venta PAID | Cancelar venta (`canCancelSale`) | SweetAlert2 confirm, `status=CANCELLED`, **stock restaurado — CONFIRMADO (código)**: `cancelSale` crea un `StockMovement` tipo `IN` por cada item (reason `Cancelación de venta <saleNumber>`, `reference=saleId`) dentro de una transacción. Assert en DB: `currentStock` repuesto + movimientos IN presentes | — |
| E123 | Sales | ADMIN | happy | venta PAID | Eliminar venta (soft-delete, `canDeleteSale`) | SweetAlert2, `isDeleted=true`, fila desaparece | — |
| E124 | Sales | ADMIN | validation | — | Submit venta **sin items** | Backend `validateSaleItems` lanza "La venta debe tener al menos un item", toast error | — |
| E125 | Sales | ADMIN | validation | — | Item con `quantity <= 0` | "La cantidad de cada item debe ser mayor a 0" | — |
| E126 | Sales | ADMIN | error | producto stock 3 | Agregar item qty 5 | Error "Stock insuficiente para {name}. Disponible: 3, Requerido: 5" | producto stock 3 |
| E127 | Sales | ADMIN | error | — | Agregar pago con total que difiere >0.01 del total venta | Backend "El total de pagos no coincide con el total de la venta" | — |
| E128 | Sales | ADMIN | error | — | Pago con `paymentMethodId` inexistente/inactivo | "Uno o más métodos de pago no son válidos" | — |
| E129 | Sales | ADMIN | error | — | Agregar item con `unitPrice < 0` | "El precio unitario no puede ser negativo" | — |
| E130 | Sales | ADMIN | state | venta con `saleNumber` ya usado (forzar colisión) | Backend P2002 catch | 409 "Ya existe una venta con ese número" | — |
| E131 | Sales | ADMIN | state | concurrencia simple en mismo `storeId` | Dos ventas submit casi simultáneas (usar `Promise.all` desde UI con delay controlado) | Ambas persisten; `lastSaleNumber` incrementa secuencial sin colisión (verificar 2 `saleNumber` únicos consecutivos) | — |
| E132 | Sales | ADMIN | error | producto `isActive=false` | Agregar item | "Uno o más productos no existen o están inactivos" | — |
| E133 | Sales | ADMIN | happy | sin cliente todavía | `/dashboard/sales/new` → `createCustomerDialog` inline: crear cliente nuevo, luego seleccionarlo | Cliente creado y enlazado. **CONFIRMADO (código)**: `createCustomer` acepta ADMIN y SELLER (`checkAdminOrSellerRole`) — funciona para ambos roles desde la venta | — |
| E134 | Sales | SELLER | happy | logout+login seller | `/dashboard/sales` | DataTable permitida, puede ver ventas | seller |
| E135 | Sales | SELLER | happy | seller | `/dashboard/sales/new`, crear venta válida | Éxito — sellers están explícitamente habilitados para crear ventas (`ROLE_ROUTES.SELLER` incluye `/dashboard/sales` y nested `/new`) | productos |
| E136 | Sales | SELLER | rbac | seller | Intentar editar estado de venta (`canEditSaleStatus`) | UI oculta la acción; si se fuerza llamada server action directa, backend 403 | — |
| E137 | Sales | SELLER | rbac | seller | Intentar cancelar venta (`canCancelSale`) | UI oculta; action directo 403 | — |
| E138 | Sales | SELLER | rbac | seller | Intentar eliminar venta (`canDeleteSale`) | UI oculta; action directo 403 | — |

### 3.10 Usuarios y RBAC mutativo — `users-rbac.spec.ts`

| ID | Módulo | Rol | Tipo | Precondición | Pasos | Resultado | Datos |
|----|--------|-----|------|--------------|-------|-----------|-------|
| E139 | Users | ADMIN | happy | Login admin | `/dashboard/users` muestra 3 usuarios | Filas admin/seller/conflict, columnas rol/estado | 3 users |
| E140 | Users | ADMIN | happy | — | Crear seller con email/username/firstName/lastName/password vía `registerUser`+`organizationId` | Usuario `role=SELLER` creado en la org, sin pasar por onboarding, redirect/refresh | — |
| E141 | Users | ADMIN | happy | — | Editar rol de un seller (no hay otro admin debe poder bajarse a sí mismo — a confirmar) | Toast, rol actualizado | seller |
| E142 | Users | ADMIN | happy | seller activo | Desactivar seller (`isActive=false`) | Toast, usuario desactivado; próxima vez que intente login → E011 | seller |
| E143 | Users | ADMIN | validation | — | Crear seller con `email` ya existente en MISMA org | 409 "Ya existe un usuario con este correo electrónico en esta organización" | admin, seller |
| E144 | Users | ADMIN | validation | — | Crear seller con `username` ya existente en misma org | 409 "Ya existe un usuario con este nombre de usuario en esta organización" | — |
| E145 | Users | ADMIN | validation | — | Password no cumple regex | Mensaje de validación | — |
| E146 | Users | ADMIN | state | `email` de usuario `isDeleted=true` en misma org | Crear con ese email | 409 "Este correo electrónico fue usado previamente en esta organización… contacte a soporte para reactivar" | — |
| E147 | Users | ADMIN | error | — | Uniques **multi-tenant**: crear seller con `email=admin@pos.test` en org B (separada) | (Si existe segunda org) éxito demostrando que el unique es por `organizationId`, no global | segunda org |
| E148 | Users | SELLER | rbac | seller | `/dashboard/users` | Redirect `/dashboard` | — |
| E149 | Users | SELLER | rbac | seller | `registerUser` con `organizationId` via server action directo | 403 `checkAdminRole` (acción cubierta) | — |
| E150 | Users | SELLER | rbac | seller | `updateUserRole` / `deactivateUser` action directo | 403 | — |

### 3.11 Reports — `reports.spec.ts`

| ID | Módulo | Rol | Tipo | Precondición | Pasos | Resultado | Datos |
|----|--------|-----|------|--------------|-------|-----------|-------|
| E151 | Reports | ADMIN | happy | Login admin, existe venta histórica | `/dashboard/reports` | Gráficos Recharts renderizados, KPIs de ventas visibles, sin errores console | venta histórica |
| E152 | Reports | ADMIN | happy | — | Aplicar filtro de rango de fechas | Gráficos actualizan, data coherente (suma total = venta histórica) | — |
| E153 | Reports | ADMIN | state | sin ventas en rango | Aplicar rango sin ventas | UI muestra estado vacío sin crash | — |
| E154 | Reports | ADMIN | validation | — | Rango fecha fin < inicio | FormMessage (si aplica) o Duck de UI | — |
| E155 | Reports | SELLER | rbac | seller | `/dashboard/reports` | Redirect `/dashboard` (reports ADMIN-only explícito en `rbac.ts`) | — |
| E156 | Reports | SELLER | rbac | seller | `getReportData`/server action directo | 403 | — |

> **Nota (verificado 2026-08-11)**: el módulo reports es un **árbol de 20 páginas**, no una sola:
> `/dashboard/reports` (hub) + 4 sub-módulos con sub-páginas — `sales/` (by-category, by-payment,
> by-product, by-seller, detailed), `inventory/` (movements, rotation, stock-status, valuation),
> `financial/` (cash-flow, profit-loss, profitability), `customers/` (retention, segments, top).
> E151–E154 se parametrizan sobre el hub + al menos 1 sub-página por sub-módulo (smoke de render);
> E155 (redirect seller) cubre todo el árbol vía prefijo `/dashboard/reports`. La cobertura profunda
> de cada sub-reporte queda como extensión P2 al escribir `reports.spec.ts`.

### 3.12 Navegación y RBAC por rutas — `navigation-rbac.spec.ts`

> Esta suite **parametriza** todas las rutas del dashboard para validar `hasRouteAccess` de `src/lib/rbac.ts`:
> `(rol, ruta) → permitido | redirect /dashboard`.

| ID | Módulo | Rol | Tipo | Precondición | Pasos | Resultado | Datos |
|----|--------|-----|------|--------------|-------|-----------|-------|
| E157 | Nav | ADMIN | rbac | admin | Para c/u de 13 rutas: navegar directo | Todas cargan (status 200, no redirect), headers `x-user-role=ADMIN` presentes | — |
| E158 | Nav | SELLER | rbac | seller | Navegar `/dashboard` (home) | Permitido, KPIs solo lectura | — |
| E159 | Nav | SELLER | rbac | seller | Navegar `/dashboard/sales` | Permitido | — |
| E160 | Nav | SELLER | rbac | seller | Navegar `/dashboard/sales/new` | Permitido (nested de `/dashboard/sales` por regla `startsWith(route + '/')`) | — |
| E161 | Nav | SELLER | rbac | seller | Navegar `/dashboard/sales/<id>` (detalle) | Permitido (nested) | venta histórica |
| E162 | Nav | SELLER | rbac | seller | Navegar `/dashboard/products` | Redirect `/dashboard` | — |
| E163 | Nav | SELLER | rbac | seller | Navegar `/dashboard/categories` | Redirect `/dashboard` | — |
| E164 | Nav | SELLER | rbac | seller | Navegar `/dashboard/brands` | Redirect `/dashboard` | — |
| E165 | Nav | SELLER | rbac | seller | Navegar `/dashboard/unit-measures` | Redirect `/dashboard` | — |
| E166 | Nav | SELLER | rbac | seller | Navegar `/dashboard/payment-methods` | Redirect `/dashboard` | — |
| E167 | Nav | SELLER | rbac | seller | Navegar `/dashboard/customers` | Redirect `/dashboard` | — |
| E168 | Nav | SELLER | rbac | seller | Navegar `/dashboard/suppliers` | Redirect `/dashboard` | — |
| E169 | Nav | SELLER | rbac | seller | Navegar `/dashboard/stores` | Redirect `/dashboard` | — |
| E170 | Nav | SELLER | rbac | seller | Navegar `/dashboard/users` | Redirect `/dashboard` | — |
| E171 | Nav | SELLER | rbac | seller | Navegar `/dashboard/movements` | Redirect `/dashboard` | — |
| E172 | Nav | SELLER | rbac | seller | Navegar `/dashboard/purchases` | Redirect `/dashboard` (no está en `ROLE_ROUTES.SELLER`) | — |
| E173 | Nav | SELLER | rbac | seller | Navegar `/dashboard/reports` | Redirect `/dashboard` | — |
| E174 | Nav | SELLER | rbac | seller | Trampa anti-prefix: navegar `/dashboard` sin nested no debe matchear `/dashboard/sales`-nested. Navegar `/dashboard/products`**debe caer** en redirect (valida sort longest-first). | Redirect `/dashboard` | — |
| E175 | Nav | GUEST | rbac | sin cookie | Navegar cada ruta protegida | Todas redirect `/auth/login?redirect=<ruta>` | — |
| E176 | Nav | GUEST | rbac | sin cookie | Navegar `/auth/forgot-password`, `/auth/reset-password` | Permitidas (public route), cargan sin redirect | — |
| E177 | Nav | USER | state | cookie `auth-token` con JWT expirado/manipulado | Navegar `/dashboard` | Middleware catch → `redirectToLogin(clearCookie=true)`, cookie eliminada | — |
| E178 | Nav | USER | state | cookie `auth-token` = string basura inválido | Navegar `/dashboard` | Redirect login con cookie eliminada (jose lanza error → catch) | — |
| E179 | Nav | USER | error | `JWT_SECRET` ausente/vacío (forzado vía env en una corrida dedicada) | Navegar `/dashboard` con cookie | Middleware loguea error, redirect login, cookie eliminada | — |
| E180 | Nav | SELLER | rbac | seller | Verificar headers inyectados al server response | Headers `x-user-id`, `x-user-email`, `x-user-role`, `x-organization-id`, `x-store-id` presentes (visibles vía `fetch` log o devtool) | seller |

---

## 4. Suites recomendadas

Estructura de archivos sugerida en `pos-system-client/e2e/`:

```
e2e/
├── globalSetup.ts            # wait-for-app + run seed idempotente
├── globalTeardown.ts         # opcional: limpiar contenedores, reportar QC
├── fixtures/
│   ├── auth.ts              # login/logout, injectToken
│   ├── api.ts               # server-action callers (para RBAC server-side checks)
│   ├── db.ts                # helpers pg para asserts/reset (lockOut, restoreIsActive)
│   └── data.ts              # factories de payloads
├── pages/                    # page objects (ver §2.3)
├── data/
│   ├── factories.ts
│   └── expected-errors.ts
├── auth.spec.ts             # E001–E035, E176            (24 + reset)
├── onboarding.spec.ts       # E036–E042                  (7)
├── dashboard.spec.ts        # E043–E045                  (3)
├── products.spec.ts         # E046–E058                  (13)
├── parametrization.spec.ts  # E059–E079 (categories, brands, unit-measures, payment-methods, stores) (21 — parametrize por módulo)
├── customers-suppliers.spec.ts # E080–E093              (14)
├── inventory.spec.ts        # E094–E104                  (11)
├── purchases.spec.ts        # E105–E116                  (12)
├── sales.spec.ts            # E117–E138                  (22)
├── users-rbac.spec.ts       # E139–E150                  (12)
├── reports.spec.ts          # E151–E156                  (6)
└── navigation-rbac.spec.ts  # E157–E180                  (24 — parametrizada por ruta/rol)
```

**Total**: 180 escenarios.

**Mapeo a clases helper Cross-cutting:**
- **Validación de formularios**: todos los `*validation*` se construyen sobre `CrudPageActions.fillForm(inválido)` +
  `expectFormMessage(textoEsperado)`.
- **RBAC server-side**: los `*_rbac*` con "...action directo" usan el fixture `api.ts` que invoca el server action
  vía el transporte de Next 15 (fetch POST al endpoint interno con el payload serializado), portando la cookie del
  seller y esperando `status=403`.

**Orden de ejecución recomendado (CI):**
1. `globalSetup` → seed → wait-for-app.
2. Grupo A (paralelo, solo lectura): `navigation-rbac`, `dashboard`, `reports`.
3. Grupo B (serial dentro del worker, muta datos): `auth` (lockout usa user dedicado), `onboarding`, `users-rbac`,
   `sales`, `purchases`, `inventory`.
4. Grupo C (paralelo, datos aislados por sufijo): `products`, `parametrization`, `customers-suppliers`.

---

## 5. Cobertura de categorías de dato (entidades sembradas)

| Entidad | Cantidad sembrada | Datos | Unique por org (a ejercitar) | Notas |
|---------|-------------------|-------|------------------------------|-------|
| Organization | 1 | `Pos Demo Org`, isActive | — | Multi-tenant: idealmente sembrar 2ª org para E147 |
| Store | 2 | `Store Central` (prefix `SC`, lastSaleNumber=1), `Store Sucursal Norte` (prefix `SN`, 0) | `name` por org | `saleNumberPrefix` distinto para distinguish en `saleNumber` |
| User | 3 + 2 aux | ADMIN `admin@pos.test`/`Admin123!` (isActive); SELLER `seller@pos.test`/`Seller123!` (storeId=SC); `conflict@pos.test` (sin login) para E017/032/033 | `email`, `username` por org | Auxiliares: `lock@pos.test`/`Lock123!` (E008–E010), `trash@pos.test` con `isDeleted=true` (E034/E146) |
| Category | 3 | `Bebidas`, `Snacks`, `Licores` | `name` | — |
| Brand | 3 | `Marca A`, `Marca B`, `Marca C` | `name` | — |
| UnitMeasure | 3 | `unidad` (`u`), `kg` (`kg`), `litro` (`L`) | `name`, `abbreviation` | — |
| PaymentMethod | 3 | `Efectivo` CASH, `Tarjeta` CARD, `Transferencia` TRANSFER | `name` | Cobertura completa del enum type |
| Supplier | 2 | `Distrib SA` (taxId `1111`), `Mayorista SA` (`2222`) | `taxId` | — |
| Customer | 3 | `Juan Pérez` email/`12345678` DNI; `Ana López`; `Carlos Ruiz` | `email`, `document` | Uno creado con `isDeleted=true` para E022 (test de reactivación si aplica) |
| Product | 5 | con barcode `BC001..BC005`, sku `SKU001..SKU005`, stock variado (uno con stock 3 para E104/E126, otro stock 0 para OOS) | `barcode`, `sku` | Uno `isActive=false` para E132; uno soft-deleted para E055/E062 |
| Purchase | 1 (opcional) | PENDING con 1 item | `purchaseNumber` | facilita E107/E108 |
| Sale | 1 histórica | `PAID`, `SC-000001`, 2 items, 1 pago Efectivo | `saleNumber` (vía store.lastSaleNumber=1) | poblar dashboard/reports y dar base a E118 (siguiente=000002) |
| StockMovement | implícitos | OUT generada por Sale histórica; IN/OUT/ADJUSTMENT se generan en runtime | — | Los tests crean más movimientos y los asserts en DB |
| SystemConfig | 1 | por 成立onboarding sembrado | — | opcional; onload de ADMIN creado por seed directo |
| PasswordResetToken | 0 | se generan en runtime si hay specs de forgot/reset | — | opcional si no se cubre reset en esta versión |

**Contraseñas sembradas**: todas cumplen regex `^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&#]).{8,}`.

---

## 6. Estrategia de aislamiento y reset entre specs

### 6.1 Principio: estado inicial determinista
Cada corrida del plan arranca con la DB en estado idéntico. Esto se logra con un **seed idempotente** ejecutado desde
`globalSetup` antes de cualquier spec.

### 6.2 Implementación del seed idempotente
Ubicación: `pos-system-client/prisma/seed.ts` (script `pnpm db:seed`). Estrategia recomendada:

```ts
// Patrón por entidad (respetando FK order, descendente al borrar, ascendente al crear)
await prisma.stockMovement.deleteMany({});
await prisma.salePayment.deleteMany({});
await prisma.saleItem.deleteMany({});
await prisma.sale.deleteMany({});
await prisma.purchaseItem.deleteMany({});
await prisma.purchase.deleteMany({});
await prisma.product.deleteMany({});
await prisma.customer.deleteMany({});
await prisma.supplier.deleteMany({});
await prisma.paymentMethod.deleteMany({});
await prisma.unitMeasure.deleteMany({});
await prisma.brand.deleteMany({});
await prisma.category.deleteMany({});
await prisma.session.deleteMany({});
await prisma.user.deleteMany({});
await prisma.store.deleteMany({});
await prisma.organization.deleteMany({});
// o bien upsert por unique si se quiere preservar IDs estables
```
> ⚠️ Si se usan **IDs estables** (cuidado con `cuid`) se prefiere `upsert` para que las FKs del seed sean
> deterministas; útil para assert en DB. Si `deleteMany`+`create`, los IDs cambian por corrida y los specs deben
> resolver IDs **vía UI** o consulta DB, nunca hardcoded.

### 6.3 Reset entre specs
- **Specs solo lectura** (`navigation-rbac`, `dashboard`, `reports`): no mutan → corren en paralelo sin reset.
- **Specs que mutan pero revierten**: en `test.afterEach` se hace click en "eliminar" lo creado, o se invoque helper
  DB para `updateMany({where:{name:{startsWith:'Test-'}}, data:{isDeleted:true}})`. Esto deja limpia la próxima.
- **Specs destructores de estado global** (lockout de cuenta, desactivar admin/org/store): usan un **entidad
  dedicada** sembrada para esa prueba (`lock@pos.test`, una org o store extra marcada `isActive=false` temporalmente
  y restaurada en `afterAll`). **Nunca** tocan `admin`/`seller`/`Pos Demo Org` para no acoplar con otros specs.
- **Stock y ventas**: los specs que consumen stock usan productos de prueba con stock amplio (sembrado > 100) o
  consulta DB para obtener el stock actual antes de calcular la qty esperada (assert relativo, no absoluto).
- **Reescalada total**: si una suite queda corrupta (raro), se puede reseedear con `pnpm db:seed` manualmente o
  re-lewnzando `docker compose up`. Configurable como script npm: `pnpm test:e2e:reset`.

### 6.4 Consecuencias de no respetear el aislamiento
- Si dos specs paralelos mutan Products, uno puede borrar lo que el otro espera ver → flakiness.
- Por eso, los specs de mutación de la misma entidad corren **serial** dentro del worker (`test.describe.configure({
  mode: 'serial' })`).

### 6.5 Cómo pedir un reset puntual desde un spec
Helper: `await resetEntity('product')` → invoca `pnpm db:seed:partial product` (script por implementar que runea
solo la sección del seed de Products). Alternativa más simple: reseedear la entidad entera por ID estable con
`upsert`.

---

## 7. Prioridades

| Prioridad | Significado | IDs |
|-----------|-------------|-----|
| **P0 — Crítico (blocker)** | Flujos de auth, RBAC, venta y stock — si fallan el producto es inutilizable | E001, E002, E017, E036, E041, E045, E058, E064, E087, E092, E102, E115, E117, E118, E119, E126, E134, E135, E148, E155, E157, E162–E173 (cada redirect seller), E175 |
| **P1 — Alto (debe pasar pre-release)** | Happy paths de CRUD de cada módulo, validaciones base, lockout, soft-delete | E016, E046–E049, E059, E065, E068, E072, E076, E080, E081, E089, E095–E097, E106, E107, E121, E122, E123, E140, E142, E151, E158–E161 |
| **P2 — Medio (regresión + edge cases)** | Validaciones de formato límite, concurrencia simple, multi-tenant cross-org, multi-error combinado, SweetAlert entradas, headers inyectados | E003–E031, E050–E055, E062, E069–E074, E082–E085, E098–E101, E109–E114, E125, E130–E133, E143–E147, E152–E154, E174, E176–E180 |

**Justificación**: P0 son los ejes donde el sistema se rompe en producción (login falso, seller viendo reports,
stock negativo, venta sin stock). P1 valida que cada módulo funcione como CRUD básico. P2 atrapa regresiones de
validación y casos raros.

**SLA de la suite**: target total < 6 minutos en CI con 2 workers. Si supera 10 min, revisar paralelismo y
marcar specs lentos (P2) como `test.slow()`.

---

## 8. Riesgos y dependencias

### 8.1 Dependencias de infraestructura
- **`prisma/seed.ts`** ✅ ya existe (`pos-system-client/prisma/seed.ts`, idempotente, script `pnpm db:seed` +
  `prisma.seed` configurados en `package.json`). Cubre todas las entidades de §5.
- **`playwright.config.ts` y `e2e/`** ✅ ya inicializados en `pos-system-client/` (config sin `webServer` — asume
  stack docker arriba; `globalSetup` espera readiness y resiembra; fixtures de auth; 2 specs P0 smoke).
- **`docker compose up` como prerequisite**: el `webServer` de Playwright debe esperar a que el client escuche en
  `:3000` y a que el `db` esté `healthy`. Usar `wait-on` o un poll a `/auth/login` en `globalSetup`. Si el stack no
  está listo, todos los specs terminan en timeout no en failure claro.
- **Postgres 17**: el seed usa extensiones/sql específicas de PG17. En CI se puede usar `postgres:17-alpine`.
- **`DATABASE_URL` / `DIRECT_URL`**: deben apuntar a la DB del compose (`pos:pos@db:5432/pos` interno o
  `localhost:5432` desde host). Si se ejecutan tests desde el host contra el contenedor, el seed necesita la URL
  `host`. Documentar la convención.

### 8.2 Dependencias externas y variables
- **JWT_SECRET (CLIENT_JWT_SECRET)**: ≥ 32 chars en `.env` raíz. Si falta, E179 cubre el fallback del middleware
  (redirect login con cookie borrada), pero en CI el test setup debe setearla explícita en env.
- **Imágenes de producto**: se suben a `POST /api/images` y se guardan en `UPLOADS_DIR` (sin servicios externos).
  En E2E basta con omitir la imagen o usar un JPG/PNG pequeño del repo; ver `docs/deployment/imagenes-producto.md`.
- **SweetAlert2**: animaciones de hasta ~300ms antes del botón clickable. Helpers deben usar `getByRole('button',
  {name: /confirmar/i})` con `waitFor` antes de click. Riesgo de flakiness si se clicka antes de abrirse.
- **Recharts**: renderiza en `useEffect` con ResizeObserver. Para screenshots/asserts de layout en reports, esperar
  a que los `<svg>` de chart existan (selector `svg.recharts-surface`) o usar `toHaveScreenshot` conTimeout.
- **sonner Toasts**: aparecer/desaparecen en pocos segundos. Helpers deben `expect(toast).toBeVisible()` sin
  `waitFor` extra largo (default 15s cubre). Para capturar toast efímero, interceptar el evento `toast` custom o
  usar un helper que `await page.getByText(message)` antes del timeout.

### 8.3 Riesgos de flakiness y mitigaciones
- **Server Actions opacos**: Next 15 serializa el RPC en un formato no documentado. Para specs RBAC server-side
  (E058, E064, E088, E093, E103, E116, E136–E138, E149, E150, E156), podría ser difícil "forzar" el action directo
  desde el test. Mitigación: proveer un **endpoint helper de tests** (sólo activo cuando `NODE_ENV=test`) que
  exponga los actions como POST `/__test/actions/<name>` portando la cookie. Sin este helper, los casos
  "action directo → 403" deben ser **unit-tested en Jest/Vitest** (no E2E) y marcados como tales (mover a
  `unit-rbac.spec.ts`). **Decisión postergada al equipo**.
- **Concurrencia** (E131): `Promise.all` de dos submits en la misma UI es difícil de orquestar. Alternativa:
  disparar 2 browser contexts logueados y submitir en paralelo, o inyectar 2 cookies/2 ventas vía API test
  helper. Si no es factible, marcar P2 con "skip en CI, correr manual".
- **Lockout de 15 min** (E008): si el spec falla a mitad, queda la cuenta boqueada y E009/E010 no pueden correr
  serialmente. Mitigación: resetear `lockedUntil` vía DB helper en `afterEach` siempre, incluso en caso de
  failure (try/finally en el helper).
- **Soft-delete único**: si un spec introduce una entidad con nombre `="Test-001"` y la borra, pero el siguiente
  spec intenta crear `="Test-001"` activo, el unique incluye `deletedAt` y **debe permitirlo**. Si falla, hay bug
  en el índice unique (no incluye `deletedAt`) — el test lo atrapa (E055, E062). Documentar el caso como
  "spec canario de integridad del índice soft-delete".
- **Docker compose state**: si un container quedó corrupto o se reinicia a mitad, los specs fallarán con connection
  errors. Mitigación: `globalSetup` debe hacer `docker compose ps` health check y fallar rápido con mensaje claro
  en vez de timeouts difusos.
- **Timezones**: las fechas (`purchaseDate`, `saleDate`, `dueDate`) deben usar UTC para evitar asserts relativos a
  tz del host vs container. Configurar `TZ=UTC` en ambos.

### 8.4 Dependencias con el roadmap de migración (Fase 2/4/5)
- Cualquier spec de este plan debe vivir en `pos-system-client` mientras la lógica no se migre a
  `pos-system-server`. Cuando una acción migra a la API (`pos-system-server`), su spec RBAC server-side debe
  rebasarse contra la Nueva API. Documentar la deuda técnica en `docs/STATUS.md` cuando se.sumen estas pruebas.
- IDs estables en seed ayudan a la migración: si el back-end cambia, los IDs de test no acoplan la suite a
  Prisma IDs volátiles.

### 8.5 Suposiciones — RESUELTAS (verificadas contra el código, 2026-08-11)

Todas las suposiciones de la versión original de este plan fueron validadas leyendo el código fuente
(`rbac.ts`, `middleware.ts`, actions de `sale`/`customer`/`purchase`/`organization`, `schema.prisma`).
Las filas afectadas de la matriz (§3) ya reflejan estas resoluciones:

| # | Duda original | Resolución | Fila(s) |
|---|---------------|------------|---------|
| 1 | ¿`createCustomer` tiene bypass para sellers? | **Sí** — usa `checkAdminOrSellerRole` (`customer.actions.ts`): SELLER puede crear clientes (habilita el diálogo inline de venta). La ruta UI `/dashboard/customers` sigue siendo ADMIN-only vía middleware. | E088, E133 |
| 2 | ¿Cancelar venta repone stock? | **Sí** — `cancelSale` crea `StockMovement IN` por cada item dentro de `$transaction` (reason `Cancelación de venta <n>`, `reference=saleId`). | E122 |
| 3 | ¿Unicidad de `Organization.name`? | **No hay unique en `name`**. La unicidad validada es por **NIT** (`findFirst` + catch P2002 → 409 "Ya existe una organización con ese NIT"). E042 se reescribió sobre NIT. | E036, E042 |
| 4 | ¿Existe `/dashboard/purchases`? | **Sí** — `purchases/page.tsx` + `purchases/new/page.tsx`. No está en `ROLE_ROUTES.ADMIN`, pero **ADMIN bypasea la lista** (`hasRouteAccess` retorna `true` incondicional para ADMIN); SELLER es redirigido por no estar en su lista. Ídem `/dashboard/unit-measures`. | E115, E172 |
| 5 | ¿Regla de `purchaseDate` futura? | **No existe** — `createPurchase` solo valida items (qty > 0, precio ≥ 0), proveedor y productos activos. E114 descartado. | E114 |
| 6 | ¿Comportamiento de `/auth/login` con sesión activa? | El middleware evalúa `isPublicRoute` **antes** de verificar el JWT → retorna `next()` y **muestra el login** (no redirige a dashboard). | E015 |
| 7 | ¿`SystemConfig` y el flujo de onboarding? | `SystemConfig` es key-value con unique `(organizationId, key, deletedAt)`. `createOrganization` persiste `businessType` en SystemConfig y **auto-crea parametrización inicial** (categorías/marcas/unidades/métodos de pago según `liquor_store` / `shoe_store` / genérico). | E036 |
| 8 | Segunda org para E147 | Sigue sin sembrarse — se mantiene **P2 + SKIP si no existe** (sin cambio). | E147 |
| 9 | Validación de `dueDate` | Sin regla específica en `updateSale` (acepta `dueDate` sin validar). Se mantiene P2 exploratorio. | E153/E154 |

**🐛 Hallazgo colateral (candidato a bug — escenario canario):** `generatePurchaseNumber`
(`purchase.actions.ts`) genera `COMP-YYYYMMDD-NNNN` contando las compras del día **sin filtrar por
`organizationId`**. En multi-tenant real, dos orgs comprando el mismo día se cruzan la secuencia
(fuga de volumen cross-tenant y riesgo de colisión bajo concurrencia). Registrarlo como escenario
canario al escribir `purchases.spec.ts` y como deuda a corregir en la migración Fase 1/2.

---

## 9. Próximos pasos (fuera de este plan)

1. ~~Confirmar las suposiciones de §8.5~~ ✅ **Resueltas contra el código (2026-08-11)** — ver tabla en §8.5.
2. ~~Implementar `prisma/seed.ts` idempotente + script `pnpm db:seed`~~ ✅ Hecho (`pos-system-client/prisma/seed.ts`).
3. ~~Inicializar Playwright en `pos-system-client/` con `globalSetup`~~ ✅ Hecho (config + globalSetup + fixtures + 2 specs P0 smoke).
4. **Probar el stack `docker compose up` end-to-end y correr los smoke P0** (bloqueado hasta liberar disco — ver STATUS).
5. Construir fixtures y page objects restantes (§2.3, §2.4: `api.ts`, `db.ts`, factories, page objects).
6. Implementar suites en orden de prioridad P0 → P1 → P2 (con el stack arriba, usar los subagentes `playwright-test-generator` / `playwright-test-healer`).
7. Añadir helper de tests endpoint (`/__test/actions`) o decidir mover RBAC server-side a Vitest (§8.3).
8. Corregir el bug canario de `generatePurchaseNumber` (sin filtro de `organizationId` — ver §8.5) o cubrirlo como known-issue en `purchases.spec.ts`.
9. (Migración Fase 2+) Cuando un action migre a `pos-system-server`, migrar el spec correspondiente y rebaseline.

---

## Apéndice A — Mapa rápido de rutas y roles

| Ruta | ADMIN | SELLER | Middleware check | Action guard |
|------|-------|--------|------------------|--------------|
| `/auth/login` `/auth/register` `/auth/forgot-password` `/auth/reset-password` | público | público | `isPublicRoute` | n/a |
| `/` | ✅ | ✅ (home) | `isProtectedRoute` + JWT | n/a |
| `/onboarding` | ✅ si sin org | ✅ si sin org | `isOnboardingRoute + organizationId` → redirect dashboard | n/a |
| `/dashboard` | ✅ | ✅ (solo lectura) | `hasRouteAccess` | — |
| `/dashboard/brands` | ✅ | ❌ redirect `/dashboard` | `hasRouteAccess` | `checkAdminRole` |
| `/dashboard/categories` | ✅ | ❌ | `hasRouteAccess` | `checkAdminRole` |
| `/dashboard/customers` | ✅ | ❌ | `hasRouteAccess` | `checkAdminRole` (¿excepción sale inline? TBD E088) |
| `/dashboard/movements` | ✅ | ❌ | `hasRouteAccess` | `checkAdminRole` |
| `/dashboard/payment-methods` | ✅ | ❌ | `hasRouteAccess` | `checkAdminRole` |
| `/dashboard/products` | ✅ | ❌ | `hasRouteAccess` | `checkAdminRole` |
| `/dashboard/reports` | ✅ | ❌ | `hasRouteAccess` (ADMIN ONLY explícito) | `checkAdminRole` |
| `/dashboard/sales` (`/new`, detalle) | ✅ | ✅ | `hasRouteAccess` | mutaciones `canEditSaleStatus`/`canCancelSale`/`canDeleteSale` ADMIN only |
| `/dashboard/stores` | ✅ | ❌ | `hasRouteAccess` | `checkAdminRole` |
| `/dashboard/suppliers` | ✅ | ❌ | `hasRouteAccess` | `checkAdminRole` |
| `/dashboard/unit-measures` | ✅ | ❌ | `hasRouteAccess` | `checkAdminRole` |
| `/dashboard/users` | ✅ | ❌ | `hasRouteAccess` | `checkAdminRole` |
| `/dashboard/purchases` (`/new`) | ✅ | ❌ | `hasRouteAccess` | `checkAdminRole` |

> **Nota RBAC (verificado)**: `hasRouteAccess` retorna `true` incondicional para ADMIN — la lista
> `ROLE_ROUTES.ADMIN` es documental (de hecho no incluye `/dashboard/purchases` ni
> `/dashboard/unit-measures` y ambas rutas funcionan para ADMIN). El control efectivo es: ADMIN = todo,
> SELLER = solo su lista (`/dashboard` exacto + `/dashboard/sales` con nested). `/dashboard/reports`
> es un árbol de 20 páginas (ver nota en §3.11); el redirect de seller cubre todo el subárbol por prefijo.

## Apéndice B — Constantes de seguridad confirmadas

- `MAX_LOGIN_ATTEMPTS = 5` (`src/actions/auth/login.ts:26`)
- `LOCK_DURATION_MINUTES = 15` (`src/actions/auth/login.ts:27`)
- Cookie: `auth-token`, httpOnly, `secure` = `process.env.HTTPS_ENABLED === 'true'` (false en local), `sameSite=lax`.
- Session TTL: 7 días (o 30 con rememberMe).
- bcrypt saltRounds = 12.