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
├── maintenance/     # Guías operativas recurrentes
└── agents/          # Configuración de las skills de ingeniería para agentes
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
| [features/purchase/CONSECUTIVO_COMPRAS.md](./features/purchase/CONSECUTIVO_COMPRAS.md) | Especificación del consecutivo diario UTC por organización y límites de concurrencia | POS-02a en revisión |
| [features/testing/playwright-test-plan.md](./features/testing/playwright-test-plan.md) | Plan de pruebas E2E (Playwright): matriz de 180 escenarios, suites, seed idempotente, RBAC dual-layer (middleware + server actions) | ✅ Plan cerrado (suposiciones verificadas contra código) — faltan probar stack + specs P1/P2 |
| [features/testing/SEED-DESDE-CERO.md](./features/testing/SEED-DESDE-CERO.md) | Instalación limpia con migraciones, fixtures de dos tenants y verificación repetible | Implementado; validación descrita en STATUS |
| [features/testing/RUNBOOK.md](./features/testing/RUNBOOK.md) | Cómo correr la suite E2E: docker compose + seed + specs, credenciales sembradas, troubleshooting | ✅ Listo — pendiente primera corrida contra el stack |
| `features/loyalty-program/`, `features/discounts/`, `features/taxes/` | — | Sin documentación |

### Autenticación y autorización

| Documento | Descripción |
|-----------|-------------|
| [AUTH_TARGET_SCHEMA.md](./auth/AUTH_TARGET_SCHEMA.md) | **Postura de target de auth** — decisiones D3, schema Prisma target, JWT claims, refresh rotation, gaps a cerrar. Fuente de verdad para Fase 1/2. |
| [AUTH_DEVELOPER_GUIDE.md](./auth/AUTH_DEVELOPER_GUIDE.md) | Sistema de autenticación JWT para desarrolladores (legacy — se reescribe en Fase 2) |
| [AUTHORIZATION_GUIDE.md](./auth/AUTHORIZATION_GUIDE.md) | Autorización y RBAC (Admin/Seller) |
| [MIDDLEWARE_AUTH.md](./auth/MIDDLEWARE_AUTH.md) | Middleware de autenticación Next.js |
| [LOGOUT_STATE_CLEANUP.md](./auth/LOGOUT_STATE_CLEANUP.md) | Limpieza de estado al cerrar sesión |

### Deployment y producción

| Documento | Descripción |
|-----------|-------------|
| [estrategia-despliegue.md](./deployment/estrategia-despliegue.md) | Estrategia global: local (docker-compose) + testing (Vercel+Supabase) + prod (VPS+Coolify+Postgres) |
| [deploy-vercel-monorepo.md](./deployment/deploy-vercel-monorepo.md) | Paso a paso para deployar el client en Vercel desde el monorepo (testing con Supabase) |
| [docker-local.md](./deployment/docker-local.md) | Levantar el stack completo local con `docker compose up` |
| [imagenes-producto.md](./deployment/imagenes-producto.md) | Imágenes de producto en volumen persistente (Coolify), `StorageProvider` y variables |
| [PM2_DEPLOYMENT_GUIDE.md](./deployment/PM2_DEPLOYMENT_GUIDE.md) | Deploy con PM2 en producción (legacy) |
| [SELF-HOST.MD](./deployment/SELF-HOST.MD) | Self-hosting (legacy) |
| [ssl-troubleshooting-nginx-cloudflare-oracle.md](./deployment/ssl-troubleshooting-nginx-cloudflare-oracle.md) | SSL con Nginx + Cloudflare + OCI (legacy) |
| [fix-database-ssl-production.md](./deployment/fix-database-ssl-production.md) | Fix de SSL de base de datos en producción |
| [DATABASE_REMOTE_ACCESS.md](./deployment/DATABASE_REMOTE_ACCESS.md) | Acceso remoto a PostgreSQL |
| [ROUTER_REDIRECT_FIX.md](./deployment/ROUTER_REDIRECT_FIX.md) | Fix de redirección en App Router |

Scripts relacionados: `pos-system-client/scripts/` (`deploy-fix-ssl.sh`, `quick-restart-pm2.sh`).

### Mantenimiento

| Documento | Descripción |
|-----------|-------------|
| [DEPENDENCIES_UPDATE.md](./maintenance/DEPENDENCIES_UPDATE.md) | Guía de actualización de dependencias |

### Agentes

| Documento | Descripción |
|-----------|-------------|
| [issue-tracker.md](./agents/issue-tracker.md) | Cómo las skills de agentes usan GitHub Issues (`gh`) y las convenciones del equipo (etiquetas, títulos, ramas, PR) |
| [domain.md](./agents/domain.md) | Dónde leen las skills el contexto del dominio: `STATUS.md`, `GLOSSARY.md` y `docs/adr/` |

## Convenciones

1. **Doc nuevo** → carpeta de su categoría. **Feature nuevo** → `features/<nombre-del-feature>/`.
2. Todo doc empieza con: objetivo, fecha y estado (Pendiente / En progreso / Completado).
3. Al agregar un doc, **actualizar este índice** en el mismo commit.
4. Al completar trabajo que cambia el estado del proyecto, **actualizar `STATUS.md`** en el mismo commit.
5. Los docs se escriben en español; nombres de archivo descriptivos (no renombrar existentes sin actualizar referencias).
