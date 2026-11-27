/**
 * Spanish messages for the errors the Better Auth client returns to the
 * login and register forms. Unknown account and wrong password share ONE
 * message (A11): the form never tells which one failed.
 */

export const INVALID_CREDENTIALS_MESSAGE = 'Correo electrónico o contraseña inválidos';
export const TOO_MANY_ATTEMPTS_MESSAGE = 'Demasiados intentos de inicio de sesión. Espera un minuto e inténtalo de nuevo';
export const USER_EXISTS_MESSAGE = 'Ya existe un usuario con este correo electrónico';
const GENERIC_MESSAGE = 'No se pudo completar la solicitud. Por favor intente más tarde';

export interface AuthClientError {
  status?: number;
  code?: string;
  message?: string;
}

const BY_CODE: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: INVALID_CREDENTIALS_MESSAGE,
  INVALID_EMAIL: INVALID_CREDENTIALS_MESSAGE,
  INVALID_PASSWORD: INVALID_CREDENTIALS_MESSAGE,
  USER_NOT_FOUND: INVALID_CREDENTIALS_MESSAGE,
  CREDENTIAL_ACCOUNT_NOT_FOUND: INVALID_CREDENTIALS_MESSAGE,
  USER_ALREADY_EXISTS: USER_EXISTS_MESSAGE,
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: USER_EXISTS_MESSAGE,
  PASSWORD_TOO_SHORT: 'La contraseña debe tener al menos 8 caracteres',
  PASSWORD_TOO_LONG: 'La contraseña es demasiado larga',
};

/** Better Auth's own messages are in English; ours (hooks) are in Spanish. */
const isOwnMessage = (message: string) => /[áéíóúñ¿¡]|^(El|La|Su|Ya|No) /.test(message);

export function authErrorMessage(error: AuthClientError | null | undefined): string {
  if (!error) return GENERIC_MESSAGE;
  if (error.status === 429) return TOO_MANY_ATTEMPTS_MESSAGE;
  if (error.status === 401) return INVALID_CREDENTIALS_MESSAGE;
  if (error.code && BY_CODE[error.code]) return BY_CODE[error.code];
  if (error.message && isOwnMessage(error.message)) return error.message;
  return GENERIC_MESSAGE;
}
