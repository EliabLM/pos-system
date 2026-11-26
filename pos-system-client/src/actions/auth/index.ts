/**
 * ============================================
 * AUTH ACTIONS - CENTRAL EXPORT
 * ============================================
 *
 * Login y registro van directo a Better Auth desde el navegador
 * (`authClient`, /api/auth/*): así aplica su límite de intentos.
 */

export { logoutUser } from './logout';
export { getCurrentUser } from './getCurrentUser';
