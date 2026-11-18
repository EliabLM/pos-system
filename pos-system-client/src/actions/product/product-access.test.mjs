import test from 'node:test';
import assert from 'node:assert/strict';
import { ADMIN_A, ADMIN_B, ID, SELLER_A, assertContract, assertScopedTo, foreign, load, reset, state } from '../../../test/catalog-harness.mjs';

// Contrato de productos (#12): tenant e identidad salen del actor de sesión.
const product = await load('src/actions/product/products.actions.ts');

const productInput = () => ({ name: 'Nuevo', costPrice: 1, salePrice: 2, minStock: 0, currentStock: 3, isActive: true });
const emptyList = (data) => assert.deepEqual(data, []);

const actions = {
  createProduct: { run: () => product.createProduct({ ...productInput(), categoryId: ID.category }), expectA: 400, adminOnly: true },
  getProducts: { run: () => product.getProducts(), expectA: 200, empty: emptyList },
  getProductById: { run: () => product.getProductById(ID.product), expectA: 404, adminOnly: true },
  getProductByBarcode: { run: () => product.getProductByBarcode('B-1'), expectA: 404 },
  getProductBySku: { run: () => product.getProductBySku('SKU-B'), expectA: 404 },
  updateProduct: { run: () => product.updateProduct(ID.product, { name: 'x', ...foreign }), expectA: 404, adminOnly: true },
  updateStock: { run: () => product.updateStock(ID.product, 1, 'INCREMENT'), expectA: 404, adminOnly: true },
  getLowStockProducts: { run: () => product.getLowStockProducts(), expectA: 200, adminOnly: true, empty: emptyList },
  softDeleteProduct: { run: () => product.softDeleteProduct(ID.product), expectA: 404, adminOnly: true },
  restoreProduct: { run: () => product.restoreProduct(ID.product), expectA: 404, adminOnly: true },
  deleteProduct: { run: () => product.deleteProduct(ID.product), expectA: 404, adminOnly: true },
  deleteProductImage: { run: () => product.deleteProductImage(ID.product), expectA: 404, adminOnly: true },
  discardUploadedProductImage: { run: () => product.discardUploadedProductImage('/api/images/org-b/x.webp'), expectA: 400, adminOnly: true },
};

for (const [name, spec] of Object.entries(actions)) assertContract(test, `product.${name}`, spec);

test('control positivo: el admin de B sí ve su producto (el doble de BD no es trivial)', async () => {
  reset(ADMIN_B);
  const result = await product.getProductById(ID.product);
  assert.equal(result.status, 200);
  assert.equal(result.data.id, ID.product);
});

test('createProduct: ignora organizationId/userId del cliente y guarda solo campos permitidos', async () => {
  reset(ADMIN_A);
  const result = await product.createProduct({ ...productInput(), ...foreign, deletedAt: new Date(), slug: 'x' });
  assert.equal(result.status, 201);
  const created = state.writes.find((w) => w.model === 'product' && w.method === 'create').data;
  assert.equal(created.organizationId, 'org-a');
  for (const key of ['userId', 'orgId', 'id', 'isDeleted', 'deletedAt', 'slug']) assert.ok(!(key in created), `${key} no llega a Prisma`);
  assertScopedTo('org-a');
});

test('createProduct: imagen de otra organización 400 sin escrituras', async () => {
  reset(ADMIN_A);
  const result = await product.createProduct({ ...productInput(), image: '/api/images/org-b/x.webp' });
  assert.equal(result.status, 400);
  assert.deepEqual(state.writes, []);
});

test('updateProduct: no cambia el stock por esta vía', async () => {
  reset(ADMIN_B);
  const result = await product.updateProduct(ID.product, { name: 'Otro', currentStock: 999 });
  assert.equal(result.status, 200);
  const update = state.writes.find((w) => w.model === 'product' && w.method === 'update');
  assert.ok(!('currentStock' in update.data));
  assert.equal(update.where.organizationId, 'org-b', 'el update filtra por la organización, no solo por id');
});

test('getProducts: el SELLER solo ve productos activos y no borrados, aunque pida los borrados', async () => {
  reset(SELLER_A);
  const result = await product.getProducts({ isActive: false }, true);
  assert.equal(result.status, 200);
  const call = state.calls.find((c) => c.model === 'product' && c.method === 'findMany');
  assert.equal(call.where.organizationId, 'org-a');
  assert.equal(call.where.isDeleted, false);
  assert.equal(call.where.isActive, true);
});

test('getProducts: filtros con forma inválida 400 sin consultar', async () => {
  reset(ADMIN_A);
  const result = await product.getProducts({ categoryId: 'no-es-uuid' });
  assert.equal(result.status, 400);
  assert.equal(state.calls.length, 0);
});

test('createProduct: código de barras y SKU vacíos o con solo espacios se guardan como null', async () => {
  reset(ADMIN_A);
  const result = await product.createProduct({ ...productInput(), barcode: '', sku: '   ' });
  assert.equal(result.status, 201);
  const created = state.writes.find((w) => w.model === 'product' && w.method === 'create').data;
  assert.equal(created.barcode, null);
  assert.equal(created.sku, null);
  assert.ok(!state.calls.some((c) => c.model === 'product' && c.method === 'findFirst' && ('barcode' in c.where || 'sku' in c.where)), 'no busca duplicados de un código vacío');
});

test('updateProduct: código de barras vacío se guarda como null', async () => {
  reset(ADMIN_B);
  const result = await product.updateProduct(ID.product, { barcode: ' ', sku: '' });
  assert.equal(result.status, 200);
  const update = state.writes.find((w) => w.model === 'product' && w.method === 'update');
  assert.equal(update.data.barcode, null);
  assert.equal(update.data.sku, null);
});
