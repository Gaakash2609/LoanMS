import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { customersApi } from '@/api/customersApi'
import type { CreateCustomerRequest } from '@/types'

export const CUSTOMER_KEYS = {
  all:    ['customers'] as const,
  list:   (page: number, pageSize: number, search?: string) => ['customers', 'list', page, pageSize, search] as const,
  detail: (id: number) => ['customers', 'detail', id] as const,
}

export function useCustomers(page = 1, pageSize = 20, search?: string) {
  return useQuery({
    queryKey: CUSTOMER_KEYS.list(page, pageSize, search),
    queryFn:  () => customersApi.getAll(page, pageSize, search).then((r) => r.data.data),
    staleTime: 30_000,
  })
}

export function useCustomer(id: number) {
  return useQuery({
    queryKey: CUSTOMER_KEYS.detail(id),
    queryFn:  () => customersApi.getById(id).then((r) => r.data.data),
    enabled:  !!id,
  })
}

export function useCreateCustomer() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: CreateCustomerRequest) => customersApi.create(data).then((r) => r.data),
    onSuccess:  () => qc.invalidateQueries({ queryKey: CUSTOMER_KEYS.all }),
  })
}
