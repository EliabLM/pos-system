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
import {
  prisma,
  checkAdminRole,
  unauthorizedResponse,
  checkOrgId,
  emptyOrgIdResponse,
} from '../utils';
import bcrypt from 'bcrypt';

// ============================================================
// D3.3: users es identidad global; la tenancy (org, store, role) vive en
// memberships. Estas actions exponen la vista compuesta que consume la UI.
// ============================================================

export type UserWithTenancy = Omit<User, 'passwordHash'> & {
  role: MembershipRole | null;
  organizationId: string | null;
  storeId: string | null;
  organization: Organization | null;
  store: Store | null;
};

export interface CreateUserInput {
  name: string;
  email: string;
  password: string;
  role: MembershipRole;
  storeId?: string | null;
  isActive?: boolean;
}

export interface UpdateUserInput {
  name?: string;
  email?: string;
  image?: string | null;
  isActive?: boolean;
  password?: string;
  role?: MembershipRole;
  storeId?: string | null;
}

const activeMembershipInclude = {
  where: { deletedAt: null, status: MembershipStatus.ACTIVE },
  orderBy: { createdAt: 'asc' as const },
  take: 1,
  include: {
    organization: true,
    defaultStore: true,
  },
};

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

// CREATE — crea la identidad + su membership en la organización (tx)
export const createUser = async (
  orgId: string,
  adminUserId: string,
  userData: CreateUserInput
): Promise<ActionResponse<UserWithTenancy | null>> => {
  try {
    const isAdmin = await checkAdminRole(adminUserId);
    if (!isAdmin) return unauthorizedResponse();

    if (checkOrgId(orgId)) return emptyOrgIdResponse();

    // Email único global entre usuarios vivos (D3.4)
    const existingUserByEmail = await prisma.user.findFirst({
      where: { email: userData.email, isDeleted: false },
    });

    if (existingUserByEmail) {
      return {
        status: 409,
        message: 'Ya existe un usuario con ese email',
        data: null,
      };
    }

    if (userData.storeId) {
      const store = await prisma.store.findFirst({
        where: { id: userData.storeId, organizationId: orgId, isDeleted: false },
      });

      if (!store) {
        return {
          status: 400,
          message: 'La tienda especificada no existe',
          data: null,
        };
      }

      if (
        userData.role === MembershipRole.SELLER &&
        (await storeHasActiveSeller(userData.storeId))
      ) {
        return {
          status: 409,
          message: 'La tienda ya tiene un vendedor asignado',
          data: null,
        };
      }
    }

    const hashedPassword = await bcrypt.hash(userData.password, 12);

    const newUser = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          name: userData.name,
          email: userData.email,
          passwordHash: hashedPassword,
          isActive: userData.isActive ?? true,
          passwordChangedAt: new Date(),
        },
      });

      await tx.membership.create({
        data: {
          userId: user.id,
          organizationId: orgId,
          role: userData.role,
          defaultStoreId: userData.storeId ?? null,
          status: MembershipStatus.ACTIVE,
          invitedBy: adminUserId,
          acceptedAt: new Date(),
        },
      });

      return tx.user.findUniqueOrThrow({
        where: { id: user.id },
        include: { memberships: activeMembershipInclude },
      });
    });

    return {
      status: 201,
      message: 'Usuario creado exitosamente',
      data: composeUser(newUser),
    };
  } catch (error) {
    console.error('Error creating user:', error);

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        return {
          status: 409,
          message: 'Ya existe un usuario con ese email',
          data: null,
        };
      }
      if (error.code === 'P2003') {
        return {
          status: 400,
          message: 'Una de las referencias especificadas no existe',
          data: null,
        };
      }
    }

    return { status: 500, message: 'Error interno del servidor', data: null };
  }
};

// GET MANY — usuarios de una organización (vía memberships)
export const getUsersByOrgId = async (
  orgId: string,
  filters?: {
    isActive?: boolean;
    role?: MembershipRole;
    storeId?: string;
    search?: string;
  },
  includeDeleted: boolean = false
): Promise<ActionResponse<UserWithTenancy[] | null>> => {
  try {
    if (checkOrgId(orgId)) return emptyOrgIdResponse();

    const membershipFilter: Prisma.MembershipWhereInput = {
      organizationId: orgId,
      deletedAt: null,
      status: MembershipStatus.ACTIVE,
    };

    if (filters?.role) {
      membershipFilter.role = filters.role;
    }

    if (filters?.storeId) {
      membershipFilter.defaultStoreId = filters.storeId;
    }

    const whereClause: Prisma.UserWhereInput = {
      isDeleted: includeDeleted ? undefined : false,
      memberships: { some: membershipFilter },
    };

    if (filters?.isActive !== undefined) {
      whereClause.isActive = filters.isActive;
    }

    if (filters?.search) {
      whereClause.OR = [
        { name: { contains: filters.search, mode: 'insensitive' } },
        { email: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    const users = await prisma.user.findMany({
      where: whereClause,
      include: {
        memberships: {
          ...activeMembershipInclude,
          where: { ...activeMembershipInclude.where, organizationId: orgId },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return {
      status: 200,
      message: 'Usuarios obtenidos exitosamente',
      data: users.map(composeUser),
    };
  } catch (error) {
    console.error('Error fetching users:', error);
    return { status: 500, message: 'Error interno del servidor', data: null };
  }
};

// GET ALL USERS (for super admin)
export const getAllUsers = async (
  adminUserId: string,
  filters?: {
    isActive?: boolean;
    role?: MembershipRole;
    organizationId?: string;
    search?: string;
  },
  includeDeleted: boolean = false
): Promise<ActionResponse<UserWithTenancy[] | null>> => {
  try {
    const isAdmin = await checkAdminRole(adminUserId);
    if (!isAdmin) return unauthorizedResponse();

    const whereClause: Prisma.UserWhereInput = {
      isDeleted: includeDeleted ? undefined : false,
    };

    if (filters?.isActive !== undefined) {
      whereClause.isActive = filters.isActive;
    }

    if (filters?.role || filters?.organizationId) {
      whereClause.memberships = {
        some: {
          deletedAt: null,
          ...(filters.role ? { role: filters.role } : {}),
          ...(filters.organizationId
            ? { organizationId: filters.organizationId }
            : {}),
        },
      };
    }

    if (filters?.search) {
      whereClause.OR = [
        { name: { contains: filters.search, mode: 'insensitive' } },
        { email: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    const users = await prisma.user.findMany({
      where: whereClause,
      include: { memberships: activeMembershipInclude },
      orderBy: { createdAt: 'desc' },
    });

    return {
      status: 200,
      message: 'Usuarios obtenidos exitosamente',
      data: users.map(composeUser),
    };
  } catch (error) {
    console.error('Error fetching all users:', error);
    return { status: 500, message: 'Error interno del servidor', data: null };
  }
};

// GET ONE
export const getUserById = async (
  userId: string
): Promise<ActionResponse<UserWithTenancy | null>> => {
  try {
    if (!userId)
      return {
        status: 400,
        message: 'ID del usuario es requerido',
        data: null,
      };

    const user = await prisma.user.findFirst({
      where: { id: userId, isDeleted: false },
      include: { memberships: activeMembershipInclude },
    });

    if (!user)
      return { status: 404, message: 'Usuario no encontrado', data: null };

    return {
      status: 200,
      message: 'Usuario obtenido exitosamente',
      data: composeUser(user),
    };
  } catch (error) {
    console.error('Error fetching user:', error);
    return { status: 500, message: 'Error interno del servidor', data: null };
  }
};

// GET BY EMAIL
export const getUserByEmail = async (
  email: string
): Promise<ActionResponse<UserWithTenancy | null>> => {
  try {
    if (!email)
      return {
        status: 400,
        message: 'Email es requerido',
        data: null,
      };

    const user = await prisma.user.findFirst({
      where: {
        email,
        isDeleted: false,
        isActive: true,
      },
      include: { memberships: activeMembershipInclude },
    });

    if (!user)
      return { status: 404, message: 'Usuario no encontrado', data: null };

    return {
      status: 200,
      message: 'Usuario obtenido exitosamente',
      data: composeUser(user),
    };
  } catch (error) {
    console.error('Error fetching user by email:', error);
    return { status: 500, message: 'Error interno del servidor', data: null };
  }
};

// UPDATE — campos de identidad en users; role/store en el membership ACTIVO
export const updateUser = async (
  userId: string,
  adminUserId: string,
  updateData: UpdateUserInput
): Promise<ActionResponse<UserWithTenancy | null>> => {
  try {
    const isAdmin = await checkAdminRole(adminUserId);
    if (!isAdmin) return unauthorizedResponse();

    if (!userId)
      return {
        status: 400,
        message: 'ID del usuario es requerido',
        data: null,
      };

    const existingUser = await prisma.user.findFirst({
      where: { id: userId, isDeleted: false },
      include: { memberships: activeMembershipInclude },
    });

    if (!existingUser) {
      return { status: 404, message: 'Usuario no encontrado', data: null };
    }

    const membership = existingUser.memberships[0] ?? null;

    // Verificar unicidad de email si se está actualizando
    if (updateData.email && updateData.email !== existingUser.email) {
      const duplicateUserByEmail = await prisma.user.findFirst({
        where: {
          email: updateData.email,
          isDeleted: false,
          id: { not: userId },
        },
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
    if (
      updateData.storeId &&
      updateData.storeId !== membership?.defaultStoreId
    ) {
      const store = await prisma.store.findFirst({
        where: {
          id: updateData.storeId,
          organizationId: membership?.organizationId ?? undefined,
          isDeleted: false,
        },
      });

      if (!store) {
        return {
          status: 400,
          message: 'La tienda especificada no existe',
          data: null,
        };
      }

      const effectiveRole = updateData.role ?? membership?.role;
      if (
        effectiveRole === MembershipRole.SELLER &&
        (await storeHasActiveSeller(updateData.storeId, userId))
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
      if (updateData.name !== undefined) userChanges.name = updateData.name;
      if (updateData.email !== undefined) userChanges.email = updateData.email;
      if (updateData.image !== undefined) userChanges.image = updateData.image;
      if (updateData.isActive !== undefined)
        userChanges.isActive = updateData.isActive;
      if (updateData.password) {
        userChanges.passwordHash = await bcrypt.hash(updateData.password, 12);
        userChanges.passwordChangedAt = new Date();
      }

      await tx.user.update({ where: { id: userId }, data: userChanges });

      if (
        membership &&
        (updateData.role !== undefined || updateData.storeId !== undefined)
      ) {
        await tx.membership.updateMany({
          where: {
            userId,
            organizationId: membership.organizationId,
            deletedAt: null,
          },
          data: {
            ...(updateData.role !== undefined ? { role: updateData.role } : {}),
            ...(updateData.storeId !== undefined
              ? { defaultStoreId: updateData.storeId }
              : {}),
          },
        });
      }

      return tx.user.findUniqueOrThrow({
        where: { id: userId },
        include: { memberships: activeMembershipInclude },
      });
    });

    return {
      status: 200,
      message: 'Usuario actualizado exitosamente',
      data: composeUser(updatedUser),
    };
  } catch (error) {
    console.error('Error updating user:', error);

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        return {
          status: 409,
          message: 'Ya existe un usuario con ese email',
          data: null,
        };
      }
      if (error.code === 'P2025') {
        return { status: 404, message: 'Usuario no encontrado', data: null };
      }
      if (error.code === 'P2003') {
        return {
          status: 400,
          message: 'Una de las referencias especificadas no existe',
          data: null,
        };
      }
    }

    return { status: 500, message: 'Error interno del servidor', data: null };
  }
};

// ASSIGN ORG (onboarding) — crea el membership ADMIN del dueño (D3.3)
export const updateUserOrg = async (
  userId: string,
  orgId: string
): Promise<ActionResponse<UserWithTenancy | null>> => {
  try {
    if (!userId)
      return {
        status: 400,
        message: 'ID del usuario es requerido',
        data: null,
      };

    const existingUser = await prisma.user.findFirst({
      where: { id: userId, isDeleted: false },
    });

    if (!existingUser) {
      return { status: 404, message: 'Usuario no encontrado', data: null };
    }

    const existingMembership = await prisma.membership.findFirst({
      where: { userId, organizationId: orgId, deletedAt: null },
    });

    if (!existingMembership) {
      await prisma.membership.create({
        data: {
          userId,
          organizationId: orgId,
          role: MembershipRole.ADMIN,
          status: MembershipStatus.ACTIVE,
          acceptedAt: new Date(),
        },
      });
    }

    const updatedUser = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { memberships: activeMembershipInclude },
    });

    return {
      status: 200,
      message: 'Organización del usuario actualizada exitosamente',
      data: composeUser(updatedUser),
    };
  } catch (error) {
    console.error('Error updating user organization:', error);

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2025') {
        return { status: 404, message: 'Usuario no encontrado', data: null };
      }
    }

    return { status: 500, message: 'Error interno del servidor', data: null };
  }
};

// UPDATE USER ROLE — sobre el membership ACTIVO
export const updateUserRole = async (
  userId: string,
  adminUserId: string,
  newRole: MembershipRole
): Promise<ActionResponse<UserWithTenancy | null>> => {
  try {
    const isAdmin = await checkAdminRole(adminUserId);
    if (!isAdmin) return unauthorizedResponse();

    if (!userId)
      return {
        status: 400,
        message: 'ID del usuario es requerido',
        data: null,
      };

    const existingUser = await prisma.user.findFirst({
      where: { id: userId, isDeleted: false },
      include: { memberships: activeMembershipInclude },
    });

    if (!existingUser) {
      return { status: 404, message: 'Usuario no encontrado', data: null };
    }

    const membership = existingUser.memberships[0] ?? null;
    if (!membership) {
      return {
        status: 400,
        message: 'El usuario no pertenece a ninguna organización',
        data: null,
      };
    }

    await prisma.membership.updateMany({
      where: {
        userId,
        organizationId: membership.organizationId,
        deletedAt: null,
      },
      data: { role: newRole },
    });

    const updatedUser = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { memberships: activeMembershipInclude },
    });

    return {
      status: 200,
      message: 'Rol de usuario actualizado exitosamente',
      data: composeUser(updatedUser),
    };
  } catch (error) {
    console.error('Error updating user role:', error);

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2025') {
        return { status: 404, message: 'Usuario no encontrado', data: null };
      }
    }

    return { status: 500, message: 'Error interno del servidor', data: null };
  }
};

// ACTIVATE/DEACTIVATE USER
export const toggleUserStatus = async (
  userId: string,
  adminUserId: string,
  isActive: boolean
): Promise<ActionResponse<UserWithTenancy | null>> => {
  try {
    const isAdminRole = await checkAdminRole(adminUserId);
    if (!isAdminRole) return unauthorizedResponse();

    if (!userId)
      return {
        status: 400,
        message: 'ID del usuario es requerido',
        data: null,
      };

    const existingUser = await prisma.user.findFirst({
      where: { id: userId, isDeleted: false },
    });

    if (!existingUser) {
      return { status: 404, message: 'Usuario no encontrado', data: null };
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        isActive,
        updatedAt: new Date(),
      },
      include: { memberships: activeMembershipInclude },
    });

    return {
      status: 200,
      message: `Usuario ${isActive ? 'activado' : 'desactivado'} exitosamente`,
      data: composeUser(updatedUser),
    };
  } catch (error) {
    console.error('Error toggling user status:', error);

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2025') {
        return { status: 404, message: 'Usuario no encontrado', data: null };
      }
    }

    return { status: 500, message: 'Error interno del servidor', data: null };
  }
};

// GET USERS BY ROLE
export const getUsersByRole = async (
  orgId: string,
  role: MembershipRole
): Promise<ActionResponse<UserWithTenancy[] | null>> => {
  try {
    if (checkOrgId(orgId)) return emptyOrgIdResponse();

    const users = await prisma.user.findMany({
      where: {
        isDeleted: false,
        isActive: true,
        memberships: {
          some: {
            organizationId: orgId,
            role,
            deletedAt: null,
            status: MembershipStatus.ACTIVE,
          },
        },
      },
      include: {
        memberships: {
          ...activeMembershipInclude,
          where: { ...activeMembershipInclude.where, organizationId: orgId },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return {
      status: 200,
      message: `Usuarios con rol ${role} obtenidos exitosamente`,
      data: users.map(composeUser),
    };
  } catch (error) {
    console.error('Error fetching users by role:', error);
    return { status: 500, message: 'Error interno del servidor', data: null };
  }
};

// SOFT DELETE — usuario + sus memberships
export const softDeleteUser = async (
  userId: string,
  adminUserId: string
): Promise<ActionResponse> => {
  try {
    const isAdmin = await checkAdminRole(adminUserId);
    if (!isAdmin) return unauthorizedResponse();

    if (!userId)
      return {
        status: 400,
        message: 'ID del usuario es requerido',
        data: null,
      };

    // Verificar si hay ventas asociadas
    const salesCount = await prisma.sale.count({
      where: { userId },
    });

    // Verificar si hay movimientos de stock asociados
    const stockMovementsCount = await prisma.stockMovement.count({
      where: { userId },
    });

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
        where: { userId, deletedAt: null },
        data: { deletedAt: new Date() },
      }),
    ]);

    return {
      status: 200,
      message: 'Usuario eliminado (soft) exitosamente',
      data: null,
    };
  } catch (error) {
    console.error('Error soft deleting user:', error);

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2025') {
        return { status: 404, message: 'Usuario no encontrado', data: null };
      }
    }

    return { status: 500, message: 'Error interno del servidor', data: null };
  }
};

// RESTORE — usuario + sus memberships
export const restoreUser = async (
  userId: string,
  adminUserId: string
): Promise<ActionResponse<UserWithTenancy | null>> => {
  try {
    const isAdmin = await checkAdminRole(adminUserId);
    if (!isAdmin) return unauthorizedResponse();

    if (!userId)
      return {
        status: 400,
        message: 'ID del usuario es requerido',
        data: null,
      };

    const [restoredUser] = await prisma.$transaction([
      prisma.user.update({
        where: { id: userId },
        data: {
          isDeleted: false,
          deletedAt: null,
          updatedAt: new Date(),
        },
      }),
      prisma.membership.updateMany({
        where: { userId },
        data: { deletedAt: null },
      }),
    ]);

    const composed = await prisma.user.findUniqueOrThrow({
      where: { id: restoredUser.id },
      include: { memberships: activeMembershipInclude },
    });

    return {
      status: 200,
      message: 'Usuario restaurado exitosamente',
      data: composeUser(composed),
    };
  } catch (error) {
    console.error('Error restoring user:', error);

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2025') {
        return { status: 404, message: 'Usuario no encontrado', data: null };
      }
    }

    return { status: 500, message: 'Error interno del servidor', data: null };
  }
};

// HARD DELETE
export const deleteUser = async (
  userId: string,
  adminUserId: string
): Promise<ActionResponse> => {
  try {
    const isAdmin = await checkAdminRole(adminUserId);
    if (!isAdmin) return unauthorizedResponse();

    if (!userId)
      return {
        status: 400,
        message: 'ID del usuario es requerido',
        data: null,
      };

    // Verificar si hay transacciones asociadas
    const salesCount = await prisma.sale.count({
      where: { userId },
    });

    const stockMovementsCount = await prisma.stockMovement.count({
      where: { userId },
    });

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
    console.error('Error deleting user:', error);

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2025') {
        return { status: 404, message: 'Usuario no encontrado', data: null };
      }
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
