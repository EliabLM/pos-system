import { test, expect, type Page } from '@playwright/test';
import { PrismaClient } from '../src/generated/prisma';
import { ADMIN, loginUI } from './fixtures/auth';

// Consultas de verificación, nunca mutaciones directas: el actor de las escrituras es Next.
const db = new PrismaClient();
test.afterAll(async () => db.$disconnect());
test.describe.configure({ mode: 'serial' });

async function fillSaleOfProductA(page: Page, amount: string): Promise<void> {
  await page.goto('/dashboard/sales/new');
  await expect(page.getByRole('heading', { name: 'Crear Nueva Factura' })).toBeVisible();
  await page.getByRole('combobox', { name: 'Seleccionar tienda' }).click();
  await page.getByRole('option', { name: 'Store Central' }).click();
  await page.getByRole('textbox', { name: 'Buscar productos' }).fill('Producto A');
  await page.getByRole('listitem', { name: 'Agregar Producto A a la venta' }).click();
  await expect(page.getByRole('spinbutton', { name: 'Cantidad de Producto A' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Monto para Efectivo' }).fill(amount);
}

test('P0 venta: ADMIN crea venta de punta a punta; organización y vendedor salen de la sesión', async ({ page }) => {
  const org = await db.organization.findFirstOrThrow({ where: { name: 'Pos Demo Org', isDeleted: false } });
  const admin = await db.user.findFirstOrThrow({ where: { email: ADMIN.email, isDeleted: false } });
  const product = await db.product.findFirstOrThrow({ where: { organizationId: org.id, sku: 'SKU001', isDeleted: false } });
  const before = product.currentStock;
  const startedAt = new Date();

  await loginUI(page, ADMIN);
  await fillSaleOfProductA(page, String(product.salePrice.toNumber()));
  await page.getByRole('button', { name: 'Crear Factura' }).click();
  await expect(page).toHaveURL(/\/dashboard\/sales(?:\?|$)/);

  await expect.poll(async () => (await db.product.findUniqueOrThrow({ where: { id: product.id } })).currentStock).toBe(before - 1);
  const sale = await db.sale.findFirstOrThrow({
    where: { organizationId: org.id, createdAt: { gte: startedAt }, saleItems: { some: { productId: product.id } } },
    include: { saleItems: true, salePayments: true },
    orderBy: { createdAt: 'desc' },
  });
  expect(sale.userId).toBe(admin.id);
  expect(sale.status).toBe('PAID');
  expect(sale.total.toNumber()).toBe(product.salePrice.toNumber());
  expect(sale.saleItems).toHaveLength(1);
  expect(sale.salePayments).toHaveLength(1);
  const movement = await db.stockMovement.findFirstOrThrow({ where: { organizationId: org.id, productId: product.id, reference: sale.id, type: 'OUT' } });
  expect(movement.userId).toBe(admin.id);
});

test('P0 venta: sesión A con tienda de B se rechaza y no escribe ventas ni stock', async ({ page }) => {
  const orgA = await db.organization.findFirstOrThrow({ where: { name: 'Pos Demo Org', isDeleted: false } });
  const orgB = await db.organization.findFirstOrThrow({ where: { name: 'Pos Isolation Org', isDeleted: false } });
  const storeA = await db.store.findFirstOrThrow({ where: { organizationId: orgA.id, name: 'Store Central', isDeleted: false } });
  const storeB = await db.store.findFirstOrThrow({ where: { organizationId: orgB.id, isDeleted: false } });
  const product = await db.product.findFirstOrThrow({ where: { organizationId: orgA.id, sku: 'SKU001', isDeleted: false } });
  const beforeA = await db.sale.count({ where: { organizationId: orgA.id } });
  const beforeB = await db.sale.count({ where: { organizationId: orgB.id } });
  const beforeMovements = await db.stockMovement.count();

  await loginUI(page, ADMIN);
  await fillSaleOfProductA(page, String(product.salePrice.toNumber()));
  // Tamper del argumento real de la acción de Next (no mock): tienda de A → tienda de B.
  let tampered = 0;
  await page.route('**/dashboard/sales/new', async (route) => {
    const request = route.request();
    const body = request.postData() ?? '';
    if (request.method() !== 'POST' || !body.includes(storeA.id)) return route.continue();
    tampered++;
    await route.continue({ postData: body.replaceAll(storeA.id, storeB.id) });
  });
  await page.getByRole('button', { name: 'Crear Factura' }).click();
  await expect(page.getByText('La tienda especificada no existe').first()).toBeVisible();
  expect(tampered).toBe(1);
  expect(await db.sale.count({ where: { organizationId: orgA.id } })).toBe(beforeA);
  expect(await db.sale.count({ where: { organizationId: orgB.id } })).toBe(beforeB);
  expect(await db.stockMovement.count()).toBe(beforeMovements);
  expect((await db.product.findUniqueOrThrow({ where: { id: product.id } })).currentStock).toBe(product.currentStock);
});
