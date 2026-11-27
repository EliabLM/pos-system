import { RegisterForm } from './register-form';
import { isInvitationId } from '@/lib/auth/invitation-link';

const RegisterPage = async ({
  searchParams,
}: {
  searchParams: Promise<{ invitacion?: string | string[] }>;
}) => {
  const { invitacion } = await searchParams;
  return (
    <div className="bg-muted flex min-h-svh flex-col items-center justify-center gap-6 p-6 md:p-10">
      <RegisterForm invitationId={isInvitationId(invitacion) ? invitacion : null} />
    </div>
  );
};

export default RegisterPage;
