/**
 * ============================================
 * SEED IDEMPOTENTE — POS System (pos-system-client)
 * ============================================
 *
 * Puebla la DB local (docker compose) con un mínimo determinista de datos para
 * que la suite E2E de Playwright encuentre siempre el mismo estado en cada
 * corrida. Ver `docs/features/testing/playwright-test-plan.md` §5.
 *
 * Estrategia: deleteMany en orden inverso a las FKs y luego create en orden
 * correcto. Los IDs cambian por corrida (UUIDv7) — los specs deben resolver IDs
 * por UI o por consulta, nunca hardcodearlos.
 *
 * Ejecutar desde `pos-system-client/`:
 *   POS_SEED_ALLOW_RESET=1 pnpm db:seed # borra y recrea SOLO datos sintéticos
 *
 * Conexión: usa `process.env.DATABASE_URL`. Cuando se corre desde el host contra
 * el stack docker debe apuntar a `postgresql://pos:pos@localhost:5432/pos`.
 * Dentro del contenedor client apunta a `db:5432` (ya inyectado por compose).
 *
 * Contraseñas sembradas (todas cumplen la regex del registro):
 *   admin@pos.test     → Admin123!
 *   seller@pos.test    → Seller123!
 *   conflict@pos.test  → Conflict123!
 *   lock@pos.test      → Lock123!
 *   trash@pos.test     → Trash123!   (isDeleted=true)
 */

import { Prisma, PrismaClient, MembershipRole, MembershipStatus, SaleStatus, PaymentType, StockMovementType, AuditAction, PurchaseStatus } from '../src/generated/prisma';
import bcrypt from 'bcrypt';
import { assertSeedTarget, SeedTargetError } from './seed-guard';

const client = new PrismaClient();

const SEED_ORG_NAME = 'Pos Demo Org';
const SEED_STORE_CENTRAL = 'Store Central';
const SEED_STORE_NORTE = 'Store Sucursal Norte';

async function hash(plain: string): Promise<string> {
  return bcrypt.hash(plain, 12);
}

async function seed(prisma: Prisma.TransactionClient) {
  console.info('🌱 Seed: iniciando (reemplazo transaccional)...');

  // ============================================================
  // 1. BORRAR (orden inverso a FKs)
  // ============================================================
  await prisma.stockMovement.deleteMany({});
  await prisma.salePayment.deleteMany({});
  await prisma.saleItem.deleteMany({});
  await prisma.sale.deleteMany({});
  await prisma.purchaseItem.deleteMany({});
  await prisma.purchase.deleteMany({});
  await prisma.product.deleteMany({});
  await prisma.customer.deleteMany({});
  await prisma.supplier.deleteMany({});
  await prisma.paymentMethod.deleteMany({});
  await prisma.unitMeasure.deleteMany({});
  await prisma.brand.deleteMany({});
  await prisma.category.deleteMany({});
  await prisma.verification.deleteMany({});
  await prisma.session.deleteMany({});
  await prisma.auditLog.deleteMany({});
  await prisma.systemConfig.deleteMany({});
  await prisma.membership.deleteMany({});
  await prisma.account.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.store.deleteMany({});
  await prisma.organization.deleteMany({});
  await prisma.legacyIdMap.deleteMany({});
  console.info('🧹 Seed: registros previos eliminados.');

  // ============================================================
  // 2. ORGANIZATION + STORES
  // ============================================================
  const org = await prisma.organization.create({
    data: {
      name: SEED_ORG_NAME,
      email: 'org@pos.test',
      nit: '900123456-7',
      phone: '+57 300 000 0000',
      address: 'Calle 100 # 50-25',
      city: 'Bogotá',
      department: 'Cundinamarca',
      isActive: true,
      isDeleted: false,
    },
  });

  const storeCentral = await prisma.store.create({
    data: {
      organizationId: org.id,
      name: SEED_STORE_CENTRAL,
      description: 'Tienda principal',
      address: 'Av. Caracas # 1-99',
      city: 'Bogotá',
      department: 'Cundinamarca',
      phone: '+57 301 111 1111',
      saleNumberPrefix: 'SC',
      lastSaleNumber: 1, // siguiente venta creada por test = SC-000002
      isActive: true,
      isDeleted: false,
    },
  });

  const storeNorte = await prisma.store.create({
    data: {
      organizationId: org.id,
      name: SEED_STORE_NORTE,
      description: 'Sucursal norte',
      address: 'Calle 200 # 50-25',
      city: 'Bogotá',
      department: 'Cundinamarca',
      phone: '+57 301 222 2222',
      saleNumberPrefix: 'SN',
      lastSaleNumber: 0,
      isActive: true,
      isDeleted: false,
    },
  });

  // ============================================================
  // 3. USERS (active = admin, seller; auxiliares para tests)
  // ============================================================
  const adminPass = await hash('Admin123!');
  const sellerPass = await hash('Seller123!');
  const conflictPass = await hash('Conflict123!');
  const lockPass = await hash('Lock123!');
  const trashPass = await hash('Trash123!');

  // D3.3: users son identidades globales; la tenancy (org, store, role) vive
  // en memberships. Cada user activo recibe su membership ACTIVE.
  const createUserWithMembership = async (input: {
    email: string;
    name: string;
    passwordHash: string;
    role: MembershipRole;
    deleted?: boolean;
  }) => {
    const user = await prisma.user.create({
      data: {
        email: input.email,
        name: input.name,
        passwordHash: input.passwordHash,
        isActive: true,
        isDeleted: input.deleted ?? false,
        deletedAt: input.deleted ? new Date() : null,
        emailVerified: true,
        passwordChangedAt: new Date(),
      },
    });

    await prisma.membership.create({
      data: {
        userId: user.id,
        organizationId: org.id,
        role: input.role,
        defaultStoreId: storeCentral.id,
        status: MembershipStatus.ACTIVE,
        acceptedAt: new Date(),
        deletedAt: input.deleted ? new Date() : null,
      },
    });

    return user;
  };

  const admin = await createUserWithMembership({
    email: 'admin@pos.test',
    name: 'Ada Administradora',
    passwordHash: adminPass,
    role: MembershipRole.ADMIN,
  });

  const seller = await createUserWithMembership({
    email: 'seller@pos.test',
    name: 'Sam Vendedor',
    passwordHash: sellerPass,
    role: MembershipRole.SELLER,
  });

  // Auxiliares de prueba — no tasks de login activo por defecto.
  await createUserWithMembership({
    email: 'conflict@pos.test',
    name: 'Connor Conflicto',
    passwordHash: conflictPass,
    role: MembershipRole.SELLER,
  });

  await createUserWithMembership({
    email: 'lock@pos.test',
    name: 'Logan Locke',
    passwordHash: lockPass,
    role: MembershipRole.SELLER,
  });

  await createUserWithMembership({
    email: 'trash@pos.test',
    name: 'Trisha Borrada',
    passwordHash: trashPass,
    role: MembershipRole.SELLER,
    deleted: true, // escenario E034 / E146
  });

  // ============================================================
  // 4. PARAMETRIZACIÓN
  // ============================================================
  const categories = await Promise.all(
    ['Bebidas', 'Snacks', 'Licores'].map((name) =>
      prisma.category.create({
        data: { organizationId: org.id, name, description: `Categoría ${name}`, isActive: true, isDeleted: false },
      }),
    ),
  );

  const brands = await Promise.all(
    ['Marca A', 'Marca B', 'Marca C'].map((name) =>
      prisma.brand.create({
        data: { organizationId: org.id, name, description: `Brand ${name}`, isActive: true, isDeleted: false },
      }),
    ),
  );

  const unitMeasures = await Promise.all(
    [
      { name: 'unidad', abbreviation: 'u' },
      { name: 'kilogramo', abbreviation: 'kg' },
      { name: 'litro', abbreviation: 'L' },
    ].map((u) =>
      prisma.unitMeasure.create({
        data: { organizationId: org.id, name: u.name, abbreviation: u.abbreviation, isActive: true, isDeleted: false },
      }),
    ),
  );

  const paymentMethods = await Promise.all(
    [
      { name: 'Efectivo', type: PaymentType.CASH },
      { name: 'Tarjeta', type: PaymentType.CARD },
      { name: 'Transferencia', type: PaymentType.TRANSFER },
    ].map((pm) =>
      prisma.paymentMethod.create({
        data: { organizationId: org.id, name: pm.name, type: pm.type, isActive: true, isDeleted: false },
      }),
    ),
  );

  // ============================================================
  // 5. SUPPLIERS + CUSTOMERS
  // ============================================================
  const suppliers = await Promise.all(
    [
      { name: 'Distrib SA', contactName: 'David', taxId: '1111', email: 'distrib@pos.test', phone: '3001' },
      { name: 'Mayorista SA', contactName: 'Marta', taxId: '2222', email: 'mayorista@pos.test', phone: '3002' },
    ].map((s) =>
      prisma.supplier.create({
        data: { organizationId: org.id, ...s, isActive: true, isDeleted: false },
      }),
    ),
  );

  const customers = await Promise.all(
    [
      { firstName: 'Juan', lastName: 'Pérez', email: 'juan.perez@pos.test', phone: '3101111111', document: '12345678', documentType: 'CC', address: 'Calle 10' },
      { firstName: 'Ana', lastName: 'López', email: 'ana.lopez@pos.test', phone: '3102222222', document: '87654321', documentType: 'CC', address: 'Calle 20' },
      { firstName: 'Carlos', lastName: 'Ruiz', email: 'carlos.ruiz@pos.test', phone: '3103333333', document: '11223344', documentType: 'CC', address: 'Calle 30' },
    ].map((c) =>
      prisma.customer.create({
        data: { organizationId: org.id, ...c, isActive: true, isDeleted: false },
      }),
    ),
  );

  // ============================================================
  // 6. PRODUCTS (stocks variados para los escenarios de venta)
  // ============================================================
  const [catBebidas, , catLicores] = categories;
  const [brandA, brandB] = brands;
  const [unitU] = unitMeasures;

  // 5 productos + 1 inactivo + 1 soft-deleted para E055/E062.
  const productsSeed = [
    { name: 'Producto A', barcode: 'BC001', sku: 'SKU001', costPrice: 5_000, salePrice: 7_500, currentStock: 100, minStock: 10, categoryId: catBebidas.id, brandId: brandA.id, unitMeasureId: unitU.id, isActive: true, isDeleted: false },
    { name: 'Producto B', barcode: 'BC002', sku: 'SKU002', costPrice: 12_000, salePrice: 18_000, currentStock: 50, minStock: 5, categoryId: catBebidas.id, brandId: brandB.id, unitMeasureId: unitU.id, isActive: true, isDeleted: false },
    { name: 'Producto C', barcode: 'BC003', sku: 'SKU003', costPrice: 25_000, salePrice: 35_000, currentStock: 3, minStock: 5, categoryId: catLicores.id, brandId: brandA.id, unitMeasureId: unitU.id, isActive: true, isDeleted: false },
    { name: 'Producto D', barcode: 'BC004', sku: 'SKU004', costPrice: 1_500, salePrice: 3_000, currentStock: 0, minStock: 2, categoryId: catBebidas.id, brandId: brandB.id, unitMeasureId: unitU.id, isActive: true, isDeleted: false },
    { name: 'Producto E', barcode: 'BC005', sku: 'SKU005', costPrice: 8_000, salePrice: 12_000, currentStock: 200, minStock: 0, categoryId: catBebidas.id, brandId: brandA.id, unitMeasureId: unitU.id, isActive: true, isDeleted: false },
    { name: 'Producto Inactivo', barcode: 'BC006', sku: 'SKU006', costPrice: 10_000, salePrice: 15_000, currentStock: 30, minStock: 5, categoryId: catBebidas.id, brandId: brandA.id, unitMeasureId: unitU.id, isActive: false, isDeleted: false },
    { name: 'Producto Borrado', barcode: 'BC007', sku: 'SKU007', costPrice: 9_000, salePrice: 14_000, currentStock: 20, minStock: 5, categoryId: catBebidas.id, brandId: brandA.id, unitMeasureId: unitU.id, isActive: true, isDeleted: true, deletedAt: new Date() },
  ];

  const products = await Promise.all(
    productsSeed.map((p) =>
      prisma.product.create({
        data: {
          organizationId: org.id,
          name: p.name,
          barcode: p.barcode,
          sku: p.sku,
          costPrice: p.costPrice,
          salePrice: p.salePrice,
          currentStock: p.currentStock,
          minStock: p.minStock,
          categoryId: p.categoryId,
          brandId: p.brandId,
          unitMeasureId: p.unitMeasureId,
          isActive: p.isActive,
          isDeleted: p.isDeleted,
          deletedAt: 'deletedAt' in p && p.isDeleted ? p.deletedAt ?? null : null,
        },
      }),
    ),
  );

  // ============================================================
  // 7. SYSTEM CONFIG (opcional, para onboarding consistente)
  // ============================================================
  await prisma.systemConfig.create({
    data: {
      organizationId: org.id,
      key: 'currency',
      value: 'COP',
      type: 'STRING',
      description: 'Moneda predeterminada',
      isDeleted: false,
    },
  });

  // ============================================================
  // 8. VENTA HISTÓRICA PAID (SC-000001) + STOCK MOVEMENT OUT
  // ============================================================
  const [productA, productB] = products;
  const [cashPM] = paymentMethods;
  const [customerJuan] = customers;

  const saleItems = [
    { product: productA, quantity: 2, unitPrice: productA.salePrice.toNumber() },
    { product: productB, quantity: 1, unitPrice: productB.salePrice.toNumber() },
  ];
  const subtotal = saleItems.reduce((s, it) => s + it.quantity * it.unitPrice, 0);
  const total = subtotal;

  const sale = await prisma.sale.create({
    data: {
      organizationId: org.id,
      storeId: storeCentral.id,
      saleNumber: 'SC-000001',
      customerId: customerJuan.id,
      userId: admin.id,
      subtotal,
      total,
      status: SaleStatus.PAID,
      saleDate: new Date(),
      notes: 'Venta histórica sembrada',
      isDeleted: false,
    },
  });

  for (const it of saleItems) {
    await prisma.saleItem.create({
      data: {
        saleId: sale.id,
        productId: it.product.id,
        unitMeasureId: it.product.unitMeasureId,
        quantity: it.quantity,
        unitPrice: it.unitPrice,
        subtotal: it.quantity * it.unitPrice,
        isDeleted: false,
      },
    });
    // Descuento de stock manual (el seed no invoca createSale → replicar).
    const previous = it.product.currentStock;
    const next = previous - it.quantity;
    await prisma.product.update({
      where: { id: it.product.id },
      data: { currentStock: next },
    });
    await prisma.stockMovement.create({
      data: {
        organizationId: org.id,
        productId: it.product.id,
        storeId: storeCentral.id,
        type: StockMovementType.OUT,
        quantity: it.quantity,
        previousStock: previous,
        newStock: next,
        reason: `Venta SC-000001`,
        userId: admin.id,
        reference: sale.id,
      },
    });
  }

  await prisma.salePayment.create({
    data: {
      saleId: sale.id,
      paymentMethodId: cashPM.id,
      amount: total,
      reference: 'EFECTIVO-SEED',
      paymentDate: new Date(),
      isDeleted: false,
    },
  });

  // ============================================================
  // 9. PURCHASE PENDING (para E107/E108 — recibir/cancelar)
  // ============================================================
  const [supplierDistrib] = suppliers;
  const purchase = await prisma.purchase.create({
    data: {
      organizationId: org.id,
      supplierId: supplierDistrib.id,
      purchaseNumber: 'COMP-000001',
      total: 50_000,
      status: PurchaseStatus.PENDING,
      purchaseDate: new Date(),
      isDeleted: false,
    },
  });
  await prisma.purchaseItem.create({
    data: {
      purchaseId: purchase.id,
      productId: productA.id,
      quantity: 10,
      unitPrice: 5_000,
      subtotal: 50_000,
      isDeleted: false,
    },
  });

  // ============================================================
  // 10. AUDIT LOG (sembrado mínimo para reports/auditoría futura)
  // ============================================================
  await prisma.auditLog.create({
    data: {
      actorUserId: admin.id,
      action: AuditAction.LOGIN,
      targetType: 'sessions',
      targetId: null,
      organizationId: org.id,
      metadata: { note: 'seed' },
      createdAt: new Date(),
    },
  });

  // Segunda organización independiente para regresión de autorización/tenant.
  // Nombres y códigos iguales son intencionales: deben poder coexistir por org.
  const isolationOrg = await prisma.organization.create({
    data: { name: 'Pos Isolation Org', email: 'isolation@pos.test', nit: '900654321-0' },
  });
  const isolationStore = await prisma.store.create({
    data: { organizationId: isolationOrg.id, name: SEED_STORE_CENTRAL,
      address: 'Dirección sintética', saleNumberPrefix: 'SI' },
  });
  for (const input of [
    { email: 'admin.isolation@pos.test', name: 'Admin Aislamiento', role: MembershipRole.ADMIN, passwordHash: adminPass },
    { email: 'seller.isolation@pos.test', name: 'Seller Aislamiento', role: MembershipRole.SELLER, passwordHash: sellerPass },
  ]) {
    await prisma.user.create({ data: {
      email: input.email, name: input.name, passwordHash: input.passwordHash,
      emailVerified: true, passwordChangedAt: new Date(),
      memberships: { create: { organizationId: isolationOrg.id,
        defaultStoreId: isolationStore.id, role: input.role,
        status: MembershipStatus.ACTIVE, acceptedAt: new Date() } },
    } });
  }
  const isolationCategory = await prisma.category.create({
    data: { organizationId: isolationOrg.id, name: 'Bebidas' },
  });
  const isolationProduct = await prisma.product.create({
    data: { organizationId: isolationOrg.id, name: 'Producto A', barcode: 'BC001',
      sku: 'SKU001', categoryId: isolationCategory.id, costPrice: '1200.25',
      salePrice: '2000.50', currentStock: 12, minStock: 2 },
  });
  const isolationSupplier = await prisma.supplier.create({
    data: { organizationId: isolationOrg.id, name: 'Distrib SA', taxId: '1111' },
  });
  await prisma.purchase.create({ data: {
    organizationId: isolationOrg.id, supplierId: isolationSupplier.id,
    purchaseNumber: 'COMP-000001', total: '2400.50', status: PurchaseStatus.PENDING,
    purchaseItems: { create: { productId: isolationProduct.id,
      quantity: 2, unitPrice: '1200.25', subtotal: '2400.50' } },
  } });

  console.info('Seed: fixtures creados; confirmación de transacción pendiente.');
  console.info(`   Org: ${org.name} (${org.id})`);
  console.info(`   Stores: ${storeCentral.name} (SC, lastSale=1), ${storeNorte.name} (SN, lastSale=0)`);
  console.info(`   Users: admin@pos.test / Admin123!  (ADMIN)`);
  console.info(`           seller@pos.test / Seller123! (SELLER)`);
  console.info(`           conflict@pos.test (aux), lock@pos.test (aux), trash@pos.test (deleted)`);
  console.info(`   Products: ${products.length} (5 activos + 1 inactivo + 1 borrado)`);
  console.info(`   Sale histórica: SC-000001 — PAID, ${saleItems.length} items, total=${total}`);
}

async function main() {
  assertSeedTarget(process.env);
  await client.$transaction(seed, { timeout: 120_000, maxWait: 10_000 });
  console.info('✅ Seed: transacción confirmada; dos organizaciones sintéticas listas.');
}

main()
  .catch((e) => {
    console.error('❌ Seed: error fatal.', e instanceof SeedTargetError ? e.message : e instanceof Error ? e.name : 'UnknownError');
    process.exitCode = 1;
  })
  .finally(async () => {
    await client.$disconnect();
  });
