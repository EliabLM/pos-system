import { redirect } from 'next/navigation';
import { ActorError, getActor } from '@/lib/auth/actor';

/**
 * Onboarding solo para usuarios con sesión y SIN membresía activa
 * (getActor() → FORBIDDEN). Quien ya pertenece a una organización va al
 * dashboard; sin sesión, al login.
 */
async function onboardingRedirect(): Promise<string | null> {
  try {
    await getActor();
    return '/dashboard';
  } catch (error) {
    if (error instanceof ActorError && error.code === 'FORBIDDEN') return null;
    if (error instanceof ActorError) return '/auth/login';
    throw error;
  }
}

export default async function OnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const target = await onboardingRedirect();
  if (target) redirect(target);

  return <>{children}</>;
}
