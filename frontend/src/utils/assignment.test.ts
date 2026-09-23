import { describe, it, expect } from 'vitest'
import { buildAssignmentPayload, hasAssignmentChange } from './assignment'

describe('buildAssignmentPayload', () => {
  it('omits untouched fields entirely', () => {
    expect(buildAssignmentPayload({})).toEqual({})
  })

  it('sends an id when a user is picked', () => {
    expect(buildAssignmentPayload({ assignedToUserId: 7, loginUserId: 3 }))
      .toEqual({ assignedToUserId: 7, loginUserId: 3 })
  })

  it('sends the Clear flag (not a null id) when unassigned', () => {
    expect(buildAssignmentPayload({ assignedToUserId: null }))
      .toEqual({ clearAssignedTo: true })
    expect(buildAssignmentPayload({ loginUserId: null }))
      .toEqual({ clearLoginUser: true })
  })

  it('mixes set and clear across the two fields', () => {
    expect(buildAssignmentPayload({ assignedToUserId: 5, loginUserId: null }))
      .toEqual({ assignedToUserId: 5, clearLoginUser: true })
  })

  it('sends salesTeamName when a team is picked', () => {
    expect(buildAssignmentPayload({ salesTeamName: 'North Sales' }))
      .toEqual({ salesTeamName: 'North Sales' })
  })

  it('sends the Clear flag (not a null name) when sales team is unassigned', () => {
    expect(buildAssignmentPayload({ salesTeamName: null }))
      .toEqual({ clearSalesTeam: true })
  })

  it('sends opsManagerId when an ops manager is picked', () => {
    expect(buildAssignmentPayload({ opsManagerId: 9 }))
      .toEqual({ opsManagerId: 9 })
  })

  it('sends the Clear flag (not a null id) when ops manager is unassigned', () => {
    expect(buildAssignmentPayload({ opsManagerId: null }))
      .toEqual({ clearOpsManager: true })
  })

  it('sends locationId when a location is picked', () => {
    expect(buildAssignmentPayload({ locationId: 3 }))
      .toEqual({ locationId: 3 })
  })

  it('sends the Clear flag (not a null id) when location is unassigned', () => {
    expect(buildAssignmentPayload({ locationId: null }))
      .toEqual({ clearLocation: true })
  })

  it('mixes set and clear across all five fields', () => {
    expect(buildAssignmentPayload({
      assignedToUserId: 5, loginUserId: null,
      salesTeamName: 'North Sales', opsManagerId: null, locationId: 3,
    })).toEqual({
      assignedToUserId: 5, clearLoginUser: true,
      salesTeamName: 'North Sales', clearOpsManager: true, locationId: 3,
    })
  })
})

describe('hasAssignmentChange', () => {
  it('is false when nothing was touched', () => {
    expect(hasAssignmentChange({})).toBe(false)
  })
  it('is true for a set or a clear', () => {
    expect(hasAssignmentChange({ assignedToUserId: 1 })).toBe(true)
    expect(hasAssignmentChange({ loginUserId: null })).toBe(true)
    expect(hasAssignmentChange({ salesTeamName: 'North Sales' })).toBe(true)
    expect(hasAssignmentChange({ opsManagerId: null })).toBe(true)
    expect(hasAssignmentChange({ locationId: 3 })).toBe(true)
  })
})
