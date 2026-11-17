import { NextResponse } from 'next/server';
import { MembershipRole } from '@/generated/prisma';
import { actorErrorResponse, requireActor } from '@/lib/auth/actor';
import { handleProductImageUpload, type UploadAccess } from '@/lib/images/upload-product-image';
import { getStorage } from '@/lib/storage';

export const runtime = 'nodejs';

/** Session actor (ADMIN only) in the shape the upload handler expects. */
async function getAdminActor(): Promise<UploadAccess> {
  try {
    const { organizationId, role } = await requireActor({ roles: [MembershipRole.ADMIN] });
    return { actor: { organizationId, role } };
  } catch (error) {
    const denied = actorErrorResponse(error);
    if (denied) return { status: denied.status };
    console.error('Error authorizing image upload:', error);
    return { status: 500 };
  }
}

// Upload a product image (multipart, field `file`). ADMIN only.
export async function POST(request: Request) {
  const result = await handleProductImageUpload(request, {
    getActor: getAdminActor,
    storage: getStorage(),
  });
  return NextResponse.json(result.body, { status: result.status });
}
