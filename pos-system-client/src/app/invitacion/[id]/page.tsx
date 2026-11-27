import Link from 'next/link';
import { headers } from 'next/headers';
import { auth } from '@/lib/auth/better-auth';
import { getInvitationLinkView } from '@/lib/auth/invitation-view';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { AcceptInvitation, SignOutAndRetry } from './accept-invitation';

/**
 * Invitation link (#20). Public route: the invitee may not have an account.
 * Without a session: sign in or register with the invited e-mail and come
 * back here. With the invited e-mail: accept. With another e-mail: sign out.
 */
export default async function InvitationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const invitation = await getInvitationLinkView(id);
  const session = invitation ? await auth.api.getSession({ headers: await headers() }) : null;
  const sessionEmail = session?.user.email.toLowerCase() ?? null;

  return (
    <div className="bg-muted flex min-h-svh flex-col items-center justify-center p-6 md:p-10">
      <Card className="w-full max-w-md">
        {!invitation ? (
          <CardHeader className="text-center">
            <CardTitle className="text-xl">Esta invitación ya no es válida</CardTitle>
            <CardDescription>
              Venció, fue revocada o ya se usó. Pide al administrador de la tienda un enlace nuevo.
            </CardDescription>
          </CardHeader>
        ) : (
          <>
            <CardHeader className="text-center">
              <CardTitle className="text-xl">Te invitaron a {invitation.organizationName}</CardTitle>
              <CardDescription>
                Entrarás como vendedor con el correo <strong>{invitation.email}</strong>.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {!sessionEmail && (
                <>
                  <p className="text-sm text-muted-foreground">
                    Para aceptar, entra o crea tu cuenta con ese correo.
                  </p>
                  <Button asChild>
                    <Link href={`/auth/register?invitacion=${invitation.id}`}>Crear mi cuenta</Link>
                  </Button>
                  <Button asChild variant="outline">
                    <Link href={`/auth/login?invitacion=${invitation.id}`}>Ya tengo cuenta</Link>
                  </Button>
                </>
              )}
              {sessionEmail === invitation.email && <AcceptInvitation invitationId={invitation.id} />}
              {sessionEmail && sessionEmail !== invitation.email && (
                <>
                  <p role="alert" className="text-sm">
                    Iniciaste sesión como <strong>{sessionEmail}</strong>. Esta invitación es para{' '}
                    <strong>{invitation.email}</strong>.
                  </p>
                  <SignOutAndRetry invitationId={invitation.id} />
                </>
              )}
            </CardContent>
          </>
        )}
      </Card>
    </div>
  );
}
