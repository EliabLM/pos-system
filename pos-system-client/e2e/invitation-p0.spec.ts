import { test, expect } from '@playwright/test';
import { PrismaClient } from '../src/generated/prisma';
import { ADMIN, loginUI } from './fixtures/auth';

// #20: los vendedores entran solo por invitación. El ADMIN crea la invitación
// y copia el enlace; el vendedor se registra con ese correo, acepta y entra como
// SELLER de esa organización (y de ninguna otra).
// Consultas de verificación, nunca mutaciones directas: el actor de las escrituras es Next.
const db = new PrismaClient();
test.afterAll(async () => db.$disconnect());

test('P0 invitación: el ADMIN invita, el vendedor se registra, acepta y entra como SELLER de esa organización', async ({ page, browser }) => {
  const email = `p0-inv-${crypto.randomUUID()}@pos.test`;

  await loginUI(page, ADMIN);
  await page.goto('/dashboard/users');
  await page.getByRole('button', { name: /invitar vendedor/i }).click();
  await page.getByLabel('Correo del vendedor').fill(email);
  await page.getByRole('button', { name: 'Crear invitación' }).click();
  const linkInput = page.getByLabel('Enlace de invitación');
  await expect(linkInput).toBeVisible();
  const link = await linkInput.inputValue();
  expect(link).toMatch(/\/invitacion\/[0-9a-f-]{36}$/);

  // El vendedor abre el enlace en su propio navegador, sin sesión.
  const sellerContext = await browser.newContext();
  const seller = await sellerContext.newPage();
  await seller.goto(link);
  await expect(seller.getByText('Te invitaron a Pos Demo Org')).toBeVisible();
  await seller.getByRole('link', { name: 'Crear mi cuenta' }).click();
  await expect(seller).toHaveURL(/\/auth\/register\?invitacion=/);
  await seller.getByPlaceholder('Juan Pérez').fill('Vendedora Invitada');
  await seller.getByPlaceholder('m@example.com').fill(email);
  await seller.locator('input[name="password"]').fill('Registro123!');
  await seller.locator('input[name="confirmPassword"]').fill('Registro123!');
  await seller.getByRole('button', { name: /crear cuenta/i }).click();
  await expect(seller.getByText('¡Cuenta creada!')).toBeVisible();
  await seller.getByRole('button', { name: 'Continuar' }).click();
  await expect(seller).toHaveURL(/\/invitacion\//);
  await seller.getByRole('button', { name: 'Aceptar invitación' }).click();
  await expect(seller).toHaveURL(/\/dashboard(\?|$)/, { timeout: 30_000 });

  // SELLER de la organización que invitó, y solo de ella.
  const user = await db.user.findFirstOrThrow({ where: { email, isDeleted: false } });
  const memberships = await db.membership.findMany({ where: { userId: user.id, deletedAt: null } });
  expect(memberships).toHaveLength(1);
  const demo = await db.organization.findFirstOrThrow({ where: { name: 'Pos Demo Org' } });
  expect(memberships[0]).toMatchObject({ organizationId: demo.id, role: 'SELLER', status: 'ACTIVE' });
  const sessions = await db.session.findMany({ where: { userId: user.id } });
  expect(sessions.every((s) => s.activeOrganizationId === demo.id)).toBe(true);

  // Como SELLER no administra usuarios (RBAC de navegación).
  await seller.goto('/dashboard/users');
  await expect(seller).toHaveURL(/\/dashboard(\?|$)/);

  // El enlace ya se usó: no sirve otra vez.
  await seller.goto(link);
  await expect(seller.getByText('Esta invitación ya no es válida')).toBeVisible();
  await sellerContext.close();
});
