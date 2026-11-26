'use server';

/**
 * ============================================
 * LOGOUT USER ACTION
 * ============================================
 *
 * Cierra la sesión actual: Better Auth borra la fila de `sessions` y la cookie
 * (plugin nextCookies). La siguiente acción con esa cookie es "no autenticado".
 */

import { headers } from 'next/headers';
import { ActionResponse } from '@/interfaces';
import { auth } from '@/lib/auth/better-auth';

export async function logoutUser(): Promise<ActionResponse> {
  try {
    await auth.api.signOut({ headers: await headers() });
    return { status: 200, message: 'Cierre de sesión exitoso', data: null };
  } catch (error) {
    console.error('Logout error:', error);
    return { status: 500, message: 'Error al cerrar sesión. Por favor intente nuevamente', data: null };
  }
}
