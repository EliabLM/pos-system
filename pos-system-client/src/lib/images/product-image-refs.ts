import { getStorage, isOrgProductImageKey, type StorageProvider } from '@/lib/storage';

/** A product may only reference an image stored under its own organization. */
export function isOrgProductImageUrl(
  url: string | null | undefined,
  organizationId: string,
  storage?: StorageProvider
): boolean {
  if (!url) return true;
  // Resolve the storage only when there is an image: getStorage() requires
  // UPLOADS_DIR in production, and a product without image must not need it.
  const key = (storage ?? getStorage()).keyFromUrl(url);
  return key !== null && isOrgProductImageKey(key, organizationId);
}

/** Best-effort delete; never touches keys outside `organizationId`. */
export async function deleteOrgProductImage(
  url: string | null | undefined,
  organizationId: string,
  storage?: StorageProvider
): Promise<void> {
  if (!url) return;
  const store = storage ?? getStorage();
  const key = store.keyFromUrl(url);
  if (!key || !isOrgProductImageKey(key, organizationId)) return;
  try {
    await store.delete(key);
  } catch (error) {
    // Do not block the main operation on a storage failure.
    console.error('Error deleting product image:', error);
  }
}
