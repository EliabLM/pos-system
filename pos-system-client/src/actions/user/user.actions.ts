'use server';

import {
  MembershipRole,
  MembershipStatus,
  Organization,
  Prisma,
  Store,
  User,
} from '@/generated/prisma';
import { ActionResponse } from '@/interfaces';
import { actorErrorResponse, requireActor } from '@/lib/auth/actor';
import { prisma } from '../utils';
import bcrypt from 'bcrypt';
import {
  idSchema,
  roleSchema,
  updateUserInputSchema,
  userFiltersSchema,
} from './user.schemas';

// ============================================================
// D3.3: users es identidad global; la tenancy (org, store, role) vive en
// memberships. Estas actions exponen la vista compuesta que consume la UI.
//
// Autorización (#11): todo sale de requireActor(). Solo el ADMIN gestiona
// usuarios y solo los de SU organización; no hay acciones multi-organización.
// Los vendedores entran solo por invitación (#20, src/actions/invitation).
// ============================================================

export type UserWithTenancy = Omit<User, 'passwordHash'> & {
  role: MembershipRole | null;
  organizationId: string | null;
  storeId: string | null;
  organization: Organization | null;
  store: Store | null;
};

export interface UpdateUserInput {
  name?: string;
  email?: string;
  image?: string | null;
  isActive?: boolean;
  password?: string;
  role?: MembershipRole;
  storeId?: string | null;
}

export interface UserFilters {
  isActive?: boolean;
  role?: MembershipRole;
  storeId?: string;
  search?: string;
}

const ADMIN_ONLY = { roles: [MembershipRole.ADMIN] } as const;

/** Membresía de la organización del actor (la que se muestra en la vista). */
const orgMembershipInclude = (organizationId: string, includeDeleted = false) => ({
  where: {
    organizationId,
    ...(includeDeleted ? {} : { deletedAt: null, status: MembershipStatus.ACTIVE }),
  },
  orderBy: { createdAt: 'asc' as const },
  take: 1,
  include: {
    organization: true,
    defaultStore: true,
  },
});

type UserWithMemberships = User & {
  memberships: Array<{
    role: MembershipRole;
    organizationId: string;
    defaultStoreId: string | null;
    organization: Organization;
    defaultStore: Store | null;
  }>;
};

const composeUser = (user: UserWithMemberships): UserWithTenancy => {
  const membership = user.memberships[0] ?? null;
  // Sin destructuring-rest: se omiten memberships (interno) y passwordHash (secreto)
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    image: user.image,
    emailVerified: user.emailVerified,
    isActive: user.isActive,
    isDeleted: user.isDeleted,
    deletedAt: user.deletedAt,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    lastLoginAt: user.lastLoginAt,
    passwordChangedAt: user.passwordChangedAt,
    loginAttempts: user.loginAttempts,
    lockedUntil: user.lockedUntil,
    role: membership?.role ?? null,
    organizationId: membership?.organizationId ?? null,
    storeId: membership?.defaultStoreId ?? null,
    organization: membership?.organization ?? null,
    store: membership?.defaultStore ?? null,
  };
};

const badRequest = (message: string) => ({ status: 400, message, data: null });
const notFound = () => ({ status: 404, message: 'Usuario no encontrado', data: null });
const firstIssue = (error: { issues: Array<{ message: string }> }) =>
  error.issues[0]?.message ?? 'Datos inválidos';

/**
 * Usuario que pertenece a la organización del actor. Un usuario de otra
 * organización se trata como inexistente (404).
 */
const findOrgUser = (
  userId: string,
  organizationId: string,
  options: { includeDeleted?: boolean } = {}
) =>
  prisma.user.findFirst({
    where: {
      id: userId,
      ...(options.includeDeleted ? {} : { isDeleted: false }),
      memberships: {
        some: {
          organizationId,
          ...(options.includeDeleted ? {} : { deletedAt: null }),
        },
      },
    },
    include: { memberships: orgMembershipInclude(organizationId, options.includeDeleted) },
  });

/**
 * La identidad (email, contraseña, estado, borrado) es global: el ADMIN de una
 * organización no puede cambiarla si el usuario también pertenece a otra.
 */
const belongsToAnotherOrg = async (userId: string, organizationId: string) =>
  (await prisma.membership.count({
    where: { userId, organizationId: { not: organizationId }, deletedAt: null },
  })) > 0;

const sharedIdentityResponse = () => ({
  status: 409,
  message: 'El usuario pertenece también a otra organización y no se puede modificar desde aquí',
  data: null,
});

/**
 * Regla de negocio: una tienda solo puede tener UN vendedor activo asignado.
 */
const storeHasActiveSeller = async (
  storeId: string,
  excludeUserId?: string
): Promise<boolean> => {
  const existing = await prisma.membership.findFirst({
    where: {
      defaultStoreId: storeId,
      role: MembershipRole.SELLER,
      status: MembershipStatus.ACTIVE,
      deletedAt: null,
      ...(excludeUserId ? { userId: { not: excludeUserId } } : {}),
      user: { isDeleted: false, isActive: true },
    },
  });
  return !!existing;
};

const storeInOrg = (storeId: string, organizationId: string) =>
  prisma.store.findFirst({
    where: { id: storeId, organizationId, isDeleted: false },
    select: { id: true },
  });

// GET MANY — usuarios de la organización del actor (vía memberships)
export const getUsers = async (
  filters?: UserFilters,
  includeDeleted: boolean = false
): Promise<ActionResponse<UserWithTenancy[] | null>> => {
  try {
    const actor = await requireActor(ADMIN_ONLY);

    const parsed = userFiltersSchema.safeParse(filters);
    if (!parsed.success) return badRequest(firstIssue(parsed.error));
    const f = parsed.data;

    const membershipFilter: Prisma.MembershipWhereInput = {
      organizationId: actor.organizationId,
      ...(includeDeleted ? {} : { deletedAt: null, status: MembershipStatus.ACTIVE }),
      ...(f?.role ? { role: f.role } : {}),
      ...(f?.storeId ? { defaultStoreId: f.storeId } : {}),
    };

    const whereClause: Prisma.UserWhereInput = {
      isDeleted: includeDeleted ? undefined : false,
      memberships: { some: membershipFilter },
    };

    if (f?.isActive !== undefined) {
      whereClause.isActive = f.isActive;
    }

    if (f?.search) {
      whereClause.OR = [
        { name: { contains: f.search, mode: 'insensitive' } },
        { email: { contains: f.search, mode: 'insensitive' } },
      ];
    }

    const users = await prisma.user.findMany({
      where: whereClause,
      include: { memberships: orgMembershipInclude(actor.organizationId, includeDeleted) },
      orderBy: { createdAt: 'desc' },
    });

    return {
      status: 200,
      message: 'Usuarios obtenidos exitosamente',
      data: users.map(composeUser),
    };
  } catch (error) {
    const denied = actorErrorResponse(error);
    if (denied) return denied;
    console.error('Error fetching users:', error);
    return { status: 500, message: 'Error interno del servidor', data: null };
  }
};

// GET ONE — el ADMIN ve usuarios de su organización; el SELLER solo a sí mismo
export const getUserById = async (
  userId: string
): Promise<ActionResponse<UserWithTenancy | null>> => {
  try {
    const actor = await requireActor();

    if (!idSchema.safeParse(userId).success) {
      return badRequest('ID del usuario es requerido');
    }

    if (actor.role !== MembershipRole.ADMIN && userId !== actor.userId) {
      return notFound();
    }

    const user = await findOrgUser(userId, actor.organizationId);
    if (!user) return notFound();

    return {
      status: 200,
      message: 'Usuario obtenido exitosamente',
      data: composeUser(user),
    };
  } catch (error) {
    const denied = actorErrorResponse(error);
    if (denied) return denied;
    console.error('Error fetching user:', error);
    return { status: 500, message: 'Error interno del servidor', data: null };
  }
};

// UPDATE — campos de identidad en users; role/store en el membership de la org
export const updateUser = async (
  userId: string,
  updateData: UpdateUserInput
): Promise<ActionResponse<UserWithTenancy | null>> => {
  try {
    const actor = await requireActor(ADMIN_ONLY);

    if (!idSchema.safeParse(userId).success) {
      return badRequest('ID del usuario es requerido');
    }

    const parsed = updateUserInputSchema.safeParse(updateData);
    if (!parsed.success) return badRequest(firstIssue(parsed.error));
    const data = parsed.data;

    const existingUser = await findOrgUser(userId, actor.organizationId);
    if (!existingUser) return notFound();

    const isSelf = userId === actor.userId;
    if (isSelf && data.role !== undefined && data.role !== MembershipRole.ADMIN) {
      return badRequest('No puedes quitarte el rol de administrador');
    }
    if (isSelf && data.isActive === false) {
      return badRequest('No puedes desactivar tu propio usuario');
    }

    const changesIdentity =
      data.email !== undefined ||
      data.password !== undefined ||
      data.isActive !== undefined;
    if (changesIdentity && (await belongsToAnotherOrg(userId, actor.organizationId))) {
      return sharedIdentityResponse();
    }

    const membership = existingUser.memberships[0] ?? null;

    // Verificar unicidad de email si se está actualizando
    if (data.email && data.email !== existingUser.email) {
      const duplicateUserByEmail = await prisma.user.findFirst({
        where: {
          email: data.email,
          isDeleted: false,
          id: { not: userId },
        },
        select: { id: true },
      });

      if (duplicateUserByEmail) {
        return {
          status: 409,
          message: 'Ya existe un usuario con ese email',
          data: null,
        };
      }
    }

    // Verificar tienda si se está actualizando
    if (data.storeId && data.storeId !== membership?.defaultStoreId) {
      if (!(await storeInOrg(data.storeId, actor.organizationId))) {
        return badRequest('La tienda especificada no existe');
      }

      const effectiveRole = data.role ?? membership?.role;
      if (
        effectiveRole === MembershipRole.SELLER &&
        (await storeHasActiveSeller(data.storeId, userId))
      ) {
        return {
          status: 409,
          message: 'La tienda ya tiene un vendedor asignado',
          data: null,
        };
      }
    }

    const updatedUser = await prisma.$transaction(async (tx) => {
      const userChanges: Prisma.UserUpdateInput = {
        updatedAt: new Date(),
      };
      if (data.name !== undefined) userChanges.name = data.name;
      if (data.email !== undefined) userChanges.email = data.email;
      if (data.image !== undefined) userChanges.image = data.image;
      if (data.isActive !== undefined) userChanges.isActive = data.isActive;
      if (data.password) {
        userChanges.passwordHash = await bcrypt.hash(data.password, 12);
        userChanges.passwordChangedAt = new Date();
      }

      await tx.user.update({ where: { id: userId }, data: userChanges });

      if (data.role !== undefined || data.storeId !== undefined) {
        await tx.membership.updateMany({
          where: {
            userId,
            organizationId: actor.organizationId,
            deletedAt: null,
          },
          data: {
            ...(data.role !== undefined ? { role: data.role } : {}),
            ...(data.storeId !== undefined ? { defaultStoreId: data.storeId } : {}),
          },
        });
      }

      return tx.user.findUniqueOrThrow({
        where: { id: userId },
        include: { memberships: orgMembershipInclude(actor.organizationId) },
      });
    });

    return {
      status: 200,
      message: 'Usuario actualizado exitosamente',
      data: composeUser(updatedUser),
    };
  } catch (error) {
    const denied = actorErrorResponse(error);
    if (denied) return denied;

    console.error('Error updating user:', error);

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        return {
          status: 409,
          message: 'Ya existe un usuario con ese email',
          data: null,
        };
      }
      if (error.code === 'P2025') return notFound();
      if (error.code === 'P2003') {
        return badRequest('Una de las referencias especificadas no existe');
      }
    }

    return { status: 500, message: 'Error interno del servidor', data: null };
  }
};

// UPDATE USER ROLE — sobre el membership de la organización del actor
export const updateUserRole = async (
  userId: string,
  newRole: MembershipRole
): Promise<ActionResponse<UserWithTenancy | null>> => {
  try {
    const actor = await requireActor(ADMIN_ONLY);

    if (!idSchema.safeParse(userId).success) {
      return badRequest('ID del usuario es requerido');
    }
    const role = roleSchema.safeParse(newRole);
    if (!role.success) return badRequest('Rol inválido');

    if (userId === actor.userId) {
      return badRequest('No puedes cambiar tu propio rol');
    }

    const existingUser = await findOrgUser(userId, actor.organizationId);
    if (!existingUser) return notFound();

    await prisma.membership.updateMany({
      where: {
        userId,
        organizationId: actor.organizationId,
        deletedAt: null,
      },
      data: { role: role.data },
    });

    const updatedUser = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { memberships: orgMembershipInclude(actor.organizationId) },
    });

    return {
      status: 200,
      message: 'Rol de usuario actualizado exitosamente',
      data: composeUser(updatedUser),
    };
  } catch (error) {
    const denied = actorErrorResponse(error);
    if (denied) return denied;

    console.error('Error updating user role:', error);

    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      return notFound();
    }

    return { status: 500, message: 'Error interno del servidor', data: null };
  }
};

// ACTIVATE/DEACTIVATE USER
export const toggleUserStatus = async (
  userId: string,
  isActive: boolean
): Promise<ActionResponse<UserWithTenancy | null>> => {
  try {
    const actor = await requireActor(ADMIN_ONLY);

    if (!idSchema.safeParse(userId).success) {
      return badRequest('ID del usuario es requerido');
    }
    if (typeof isActive !== 'boolean') return badRequest('Estado inválido');

    if (userId === actor.userId) {
      return badRequest('No puedes cambiar el estado de tu propio usuario');
    }

    const existingUser = await findOrgUser(userId, actor.organizationId);
    if (!existingUser) return notFound();

    if (await belongsToAnotherOrg(userId, actor.organizationId)) {
      return sharedIdentityResponse();
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        isActive,
        updatedAt: new Date(),
      },
      include: { memberships: orgMembershipInclude(actor.organizationId) },
    });

    return {
      status: 200,
      message: `Usuario ${isActive ? 'activado' : 'desactivado'} exitosamente`,
      data: composeUser(updatedUser),
    };
  } catch (error) {
    const denied = actorErrorResponse(error);
    if (denied) return denied;

    console.error('Error toggling user status:', error);

    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      return notFound();
    }

    return { status: 500, message: 'Error interno del servidor', data: null };
  }
};

// GET USERS BY ROLE — de la organización del actor
export const getUsersByRole = async (
  role: MembershipRole
): Promise<ActionResponse<UserWithTenancy[] | null>> => {
  try {
    const actor = await requireActor(ADMIN_ONLY);

    const parsedRole = roleSchema.safeParse(role);
    if (!parsedRole.success) return badRequest('Rol inválido');

    const users = await prisma.user.findMany({
      where: {
        isDeleted: false,
        isActive: true,
        memberships: {
          some: {
            organizationId: actor.organizationId,
            role: parsedRole.data,
            deletedAt: null,
            status: MembershipStatus.ACTIVE,
          },
        },
      },
      include: { memberships: orgMembershipInclude(actor.organizationId) },
      orderBy: { createdAt: 'desc' },
    });

    return {
      status: 200,
      message: `Usuarios con rol ${parsedRole.data} obtenidos exitosamente`,
      data: users.map(composeUser),
    };
  } catch (error) {
    const denied = actorErrorResponse(error);
    if (denied) return denied;
    console.error('Error fetching users by role:', error);
    return { status: 500, message: 'Error interno del servidor', data: null };
  }
};

// SOFT DELETE — usuario + su membership en la organización del actor
export const softDeleteUser = async (userId: string): Promise<ActionResponse> => {
  try {
    const actor = await requireActor(ADMIN_ONLY);

    if (!idSchema.safeParse(userId).success) {
      return badRequest('ID del usuario es requerido');
    }

    if (userId === actor.userId) {
      return badRequest('No puedes eliminar tu propio usuario');
    }

    const existingUser = await findOrgUser(userId, actor.organizationId);
    if (!existingUser) return notFound();

    if (await belongsToAnotherOrg(userId, actor.organizationId)) {
      return sharedIdentityResponse();
    }

    // Verificar si hay ventas o movimientos de stock asociados
    const salesCount = await prisma.sale.count({ where: { userId } });
    const stockMovementsCount = await prisma.stockMovement.count({ where: { userId } });

    if (salesCount > 0 || stockMovementsCount > 0) {
      return {
        status: 409,
        message: `No se puede eliminar el usuario. Tiene ${salesCount + stockMovementsCount
          } transacción(es) asociada(s)`,
        data: null,
      };
    }

    await prisma.$transaction([
      prisma.user.update({
        where: { id: userId },
        data: {
          isDeleted: true,
          deletedAt: new Date(),
          isActive: false,
          updatedAt: new Date(),
        },
      }),
      prisma.membership.updateMany({
        where: { userId, organizationId: actor.organizationId, deletedAt: null },
        data: { deletedAt: new Date() },
      }),
    ]);

    return {
      status: 200,
      message: 'Usuario eliminado (soft) exitosamente',
      data: null,
    };
  } catch (error) {
    const denied = actorErrorResponse(error);
    if (denied) return denied;

    console.error('Error soft deleting user:', error);

    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      return notFound();
    }

    return { status: 500, message: 'Error interno del servidor', data: null };
  }
};

// RESTORE — usuario + su membership en la organización del actor
export const restoreUser = async (
  userId: string
): Promise<ActionResponse<UserWithTenancy | null>> => {
  try {
    const actor = await requireActor(ADMIN_ONLY);

    if (!idSchema.safeParse(userId).success) {
      return badRequest('ID del usuario es requerido');
    }

    const existingUser = await findOrgUser(userId, actor.organizationId, { includeDeleted: true });
    if (!existingUser) return notFound();

    if (await belongsToAnotherOrg(userId, actor.organizationId)) {
      return sharedIdentityResponse();
    }

    await prisma.$transaction([
      prisma.user.update({
        where: { id: userId },
        data: {
          isDeleted: false,
          deletedAt: null,
          updatedAt: new Date(),
        },
      }),
      prisma.membership.updateMany({
        where: { userId, organizationId: actor.organizationId },
        data: { deletedAt: null },
      }),
    ]);

    const composed = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { memberships: orgMembershipInclude(actor.organizationId) },
    });

    return {
      status: 200,
      message: 'Usuario restaurado exitosamente',
      data: composeUser(composed),
    };
  } catch (error) {
    const denied = actorErrorResponse(error);
    if (denied) return denied;

    console.error('Error restoring user:', error);

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2025') return notFound();
      // Índice único parcial de email (usuarios vivos): se reutilizó mientras estaba borrado.
      if (error.code === 'P2002') {
        return {
          status: 409,
          message: 'Ya existe otro usuario con ese email; no se puede restaurar',
          data: null,
        };
      }
    }

    return { status: 500, message: 'Error interno del servidor', data: null };
  }
};

// HARD DELETE — solo usuarios que pertenecen únicamente a la organización del actor
export const deleteUser = async (userId: string): Promise<ActionResponse> => {
  try {
    const actor = await requireActor(ADMIN_ONLY);

    if (!idSchema.safeParse(userId).success) {
      return badRequest('ID del usuario es requerido');
    }

    if (userId === actor.userId) {
      return badRequest('No puedes eliminar tu propio usuario');
    }

    const existingUser = await findOrgUser(userId, actor.organizationId, { includeDeleted: true });
    if (!existingUser) return notFound();

    if (await belongsToAnotherOrg(userId, actor.organizationId)) {
      return sharedIdentityResponse();
    }

    // Verificar si hay transacciones asociadas
    const salesCount = await prisma.sale.count({ where: { userId } });
    const stockMovementsCount = await prisma.stockMovement.count({ where: { userId } });

    if (salesCount > 0 || stockMovementsCount > 0) {
      return {
        status: 409,
        message: `No se puede eliminar permanentemente el usuario. Tiene transacciones o movimientos asociados. Use eliminación suave en su lugar.`,
        data: null,
      };
    }

    // Memberships y sesiones caen por FK ON DELETE CASCADE
    await prisma.user.delete({ where: { id: userId } });

    return {
      status: 200,
      message: 'Usuario eliminado permanentemente',
      data: null,
    };
  } catch (error) {
    const denied = actorErrorResponse(error);
    if (denied) return denied;

    console.error('Error deleting user:', error);

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2025') return notFound();
      if (error.code === 'P2003') {
        return {
          status: 409,
          message:
            'No se puede eliminar el usuario porque tiene registros asociados',
          data: null,
        };
      }
    }

    return { status: 500, message: 'Error interno del servidor', data: null };
  }
};
