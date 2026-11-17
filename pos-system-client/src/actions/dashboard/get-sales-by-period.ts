'use server';

import { SalesByPeriod, ActionResponse } from '@/interfaces';
import { prisma, checkOrgId, emptyOrgIdResponse } from '../utils';
import { Prisma } from '@/generated/prisma';
import {
  addBusinessDays,
  businessDateTime,
  businessPeriodKey,
  endOfBusinessDay,
  getBusinessDateParts,
  startOfBusinessDay,
} from '@/lib/time';

const HOUR_MS = 60 * 60 * 1000;

/**
 * Helper function to generate a unique key for each period based on the date and period type
 * This ensures consistent grouping of sales data (in America/Bogota business time)
 */
function getKeyForPeriod(date: Date, period: 'day' | 'week' | 'month' | 'year'): string {
  switch (period) {
    case 'day':
      // Group by hour: "2025-10-09 14:00"
      return businessPeriodKey(date, 'hour');
    case 'week':
    case 'month':
      // Group by day: "2025-10-09"
      return businessPeriodKey(date, 'day');
    case 'year':
      // Group by month: "2025-10-01"
      return businessPeriodKey(date, 'month');
    default:
      return businessPeriodKey(date, 'day');
  }
}

/**
 * Retrieves sales data grouped by different time periods for chart visualization.
 *
 * Period logic:
 * - 'day': Last 24 hours grouped by hour (0-23)
 * - 'week': Last 7 days grouped by day
 * - 'month': Last 30 days grouped by day
 * - 'year': Last 12 months grouped by month
 *
 * @param organizationId - Organization ID to filter sales (required)
 * @param period - Time period for grouping ('day' | 'week' | 'month' | 'year')
 * @param storeId - Optional store ID to filter sales by specific store
 * @param referenceDate - ISO date string for the reference point (defaults to today)
 * @returns ActionResponse with SalesByPeriod[] data
 */
export const getSalesByPeriod = async (
  organizationId: string,
  period: 'day' | 'week' | 'month' | 'year',
  storeId?: string | null,
  referenceDate?: string
): Promise<ActionResponse<SalesByPeriod[]>> => {
  try {
    // Validate organization ID
    if (checkOrgId(organizationId)) return emptyOrgIdResponse();

    // Parse reference date or use current date
    let refDate: Date;
    try {
      refDate = referenceDate ? new Date(referenceDate) : new Date();
      if (Number.isNaN(refDate.getTime())) throw new Error('Invalid date');
    } catch {
      return {
        status: 400,
        message: 'Formato de fecha inválido. Use formato ISO (YYYY-MM-DD)',
        data: null,
      };
    }

    // Calculate date range and intervals based on period
    let startDate: Date;
    let endDate: Date;
    let intervals: Date[];

    switch (period) {
      case 'day': {
        // Last 24 hours from reference date, one bucket per hour
        startDate = new Date(refDate.getTime() - 24 * HOUR_MS);
        endDate = refDate;
        intervals = [];
        for (let t = startDate.getTime(); t <= endDate.getTime(); t += HOUR_MS) {
          intervals.push(new Date(t));
        }
        break;
      }

      case 'week':
      case 'month': {
        // Last 7 / 30 business days from reference date
        const days = period === 'week' ? 7 : 30;
        startDate = startOfBusinessDay(addBusinessDays(refDate, -days));
        endDate = endOfBusinessDay(refDate);
        intervals = [];
        for (let i = days; i >= 0; i--) {
          intervals.push(addBusinessDays(refDate, -i));
        }
        break;
      }

      case 'year': {
        // Last 12 business months from reference date
        const ref = getBusinessDateParts(refDate);
        startDate = businessDateTime(ref.year, ref.month - 12, 1);
        endDate = endOfBusinessDay(refDate);
        intervals = [];
        for (let i = 12; i >= 0; i--) {
          intervals.push(businessDateTime(ref.year, ref.month - i, 1));
        }
        break;
      }

      default:
        return {
          status: 400,
          message: 'Periodo inválido. Use: day, week, month o year',
          data: null,
        };
    }

    // Build base where clause
    const whereClause: Prisma.SaleWhereInput = {
      organizationId,
      isDeleted: false,
      status: 'PAID', // Only count paid sales
      saleDate: {
        gte: startDate,
        lte: endDate,
      },
    };

    // Add store filter if provided
    if (storeId) {
      whereClause.storeId = storeId;
    }

    // Fetch all sales within the date range
    const sales = await prisma.sale.findMany({
      where: whereClause,
      select: {
        saleDate: true,
        total: true,
        id: true,
      },
    });

    // Initialize all periods with zero values
    const grouped = new Map<string, { sales: number; count: number }>();

    for (const interval of intervals) {
      const key = getKeyForPeriod(interval, period);
      grouped.set(key, { sales: 0, count: 0 });
    }

    // Accumulate sales data by period
    for (const sale of sales) {
      const key = getKeyForPeriod(sale.saleDate, period);
      const current = grouped.get(key);

      if (current) {
        grouped.set(key, {
          sales: current.sales + Number(sale.total), // Convert Decimal to number
          count: current.count + 1,
        });
      }
    }

    // Convert map to array with proper structure
    const result: SalesByPeriod[] = Array.from(grouped.entries()).map(([date, data]) => ({
      date,
      sales: data.sales,
      transactions: data.count,
      averageTicket: data.count > 0 ? Number((data.sales / data.count).toFixed(2)) : 0,
    }));

    // Sort by date (ascending)
    result.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    return {
      status: 200,
      message: `Ventas agrupadas por ${period} obtenidas exitosamente`,
      data: result,
    };
  } catch (error) {
    console.error('Error fetching sales by period:', error);
    return {
      status: 500,
      message: 'Error interno del servidor',
      data: null,
    };
  }
};
