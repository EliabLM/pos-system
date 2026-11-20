/**
 * Prueba guardián de route handlers: cada método HTTP exportado por un
 * `route.ts` de src/app debe comprobar la sesión él mismo con getActor() o
 * requireActor(), directamente o mediante una función local que lo haga.
 *
 * El middleware no es suficiente: su `matcher` excluye las rutas que terminan
 * en extensión de imagen (.webp, .png...), así que esas peticiones llegan al
 * handler sin pasar por él.
 *
 * - PUBLIC: handlers que por diseño responden sin sesión (archivo → método → motivo).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import ts from 'typescript';

const ROOT = new URL('..', import.meta.url).pathname;
const APP_DIR = join(ROOT, 'src', 'app');
const GUARDS = new Set(['getActor', 'requireActor']);
const HTTP_METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);

const PUBLIC = {
  'api/images/[...key]/route.ts': {
    GET: 'imágenes de producto con clave aleatoria; ver docs/deployment/imagenes-producto.md',
  },
};

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return walk(path);
    return /^route\.tsx?$/.test(name) ? [path] : [];
  });
}

const isExported = (node) => !!ts.getModifiers?.(node)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);

/** Top-level functions of the file: name → body node. */
function localFunctions(source) {
  const fns = new Map();
  for (const st of source.statements) {
    if (ts.isFunctionDeclaration(st) && st.name) fns.set(st.name.text, st);
    if (ts.isVariableStatement(st)) {
      for (const decl of st.declarationList.declarations) {
        const init = decl.initializer;
        if (ts.isIdentifier(decl.name) && init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) {
          fns.set(decl.name.text, init);
        }
      }
    }
  }
  return fns;
}

/** True when the node calls a guard or references a local function that does. */
function reachesGuard(node, guarded) {
  let found = false;
  const visit = (n) => {
    if (found) return;
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && GUARDS.has(n.expression.text)) found = true;
    else if (ts.isIdentifier(n) && guarded.has(n.text)) found = true;
    else ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}

/** Exported HTTP handlers of a route file that never check the session. */
export function findUnguardedHandlers(text, fileName = 'route.ts') {
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const fns = localFunctions(source);
  const guarded = new Set();
  // Fixpoint: a function that reaches a guarded function is guarded too.
  for (let changed = true; changed; ) {
    changed = false;
    for (const [name, body] of fns) {
      if (!guarded.has(name) && reachesGuard(body, guarded)) {
        guarded.add(name);
        changed = true;
      }
    }
  }
  const unguarded = [];
  for (const st of source.statements) {
    if (ts.isFunctionDeclaration(st) && isExported(st) && st.name && HTTP_METHODS.has(st.name.text)) {
      if (!guarded.has(st.name.text)) unguarded.push(st.name.text);
    } else if (ts.isVariableStatement(st) && isExported(st)) {
      for (const decl of st.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && HTTP_METHODS.has(decl.name.text) && !guarded.has(decl.name.text)) {
          unguarded.push(decl.name.text);
        }
      }
    } else if (ts.isExportDeclaration(st) && !st.isTypeOnly) {
      unguarded.push('export {...}');
    }
  }
  return unguarded;
}

test('guardián de rutas: el detector marca un handler sin sesión', () => {
  const bad = `export async function GET() { return new Response('x'); }\nexport const runtime = 'nodejs';`;
  assert.deepEqual(findUnguardedHandlers(bad), ['GET']);
  const viaHelper = `async function admin() { return requireActor({ roles: ['ADMIN'] }); }\nexport async function POST() { return handle({ getActor: admin }); }`;
  assert.deepEqual(findUnguardedHandlers(viaHelper), []);
  const direct = `export const DELETE = async () => { await getActor(); return new Response(null); };`;
  assert.deepEqual(findUnguardedHandlers(direct), []);
  assert.deepEqual(findUnguardedHandlers(`export { GET } from './other';`), ['export {...}']);
});

test('guardián de rutas: todo handler fuera de PUBLIC comprueba la sesión', () => {
  const offenders = [];
  for (const file of walk(APP_DIR)) {
    const rel = relative(APP_DIR, file).split(sep).join('/');
    const allowed = PUBLIC[rel] ?? {};
    const unguarded = findUnguardedHandlers(readFileSync(file, 'utf8'), file).filter((m) => !allowed[m]);
    if (unguarded.length > 0) offenders.push(`${rel}: ${unguarded.join(', ')}`);
  }
  assert.deepEqual(offenders, [], 'Route handlers sin requireActor/getActor (el middleware no cubre rutas con extensión)');
});

test('guardián de rutas: lista PUBLIC al día', () => {
  for (const [rel, methods] of Object.entries(PUBLIC)) {
    const path = join(APP_DIR, rel);
    assert.ok(existsSync(path), `PUBLIC obsoleto: ${rel}`);
    const unguarded = findUnguardedHandlers(readFileSync(path, 'utf8'), path);
    for (const method of Object.keys(methods)) {
      assert.ok(unguarded.includes(method), `${rel} ${method} ya comprueba la sesión: sácalo de PUBLIC`);
    }
  }
});
