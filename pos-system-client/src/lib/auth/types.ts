/**
 * ============================================
 * AUTH TYPES (email and password validation)
 * ============================================
 *
 * Sessions, passwords and tokens are Better Auth's (#19). What remains here is
 * used by `validation.ts` (registration rules and the user module).
 */

export interface PasswordValidationResult {
  valid: boolean;
  errors: string[];
  strength?: 'weak' | 'medium' | 'strong' | 'very-strong';
}

export interface PasswordRequirements {
  minLength: number;
  requireUppercase: boolean;
  requireLowercase: boolean;
  requireNumber: boolean;
  requireSpecialChar: boolean;
}

export enum AuthErrorCode {
  WEAK_PASSWORD = 'WEAK_PASSWORD',
  PASSWORD_MISMATCH = 'PASSWORD_MISMATCH',
  INVALID_EMAIL = 'INVALID_EMAIL',
}

export class AuthError extends Error {
  constructor(
    public code: AuthErrorCode,
    message: string,
    public details?: unknown
  ) {
    super(message);
    this.name = 'AuthError';
    Object.setPrototypeOf(this, AuthError.prototype);
  }
}
