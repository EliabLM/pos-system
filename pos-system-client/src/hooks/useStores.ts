import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createStore,
  updateStore,
  getStores,
  getStoreById,
  getStoreWithSalesInfo,
  softDeleteStore,
  restoreStore,
  deleteStore,
  getNextSaleNumber,
} from '@/actions/store';
import type { CreateStoreInput, UpdateStoreInput } from '@/actions/store/store.schemas';
import { useStore } from '@/store';

// Hook principal para obtener tiendas por organización
export const useStores = (
  isActive?: boolean,
  includeDeleted: boolean = false
) => {
  const user = useStore((state) => state.user);

  return useQuery({
    queryKey: ['stores', user?.organizationId, isActive, includeDeleted],
    queryFn: async () => {
      if (!user?.organizationId) {
        throw new Error('Usuario no tiene organización asignada');
      }

      const response = await getStores(isActive, includeDeleted);

      // Manejar errores de la respuesta
      if (response.status !== 200) {
        throw new Error(response.message);
      }

      return response.data;
    },
    enabled: !!user?.organizationId,
    staleTime: 5 * 60 * 1000, // 5 minutos
    gcTime: 10 * 60 * 1000, // 10 minutos
  });
};

// Hook para obtener una tienda específica por ID
export const useStoreById = (storeId: string) => {
  return useQuery({
    queryKey: ['store', storeId],
    queryFn: async () => {
      if (!storeId) {
        throw new Error('ID de tienda requerido');
      }

      const response = await getStoreById(storeId);

      if (response.status !== 200) {
        throw new Error(response.message);
      }

      return response.data;
    },
    enabled: !!storeId,
    staleTime: 3 * 60 * 1000, // 3 minutos
    gcTime: 5 * 60 * 1000, // 5 minutos
  });
};

// Hook para obtener tienda con información detallada de ventas
export const useStoreWithSalesInfo = (storeId: string) => {
  return useQuery({
    queryKey: ['store', storeId, 'salesInfo'],
    queryFn: async () => {
      if (!storeId) {
        throw new Error('ID de tienda requerido');
      }

      const response = await getStoreWithSalesInfo(storeId);

      if (response.status !== 200) {
        throw new Error(response.message);
      }

      return response.data;
    },
    enabled: !!storeId,
    staleTime: 2 * 60 * 1000, // 2 minutos (más frecuente por datos de ventas)
    gcTime: 5 * 60 * 1000,
  });
};

// Hook para obtener el próximo número de venta
export const useNextSaleNumber = (storeId: string) => {
  return useQuery({
    queryKey: ['store', storeId, 'nextSaleNumber'],
    queryFn: async () => {
      if (!storeId) {
        throw new Error('ID de tienda requerido');
      }

      const response = await getNextSaleNumber(storeId);

      if (response.status !== 200) {
        throw new Error(response.message);
      }

      return response.data;
    },
    enabled: !!storeId,
    staleTime: 30 * 1000, // 30 segundos (muy fresco para numeración de ventas)
    gcTime: 2 * 60 * 1000,
  });
};

// Hook para crear tienda
export const useCreateStore = () => {
  const queryClient = useQueryClient();
  const user = useStore((state) => state.user);

  return useMutation({
    mutationFn: async (storeData: CreateStoreInput) => {
      if (!user?.organizationId) {
        throw new Error('Usuario no tiene organización asignada');
      }

      const response = await createStore(storeData);

      if (response.status !== 201) {
        throw new Error(response.message);
      }

      return response.data;
    },
    onSuccess: () => {
      // Invalidar múltiples queries relacionadas
      queryClient.invalidateQueries({
        queryKey: ['stores', user?.organizationId],
      });
    },
    onError: (error) => {
      console.error('Error creando la tienda:', error);
    },
  });
};

// Hook para actualizar tienda
export const useUpdateStore = () => {
  const queryClient = useQueryClient();
  const user = useStore((state) => state.user);

  return useMutation({
    mutationFn: async ({
      storeId,
      storeData,
    }: {
      storeId: string;
      storeData: UpdateStoreInput;
    }) => {
      if (!user?.organizationId) {
        throw new Error('Usuario no tiene organización asignada');
      }

      const response = await updateStore(storeId, storeData);

      if (response.status !== 200) {
        throw new Error(response.message);
      }

      return response.data;
    },
    onSuccess: (data, variables) => {
      // Invalidar queries relacionadas
      queryClient.invalidateQueries({
        queryKey: ['stores', user?.organizationId],
      });
      queryClient.invalidateQueries({
        queryKey: ['store', variables.storeId],
      });
    },
    onError: (error) => {
      console.error('Error actualizando la tienda:', error);
    },
  });
};

// Hook para eliminar tienda (soft delete)
export const useSoftDeleteStore = () => {
  const queryClient = useQueryClient();
  const user = useStore((state) => state.user);

  return useMutation({
    mutationFn: async ({ storeId }: { storeId: string }) => {
      if (!user?.organizationId) {
        throw new Error('Usuario no tiene organización asignada');
      }

      const response = await softDeleteStore(storeId);

      if (response.status !== 200) {
        throw new Error(response.message);
      }

      return response;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['stores', user?.organizationId],
      });
      queryClient.invalidateQueries({
        queryKey: ['store', variables.storeId],
      });
    },
    onError: (error) => {
      console.error('Error eliminando la tienda:', error);
    },
  });
};

// Hook para restaurar tienda eliminada
export const useRestoreStore = () => {
  const queryClient = useQueryClient();
  const user = useStore((state) => state.user);

  return useMutation({
    mutationFn: async ({ storeId }: { storeId: string }) => {
      if (!user?.organizationId) {
        throw new Error('Usuario no tiene organización asignada');
      }

      const response = await restoreStore(storeId);

      if (response.status !== 200) {
        throw new Error(response.message);
      }

      return response.data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['stores', user?.organizationId],
      });
      queryClient.invalidateQueries({
        queryKey: ['store', variables.storeId],
      });
    },
    onError: (error) => {
      console.error('Error restaurando la tienda:', error);
    },
  });
};

// Hook para eliminar tienda permanentemente (hard delete)
export const useDeleteStore = () => {
  const queryClient = useQueryClient();
  const user = useStore((state) => state.user);

  return useMutation({
    mutationFn: async ({ storeId }: { storeId: string }) => {
      if (!user?.organizationId) {
        throw new Error('Usuario no tiene organización asignada');
      }

      const response = await deleteStore(storeId);

      if (response.status !== 200) {
        throw new Error(response.message);
      }

      return response.data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['stores', user?.organizationId],
      });
      // Remover específicamente esta tienda del cache
      queryClient.removeQueries({
        queryKey: ['store', variables.storeId],
      });
    },
    onError: (error) => {
      console.error('Error eliminando permanentemente la tienda:', error);
    },
  });
};

// Hooks de conveniencia para casos comunes
export const useActiveStores = () => {
  return useStores(true);
};

export const useAllStores = () => {
  return useStores();
};

export const useInactiveStores = () => {
  return useStores(false);
};

export const useDeletedStores = () => {
  return useStores(undefined, true);
};
