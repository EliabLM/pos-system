import { test, expect, type Page } from '@playwright/test';
import { PrismaClient } from '../src/generated/prisma';
import { ADMIN, loginUI } from './fixtures/auth';

// PostgreSQL real + Next server action real; no number is inserted by this test.
const db = new PrismaClient();
test.afterAll(async () => db.$disconnect());
test.describe.configure({ mode: 'serial', retries: 0 });

test.setTimeout(120_000);

async function prepare(page: Page): Promise<void> {
  await page.goto('/dashboard/purchases/new');
  await expect(page.getByRole('heading', { name: 'Crear Nueva Orden de Compra' })).toBeVisible();
  await page.getByRole('combobox', { name: 'Buscar proveedor' }).fill('Distrib SA');
  await page.getByRole('option', { name: /Distrib SA/ }).click();
  await page.getByRole('textbox', { name: 'Buscar productos' }).fill('Producto A');
  await page.getByRole('listitem', { name: 'Agregar Producto A a la compra' }).click();
  await page.getByRole('spinbutton', { name: 'Cantidad de Producto A' }).fill('2');
}

async function save(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Guardar como Pendiente' }).click();
  await expect(page).toHaveURL(/\/dashboard\/purchases(?:\?|$)/);
}

test('P0 consecutivo: dos tenants y dos creaciones concurrentes reales, soft-delete sin reuso', async ({ browser }) => {
  const orgA = await db.organization.findFirstOrThrow({ where: { name: 'Pos Demo Org' } });
  const orgB = await db.organization.findFirstOrThrow({ where: { name: 'Pos Isolation Org' } });
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  try {
    const a1 = await contextA.newPage();
    const b1 = await contextB.newPage();
    await Promise.all([loginUI(a1, ADMIN), loginUI(b1, { email: 'admin.isolation@pos.test', password: ADMIN.password })]);
    await Promise.all([prepare(a1), prepare(b1)]);
    await Promise.all([save(a1), save(b1)]);
    const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const prefix = `COMP-${day}-`;
    const firstA = await db.purchase.findFirstOrThrow({ where: { organizationId: orgA.id, purchaseNumber: `${prefix}0001` }, include: { purchaseItems: true } });
    const firstB = await db.purchase.findFirstOrThrow({ where: { organizationId: orgB.id, purchaseNumber: `${prefix}0001` }, include: { purchaseItems: true } });
    expect(firstA.purchaseItems).toHaveLength(1);
    expect(firstB.purchaseItems).toHaveLength(1);
    expect(firstA.createdAt.toISOString().slice(0, 10).replace(/-/g, '')).toBe(day);
    await db.purchase.update({ where: { id: firstA.id }, data: { isDeleted: true, deletedAt: new Date() } });
    const a2 = await contextA.newPage();
    const a3 = await contextA.newPage();
    // JWTs issued for the same user in one second are identical in the legacy
    // auth flow; parallel logins violate sessions.token_hash uniqueness.
    await loginUI(a2, ADMIN);
    await new Promise(resolve => setTimeout(resolve, 1200));
    await loginUI(a3, ADMIN);
    await Promise.all([prepare(a2), prepare(a3)]);
    await Promise.all([save(a2), save(a3)]);
    const numbers = await db.purchase.findMany({ where: { organizationId: orgA.id, purchaseNumber: { startsWith: prefix } }, orderBy: { purchaseNumber: 'asc' }, include: { purchaseItems: true } });
    expect(numbers.map(p => p.purchaseNumber)).toEqual([`${prefix}0001`, `${prefix}0002`, `${prefix}0003`]);
    expect(numbers.map(p => p.purchaseItems.length)).toEqual([1, 1, 1]);
    expect(numbers.map(p => p.purchaseItems[0].quantity)).toEqual([2, 2, 2]);
    expect(numbers.every(p => p.createdAt.toISOString().slice(0, 10).replace(/-/g, '') === day)).toBe(true);
  } finally {
    await Promise.all([contextA.close(), contextB.close()]);
  }
});
