import path from 'node:path';
import { LocalDiskStorage } from './local-disk-storage';
import type { StorageProvider } from './storage-provider';

export * from './storage-provider';

let instance: StorageProvider | null = null;

/**
 * Storage selected by environment. Only `local` exists today; an OCI Object
 * Storage provider would be added here behind `STORAGE_DRIVER=oci`.
 */
export function getStorage(): StorageProvider {
  if (instance) return instance;
  const driver = process.env.STORAGE_DRIVER ?? 'local';
  if (driver !== 'local') throw new Error(`Unsupported STORAGE_DRIVER: ${driver}`);
  const dir = process.env.UPLOADS_DIR;
  if (!dir && process.env.NODE_ENV === 'production') {
    throw new Error('UPLOADS_DIR is required in production');
  }
  instance = new LocalDiskStorage(dir || path.join(process.cwd(), '.uploads'));
  return instance;
}
