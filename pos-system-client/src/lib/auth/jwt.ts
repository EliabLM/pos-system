/**
 * ============================================
 * JWT UTILITIES - TOKEN GENERATION & VERIFICATION
 * ============================================
 *
 * Utilidades para crear y verificar JSON Web Tokens
 * Usa jose (la misma librería que el middleware en Edge Runtime) para
 * Server Actions y API Routes.
 */

import { SignJWT, decodeJwt, errors as joseErrors, jwtVerify } from 'jose';
import { AuthError, AuthErrorCode, type JWTPayload, type TokenGenerationOptions, type VerifyTokenResult } from './types';

// Configuración
const DEFAULT_EXPIRATION = '7d'; // 7 días
const DEFAULT_ALGORITHM = 'HS256';
const ALLOWED_ALGORITHMS = ['HS256', 'HS384', 'HS512'];

/**
 * Obtiene el JWT secret desde las variables de entorno
 * @throws {AuthError} Si JWT_SECRET no está definido
 */
function getJWTSecret(): string {
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    throw new AuthError(
      AuthErrorCode.INTERNAL_ERROR,
      'JWT_SECRET no está definido en las variables de entorno'
    );
  }

  if (secret.length < 32) {
    throw new AuthError(
      AuthErrorCode.INTERNAL_ERROR,
      'JWT_SECRET debe tener al menos 32 caracteres',
      { length: secret.length }
    );
  }

  return secret;
}

/** Clave HMAC en el formato que espera jose */
function getSecretKey(): Uint8Array {
  return new TextEncoder().encode(getJWTSecret());
}

/**
 * Convierte expiresIn al formato de jose. Igual que jsonwebtoken, un número
 * son segundos desde ahora (en jose un número es un timestamp absoluto).
 */
function toJoseExpiration(expiresIn: string | number): string | number {
  return typeof expiresIn === 'number'
    ? Math.floor(Date.now() / 1000) + expiresIn
    : expiresIn;
}

/**
 * Genera un JWT token
 *
 * @param payload - Datos a incluir en el token
 * @param options - Opciones de generación (expiresIn, algorithm)
 * @returns JWT token firmado
 * @throws {AuthError} Si el payload es inválido o falta JWT_SECRET
 *
 * @example
 * const token = await generateToken({
 *   userId: user.id,
 *   email: user.email,
 *   role: user.role,
 *   organizationId: user.organizationId,
 *   storeId: user.storeId
 * });
 */
export async function generateToken(
  payload: Omit<JWTPayload, 'iat' | 'exp'>,
  options: TokenGenerationOptions = {}
): Promise<string> {
  try {
    // Validar payload
    if (!payload.userId || !payload.email) {
      throw new AuthError(
        AuthErrorCode.INVALID_TOKEN,
        'El payload del token debe incluir userId y email',
        { payload }
      );
    }

    const secret = getSecretKey();
    const expiresIn = options.expiresIn ?? DEFAULT_EXPIRATION;
    const algorithm = options.algorithm ?? DEFAULT_ALGORITHM;

    const token = await new SignJWT({ ...payload })
      .setProtectedHeader({ alg: algorithm, typ: 'JWT' })
      .setIssuedAt()
      .setExpirationTime(toJoseExpiration(expiresIn))
      .sign(secret);

    return token;
  } catch (error) {
    if (error instanceof AuthError) {
      throw error;
    }

    throw new AuthError(
      AuthErrorCode.INTERNAL_ERROR,
      'Error al generar token',
      { originalError: error }
    );
  }
}

/**
 * Verifica y decodifica un JWT token
 *
 * @param token - JWT token a verificar
 * @returns Payload decodificado o null si es inválido
 * @throws {AuthError} Si el token es malformado o ha expirado
 *
 * @example
 * const payload = await verifyToken(token);
 * if (payload) {
 *   // Token válido, usar payload
 *   console.log(payload.userId);
 * }
 */
export async function verifyToken(token: string): Promise<JWTPayload | null> {
  try {
    if (!token || token.trim().length === 0) {
      throw new AuthError(
        AuthErrorCode.INVALID_TOKEN,
        'El token no puede estar vacío'
      );
    }

    const secret = getSecretKey();

    // Verificar token (firma, algoritmo HMAC permitido y expiración)
    const { payload: verified } = await jwtVerify(token, secret, {
      algorithms: ALLOWED_ALGORITHMS,
    });
    const decoded = verified as unknown as JWTPayload;

    // Validar que el payload tiene los campos requeridos
    if (!decoded.userId || !decoded.email) {
      throw new AuthError(
        AuthErrorCode.MALFORMED_TOKEN,
        'El payload del token está faltando campos requeridos',
        { decoded }
      );
    }

    return decoded;
  } catch (error) {
    if (error instanceof AuthError) {
      throw error;
    }

    // Errores específicos de jose
    if (error instanceof joseErrors.JWTExpired) {
      const exp = error.payload.exp;
      throw new AuthError(
        AuthErrorCode.EXPIRED_TOKEN,
        'El token ha expirado',
        { expiredAt: typeof exp === 'number' ? new Date(exp * 1000) : undefined }
      );
    }

    if (error instanceof joseErrors.JOSEError) {
      throw new AuthError(
        AuthErrorCode.INVALID_TOKEN,
        'El token es inválido',
        { message: error.message }
      );
    }

    throw new AuthError(
      AuthErrorCode.INTERNAL_ERROR,
      'Error al verificar token',
      { originalError: error }
    );
  }
}

/**
 * Verifica un token sin lanzar excepciones
 * Útil cuando quieres manejar el error de forma custom
 *
 * @param token - JWT token a verificar
 * @returns Objeto con payload y error (si aplica)
 *
 * @example
 * const result = await safeVerifyToken(token);
 * if (result.payload) {
 *   // Token válido
 * } else {
 *   console.error('Token error:', result.error);
 * }
 */
export async function safeVerifyToken(token: string): Promise<VerifyTokenResult> {
  try {
    const payload = await verifyToken(token);
    return { payload };
  } catch (error) {
    if (error instanceof AuthError) {
      return { payload: null, error };
    }

    return {
      payload: null,
      error: new AuthError(
        AuthErrorCode.INTERNAL_ERROR,
        'Error inesperado al verificar token',
        { originalError: error }
      ),
    };
  }
}

/**
 * Decodifica un token sin verificar la firma
 * SOLO PARA DEBUG - No usar en producción para autenticación
 *
 * @param token - JWT token a decodificar
 * @returns Payload decodificado (sin verificar)
 */
export function decodeToken(token: string): JWTPayload | null {
  try {
    return decodeJwt(token) as unknown as JWTPayload;
  } catch {
    return null;
  }
}

/**
 * Verifica si un token está expirado sin validar la firma
 *
 * @param token - JWT token a verificar
 * @returns true si el token está expirado
 */
export function isTokenExpired(token: string): boolean {
  try {
    const decoded = decodeJwt(token) as unknown as JWTPayload | null;

    if (!decoded || !decoded.exp) {
      return true;
    }

    const now = Math.floor(Date.now() / 1000);
    return decoded.exp < now;
  } catch {
    return true;
  }
}

/**
 * Obtiene el tiempo restante de un token en segundos
 *
 * @param token - JWT token
 * @returns Segundos restantes o 0 si está expirado
 */
export function getTokenRemainingTime(token: string): number {
  try {
    const decoded = decodeJwt(token) as unknown as JWTPayload | null;

    if (!decoded || !decoded.exp) {
      return 0;
    }

    const now = Math.floor(Date.now() / 1000);
    const remaining = decoded.exp - now;

    return Math.max(0, remaining);
  } catch {
    return 0;
  }
}

/**
 * Refresca un token si está cerca de expirar
 * Genera un nuevo token con el mismo payload pero nueva expiración
 *
 * @param token - Token actual
 * @param thresholdSeconds - Segundos antes de expiración para refrescar (default: 1 día)
 * @returns Nuevo token si fue refrescado, null si no es necesario
 *
 * @example
 * const newToken = await refreshTokenIfNeeded(oldToken);
 * if (newToken) {
 *   // Actualizar token en la sesión
 *   await updateSession(sessionId, newToken);
 * }
 */
export async function refreshTokenIfNeeded(
  token: string,
  thresholdSeconds: number = 86400 // 1 día
): Promise<string | null> {
  try {
    const remaining = getTokenRemainingTime(token);

    if (remaining > thresholdSeconds) {
      return null; // No necesita refresh
    }

    const payload = await verifyToken(token);

    if (!payload) {
      return null;
    }

    // Generar nuevo token con mismo payload
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { iat, exp, ...dataPayload } = payload;
    const newToken = await generateToken(dataPayload as Omit<JWTPayload, 'iat' | 'exp'>);

    return newToken;
  } catch {
    return null;
  }
}
