// ── Email Templates (Settings → Templates) ──────────────────────────────
// Transcribed verbatim from legacy's STG_TPL_DEFAULTS (efin-app.js:36729)
// and the definition table in stgRenderAllTemplates (efin-app.js:36750).
// The subject/body strings are the exact defaults the legacy app ships and
// EmailService falls back to, so they are not reworded here.

export interface EmailTemplateContent {
  subject: string
  body: string
}

/** Legacy's built-in defaults. A key absent from the API means "use this". */
export const EMAIL_TEMPLATE_DEFAULTS: Record<string, EmailTemplateContent> = {
  invitation: { subject: "You've been invited to EFIN — Set your password", body: "Hi {{name}},\n\nYour account has been created on the EFIN Loan Management System.\n\nLogin Email: {{email}}\nTemporary Password: {{password}}\nUser ID: {{uid}}\nRole: {{role}}\n\nPlease log in and change your password immediately.\n\n{{signature}}" },
  pwreset: { subject: "EFIN — Your Password Has Been Reset", body: "Hi {{name}},\n\nYour EFIN account password has been reset by the administrator.\n\nLogin Email: {{email}}\nNew Password: {{password}}\n\nPlease log in immediately and change this password.\n\n{{signature}}" },
  stage: { subject: "EFIN Update: {{app_id}} {{name}} → {{stage}}", body: "Dear {{name}},\n\nYour loan application (Ref: {{app_id}}) has moved to a new stage: {{stage}}.\n\nLoan Amount: {{amount}}\n\nPlease log in to EFIN for full details and next steps.\n\n{{signature}}" },
  approval: { subject: "EFIN — Loan Approved · {{app_id}} · {{name}}", body: "Dear {{name}},\n\nCongratulations! Your {{loan_type}} application (Ref: {{app_id}}) has been approved.\n\nSanctioned Amount: {{amount}}\nRate of Interest:  {{roi}}\n\nOur team will contact you shortly with disbursement details. Please keep your KYC documents ready.\n\n{{signature}}" },
  disburse: { subject: "EFIN — Loan Disbursed · {{app_id}} · {{name}}", body: "Dear {{name}},\n\nYour {{loan_type}} (Ref: {{app_id}}) has been successfully disbursed to your registered bank account.\n\nDisbursed Amount: {{amount}}\nMonthly EMI:      {{emi}}\nFirst EMI Date:   {{emi_date}}\n\nPlease ensure sufficient balance in your account before each EMI date.\n\n{{signature}}" },
  rejection: { subject: "EFIN — Application Update · {{app_id}} · {{name}}", body: "Dear {{name}},\n\nAfter careful review, we regret to inform you that your {{loan_type}} application (Ref: {{app_id}}) could not be approved at this time.\n\nReason: {{reason}}\n\nThis decision does not prevent you from reapplying in the future. Please contact your relationship manager if you have any questions.\n\n{{signature}}" },
  docs: { subject: "EFIN — Documents Required · {{app_id}} · {{name}}", body: "Dear {{name}},\n\nTo continue processing your loan application (Ref: {{app_id}}), we require the following documents:\n\n{{doc_list}}\n\nInstructions: {{instructions}}\n\nPlease submit all documents within 3 working days to avoid delays.\n\n{{signature}}" },
  emi: { subject: "EFIN — EMI Reminder · {{emi_amount}} due {{due_date}}", body: "Dear {{name}},\n\nThis is a friendly reminder that your EMI payment of {{emi_amount}} is due on {{due_date}}.\n\nApplication ID: {{app_id}}\nBank Account:   {{bank}}\n\nPlease ensure sufficient balance in your linked account before the due date to avoid penalties.\n\n{{signature}}" },
}

export type TemplateBadge = 'auto' | 'admin' | 'manual' | 'modal'

export interface EmailTemplateDef {
  key: string
  icon: string
  title: string
  sub: string
  badge: TemplateBadge
  /** Placeholder tokens this template understands; null for the modal-only one. */
  vars: string | null
}

/** Legacy's nine rows, in legacy's order (stgRenderAllTemplates defs[]). */
export const EMAIL_TEMPLATE_DEFS: EmailTemplateDef[] = [
  { key: 'invitation', icon: '🎉', title: 'User Invitation',           sub: 'Auto-sent when a new user is created · To: new user email',                badge: 'auto',   vars: '{{name}} {{email}} {{password}} {{uid}} {{role}} {{signature}}' },
  { key: 'pwreset',    icon: '🔐', title: 'Password Reset',            sub: "Sent when admin resets a user's password · To: affected user",             badge: 'admin',  vars: '{{name}} {{email}} {{password}} {{uid}} {{signature}}' },
  { key: 'stage',      icon: '📋', title: 'Stage Change Notification', sub: 'Sent on every status change · To: applicant + assigned user',              badge: 'auto',   vars: '{{name}} {{app_id}} {{stage}} {{amount}} {{signature}}' },
  { key: 'approval',   icon: '✅', title: 'Loan Approval',             sub: 'Status moves to Approved · To: applicant',                                 badge: 'auto',   vars: '{{name}} {{app_id}} {{loan_type}} {{amount}} {{roi}} {{signature}}' },
  { key: 'disburse',   icon: '🏦', title: 'Loan Disbursement',         sub: 'Status moves to Disbursed · To: applicant',                                badge: 'auto',   vars: '{{name}} {{app_id}} {{loan_type}} {{amount}} {{emi}} {{emi_date}} {{signature}}' },
  { key: 'rejection',  icon: '❌', title: 'Loan Rejection',            sub: 'Status moves to Rejected · To: applicant',                                 badge: 'auto',   vars: '{{name}} {{app_id}} {{loan_type}} {{reason}} {{signature}}' },
  { key: 'docs',       icon: '📎', title: 'Document Request',          sub: 'Manually triggered by your team · To: applicant',                          badge: 'manual', vars: '{{name}} {{app_id}} {{doc_list}} {{instructions}} {{signature}}' },
  { key: 'emi',        icon: '💳', title: 'EMI Payment Reminder',      sub: 'Manual or scheduled trigger · To: applicant',                              badge: 'manual', vars: '{{name}} {{app_id}} {{emi_amount}} {{due_date}} {{bank}} {{signature}}' },
  // Legacy shows this row but makes it non-editable here — its content is
  // authored inside the Deal Confirmation modal on each application, which is
  // why it has no default and no Save/Reset controls.
  { key: 'deal',       icon: '📄', title: 'Deal Confirmation',         sub: 'Fully customisable inside the Deal Confirmation modal on each application', badge: 'modal',  vars: null },
]

export const BADGE_LABEL: Record<TemplateBadge, string> = {
  auto: 'AUTO', admin: 'ADMIN TRIGGER', manual: 'MANUAL', modal: 'IN MODAL',
}
