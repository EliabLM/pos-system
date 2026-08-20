# Estrategia de despliegue

> **Objetivo:** definir dónde y cómo corre cada uno de los 3 proyectos del monorepo
> durante la migración y en producción, para que testing y producción estén
> claramente separados y un `docker compose up` baste para probar todo local.
>
> **Fecha:** 2026-08-10 · **Actualizado:** 2026-08-20 · **Estado:** Definida
>
> **Decisión 2026-08-20:** el deploy Vercel + Supabase existente queda **congelado
> apuntando al repo anterior (pre-monorepo)** y no se toca. El monorepo NO se
> deploya a Vercel. La migración se desarrolla contra el stack docker local y el
> sistema migrado se deploya **directo al VPS + Coolify** cuando esté listo (el
> VPS se aprovisiona en ese momento).

## Resumen ejecutivo

| Entorno | Plataforma | DB | Qué corre | Cuándo |
|---------|-----------|----|-----------|--------|
| **Local** (dev/testing del monorepo) | `docker compose up` | Postgres 17 en el stack | `db` + `server` + `client` + (`app` web opcional) | Único entorno durante la migración (Fases 1–3) |
| **Testing / staging (legacy, congelado)** | **Vercel** | **Supabase** (Postgres gestionado) | El client del **repo anterior** (pre-monorepo) | Sigue vivo tal cual; no recibe la migración |
| **Producción** | **VPS + Coolify** | **Postgres en el mismo VPS** | Los 3 proyectos (client + server + app web) vía `docker-compose.yml` | Cuando la migración esté lista para deployar |

## Decisión: por qué estos stacks

- **Test = Vercel + Supabase (solo legacy):** provisioning rápido y HTTPS/CI
  automáticos para el client pre-monorepo. Se mantiene congelado como entorno de
  referencia mientras dura la migración; el monorepo no se deploya ahí.
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

| Fase | Local | Legacy (Vercel+Supabase, congelado) | Producción (VPS+Coolify+Postgres) |
|------|-------|-------------------------------------|----------------------------------|
| Fase 1 (DB foundation) | `docker compose up` — schema nuevo (RLS, UUIDv7, Decimal) | repo anterior sigue tal cual | VPS aún no aprovisionado |
| Fase 2 (auth surface) | `docker compose up` — client + server con auth vía API | idem | VPS aún no aprovisionado |
| Fase 3 (strangler fig) | `docker compose up` — extracción módulo a módulo | idem | **Aprovisionar VPS + Coolify cuando el stack migrado esté listo para deployar**; primer deploy de los 3 proyectos + migración de datos |
| Fase 4 (app móvil) | `pnpm start` fuera de docker (dispositivo) | idem (se apaga cuando prod esté estable) | EAS → store / APK firmado; API en VPS |
| Fase 5 (cleanup) | client UI-only | **dar de baja el deploy legacy** | todo en VPS |

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

## Testing / staging legacy — Vercel + Supabase (congelado 2026-08-20)

El deploy existente en Vercel + Supabase corresponde al **repo anterior**
(pre-monorepo) y queda congelado tal como funciona hoy: no se le apunta el
monorepo ni se le aplican las migraciones nuevas. Se da de baja en Fase 5,
cuando producción (VPS) esté estable.

> [`deploy-vercel-monorepo.md`](./deploy-vercel-monorepo.md) queda como
> referencia histórica por si se retoma un deploy del monorepo en Vercel.
> Su caveat de `prisma migrate resolve --applied 20260811000000_...` solo
> aplica en ese escenario.

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