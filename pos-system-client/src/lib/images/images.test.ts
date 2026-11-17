import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { LocalDiskStorage } from '../storage/local-disk-storage';
import { isValidKey, productImageKey, type StorageProvider, type StoredObject } from '../storage/storage-provider';
import { detectImageType, MAX_IMAGE_DIMENSION, TARGET_OUTPUT_BYTES } from './product-image';
import { handleProductImageUpload, type UploadAccess } from './upload-product-image';
import { deleteOrgProductImage, isOrgProductImageUrl } from './product-image-refs';

const ORG_A = '0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';
const ORG_B = '0193a1b2-c3d4-7e5f-8a9b-ffffffffffff';

class MemoryStorage implements StorageProvider {
  objects = new Map<string, StoredObject>();
  async put(key: string, data: Buffer, contentType: string) {
    this.objects.set(key, { data, contentType });
  }
  async get(key: string) {
    return this.objects.get(key) ?? null;
  }
  async delete(key: string) {
    this.objects.delete(key);
  }
  url(key: string) {
    return `/api/images/${key}`;
  }
  keyFromUrl(url: string) {
    const key = url.startsWith('/api/images/') ? url.slice('/api/images/'.length) : '';
    return isValidKey(key) ? key : null;
  }
}

const admin = async (): Promise<UploadAccess> => ({ actor: { organizationId: ORG_A, role: 'ADMIN' } });

// Serialized multipart body + headers, like a browser sends it.
async function multipart(data: Uint8Array, name = 'foto.jpg', type = 'image/jpeg') {
  const form = new FormData();
  form.append('file', new File([new Uint8Array(data)], name, { type }));
  const encoded = new Response(form);
  return { body: new Uint8Array(await encoded.arrayBuffer()), contentType: encoded.headers.get('content-type') ?? '' };
}

async function uploadRequest(data: Uint8Array, name = 'foto.jpg', type = 'image/jpeg'): Promise<Request> {
  const { body, contentType } = await multipart(data, name, type);
  return new Request('http://localhost/api/images', {
    method: 'POST',
    headers: { 'content-type': contentType, 'content-length': String(body.length) },
    body,
  });
}

// Photo-like image (gradients + grain) so compression has real work to do.
async function noisyPng(width: number, height: number, grain = 24): Promise<Buffer> {
  const raw = Buffer.alloc(width * height * 3);
  let seed = 42;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const n = (seed % (grain * 2 + 1)) - grain;
      const i = (y * width + x) * 3;
      raw[i] = Math.max(0, Math.min(255, (x * 255) / width + n));
      raw[i + 1] = Math.max(0, Math.min(255, (y * 255) / height + n));
      raw[i + 2] = Math.max(0, Math.min(255, 128 + 100 * Math.sin(x / 40) * Math.cos(y / 60) + n));
    }
  }
  return sharp(raw, { raw: { width, height, channels: 3 } }).png({ compressionLevel: 1 }).toBuffer();
}

test('detectImageType usa magic bytes, no extensión', async () => {
  const jpeg = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#f00' } }).jpeg().toBuffer();
  const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#0f0' } }).png().toBuffer();
  const webp = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#00f' } }).webp().toBuffer();
  const gif = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#00f' } }).gif().toBuffer();
  assert.equal(detectImageType(jpeg), 'jpeg');
  assert.equal(detectImageType(png), 'png');
  assert.equal(detectImageType(webp), 'webp');
  assert.equal(detectImageType(gif), null);
  assert.equal(detectImageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), null);
  assert.equal(detectImageType(Buffer.from('hola')), null);
});

test('SELLER o sin sesión no pueden subir; no se escribe nada', async () => {
  const storage = new MemoryStorage();
  const png = await noisyPng(10, 10);
  const seller = async (): Promise<UploadAccess> => ({ actor: { organizationId: ORG_A, role: 'SELLER' } });
  const forbidden = async (): Promise<UploadAccess> => ({ status: 403 });
  const anonymous = async (): Promise<UploadAccess> => ({ status: 401 });
  assert.equal((await handleProductImageUpload(await uploadRequest(png), { getActor: seller, storage })).status, 403);
  assert.equal((await handleProductImageUpload(await uploadRequest(png), { getActor: forbidden, storage })).status, 403);
  assert.equal((await handleProductImageUpload(await uploadRequest(png), { getActor: anonymous, storage })).status, 401);
  assert.equal(storage.objects.size, 0);
});

test('archivo mayor del límite → 413', async () => {
  const storage = new MemoryStorage();
  const big = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(2048)]);
  const result = await handleProductImageUpload(await uploadRequest(big), { getActor: admin, storage, maxBytes: 1024 });
  assert.equal(result.status, 413);

  const declared = new Request('http://localhost/api/images', {
    method: 'POST',
    headers: { 'content-length': String(50 * 1024 * 1024), 'content-type': 'multipart/form-data; boundary=x' },
    body: 'x',
  });
  assert.equal((await handleProductImageUpload(declared, { getActor: admin, storage, maxBytes: 1024 })).status, 413);
  assert.equal(storage.objects.size, 0);
});

test('sin Content-Length → 411; Content-Length falso no evita el tope de lectura → 413', async () => {
  const storage = new MemoryStorage();
  const png = await noisyPng(10, 10);
  const { body, contentType } = await multipart(png);

  const chunked = new Request('http://localhost/api/images', { method: 'POST', headers: { 'content-type': contentType }, body });
  assert.equal(chunked.headers.get('content-length'), null);
  assert.equal((await handleProductImageUpload(chunked, { getActor: admin, storage })).status, 411);

  const big = await multipart(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(200 * 1024)]));
  const lying = new Request('http://localhost/api/images', {
    method: 'POST',
    headers: { 'content-type': big.contentType, 'content-length': '100' },
    body: big.body,
  });
  assert.equal((await handleProductImageUpload(lying, { getActor: admin, storage, maxBytes: 1024 })).status, 413);
  assert.equal(storage.objects.size, 0);
});

test('tipo no permitido (SVG o texto disfrazado de .jpg) → 415', async () => {
  const storage = new MemoryStorage();
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  assert.equal((await handleProductImageUpload(await uploadRequest(svg, 'x.svg', 'image/svg+xml'), { getActor: admin, storage })).status, 415);
  assert.equal((await handleProductImageUpload(await uploadRequest(svg, 'foto.jpg', 'image/jpeg'), { getActor: admin, storage })).status, 415);
  // Magic bytes válidos pero contenido corrupto
  const fakeJpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(100, 1)]);
  assert.equal((await handleProductImageUpload(await uploadRequest(fakeJpeg), { getActor: admin, storage })).status, 422);
  assert.equal(storage.objects.size, 0);
});

test('imagen válida queda en WebP, ≤1600 px, bajo el tamaño objetivo y con prefijo de organización', async () => {
  const storage = new MemoryStorage();
  // Phone-like photo: 3000x2000 JPEG with EXIF metadata, under the 5 MB limit.
  const input = await sharp(await noisyPng(3000, 2000)).jpeg({ quality: 90 }).withMetadata({ exif: { IFD0: { Copyright: 'test' } } }).toBuffer();
  assert.ok(input.length < 5 * 1024 * 1024, `input ${input.length}`);
  const result = await handleProductImageUpload(await uploadRequest(input), { getActor: admin, storage });
  assert.equal(result.status, 201);
  assert.match(result.body.url ?? '', new RegExp(`^/api/images/${ORG_A}/products/[0-9a-f-]{36}\\.webp$`));

  const [key, stored] = [...storage.objects.entries()][0];
  assert.ok(key.startsWith(`${ORG_A}/products/`));
  assert.equal(stored.contentType, 'image/webp');
  assert.equal(detectImageType(stored.data), 'webp');
  assert.ok(stored.data.length <= TARGET_OUTPUT_BYTES, `size ${stored.data.length}`);
  const meta = await sharp(stored.data).metadata();
  assert.equal(meta.format, 'webp');
  assert.ok((meta.width ?? 0) <= MAX_IMAGE_DIMENSION && (meta.width ?? 0) >= 800);
  assert.ok((meta.height ?? 0) <= MAX_IMAGE_DIMENSION);
  assert.equal(meta.exif, undefined, 'sin metadatos');
});

test('ruido extremo también termina bajo el tamaño objetivo (reduce calidad y dimensión)', async () => {
  const storage = new MemoryStorage();
  const input = await noisyPng(2000, 1500, 127);
  const result = await handleProductImageUpload(await uploadRequest(input, 'ruido.png', 'image/png'), { getActor: admin, storage, maxBytes: 20 * 1024 * 1024 });
  assert.equal(result.status, 201);
  const stored = [...storage.objects.values()][0];
  assert.ok(stored.data.length <= TARGET_OUTPUT_BYTES, `size ${stored.data.length}`);
});

test('claves: rechaza path traversal y formatos no esperados', () => {
  for (const bad of ['../x.webp', 'a/../b.webp', '/etc/passwd', 'a/..%2fb.webp', 'a\\b.webp', 'a/b.png', 'a/.b.webp', 'x.webp', '']) {
    assert.equal(isValidKey(bad), false, bad);
  }
  assert.equal(isValidKey(`${ORG_A}/products/abc.webp`), true);
  assert.throws(() => productImageKey('../etc', 'x'));
});

test('LocalDiskStorage: put/get/delete dentro de UPLOADS_DIR y sin traversal', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'pos-uploads-'));
  try {
    const storage = new LocalDiskStorage(dir);
    const key = productImageKey(ORG_A, 'img1');
    await storage.put(key, Buffer.from('data'), 'image/webp');
    assert.deepEqual(await readdir(path.join(dir, ORG_A, 'products')), ['img1.webp']);
    const got = await storage.get(key);
    assert.equal(got?.data.toString(), 'data');
    assert.equal(got?.contentType, 'image/webp');
    assert.equal(storage.url(key), `/api/images/${key}`);
    assert.equal(storage.keyFromUrl(storage.url(key)), key);
    assert.equal(storage.keyFromUrl('https://utfs.io/f/abc'), null);
    assert.equal(storage.keyFromUrl('/api/images/../../etc/passwd'), null);
    await assert.rejects(storage.get('../outside.webp'));
    await assert.rejects(storage.put('a/../../outside.webp', Buffer.from('x'), 'image/webp'));
    await storage.delete(key);
    assert.equal(await storage.get(key), null);
    await storage.delete(key); // idempotente
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('referencias: un producto solo usa y borra imágenes de su organización', async () => {
  const storage = new MemoryStorage();
  const keyA = productImageKey(ORG_A, 'a1');
  const keyB = productImageKey(ORG_B, 'b1');
  await storage.put(keyA, Buffer.from('a'), 'image/webp');
  await storage.put(keyB, Buffer.from('b'), 'image/webp');

  assert.equal(isOrgProductImageUrl(null, ORG_A, storage), true);
  assert.equal(isOrgProductImageUrl(storage.url(keyA), ORG_A, storage), true);
  assert.equal(isOrgProductImageUrl(storage.url(keyB), ORG_A, storage), false);
  assert.equal(isOrgProductImageUrl('https://evil.example/x.webp', ORG_A, storage), false);

  await deleteOrgProductImage(storage.url(keyB), ORG_A, storage);
  assert.ok(storage.objects.has(keyB), 'no borra imágenes de otra organización');
  await deleteOrgProductImage(storage.url(keyA), ORG_A, storage);
  assert.ok(!storage.objects.has(keyA));
});

test('producto sin imagen no necesita el storage (producción sin UPLOADS_DIR)', async () => {
  const env = process.env as Record<string, string | undefined>;
  const saved = { NODE_ENV: env.NODE_ENV, UPLOADS_DIR: env.UPLOADS_DIR };
  env.NODE_ENV = 'production';
  delete env.UPLOADS_DIR;
  try {
    assert.equal(isOrgProductImageUrl(null, ORG_A), true);
    assert.equal(isOrgProductImageUrl(undefined, ORG_A), true);
    await deleteOrgProductImage(null, ORG_A);
    // Con imagen sí se necesita: la configuración sigue siendo obligatoria.
    assert.throws(() => isOrgProductImageUrl('/api/images/x.webp', ORG_A), /UPLOADS_DIR is required/);
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete env[name];
      else env[name] = value;
    }
  }
});
