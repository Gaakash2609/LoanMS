export function LoadingSpinner({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const sizes = { sm: 'h-4 w-4', md: 'h-8 w-8', lg: 'h-12 w-12' }
  return (
    <div className="flex items-center justify-center p-4">
      <svg className={`animate-spin text-efin-blue ${sizes[size]}`} fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
    </div>
  )
}

export function PageLoader() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-center">
        <div className="w-12 h-12 rounded-xl bg-efin-blue flex items-center justify-center mx-auto mb-3">
          <span className="text-white font-bold text-xl">E</span>
        </div>
        <LoadingSpinner size="md" />
        <p className="text-sm text-gray-500 mt-2">Loading EFIN...</p>
      </div>
    </div>
  )
}
