import { PrismaClient } from '@/generated/prisma';

/**
 * One PrismaClient per module graph. Outside production it is cached on
 * `globalThis` so that Next.js hot reload (dev) reuses one connection pool
 * instead of opening a new one per reload.
 *
 * In production it is NOT shared through `globalThis`: Next bundles route
 * handlers and server actions in different layers, each with its own copy of
 * the generated client. A client created by another layer returns objects
 * (Decimal, Prisma errors) that fail `instanceof` against this layer's classes.
 */
const globalForPrisma = globalThis as unknown as { __posPrisma?: PrismaClient };

export const prisma: PrismaClient = globalForPrisma.__posPrisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.__posPrisma = prisma;
