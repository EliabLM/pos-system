import assert from 'node:assert/strict';
import { loadWithMocks } from './load-with-mocks.mjs';

/**
 * Doble de BD y de sesión para las pruebas de contrato de catálogo e
 * inventario (#12), de clientes, proveedores, compras y medios de pago (#13) y
 * de tiendas y configuración (#14). La BD solo tiene registros de la organización B: un actor
 * de A que los pida por id debe recibir 404 (o lista vacía) sin escrituras.
 */
export const ID = {
  product: '00000000-0000-4000-8000-0000000000b1',
  category: '00000000-0000-4000-8000-0000000000b2',
  brand: '00000000-0000-4000-8000-0000000000b3',
  unitMeasure: '00000000-0000-4000-8000-0000000000b4',
  stockMovement: '00000000-0000-4000-8000-0000000000b5',
  storeB: '00000000-0000-4000-8000-0000000000b6',
  customer: '00000000-0000-4000-8000-0000000000b7',
  supplier: '00000000-0000-4000-8000-0000000000b8',
  paymentMethod: '00000000-0000-4000-8000-0000000000b9',
  purchase: '00000000-0000-4000-8000-0000000000ba',
  purchaseItem: '00000000-0000-4000-8000-0000000000bb',
  systemConfig: '00000000-0000-4000-8000-0000000000bc',
  categoryA: '00000000-0000-4000-8000-0000000000a1',
  storeA: '00000000-0000-4000-8000-0000000000a2',
};

export const ADMIN_A = { userId: 'admin-a', organizationId: 'org-a', role: 'ADMIN', storeId: null };
export const SELLER_A = { userId: 'seller-a', organizationId: 'org-a', role: 'SELLER', storeId: null };
export const ADMIN_B = { userId: 'admin-b', organizationId: 'org-b', role: 'ADMIN', storeId: null };

/** Payload hostil: tenancy e identidad ajenas mezcladas en la entrada. */
export const foreign = { organizationId: 'org-b', userId: 'admin-b', orgId: 'org-b', id: 'x', isDeleted: false };

const dec = (n) => ({ toNumber: () => n });

const records = {
  product: () => ({
    id: ID.product, organizationId: 'org-b', name: 'Producto B', image: null, barcode: 'B-1', sku: 'SKU-B',
    categoryId: null, brandId: null, unitMeasureId: null, currentStock: 5, minStock: 1,
    costPrice: dec(1), salePrice: dec(2), isActive: true, isDeleted: false,
  }),
  category: () => ({ id: ID.category, organizationId: 'org-b', name: 'Cat B', isDeleted: false }),
  brand: () => ({ id: ID.brand, organizationId: 'org-b', name: 'Marca B', isDeleted: false }),
  unitMeasure: () => ({ id: ID.unitMeasure, organizationId: 'org-b', name: 'Unidad', abbreviation: 'un', isDeleted: false }),
  stockMovement: () => ({
    id: ID.stockMovement, organizationId: 'org-b', productId: ID.product, type: 'IN', quantity: 1, previousStock: 4, newStock: 5,
  }),
  store: () => ({
    id: ID.storeB, organizationId: 'org-b', name: 'Tienda B', address: 'Calle B', saleNumberPrefix: 'tienda-b',
    lastSaleNumber: 7, isActive: true, isDeleted: false,
  }),
  systemConfig: () => ({ id: ID.systemConfig, organizationId: 'org-b', key: 'business_type', value: 'shoe_store', isDeleted: false }),
  customer: () => ({
    id: ID.customer, organizationId: 'org-b', firstName: 'Cliente', lastName: 'B', email: 'b@example.com',
    document: '123', isActive: true, isDeleted: false, _count: { sales: 0 },
  }),
  supplier: () => ({
    id: ID.supplier, organizationId: 'org-b', name: 'Proveedor B', email: 'p@example.com', taxId: '900',
    isActive: true, isDeleted: false, _count: { purchases: 0 },
  }),
  paymentMethod: () => ({ id: ID.paymentMethod, organizationId: 'org-b', name: 'Efectivo', type: 'CASH', isActive: true, isDeleted: false }),
  purchase: () => ({
    id: ID.purchase, organizationId: 'org-b', supplierId: ID.supplier, purchaseNumber: 'COMP-20261118-0001',
    status: 'PENDING', notes: null, total: dec(8), isDeleted: false,
    purchaseItems: [{ id: ID.purchaseItem, productId: ID.product, quantity: 2 }],
  }),
  // Sin organizationId propio: pertenece a la organización de su compra.
  purchaseItem: () => ({
    id: ID.purchaseItem, purchaseId: ID.purchase, productId: ID.product, quantity: 2,
    unitPrice: dec(4), subtotal: dec(8), isDeleted: false, purchase: { status: 'PENDING' },
  }),
  sale: () => ({ id: 'sale-b', organizationId: 'org-b', customerId: ID.customer, total: dec(10) }),
};

/** Organización por la que filtra una consulta: la propia o, para los ítems, la de su compra. */
const scopeOf = (model, where = {}) => (model === 'purchaseItem' ? where.purchase?.organizationId : where.organizationId);

/** Modelos de una organización: toda consulta sobre ellos debe filtrar por la organización del actor. */
export const SCOPED_MODELS = new Set(Object.keys(records));

export const state = { actor: null, calls: [], writes: [] };
globalThis.__catalogTest = state;

const visibleToB = (model, where = {}) => {
  const org = scopeOf(model, where);
  return org === undefined || org === 'org-b';
};
const matches = (model, rec, where = {}) =>
  visibleToB(model, where) && (where.id === undefined || where.id === rec.id || typeof where.id === 'object');

const read = (model, method, handler) => async (args = {}) => {
  state.calls.push({ model, method, where: args.where, include: args.include });
  return handler(args);
};
const write = (model, method) => async (args = {}) => {
  state.writes.push({ model, method, data: args.data, where: args.where });
  if (method === 'createMany') return { count: args.data.length };
  return { id: `new-${model}`, ...(args.data ?? {}) };
};

function modelFake(model) {
  const rec = records[model];
  return {
    findFirst: read(model, 'findFirst', ({ where }) => (matches(model, rec(), where) ? rec() : null)),
    findUnique: read(model, 'findUnique', ({ where }) => (matches(model, rec(), where) ? rec() : null)),
    findMany: read(model, 'findMany', ({ where }) => (matches(model, rec(), where) ? [rec()] : [])),
    count: read(model, 'count', ({ where }) => (matches(model, rec(), where) ? 1 : 0)),
    aggregate: read(model, 'aggregate', () => ({ _count: { id: 0 }, _sum: { quantity: null, total: null }, _avg: { total: null } })),
    groupBy: read(model, 'groupBy', () => []),
    create: write(model, 'create'),
    createMany: write(model, 'createMany'),
    update: write(model, 'update'),
    delete: write(model, 'delete'),
  };
}

export const prisma = {
  ...Object.fromEntries(Object.keys(records).map((m) => [m, modelFake(m)])),
  saleItem: { count: read('saleItem', 'count', () => 0), groupBy: read('saleItem', 'groupBy', () => []) },
  $transaction: async (fn) => fn(prisma),
};
prisma.product.fields = { minStock: 'minStock' };
// Uso de un producto en compras (catálogo): sin ítems. Los conteos de una compra sí ven el ítem de B.
const purchaseItemCount = prisma.purchaseItem.count;
prisma.purchaseItem.count = (args = {}) => (args.where?.productId ? read('purchaseItem', 'count', () => 0)(args) : purchaseItemCount(args));
globalThis.__catalogPrisma = prisma;

export const mocks = {
  '@/generated/prisma': `
    export const Prisma = { PrismaClientKnownRequestError: class PrismaClientKnownRequestError extends Error {}, Decimal: class Decimal {} };
    export const MembershipRole = { ADMIN: 'ADMIN', SELLER: 'SELLER' };
    export const StockMovementType = { IN: 'IN', OUT: 'OUT', ADJUSTMENT: 'ADJUSTMENT' };`,
  '@/lib/auth/actor': `
    export class ActorError extends Error { constructor(code) { super(code); this.code = code; this.status = code === 'UNAUTHENTICATED' ? 401 : 403; } }
    export const getActor = async () => {
      const actor = globalThis.__catalogTest.actor;
      if (!actor) throw new ActorError('UNAUTHENTICATED');
      if (actor === 'NO_MEMBERSHIP') throw new ActorError('FORBIDDEN');
      return actor;
    };
    export const requireActor = async (options = {}) => {
      const actor = await getActor();
      if (options.roles && !options.roles.includes(actor.role)) throw new ActorError('FORBIDDEN');
      return actor;
    };
    export const actorErrorResponse = (error) => error instanceof ActorError ? { status: error.status, message: error.message, data: null } : null;`,
  '../utils': 'export const prisma = globalThis.__catalogPrisma; export const serializeDecimals = (value) => value;',
  '@/lib/images/product-image-refs': `
    export const isOrgProductImageUrl = (url, org) => url == null || url.startsWith('/api/images/' + org + '/');
    export const deleteOrgProductImage = async () => {};`,
};

export const load = (entry) => loadWithMocks(entry, mocks);

export function reset(actor) {
  state.actor = actor;
  state.calls = [];
  state.writes = [];
}

/**
 * Contrato común por action:
 * - sin sesión → 401 sin tocar la BD; sin membresía → 403;
 * - SELLER → 403 sin tocar la BD si es de administración (`adminOnly`);
 * - actor de A sobre datos de B → `expectA` (404, o 200 con lista vacía), sin
 *   escrituras y con todas las consultas filtradas por org-a.
 */
export function assertContract(test, name, { run, expectA, adminOnly = false, empty }) {
  const label = `otra organización ${expectA}`;
  test(`${name}: sin sesión 401, sin membresía 403${adminOnly ? ', SELLER 403' : ''}, ${label}, sin escrituras`, async () => {
    reset(null);
    let result = await run();
    assert.equal(result.status, 401);
    assert.equal(result.data, null);
    assert.equal(state.calls.length, 0, 'no consulta la BD sin sesión');

    reset('NO_MEMBERSHIP');
    result = await run();
    assert.equal(result.status, 403);
    assert.equal(state.calls.length, 0);

    if (adminOnly) {
      reset(SELLER_A);
      result = await run();
      assert.equal(result.status, 403, 'SELLER rechazado en administración');
      assert.equal(state.calls.length, 0);
      assert.deepEqual(state.writes, []);
    }

    reset(ADMIN_A);
    result = await run();
    assert.equal(result.status, expectA);
    if (expectA === 404) assert.equal(result.data, null);
    if (empty) empty(result.data);
    assert.deepEqual(state.writes, [], 'sin escrituras sobre la organización B');
    assertScopedTo('org-a');
  });
}

/** Toda consulta sobre un modelo con organizationId filtra por `org`. */
export function assertScopedTo(org) {
  for (const call of state.calls.filter((c) => SCOPED_MODELS.has(c.model))) {
    assert.equal(scopeOf(call.model, call.where), org, `${call.model}.${call.method} filtra por la organización del actor`);
  }
}
