import { redirect } from 'next/navigation';
import { ActorError, getActor, type Actor } from '@/lib/auth/actor';
import DashboardShell from './dashboard-shell';

/**
 * Dashboard only for users with a session AND an active membership: without
 * session → login; without membership → onboarding (it used to be decided by
 * the middleware from the JWT claims, #19).
 */
async function dashboardActor(): Promise<Actor> {
  try {
    return await getActor();
  } catch (error) {
    if (error instanceof ActorError && error.code === 'FORBIDDEN') redirect('/onboarding');
    if (error instanceof ActorError) redirect('/auth/login');
    throw error;
  }
}

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const actor = await dashboardActor();
  return <DashboardShell role={actor.role}>{children}</DashboardShell>;
}
