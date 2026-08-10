# Documentación del Sistema POS

> **¿Primera sesión? Empezá por [`STATUS.md`](./STATUS.md)** — estado actual del proyecto y próximo paso.

## Estructura

```
docs/
├── STATUS.md        # Estado actual y próximo paso — leer primero, actualizar siempre
├── planning/        # Análisis y planes de alto nivel
├── features/        # Una carpeta por feature (specs y planes de implementación)
├── auth/            # Autenticación y autorización
├── deployment/      # Deploy, SSL, infraestructura y fixes de producción
└── maintenance/     # Guías operativas recurrentes
```

## Índice

### Planificación

| Documento | Descripción |
|-----------|-------------|
| [migracion-3-proyectos.md](./planning/migracion-3-proyectos.md) | Plan de migración del monolito a 3 proyectos (server/app/client) — fases, recetas, orden topológico |
| [ANALISIS_FEATURES_Y_OPORTUNIDADES.md](./planning/ANALISIS_FEATURES_Y_OPORTUNIDADES.md) | Comparativa con POS del mercado; 47 oportunidades identificadas |

### Features

| Documento | Descripción | Estado |
|-----------|-------------|--------|
| [features/offline-mode/](./features/offline-mode/PLAN_IMPLEMENTACION_OFFLINE_MODE.md) | Plan en 5 fases para capacidad offline (PWA) | 📋 Pendiente — prioridad alta |
| [features/purchase/](./features/purchase/PLAN_MODULO_COMPRAS.md) | Plan del módulo de compras | 📋 Pendiente |
| `features/loyalty-program/`, `features/discounts/`, `features/taxes/` | — | Sin documentación |

### Autenticación y autorización

| Documento | Descripción |
|-----------|-------------|
| [AUTH_DEVELOPER_GUIDE.md](./auth/AUTH_DEVELOPER_GUIDE.md) | Sistema de autenticación JWT para desarrolladores |
| [AUTHORIZATION_GUIDE.md](./auth/AUTHORIZATION_GUIDE.md) | Autorización y RBAC (Admin/Seller) |
| [MIDDLEWARE_AUTH.md](./auth/MIDDLEWARE_AUTH.md) | Middleware de autenticación Next.js |
| [LOGOUT_STATE_CLEANUP.md](./auth/LOGOUT_STATE_CLEANUP.md) | Limpieza de estado al cerrar sesión |

### Deployment y producción

| Documento | Descripción |
|-----------|-------------|
| [PM2_DEPLOYMENT_GUIDE.md](./deployment/PM2_DEPLOYMENT_GUIDE.md) | Deploy con PM2 en producción |
| [SELF-HOST.MD](./deployment/SELF-HOST.MD) | Self-hosting |
| [ssl-troubleshooting-nginx-cloudflare-oracle.md](./deployment/ssl-troubleshooting-nginx-cloudflare-oracle.md) | SSL con Nginx + Cloudflare + OCI |
| [fix-database-ssl-production.md](./deployment/fix-database-ssl-production.md) | Fix de SSL de base de datos en producción |
| [DATABASE_REMOTE_ACCESS.md](./deployment/DATABASE_REMOTE_ACCESS.md) | Acceso remoto a PostgreSQL |
| [ROUTER_REDIRECT_FIX.md](./deployment/ROUTER_REDIRECT_FIX.md) | Fix de redirección en App Router |

Scripts relacionados: `pos-system-client/scripts/` (`deploy-fix-ssl.sh`, `quick-restart-pm2.sh`).

### Mantenimiento

| Documento | Descripción |
|-----------|-------------|
| [DEPENDENCIES_UPDATE.md](./maintenance/DEPENDENCIES_UPDATE.md) | Guía de actualización de dependencias |

## Convenciones

1. **Doc nuevo** → carpeta de su categoría. **Feature nuevo** → `features/<nombre-del-feature>/`.
2. Todo doc empieza con: objetivo, fecha y estado (Pendiente / En progreso / Completado).
3. Al agregar un doc, **actualizar este índice** en el mismo commit.
4. Al completar trabajo que cambia el estado del proyecto, **actualizar `STATUS.md`** en el mismo commit.
5. Los docs se escriben en español; nombres de archivo descriptivos (no renombrar existentes sin actualizar referencias).
