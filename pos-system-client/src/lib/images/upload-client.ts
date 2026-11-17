/** Browser helper: uploads a product image and returns its public URL. */
export async function uploadProductImageFile(file: File): Promise<string> {
  const body = new FormData();
  body.append('file', file);
  const response = await fetch('/api/images', { method: 'POST', body, credentials: 'same-origin' });
  const json = (await response.json().catch(() => null)) as { message?: string; url?: string } | null;
  if (!response.ok || !json?.url) {
    throw new Error(json?.message ?? 'No se pudo subir la imagen');
  }
  return json.url;
}
