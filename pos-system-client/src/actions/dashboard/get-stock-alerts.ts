'use server';

import { addBusinessDays, startOfBusinessDay } from '@/lib/time';
import { StockAlert, ActionResponse } from '@/interfaces';
import { prisma } from '../utils';
import { actorErrorResponse, requireActor } from '@/lib/auth/actor';
import { invalidInput, scopedStoreId } from '../common.schemas';
import { dashboardStoreSchema } from './dashboard.schemas';

/**
 * Retrieves products with low stock and calculates urgency metrics.
 *
 * Analyzes products where currentStock <= minStock and calculates:
 * - Stock deficit and percentage remaining
 * - Daily sales average (last 30 days)
 * - Estimated days until stockout (undefined if no sales history)
 * - Severity level (critical, warning, info)
 *
 * Any member can read it; the organization comes from the session and a
 * SELLER bound to a store only sees that store.
 *
 * @param storeId - Optional store ID to filter sales data (for predictions)
 * @returns ActionResponse with StockAlert[] data sorted by severity and stock level
 */
export const getStockAlerts = async (
  storeId?: string | null
): Promise<ActionResponse<StockAlert[]>> => {
  try {
    const actor = await requireActor();
    const store = dashboardStoreSchema.safeParse(storeId);
    if (!store.success) return invalidInput('Tienda inválida');
    const scopedStore = scopedStoreId(actor, store.data);

    // Query low stock products (currentStock <= minStock)
    const lowStockProducts = await prisma.product.findMany({
      where: {
        organizationId: actor.organizationId,
        isDeleted: false,
        isActive: true,
        currentStock: {
          lte: prisma.product.fields.minStock, // currentStock <= minStock
        },
      },
      include: {
        category: {
          select: { name: true },
        },
        brand: {
          select: { name: true },
        },
      },
      orderBy: {
        currentStock: 'asc', // Lowest stock first
      },
      take: 50, // Limit to 50 products
    });

    // If no low stock products found, return empty array
    if (lowStockProducts.length === 0) {
      return {
        status: 200,
        message: 'No hay productos con stock bajo',
        data: [],
      };
    }

    // Calculate date range for sales analysis (last 30 days)
    const thirtyDaysAgo = startOfBusinessDay(addBusinessDays(new Date(), -30));
    const today = new Date();

    // Get all product IDs for sales query
    const productIds = lowStockProducts.map((p) => p.id);

    // Query sales data for all products (optimize with single query and groupBy)
    const salesData = await prisma.saleItem.groupBy({
      by: ['productId'],
      where: {
        productId: { in: productIds },
        isDeleted: false,
        sale: {
          organizationId: actor.organizationId,
          ...(scopedStore && { storeId: scopedStore }),
          isDeleted: false,
          status: 'PAID',
          saleDate: {
            gte: thirtyDaysAgo,
            lte: today,
          },
        },
      },
      _sum: {
        quantity: true,
      },
    });

    // Create map for quick lookup of sales data
    const salesMap = new Map<string, number>(
      salesData.map((item) => [item.productId, item._sum.quantity || 0])
    );

    // Calculate severity based on stock percentage
    function calculateSeverity(
      currentStock: number,
      minStock: number
    ): 'critical' | 'warning' | 'info' {
      // Handle edge case: minStock = 0
      if (minStock === 0) {
        return currentStock === 0 ? 'critical' : 'info';
      }

      const percentage = (currentStock / minStock) * 100;

      if (currentStock === 0 || percentage < 20) {
        return 'critical';
      }
      if (percentage < 50) {
        return 'warning';
      }
      return 'info';
    }

    // Build StockAlert array with calculated metrics
    const stockAlerts: StockAlert[] = lowStockProducts.map((product) => {
      const totalSold = salesMap.get(product.id) || 0;
      const dailyAverage = totalSold / 30;

      // Calculate days until stockout
      let daysUntilStockout: number | undefined = undefined;
      if (dailyAverage > 0) {
        daysUntilStockout = Math.round(product.currentStock / dailyAverage);
      }

      // Calculate stock difference and percentage
      const stockDifference = product.currentStock - product.minStock;
      const percentageRemaining =
        product.minStock > 0
          ? Math.round((product.currentStock / product.minStock) * 100 * 100) / 100 // 2 decimals
          : 0;

      return {
        productId: product.id,
        productName: product.name,
        productImage: product.image,
        currentStock: product.currentStock,
        minStock: product.minStock,
        stockDifference,
        percentageRemaining,
        severity: calculateSeverity(product.currentStock, product.minStock),
        ...(daysUntilStockout !== undefined && { daysUntilStockout }),
        categoryName: product.category?.name,
        brandName: product.brand?.name,
        sku: product.sku,
        barcode: product.barcode,
      };
    });

    // Sort by severity (critical > warning > info), then by currentStock (lowest first)
    const severityOrder: Record<'critical' | 'warning' | 'info', number> = {
      critical: 0,
      warning: 1,
      info: 2,
    };

    stockAlerts.sort((a, b) => {
      const severityDiff = severityOrder[a.severity] - severityOrder[b.severity];
      if (severityDiff !== 0) return severityDiff;
      return a.currentStock - b.currentStock; // Lower stock first
    });

    return {
      status: 200,
      message: 'Alertas de stock obtenidas exitosamente',
      data: stockAlerts,
    };
  } catch (error) {
    const denied = actorErrorResponse(error);
    if (denied) return denied;
    console.error('Error fetching stock alerts:', error);
    return {
      status: 500,
      message: 'Error interno del servidor',
      data: null,
    };
  }
};
