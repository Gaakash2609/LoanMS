import { Card } from '@/components/ui/Card'
import PageHeader from '@/components/shared/PageHeader'

// Legacy page-policy-product: role-action permission matrix + DSA/Partner tables
// DSA and Partner tables are covered by DsaPage. This page shows the permission matrix.

const ACTIONS = [
  'Create new application', 'View applications (own)', 'View applications (all)',
  'Change loan status', 'Approve loan', 'Disburse loan',
  'Create customer', 'Edit customer', 'Delete record',
  'View payout claims', 'Approve payout', 'Generate reports',
  'Manage users', 'Manage settings', 'View audit log',
  'Add DSA', 'Add partner', 'Configure lender',
]

const ROLES = ['Admin', 'Login Team', 'Team Leader', 'Sales Exec', 'Partner', 'Accounts', 'Product Team']

const MATRIX: Record<string, Record<string, boolean>> = {
  'Create new application':     { Admin:true, 'Login Team':true, 'Team Leader':true, 'Sales Exec':true, Partner:true, Accounts:false, 'Product Team':false },
  'View applications (own)':    { Admin:true, 'Login Team':true, 'Team Leader':true, 'Sales Exec':true, Partner:true, Accounts:true,  'Product Team':true  },
  'View applications (all)':    { Admin:true, 'Login Team':true, 'Team Leader':true, 'Sales Exec':false, Partner:false, Accounts:true, 'Product Team':true  },
  'Change loan status':         { Admin:true, 'Login Team':true, 'Team Leader':true, 'Sales Exec':false, Partner:false, Accounts:false,'Product Team':false },
  'Approve loan':               { Admin:true, 'Login Team':false,'Team Leader':true, 'Sales Exec':false, Partner:false, Accounts:false,'Product Team':false },
  'Disburse loan':              { Admin:true, 'Login Team':false,'Team Leader':false,'Sales Exec':false, Partner:false, Accounts:true, 'Product Team':false },
  'Create customer':            { Admin:true, 'Login Team':true, 'Team Leader':true, 'Sales Exec':true,  Partner:true,  Accounts:false,'Product Team':false },
  'Edit customer':              { Admin:true, 'Login Team':true, 'Team Leader':true, 'Sales Exec':true,  Partner:false, Accounts:false,'Product Team':false },
  'Delete record':              { Admin:true, 'Login Team':false,'Team Leader':false,'Sales Exec':false, Partner:false, Accounts:false,'Product Team':false },
  'View payout claims':         { Admin:true, 'Login Team':false,'Team Leader':true, 'Sales Exec':true,  Partner:true,  Accounts:true, 'Product Team':false },
  'Approve payout':             { Admin:true, 'Login Team':false,'Team Leader':false,'Sales Exec':false, Partner:false, Accounts:true, 'Product Team':false },
  'Generate reports':           { Admin:true, 'Login Team':false,'Team Leader':true, 'Sales Exec':false, Partner:false, Accounts:true, 'Product Team':true  },
  'Manage users':               { Admin:true, 'Login Team':false,'Team Leader':false,'Sales Exec':false, Partner:false, Accounts:false,'Product Team':false },
  'Manage settings':            { Admin:true, 'Login Team':false,'Team Leader':false,'Sales Exec':false, Partner:false, Accounts:false,'Product Team':false },
  'View audit log':             { Admin:true, 'Login Team':false,'Team Leader':false,'Sales Exec':false, Partner:false, Accounts:false,'Product Team':false },
  'Add DSA':                    { Admin:true, 'Login Team':false,'Team Leader':false,'Sales Exec':false, Partner:false, Accounts:false,'Product Team':false },
  'Add partner':                { Admin:true, 'Login Team':false,'Team Leader':false,'Sales Exec':false, Partner:false, Accounts:false,'Product Team':false },
  'Configure lender':           { Admin:true, 'Login Team':false,'Team Leader':false,'Sales Exec':false, Partner:false, Accounts:false,'Product Team':true  },
}

export default function PolicyProductPage() {
  return (
    <div>
      <PageHeader title="Policy / Product Matrix" subtitle="Role-based access and feature permissions" />
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="pb-3 pr-4 text-left text-gray-500 font-medium min-w-[180px]">Action / Feature</th>
                {ROLES.map(r => (
                  <th key={r} className="pb-3 px-3 text-center text-gray-500 font-medium whitespace-nowrap">{r}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {ACTIONS.map(action => (
                <tr key={action} className="hover:bg-gray-50">
                  <td className="py-2 pr-4 text-gray-700">{action}</td>
                  {ROLES.map(role => (
                    <td key={role} className="py-2 px-3 text-center">
                      {MATRIX[action]?.[role]
                        ? <span className="text-green-500 font-bold text-sm">✓</span>
                        : <span className="text-gray-200 text-sm">—</span>
                      }
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
