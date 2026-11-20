'use server';

import { Customer, MembershipRole, Prisma } from '@/generated/prisma';
import { ActionResponse } from '@/interfaces';
import { actorErrorResponse, requireActor, type Actor } from '@/lib/auth/actor';
import { prisma, serializeDecimals } from '../utils';
import { firstIssue, idSchema, internalError, invalidInput, paginationSchema, topLimitSchema, type PaginationInput } from '../common.schemas';
import {
  createCustomerInputSchema,
  customerFiltersSchema,
  customerLookupSchema,
  updateCustomerInputSchema,
  type CreateCustomerInput,
  type CustomerFiltersInput,
  type UpdateCustomerInput,
} from './customer.schemas';

const ADMIN_ONLY = { roles: [MembershipRole.ADMIN] } as const;

// The admin sees the latest sales of each customer; the seller only needs
// the customer's own data to pick it in a sale.
const customerInclude = {
  sales: {
    where: { isDeleted: false },
    select: {
      id: true,
      saleNumber: true,
      total: true,
      status: true,
      saleDate: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 10,
  },
  _count: { select: { sales: true } },
} satisfies Prisma.CustomerInclude;

const includeFor = (actor: Actor) => (actor.role === MembershipRole.ADMIN ? customerInclude : undefined);

const customerNotFound = () => ({ status: 404, message: 'Cliente no encontrado', data: null }) as const;
const invalidCustomerId = () => invalidInput('ID de cliente es requerido');

const handleError = (error: unknown, context: string) => {
  const denied = actorErrorResponse(error);
  if (denied) return denied;
  console.error(`Error ${context}:`, error);
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') {
      return { status: 409, message: 'Ya existe un cliente con esos datos únicos', data: null } as const;
    }
    if (error.code === 'P2025') return customerNotFound();
  }
  return internalError();
};

/** Checks email/document uniqueness among the organization's live customers. */
const checkUniqueFields = async (
  organizationId: string,
  fields: { email?: string | null; document?: string | null },
  excludeId?: string
) => {
  const who = excludeId ? 'otro cliente' : 'un cliente';
  const scope = { organizationId, isDeleted: false, ...(excludeId ? { id: { not: excludeId } } : {}) };
  if (fields.email) {
    const duplicate = await prisma.customer.findFirst({ where: { ...scope, email: fields.email }, select: { id: true } });
    if (duplicate) return { status: 409, message: `Ya existe ${who} con ese email`, data: null } as const;
  }
  if (fields.document) {
    const duplicate = await prisma.customer.findFirst({ where: { ...scope, document: fields.document }, select: { id: true } });
    if (duplicate) return { status: 409, message: `Ya existe ${who} con ese documento`, data: null } as const;
  }
  return null;
};

// ===========================
// CUSTOMER ACTIONS
// ===========================

// CREATE (any member: the seller registers the customer while selling)
export const createCustomer = async (input: CreateCustomerInput): Promise<ActionResponse<Customer | null>> => {
  try {
    const actor = await requireActor();
    const parsed = createCustomerInputSchema.safeParse(input);
    if (!parsed.success) return invalidInput(firstIssue(parsed.error));
    const data = parsed.data;

    const conflict = await checkUniqueFields(actor.organizationId, data);
    if (conflict) return conflict;

    const newCustomer = await prisma.customer.create({
      data: { ...data, organizationId: actor.organizationId },
      include: includeFor(actor),
    });

    return { status: 201, message: 'Cliente creado exitosamente', data: serializeDecimals(newCustomer) };
  } catch (error) {
    return handleError(error, 'creating customer');
  }
};

// GET MANY (any member; the seller only sees active customers)
export const getCustomers = async (
  filters?: CustomerFiltersInput,
  includeDeleted: boolean = false,
  pagination?: PaginationInput
): Promise<ActionResponse<{ customers: Customer[]; total: number } | null>> => {
  try {
    const actor = await requireActor();
    const parsedFilters = customerFiltersSchema.safeParse(filters);
    const parsedPagination = paginationSchema.safeParse(pagination);
    if (!parsedFilters.success || !parsedPagination.success) return invalidInput();
    const f = parsedFilters.data;
    const isAdmin = actor.role === MembershipRole.ADMIN;

    const whereClause: Prisma.CustomerWhereInput = {
      organizationId: actor.organizationId,
      isDeleted: isAdmin && includeDeleted === true ? undefined : false,
    };
    if (!isAdmin) whereClause.isActive = true;
    else if (f?.isActive !== undefined) whereClause.isActive = f.isActive;
    if (f?.city) whereClause.city = f.city;
    if (f?.department) whereClause.department = f.department;
    if (f?.search) {
      whereClause.OR = [
        { firstName: { contains: f.search, mode: 'insensitive' } },
        { lastName: { contains: f.search, mode: 'insensitive' } },
        { email: { contains: f.search, mode: 'insensitive' } },
        { phone: { contains: f.search, mode: 'insensitive' } },
        { document: { contains: f.search, mode: 'insensitive' } },
      ];
    }

    const page = parsedPagination.data?.page ?? 1;
    const limit = parsedPagination.data?.limit ?? 50;

    const [total, customers] = await Promise.all([
      prisma.customer.count({ where: whereClause }),
      prisma.customer.findMany({
        where: whereClause,
        include: includeFor(actor),
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return { status: 200, message: 'Clientes obtenidos exitosamente', data: { customers: serializeDecimals(customers), total } };
  } catch (error) {
    return handleError(error, 'fetching customers');
  }
};

/** One live customer of the organization; the seller only finds active ones. */
const findCustomer = async (actor: Actor, where: Prisma.CustomerWhereInput) => {
  const customer = await prisma.customer.findFirst({
    where: {
      ...where,
      organizationId: actor.organizationId,
      isDeleted: false,
      ...(actor.role === MembershipRole.ADMIN ? {} : { isActive: true }),
    },
    include: includeFor(actor),
  });
  if (!customer) return customerNotFound();
  return { status: 200, message: 'Cliente obtenido exitosamente', data: serializeDecimals(customer) } as const;
};

// GET BY ID (any member)
export const getCustomerById = async (customerId: string): Promise<ActionResponse<Customer | null>> => {
  try {
    const actor = await requireActor();
    const id = idSchema.safeParse(customerId);
    if (!id.success) return invalidCustomerId();
    return await findCustomer(actor, { id: id.data });
  } catch (error) {
    return handleError(error, 'fetching customer');
  }
};

// GET BY EMAIL (any member)
export const getCustomerByEmail = async (email: string): Promise<ActionResponse<Customer | null>> => {
  try {
    const actor = await requireActor();
    const value = customerLookupSchema.safeParse(email);
    if (!value.success) return invalidInput('Email es requerido');
    return await findCustomer(actor, { email: value.data });
  } catch (error) {
    return handleError(error, 'fetching customer by email');
  }
};

// GET BY DOCUMENT (any member)
export const getCustomerByDocument = async (document: string): Promise<ActionResponse<Customer | null>> => {
  try {
    const actor = await requireActor();
    const value = customerLookupSchema.safeParse(document);
    if (!value.success) return invalidInput('Documento es requerido');
    return await findCustomer(actor, { document: value.data });
  } catch (error) {
    return handleError(error, 'fetching customer by document');
  }
};

// UPDATE
export const updateCustomer = async (
  customerId: string,
  input: UpdateCustomerInput
): Promise<ActionResponse<Customer | null>> => {
  try {
    const actor = await requireActor(ADMIN_ONLY);
    const id = idSchema.safeParse(customerId);
    if (!id.success) return invalidCustomerId();
    const parsed = updateCustomerInputSchema.safeParse(input);
    if (!parsed.success) return invalidInput(firstIssue(parsed.error));
    const data = parsed.data;

    const where = { id: id.data, organizationId: actor.organizationId, isDeleted: false };
    const existing = await prisma.customer.findFirst({ where });
    if (!existing) return customerNotFound();

    const conflict = await checkUniqueFields(
      actor.organizationId,
      {
        email: data.email !== existing.email ? data.email : undefined,
        document: data.document !== existing.document ? data.document : undefined,
      },
      existing.id
    );
    if (conflict) return conflict;

    const updatedCustomer = await prisma.customer.update({
      where,
      data: { ...data, updatedAt: new Date() },
      include: customerInclude,
    });

    return { status: 200, message: 'Cliente actualizado exitosamente', data: serializeDecimals(updatedCustomer) };
  } catch (error) {
    return handleError(error, 'updating customer');
  }
};

// SOFT DELETE
export const softDeleteCustomer = async (customerId: string): Promise<ActionResponse> => {
  try {
    const actor = await requireActor(ADMIN_ONLY);
    const id = idSchema.safeParse(customerId);
    if (!id.success) return invalidCustomerId();

    const where = { id: id.data, organizationId: actor.organizationId, isDeleted: false };
    const existing = await prisma.customer.findFirst({
      where,
      include: { _count: { select: { sales: true } } },
    });
    if (!existing) return customerNotFound();

    if (existing._count.sales > 0) {
      return {
        status: 400,
        message: `No se puede eliminar el cliente porque tiene ${existing._count.sales} venta(s) asociada(s). Desactívelo en su lugar.`,
        data: null,
      };
    }

    await prisma.customer.update({
      where,
      data: { isDeleted: true, deletedAt: new Date(), updatedAt: new Date() },
    });

    return { status: 200, message: 'Cliente eliminado exitosamente', data: null };
  } catch (error) {
    return handleError(error, 'deleting customer');
  }
};

// TOGGLE ACTIVE STATUS
export const toggleCustomerActiveStatus = async (customerId: string): Promise<ActionResponse<Customer | null>> => {
  try {
    const actor = await requireActor(ADMIN_ONLY);
    const id = idSchema.safeParse(customerId);
    if (!id.success) return invalidCustomerId();

    const where = { id: id.data, organizationId: actor.organizationId, isDeleted: false };
    const existing = await prisma.customer.findFirst({ where, select: { isActive: true } });
    if (!existing) return customerNotFound();

    const updatedCustomer = await prisma.customer.update({
      where,
      data: { isActive: !existing.isActive, updatedAt: new Date() },
      include: customerInclude,
    });

    return {
      status: 200,
      message: `Cliente ${updatedCustomer.isActive ? 'activado' : 'desactivado'} exitosamente`,
      data: serializeDecimals(updatedCustomer),
    };
  } catch (error) {
    return handleError(error, 'toggling customer status');
  }
};

// ===========================
// ANALYTICS AND REPORTS (admin)
// ===========================

/** Live customer of the organization, or null. */
const findOrgCustomer = (organizationId: string, customerId: string) =>
  prisma.customer.findFirst({ where: { id: customerId, organizationId, isDeleted: false }, select: { id: true } });

// PURCHASE HISTORY
export const getCustomerPurchaseHistory = async (
  customerId: string,
  pagination?: PaginationInput
): Promise<ActionResponse<{ sales: unknown[]; total: number } | null>> => {
  try {
    const actor = await requireActor(ADMIN_ONLY);
    const id = idSchema.safeParse(customerId);
    if (!id.success) return invalidCustomerId();
    const parsedPagination = paginationSchema.safeParse(pagination);
    if (!parsedPagination.success) return invalidInput();

    if (!(await findOrgCustomer(actor.organizationId, id.data))) return customerNotFound();

    const page = parsedPagination.data?.page ?? 1;
    const limit = parsedPagination.data?.limit ?? 20;
    const where = { customerId: id.data, organizationId: actor.organizationId, isDeleted: false };

    const [total, sales] = await Promise.all([
      prisma.sale.count({ where }),
      prisma.sale.findMany({
        where,
        include: {
          store: { select: { id: true, name: true } },
          saleItems: {
            where: { isDeleted: false },
            include: { product: { select: { id: true, name: true, image: true } } },
          },
          salePayments: {
            where: { isDeleted: false },
            include: { paymentMethod: { select: { id: true, name: true, type: true } } },
          },
        },
        orderBy: { saleDate: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return { status: 200, message: 'Historial de compras obtenido exitosamente', data: { sales: serializeDecimals(sales), total } };
  } catch (error) {
    return handleError(error, 'fetching customer purchase history');
  }
};

// STATISTICS
export const getCustomerStatistics = async (
  customerId: string
): Promise<
  ActionResponse<{
    totalPurchases: number;
    totalSpent: number;
    averagePurchase: number;
    lastPurchaseDate: Date | null;
    favoriteProducts: {
      productId: string;
      productName: string;
      totalQuantity: number;
      totalSpent: number;
    }[];
  } | null>
> => {
  try {
    const actor = await requireActor(ADMIN_ONLY);
    const id = idSchema.safeParse(customerId);
    if (!id.success) return invalidCustomerId();
    const organizationId = actor.organizationId;

    if (!(await findOrgCustomer(organizationId, id.data))) return customerNotFound();

    const saleWhere = {
      customerId: id.data,
      organizationId,
      isDeleted: false,
      status: { not: 'CANCELLED' as const },
    };

    const [salesStats, lastSale, favoriteProductsRaw] = await Promise.all([
      prisma.sale.aggregate({
        where: saleWhere,
        _count: { id: true },
        _sum: { total: true },
        _avg: { total: true },
      }),
      prisma.sale.findFirst({ where: saleWhere, orderBy: { saleDate: 'desc' }, select: { saleDate: true } }),
      prisma.saleItem.groupBy({
        by: ['productId'],
        where: { sale: saleWhere, isDeleted: false },
        _sum: { quantity: true, subtotal: true },
        orderBy: { _sum: { quantity: 'desc' } },
        take: 5,
      }),
    ]);

    const productIds = favoriteProductsRaw.map((item) => item.productId);
    const products = await prisma.product.findMany({
      where: { id: { in: productIds }, organizationId },
      select: { id: true, name: true },
    });
    const productMap = new Map(products.map((p) => [p.id, p.name]));

    return {
      status: 200,
      message: 'Estadísticas del cliente obtenidas exitosamente',
      data: {
        totalPurchases: salesStats._count.id,
        totalSpent: Number(salesStats._sum.total ?? 0),
        averagePurchase: Number(salesStats._avg.total ?? 0),
        lastPurchaseDate: lastSale?.saleDate || null,
        favoriteProducts: favoriteProductsRaw.map((item) => ({
          productId: item.productId,
          productName: productMap.get(item.productId) || 'Producto desconocido',
          totalQuantity: item._sum.quantity || 0,
          totalSpent: Number(item._sum.subtotal ?? 0),
        })),
      },
    };
  } catch (error) {
    return handleError(error, 'fetching customer statistics');
  }
};

// TOP CUSTOMERS BY PURCHASES
export const getTopCustomersByPurchases = async (
  limit: number = 10
): Promise<
  ActionResponse<
    | {
        customerId: string;
        customerName: string;
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

    const topCustomers = await prisma.sale.groupBy({
      by: ['customerId'],
      where: {
        organizationId,
        isDeleted: false,
        status: { not: 'CANCELLED' },
        customerId: { not: null },
      },
      _count: { id: true },
      _sum: { total: true },
      orderBy: { _sum: { total: 'desc' } },
      take: take.data,
    });

    const customerIds = topCustomers.map((item) => item.customerId).filter((id): id is string => id !== null);
    const customers = await prisma.customer.findMany({
      where: { id: { in: customerIds }, organizationId },
      select: { id: true, firstName: true, lastName: true },
    });
    const customerMap = new Map(customers.map((c) => [c.id, `${c.firstName} ${c.lastName}`]));

    return {
      status: 200,
      message: 'Top clientes obtenidos exitosamente',
      data: topCustomers.map((item) => ({
        customerId: item.customerId || '',
        customerName: customerMap.get(item.customerId || '') || 'Cliente desconocido',
        totalPurchases: item._count.id,
        totalSpent: Number(item._sum.total ?? 0),
      })),
    };
  } catch (error) {
    return handleError(error, 'fetching top customers');
  }
};
