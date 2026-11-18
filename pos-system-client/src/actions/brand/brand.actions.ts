'use server';

import { Brand, MembershipRole, Prisma } from '@/generated/prisma';
import { ActionResponse } from '@/interfaces';
import { actorErrorResponse, requireActor } from '@/lib/auth/actor';
import { prisma } from '../utils';
import { firstIssue, idSchema, internalError, invalidInput } from '../common.schemas';
import {
  createBrandInputSchema,
  updateBrandInputSchema,
  type CreateBrandInput,
  type UpdateBrandInput,
} from './brand.schemas';

const ADMIN_ONLY = { roles: [MembershipRole.ADMIN] } as const;

const brandInclude = {
  organization: true,
  products: true,
} satisfies Prisma.BrandInclude;

const brandNotFound = () => ({ status: 404, message: 'Marca no encontrada', data: null }) as const;
const invalidBrandId = () => invalidInput('ID de la marca es requerido');

const handleError = (error: unknown, context: string) => {
  const denied = actorErrorResponse(error);
  if (denied) return denied;
  console.error(`Error ${context}:`, error);
  return internalError();
};

// CREATE
export const createBrand = async (input: CreateBrandInput): Promise<ActionResponse<Brand | null>> => {
  try {
    const actor = await requireActor(ADMIN_ONLY);
    const parsed = createBrandInputSchema.safeParse(input);
    if (!parsed.success) return invalidInput(firstIssue(parsed.error));

    const newBrand = await prisma.brand.create({
      data: {
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        isActive: parsed.data.isActive ?? true,
        organizationId: actor.organizationId,
      },
      include: brandInclude,
    });

    return { status: 201, message: 'Marca creada exitosamente', data: newBrand };
  } catch (error) {
    return handleError(error, 'creating brand');
  }
};

// GET MANY (any member)
export const getBrands = async (isActive?: boolean): Promise<ActionResponse<Brand[] | null>> => {
  try {
    const actor = await requireActor();

    const whereClause: Prisma.BrandWhereInput = {
      organizationId: actor.organizationId,
      isDeleted: false,
    };
    if (typeof isActive === 'boolean') whereClause.isActive = isActive;

    const brands = await prisma.brand.findMany({
      where: whereClause,
      include: brandInclude,
      orderBy: { createdAt: 'desc' },
    });

    return { status: 200, message: 'Marcas obtenidas exitosamente', data: brands };
  } catch (error) {
    return handleError(error, 'fetching brands');
  }
};

// GET ONE (any member)
export const getBrandById = async (brandId: string): Promise<ActionResponse<Brand | null>> => {
  try {
    const actor = await requireActor();
    const id = idSchema.safeParse(brandId);
    if (!id.success) return invalidBrandId();

    const brand = await prisma.brand.findFirst({
      where: { id: id.data, organizationId: actor.organizationId, isDeleted: false },
      include: brandInclude,
    });
    if (!brand) return brandNotFound();

    return { status: 200, message: 'Marca obtenida exitosamente', data: brand };
  } catch (error) {
    return handleError(error, 'fetching brand');
  }
};

// UPDATE
export const updateBrand = async (
  brandId: string,
  input: UpdateBrandInput
): Promise<ActionResponse<Brand | null>> => {
  try {
    const actor = await requireActor(ADMIN_ONLY);
    const id = idSchema.safeParse(brandId);
    if (!id.success) return invalidBrandId();
    const parsed = updateBrandInputSchema.safeParse(input);
    if (!parsed.success) return invalidInput(firstIssue(parsed.error));

    const where = { id: id.data, organizationId: actor.organizationId, isDeleted: false };
    const existing = await prisma.brand.findFirst({ where, select: { id: true } });
    if (!existing) return brandNotFound();

    const updatedBrand = await prisma.brand.update({
      where,
      data: { ...parsed.data, updatedAt: new Date() },
      include: brandInclude,
    });

    return { status: 200, message: 'Marca actualizada exitosamente', data: updatedBrand };
  } catch (error) {
    return handleError(error, 'updating brand');
  }
};

// SOFT DELETE
export const softDeleteBrand = async (brandId: string): Promise<ActionResponse> => {
  try {
    const actor = await requireActor(ADMIN_ONLY);
    const id = idSchema.safeParse(brandId);
    if (!id.success) return invalidBrandId();

    const where = { id: id.data, organizationId: actor.organizationId, isDeleted: false };
    const existing = await prisma.brand.findFirst({ where, select: { id: true } });
    if (!existing) return brandNotFound();

    await prisma.brand.update({
      where,
      data: { isDeleted: true, deletedAt: new Date(), isActive: false },
    });

    return { status: 200, message: 'Marca eliminada (soft) exitosamente', data: null };
  } catch (error) {
    return handleError(error, 'soft deleting brand');
  }
};

// HARD DELETE
export const deleteBrand = async (brandId: string): Promise<ActionResponse> => {
  try {
    const actor = await requireActor(ADMIN_ONLY);
    const id = idSchema.safeParse(brandId);
    if (!id.success) return invalidBrandId();

    const where = { id: id.data, organizationId: actor.organizationId };
    const existing = await prisma.brand.findFirst({ where, select: { id: true } });
    if (!existing) return brandNotFound();

    await prisma.brand.delete({ where });

    return { status: 200, message: 'Marca eliminada permanentemente', data: null };
  } catch (error) {
    return handleError(error, 'deleting brand');
  }
};
