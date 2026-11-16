import { randomUUID } from 'node:crypto';
import { productImageKey, type StorageProvider } from '@/lib/storage/storage-provider';
import { detectImageType, maxUploadBytes, processProductImage } from './product-image';

/** Minimal actor shape needed to authorize an upload. */
export type UploadActor = { organizationId: string; role: string };
export type UploadAccess = { actor: UploadActor; status?: never } | { actor?: never; status: 401 | 403 | 500 };

export type UploadDeps = {
  getActor: () => Promise<UploadAccess>;
  storage: StorageProvider;
  maxBytes?: number;
};

export type UploadResult = { status: number; body: { message: string; url?: string } };

// multipart framing overhead allowed on top of the file size limit
const MULTIPART_OVERHEAD = 64 * 1024;

const fail = (status: number, message: string): UploadResult => ({ status, body: { message } });

/**
 * Handles a multipart upload with a single `file` field. Only ADMIN members
 * can upload; the stored key is generated here and prefixed by the actor's
 * organization, so the client never chooses a path.
 */
export async function handleProductImageUpload(request: Request, deps: UploadDeps): Promise<UploadResult> {
  const access = await deps.getActor();
  if (access.status) {
    return fail(access.status, access.status === 401 ? 'No autenticado' : access.status === 403 ? 'Acción no autorizada' : 'Error interno del servidor');
  }
  if (access.actor.role !== 'ADMIN') return fail(403, 'Acción no autorizada');

  const maxBytes = deps.maxBytes ?? maxUploadBytes();
  const tooLarge = () => fail(413, `La imagen supera el máximo de ${Math.round(maxBytes / 1024 / 1024)} MB`);

  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes + MULTIPART_OVERHEAD) return tooLarge();

  let file: FormDataEntryValue | null;
  try {
    file = (await request.formData()).get('file');
  } catch {
    return fail(400, 'Solicitud inválida');
  }
  if (!file || typeof file === 'string') return fail(400, 'Falta el archivo');
  if (file.size > maxBytes) return tooLarge();

  const input = Buffer.from(await file.arrayBuffer());
  if (input.length > maxBytes) return tooLarge();
  if (!detectImageType(input)) return fail(415, 'Formato no permitido. Usa JPG, PNG o WebP');

  let output: Buffer;
  try {
    output = await processProductImage(input);
  } catch {
    return fail(422, 'No se pudo procesar la imagen');
  }

  const key = productImageKey(access.actor.organizationId, randomUUID());
  try {
    await deps.storage.put(key, output, 'image/webp');
  } catch (error) {
    console.error('Error storing product image:', error);
    return fail(500, 'Error interno del servidor');
  }
  return { status: 201, body: { message: 'Imagen subida', url: deps.storage.url(key) } };
}
