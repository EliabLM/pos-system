/**
 * Prueba guardián: toda función exportada de un archivo 'use server' en
 * src/actions/** debe llamar a getActor() o requireActor() (src/lib/auth/actor.ts).
 *
 * - PENDING: módulos aún no migrados. Se vacía en #14–#15; si un módulo
 *   pendiente ya cumple, la prueba falla para que se saque de la lista.
 * - PUBLIC: acciones que por diseño corren sin sesión (login, registro...).
 * - ONBOARDING: acciones del usuario con sesión pero SIN membresía; solo ahí
 *   vale requireOnboardingUser() como guard (y en ningún otro archivo).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import ts from 'typescript';

const ROOT = new URL('..', import.meta.url).pathname;
const ACTIONS_DIR = join(ROOT, 'src', 'actions');
const GUARDS = new Set(['getActor', 'requireActor']);

/** Módulos pendientes de migrar (ruta relativa a src/actions → issue). */
const PENDING = {
  'system-config': '#14',
  reports: '#15', dashboard: '#15',
};

/** Acciones públicas: gestionan la sesión ellas mismas (archivo → motivo). */
const PUBLIC = {
  'auth/login.ts': 'crea la sesión',
  'auth/register.ts': 'registro público',
  'auth/logout.ts': 'invalida la sesión de la cookie',
  'auth/refreshToken.ts': 'renueva la sesión de la cookie',
  'auth/getCurrentUser.ts': 'lee la sesión de la cookie',
};

/** Onboarding: archivo → acciones que usan requireOnboardingUser(). */
const ONBOARDING = {
  'organization/organization.action.ts': ['createOrganization'],
};
const ONBOARDING_GUARD = 'requireOnboardingUser';

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return walk(path);
    return /\.tsx?$/.test(name) && !/\.test\./.test(name) ? [path] : [];
  });
}

function hasUseServer(source) {
  const first = source.statements[0];
  return !!first && ts.isExpressionStatement(first) && ts.isStringLiteral(first.expression) && first.expression.text === 'use server';
}

function callsGuard(node, guards = GUARDS) {
  let found = false;
  const visit = (n) => {
    if (found) return;
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && guards.has(n.expression.text)) found = true;
    else ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}

const isExported = (node) => !!ts.getModifiers?.(node)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);

/** Devuelve los nombres de funciones exportadas que no llaman al guard. Solo aplica a archivos 'use server'. */
export function findUnguardedActions(text, fileName = 'action.ts', onboarding = []) {
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  if (!hasUseServer(source)) return [];
  const unguarded = [];
  for (const statement of source.statements) {
    const guardsFor = (name) => (onboarding.includes(name) ? new Set([ONBOARDING_GUARD]) : GUARDS);
    if (ts.isFunctionDeclaration(statement) && isExported(statement)) {
      const name = statement.name?.text ?? 'default';
      if (!callsGuard(statement, guardsFor(name))) unguarded.push(name);
    } else if (ts.isVariableStatement(statement) && isExported(statement)) {
      for (const decl of statement.declarationList.declarations) {
        const init = decl.initializer;
        if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) && !callsGuard(init, guardsFor(decl.name.getText(source)))) {
          unguarded.push(decl.name.getText(source));
        }
      }
    } else if (ts.isExportDeclaration(statement) || ts.isExportAssignment(statement)) {
      // Re-exportar desde un archivo 'use server' esconde acciones al guardián.
      if (!(ts.isExportDeclaration(statement) && statement.isTypeOnly)) unguarded.push('export {...}');
    }
  }
  return unguarded;
}

const moduleOf = (rel) => rel.split('/')[0];

function scan() {
  const results = [];
  for (const file of walk(ACTIONS_DIR)) {
    const rel = relative(ACTIONS_DIR, file).split(sep).join('/');
    const text = readFileSync(file, 'utf8');
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    if (!hasUseServer(source)) continue;
    results.push({ rel, module: moduleOf(rel), unguarded: findUnguardedActions(text, file, ONBOARDING[rel] ?? []), text });
  }
  return results;
}

test('guardián: el detector marca una action sin getActor/requireActor', () => {
  const bad = `'use server';\nimport { prisma } from '../utils';\nexport const getSaleById = async (id: string, orgId: string) => prisma.sale.findFirst({ where: { id, organizationId: orgId } });\nexport async function other() { return 1; }`;
  assert.deepEqual(findUnguardedActions(bad), ['getSaleById', 'other']);
  const good = `'use server';\nimport { requireActor } from '@/lib/auth/actor';\nexport const getSaleById = async (id: string) => { const actor = await requireActor(); return actor; };\nexport type X = string;`;
  assert.deepEqual(findUnguardedActions(good), []);
  assert.deepEqual(findUnguardedActions(`export const helper = async () => 1;`), [], 'sin use server no es action');
  assert.deepEqual(findUnguardedActions(`'use server';\nexport { leak } from './x';`), ['export {...}']);
});

test('guardián: toda action exportada fuera de pendientes/públicas llama a getActor o requireActor', () => {
  const offenders = scan()
    .filter((r) => !PENDING[r.module] && !PUBLIC[r.rel])
    .filter((r) => r.unguarded.length > 0)
    .map((r) => `${r.rel}: ${r.unguarded.join(', ')}`);
  assert.deepEqual(offenders, [], 'Actions sin verificación de sesión central (usa requireActor de @/lib/auth/actor)');
});

test('guardián: listas de pendientes y públicas al día', () => {
  const results = scan();
  for (const rel of Object.keys(PUBLIC)) assert.ok(existsSync(join(ACTIONS_DIR, rel)), `PUBLIC obsoleto: ${rel}`);
  for (const [mod, issue] of Object.entries(PENDING)) {
    const files = results.filter((r) => r.module === mod);
    assert.ok(files.length > 0, `PENDING obsoleto: ${mod} (${issue}) ya no tiene actions`);
    const migrated = files.every((r) => r.unguarded.length === 0);
    assert.ok(!migrated, `${mod} ya usa el actor central: sácalo de PENDING (${issue})`);
  }
  for (const rel of Object.keys(ONBOARDING)) assert.ok(existsSync(join(ACTIONS_DIR, rel)), `ONBOARDING obsoleto: ${rel}`);
  const MIGRATED = ['sale', 'sale-item', 'sale-payment', 'user', 'organization', 'product', 'category', 'brand', 'unit-measure', 'stock-movement',
    'customer', 'supplier', 'purchase', 'purchase-item', 'payment-methods', 'store'];
  for (const mod of MIGRATED) {
    assert.ok(!PENDING[mod], `${mod} no puede volver a PENDING`);
    assert.ok(results.some((r) => r.module === mod), `${mod} debe tener actions 'use server'`);
  }
});

test('guardián: requireOnboardingUser solo en las acciones de onboarding', () => {
  const misuse = scan()
    .filter((r) => !ONBOARDING[r.rel] && r.text.includes(ONBOARDING_GUARD))
    .map((r) => r.rel);
  assert.deepEqual(misuse, [], 'requireOnboardingUser no autoriza datos de una organización');
  const onlyOnboarding = `'use server';\nexport const createOrganization = async () => { await requireActor(); };`;
  assert.deepEqual(findUnguardedActions(onlyOnboarding, 'x.ts', ['createOrganization']), ['createOrganization']);
});
