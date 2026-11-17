import { getStorage, isValidKey } from '@/lib/storage';

export const runtime = 'nodejs';

// Keys are random UUIDs and never overwritten, so responses are immutable.
const CACHE_CONTROL = 'public, max-age=31536000, immutable';

export async function GET(request: Request, { params }: { params: Promise<{ key: string[] }> }) {
  const { key: parts } = await params;
  const key = parts.join('/');
  if (!isValidKey(key)) return new Response('Not found', { status: 404 });

  const object = await getStorage().get(key);
  if (!object) return new Response('Not found', { status: 404 });

  const etag = `"${key}"`;
  if (request.headers.get('if-none-match') === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag, 'Cache-Control': CACHE_CONTROL } });
  }

  return new Response(new Uint8Array(object.data), {
    headers: {
      'Content-Type': object.contentType,
      'Content-Length': String(object.data.length),
      'Cache-Control': CACHE_CONTROL,
      ETag: etag,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'",
    },
  });
}
