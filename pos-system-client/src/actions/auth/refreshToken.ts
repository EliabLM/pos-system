'use server';

/**
 * ============================================
 * REFRESH TOKEN ACTION
 * ============================================
 *
 * Server action para refrescar el token JWT después de
 * actualizar datos del usuario (ej: organizationId)
 */

import { cookies } from 'next/headers';
import { prisma } from '@/actions/utils';
import { ActionResponse } from '@/interfaces';
import { createSession, invalidateSession } from '@/lib/auth';
import { AuthError, AuthErrorCode } from '@/lib/auth/types';
import {
  ACTIVE_MEMBERSHIP_ORDER,
  ACTIVE_MEMBERSHIP_WHERE,
  actorErrorResponse,
  requireSessionUserId,
} from '@/lib/auth/actor';

const COOKIE_NAME = 'auth-token';
const COOKIE_MAX_AGE = 7 * 24 * 60 * 60; // 7 días en segundos

/**
 * Refresca el token JWT del usuario actual
 * Útil después de actualizar datos críticos como organizationId
 *
 * El usuario sale SIEMPRE de la sesión de la cookie (nunca de un parámetro).
 *
 * @returns ActionResponse con el usuario actualizado
 */
interface RefreshTokenResponse {
  user?: Record<string, unknown>;
  token?: string;
  sessionId?: string;
}

export async function refreshToken(): Promise<ActionResponse<RefreshTokenResponse>> {
  try {
    const userId = await requireSessionUserId();
    // Token de la sesión actual (ya validado): se invalida al emitir el nuevo.
    const previousToken = (await cookies()).get(COOKIE_NAME)?.value;

    // Obtener usuario actualizado + tenancy del membership ACTIVO (D3.3)
    const userRow = await prisma.user.findFirst({
      where: {
        id: userId,
        isDeleted: false,
        isActive: true,
      },
      select: {
        id: true,
        name: true,
        email: true,
        isActive: true,
        emailVerified: true,
        createdAt: true,
        memberships: {
          // Mismo criterio que getActor() (resolveMembership)
          where: ACTIVE_MEMBERSHIP_WHERE,
          orderBy: ACTIVE_MEMBERSHIP_ORDER,
          take: 1,
          select: {
            role: true,
            organizationId: true,
            defaultStoreId: true,
            organization: { select: { id: true, name: true, isActive: true } },
            defaultStore: { select: { id: true, name: true, isActive: true } },
          },
        },
      },
    });

    const membership = userRow?.memberships[0] ?? null;
    const user = userRow
      ? {
          id: userRow.id,
          name: userRow.name,
          email: userRow.email,
          role: membership?.role ?? 'ADMIN',
          organizationId: membership?.organizationId ?? null,
          storeId: membership?.defaultStoreId ?? null,
          isActive: userRow.isActive,
          emailVerified: userRow.emailVerified,
          createdAt: userRow.createdAt,
          organization: membership?.organization ?? null,
          store: membership?.defaultStore ?? null,
        }
      : null;

    if (!user) {
      console.error('[RefreshToken] Usuario no encontrado o inactivo:', userId);
      return {
        status: 404,
        message: 'Usuario no encontrado o inactivo',
        data: null,
      };
    }

    // Crear nueva sesión con JWT actualizado
    const { headers } = await import('next/headers');
    const headersList = await headers();
    const ipAddress =
      headersList.get('x-forwarded-for') ||
      headersList.get('x-real-ip') ||
      undefined;
    const userAgent = headersList.get('user-agent') || undefined;

    const session = await createSession({
      userId: user.id,
      ipAddress,
      userAgent,
      expirationDays: 7,
    });

    const hasHTTPS = process.env.HTTPS_ENABLED === 'true';

    // Actualizar cookie con nuevo token
    const cookieStore = await cookies();
    cookieStore.set(COOKIE_NAME, session.token, {
      httpOnly: true,
      secure: hasHTTPS,
      sameSite: 'lax',
      maxAge: COOKIE_MAX_AGE,
      path: '/',
    });

    // El token anterior deja de valer: una sola sesión viva por refresco.
    if (previousToken && previousToken !== session.token) {
      await invalidateSession(previousToken);
    }

    return {
      status: 200,
      message: 'Token actualizado exitosamente',
      data: {
        user,
        sessionId: session.id,
      },
    };
  } catch (error) {
    const denied = actorErrorResponse(error);
    if (denied) return denied;

    console.error('[RefreshToken] Error en refresh token:', error);

    // Manejo específico de errores de autenticación
    if (error instanceof AuthError) {
      console.error('[RefreshToken] AuthError detectado:', {
        code: error.code,
        message: error.message,
      });

      switch (error.code) {
        case AuthErrorCode.USER_NOT_FOUND:
          return {
            status: 404,
            message: 'Usuario no encontrado',
            data: null,
          };
        case AuthErrorCode.USER_INACTIVE:
          return {
            status: 403,
            message: 'La cuenta de usuario está inactiva',
            data: null,
          };
        case AuthErrorCode.SESSION_EXPIRED:
          return {
            status: 401,
            message: 'La sesión ha expirado',
            data: null,
          };
        default:
          return {
            status: 500,
            message: error.message || 'Error en la autenticación',
            data: null,
          };
      }
    }

    // Error genérico
    return {
      status: 500,
      message: 'Error al actualizar token. Por favor intente más tarde',
      data: null,
    };
  }
}
