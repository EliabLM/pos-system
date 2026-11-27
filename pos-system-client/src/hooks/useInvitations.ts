import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { cancelInvitation, createInvitation, getPendingInvitations } from '@/actions/invitation';
import { useStore } from '@/store';

// Invitaciones pendientes de la organización (#20). Solo el ADMIN.
export const usePendingInvitations = () => {
  const user = useStore((state) => state.user);

  return useQuery({
    queryKey: ['invitations', user?.organizationId],
    queryFn: async () => {
      const response = await getPendingInvitations();
      if (response.status !== 200) throw new Error(response.message);
      return response.data ?? [];
    },
    enabled: !!user?.organizationId && user.role === 'ADMIN',
  });
};

export const useCreateInvitation = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (email: string) => {
      const response = await createInvitation({ email });
      if (response.status !== 201 || !response.data) throw new Error(response.message);
      return response.data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['invitations'] }),
  });
};

export const useCancelInvitation = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (invitationId: string) => {
      const response = await cancelInvitation(invitationId);
      if (response.status !== 200) throw new Error(response.message);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['invitations'] }),
  });
};
