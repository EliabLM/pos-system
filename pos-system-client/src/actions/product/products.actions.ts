'use server';

import { deleteOrgProductImage, isOrgProductImageUrl } from '@/lib/images/product-image-refs';
import { actorErrorResponse, requireActor } from '@/lib/auth/actor';
import { MembershipRole, Product, Prisma } from '@/generated/prisma';
import {
  ActionResponse,
  ProductWithIncludesNumberPrice,
  Serialized,
} from '@/interfaces';
import { prisma, serializeDecimals } from '../utils';
import { firstIssue, idSchema, internalError, invalidInput } from '../common.schemas';
import {
  createProductInputSchema,
  lookupCodeSchema,
  productFiltersSchema,
  updateProductInputSchema,
  updateStockInputSchema,
  type CreateProductInput,
  type ProductFiltersInput,
  type StockUpdateType,
  type UpdateProductInput,
} from './product.schemas';

const invalidImageResponse = () => ({
  status: 400,
  message: 'La imagen no es válida',
  data: null,
});

/** Delete a stored image only when no product of the organization references it. */
const deleteImageIfUnused = async (imageUrl: string | null | undefined, organizationId: string) => {
  if (!imageUrl) return;
  const inUse = await prisma.product.count({ where: { organizationId, image: imageUrl } });
  if (inUse === 0) await deleteOrgProductImage(imageUrl, organizationId);
};

/**
 * Discard an image uploaded by the form when the product save fails.
 * Only an ADMIN of the owning organization can do it, and only if no product
 * references the image.
 */
export const discardUploadedProductImage = async (imageUrl: string): Promise<ActionResponse> => {
  let organizationId: string;
  try {
    ({ organizationId } = await requireActor({ roles: [MembershipRole.ADMIN] }));
  } catch (error) {
    const denied = actorErrorResponse(error);
    if (denied) return denied;
    throw error;
  }
  if (!imageUrl || !isOrgProductImageUrl(imageUrl, organizationId)) return invalidImageResponse();
  await deleteImageIfUnused(imageUrl, organizationId);
  return { status: 200, message: 'Imagen descartada', data: null };
};

const productInclude: Prisma.ProductInclude = {
  organization: true,
  brand: true,
  category: true,
  unitMeasure: true,
  saleItems: {
    take: 5,
    orderBy: { createdAt: 'desc' },
  },
  purchaseItems: {
    take: 5,
    orderBy: { createdAt: 'desc' },
  },
  stockMovements: {
    take: 5,
    orderBy: { createdAt: 'desc' },
  },
  _count: {
    select: {
      saleItems: true,
      purchaseItems: true,
      stockMovements: true,
    },
  },
};

const ADMIN_ONLY = { roles: [MembershipRole.ADMIN] } as const;

const productNotFound = () => ({ status: 404, message: 'Producto no encontrado', data: null }) as const;
const invalidProductId = () => invalidInput('ID del producto es requerido');

const handleError = (error: unknown, context: string) => {
  const denied = actorErrorResponse(error);
  if (denied) return denied;
  console.error(`Error ${context}:`, error);
  return internalError();
};

/** Maps Prisma unique/foreign-key errors on products to user-facing responses. */
const productWriteError = (error: unknown) => {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return null;
  if (error.code === 'P2002') {
    const target = error.meta?.target;
    const fields = Array.isArray(target) ? target.map(String) : [];
    if (fields.includes('barcode')) {
      return { status: 409, message: 'Ya existe un producto con ese código de barras', data: null };
    }
    if (fields.includes('sku')) {
      return { status: 409, message: 'Ya existe un producto con ese SKU', data: null };
    }
  }
  if (error.code === 'P2025') return productNotFound();
  if (error.code === 'P2003') {
    return { status: 400, message: 'Una de las referencias especificadas no existe', data: null };
  }
  return null;
};

/**
 * Checks that the referenced category, brand and unit measure belong to the
 * organization. Returns an error response, or null when all are valid.
 */
const checkReferences = async (
  organizationId: string,
  refs: { categoryId?: string | null; brandId?: string | null; unitMeasureId?: string | null }
) => {
  const scope = { organizationId, isDeleted: false };
  if (refs.categoryId) {
    const category = await prisma.category.findFirst({ where: { id: refs.categoryId, ...scope }, select: { id: true } });
    if (!category) return invalidInput('La categoría especificada no existe');
  }
  if (refs.brandId) {
    const brand = await prisma.brand.findFirst({ where: { id: refs.brandId, ...scope }, select: { id: true } });
    if (!brand) return invalidInput('La marca especificada no existe');
  }
  if (refs.unitMeasureId) {
    const unit = await prisma.unitMeasure.findFirst({ where: { id: refs.unitMeasureId, ...scope }, select: { id: true } });
    if (!unit) return invalidInput('La unidad de medida especificada no existe');
  }
  return null;
};

/** Checks barcode/SKU uniqueness among the organization's live products. */
const checkUniqueCodes = async (
  organizationId: string,
  codes: { barcode?: string | null; sku?: string | null },
  excludeId?: string
) => {
  const scope = { organizationId, isDeleted: false, ...(excludeId ? { id: { not: excludeId } } : {}) };
  if (codes.barcode) {
    const duplicate = await prisma.product.findFirst({ where: { ...scope, barcode: codes.barcode }, select: { id: true } });
    if (duplicate) {
      return { status: 409, message: 'Ya existe un producto con ese código de barras en la organización', data: null };
    }
  }
  if (codes.sku) {
    const duplicate = await prisma.product.findFirst({ where: { ...scope, sku: codes.sku }, select: { id: true } });
    if (duplicate) {
      return { status: 409, message: 'Ya existe un producto con ese SKU en la organización', data: null };
    }
  }
  return null;
};

// CREATE
export const createProduct = async (
  input: CreateProductInput
): Promise<ActionResponse<Serialized<Product> | null>> => {
  // Uploaded image to discard if the save fails.
  let pendingImage: { url: string; organizationId: string } | null = null;
  try {
    const actor = await requireActor(ADMIN_ONLY);
    const parsed = createProductInputSchema.safeParse(input);
    if (!parsed.success) return invalidInput(firstIssue(parsed.error));
    const data = parsed.data;
    const organizationId = actor.organizationId;

    if (!isOrgProductImageUrl(data.image, organizationId)) return invalidImageResponse();
    if (data.image) pendingImage = { url: data.image, organizationId };

    const conflict =
      (await checkUniqueCodes(organizationId, data)) ?? (await checkReferences(organizationId, data));
    if (conflict) {
      await deleteImageIfUnused(pendingImage?.url, organizationId).catch(() => undefined);
      return conflict;
    }

    const newProduct = await prisma.product.create({
      data: { ...data, organizationId },
      include: productInclude,
    });

    return {
      status: 201,
      message: 'Producto creado exitosamente',
      data: serializeDecimals(newProduct),
    };
  } catch (error) {
    if (pendingImage) {
      await deleteImageIfUnused(pendingImage.url, pendingImage.organizationId).catch(() => undefined);
    }
    return productWriteError(error) ?? handleError(error, 'creating product');
  }
};

// GET MANY. Any member; a SELLER only sees active, non-deleted products (what it can sell).
export const getProducts = async (
  filters?: ProductFiltersInput,
  includeDeleted: boolean = false
): Promise<ActionResponse<ProductWithIncludesNumberPrice[] | null>> => {
  try {
    const actor = await requireActor();
    const parsed = productFiltersSchema.safeParse(filters);
    if (!parsed.success) return invalidInput('Filtros inválidos');
    const f = parsed.data;
    const isAdmin = actor.role === MembershipRole.ADMIN;

    const whereClause: Prisma.ProductWhereInput = {
      organizationId: actor.organizationId,
      isDeleted: isAdmin && includeDeleted === true ? undefined : false,
    };

    if (!isAdmin) whereClause.isActive = true;
    else if (typeof f?.isActive === 'boolean') whereClause.isActive = f.isActive;

    if (f?.categoryId) whereClause.categoryId = f.categoryId;
    if (f?.brandId) whereClause.brandId = f.brandId;
    if (f?.lowStock) whereClause.currentStock = { lte: prisma.product.fields.minStock };
    if (f?.search) {
      whereClause.OR = [
        { name: { contains: f.search, mode: 'insensitive' } },
        { description: { contains: f.search, mode: 'insensitive' } },
        { barcode: { contains: f.search, mode: 'insensitive' } },
        { sku: { contains: f.search, mode: 'insensitive' } },
      ];
    }

    const products = await prisma.product.findMany({
      where: whereClause,
      include: productInclude,
      orderBy: { createdAt: 'desc' },
    });

    return {
      status: 200,
      message: 'Productos obtenidos exitosamente',
      data: serializeDecimals(products),
    };
  } catch (error) {
    return handleError(error, 'fetching products');
  }
};

// GET ONE (product detail, ADMIN)
export const getProductById = async (
  productId: string
): Promise<ActionResponse<Serialized<Product> | null>> => {
  try {
    const actor = await requireActor(ADMIN_ONLY);
    const id = idSchema.safeParse(productId);
    if (!id.success) return invalidProductId();

    const product = await prisma.product.findFirst({
      where: { id: id.data, organizationId: actor.organizationId, isDeleted: false },
      include: productInclude,
    });
    if (!product) return productNotFound();

    return {
      status: 200,
      message: 'Producto obtenido exitosamente',
      data: serializeDecimals(product),
    };
  } catch (error) {
    return handleError(error, 'fetching product');
  }
};

/** Active product of the organization by barcode or SKU. */
const findActiveProductByCode = async (organizationId: string, field: 'barcode' | 'sku', code: string) => {
  const product = await prisma.product.findFirst({
    where: { organizationId, [field]: code, isDeleted: false, isActive: true },
    include: productInclude,
  });
  if (!product) return productNotFound();
  return {
    status: 200,
    message: 'Producto obtenido exitosamente',
    data: serializeDecimals(product),
  };
};

// GET BY BARCODE (any member, for selling)
export const getProductByBarcode = async (
  barcode: string
): Promise<ActionResponse<Serialized<Product> | null>> => {
  try {
    const actor = await requireActor();
    const code = lookupCodeSchema.safeParse(barcode);
    if (!code.success) return invalidInput('Código de barras es requerido');
    return await findActiveProductByCode(actor.organizationId, 'barcode', code.data);
  } catch (error) {
    return handleError(error, 'fetching product by barcode');
  }
};

// GET BY SKU (any member, for selling)
export const getProductBySku = async (
  sku: string
): Promise<ActionResponse<Serialized<Product> | null>> => {
  try {
    const actor = await requireActor();
    const code = lookupCodeSchema.safeParse(sku);
    if (!code.success) return invalidInput('SKU es requerido');
    return await findActiveProductByCode(actor.organizationId, 'sku', code.data);
  } catch (error) {
    return handleError(error, 'fetching product by SKU');
  }
};

// UPDATE
export const updateProduct = async (
  productId: string,
  input: UpdateProductInput
): Promise<ActionResponse<Serialized<Product> | null>> => {
  // Newly uploaded image to discard if the update fails.
  let pendingImage: { url: string; organizationId: string } | null = null;
  try {
    const actor = await requireActor(ADMIN_ONLY);
    const id = idSchema.safeParse(productId);
    if (!id.success) return invalidProductId();
    const parsed = updateProductInputSchema.safeParse(input);
    if (!parsed.success) return invalidInput(firstIssue(parsed.error));
    const data = parsed.data;
    const organizationId = actor.organizationId;

    const where = { id: id.data, organizationId, isDeleted: false };
    const existingProduct = await prisma.product.findFirst({ where });
    if (!existingProduct) return productNotFound();

    // `image: undefined` means "not changing"; `null` removes it.
    const oldImageUrl = existingProduct.image;
    const imageChanged = data.image !== undefined && data.image !== oldImageUrl;
    if (imageChanged && !isOrgProductImageUrl(data.image, organizationId)) {
      return invalidImageResponse();
    }
    if (imageChanged && data.image) pendingImage = { url: data.image, organizationId };

    // Only check codes and references that change.
    const changed = <K extends 'barcode' | 'sku' | 'categoryId' | 'brandId' | 'unitMeasureId'>(key: K) =>
      data[key] !== existingProduct[key] ? data[key] : undefined;
    const conflict =
      (await checkUniqueCodes(organizationId, { barcode: changed('barcode'), sku: changed('sku') }, existingProduct.id)) ??
      (await checkReferences(organizationId, {
        categoryId: changed('categoryId'),
        brandId: changed('brandId'),
        unitMeasureId: changed('unitMeasureId'),
      }));
    if (conflict) {
      if (pendingImage) await deleteImageIfUnused(pendingImage.url, organizationId).catch(() => undefined);
      return conflict;
    }

    const updatedProduct = await prisma.product.update({
      where,
      data: { ...data, updatedAt: new Date() },
      include: productInclude,
    });
    pendingImage = null;

    // Remove the previous file only after the new reference is saved.
    if (imageChanged) {
      await deleteImageIfUnused(oldImageUrl, organizationId).catch(() => undefined);
    }

    return {
      status: 200,
      message: 'Producto actualizado exitosamente',
      data: serializeDecimals(updatedProduct),
    };
  } catch (error) {
    if (pendingImage) {
      await deleteImageIfUnused(pendingImage.url, pendingImage.organizationId).catch(() => undefined);
    }
    return productWriteError(error) ?? handleError(error, 'updating product');
  }
};

// UPDATE STOCK
export const updateStock = async (
  productId: string,
  stockChange: number,
  type: StockUpdateType
): Promise<ActionResponse<Serialized<Product> | null>> => {
  try {
    const actor = await requireActor(ADMIN_ONLY);
    const id = idSchema.safeParse(productId);
    if (!id.success) return invalidProductId();
    const parsed = updateStockInputSchema.safeParse({ stockChange, type });
    if (!parsed.success) return invalidInput('Operación de stock inválida');

    const where = { id: id.data, organizationId: actor.organizationId, isDeleted: false };
    const existingProduct = await prisma.product.findFirst({ where, select: { currentStock: true } });
    if (!existingProduct) return productNotFound();

    const { stockChange: change } = parsed.data;
    const newStock =
      parsed.data.type === 'SET'
        ? change
        : parsed.data.type === 'INCREMENT'
          ? existingProduct.currentStock + change
          : existingProduct.currentStock - change;

    if (newStock < 0) {
      return { status: 400, message: 'El stock no puede ser negativo', data: null };
    }

    const updatedProduct = await prisma.product.update({
      where,
      data: { currentStock: newStock, updatedAt: new Date() },
      include: productInclude,
    });

    return {
      status: 200,
      message: 'Stock actualizado exitosamente',
      data: serializeDecimals(updatedProduct),
    };
  } catch (error) {
    return productWriteError(error) ?? handleError(error, 'updating stock');
  }
};

// GET LOW STOCK PRODUCTS (inventory, ADMIN)
export const getLowStockProducts = async (): Promise<ActionResponse<Serialized<Product>[] | null>> => {
  try {
    const actor = await requireActor(ADMIN_ONLY);

    const products = await prisma.product.findMany({
      where: {
        organizationId: actor.organizationId,
        isDeleted: false,
        isActive: true,
        currentStock: { lte: prisma.product.fields.minStock },
      },
      include: productInclude,
      orderBy: { currentStock: 'asc' },
    });

    return {
      status: 200,
      message: 'Productos con stock bajo obtenidos exitosamente',
      data: serializeDecimals(products),
    };
  } catch (error) {
    return handleError(error, 'fetching low stock products');
  }
};

// SOFT DELETE
export const softDeleteProduct = async (productId: string): Promise<ActionResponse> => {
  try {
    const actor = await requireActor(ADMIN_ONLY);
    const id = idSchema.safeParse(productId);
    if (!id.success) return invalidProductId();

    const where = { id: id.data, organizationId: actor.organizationId, isDeleted: false };
    const product = await prisma.product.findFirst({ where, select: { id: true } });
    if (!product) return productNotFound();

    const [saleItemsCount, purchaseItemsCount] = await Promise.all([
      prisma.saleItem.count({ where: { productId: product.id } }),
      prisma.purchaseItem.count({ where: { productId: product.id } }),
    ]);

    if (saleItemsCount > 0 || purchaseItemsCount > 0) {
      return {
        status: 409,
        message: `No se puede eliminar el producto. Tiene ${saleItemsCount + purchaseItemsCount} transacción(es) asociada(s)`,
        data: null,
      };
    }

    await prisma.product.update({
      where,
      data: { isDeleted: true, deletedAt: new Date(), isActive: false, updatedAt: new Date() },
    });

    return { status: 200, message: 'Producto eliminado (soft) exitosamente', data: null };
  } catch (error) {
    return productWriteError(error) ?? handleError(error, 'soft deleting product');
  }
};

// RESTORE
export const restoreProduct = async (
  productId: string
): Promise<ActionResponse<Serialized<Product> | null>> => {
  try {
    const actor = await requireActor(ADMIN_ONLY);
    const id = idSchema.safeParse(productId);
    if (!id.success) return invalidProductId();

    const where = { id: id.data, organizationId: actor.organizationId, isDeleted: true };
    const product = await prisma.product.findFirst({ where, select: { id: true } });
    if (!product) return productNotFound();

    const restoredProduct = await prisma.product.update({
      where,
      data: { isDeleted: false, deletedAt: null, updatedAt: new Date() },
      include: productInclude,
    });

    return {
      status: 200,
      message: 'Producto restaurado exitosamente',
      data: serializeDecimals(restoredProduct),
    };
  } catch (error) {
    return productWriteError(error) ?? handleError(error, 'restoring product');
  }
};

// HARD DELETE
export const deleteProduct = async (productId: string): Promise<ActionResponse> => {
  try {
    const actor = await requireActor(ADMIN_ONLY);
    const id = idSchema.safeParse(productId);
    if (!id.success) return invalidProductId();
    const organizationId = actor.organizationId;

    const where = { id: id.data, organizationId };
    const product = await prisma.product.findFirst({ where, select: { id: true, image: true } });
    if (!product) return productNotFound();

    const [saleItemsCount, purchaseItemsCount, stockMovementsCount] = await Promise.all([
      prisma.saleItem.count({ where: { productId: product.id } }),
      prisma.purchaseItem.count({ where: { productId: product.id } }),
      prisma.stockMovement.count({ where: { organizationId, productId: product.id } }),
    ]);

    if (saleItemsCount > 0 || purchaseItemsCount > 0 || stockMovementsCount > 0) {
      return {
        status: 409,
        message: 'No se puede eliminar permanentemente el producto. Tiene transacciones o movimientos asociados. Use eliminación suave en su lugar.',
        data: null,
      };
    }

    await prisma.product.delete({ where });

    if (product.image) {
      await deleteImageIfUnused(product.image, organizationId).catch(() => undefined);
    }

    return { status: 200, message: 'Producto eliminado permanentemente', data: null };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
      return {
        status: 409,
        message: 'No se puede eliminar el producto debido a relaciones existentes',
        data: null,
      };
    }
    return productWriteError(error) ?? handleError(error, 'hard deleting product');
  }
};

// DELETE IMAGE
export const deleteProductImage = async (productId: string): Promise<ActionResponse> => {
  try {
    const actor = await requireActor(ADMIN_ONLY);
    const id = idSchema.safeParse(productId);
    if (!id.success) return invalidProductId();
    const organizationId = actor.organizationId;

    const where = { id: id.data, organizationId, isDeleted: false };
    const product = await prisma.product.findFirst({ where, select: { id: true, image: true } });
    if (!product) return productNotFound();

    if (!product.image) {
      return { status: 400, message: 'El producto no tiene imagen para eliminar', data: null };
    }

    // Quitar la referencia y luego borrar el archivo
    await prisma.product.update({ where, data: { image: null, updatedAt: new Date() } });
    await deleteImageIfUnused(product.image, organizationId);

    return { status: 200, message: 'Imagen del producto eliminada exitosamente', data: null };
  } catch (error) {
    return handleError(error, 'deleting product image');
  }
};
