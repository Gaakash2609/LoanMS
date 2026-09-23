import { describe, it, expect } from 'vitest'
import { auditActionColor } from '@/pages/DashboardPage'

// ── Phase 9 — Recent Activity final gap. Only the pure helper is unit-
// tested here: which AuditLogs.Action maps to which dot colour, same
// Created/Updated/Deleted convention AuditLogPage's actionMeta already
// uses for the existing Audit Log page, so the two surfaces agree.
describe('auditActionColor — Recent Activity Audit-row dot colour', () => {
  it('maps Created to the success colour', () => {
    expect(auditActionColor('Created')).toBe('var(--success)')
  })

  it('maps Deleted to the danger colour', () => {
    expect(auditActionColor('Deleted')).toBe('var(--danger)')
  })

  it('maps Updated to the accent colour', () => {
    expect(auditActionColor('Updated')).toBe('var(--accent)')
  })

  it('falls back to the accent colour for StatusChanged and unknown actions', () => {
    expect(auditActionColor('StatusChanged')).toBe('var(--accent)')
    expect(auditActionColor(undefined)).toBe('var(--accent)')
  })
})
