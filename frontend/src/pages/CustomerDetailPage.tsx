import { useParams, useNavigate, Link } from 'react-router-dom'
import { useCustomer } from '@/hooks/useCustomers'
import { Card, CardHeader } from '@/components/ui/Card'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import { formatCurrency, formatDate } from '@/utils/format'
import { ArrowLeft, Plus } from 'lucide-react'
import { Button } from '@/components/ui/Button'

export default function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { data: customer, isLoading } = useCustomer(Number(id))

  if (isLoading) return <LoadingSpinner size="lg" />
  if (!customer) return <div className="p-8 text-center text-gray-500">Customer not found</div>

  const fields: [string, string | null | undefined][] = [
    ['Full Name',       customer.fullName],
    ['Email',           customer.email],
    ['Phone',           customer.phone],
    ['PAN Number',      customer.panNumber],
    ['Aadhaar Number',  customer.aadhaarNumber],
    ['Date of Birth',   customer.dateOfBirth ? formatDate(customer.dateOfBirth) : null],
    ['CIBIL Score',     customer.cibilScore?.toString()],
    ['Monthly Income',  customer.monthlyIncome ? formatCurrency(customer.monthlyIncome) : null],
    ['Employment Type', customer.employmentType],
    ['Company Name',    customer.companyName],
    ['Address',         customer.address],
    ['City / State',    [customer.city, customer.state].filter(Boolean).join(', ') || null],
    ['PIN Code',        customer.pinCode],
    ['Member Since',    formatDate(customer.createdAt)],
  ]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="p-2 rounded-lg hover:bg-gray-100 text-gray-500">
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-gray-900">{customer.fullName}</h1>
          <p className="text-sm text-gray-500">{customer.email}</p>
        </div>
        <Link to="/loans/new">
          <Button size="sm" variant="secondary">
            <Plus size={14} className="mr-1" /> New Loan
          </Button>
        </Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main details */}
        <div className="lg:col-span-2 space-y-5">
          <Card>
            <CardHeader title="Customer Profile" />
            <div className="grid grid-cols-2 gap-4 text-sm">
              {fields.map(([label, value]) => value ? (
                <div key={label}>
                  <p className="text-xs text-gray-500">{label}</p>
                  <p className="font-medium text-gray-900 mt-0.5">{value}</p>
                </div>
              ) : null)}
            </div>
          </Card>

          <Card>
            <CardHeader title={`Loan Applications (${customer.totalLoans})`} />
            {customer.totalLoans === 0 ? (
              <p className="text-sm text-gray-400 py-4">No loan applications yet.</p>
            ) : (
              <p className="text-sm text-gray-600">
                Visit the{' '}
                <Link to="/loans" className="text-blue-600 hover:underline">
                  Loans page
                </Link>{' '}
                and search by customer name to view all applications.
              </p>
            )}
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-5">
          {/* CIBIL Score */}
          <Card className="p-5">
            <p className="text-xs text-gray-500 mb-1">CIBIL Score</p>
            <p className={`text-3xl font-bold ${
              (customer.cibilScore ?? 0) >= 750 ? 'text-green-600'
              : (customer.cibilScore ?? 0) >= 650 ? 'text-yellow-600'
              : 'text-red-600'
            }`}>
              {customer.cibilScore ?? 'N/A'}
            </p>
            <p className="text-xs text-gray-500 mt-1">
              {(customer.cibilScore ?? 0) >= 750 ? 'Excellent'
               : (customer.cibilScore ?? 0) >= 650 ? 'Good'
               : (customer.cibilScore ?? 0) > 0 ? 'Needs Improvement'
               : 'Not Available'}
            </p>
          </Card>

          {/* AI Panel — only shown when customer has loans (loanId > 0 not available here) */}
          <Card>
            <div className="flex items-center gap-2 py-1">
              <div className="w-7 h-7 rounded-lg bg-gray-100 flex items-center justify-center">
                <span className="text-xs">✨</span>
              </div>
              <div>
                <p className="text-sm font-medium text-gray-900">AI Insights</p>
                <p className="text-xs text-gray-500">
                  Open a loan application to view AI-powered analysis.
                </p>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}
