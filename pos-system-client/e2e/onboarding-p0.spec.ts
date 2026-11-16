import { test, expect } from '@playwright/test';
import { PrismaClient } from '../src/generated/prisma';

// #11: registro libre → onboarding → crear negocio → el usuario es ADMIN de él.
// Consultas de verificación, nunca mutaciones directas: el actor de las escrituras es Next.
const db = new PrismaClient();
test.afterAll(async () => db.$disconnect());

test('P0 registro y onboarding: crea solo el usuario y luego su negocio, donde queda como ADMIN', async ({ page }) => {
  const email = `p0-onb-${crypto.randomUUID()}@pos.test`;
  const nit = String(Date.now()).slice(-10);

  await page.goto('/auth/register');
  await page.getByPlaceholder('Juan Pérez').fill('Dueña Onboarding');
  await page.getByPlaceholder('m@example.com').fill(email);
  await page.locator('input[name="password"]').fill('Registro123!');
  await page.locator('input[name="confirmPassword"]').fill('Registro123!');
  await page.getByRole('button', { name: /crear cuenta/i }).click();
  await expect(page.getByText('¡Cuenta creada!')).toBeVisible();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(page).toHaveURL(/\/onboarding/);

  // El registro no crea membresía: sin rol ni organización hasta el onboarding.
  const user = await db.user.findFirstOrThrow({ where: { email, isDeleted: false } });
  expect(await db.membership.count({ where: { userId: user.id } })).toBe(0);

  // Sin membresía no entra al dashboard.
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/onboarding/);

  await page.getByRole('combobox').filter({ hasText: 'Selecciona un tipo de negocio' }).click();
  await page.getByRole('option', { name: /Zapatería/ }).click();
  await page.getByPlaceholder('Ej: Tecnología Innovadora S.A.S').fill('Negocio Onboarding');
  await page.getByPlaceholder('Ej: +57 300 123 4567').fill('+57 300 123 4567');
  await page.getByPlaceholder('Ej: Calle 123 #45-67, Cartagena, Colombia').fill('Calle 10 #20-30, Cartagena');
  await page.getByPlaceholder('Ej: 900.123.456-7').fill(nit);
  await page.getByRole('button', { name: 'Crear mi empresa' }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });

  const memberships = await db.membership.findMany({ where: { userId: user.id, deletedAt: null } });
  expect(memberships).toHaveLength(1);
  expect(memberships[0].role).toBe('ADMIN');
  expect(memberships[0].status).toBe('ACTIVE');
  const org = await db.organization.findUniqueOrThrow({ where: { id: memberships[0].organizationId } });
  expect(org.name).toBe('Negocio Onboarding');
  expect(org.nit).toBe(nit);
  expect(org.isActive).toBe(true);
});
