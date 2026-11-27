# Autenticación en el despliegue (Better Auth)

Desde #19 el client usa Better Auth. Esto es lo que hay que configurar y revisar al desplegarlo (Coolify, #24).

## Variables del client

| Variable | Obligatoria | Para qué |
| --- | --- | --- |
| `BETTER_AUTH_SECRET` | Sí en producción (32 caracteres o más) | Firma las cookies de sesión. Generar con `openssl rand -base64 48`. |
| `BETTER_AUTH_URL` | Sí en producción | Origen público de la app (`https://posagil.<dominio>`). Better Auth solo acepta peticiones de ese origen. |
| `HTTPS_ENABLED` | No | Déjala sin definir en producción: Better Auth marca la cookie `Secure` (y le pone el prefijo `__Secure-`) porque la URL es https. Solo `'false'` la quita, para local o CI por http. |

Sin `BETTER_AUTH_URL` o sin `BETTER_AUTH_SECRET`, el servidor no arranca en producción (`src/instrumentation.ts`). El build no las necesita.

## IP del cliente y límite de intentos

El login admite 5 intentos por minuto e IP. La IP sale de la primera cabecera válida de esta lista (`CLIENT_IP_HEADERS` en `src/lib/auth/auth-options.ts`):

1. `x-real-ip`: Traefik la pone con la IP de quien se conecta (un solo valor).
2. `x-forwarded-for`: solo si trae **una** IP. Si trae varias (`a, b`), Better Auth la descarta.

Si ninguna sirve, todos los clientes comparten un mismo contador y el log muestra "Rate limiting could not determine a client IP". Tras desplegar, comprobar que ese aviso no aparece.

Riesgos:

- El contenedor del client no debe quedar expuesto sin pasar por Traefik: sin proxy, el cliente puede inventar esas cabeceras y saltarse el límite.
- Con Cloudflare delante, Traefik vería la IP de Cloudflare: habría que leer `cf-connecting-ip` y configurar `trustedProxies`.
- El contador vive en la memoria del proceso: con varias instancias, cada una cuenta por su lado.

## Invitaciones (#20)

No hay servicio de correo: el ADMIN copia el enlace `<BETTER_AUTH_URL>/invitacion/<id>` desde Usuarios y lo envía por el canal que quiera. El enlace vence en 7 días y se puede revocar. Quien lo abre debe entrar o registrarse con el correo invitado; no se verifica el correo, así que el enlace es el secreto (UUIDv4 aleatorio): compártelo solo con la persona invitada. La ruta `/invitacion/` es pública en el middleware.
