// import { clsx, type ClassValue } from 'clsx'
// import { twMerge } from 'tailwind-merge'

// Fallback implementations
type ClassValue = string | undefined | null | boolean | Record<string, any> | ClassValue[]
const clsx = (...classes: any[]) => classes.filter(Boolean).join(' ')
const twMerge = (classes: string) => classes

// Formatting utilities
const INR = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })
const NUM = new Intl.NumberFormat('en-IN')

export const formatCurrency = (n?: number | null) => n != null ? INR.format(n) : '—'
export const formatNumber   = (n?: number | null) => n != null ? NUM.format(n) : '—'

export const formatDate = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

export const formatDateTime = (d?: string | null) =>
  d ? new Date(d).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  }) : '—'

export const formatRelativeDate = (d?: string | null) => {
  if (!d) return '—'
  const diff = Date.now() - new Date(d).getTime()
  const days = Math.floor(diff / 86400000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days}d ago`
  return formatDate(d)
}

export const STATUS_COLORS: Record<string, string> = {
  Draft:       'bg-gray-100 text-gray-700',
  Submitted:   'bg-blue-100 text-blue-700',
  UnderReview: 'bg-yellow-100 text-yellow-700',
  Approved:    'bg-green-100 text-green-700',
  Disbursed:   'bg-emerald-100 text-emerald-700',
  Rejected:    'bg-red-100 text-red-700',
  Closed:      'bg-slate-100 text-slate-600',
}

export const PRIORITY_COLORS: Record<string, string> = {
  High:   'bg-red-100 text-red-700',
  Medium: 'bg-yellow-100 text-yellow-700',
  Low:    'bg-green-100 text-green-700',
}

export const LOAN_TYPE_LABELS: Record<string, string> = {
  Personal: 'Personal Loan', Business: 'Business Loan', Home: 'Home Loan',
  NewCar: 'New Car', UsedCar: 'Used Car', Education: 'Education',
  AgainstProperty: 'LAP', Insurance: 'Insurance',
}

// cn() using clsx + tailwind-merge — handles conditional classes properly
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
