/** Verify fixtures after migrating an empty DB and running db:seed. No writes. */
import assert from 'node:assert/strict';
import bcrypt from 'bcrypt';
import { Prisma, PrismaClient, MembershipRole } from '../src/generated/prisma';

const client = new PrismaClient();

async function main() {
  assert.equal(await client.organization.count(), 2);
  assert.equal(await client.store.count(), 3);
  assert.equal(await client.user.count(), 7);
  assert.equal(await client.membership.count(), 7);
  assert.equal(await client.product.count(), 8);
  assert.equal(await client.purchase.count(), 2);
  assert.equal(await client.sale.count(), 1);

  const organizations = await client.organization.findMany();
  assert.equal(new Set(organizations.map((org) => org.slug)).size, 2);
  for (const org of organizations) {
    assert.match(org.id, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    assert.ok(org.slug.length > 0);
    const members = await client.membership.findMany({
      where: { organizationId: org.id, deletedAt: null }, include: { user: true, defaultStore: true },
    });
    assert.ok(members.some((member) => member.role === MembershipRole.ADMIN));
    assert.ok(members.some((member) => member.role === MembershipRole.SELLER));
    for (const member of members) {
      assert.equal(member.defaultStore?.organizationId, org.id);
      assert.equal(member.user.isDeleted, false);
      assert.ok(member.user.passwordHash);
      const password = member.role === MembershipRole.ADMIN ? 'Admin123!' :
        member.user.email === 'conflict@pos.test' ? 'Conflict123!' :
        member.user.email === 'lock@pos.test' ? 'Lock123!' : 'Seller123!';
      assert.equal(await bcrypt.compare(password, member.user.passwordHash), true);
    }
  }

  const sharedCodes = await client.product.findMany({ where: { barcode: 'BC001', isDeleted: false } });
  assert.equal(sharedCodes.length, 2);
  assert.notEqual(sharedCodes[0].organizationId, sharedCodes[1].organizationId);
  const isolationOrg = organizations.find((org) => org.name === 'Pos Isolation Org');
  assert.ok(isolationOrg);
  const isolationProduct = sharedCodes.find((product) => product.organizationId === isolationOrg.id);
  assert.ok(isolationProduct);
  assert.equal(isolationProduct.costPrice.toFixed(2), '1200.25');
  assert.equal(isolationProduct.salePrice.toFixed(2), '2000.50');

  for (const purchase of await client.purchase.findMany({ include: { supplier: true, purchaseItems: { include: { product: true } } } })) {
    assert.equal(purchase.supplier.organizationId, purchase.organizationId);
    const sum = purchase.purchaseItems.reduce((total, item) => {
      assert.equal(item.product.organizationId, purchase.organizationId);
      assert.equal(item.unitPrice.mul(item.quantity).equals(item.subtotal), true);
      return total.add(item.subtotal);
    }, new Prisma.Decimal(0));
    assert.equal(purchase.total.equals(sum), true);
  }
  const primaryOrg = organizations.find((org) => org.name === 'Pos Demo Org');
  assert.ok(primaryOrg);
  const primaryProduct = sharedCodes.find((product) => product.organizationId === primaryOrg.id);
  assert.ok(primaryProduct);
  assert.equal(primaryProduct.currentStock, 98);
  assert.equal(isolationProduct.currentStock, 12);
  const sale = await client.sale.findFirstOrThrow({ include: { saleItems: true, salePayments: true } });
  const paid = sale.salePayments.reduce((total, payment) => total.add(payment.amount), new Prisma.Decimal(0));
  const subtotal = sale.saleItems.reduce((total, item) => total.add(item.subtotal), new Prisma.Decimal(0));
  assert.equal(sale.total.equals(paid), true);
  assert.equal(sale.subtotal.equals(subtotal), true);
  console.info('Seed verified: two tenants, memberships, credentials, UUIDv7, Decimal totals and stock.');
  console.info('Fixture separation is not proof of application authorization or effective RLS.');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.name : 'UnknownError');
  process.exitCode = 1;
}).finally(async () => client.$disconnect());
