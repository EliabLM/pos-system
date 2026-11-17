import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { assertValidKey, isValidKey, type StorageProvider, type StoredObject } from './storage-provider';

const CONTENT_TYPES: Record<string, string> = { '.webp': 'image/webp' };

/**
 * Stores objects as plain files under `rootDir` (in production, a persistent
 * volume mounted by Coolify). This is the only place in the app that knows
 * about disk paths.
 */
export class LocalDiskStorage implements StorageProvider {
  private readonly root: string;

  constructor(rootDir: string, private readonly publicBasePath = '/api/images') {
    this.root = path.resolve(rootDir);
  }

  private resolve(key: string): string {
    assertValidKey(key);
    const full = path.resolve(this.root, key);
    // Defense in depth: the key regex already forbids traversal.
    if (!full.startsWith(this.root + path.sep)) throw new Error('Invalid storage key');
    return full;
  }

  async put(key: string, data: Buffer, contentType: string): Promise<void> {
    const full = this.resolve(key);
    // The content type is derived from the extension on read; they must agree.
    if (CONTENT_TYPES[path.extname(full)] !== contentType) throw new Error('Content type does not match key');
    await mkdir(path.dirname(full), { recursive: true });
    // Write to a temp file and rename, so readers never see a partial file.
    const tmp = `${full}.${randomUUID()}.tmp`;
    try {
      await writeFile(tmp, data, { mode: 0o644 });
      await rename(tmp, full);
    } catch (error) {
      await rm(tmp, { force: true });
      throw error;
    }
  }

  async get(key: string): Promise<StoredObject | null> {
    const full = this.resolve(key);
    try {
      const data = await readFile(full);
      return { data, contentType: CONTENT_TYPES[path.extname(full)] ?? 'application/octet-stream' };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.resolve(key), { force: true });
  }

  url(key: string): string {
    assertValidKey(key);
    return `${this.publicBasePath}/${key}`;
  }

  keyFromUrl(url: string): string | null {
    const prefix = `${this.publicBasePath}/`;
    if (typeof url !== 'string' || !url.startsWith(prefix)) return null;
    const key = url.slice(prefix.length);
    return isValidKey(key) ? key : null;
  }
}
