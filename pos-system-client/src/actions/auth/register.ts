'use server';

/**
 * ============================================
 * REGISTER USER ACTION
 * ============================================
 *
 * Server action para registro de nuevos usuarios
 */

import { cookies, headers } from 'next/headers';
import { prisma } from '@/actions/utils';
import { ActionResponse } from '@/interfaces';
import {
  hashPassword,
  validateEmail,
  validatePasswordComplete,
  normalizeEmail,
  createSession,
  AuthError,
} from '@/lib/auth';

// Configuración de cookies
const COOKIE_NAME = 'auth-token';
const COOKIE_MAX_AGE = 7 * 24 * 60 * 60; // 7 días en segundos

// D3.4/D3.5: login por email (sin username), nombre en un solo campo
interface RegisterFormData {
  name: string;
  email: string;
  password: string;
  confirmPassword: string;
  organizationId?: string;
  storeId?: string;
}

interface RegisterResponseData {
  user: {
    id: string;
    name: string;
    email: string;
    role: string;
    organizationId: string | null;
    storeId: string | null;
    isActive: boolean;
    emailVerified: boolean;
    createdAt: Date;
    organization: {
      id: string;
      name: string;
    } | null;
    store: {
      id: string;
      name: string;
    } | null;
  };
  sessionId: string;
  redirectTo: string;
}

/**
 * Registra un nuevo usuario en el sistema
 *
 * @param formData - Datos del formulario de registro
 * @returns ActionResponse con el usuario creado o error
 *
 * @example
 * const result = await registerUser(formData);
 * if (result.status === 201) {
 *   // Usuario creado exitosamente
 *   redirect('/dashboard');
 * }
 */
export async function registerUser(
  formData: FormData
): Promise<ActionResponse<RegisterResponseData>> {
  try {
    // 1. Extraer y validar datos del formulario
    const data: RegisterFormData = {
      name: formData.get('name') as string,
      email: formData.get('email') as string,
      password: formData.get('password') as string,
      confirmPassword: formData.get('confirmPassword') as string,
      organizationId: formData.get('organizationId') as string | undefined,
      storeId: formData.get('storeId') as string | undefined,
    };

    // Validar campos requeridos
    if (!data.name || data.name.trim().length === 0) {
      return {
        status: 400,
        message: 'El nombre es requerido',
        data: null,
      };
    }

    // 2. Validar email
    try {
      validateEmail(data.email, {
        allowDisposable: false, // No permitir emails desechables
        maxLength: 254,
      });
    } catch (error) {
      if (error instanceof AuthError) {
        return {
          status: 400,
          message: error.message,
          data: null,
        };
      }
      throw error;
    }

    // Normalizar email
    const normalizedEmail = normalizeEmail(data.email);

    // 3. Validar password
    try {
      validatePasswordComplete(data.password, data.confirmPassword, {
        minLength: 8,
        requireUppercase: true,
        requireLowercase: true,
        requireNumber: true,
        requireSpecialChar: true,
      });
    } catch (error) {
      if (error instanceof AuthError) {
        return {
          status: 400,
          message: error.message,
          data: null,
        };
      }
      throw error;
    }

    // 4. Verificar que el email no existe: los users son identidades GLOBALES
    //    (D3.4 — email único entre usuarios vivos; la org vive en memberships)
    {
      const existingUserByEmail = await prisma.user.findFirst({
        where: {
          email: normalizedEmail,
          isDeleted: false,
        },
      });

      if (existingUserByEmail) {
        return {
          status: 409,
          message: 'Ya existe un usuario con este correo electrónico',
          data: null,
        };
      }

      // Verificar si existe un usuario eliminado con este email
      const deletedUser = await prisma.user.findFirst({
        where: {
          email: normalizedEmail,
          isDeleted: true,
        },
      });

      if (deletedUser) {
        return {
          status: 409,
          message: 'Este correo electrónico fue usado previamente. Por favor contacte a soporte para reactivar su cuenta',
          data: null,
        };
      }
    }

    // 5. Hash password con bcrypt
    const hashedPassword = await hashPassword(data.password, {
      saltRounds: 12,
    });

    // 6. Crear usuario (identidad global) y, si viene con organización, su
    //    membership SELLER (D3.3). Sin org = dueño que va al onboarding.
    const created = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          name: data.name.trim(),
          email: normalizedEmail,
          passwordHash: hashedPassword,
          isActive: true,
          isDeleted: false,
          emailVerified: false, // Requerir verificación de email (opcional por ahora)
          passwordChangedAt: new Date(),
        },
        select: {
          id: true,
          name: true,
          email: true,
          isActive: true,
          emailVerified: true,
          createdAt: true,
        },
      });

      if (!data.organizationId) {
        return { user, membership: null };
      }

      const membership = await tx.membership.create({
        data: {
          userId: user.id,
          organizationId: data.organizationId,
          role: 'SELLER',
          defaultStoreId: data.storeId || null,
          status: 'ACTIVE',
          acceptedAt: new Date(),
        },
        select: {
          role: true,
          organizationId: true,
          defaultStoreId: true,
          organization: { select: { id: true, name: true } },
          defaultStore: { select: { id: true, name: true } },
        },
      });

      return { user, membership };
    });

    const { user: newUser, membership } = created;

    // 7. Crear sesión y generar JWT
    // Obtener IP y User-Agent de headers (si están disponibles)
    const headersList = await headers();
    const ipAddress = headersList.get('x-forwarded-for') || headersList.get('x-real-ip') || undefined;
    const userAgent = headersList.get('user-agent') || undefined;

    const session = await createSession({
      userId: newUser.id,
      ipAddress,
      userAgent,
      expirationDays: 7,
    });

    const hasHTTPS = process.env.HTTPS_ENABLED === 'true';

    // 8. Set cookie con token (httpOnly, secure, sameSite)
    const cookieStore = await cookies();
    cookieStore.set(COOKIE_NAME, session.token, {
      httpOnly: true,
      secure: hasHTTPS,
      sameSite: 'lax',
      maxAge: COOKIE_MAX_AGE,
      path: '/',
    });

    // 9. Determinar URL de redirección
    // Usuarios sin organización van a onboarding
    // Usuarios con organización van directo a dashboard
    const redirectUrl = membership ? '/dashboard' : '/onboarding';

    // 10. Return success con la vista compuesta user+membership y redirect URL
    return {
      status: 201,
      message: 'Usuario registrado exitosamente',
      data: {
        user: {
          id: newUser.id,
          name: newUser.name,
          email: newUser.email,
          role: membership?.role ?? 'ADMIN',
          organizationId: membership?.organizationId ?? null,
          storeId: membership?.defaultStoreId ?? null,
          isActive: newUser.isActive,
          emailVerified: newUser.emailVerified,
          createdAt: newUser.createdAt,
          organization: membership?.organization ?? null,
          store: membership?.defaultStore ?? null,
        },
        sessionId: session.id,
        redirectTo: redirectUrl,
      },
    };
  } catch (error) {
    console.error('Register error:', error);

    if (error instanceof AuthError) {
      return {
        status: 400,
        message: error.message,
        data: null,
      };
    }

    return {
      status: 500,
      message: 'Error al registrar usuario. Por favor intente más tarde',
      data: null,
    };
  }
}
