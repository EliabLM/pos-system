import { getStorage, isOrgProductImageKey, type StorageProvider } from '@/lib/storage';

/** A product may only reference an image stored under its own organization. */
export function isOrgProductImageUrl(
  url: string | null | undefined,
  organizationId: string,
  storage: StorageProvider = getStorage()
): boolean {
  if (!url) return true;
  const key = storage.keyFromUrl(url);
  return key !== null && isOrgProductImageKey(key, organizationId);
}

/** Best-effort delete; never touches keys outside `organizationId`. */
export async function deleteOrgProductImage(
  url: string | null | undefined,
  organizationId: string,
  storage: StorageProvider = getStorage()
): Promise<void> {
  if (!url) return;
  const key = storage.keyFromUrl(url);
  if (!key || !isOrgProductImageKey(key, organizationId)) return;
  try {
    await storage.delete(key);
  } catch (error) {
    // Do not block the main operation on a storage failure.
    console.error('Error deleting product image:', error);
  }
}
