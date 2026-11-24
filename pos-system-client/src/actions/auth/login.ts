'use server';

/**
 * ============================================
 * LOGIN USER ACTION
 * ============================================
 *
 * Server action para autenticación de usuarios
 */

import { cookies } from 'next/headers';
import { prisma } from '@/actions/utils';
import { ActionResponse } from '@/interfaces';
import {
  comparePassword,
  hashPassword,
  validateEmail,
  normalizeEmail,
  createSession,
  AuthError,
} from '@/lib/auth';

// Configuración
const COOKIE_NAME = 'auth-token';
const COOKIE_MAX_AGE = 7 * 24 * 60 * 60; // 7 días en segundos
const MAX_LOGIN_ATTEMPTS = 5;
const LOCK_DURATION_MINUTES = 15;

interface LoginFormData {
  email: string;
  password: string;
  rememberMe?: boolean;
}

/**
 * Autentica un usuario en el sistema
 *
 * @param formData - Datos del formulario de login
 * @returns ActionResponse con el usuario autenticado o error
 *
 * @example
 * const result = await loginUser(formData);
 * if (result.status === 200) {
 *   // Login exitoso
 *   redirect('/dashboard');
 * }
 */
// Vista compuesta user + tenancy del membership ACTIVO (D3.3)
interface UserData {
  id: string;
  name: string;
  email: string;
  role: string | null;
  organizationId: string | null;
  storeId: string | null;
  isActive: boolean;
  emailVerified: boolean;
  loginAttempts: number;
  passwordChangedAt: Date | null;
  createdAt: Date;
  organization: {
    id: string;
    name: string;
    isActive: boolean;
  } | null;
  store: {
    id: string;
    name: string;
    isActive: boolean;
  } | null;
}

interface LoginResponse {
  user?: UserData;
  sessionId?: string;
  attemptsRemaining?: number;
  lockedUntil?: Date;
  minutesRemaining?: number;
  redirectTo?: string;
}

export async function loginUser(
  formData: FormData
): Promise<ActionResponse<LoginResponse>> {
  try {
    // 1. Extraer y validar credenciales
    const data: LoginFormData = {
      email: formData.get('email') as string,
      password: formData.get('password') as string,
      rememberMe: formData.get('rememberMe') === 'true',
    };

    // Validar campos requeridos
    if (!data.email || !data.password) {
      return {
        status: 400,
        message: 'El correo electrónico y la contraseña son requeridos',
        data: null,
      };
    }

    // Validar formato de email
    try {
      validateEmail(data.email);
    } catch (error) {
      if (error instanceof AuthError) {
        return {
          status: 400,
          message: 'Formato de correo electrónico inválido',
          data: null,
        };
      }
      throw error;
    }

    // Normalizar email
    const normalizedEmail = normalizeEmail(data.email);

    // 2. Buscar usuario por email (isDeleted: false) con su membership ACTIVO
    //    (D3.3: la tenancy — org, store, role — vive en memberships)
    const user = await prisma.user.findFirst({
      where: {
        email: normalizedEmail,
        isDeleted: false,
      },
      select: {
        id: true,
        name: true,
        email: true,
        passwordHash: true,
        isActive: true,
        emailVerified: true,
        loginAttempts: true,
        lockedUntil: true,
        passwordChangedAt: true,
        createdAt: true,
        memberships: {
          where: { deletedAt: null, status: 'ACTIVE' },
          orderBy: { createdAt: 'asc' },
          take: 1,
          select: {
            role: true,
            organizationId: true,
            defaultStoreId: true,
            organization: {
              select: { id: true, name: true, isActive: true },
            },
            defaultStore: {
              select: { id: true, name: true, isActive: true },
            },
          },
        },
      },
    });

    if (!user) {
      return {
        status: 401,
        message: 'Correo electrónico o contraseña inválidos',
        data: null,
      };
    }

    // 3. Verificar que el usuario esté activo
    if (!user.isActive) {
      return {
        status: 403,
        message: 'Su cuenta ha sido desactivada. Por favor contacte a soporte',
        data: null,
      };
    }

    // Verificar si la cuenta está bloqueada
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      const minutesRemaining = Math.ceil(
        (user.lockedUntil.getTime() - Date.now()) / (1000 * 60)
      );

      return {
        status: 423,
        message: `Cuenta bloqueada por demasiados intentos fallidos de inicio de sesión. Intente nuevamente en ${minutesRemaining} minutos`,
        data: {
          lockedUntil: user.lockedUntil,
          minutesRemaining,
        },
      };
    }

    // Si el bloqueo expiró, resetear intentos
    if (user.lockedUntil && user.lockedUntil <= new Date()) {
      await prisma.user.update({
        where: { id: user.id },
        data: {
          loginAttempts: 0,
          lockedUntil: null,
        },
      });
    }

    // 4. Comparar password con bcrypt (passwordHash es nullable — D3.6:
    //    usuario solo-OAuth no tiene password local)
    if (!user.passwordHash) {
      return {
        status: 401,
        message: 'Correo electrónico o contraseña inválidos',
        data: null,
      };
    }
    const passwordResult = await comparePassword(data.password, user.passwordHash);

    if (!passwordResult.isValid) {
      // Incrementar intentos fallidos
      const newLoginAttempts = user.loginAttempts + 1;
      const shouldLock = newLoginAttempts >= MAX_LOGIN_ATTEMPTS;

      await prisma.user.update({
        where: { id: user.id },
        data: {
          loginAttempts: newLoginAttempts,
          lockedUntil: shouldLock
            ? new Date(Date.now() + LOCK_DURATION_MINUTES * 60 * 1000)
            : null,
        },
      });

      if (shouldLock) {
        return {
          status: 423,
          message: `Cuenta bloqueada por demasiados intentos fallidos de inicio de sesión. Intente nuevamente en ${LOCK_DURATION_MINUTES} minutos`,
          data: {
            attemptsRemaining: 0,
          },
        };
      }

      return {
        status: 401,
        message: 'Correo electrónico o contraseña inválidos',
        data: {
          attemptsRemaining: MAX_LOGIN_ATTEMPTS - newLoginAttempts,
        },
      };
    }

    // Verificar si el password necesita rehash (salt rounds antiguos)
    if (passwordResult.needsRehash) {
      const newHash = await hashPassword(data.password, { saltRounds: 12 });
      await prisma.user.update({
        where: { id: user.id },
        data: {
          passwordHash: newHash,
          passwordChangedAt: new Date(),
        },
      });
    }

    // Tenancy efectiva: membership ACTIVO (si no hay, el usuario va a onboarding)
    const membership = user.memberships[0] ?? null;

    // Verificar organización activa (si aplica)
    if (membership && !membership.organization.isActive) {
      return {
        status: 403,
        message:
          'Su organización ha sido desactivada. Por favor contacte a soporte',
        data: null,
      };
    }

    // Verificar tienda activa (si aplica)
    if (membership?.defaultStore && !membership.defaultStore.isActive) {
      return {
        status: 403,
        message:
          'Su tienda ha sido desactivada. Por favor contacte a su administrador',
        data: null,
      };
    }

    // 5. Crear sesión y generar JWT
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
      expirationDays: data.rememberMe ? 30 : 7, // 30 días si "remember me"
    });

    const hasHTTPS = process.env.HTTPS_ENABLED === 'true';

    // 6. Set cookie con token (httpOnly, secure, sameSite)
    const cookieStore = await cookies();
    cookieStore.set(COOKIE_NAME, session.token, {
      httpOnly: true,
      secure: hasHTTPS,
      sameSite: 'lax',
      maxAge: data.rememberMe ? 30 * 24 * 60 * 60 : COOKIE_MAX_AGE,
      path: '/',
    });

    const redirectUrl = membership ? '/dashboard' : '/onboarding';

    // 7. Return success con redirect URL — vista compuesta (sin passwordHash)
    const userData: UserData = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: membership?.role ?? null,
      organizationId: membership?.organizationId ?? null,
      storeId: membership?.defaultStoreId ?? null,
      isActive: user.isActive,
      emailVerified: user.emailVerified,
      loginAttempts: user.loginAttempts,
      passwordChangedAt: user.passwordChangedAt,
      createdAt: user.createdAt,
      organization: membership?.organization ?? null,
      store: membership?.defaultStore ?? null,
    };

    return {
      status: 200,
      message: 'Inicio de sesión exitoso',
      data: {
        user: userData,
        sessionId: session.id,
        redirectTo: redirectUrl,
      },
    };
  } catch (error) {
    // Log completo del error incluyendo originalError si existe
    if (error instanceof AuthError) {
      console.error('Login error:', error.message);
      console.error('Error code:', error.code);

      // Type guard para verificar si details tiene originalError
      if (error.details && typeof error.details === 'object' && 'originalError' in error.details) {
        console.error('Original error:', error.details.originalError);
      } else if (error.details) {
        console.error('Error details:', error.details);
      }

      return {
        status: 400,
        message: error.message,
        data: error.details || null,
      };
    }

    // Log genérico para errores no-AuthError
    console.error('Login error:', error);

    return {
      status: 500,
      message: 'Error al iniciar sesión. Por favor intente más tarde',
      data: null,
    };
  }
}

// Importar headers dinámicamente
async function headers() {
  const { headers } = await import('next/headers');
  return headers();
}
