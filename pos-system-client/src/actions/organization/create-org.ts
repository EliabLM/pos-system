'use server';

import { prisma } from '@/lib/db';

interface OrgRequest {
  clerkOrgId: string;
  name: string;
  email: string;
  phone?: string;
  address?: string;
  city?: string;
  department?: string;
}

export const createOrgAction = async (org: OrgRequest) => {
  try {
    const result = await prisma.organization.create({
      data: {
        name: org.name,
        email: org.email,
        phone: org.phone,
        address: org.address,
        city: 'Cartagena',
        department: 'Bolívar',
      },
    });

    return {
      status: 'SUCCESS',
      data: result,
    };
  } catch (error) {
    console.error('🚀 ~ createOrgAction ~ error:', error);
    return {
      status: 'ERROR',
      data: null,
    };
  }
};
