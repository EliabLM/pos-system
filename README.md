# pos-system

Sistema POS (Point of Sale) multi-tenant en migración de monolito a 3 proyectos.

## Descripción

Sistema de punto de venta multi-tenant (multi-organization) construido sobre Next.js 15, Prisma/PostgreSQL y autenticación con Better Auth (correo y contraseña). Soporta gestión de productos, marcas, categorías, ventas, pagos, movimientos de stock, usuarios y tiendas con RBAC (Admin/Seller). Deploy self-hosted con PM2 + Nginx + Cloudflare sobre Oracle Cloud Infrastructure.

El proyecto está en plena migración incremental (strangler-fig) desde un monolito Next.js hacia una arquitectura de 3 componentes:

- **`pos-system-client/`** — Web POS (Next.js 15 App Router, React 19, Prisma, shadcn/ui, Zustand, TanStack Query). Contiene toda la lógica de negocio hoy.
- **`pos-system-server/`** — API backend (Express 5 + TypeScript, Clean Architecture + SOLID). Scaffold listo, sin módulos de dominio todavía.
- **`pos-system-app/`** — App móvil (Expo SDK 57 + React Native + expo-router). Scaffold listo, sin features de negocio todavía.
- **`packages/`** — Paquetes compartidos: `dto-types`, `api-client`, `design-tokens` (scaffolds vacíos).

## Stack

- **Frontend**: Next.js 15, React 19, Tailwind CSS v4, shadcn/ui, TanStack Query + Table, Zustand, Recharts
- **Backend**: Express 5, TypeScript, Vitest, Zod validation (destino: Node 22 LTS)
- **Mobile**: Expo SDK 57, expo-router
- **DB**: PostgreSQL (Supabase) + Prisma ORM 6
- **Auth**: Better Auth (sesiones en BD, límite de intentos de login), RBAC Admin/Seller
- **Infra**: PM2, Nginx, Cloudflare, Oracle Cloud

## Documentación

Toda la documentación vive en `docs/`. Empezar por [`docs/STATUS.md`](docs/STATUS.md) — estado actual y próximo paso.

- [`docs/planning/migracion-3-proyectos.md`](docs/planning/migracion-3-proyectos.md) — plan de migración detallado (fases, orden topológico)
- [`docs/auth/`](docs/auth/) — autenticación, RBAC, middleware (los documentos del JWT son históricos)
- [`docs/deployment/`](docs/deployment/) — PM2, SSL, Cloudflare, DB remoto
- [`docs/features/`](docs/features/) — planes de features (offline-mode, compras)

## Estado

Fase 1 pasos 1–3 implementados: schema del server, Decimal/UUIDv7/RLS y auth basada en memberships. Sin datos reales que migrar; el siguiente hito es validar instalación limpia con migraciones y seed sintético de dos organizaciones, seguido por regresión de aplicación y aislamiento entre tenants.

Ver [`docs/STATUS.md`](docs/STATUS.md) para el detalle y la deuda técnica conocida (Float→Decimal, cuid→UUID v7, RLS en Postgres).


## Inicialización con datos sintéticos

Ver [SEED-DESDE-CERO.md](docs/features/testing/SEED-DESDE-CERO.md): PostgreSQL 17 dedicado, migraciones existentes, seed transaccional con dos tenants y verificación repetible. El seed reemplaza datos de prueba y requiere `POS_SEED_ALLOW_RESET=1`; no se ejecuta automáticamente al iniciar la aplicación.
