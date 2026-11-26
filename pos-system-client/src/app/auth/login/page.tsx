import { GalleryVerticalEnd } from 'lucide-react';

import { LoginForm } from './login-form';

const REASONS: Record<string, string> = {
  'organizacion-desactivada':
    'Tu organización está desactivada y no puedes usar el sistema. Contacta a soporte.',
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ motivo?: string | string[] }>;
}) {
  const { motivo } = await searchParams;
  const reason = typeof motivo === 'string' ? REASONS[motivo] : undefined;

  return (
    <div className="bg-muted flex min-h-svh flex-col items-center justify-center gap-6 p-6 md:p-10">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <a href="#" className="flex items-center gap-2 self-center font-medium">
          <div className="bg-primary text-primary-foreground flex size-6 items-center justify-center rounded-md">
            <GalleryVerticalEnd className="size-4" />
          </div>
          Sistema POS
        </a>
        {reason && (
          <p role="alert" className="border-destructive/50 text-destructive rounded-md border bg-background p-3 text-sm">
            {reason}
          </p>
        )}
        <LoginForm />
      </div>
    </div>
  );
}
