'use server';

import { businessDayRange } from '@/lib/time';
import { CashStatus, ActionResponse } from '@/interfaces';
import { prisma } from '../utils';
import { actorErrorResponse, requireActor } from '@/lib/auth/actor';
import { invalidInput, scopedStoreId } from '../common.schemas';
import { cashStatusInputSchema } from './dashboard.schemas';

/**
 * Calculates cash register status by payment method for a specific date.
 *
 * Groups all sale payments by payment method and calculates:
 * - Total amount collected per method
 * - Number of payment transactions per method
 * - Percentage of total cash per method
 * - Average transaction amount per method
 *
 * Any member can read it; the organization comes from the session and a
 * SELLER bound to a store only sees that store.
 *
 * @param storeId - Optional store ID to filter sales by specific store
 * @param date - ISO date string (YYYY-MM-DD), defaults to today
 * @returns ActionResponse with CashStatus[] sorted by totalAmount DESC
 */
export const getCashStatus = async (
  storeId?: string | null,
  date?: string
): Promise<ActionResponse<CashStatus[]>> => {
  try {
    const actor = await requireActor();
    const parsed = cashStatusInputSchema.safeParse({ storeId, date });
    if (!parsed.success) return invalidInput('Tienda o fecha inválidas. Use formato ISO (YYYY-MM-DD)');
    const input = parsed.data;
    const scopedStore = scopedStoreId(actor, input.storeId);

    // A YYYY-MM-DD date is taken as that America/Bogota business day.
    const { gte: startDate, lte: endDate } = businessDayRange(input.date ?? new Date());

    // Query all sale payments with filters
    const salePayments = await prisma.salePayment.findMany({
      where: {
        isDeleted: false,
        paymentMethod: {
          isDeleted: false,
        },
        sale: {
          organizationId: actor.organizationId,
          ...(scopedStore && { storeId: scopedStore }),
          isDeleted: false,
          status: 'PAID',
          saleDate: {
            gte: startDate,
            lte: endDate,
          },
        },
      },
      include: {
        paymentMethod: {
          select: {
            id: true,
            name: true,
            type: true,
          },
        },
        sale: {
          select: {
            id: true,
            saleDate: true,
          },
        },
      },
    });

    // Return empty array if no payments found
    if (salePayments.length === 0) {
      return {
        status: 200,
        message: 'No se encontraron pagos para la fecha especificada',
        data: [],
      };
    }

    // Group by payment method and calculate metrics
    const paymentMethodMap = new Map<
      string,
      {
        id: string;
        name: string;
        type: 'CASH' | 'CARD' | 'TRANSFER' | 'CREDIT' | 'CHECK' | 'OTHER';
        totalAmount: number;
        transactionCount: number;
      }
    >();

    for (const payment of salePayments) {
      const methodId = payment.paymentMethodId;
      const existing = paymentMethodMap.get(methodId);

      if (existing) {
        existing.totalAmount += Number(payment.amount);
        existing.transactionCount += 1;
      } else {
        paymentMethodMap.set(methodId, {
          id: payment.paymentMethod.id,
          name: payment.paymentMethod.name,
          type: payment.paymentMethod.type,
          totalAmount: Number(payment.amount),
          transactionCount: 1,
        });
      }
    }

    // Calculate grand total for percentage calculation
    const grandTotal = Array.from(paymentMethodMap.values()).reduce(
      (sum, item) => sum + item.totalAmount,
      0
    );

    // Convert to CashStatus array
    const cashStatus: CashStatus[] = Array.from(paymentMethodMap.entries()).map(
      ([methodId, data]) => ({
        paymentMethodId: methodId,
        paymentMethodName: data.name,
        paymentType: data.type,
        totalAmount: data.totalAmount,
        transactionCount: data.transactionCount,
        percentageOfTotal:
          grandTotal > 0
            ? Number(((data.totalAmount / grandTotal) * 100).toFixed(2))
            : 0,
        averageTransactionAmount:
          data.transactionCount > 0
            ? Number((data.totalAmount / data.transactionCount).toFixed(2))
            : 0,
      })
    );

    // Sort by totalAmount DESC (highest revenue methods first)
    cashStatus.sort((a, b) => b.totalAmount - a.totalAmount);

    return {
      status: 200,
      message: 'Estado de caja obtenido exitosamente',
      data: cashStatus,
    };
  } catch (error) {
    const denied = actorErrorResponse(error);
    if (denied) return denied;
    console.error('Error fetching cash status:', error);
    return {
      status: 500,
      message: 'Error interno del servidor',
      data: null,
    };
  }
};
