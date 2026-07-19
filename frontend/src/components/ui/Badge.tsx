import React from 'react'
import { cn, STATUS_COLORS } from '@/utils/format'

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={cn('inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium', STATUS_COLORS[status] ?? 'bg-gray-100 text-gray-700')}>
      {status}
    </span>
  )
}

export function Badge({ children, variant = 'default' }: { children: React.ReactNode; variant?: 'default' | 'success' | 'warning' | 'danger' | 'info' }) {
  const variants = {
    default: 'bg-gray-100 text-gray-700', success: 'bg-green-100 text-green-700',
    warning: 'bg-yellow-100 text-yellow-700', danger: 'bg-red-100 text-red-700',
    info: 'bg-blue-100 text-blue-700',
  }
  return (
    <span className={cn('inline-flex items-center px-2 py-0.5 rounded text-xs font-medium', variants[variant])}>
      {children}
    </span>
  )
}
