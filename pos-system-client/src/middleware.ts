import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getSessionCookie } from 'better-auth/cookies';

/**
 * Optimistic check only (#19): is there a Better Auth session cookie? It does
 * not touch the database nor read roles. The real checks run on the server:
 * dashboard/onboarding layouts redirect by membership and role, and every
 * server action and route handler calls getActor()/requireActor().
 */

/** Everything else needs the cookie (as before #19). */
/** /invitacion/<id>: the invitee may not have an account yet (#20). */
const PUBLIC_ROUTES = ['/auth/login', '/auth/register', '/api/auth/', '/invitacion/'];

const isPublicRoute = (pathname: string) => PUBLIC_ROUTES.some((route) => pathname.startsWith(route));

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isPublicRoute(pathname)) {
    return NextResponse.next();
  }

  if (!getSessionCookie(request)) {
    const loginUrl = new URL('/auth/login', request.url);
    loginUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // No x-user-* headers: identity comes from getActor() on the server.
  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder files
     * - product images (GET /api/images/<key>.webp): public by URL so the
     *   next/image optimizer can fetch them without the user's cookie.
     *   See docs/deployment/imagenes-producto.md.
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js)$).*)',
  ],
};
