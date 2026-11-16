#!/usr/bin/env bash
# POS-03c: CI-only destructive seed rollback probe on an ephemeral database.
set -euo pipefail
if [[ "${CI:-}" != true || "${NODE_ENV:-}" != test || "${POS_SEED_ALLOW_RESET:-}" != 1 ]]; then
  echo 'CI-only seed probe refused'; exit 1
fi
node -e 'const u=new URL(process.env.DATABASE_URL); if (u.hostname!=="127.0.0.1" || u.pathname!=="/pos_test" || u.searchParams.has("schema") && u.searchParams.get("schema")!=="public" || process.env.DIRECT_URL!==process.env.DATABASE_URL) process.exit(1)' || { echo 'Unexpected CI database target'; exit 1; }
before=$(mktemp)
after=$(mktemp)
cleanup() {
  psql "$DATABASE_URL" -X -q -v ON_ERROR_STOP=1 -c 'DROP TRIGGER IF EXISTS pos_ci_fail_delete ON products; DROP FUNCTION IF EXISTS pos_ci_fail_delete();' >/dev/null || true
  rm -f "$before" "$after"
}
trap cleanup EXIT
snapshot() { psql "$DATABASE_URL" -X -qAt -v ON_ERROR_STOP=1 -f pos-system-client/prisma/seed-snapshot-ci.sql > "$1"; }
snapshot "$before"
if env -u POS_SEED_ALLOW_RESET pnpm -C pos-system-client --ignore-workspace db:seed >/dev/null 2>&1; then
  echo 'Seed ran without consent'; exit 1
fi
snapshot "$after"
cmp -s "$before" "$after" || { echo 'Consent rejection mutated rows or IDs'; exit 1; }
echo 'Consent rejected; all public table rows and IDs unchanged'
psql "$DATABASE_URL" -X -q -v ON_ERROR_STOP=1 -c "CREATE FUNCTION pos_ci_fail_delete() RETURNS trigger LANGUAGE plpgsql AS \$\$ BEGIN RAISE EXCEPTION 'POS-03c injected failure during destructive transaction'; END \$\$; CREATE TRIGGER pos_ci_fail_delete BEFORE DELETE ON products FOR EACH ROW EXECUTE FUNCTION pos_ci_fail_delete();" >/dev/null
if pnpm -C pos-system-client --ignore-workspace db:seed >/dev/null 2>&1; then
  echo 'Injected seed unexpectedly succeeded'; exit 1
fi
snapshot "$after"
cmp -s "$before" "$after" || { echo 'Injected rollback changed rows or IDs'; exit 1; }
echo 'Failure injected at product deletion; full row/ID snapshot identical after rollback'
psql "$DATABASE_URL" -X -q -v ON_ERROR_STOP=1 -c 'DROP TRIGGER pos_ci_fail_delete ON products; DROP FUNCTION pos_ci_fail_delete();' >/dev/null
pnpm -C pos-system-client --ignore-workspace db:seed
pnpm -C pos-system-client --ignore-workspace db:seed:verify
echo 'Normal retry succeeded; verifier passed'
