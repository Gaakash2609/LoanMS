import type { Loan } from '@/types'

// Stages that fire an automatic lender-RM email in legacy (POST_UW_STAGES /
// EMAIL_TRIGGER_STAGES in lender-email-workflow.js: offer, approved,
// acceptance, disbursed). Only Approved and Disbursed are reproduced here —
// the backend's real LoanStatus enum (Draft/Submitted/UnderReview/Approved/
// Rejected/Disbursed/Closed) has no "Offer" or "Acceptance" value at all,
// so those two legacy trigger stages have no status transition to hook
// into in this data model; see handoff note.
export const AUTO_EMAIL_TRIGGER_STAGES = ['Approved', 'Disbursed']

// Maps a LoanStatus (as used by React's status-update flow) to the
// lower-case stage key EMAIL_TEMPLATES/STAGE_EMAIL_CONFIG key in legacy.
export const STATUS_TO_STAGE_KEY: Record<string, string> = {
  Approved: 'approved', Disbursed: 'disbursed',
}

export const LOAN_TYPE_LABEL: Record<string, string> = {
  personal_loan: 'Personal Loan', business_loan: 'Business Loan', home_loan: 'Home Loan',
  new_car_loan: 'New Car Loan', used_car_loan: 'Used Car Loan',
}

export const STAGE_OPTIONS = [
  { key: 'offer', label: 'Offer Stage Initiated' },
  { key: 'approved', label: 'Application Approved' },
  { key: 'acceptance', label: 'Acceptance — Documents Pending' },
  { key: 'disbursed', label: 'Disbursement Confirmed' },
  { key: 'statusEnquiry', label: 'Status Enquiry (manual)' },
]

function ts() {
  const now = new Date()
  return now.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
    + ' ' + now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
}

// Reproduces legacy's _wrapEmail + _appSummaryTable + _emailSignature +
// EMAIL_TEMPLATES[stage] exactly (same copy, same table rows, same
// gradient header), substituting only the field names available on
// React's Loan/Customer types. manualNote mirrors legacy's
// ctx.manualNote — the comment entered alongside a stage change, appended
// as an "Additional Note (from Processing Team)" line, exactly as legacy
// does for the auto-fired email.
export function buildSubjectAndBody(loan: Loan, rmName: string, stageKey: string, manualNote?: string) {
  const bankName = loan.bankLines?.[0]?.bankName || 'Lender'
  const custName = loan.customer.fullName
  const ref = loan.loanNumber
  const stageLabel = STAGE_OPTIONS.find(s => s.key === stageKey)?.label || stageKey

  const subjectMap: Record<string, string> = {
    offer: `EFIN Ref ${ref} | ${custName} — Offer Stage Initiated | ${bankName}`,
    approved: `EFIN Ref ${ref} | ${custName} — Application Approved | ${bankName}`,
    acceptance: `EFIN Ref ${ref} | ${custName} — Acceptance Stage — Documents Pending | ${bankName}`,
    disbursed: `EFIN Ref ${ref} | ${custName} — Disbursement Confirmed | ${bankName}`,
    statusEnquiry: `EFIN Ref ${ref} | ${custName} — Status Update Request | ${bankName}`,
  }

  const noteHtml = manualNote && manualNote.trim()
    ? `<p><em>Additional Note (from Processing Team):</em> ${manualNote.trim()}</p>` : ''

  const bodyMap: Record<string, string> = {
    offer: `<p>We are pleased to inform you that the loan application for <strong>${custName}</strong> (Application Reference: <strong>${ref}</strong>) has successfully progressed to the <strong>Offer Stage</strong> following completion of underwriting evaluation.</p>
      <p>Kindly review the case and revert with the <strong>initial offer terms</strong> including sanctioned amount, rate of interest, tenure, and any applicable conditions at your earliest convenience.</p>
      ${noteHtml}
      <p>We look forward to your prompt response.</p>`,
    approved: `<p>We are delighted to inform you that the loan application for <strong>${custName}</strong> (Ref: <strong>${ref}</strong>) has been <strong>approved</strong>.</p>
      <p>Kindly coordinate with us for the next steps including sanction letter issuance, acceptance formalities, and disbursement scheduling. Please confirm receipt of this communication and advise on the expected timeline.</p>
      ${noteHtml}`,
    acceptance: `<p>The loan file for <strong>${custName}</strong> (Ref: <strong>${ref}</strong>) has moved to the <strong>Acceptance Stage</strong>.</p>
      <p>The customer acceptance documentation is being prepared/collected. We will share the duly executed acceptance set shortly. In parallel, please advise if there are any additional pre-disbursement conditions or documentation requirements pending at your end.</p>
      ${noteHtml}`,
    disbursed: `<p>We wish to confirm that the loan for <strong>${custName}</strong> (Ref: <strong>${ref}</strong>) has been successfully <strong>disbursed</strong>.</p>
      <p>Kindly share the <strong>UTR / NEFT reference number</strong>, disbursed amount, and the credit date at your earliest so we can update our records accordingly.</p>
      ${noteHtml}
      <p>Thank you for your continued support on this case.</p>`,
    statusEnquiry: `<p>We are writing to request a <strong>status update</strong> on the loan application for <strong>${custName}</strong> (Ref: <strong>${ref}</strong>), currently at the <strong>${stageLabel}</strong> stage.</p>
      <p>Please advise on the current status and expected timeline at your earliest convenience.</p>
      ${noteHtml}`,
  }

  const summaryTable = `
    <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:13px">
      <tr style="background:#f0f8ff"><td style="padding:7px 12px;border:1px solid #dde8f5;font-weight:600;width:40%">Applicant Name</td><td style="padding:7px 12px;border:1px solid #dde8f5">${custName || '—'}</td></tr>
      <tr><td style="padding:7px 12px;border:1px solid #dde8f5;font-weight:600;background:#f9fafb">Application Ref</td><td style="padding:7px 12px;border:1px solid #dde8f5"><strong>${ref}</strong></td></tr>
      <tr style="background:#f0f8ff"><td style="padding:7px 12px;border:1px solid #dde8f5;font-weight:600">Loan Type</td><td style="padding:7px 12px;border:1px solid #dde8f5">${LOAN_TYPE_LABEL[loan.loanType] || loan.loanType || '—'}</td></tr>
      <tr><td style="padding:7px 12px;border:1px solid #dde8f5;font-weight:600;background:#f9fafb">Loan Amount</td><td style="padding:7px 12px;border:1px solid #dde8f5">${loan.requestedAmount ? '₹' + Number(loan.requestedAmount).toLocaleString('en-IN') : '—'}</td></tr>
      <tr style="background:#f0f8ff"><td style="padding:7px 12px;border:1px solid #dde8f5;font-weight:600">Bank / NBFC</td><td style="padding:7px 12px;border:1px solid #dde8f5">${bankName}</td></tr>
      <tr><td style="padding:7px 12px;border:1px solid #dde8f5;font-weight:600;background:#f9fafb">Current Stage</td><td style="padding:7px 12px;border:1px solid #dde8f5">${loan.status}</td></tr>
    </table>`

  const signature = `
    <hr style="border:none;border-top:1px solid #e2e8f0;margin:18px 0">
    <p style="font-size:13px;color:#4a5568;margin:0">Warm regards,<br><strong>Loan Processing Team</strong><br>EFIN Financial Services<br>
    <em style="font-size:11px;color:#8a95a3">[This message was generated automatically by EFIN Workflow Engine]</em></p>`

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;color:#1a1a2e">
      <div style="background:linear-gradient(135deg,#0047AB,#002970);padding:24px 28px;border-radius:10px 10px 0 0">
        <div style="font-size:22px;font-weight:900;color:#fff;letter-spacing:-0.5px">EFIN — Loan Processing</div>
        <div style="font-size:12px;color:rgba(255,255,255,0.6);margin-top:4px">Case Communication · ${ts()}</div>
      </div>
      <div style="background:#f6f8fb;border:1px solid #e2e8f0;border-top:none;padding:28px;border-radius:0 0 10px 10px">
        <div style="background:#fff;border-radius:8px;padding:22px;border:1px solid #e2e8f0;font-size:14px;line-height:1.7;color:#1a1a2e">
          <p>Dear <strong>${rmName || 'Team'}</strong>,</p>
          ${bodyMap[stageKey] || bodyMap.statusEnquiry}
          ${summaryTable}
        </div>
        <div style="margin-top:14px;font-size:11px;color:#8a95a3;text-align:center">
          This is a communication generated by the EFIN Loan Management System. Application Reference: <strong>${ref}</strong>.
        </div>
      </div>
      ${signature}
    </div>`

  return { subject: subjectMap[stageKey] || subjectMap.statusEnquiry, html }
}
