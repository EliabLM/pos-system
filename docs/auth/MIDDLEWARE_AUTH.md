> **Histórico.** Desde #19 (CC-POS-11) la autenticación es Better Auth y este documento describe el JWT propio que se eliminó. Estado actual: `pos-system-client/AGENTS.md` (Auth) y `docs/STATUS.md`.

# 🛡️ MIDDLEWARE DE AUTENTICACIÓN

**Versión:** 2.0 (Auth Manual)
**Fecha:** 2025-01-10

---

## 📋 DESCRIPCIÓN GENERAL

El middleware de autenticación protege las rutas de la aplicación, verifica tokens JWT, y maneja redirecciones basadas en el estado del usuario y su organización.

**Ubicación:** `src/middleware.ts`

---

## 🔐 RUTAS PÚBLICAS (Sin Autenticación)

Estas rutas NO requieren autenticación y son accesibles sin token:

```typescript
✅ /auth/login              // Página de login
✅ /auth/register           // Página de registro
✅ /auth/forgot-password    // Recuperación de contraseña
✅ /auth/reset-password     // Reset de contraseña

✅ /api/auth/login          // API endpoint de login
✅ /api/auth/register       // API endpoint de registro
✅ /api/auth/forgot-password // API de recuperación
✅ /api/auth/reset-password  // API de reset
```

---

## 🔒 RUTAS PROTEGIDAS (Requieren Autenticación)

Estas rutas requieren un token JWT válido:

```typescript
🔒 /dashboard/*     // Dashboard principal
🔒 /onboarding/*    // Proceso de onboarding

🔒 /api/auth/logout // API endpoint de logout
```

---

## 🚀 FLUJO DE AUTENTICACIÓN

### 1. Usuario NO Autenticado

```
Request a /dashboard
    ↓
[Middleware] No hay token
    ↓
Redirect → /auth/login?redirect=/dashboard
```

### 2. Usuario con Token Inválido/Expirado

```
Request a /dashboard con token expirado
    ↓
[Middleware] Verifica JWT
    ↓
JWT inválido/expirado
    ↓
Clear cookie 'auth-token'
    ↓
Redirect → /auth/login?redirect=/dashboard
```

### 3. Usuario Autenticado SIN Organización

```
Request a /dashboard con token válido
    ↓
[Middleware] Verifica JWT
    ↓
JWT válido, organizationId = null
    ↓
Redirect → /onboarding
```

### 4. Usuario Autenticado CON Organización

```
Request a /dashboard con token válido
    ↓
[Middleware] Verifica JWT
    ↓
JWT válido, organizationId = "org-123"
    ↓
Agregar headers:
  - x-user-id
  - x-user-email
  - x-user-role
  - x-organization-id
  - x-store-id (si existe)
    ↓
Permitir acceso → /dashboard
```

### 5. Usuario CON Organización en Onboarding

```
Request a /onboarding con token válido
    ↓
[Middleware] Verifica JWT
    ↓
JWT válido, organizationId = "org-123"
    ↓
Usuario ya tiene organización
    ↓
Redirect → /dashboard
```

---

## 📊 ROLE-BASED REDIRECTS

### Onboarding → Dashboard

**Condición:** Usuario en `/onboarding` pero ya tiene `organizationId`

```typescript
if (isOnboardingRoute(pathname) && organizationId) {
  return redirectToDashboard(request);
}
```

**Ejemplo:**
```
Usuario completa onboarding → organizationId = "org-123"
Usuario intenta volver a /onboarding
Middleware detecta organizationId
Redirect automático → /dashboard
```

### Dashboard → Onboarding

**Condición:** Usuario sin `organizationId` intenta acceder a `/dashboard`

```typescript
if (isDashboardRoute(pathname) && !organizationId) {
  return redirectToOnboarding(request);
}
```

**Ejemplo:**
```
Nuevo usuario se registra → organizationId = null
Usuario intenta ir a /dashboard
Middleware detecta falta de organización
Redirect automático → /onboarding
```

---

## 🎯 HEADERS AGREGADOS

El middleware agrega headers personalizados para server components:

| Header | Tipo | Descripción |
|--------|------|-------------|
| `x-user-id` | string | ID del usuario autenticado |
| `x-user-email` | string | Email del usuario |
| `x-user-role` | string | Rol del usuario (ADMIN/SELLER) |
| `x-organization-id` | string? | ID de la organización (opcional) |
| `x-store-id` | string? | ID de la tienda (opcional) |

---

## 💻 USO EN SERVER COMPONENTS

### Opción 1: Helper Functions (Recomendado)

```typescript
import { getUserFromHeaders, requireUser } from '@/lib/auth/server';

// Obtener usuario (puede ser null)
export default async function MyPage() {
  const user = await getUserFromHeaders();

  if (!user) {
    redirect('/auth/login');
  }

  return <div>Welcome {user.email}</div>;
}

// Requerir usuario (lanza error si no existe)
export default async function ProtectedPage() {
  const user = await requireUser(); // Error si no autenticado

  return <div>User ID: {user.userId}</div>;
}
```

### Opción 2: Leer Headers Directamente

```typescript
import { headers } from 'next/headers';

export default async function MyPage() {
  const headersList = await headers();
  const userId = headersList.get('x-user-id');
  const organizationId = headersList.get('x-organization-id');

  return <div>User: {userId}, Org: {organizationId}</div>;
}
```

### Opción 3: Helpers Específicos

```typescript
import {
  getUserIdFromHeaders,
  getOrganizationIdFromHeaders,
  isAdminUser,
  hasRole,
} from '@/lib/auth/server';

export default async function AdminPage() {
  const isAdmin = await isAdminUser();

  if (!isAdmin) {
    return <div>Access Denied</div>;
  }

  const orgId = await getOrganizationIdFromHeaders();

  return <div>Admin Panel - Org: {orgId}</div>;
}
```

---

## 🧪 ESCENARIOS DE TESTING

### Escenario 1: Usuario No Autenticado

```bash
# Request
GET /dashboard

# Expectativa
Status: 307 (Redirect)
Location: /auth/login?redirect=/dashboard
```

### Escenario 2: Token Expirado

```bash
# Request
GET /dashboard
Cookie: auth-token=expired.jwt.token

# Expectativa
Status: 307 (Redirect)
Location: /auth/login?redirect=/dashboard
Set-Cookie: auth-token=; Max-Age=0 (clear cookie)
```

### Escenario 3: Usuario Sin Organización

```bash
# Request
GET /dashboard
Cookie: auth-token=valid.jwt.token
JWT Payload: { organizationId: null }

# Expectativa
Status: 307 (Redirect)
Location: /onboarding
```

### Escenario 4: Usuario Con Organización

```bash
# Request
GET /dashboard
Cookie: auth-token=valid.jwt.token
JWT Payload: { organizationId: "org-123" }

# Expectativa
Status: 200 (OK)
Headers:
  x-user-id: "user-123"
  x-user-email: "user@example.com"
  x-user-role: "ADMIN"
  x-organization-id: "org-123"
```

### Escenario 5: Usuario en Onboarding con Org

```bash
# Request
GET /onboarding
Cookie: auth-token=valid.jwt.token
JWT Payload: { organizationId: "org-123" }

# Expectativa
Status: 307 (Redirect)
Location: /dashboard
```

### Escenario 6: Ruta Pública

```bash
# Request
GET /auth/login

# Expectativa
Status: 200 (OK)
Sin verificación de token
```

---

## 🔧 CONFIGURACIÓN

### Variables de Entorno Requeridas

```bash
JWT_SECRET=your-super-secret-jwt-key-min-32-chars
```

⚠️ **Importante:** JWT_SECRET debe tener al menos 32 caracteres para seguridad.

### Matcher Configuration

El middleware se ejecuta en TODAS las rutas excepto:

```typescript
- _next/static/*     // Archivos estáticos de Next.js
- _next/image/*      // Optimización de imágenes
- favicon.ico        // Favicon
- *.svg, *.png, *.jpg, *.jpeg, *.gif, *.webp, *.ico
- *.css, *.js        // Assets estáticos
```

---

## 🛠️ HELPERS DISPONIBLES

### Server Component Helpers

```typescript
// Obtener información del usuario
getUserFromHeaders(): Promise<UserFromHeaders | null>
getUserIdFromHeaders(): Promise<string | null>
getOrganizationIdFromHeaders(): Promise<string | null>
getStoreIdFromHeaders(): Promise<string | null>

// Verificación de roles
hasRole(requiredRole: string): Promise<boolean>
isAdminUser(): Promise<boolean>

// Requerir autenticación (lanza error si no existe)
requireUser(): Promise<UserFromHeaders>
requireOrganizationId(): Promise<string>
```

### Types

```typescript
interface UserFromHeaders {
  userId: string;
  email: string;
  role: string;
  organizationId: string | null;
  storeId: string | null;
}
```

---

## ⚡ PERFORMANCE

### Cache y Optimización

- ✅ Headers son agregados una sola vez por request
- ✅ JWT verificado solo una vez por request
- ✅ Sin queries a base de datos en el middleware
- ✅ Compatible con Edge Runtime (usa `jose`)

### Tiempo de Ejecución

- JWT Verification: ~1-2ms
- Header manipulation: <1ms
- **Total:** ~2-3ms por request

---

## 🚨 MANEJO DE ERRORES

### JWT_SECRET No Definido

```typescript
if (!secret || secret.length === 0) {
  console.error('JWT_SECRET is not defined');
  return redirectToLogin(request, true);
}
```

### Token Malformado

```typescript
catch (error) {
  console.error('JWT verification error:', error);
  return redirectToLogin(request, true);
}
```

### Token Expirado

```typescript
// jose lanza error automáticamente
// Middleware captura y redirige a login
```

---

## 📝 EJEMPLOS DE USO COMPLETOS

### Example 1: Dashboard Page

```typescript
// src/app/dashboard/page.tsx
import { requireUser } from '@/lib/auth/server';

export default async function DashboardPage() {
  // Requerir usuario autenticado
  const user = await requireUser();

  return (
    <div>
      <h1>Welcome to Dashboard</h1>
      <p>User: {user.email}</p>
      <p>Role: {user.role}</p>
    </div>
  );
}
```

### Example 2: Admin-Only Page

```typescript
// src/app/dashboard/admin/page.tsx
import { requireUser, isAdminUser } from '@/lib/auth/server';
import { redirect } from 'next/navigation';

export default async function AdminPage() {
  const user = await requireUser();
  const isAdmin = await isAdminUser();

  if (!isAdmin) {
    redirect('/dashboard');
  }

  return (
    <div>
      <h1>Admin Panel</h1>
      <p>Welcome Admin: {user.email}</p>
    </div>
  );
}
```

### Example 3: Organization-Scoped Page

```typescript
// src/app/dashboard/products/page.tsx
import { requireOrganizationId } from '@/lib/auth/server';
import { prisma } from '@/actions/utils';

export default async function ProductsPage() {
  const organizationId = await requireOrganizationId();

  const products = await prisma.product.findMany({
    where: {
      organizationId,
      isDeleted: false,
    },
  });

  return (
    <div>
      <h1>Products</h1>
      <p>Organization: {organizationId}</p>
      <p>Total Products: {products.length}</p>
    </div>
  );
}
```

---

## 🔄 FLUJO COMPLETO DE LOGIN

```
1. Usuario visita /auth/login
   ↓
2. Ingresa credenciales y submit
   ↓
3. Server action loginUser() valida y crea sesión
   ↓
4. Set cookie 'auth-token' con JWT
   ↓
5. Redirect a /dashboard
   ↓
6. Middleware intercepta request
   ↓
7. Verifica JWT del cookie
   ↓
8. Extrae organizationId del payload
   ↓
9a. Si organizationId existe → Agrega headers y permite acceso
9b. Si organizationId es null → Redirect a /onboarding
```

---

## 🔍 DEBUGGING

### Habilitar Logs

```typescript
// En middleware.ts, descomentar:
console.log('Pathname:', pathname);
console.log('Token:', token ? 'present' : 'missing');
console.log('Payload:', payload);
```

### Verificar Headers en Server Component

```typescript
import { headers } from 'next/headers';

export default async function DebugPage() {
  const headersList = await headers();

  return (
    <div>
      <h1>Debug Headers</h1>
      <pre>
        User ID: {headersList.get('x-user-id')}
        Email: {headersList.get('x-user-email')}
        Role: {headersList.get('x-user-role')}
        Org ID: {headersList.get('x-organization-id')}
        Store ID: {headersList.get('x-store-id')}
      </pre>
    </div>
  );
}
```

---

## ✅ CHECKLIST DE IMPLEMENTACIÓN

- [x] Middleware configurado en `src/middleware.ts`
- [x] Rutas públicas definidas
- [x] Rutas protegidas definidas
- [x] JWT verification con `jose`
- [x] Role-based redirects (onboarding ↔ dashboard)
- [x] Headers agregados para server components
- [x] Helpers creados en `@/lib/auth/server`
- [x] JWT_SECRET en `.env`
- [x] Matcher configurado correctamente
- [x] Error handling implementado
- [x] Documentación completa

---

**Última actualización:** 2025-01-10
**Versión:** 2.0
**Estado:** ✅ COMPLETADO
