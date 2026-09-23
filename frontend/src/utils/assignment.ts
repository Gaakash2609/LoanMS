// Loan assignment payload builder — translates a user's picks in the
// assignment card into the backend UpdateLoanAssignmentRequestDto's set/clear
// semantics (a null id must be sent as an explicit Clear* flag; a number is a
// set; undefined means "leave this field untouched"). Kept as one pure,
// testable function so the card holds no branching business logic.

export interface AssignmentSelection {
  // number = assign to this user; null = unassign (clear); undefined = unchanged
  assignedToUserId?: number | null
  loginUserId?: number | null
  // string = set to this team name; null = clear; undefined = unchanged
  salesTeamName?: string | null
  // number = assign to this user; null = unassign (clear); undefined = unchanged
  opsManagerId?: number | null
  locationId?: number | null
}

export interface AssignmentPayload {
  assignedToUserId?: number | null
  loginUserId?: number | null
  salesTeamName?: string | null
  opsManagerId?: number | null
  locationId?: number | null
  clearAssignedTo?: boolean
  clearLoginUser?: boolean
  clearSalesTeam?: boolean
  clearOpsManager?: boolean
  clearLocation?: boolean
}

export function buildAssignmentPayload(sel: AssignmentSelection): AssignmentPayload {
  const p: AssignmentPayload = {}
  if (sel.assignedToUserId === null) p.clearAssignedTo = true
  else if (typeof sel.assignedToUserId === 'number') p.assignedToUserId = sel.assignedToUserId
  if (sel.loginUserId === null) p.clearLoginUser = true
  else if (typeof sel.loginUserId === 'number') p.loginUserId = sel.loginUserId
  if (sel.salesTeamName === null) p.clearSalesTeam = true
  else if (typeof sel.salesTeamName === 'string') p.salesTeamName = sel.salesTeamName
  if (sel.opsManagerId === null) p.clearOpsManager = true
  else if (typeof sel.opsManagerId === 'number') p.opsManagerId = sel.opsManagerId
  if (sel.locationId === null) p.clearLocation = true
  else if (typeof sel.locationId === 'number') p.locationId = sel.locationId
  return p
}

/** True when a selection would actually change something (nothing to save otherwise). */
export function hasAssignmentChange(sel: AssignmentSelection): boolean {
  return (
    sel.assignedToUserId !== undefined ||
    sel.loginUserId !== undefined ||
    sel.salesTeamName !== undefined ||
    sel.opsManagerId !== undefined ||
    sel.locationId !== undefined
  )
}
