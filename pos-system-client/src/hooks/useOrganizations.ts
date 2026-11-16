import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createOrganization } from '@/actions/organization';
import type { CreateOrganizationInput } from '@/actions/organization/organization.action';

// Onboarding: el usuario con sesión y sin organización crea la suya (queda
// como ADMIN). La identidad sale de la sesión en el servidor, no del cliente.
export const useCreateOrganization = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      organizationData,
      businessType,
    }: {
      organizationData: CreateOrganizationInput;
      businessType?: 'liquor_store' | 'shoe_store' | null;
    }) => {
      const response = await createOrganization(organizationData, businessType);

      if (response.status !== 201) {
        throw new Error(response.message);
      }

      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organizations'] });
    },
    onError: (error) => {
      console.error('Error creando la organización:', error.message);
    },
  });
};
