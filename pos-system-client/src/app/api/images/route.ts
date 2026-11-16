import { NextResponse } from 'next/server';
import { getPurchaseActor } from '@/actions/purchase/purchase-access';
import { handleProductImageUpload } from '@/lib/images/upload-product-image';
import { getStorage } from '@/lib/storage';

export const runtime = 'nodejs';

// Upload a product image (multipart, field `file`). ADMIN only.
// TODO(#36): switch to getActor() once the central session helper is merged.
export async function POST(request: Request) {
  const result = await handleProductImageUpload(request, {
    getActor: () => getPurchaseActor(true),
    storage: getStorage(),
  });
  return NextResponse.json(result.body, { status: result.status });
}
