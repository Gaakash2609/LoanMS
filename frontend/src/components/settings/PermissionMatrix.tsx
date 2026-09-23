import {
  PERMISSION_MATRIX_ROLE_ORDER, PERMISSION_MATRIX_ROWS, ROLE_DISPLAY,
} from '@/constants/permissions'
import type { RolePermissionsMap } from '@/api/permissionsApi'

// Read-only Permission Matrix — efin-app.js's allPerms block (lines
// 5883-5947). Legacy computes 11 role columns but its static <thead> only
// labels 7 — we render all 11 properly labeled rather than reproducing
// that markup bug (see constants/permissions.ts comment).
export default function PermissionMatrix({ roles }: { roles: RolePermissionsMap }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200">
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-gray-50">
            <th className="px-3 py-2 text-left font-semibold text-gray-600 sticky left-0 bg-gray-50">Action / Feature</th>
            {PERMISSION_MATRIX_ROLE_ORDER.map(rk => (
              <th key={rk} className="px-2 py-2 text-center font-semibold whitespace-nowrap" style={{ color: ROLE_DISPLAY[rk].color }}>
                {ROLE_DISPLAY[rk].label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {PERMISSION_MATRIX_ROWS.map(([label, permKey], i) => {
            if (permKey === null) {
              return (
                <tr key={i} className="bg-gray-100">
                  <td colSpan={PERMISSION_MATRIX_ROLE_ORDER.length + 1} className="px-3 py-1.5 font-bold text-gray-500 text-[11px] tracking-wide sticky left-0 bg-gray-100">
                    {label}
                  </td>
                </tr>
              )
            }
            return (
              <tr key={i} className="border-t border-gray-100">
                <td className="px-3 py-1.5 text-gray-700 whitespace-nowrap sticky left-0 bg-white">{label}</td>
                {PERMISSION_MATRIX_ROLE_ORDER.map(rk => {
                  const value = roles[rk][permKey]
                  if (permKey === 'canMaskPersonal') {
                    return <td key={rk} className="px-2 py-1.5 text-center">{value ? '🔒' : '👁'}</td>
                  }
                  return (
                    <td key={rk} className="px-2 py-1.5 text-center">
                      {value ? <span className="text-green-600 font-bold">✓</span> : <span className="text-gray-300">—</span>}
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
