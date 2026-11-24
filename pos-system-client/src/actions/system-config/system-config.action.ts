'use server';

import { MembershipRole, SystemConfig } from '@/generated/prisma';
import { ActionResponse } from '@/interfaces';
import { actorErrorResponse, requireActor } from '@/lib/auth/actor';
import { prisma } from '../utils';
import { firstIssue, internalError, invalidInput } from '../common.schemas';
import {
  BUSINESS_TYPE_KEY,
  businessTypeSchema,
  configKeySchema,
  configValueSchema,
  createSystemConfigInputSchema,
  type BusinessType,
  type CreateSystemConfigInput,
} from './system-config.schemas';

const ADMIN_ONLY = { roles: [MembershipRole.ADMIN] } as const;

const configNotFound = () => ({ status: 404, message: 'Configuración no encontrada', data: null }) as const;
const businessTypeLocked = () =>
  ({ status: 403, message: 'No se puede cambiar el tipo de negocio después del onboarding', data: null }) as const;

const handleError = (error: unknown, context: string) => {
  const denied = actorErrorResponse(error);
  if (denied) return denied;
  console.error(`Error ${context}:`, error);
  return internalError();
};

// CREATE (ADMIN; the business type is set only in onboarding)
export async function createSystemConfig(
  input: CreateSystemConfigInput
): Promise<ActionResponse<SystemConfig | null>> {
  try {
    const actor = await requireActor(ADMIN_ONLY);
    const parsed = createSystemConfigInputSchema.safeParse(input);
    if (!parsed.success) return invalidInput(firstIssue(parsed.error));
    if (parsed.data.key === BUSINESS_TYPE_KEY) return businessTypeLocked();

    const config = await prisma.systemConfig.create({
      data: { ...parsed.data, organizationId: actor.organizationId },
    });

    return { status: 201, message: 'Configuración creada exitosamente', data: config };
  } catch (error) {
    return handleError(error, 'creating system config');
  }
}

// GET ONE by key (ADMIN)
export async function getSystemConfig(key: string): Promise<ActionResponse<SystemConfig | null>> {
  try {
    const actor = await requireActor(ADMIN_ONLY);
    const parsedKey = configKeySchema.safeParse(key);
    if (!parsedKey.success) return invalidInput(firstIssue(parsedKey.error));

    const config = await prisma.systemConfig.findFirst({
      where: { organizationId: actor.organizationId, key: parsedKey.data, isDeleted: false },
    });
    if (!config) return configNotFound();

    return { status: 200, message: 'Configuración obtenida exitosamente', data: config };
  } catch (error) {
    return handleError(error, 'fetching system config');
  }
}

// GET ALL (ADMIN)
export async function getAllSystemConfigs(): Promise<ActionResponse<SystemConfig[] | null>> {
  try {
    const actor = await requireActor(ADMIN_ONLY);

    const configs = await prisma.systemConfig.findMany({
      where: { organizationId: actor.organizationId, isDeleted: false },
      orderBy: { key: 'asc' },
    });

    return { status: 200, message: 'Configuraciones obtenidas exitosamente', data: configs };
  } catch (error) {
    return handleError(error, 'fetching system configs');
  }
}

// UPDATE (ADMIN; never the business type)
export async function updateSystemConfig(
  key: string,
  value: string
): Promise<ActionResponse<SystemConfig | null>> {
  try {
    const actor = await requireActor(ADMIN_ONLY);
    const parsedKey = configKeySchema.safeParse(key);
    const parsedValue = configValueSchema.safeParse(value);
    if (!parsedKey.success) return invalidInput(firstIssue(parsedKey.error));
    if (!parsedValue.success) return invalidInput(firstIssue(parsedValue.error));
    if (parsedKey.data === BUSINESS_TYPE_KEY) return businessTypeLocked();

    const where = { organizationId: actor.organizationId, key: parsedKey.data, isDeleted: false };
    const config = await prisma.systemConfig.findFirst({ where, select: { id: true } });
    if (!config) return configNotFound();

    const updatedConfig = await prisma.systemConfig.update({
      where: { id: config.id, organizationId: actor.organizationId },
      data: { value: parsedValue.data, updatedAt: new Date() },
    });

    return { status: 200, message: 'Configuración actualizada exitosamente', data: updatedConfig };
  } catch (error) {
    return handleError(error, 'updating system config');
  }
}

// Business type of the actor's organization (any member: sales and products depend on it)
export async function getBusinessType(): Promise<ActionResponse<BusinessType | null>> {
  try {
    const actor = await requireActor();

    const config = await prisma.systemConfig.findFirst({
      where: { organizationId: actor.organizationId, key: BUSINESS_TYPE_KEY, isDeleted: false },
      select: { value: true },
    });
    const businessType = businessTypeSchema.safeParse(config?.value);

    return {
      status: 200,
      message: 'Tipo de negocio obtenido exitosamente',
      data: businessType.success ? businessType.data : null,
    };
  } catch (error) {
    return handleError(error, 'fetching business type');
  }
}
