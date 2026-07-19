import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { loansApi } from '@/api/loansApi'
import type { CreateLoanRequest, LoanFilter } from '@/types'

export const LOAN_KEYS = {
  all:       ['loans'] as const,
  list:      (filter: LoanFilter) => ['loans', 'list', filter] as const,
  detail:    (id: number)  => ['loans', 'detail', id] as const,
  dashboard: ['loans', 'dashboard'] as const,
}

export function useLoans(filter: LoanFilter) {
  return useQuery({
    queryKey:  LOAN_KEYS.list(filter),
    queryFn:   () => loansApi.getAll(filter).then((r) => r.data.data),
    staleTime: 30_000,
  })
}

export function useLoan(id: number) {
  return useQuery({
    queryKey: LOAN_KEYS.detail(id),
    queryFn:  () => loansApi.getById(id).then((r) => r.data.data),
    enabled:  !!id,
  })
}

export function useDashboard() {
  return useQuery({
    queryKey:         LOAN_KEYS.dashboard,
    queryFn:          () => loansApi.getDashboard().then((r) => r.data.data),
    staleTime:        60_000,
    refetchInterval:  120_000,
  })
}

export function useCreateLoan() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: CreateLoanRequest) => loansApi.create(data).then((r) => r.data),
    onSuccess:  () => qc.invalidateQueries({ queryKey: LOAN_KEYS.all }),
  })
}

export function useUpdateLoanStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...data }: { id: number; newStatus: string; comment?: string; approvedAmount?: number }) =>
      loansApi.updateStatus(id, data).then((r) => r.data),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: LOAN_KEYS.detail(vars.id) })
      qc.invalidateQueries({ queryKey: LOAN_KEYS.all })
    },
  })
}
