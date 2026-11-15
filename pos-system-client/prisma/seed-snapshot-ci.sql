-- POS-03c: stable digest of every public table with an id column, including IDs and full row state.
\set ON_ERROR_STOP on
SELECT format('SELECT %L, count(*), md5(coalesce(string_agg(to_jsonb(t)::text, %L ORDER BY t.id::text), %L)) FROM %I t;', t.tablename, '|', '', t.tablename)
FROM pg_tables t
WHERE t.schemaname = 'public'
  AND EXISTS (SELECT 1 FROM information_schema.columns c WHERE c.table_schema='public' AND c.table_name=t.tablename AND c.column_name='id')
ORDER BY t.tablename
\gexec
