import { redirect } from 'next/navigation';
import { ActorError, blockedMembershipReason, getActor, requireOnboardingUser } from '@/lib/auth/actor';

/**
 * Onboarding solo para usuarios con sesión y SIN ninguna membresía. Quien ya
 * pertenece a una organización activa va al dashboard; quien pertenece a una
 * desactivada, o tiene la membresía suspendida (#20), no puede crear otra: va
 * al login con su motivo. Sin sesión, al login.
 */
async function onboardingRedirect(): Promise<string | null> {
  try {
    await getActor();
    return '/dashboard';
  } catch (error) {
    if (!(error instanceof ActorError)) throw error;
    if (error.code === 'UNAUTHENTICATED') return '/auth/login';
  }
  try {
    await requireOnboardingUser();
    return null;
  } catch (error) {
    if (error instanceof ActorError && error.code === 'FORBIDDEN') {
      return `/auth/login?motivo=${await blockedMembershipReason()}`;
    }
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
