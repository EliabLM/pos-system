'use server';

/**
 * ============================================
 * REGISTER USER ACTION
 * ============================================
 *
 * Server action para registro de nuevos usuarios.
 *
 * Registro libre: crea SOLO la identidad del usuario, sin organización ni
 * membresía. Luego el usuario crea su propio negocio en el onboarding y queda
 * como ADMIN de él. Nadie se une a una organización existente desde aquí: los
 * vendedores los da de alta el ADMIN de su organización.
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
}

interface RegisterResponseData {
  user: {
    id: string;
    name: string;
    email: string;
    /** Sin membresía todavía: sin rol, sin organización ni tienda. */
    role: null;
    organizationId: null;
    storeId: null;
    isActive: boolean;
    emailVerified: boolean;
    createdAt: Date;
    organization: null;
    store: null;
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
    // 1. Extraer y validar datos del formulario (lista blanca: cualquier
    //    otro campo, p. ej. organizationId o storeId, se ignora)
    const field = (key: keyof RegisterFormData): string => {
      const value = formData.get(key);
      return typeof value === 'string' ? value : '';
    };
    const data: RegisterFormData = {
      name: field('name'),
      email: field('email'),
      password: field('password'),
      confirmPassword: field('confirmPassword'),
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

    // 6. Crear SOLO el usuario (identidad global, D3.3). Sin membresía: el
    //    onboarding crea su organización y su membresía ADMIN.
    const newUser = await prisma.user.create({
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

    // 9. Todo usuario recién registrado va al onboarding a crear su negocio
    const redirectUrl = '/onboarding';

    // 10. Return success con la vista compuesta user+membership y redirect URL
    return {
      status: 201,
      message: 'Usuario registrado exitosamente',
      data: {
        user: {
          id: newUser.id,
          name: newUser.name,
          email: newUser.email,
          role: null,
          organizationId: null,
          storeId: null,
          isActive: newUser.isActive,
          emailVerified: newUser.emailVerified,
          createdAt: newUser.createdAt,
          organization: null,
          store: null,
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
