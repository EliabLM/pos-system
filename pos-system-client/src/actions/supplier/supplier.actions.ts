'use server';

import { MembershipRole, Prisma, Supplier } from '@/generated/prisma';
import { ActionResponse } from '@/interfaces';
import { actorErrorResponse, requireActor } from '@/lib/auth/actor';
import { prisma, serializeDecimals } from '../utils';
import { firstIssue, idSchema, internalError, invalidInput, paginationSchema, topLimitSchema, type PaginationInput } from '../common.schemas';
import {
  createSupplierInputSchema,
  supplierFiltersSchema,
  supplierLookupSchema,
  updateSupplierInputSchema,
  type CreateSupplierInput,
  type SupplierFiltersInput,
  type UpdateSupplierInput,
} from './supplier.schemas';

// Suppliers and purchases are administration only (lib/rbac.ts).
const ADMIN_ONLY = { roles: [MembershipRole.ADMIN] } as const;

const supplierInclude = {
  purchases: {
    where: { isDeleted: false },
    select: {
      id: true,
      purchaseNumber: true,
      total: true,
      status: true,
      purchaseDate: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 10,
  },
  _count: { select: { purchases: true } },
} satisfies Prisma.SupplierInclude;

const supplierNotFound = () => ({ status: 404, message: 'Proveedor no encontrado', data: null }) as const;
const invalidSupplierId = () => invalidInput('ID de proveedor es requerido');

const handleError = (error: unknown, context: string) => {
  const denied = actorErrorResponse(error);
  if (denied) return denied;
  console.error(`Error ${context}:`, error);
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') {
      return { status: 409, message: 'Ya existe un proveedor con esos datos únicos', data: null } as const;
    }
    if (error.code === 'P2025') return supplierNotFound();
  }
  return internalError();
};

/** Checks email/tax id uniqueness among the organization's live suppliers. */
const checkUniqueFields = async (
  organizationId: string,
  fields: { email?: string | null; taxId?: string | null },
  excludeId?: string
) => {
  const who = excludeId ? 'otro proveedor' : 'un proveedor';
  const scope = { organizationId, isDeleted: false, ...(excludeId ? { id: { not: excludeId } } : {}) };
  if (fields.email) {
    const duplicate = await prisma.supplier.findFirst({ where: { ...scope, email: fields.email }, select: { id: true } });
    if (duplicate) return { status: 409, message: `Ya existe ${who} con ese email`, data: null } as const;
  }
  if (fields.taxId) {
    const duplicate = await prisma.supplier.findFirst({ where: { ...scope, taxId: fields.taxId }, select: { id: true } });
    if (duplicate) return { status: 409, message: `Ya existe ${who} con ese NIT/RUC`, data: null } as const;
  }
  return null;
};

// ===========================
// SUPPLIER ACTIONS
// ===========================

// CREATE
export const createSupplier = async (input: CreateSupplierInput): Promise<ActionResponse<Supplier | null>> => {
  try {
    const actor = await requireActor(ADMIN_ONLY);
    const parsed = createSupplierInputSchema.safeParse(input);
    if (!parsed.success) return invalidInput(firstIssue(parsed.error));
    const data = parsed.data;

    const conflict = await checkUniqueFields(actor.organizationId, data);
    if (conflict) return conflict;

    const newSupplier = await prisma.supplier.create({
      data: { ...data, organizationId: actor.organizationId },
      include: supplierInclude,
    });

    return { status: 201, message: 'Proveedor creado exitosamente', data: serializeDecimals(newSupplier) };
  } catch (error) {
    return handleError(error, 'creating supplier');
  }
};

// GET MANY
export const getSuppliers = async (
  filters?: SupplierFiltersInput,
  includeDeleted: boolean = false,
  pagination?: PaginationInput
): Promise<ActionResponse<{ suppliers: Supplier[]; total: number } | null>> => {
  try {
    const actor = await requireActor(ADMIN_ONLY);
    const parsedFilters = supplierFiltersSchema.safeParse(filters);
    const parsedPagination = paginationSchema.safeParse(pagination);
    if (!parsedFilters.success || !parsedPagination.success) return invalidInput();
    const f = parsedFilters.data;

    const whereClause: Prisma.SupplierWhereInput = {
      organizationId: actor.organizationId,
      isDeleted: includeDeleted === true ? undefined : false,
    };
    if (f?.isActive !== undefined) whereClause.isActive = f.isActive;
    if (f?.city) whereClause.city = f.city;
    if (f?.department) whereClause.department = f.department;
    if (f?.search) {
      whereClause.OR = [
        { name: { contains: f.search, mode: 'insensitive' } },
        { contactName: { contains: f.search, mode: 'insensitive' } },
        { email: { contains: f.search, mode: 'insensitive' } },
        { phone: { contains: f.search, mode: 'insensitive' } },
        { taxId: { contains: f.search, mode: 'insensitive' } },
      ];
    }

    const page = parsedPagination.data?.page ?? 1;
    const limit = parsedPagination.data?.limit ?? 50;

    const [total, suppliers] = await Promise.all([
      prisma.supplier.count({ where: whereClause }),
      prisma.supplier.findMany({
        where: whereClause,
        include: supplierInclude,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return {
      status: 200,
      message: 'Proveedores obtenidos exitosamente',
      data: { suppliers: serializeDecimals(suppliers), total },
    };
  } catch (error) {
    return handleError(error, 'fetching suppliers');
  }
};

/** One live supplier of the organization. */
const findSupplier = async (organizationId: string, where: Prisma.SupplierWhereInput) => {
  const supplier = await prisma.supplier.findFirst({
    where: { ...where, organizationId, isDeleted: false },
    include: supplierInclude,
  });
  if (!supplier) return supplierNotFound();
  return { status: 200, message: 'Proveedor obtenido exitosamente', data: serializeDecimals(supplier) } as const;
};

// GET BY ID
export const getSupplierById = async (supplierId: string): Promise<ActionResponse<Supplier | null>> => {
  try {
    const actor = await requireActor(ADMIN_ONLY);
    const id = idSchema.safeParse(supplierId);
    if (!id.success) return invalidSupplierId();
    return await findSupplier(actor.organizationId, { id: id.data });
  } catch (error) {
    return handleError(error, 'fetching supplier');
  }
};

// GET BY TAX ID
export const getSupplierByTaxId = async (taxId: string): Promise<ActionResponse<Supplier | null>> => {
  try {
    const actor = await requireActor(ADMIN_ONLY);
    const value = supplierLookupSchema.safeParse(taxId);
    if (!value.success) return invalidInput('NIT/RUC es requerido');
    return await findSupplier(actor.organizationId, { taxId: value.data });
  } catch (error) {
    return handleError(error, 'fetching supplier by taxId');
  }
};

// GET BY EMAIL
export const getSupplierByEmail = async (email: string): Promise<ActionResponse<Supplier | null>> => {
  try {
    const actor = await requireActor(ADMIN_ONLY);
    const value = supplierLookupSchema.safeParse(email);
    if (!value.success) return invalidInput('Email es requerido');
    return await findSupplier(actor.organizationId, { email: value.data });
  } catch (error) {
    return handleError(error, 'fetching supplier by email');
  }
};

// UPDATE
export const updateSupplier = async (
  supplierId: string,
  input: UpdateSupplierInput
): Promise<ActionResponse<Supplier | null>> => {
  try {
    const actor = await requireActor(ADMIN_ONLY);
    const id = idSchema.safeParse(supplierId);
    if (!id.success) return invalidSupplierId();
    const parsed = updateSupplierInputSchema.safeParse(input);
    if (!parsed.success) return invalidInput(firstIssue(parsed.error));
    const data = parsed.data;

    const where = { id: id.data, organizationId: actor.organizationId, isDeleted: false };
    const existing = await prisma.supplier.findFirst({ where });
    if (!existing) return supplierNotFound();

    const conflict = await checkUniqueFields(
      actor.organizationId,
      {
        email: data.email !== existing.email ? data.email : undefined,
        taxId: data.taxId !== existing.taxId ? data.taxId : undefined,
      },
      existing.id
    );
    if (conflict) return conflict;

    const updatedSupplier = await prisma.supplier.update({
      where,
      data: { ...data, updatedAt: new Date() },
      include: supplierInclude,
    });

    return { status: 200, message: 'Proveedor actualizado exitosamente', data: serializeDecimals(updatedSupplier) };
  } catch (error) {
    return handleError(error, 'updating supplier');
  }
};

// SOFT DELETE
export const softDeleteSupplier = async (supplierId: string): Promise<ActionResponse> => {
  try {
    const actor = await requireActor(ADMIN_ONLY);
    const id = idSchema.safeParse(supplierId);
    if (!id.success) return invalidSupplierId();

    const where = { id: id.data, organizationId: actor.organizationId, isDeleted: false };
    const existing = await prisma.supplier.findFirst({
      where,
      include: { _count: { select: { purchases: true } } },
    });
    if (!existing) return supplierNotFound();

    if (existing._count.purchases > 0) {
      return {
        status: 400,
        message: `No se puede eliminar el proveedor porque tiene ${existing._count.purchases} compra(s) asociada(s). Desactívelo en su lugar.`,
        data: null,
      };
    }

    await prisma.supplier.update({
      where,
      data: { isDeleted: true, deletedAt: new Date(), updatedAt: new Date() },
    });

    return { status: 200, message: 'Proveedor eliminado exitosamente', data: null };
  } catch (error) {
    return handleError(error, 'deleting supplier');
  }
};

// TOGGLE ACTIVE STATUS
export const toggleSupplierActiveStatus = async (supplierId: string): Promise<ActionResponse<Supplier | null>> => {
  try {
    const actor = await requireActor(ADMIN_ONLY);
    const id = idSchema.safeParse(supplierId);
    if (!id.success) return invalidSupplierId();

    const where = { id: id.data, organizationId: actor.organizationId, isDeleted: false };
    const existing = await prisma.supplier.findFirst({ where, select: { isActive: true } });
    if (!existing) return supplierNotFound();

    const updatedSupplier = await prisma.supplier.update({
      where,
      data: { isActive: !existing.isActive, updatedAt: new Date() },
      include: supplierInclude,
    });

    return {
      status: 200,
      message: `Proveedor ${updatedSupplier.isActive ? 'activado' : 'desactivado'} exitosamente`,
      data: serializeDecimals(updatedSupplier),
    };
  } catch (error) {
    return handleError(error, 'toggling supplier status');
  }
};

// ===========================
// ANALYTICS AND REPORTS
// ===========================

/** Live supplier of the organization, or null. */
const findOrgSupplier = (organizationId: string, supplierId: string) =>
  prisma.supplier.findFirst({ where: { id: supplierId, organizationId, isDeleted: false }, select: { id: true } });

// PURCHASE HISTORY
export const getSupplierPurchaseHistory = async (
  supplierId: string,
  pagination?: PaginationInput
): Promise<ActionResponse<{ purchases: unknown[]; total: number } | null>> => {
  try {
    const actor = await requireActor(ADMIN_ONLY);
    const id = idSchema.safeParse(supplierId);
    if (!id.success) return invalidSupplierId();
    const parsedPagination = paginationSchema.safeParse(pagination);
    if (!parsedPagination.success) return invalidInput();

    if (!(await findOrgSupplier(actor.organizationId, id.data))) return supplierNotFound();

    const page = parsedPagination.data?.page ?? 1;
    const limit = parsedPagination.data?.limit ?? 20;
    const where = { supplierId: id.data, organizationId: actor.organizationId, isDeleted: false };

    const [total, purchases] = await Promise.all([
      prisma.purchase.count({ where }),
      prisma.purchase.findMany({
        where,
        include: {
          purchaseItems: {
            where: { isDeleted: false },
            include: { product: { select: { id: true, name: true, image: true } } },
          },
        },
        orderBy: { purchaseDate: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return {
      status: 200,
      message: 'Historial de compras obtenido exitosamente',
      data: { purchases: serializeDecimals(purchases), total },
    };
  } catch (error) {
    return handleError(error, 'fetching supplier purchase history');
  }
};

// STATISTICS
export const getSupplierStatistics = async (
  supplierId: string
): Promise<
  ActionResponse<{
    totalPurchases: number;
    totalSpent: number;
    averagePurchase: number;
    lastPurchaseDate: Date | null;
  } | null>
> => {
  try {
    const actor = await requireActor(ADMIN_ONLY);
    const id = idSchema.safeParse(supplierId);
    if (!id.success) return invalidSupplierId();

    if (!(await findOrgSupplier(actor.organizationId, id.data))) return supplierNotFound();

    const where = {
      supplierId: id.data,
      organizationId: actor.organizationId,
      isDeleted: false,
      status: { not: 'CANCELLED' as const },
    };

    const [purchaseStats, lastPurchase] = await Promise.all([
      prisma.purchase.aggregate({
        where,
        _count: { id: true },
        _sum: { total: true },
        _avg: { total: true },
      }),
      prisma.purchase.findFirst({ where, orderBy: { purchaseDate: 'desc' }, select: { purchaseDate: true } }),
    ]);

    return {
      status: 200,
      message: 'Estadísticas del proveedor obtenidas exitosamente',
      data: {
        totalPurchases: purchaseStats._count.id,
        totalSpent: Number(purchaseStats._sum.total ?? 0),
        averagePurchase: Number(purchaseStats._avg.total ?? 0),
        lastPurchaseDate: lastPurchase?.purchaseDate || null,
      },
    };
  } catch (error) {
    return handleError(error, 'fetching supplier statistics');
  }
};

// TOP SUPPLIERS BY PURCHASES
export const getTopSuppliersByPurchases = async (
  limit: number = 10
): Promise<
  ActionResponse<
    | {
        supplierId: string;
        supplierName: string;
        totalPurchases: number;
        totalSpent: number;
      }[]
    | null
  >
> => {
  try {
    const actor = await requireActor(ADMIN_ONLY);
    const take = topLimitSchema.safeParse(limit);
    if (!take.success) return invalidInput();
    const organizationId = actor.organizationId;

    const topSuppliers = await prisma.purchase.groupBy({
      by: ['supplierId'],
      where: { organizationId, isDeleted: false, status: { not: 'CANCELLED' } },
      _count: { id: true },
      _sum: { total: true },
      orderBy: { _sum: { total: 'desc' } },
      take: take.data,
    });

    const supplierIds = topSuppliers.map((item) => item.supplierId);
    const suppliers = await prisma.supplier.findMany({
      where: { id: { in: supplierIds }, organizationId },
      select: { id: true, name: true },
    });
    const supplierMap = new Map(suppliers.map((s) => [s.id, s.name]));

    return {
      status: 200,
      message: 'Top proveedores obtenidos exitosamente',
      data: topSuppliers.map((item) => ({
        supplierId: item.supplierId,
        supplierName: supplierMap.get(item.supplierId) || 'Proveedor desconocido',
        totalPurchases: item._count.id,
        totalSpent: Number(item._sum.total ?? 0),
      })),
    };
  } catch (error) {
    return handleError(error, 'fetching top suppliers');
  }
};
