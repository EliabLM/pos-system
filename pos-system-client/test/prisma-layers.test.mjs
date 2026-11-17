import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { loadWithMocks } from './load-with-mocks.mjs';

// #45: en el build de producción, route handlers y server actions tienen cada
// uno su copia del cliente Prisma generado. Los objetos de una copia no son
// `instanceof` de las clases de la otra.
const require = createRequire(import.meta.url);
const runtimePath = require.resolve('../src/generated/prisma/runtime/library.js');
const DecimalA = require(runtimePath).Decimal;
delete require.cache[runtimePath];
const DecimalB = require(runtimePath).Decimal; // otra copia del runtime
globalThis.__layersDecimal = DecimalA;

const { serializeDecimals } = await loadWithMocks('src/actions/utils.ts', {
  '@/generated/prisma':
    'export const Prisma = { Decimal: globalThis.__layersDecimal }; export const MembershipRole = {}; export const MembershipStatus = {};',
  '@/lib/db': 'export const prisma = {};',
  '@/lib/auth/actor':
    'export const ACTIVE_MEMBERSHIP_WHERE = {}; export const ACTIVE_MEMBERSHIP_ORDER = {}; export class ActorError extends Error {}; export const requireActor = async () => { throw new Error("no usado"); };',
});

test('serializeDecimals convierte un Decimal de otra copia del runtime de Prisma', () => {
  const foreign = new DecimalB('7500.50');
  assert.equal(foreign instanceof DecimalA, false, 'premisa: no es instanceof de la copia local');

  const result = serializeDecimals({
    name: 'Producto A',
    salePrice: foreign,
    createdAt: new Date(0),
    saleItems: [{ unitPrice: new DecimalB('10') }],
    local: new DecimalA('1.25'),
  });

  assert.deepEqual(result, {
    name: 'Producto A',
    salePrice: 7500.5,
    createdAt: new Date(0),
    saleItems: [{ unitPrice: 10 }],
    local: 1.25,
  });
});

let copy = 0;
/** Carga una copia nueva de lib/db.ts (como otra capa del bundle o un reload). */
const loadDb = () =>
  loadWithMocks('src/lib/db.ts', {
    '@/generated/prisma': `export class PrismaClient { copy = ${++copy}; }`,
  });

test('lib/db: en producción no comparte el cliente por globalThis', async (t) => {
  const previous = process.env.NODE_ENV;
  t.after(() => {
    process.env.NODE_ENV = previous;
    delete globalThis.__posPrisma;
  });
  process.env.NODE_ENV = 'production';
  delete globalThis.__posPrisma;

  const a = await loadDb();
  const b = await loadDb();
  assert.equal(globalThis.__posPrisma, undefined);
  assert.notEqual(a.prisma, b.prisma, 'cada capa usa su propio cliente');
});

test('lib/db: fuera de producción reutiliza la instancia guardada', async (t) => {
  const previous = process.env.NODE_ENV;
  t.after(() => {
    process.env.NODE_ENV = previous;
    delete globalThis.__posPrisma;
  });
  process.env.NODE_ENV = 'development';
  delete globalThis.__posPrisma;

  const a = await loadDb();
  const b = await loadDb();
  assert.equal(globalThis.__posPrisma, a.prisma);
  assert.equal(b.prisma, a.prisma);
});
