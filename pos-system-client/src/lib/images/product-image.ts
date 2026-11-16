import sharp from 'sharp';

// Small VPS (2 CPU, shared RAM): one libvips thread per image and no op cache.
sharp.concurrency(1);
sharp.cache(false);

export type DetectedImageType = 'jpeg' | 'png' | 'webp';

export const MAX_IMAGE_DIMENSION = 1600;
/** Upper bound for the stored WebP; quality is lowered until it fits. */
export const TARGET_OUTPUT_BYTES = 400 * 1024;
/** Reject decompression bombs before decoding (~40 megapixels). */
const MAX_INPUT_PIXELS = 40_000_000;
// (max dimension, quality) attempts, from best to smallest output.
const ENCODE_STEPS: ReadonlyArray<readonly [number, number]> = [
  [MAX_IMAGE_DIMENSION, 80],
  [MAX_IMAGE_DIMENSION, 60],
  [1200, 60],
  [800, 50],
];

const DEFAULT_MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/** Configurable input limit (`MAX_IMAGE_UPLOAD_MB`, default 5 MB). */
export function maxUploadBytes(): number {
  const mb = Number(process.env.MAX_IMAGE_UPLOAD_MB);
  return Number.isFinite(mb) && mb > 0 ? Math.floor(mb * 1024 * 1024) : DEFAULT_MAX_UPLOAD_BYTES;
}

/**
 * Detects the real file type from its magic bytes, ignoring the name and the
 * client-provided MIME type. SVG, GIF, HEIC, etc. return `null`.
 */
export function detectImageType(buf: Uint8Array): DetectedImageType | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
  ) return 'png';
  if (
    buf.length >= 12 &&
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 && // RIFF
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50 // WEBP
  ) return 'webp';
  return null;
}

/**
 * Normalizes an uploaded image: applies EXIF orientation, strips metadata,
 * fits it within MAX_IMAGE_DIMENSION and re-encodes to WebP under
 * TARGET_OUTPUT_BYTES (lowering quality, then size, if needed). Throws if the bytes are not a decodable image.
 */
export async function processProductImage(input: Buffer): Promise<Buffer> {
  // Decode, orient and strip metadata once; re-encode until under target.
  const base = sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' }).rotate();
  for (const [dimension, quality] of ENCODE_STEPS) {
    const output = await base
      .clone()
      .resize({ width: dimension, height: dimension, fit: 'inside', withoutEnlargement: true })
      .webp({ quality, effort: 4 })
      .toBuffer();
    if (output.length <= TARGET_OUTPUT_BYTES) return output;
  }
  throw new Error('IMAGE_TOO_COMPLEX');
}
