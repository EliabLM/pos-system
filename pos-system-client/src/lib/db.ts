import { PrismaClient } from '@/generated/prisma';

/**
 * Single PrismaClient per server process. Cached on `globalThis` so that
 * Next.js hot reload (dev) and multiple module graphs reuse one connection
 * pool instead of opening a new one per import.
 */
const globalForPrisma = globalThis as unknown as { __posPrisma?: PrismaClient };

export const prisma: PrismaClient = globalForPrisma.__posPrisma ?? new PrismaClient();

globalForPrisma.__posPrisma = prisma;
