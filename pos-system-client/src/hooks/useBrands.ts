import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createBrand, updateBrand, getBrands, softDeleteBrand, type CreateBrandInput, type UpdateBrandInput } from '@/actions/brand'
import { useStore } from '@/store'

export const useBrands = (isActive?: boolean) => {
  const user = useStore(state => state.user);

  return useQuery({
    queryKey: ['brands', user?.organizationId, isActive],
    queryFn: async () => {
      if (!user?.organizationId) {
        throw new Error('Usuario no tiene organización asignada')
      }

      const response = await getBrands(isActive)

      // Manejar errores de la respuesta
      if (response.status !== 200) {
        throw new Error(response.message)
      }

      return response.data
    },
    enabled: !!user?.organizationId,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  })
}

// Create brand hook
export const useCreateBrand = () => {
  const queryClient = useQueryClient()
  const user = useStore(state => state.user);

  return useMutation({
    mutationFn: async (brandData: CreateBrandInput) => {
      if (!user?.organizationId) {
        throw new Error('Usuario no tiene organización asignada')
      }

      const response = await createBrand(brandData)

      if (response.status !== 201) {
        throw new Error(response.message)
      }

      return response.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['brands', user?.organizationId]
      })
    },
    onError: (error) => {
      console.error('Error creando la marca:', error)
    }
  })
}

// Hook adicional para obtener categorías activas (caso común)
export const useActiveBrands = () => {
  return useBrands(true)
}

// Hook adicional para obtener todas las categorías (activas e inactivas)
export const useAllBrands = () => {
  return useBrands()
}

// Hook para eliminar marcas (soft)
export const useSoftDeleteBrand = () => {
  const queryClient = useQueryClient()
  const user = useStore(state => state.user);

  return useMutation({
    mutationFn: async ({ brandId }: { brandId: string }) => {
      if (!user?.organizationId) {
        throw new Error('Usuario no tiene organización asignada')
      }

      const response = await softDeleteBrand(brandId);

      if (response.status !== 200) {
        throw new Error(response.message)
      }

      return response
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['brands', user?.organizationId]
      })
    },
    onError: (error) => {
      console.error('Error eliminando la marca:', error)
    }
  })
}

export const useUpdateBrand = () => {
  const queryClient = useQueryClient()
  const user = useStore(state => state.user);

  return useMutation({
    mutationFn: async ({ brandId, brandData }: {
      brandId: string, brandData: UpdateBrandInput
    }) => {
      if (!user?.organizationId) {
        throw new Error('Usuario no tiene organización asignada')
      }

      const response = await updateBrand(brandId, brandData)

      if (response.status !== 200) {
        throw new Error(response.message)
      }

      return response.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['brands', user?.organizationId]
      })
    },
    onError: (error) => {
      console.error('Error actualizando la marca:', error)
    }
  })
}
