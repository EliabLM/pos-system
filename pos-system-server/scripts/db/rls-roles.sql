-- Roles de runtime para RLS (Receta R3 — skill postgresql-table-design).
-- Cluster-scoped: NO va en migraciones Prisma (el shadow DB y cada entorno
-- gestionan sus propias credenciales). Idempotente — correr por entorno:
--
--   psql "$DATABASE_URL" -v pos_app_password="'<password>'" -f scripts/db/rls-roles.sql
--
-- pos_app → rol NON-OWNER con el que conectará la API (Fase 2+). Sujeto a RLS:
-- cada request debe setear `SET LOCAL app.tenant_id = '<uuid>'` en su transacción.
-- Las migraciones siguen corriendo con el owner (rol pos_migrator dedicado: se
-- define al aprovisionar el VPS).
--
-- ⚠️ FORCE ROW LEVEL SECURITY se aplica en Fase 2 (cuando el server sea el único
-- punto de acceso a la DB): mientras el client strangler-fig conecte como owner,
-- forzar RLS lo dejaría sin filas.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'pos_app') THEN
    CREATE ROLE pos_app LOGIN;
  END IF;
END
$$;

-- Password vía variable psql (permite rotación re-corriendo el script).
ALTER ROLE pos_app PASSWORD :pos_app_password;

GRANT USAGE ON SCHEMA public TO pos_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO pos_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO pos_app;

-- Las migraciones (_prisma_migrations) no son asunto del runtime:
REVOKE ALL ON TABLE "_prisma_migrations" FROM pos_app;
