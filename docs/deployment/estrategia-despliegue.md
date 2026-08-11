# Estrategia de despliegue

> **Objetivo:** definir dónde y cómo corre cada uno de los 3 proyectos del monorepo
> durante la migración y en producción, para que testing y producción estén
> claramente separados y un `docker compose up` baste para probar todo local.
>
> **Fecha:** 2026-08-10 · **Estado:** En progreso (definición)

## Resumen ejecutivo

| Entorno | Plataforma | DB | Qué corre | Cuándo |
|---------|-----------|----|-----------|--------|
| **Local** (dev/testing del monorepo) | `docker compose up` | Postgres 17 en el stack | `db` + `server` + `client` + (`app` web opcional) | Siempre que se quiera reproducir el stack |
| **Testing / staging** | **Vercel** | **Supabase** (Postgres gestionado) | Solo `pos-system-client` (server actions → Supabase) | Desde ahora, hasta que el server HTTP exista en prod |
| **Producción** | **VPS + Coolify** | **Postgres en el mismo VPS** | Los 3 proyectos (client + server + app web) vía `docker-compose.yml` | A partir de Fase 2 (server con auth) |

## Decisión: por qué estos stacks

- **Test = Vercel + Supabase:** provisioning rápido y HTTPS/CI automáticos. El
  client es Next.js puro, server actions conectan directo a Supabase y no se
  necesita deployar el server todavía (no tiene dominio). Costo bajo para pruebas.
- **Prod = VPS + Coolify + Postgres local:** control total del runtime (Node 22,
  Postgres 17, RLS, roles non-owner, pooling del propio Postgres). Mismo
  `docker-compose.yml` del repo corre en el VPS vía Coolify → un solo artefacto
  reproducible local y en prod. Postgres en el mismo host reduce latencia de red
  y simplifica backups (volumen Coolify/vps).
- **Coolify** soporta deploy por Dockerfile / Compose. Usaremos el `docker-compose.yml`
  del repo (el mismo de local) con un override de producción
  (`docker-compose.prod.yml`) para: TLS, variables reales, restart policies, y el
  proxy inverso que Coolify ya aporta (traefik/Caddy interno) — sin que nosotros
  mantengamos Nginx.

## Fases de la migración vs despliegue

Cada fase del plan de migración
([`planning/migracion-3-proyectos.md`](../planning/migracion-3-proyectos.md))
afecta qué se deploya:

| Fase | Local | Testing (Vercel+Supabase) | Producción (VPS+Coolify+Postgres) |
|------|-------|---------------------------|----------------------------------|
| Pre-Fase 1 (ahora) | `docker compose up` listo | client en Vercel + Supabase | pendiente de VPS |
| Fase 1 (DB foundation) | `docker compose up` | client sigue en Vercel + Supabase | migrar DB a Postgres del VPS (RLS, UUIDv7, Decimal) |
| Fase 2 (auth surface) | `docker compose up` | client + server (server ya en VPS) | server corre en VPS; client aún en Vercel o ya en VPS |
| Fase 3 (strangler fig) | `docker compose up` | client + server (Vercel + VPS server) o todo en VPS | todo en VPS |
| Fase 4 (app móvil) | `pnpm start` fuera de docker (dispositivo) | EAS Build/Update (ver skill `react-native-expo`) | EAS → store / APK firmado |
| Fase 5 (cleanup) | client UI-only | client UI-only consume API | idem |

## Local — `docker compose up`

Ver [`docker-local.md`](./docker-local.md). Un solo comando monta:

```
db       Postgres 17    :5432
server   Express        :3001
client   Next.js        :3000   (aplica migraciones Prisma al arrancar)
app      Expo web       :8082   (profile `app`; opcional)
```

No es necesario para deployar en Vercel — es para probar el monorepo completo antes
de avanzar fases. Útil para validar que el `pos-system-server` y el `pos-system-app`
siguen buildables.

## Testing / staging — Vercel + Supabase

Ver [`deploy-vercel-monorepo.md`](./deploy-vercel-monorepo.md). Resumen:

1. Repo `EliabLM/pos-system` → Vercel → Root Directory `pos-system-client`.
2. Build: `pnpm vercel-build` (Prisma generate + migrate deploy + next build).
3. Env vars: `DATABASE_URL` (pooler Supabase, `?pgbouncer=true&connection_limit=1`),
   `DIRECT_URL` (session/direct Supabase), `JWT_SECRET`, `UPLOADTHING_TOKEN`,
   `HTTPS_ENABLED`.
4. `pos-system-server` y `pos-system-app` no se deployan todavía.

## Producción — VPS + Coolify + Postgres en el mismo VPS

### Arquitectura en el VPS

```
VPS (Coolify)
├── Coolify (orchestrator + proxy TLS automático)
│   ├── client  (Next.js, contenedor)         →暴露 https://app.tudominio.com
│   ├── server  (Express, contenedor)          → https://api.tudominio.com   (o path /api)
│   └── app-web (Expo web, contenedor)        → https://m.tudominio.com     (opcional)
└── Postgres 17 (contenedor del mismo stack)   → solo accesible desde la red interna del compose
```

- **Postgres** corre como servicio `db` del mismo `docker-compose.yml`. Se accede
  por el nombre de servicio (`db:5432`) desde client y server. **No exponerlo a
  internet** (sin puerto publicado en prod).
- **TLS:** Coolify gestiona certificados Let's Encrypt automáticamente vía su proxy.
  No configuramos Nginx manual (deprecamos el enfoque viejo de
  `ssl-troubleshooting-nginx-cloudflare-oracle.md` para este stack nuevo).
- **Secrets:** variables desde el panel de Coolify (equivalente a env vars de
  Vercel). Nunca committear `.env` de producción.
- **Migraciones Prisma:** corren en el contenedor `client` al arrancar (entrypoint
  `prisma migrate deploy && next start`). En Fase 1, cuando el **server** sea dueño
  del schema, esa responsabilidad se mueve al `server`.
- **Backups:** volumen Coolify para `pgdata`; snapshot del volumen + `pg_dump`
  cron.

### Override de producción

Usar `docker-compose.prod.yml` (a crear en Fase 2) que sobreescribe:

- No publica `5432` en el host (quita el `ports` de `db`).
- Variables reales: `DATABASE_URL` apunta a `postgresql://<user>:<pass>@db:5432/<db>`
  (sin pooler externo, no hace falta `?pgbouncer`).
- `restart: unless-stopped` ya está; en prod se puede subir a `always`.
- Healthchecks ya definidos; Coolify los respeta para el rollout.

### Hardening Postgres (cuando llegue el momento)

Aplicar lo que define la skill `postgresql-table-design`:

- Role `pos_app` non-owner para runtime (client/server). Role `pos_migrator` para
  migrations (owner o con grant de DDL).
- `FORCE ROW LEVEL SECURITY` en tablas tenant-scoped + policy por
  `organization_id` usando `current_setting('app.tenant_id')`.
- `updated_at` por trigger `BEFORE UPDATE`.
- Índices con `organization_id` como leading column.

## Cómo actualizar este doc

- Cada vez que movas un componente entre stacks (client de Vercel → VPS, server a
  producción, app a EAS) → actualizar la tabla "Fases de la migración vs despliegue"
  y [`STATUS.md`](../STATUS.md).
- Cuando se cree el override de producción, linkearlo acá.

## Puntos de no-regresión

- **Local y prod comparten el mismo `docker-compose.yml`.** Cualquier divergencia
  se expresa como override (`docker-compose.prod.yml`), no editando el base.
- Postgres nunca se publica a internet en producción.
- `JWT_SECRET` ≥ 32 chars y distinto entre testing y producción.