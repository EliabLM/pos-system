import { test, expect, type Page } from '@playwright/test';
import { PrismaClient } from '../src/generated/prisma';
import { ADMIN, loginUI } from './fixtures/auth';

// Consultas de verificación, nunca mutaciones directas: el actor de las escrituras es Next.
// El servicio CI usa un owner; esto prueba autorización de la aplicación, NO FORCE RLS.
const db = new PrismaClient();
test.afterAll(async () => db.$disconnect());
test.describe.configure({ mode: 'serial' });

async function selectPurchaseItems(page: Page): Promise<void> {
  await page.goto('/dashboard/purchases/new');
  await expect(page.getByRole('heading', { name: 'Crear Nueva Orden de Compra' })).toBeVisible();
  await page.getByRole('combobox', { name: 'Buscar proveedor' }).fill('Distrib SA');
  await page.getByRole('option', { name: /Distrib SA/ }).click();
  await page.getByRole('textbox', { name: 'Buscar productos' }).fill('Producto A');
  await page.getByRole('listitem', { name: 'Agregar Producto A a la compra' }).click();
  await page.getByRole('spinbutton', { name: 'Cantidad de Producto A' }).fill('2');
}

test('P0 registro con name crea identidad y sesión real', async ({ page }) => {
  const email = `p0-${crypto.randomUUID()}@pos.test`;
  const name = 'Prueba Registro';
  await page.goto('/auth/register');
  await page.getByPlaceholder('Juan Pérez').fill(name);
  await page.getByPlaceholder('m@example.com').fill(email);
  await page.locator('input[name="password"]').fill('Registro123!');
  await page.locator('input[name="confirmPassword"]').fill('Registro123!');
  await page.getByRole('button', { name: /crear cuenta/i }).click();
  await expect(page.getByText('¡Cuenta creada!')).toBeVisible();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(page).toHaveURL(/\/onboarding/);
  const user = await db.user.findFirst({ where: { email, isDeleted: false } });
  expect(user?.name).toBe(name);
  expect(user?.passwordHash).toBeTruthy();
  expect(await db.session.count({ where: { userId: user?.id, isActive: true } })).toBe(1);
  expect((await page.context().cookies()).some(c => c.name === 'auth-token' && c.value.length > 0)).toBe(true);
});

test('P0 compra y recepción por ADMIN aumentan stock y generan movimiento', async ({ page }) => {
  const org = await db.organization.findFirstOrThrow({ where: { name: 'Pos Demo Org', isDeleted: false } });
  const product = await db.product.findFirstOrThrow({ where: { organizationId: org.id, sku: 'SKU001', isDeleted: false } });
  const before = product.currentStock;
  await loginUI(page, ADMIN);
  await selectPurchaseItems(page);
  await page.getByRole('button', { name: 'Guardar y Recibir' }).click();
  await expect(page).toHaveURL(/\/dashboard\/purchases(?:\?|$)/);
  await expect.poll(async () => (await db.product.findUniqueOrThrow({ where: { id: product.id } })).currentStock).toBe(before + 2);
  const purchase = await db.purchase.findFirstOrThrow({ where: { organizationId: org.id, status: 'RECEIVED', purchaseItems: { some: { productId: product.id, quantity: 2 } } }, orderBy: { createdAt: 'desc' } });
  expect(purchase.receivedDate).not.toBeNull();
  const movement = await db.stockMovement.findFirstOrThrow({ where: { organizationId: org.id, productId: product.id, reference: purchase.id, type: 'IN' } });
  expect(movement.previousStock).toBe(before);
  expect(movement.newStock).toBe(before + 2);
  expect(movement.quantity).toBe(2);
});

test('P0 sesión A rechaza proveedor de B y no escribe compras ni stock', async ({ page }) => {
  const orgA = await db.organization.findFirstOrThrow({ where: { name: 'Pos Demo Org', isDeleted: false } });
  const orgB = await db.organization.findFirstOrThrow({ where: { name: 'Pos Isolation Org', isDeleted: false } });
  const supplierA = await db.supplier.findFirstOrThrow({ where: { organizationId: orgA.id, name: 'Distrib SA', isDeleted: false } });
  const supplierB = await db.supplier.findFirstOrThrow({ where: { organizationId: orgB.id, name: 'Distrib SA', isDeleted: false } });
  const productB = await db.product.findFirstOrThrow({ where: { organizationId: orgB.id, sku: 'SKU001', isDeleted: false } });
  const beforeA = await db.purchase.count({ where: { organizationId: orgA.id } });
  const beforeB = await db.purchase.count({ where: { organizationId: orgB.id } });
  const beforeMovements = await db.stockMovement.count();
  await loginUI(page, ADMIN);
  await selectPurchaseItems(page);
  // Tamper de un argumento de la acción real de Next con el ID de B (no mock).
  // Solo modificar el POST de createPurchase; todas las lecturas y la respuesta vienen del servidor real.
  let tampered = 0;
  await page.route('**/dashboard/purchases/new', async route => {
    const request = route.request();
    const body = request.postData() ?? '';
    if (request.method() !== 'POST' || !body.includes(supplierA.id)) return route.continue();
    expect(tampered).toBe(0);
    tampered++;
    await route.continue({ postData: body.replace(supplierA.id, supplierB.id) });
  });
  await page.getByRole('button', { name: 'Guardar como Pendiente' }).click();
  await expect(page.getByText('El proveedor especificado no existe').first()).toBeVisible();
  expect(tampered).toBe(1);
  expect(await db.purchase.count({ where: { organizationId: orgA.id } })).toBe(beforeA);
  expect(await db.purchase.count({ where: { organizationId: orgB.id } })).toBe(beforeB);
  expect(await db.stockMovement.count()).toBe(beforeMovements);
  expect((await db.product.findUniqueOrThrow({ where: { id: productB.id } })).currentStock).toBe(productB.currentStock);
});
