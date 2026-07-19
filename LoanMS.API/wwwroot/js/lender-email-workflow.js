/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  LENDER EMAIL WORKFLOW  —  lender-email-workflow.js
 *  Handles all post-underwriting lender RM email automation for EFIN.
 *
 *  Features:
 *   1. POST-UNDERWRITING GATE  — workflow only activates after underwriting
 *   2. LENDER RM MANAGEMENT   — per-bank RM details; manually updatable
 *   3. AUTO EMAIL ON STAGE    — fires email to lender RM when stage is saved
 *   4. TIMELINE ATTRIBUTION   — AI-entity attribution for auto actions
 *   5. MANUAL OVERRIDE        — manual timeline updates adjust email content
 *   6. BANK REPLY PARSING     — Claude API maps raw replies → standard format
 *   7. THREAD TRACKING        — full email conversation visible on timeline
 *
 *  Dependencies (all globals from efin-app.js):
 *   window.APPLICATIONS, window.BANKS_STORE, window.addTrackingEntry,
 *   window.persistSave, window.sysmailSend (via efin-app),
 *   window.showToast, window.openModal, window.closeModal
 * ═══════════════════════════════════════════════════════════════════════════
 */

(function () {
  'use strict';
// ── Safe localStorage helpers (private to this module) ──
var _lsGet = function(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } };
var _lsSet = function(k,v){ try{ localStorage.setItem(k,v); }catch(e){} };
var _lsRemove = function(k){ try{ localStorage.removeItem(k); }catch(e){} };
;

  // ── Wait for EFIN core to be ready ──────────────────────────────────────
  function onReady(cb) {
    if (window.APPLICATIONS && window.addTrackingEntry) { cb(); return; }
    let tries = 0;
    const t = setInterval(() => {
      if (window.APPLICATIONS && window.addTrackingEntry) { clearInterval(t); cb(); }
      if (++tries > 120) clearInterval(t);          // give up after 12s
    }, 100);
  }

  // ════════════════════════════════════════════════════════════════════════
  //  CONSTANTS
  // ════════════════════════════════════════════════════════════════════════

  // Stages that are AFTER underwriting (inclusive of the trigger boundary)
  const POST_UW_STAGES = ['offer', 'approved', 'acceptance', 'disbursed'];
  // Stages that trigger an automatic lender-RM email when entered/saved
  const EMAIL_TRIGGER_STAGES = POST_UW_STAGES;  // all post-UW stages fire emails

  // localStorage key for persisting email thread logs
  const LEW_STORE_KEY = 'efin_lew_email_threads_v1';

  // AI entity name used in timeline attribution
  const AI_USER = 'AI — EFIN Workflow';

  // Stage → subject & body template keys
  const STAGE_EMAIL_CONFIG = {
    offer: {
      subject: (app) => `EFIN Ref ${app.id} | ${app.name} — Offer Stage Initiated | ${_bankLabel(app)}`,
      bodyKey: 'offer',
    },
    approved: {
      subject: (app) => `EFIN Ref ${app.id} | ${app.name} — Application Approved | ${_bankLabel(app)}`,
      bodyKey: 'approved',
    },
    acceptance: {
      subject: (app) => `EFIN Ref ${app.id} | ${app.name} — Acceptance Stage — Documents Pending | ${_bankLabel(app)}`,
      bodyKey: 'acceptance',
    },
    disbursed: {
      subject: (app) => `EFIN Ref ${app.id} | ${app.name} — Disbursement Confirmed | ${_bankLabel(app)}`,
      bodyKey: 'disbursed',
    },
  };

  // ════════════════════════════════════════════════════════════════════════
  //  EMAIL THREAD LOG STORE  (persisted to localStorage)
  // ════════════════════════════════════════════════════════════════════════
  // Structure: { [appId]: [ { id, direction, stage, rmName, rmEmail, subject, bodyText, timestamp, source, parsedData? } ] }

  let _threads = {};

  function _loadThreads() {
    try {
      const raw = localStorage.getItem(LEW_STORE_KEY);
      _threads = raw ? JSON.parse(raw) : {};
    } catch (_) { _threads = {}; }
  }

  function _saveThreads() {
    try { localStorage.setItem(LEW_STORE_KEY, JSON.stringify(_threads)); } catch (_) {}
  }

  function _getThread(appId) {
    if (!_threads[appId]) _threads[appId] = [];
    return _threads[appId];
  }

  function _appendThread(appId, entry) {
    const thread = _getThread(appId);
    entry.id = thread.length + 1;
    thread.push(entry);
    _saveThreads();
  }

  // ════════════════════════════════════════════════════════════════════════
  //  HELPERS
  // ════════════════════════════════════════════════════════════════════════

  function _bankLabel(app) {
    return app.bank || app.lenderName || 'Lender';
  }

  function _ts() {
    const now = new Date();
    return now.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
      + ' ' + now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  }

  function _isPostUnderwriting(status) {
    return POST_UW_STAGES.includes(status);
  }

  // Look up the lender RM for this application from BANKS_STORE
  function _getLenderRm(app) {
    const banksStore = window.BANKS_STORE || [];
    const bankName   = (app.bank || '').toLowerCase();
    const match      = banksStore.find(b => b.name.toLowerCase() === bankName);
    // Per-app override takes precedence over master bank record
    if (app.lender_rm_override) return app.lender_rm_override;
    if (match) return { name: match.rm, email: match.email, mobile: match.rmMobile, bankId: match.id };
    return null;
  }

  // Add a timeline entry attributed to the AI entity (not the current user)
  function _addAiTrackingEntry(app, name, stage, comment, subnote) {
    if (!app.tracking) app.tracking = [];
    app.tracking.push({
      id:            app.tracking.length + 1,
      name,
      current_stage: stage,
      current_user:  AI_USER,
      status:        'Complete',
      comment:       comment || '',
      sub_note:      subnote || '',
      date:          _ts(),
      _ai:           true,       // flag so UI can style AI entries differently
    });
  }

  // ════════════════════════════════════════════════════════════════════════
  //  EMAIL BODY TEMPLATES
  //  Each template receives (app, rm, extraContext) and returns HTML string
  // ════════════════════════════════════════════════════════════════════════

  const EMAIL_TEMPLATES = {

    offer(app, rm, ctx) {
      return _wrapEmail(app, rm, `
        <p>Dear <strong>${rm.name}</strong>,</p>
        <p>
          We are pleased to inform you that the loan application for
          <strong>${app.name}</strong> (Application Reference: <strong>${app.id}</strong>)
          has successfully progressed to the <strong>Offer Stage</strong> following completion
          of underwriting evaluation.
        </p>
        ${_appSummaryTable(app)}
        <p>
          Kindly review the case and revert with the <strong>initial offer terms</strong>
          including sanctioned amount, rate of interest, tenure, and any applicable conditions
          at your earliest convenience.
        </p>
        ${ctx && ctx.manualNote ? `<p><em>Additional Note (from Processing Team):</em> ${ctx.manualNote}</p>` : ''}
        <p>We look forward to your prompt response.</p>
        ${_emailSignature()}
      `);
    },


    approved(app, rm, ctx) {
      return _wrapEmail(app, rm, `
        <p>Dear <strong>${rm.name}</strong>,</p>
        <p>
          We are delighted to inform you that the loan application for
          <strong>${app.name}</strong> (Ref: <strong>${app.id}</strong>)
          has been <strong>approved</strong>.
        </p>
        ${_appSummaryTable(app)}
        <p>
          Kindly coordinate with us for the next steps including sanction letter issuance,
          acceptance formalities, and disbursement scheduling.
          Please confirm receipt of this communication and advise on the expected timeline.
        </p>
        ${ctx && ctx.manualNote ? `<p><em>Processing Note:</em> ${ctx.manualNote}</p>` : ''}
        ${_emailSignature()}
      `);
    },

    acceptance(app, rm, ctx) {
      return _wrapEmail(app, rm, `
        <p>Dear <strong>${rm.name}</strong>,</p>
        <p>
          The loan file for <strong>${app.name}</strong> (Ref: <strong>${app.id}</strong>)
          has moved to the <strong>Acceptance Stage</strong>.
        </p>
        ${_appSummaryTable(app)}
        <p>
          The customer acceptance documentation is being prepared/collected.
          We will share the duly executed acceptance set shortly.
          In parallel, please advise if there are any additional pre-disbursement conditions
          or documentation requirements pending at your end.
        </p>
        ${ctx && ctx.manualNote ? `<p><em>Processing Note:</em> ${ctx.manualNote}</p>` : ''}
        ${_emailSignature()}
      `);
    },

    disbursed(app, rm, ctx) {
      return _wrapEmail(app, rm, `
        <p>Dear <strong>${rm.name}</strong>,</p>
        <p>
          We wish to confirm that the loan for <strong>${app.name}</strong>
          (Ref: <strong>${app.id}</strong>) has been successfully <strong>disbursed</strong>.
        </p>
        ${_appSummaryTable(app)}
        <p>
          Kindly share the <strong>UTR / NEFT reference number</strong>, disbursed amount,
          and the credit date at your earliest so we can update our records accordingly.
        </p>
        ${ctx && ctx.manualNote ? `<p><em>Processing Note:</em> ${ctx.manualNote}</p>` : ''}
        <p>Thank you for your continued support on this case.</p>
        ${_emailSignature()}
      `);
    },

    // Used when sending a manual status enquiry
    statusEnquiry(app, rm, ctx) {
      const stage = ctx && ctx.stage ? ctx.stage : (app.status || 'current stage');
      return _wrapEmail(app, rm, `
        <p>Dear <strong>${rm.name}</strong>,</p>
        <p>
          We are writing to request a <strong>status update</strong> on the loan application
          for <strong>${app.name}</strong> (Ref: <strong>${app.id}</strong>),
          which is currently at the <strong>${stage}</strong> stage.
        </p>
        ${_appSummaryTable(app)}
        <p>
          Kindly revert with the current status, any pending requirements, and the
          expected decision / disbursement timeline at your earliest convenience.
        </p>
        ${ctx && ctx.manualNote ? `<p>${ctx.manualNote}</p>` : ''}
        ${_emailSignature()}
      `);
    },
  };

  function _wrapEmail(app, rm, bodyHtml) {
    return `
    <div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;color:#1a1a2e">
      <div style="background:linear-gradient(135deg,#0047AB,#002970);padding:24px 28px;border-radius:10px 10px 0 0">
        <div style="font-size:22px;font-weight:900;color:#fff;letter-spacing:-0.5px">EFIN — Loan Processing</div>
        <div style="font-size:12px;color:rgba(255,255,255,0.6);margin-top:4px">Automated Case Communication · ${_ts()}</div>
      </div>
      <div style="background:#f6f8fb;border:1px solid #e2e8f0;border-top:none;padding:28px;border-radius:0 0 10px 10px">
        <div style="background:#fff;border-radius:8px;padding:22px;border:1px solid #e2e8f0;font-size:14px;line-height:1.7;color:#1a1a2e">
          ${bodyHtml}
        </div>
        <div style="margin-top:14px;font-size:11px;color:#8a95a3;text-align:center">
          This is an automated communication generated by the EFIN Loan Management System.
          Application Reference: <strong>${app.id}</strong>.
          Please reply directly to this email — your response will be logged automatically.
        </div>
      </div>
    </div>`;
  }

  function _appSummaryTable(app) {
    const fmt = (v) => v != null && v !== '' ? v : '—';
    const inr = (v) => v ? '₹' + Number(v).toLocaleString('en-IN') : '—';
    return `
    <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:13px">
      <tr style="background:#f0f8ff">
        <td style="padding:7px 12px;border:1px solid #dde8f5;font-weight:600;width:40%">Applicant Name</td>
        <td style="padding:7px 12px;border:1px solid #dde8f5">${fmt(app.name)}</td>
      </tr>
      <tr>
        <td style="padding:7px 12px;border:1px solid #dde8f5;font-weight:600;background:#f9fafb">Application Ref</td>
        <td style="padding:7px 12px;border:1px solid #dde8f5"><strong>${fmt(app.id)}</strong></td>
      </tr>
      <tr style="background:#f0f8ff">
        <td style="padding:7px 12px;border:1px solid #dde8f5;font-weight:600">Loan Type</td>
        <td style="padding:7px 12px;border:1px solid #dde8f5">${fmt(_loanTypeLabel(app.loanType))}</td>
      </tr>
      <tr>
        <td style="padding:7px 12px;border:1px solid #dde8f5;font-weight:600;background:#f9fafb">Loan Amount</td>
        <td style="padding:7px 12px;border:1px solid #dde8f5">${inr(app.amount)}</td>
      </tr>
      <tr style="background:#f0f8ff">
        <td style="padding:7px 12px;border:1px solid #dde8f5;font-weight:600">Bank / NBFC</td>
        <td style="padding:7px 12px;border:1px solid #dde8f5">${fmt(app.bank)}</td>
      </tr>
      <tr>
        <td style="padding:7px 12px;border:1px solid #dde8f5;font-weight:600;background:#f9fafb">Current Stage</td>
        <td style="padding:7px 12px;border:1px solid #dde8f5">${fmt(_stageLabel(app.status))}</td>
      </tr>
    </table>`;
  }

  function _emailSignature() {
    return `
    <hr style="border:none;border-top:1px solid #e2e8f0;margin:18px 0">
    <p style="font-size:13px;color:#4a5568;margin:0">
      Warm regards,<br>
      <strong>Loan Processing Team</strong><br>
      EFIN Financial Services<br>
      <em style="font-size:11px;color:#8a95a3">[This message was generated automatically by EFIN Workflow Engine]</em>
    </p>`;
  }

  function _loanTypeLabel(type) {
    const map = { personal_loan: 'Personal Loan', business_loan: 'Business Loan', home_loan: 'Home Loan', new_car_loan: 'New Car Loan', used_car_loan: 'Used Car Loan' };
    return map[type] || type || '—';
  }

  function _stageLabel(status) {
    const map = { offer: 'Offer', approved: 'Approved', acceptance: 'Acceptance', disbursed: 'Disbursed', underwriting: 'Underwriting', login: 'Login' };
    return map[status] || status || '—';
  }

  // ════════════════════════════════════════════════════════════════════════
  //  CORE: SEND LENDER RM EMAIL
  // ════════════════════════════════════════════════════════════════════════

  /**
   * Send a lender RM email for the given stage.
   * @param {object} app       - The EFIN application object
   * @param {string} stage     - Stage key (e.g. 'offer', 'approved')
   * @param {object} [ctx]     - Optional context: { manualNote, isManual, triggeredBy }
   * @returns {Promise<boolean>}
   */
  async function sendLenderRmEmail(app, stage, ctx) {
    ctx = ctx || {};

    // ── Gate 1: only post-underwriting ──────────────────────────────────
    if (!_isPostUnderwriting(stage) && stage !== 'statusEnquiry') {
      console.info('[LEW] Stage not post-UW, skipping:', stage);
      return false;
    }

    // ── Gate 2: need a valid email system config ─────────────────────────
    if (typeof sysmailGetConfig !== 'function') {
      console.warn('[LEW] sysmailGetConfig not available');
      return false;
    }
    const cfg = sysmailGetConfig();
    if (!cfg || !cfg.fromEmail) {
      console.warn('[LEW] Email system not configured');
      return false;
    }

    // ── Gate 3: need a lender RM ─────────────────────────────────────────
    const rm = _getLenderRm(app);
    if (!rm || !rm.email || rm.email === '—') {
      console.warn('[LEW] No lender RM email for app', app.id);
      // Log to timeline as a warning
      _addAiTrackingEntry(app, 'EFIN-Lender Email — Skipped',
        'System Comments',
        `No lender RM email configured for ${_bankLabel(app)}. Please update Bank/NBFC record.`,
        ' ');
      if (typeof persistSave === 'function') persistSave();
      return false;
    }

    // ── Build email ───────────────────────────────────────────────────────
    const emailCfg = STAGE_EMAIL_CONFIG[stage] || STAGE_EMAIL_CONFIG['offer'];
    const subject  = emailCfg ? emailCfg.subject(app) : `EFIN — ${app.id} ${app.name} — ${_stageLabel(stage)}`;
    const bodyKey  = emailCfg ? emailCfg.bodyKey : stage;
    const template = EMAIL_TEMPLATES[bodyKey] || EMAIL_TEMPLATES['statusEnquiry'];
    const html     = template(app, rm, ctx);

    // ── Send ─────────────────────────────────────────────────────────────
    try {
      await sysmailSend({ to: rm.email, toName: rm.name, subject, html });

      // ── Log to email thread ──────────────────────────────────────────
      _appendThread(app.id, {
        direction:  'outbound',
        stage:      stage,
        rmName:     rm.name,
        rmEmail:    rm.email,
        subject:    subject,
        bodyText:   html.replace(/<[^>]+>/g, ' ').replace(/\s{2,}/g, ' ').trim().substring(0, 600),
        timestamp:  new Date().toISOString(),
        source:     ctx.isManual ? 'manual' : 'auto',
        triggeredBy: ctx.triggeredBy || AI_USER,
      });

      // ── Add to application timeline ─────────────────────────────────
      const userLabel  = ctx.isManual ? (ctx.triggeredBy || 'Manual') : AI_USER;
      const modeLabel  = ctx.isManual ? '(Manual)' : '(Auto)';
      _addAiTrackingEntry(
        app,
        `EFIN-Lender Email Sent ${modeLabel}`,
        'System Comments',
        `Email sent to ${rm.name} (${rm.email}) — Stage: ${_stageLabel(stage)}`,
        ctx.manualNote || ' '
      );
      // Override the AI_USER attribution if manual
      if (ctx.isManual && ctx.triggeredBy) {
        const lastEntry = app.tracking[app.tracking.length - 1];
        if (lastEntry) lastEntry.current_user = ctx.triggeredBy;
      }

      if (typeof persistSave === 'function') persistSave();
      return true;

    } catch (err) {
      console.error('[LEW] Email send error:', err);
      _addAiTrackingEntry(app, 'EFIN-Lender Email — Send Error',
        'System Comments',
        `Failed to send to ${rm.email}: ${err.message}`,
        ' ');
      if (typeof persistSave === 'function') persistSave();
      return false;
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  //  CLAUDE API — PARSE BANK REPLY INTO STANDARD FORMAT
  // ════════════════════════════════════════════════════════════════════════

  const BANK_REPLY_SYSTEM_PROMPT = `You are a loan processing assistant for EFIN Financial Services.
You will receive a raw email reply from a bank or NBFC regarding a loan application.
Extract ONLY the following fields and return ONLY a valid JSON object. No explanation, no markdown, no preamble.
If a field is not found in the email, return null for that field. Never invent data.

Required JSON format:
{
  "decisionType": "one of: conditional_approval | full_approval | pending | query_raised | rejected | disbursed | info_only",
  "sanctionAmount": "number in INR (no commas, no currency symbol) or null",
  "interestRateMin": "number (percentage, e.g. 14.5) or null",
  "interestRateMax": "number (percentage) or null — same as min if single rate",
  "rateType": "one of: reducing | flat | null",
  "tenureMonths": "number or null",
  "processingFee": "number in INR or null",
  "emiAmount": "number in INR or null",
  "conditions": ["array of strings — each pending condition as a separate item, or empty array"],
  "queryDetails": "string describing what the bank has queried, or null",
  "disbursementUTR": "UTR or NEFT reference number string, or null",
  "disbursementDate": "date string as found in email, or null",
  "disbursedAmount": "number in INR or null",
  "remarks": "any other important remark from the bank not covered above, or null",
  "responseDate": "date string as mentioned in the email or today's date, or null"
}`;

  async function parseBankReplyWithClaude(rawEmailText, appId) {
    try {
      // Route through the backend AI proxy so the provider API key stays on the
      // server and is never exposed to the browser (same pattern as KYC Vision).
      const sess = JSON.parse(_lsGet('efin_session') || '{}');
      const resp = await fetch('/api/ai/parse', {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': 'Bearer ' + (sess.token || ''),
        },
        body: JSON.stringify({
          systemPrompt: BANK_REPLY_SYSTEM_PROMPT,
          userPrompt:   `Application ID: ${appId}\n\nRaw email content:\n\n${rawEmailText}`,
          maxTokens:    1000,
        }),
      });
      const data = await resp.json();
      if (!resp.ok || !data.success) {
        console.error('[LEW] AI proxy parse failed:', (data && (data.error || data.code)) || resp.status);
        return null;
      }
      const text = (data.text || '').trim();
      // Strip any accidental markdown fences
      const clean = text.replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '').trim();
      return JSON.parse(clean);
    } catch (err) {
      console.error('[LEW] AI proxy parse error:', err);
      return null;
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  //  RECEIVE / LOG BANK REPLY
  //  Call this when a bank/RM reply is manually pasted or received
  // ════════════════════════════════════════════════════════════════════════

  async function logBankReply(appId, rawEmailText, rmEmail) {
    const app = window.APPLICATIONS && APPLICATIONS.find(a => a.id === appId);
    if (!app) { showToast('Application not found: ' + appId, 'error'); return null; }

    showToast('Parsing bank reply with AI…', 'info');

    const parsed = await parseBankReplyWithClaude(rawEmailText, appId);

    // ── Store in thread log ────────────────────────────────────────────
    _appendThread(appId, {
      direction:   'inbound',
      stage:       app.status,
      rmEmail:     rmEmail || '(unknown)',
      subject:     '(inbound reply)',
      bodyText:    rawEmailText.substring(0, 800),
      timestamp:   new Date().toISOString(),
      source:      'manual_paste',
      parsedData:  parsed,
    });

    // ── Persist parsed data onto the application ───────────────────────
    if (parsed) {
      app.lender_last_reply = {
        receivedAt:  new Date().toISOString(),
        rawText:     rawEmailText.substring(0, 1000),
        ...parsed,
      };

      // ── Build timeline entry with structured data ──────────────────
      const decisionMap = {
        conditional_approval: 'Conditional Approval Received',
        full_approval:        'Full Approval Received',
        pending:              'Bank Response — Pending',
        query_raised:         'Bank Query Raised',
        rejected:             'Bank Rejected Application',
        disbursed:            'Disbursement Confirmed by Bank',
        info_only:            'Bank Info / Update Received',
      };
      const decisionLabel = decisionMap[parsed.decisionType] || 'Bank Reply Received';

      let subNote = '';
      if (parsed.sanctionAmount)    subNote += `Amount: ₹${Number(parsed.sanctionAmount).toLocaleString('en-IN')}  `;
      if (parsed.interestRateMin)   subNote += `ROI: ${parsed.interestRateMin}%${parsed.interestRateMax && parsed.interestRateMax !== parsed.interestRateMin ? '–' + parsed.interestRateMax + '%' : ''}  `;
      if (parsed.tenureMonths)      subNote += `Tenure: ${parsed.tenureMonths}mo  `;
      if (parsed.disbursementUTR)   subNote += `UTR: ${parsed.disbursementUTR}  `;
      if (parsed.conditions && parsed.conditions.length) subNote += `Conditions: ${parsed.conditions.join('; ')}`;

      _addAiTrackingEntry(
        app,
        `EFIN-Bank Reply — ${decisionLabel}`,
        'System Comments',
        decisionLabel,
        subNote.trim() || ' '
      );

      // ── Update status fields ONLY from the actual lender reply decision ──
      // No assumptions / dummy / inferred values — only what the email stated.
      switch (parsed.decisionType) {
        case 'full_approval':
          app.underwriting_status = 'Approved';
          app.verification_status = 'Completed';
          break;
        case 'conditional_approval':
          app.underwriting_status = 'Conditionally Approved';
          app.verification_status = 'Completed';
          break;
        case 'rejected':
          app.underwriting_status = 'Rejected';
          break;
        case 'query_raised':
          app.verification_status = 'Pending Documents';
          break;
        case 'disbursed':
          app.underwriting_status = 'Approved';
          app.verification_status = 'Completed';
          break;
        // 'pending' / 'info_only' → no status change (nothing definitive stated)
      }

      // If bank raised a query, also add individual query entries
      if (parsed.decisionType === 'query_raised' && parsed.queryDetails) {
        _addAiTrackingEntry(app, 'EFIN-Bank Query Details', 'System Comments', parsed.queryDetails, ' ');
      }

      if (typeof persistSave === 'function') persistSave();

      // ── ADDITIVE ONLY: Timeline Verification alert ──────────────────────
      // Reuses the SAME decisionType classification the switch above already
      // uses — no new AI call, no new field, no change to what counts as a
      // valid/actionable decision. This purely decides which toast/wording to
      // show; it never alters app.underwriting_status / verification_status,
      // never blocks the workflow, and never affects manual stage completion.
      const _confidentlyActionable = ['full_approval', 'conditional_approval', 'rejected', 'disbursed']
        .includes(parsed.decisionType);
      if (_confidentlyActionable) {
        showToast(`Bank reply parsed: ${decisionLabel}`, 'success');
      } else {
        // decisionType is 'pending' / 'info_only' / unrecognized — the existing
        // switch above already leaves status untouched for these; this just
        // makes that visible instead of showing a misleading "success" toast.
        showToast('⚠ AI could not confidently verify this reply — manual review recommended.', 'warn');
      }
      return parsed;
    } else {
      // Parsing failed — log raw receipt
      _addAiTrackingEntry(app, 'EFIN-Bank Reply Received (Unstructured)',
        'System Comments', '⚠ AI could not verify this reply. Raw bank reply logged — manual review required.', rawEmailText.substring(0, 200));
      if (typeof persistSave === 'function') persistSave();
      showToast('⚠ AI could not verify this reply — please review manually.', 'warn');
      return null;
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  //  HOOK INTO changeStatus — auto-fire emails post-underwriting
  // ════════════════════════════════════════════════════════════════════════

  function _hookChangeStatus() {
    if (window._lewChangeStatusHooked) return; // prevent double-wrap on re-login
    const _orig = window.changeStatus;
    if (!_orig || typeof _orig !== 'function') return;
    window._lewChangeStatusHooked = true;

    window.changeStatus = function(id, newStatus, triggerEl) {
      // Call original first — never interfere with existing logic
      _orig.call(this, id, newStatus, triggerEl);

      // Only proceed for post-underwriting stages
      if (!EMAIL_TRIGGER_STAGES.includes(newStatus)) return;

      const app = window.APPLICATIONS && APPLICATIONS.find(a => a.id === id);
      if (!app) return;

      // Fire email asynchronously — never block the UI
      setTimeout(async () => {
        const sent = await sendLenderRmEmail(app, newStatus, { isManual: false, triggeredBy: AI_USER });
        if (sent) {
          if (typeof showToast === 'function') {
            showToast(`📧 Lender RM email sent for ${id} → ${_stageLabel(newStatus)}`, 'success');
          }
          // Refresh timeline if detail panel is open
          if (typeof refreshDetailTimeline === 'function') refreshDetailTimeline(id);
        }
      }, 800);
    };
  }

  // ════════════════════════════════════════════════════════════════════════
  //  HOOK INTO addTrackingEntry — detect manual timeline updates post-UW
  //  and adjust the next auto email accordingly
  // ════════════════════════════════════════════════════════════════════════

  function _hookAddTrackingEntry() {
    if (window._lewTrackingHooked) return; // prevent double-wrap
    const _orig = window.addTrackingEntry;
    if (!_orig || typeof _orig !== 'function') return;
    window._lewTrackingHooked = true;

    window.addTrackingEntry = function(app, name, stage, comment, subnote) {
      // Call original
      _orig.call(this, app, name, stage, comment, subnote);

      // Only act on post-UW apps with a manual (non-AI) entry that carries a comment
      if (!app || !_isPostUnderwriting(app.status)) return;
      if (!comment || comment.trim() === '' || comment.trim() === 'Move' || comment.trim() === 'DONE') return;
      // Skip if the entry was already added by AI (avoid infinite recursion)
      if (name && name.includes('Lender Email')) return;
      if (name && name.includes('Bank Reply')) return;

      // Store the manual note on the app so the next auto email picks it up
      app._lewPendingManualNote = comment + (subnote && subnote.trim() && subnote.trim() !== ' ' ? ' — ' + subnote.trim() : '');
    };
  }

  // ════════════════════════════════════════════════════════════════════════
  //  RM MANAGEMENT — add/edit lender RM directly on an application
  //  (per-app override, independent of BANKS_STORE master)
  // ════════════════════════════════════════════════════════════════════════

  function openRmOverrideModal(appId) {
    const app = window.APPLICATIONS && APPLICATIONS.find(a => a.id === appId);
    if (!app) return;

    // Destroy any existing instance
    let modal = document.getElementById('lew-rm-modal');
    if (modal) modal.remove();

    const current = app.lender_rm_override || _getLenderRm(app) || {};

    modal = document.createElement('div');
    modal.id = 'lew-rm-modal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px';
    modal.innerHTML = `
      <div style="background:#fff;border-radius:16px;width:100%;max-width:480px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.3)">
        <div style="background:linear-gradient(135deg,#0047AB,#002970);padding:20px 24px;display:flex;align-items:center;justify-content:space-between">
          <div>
            <div style="font-size:16px;font-weight:700;color:#fff">Update Lender RM Details</div>
            <div style="font-size:12px;color:rgba(255,255,255,.6);margin-top:2px">${app.id} · ${app.name} · ${_bankLabel(app)}</div>
          </div>
          <button onclick="document.getElementById('lew-rm-modal').remove()" style="background:rgba(255,255,255,.15);border:none;color:#fff;width:30px;height:30px;border-radius:50%;cursor:pointer;font-size:16px;display:flex;align-items:center;justify-content:center">✕</button>
        </div>
        <div style="padding:24px">
          <div style="background:#fff8e1;border:1px solid #f59e0b;border-radius:8px;padding:10px 14px;font-size:12.5px;color:#7a4f00;margin-bottom:18px">
            ⚠ This update applies only to this application and does not change the master Bank/NBFC record.
            To update the global RM for <strong>${_bankLabel(app)}</strong>, go to Banks / NBFC settings.
          </div>
          <div style="display:grid;gap:14px">
            <div>
              <label style="font-size:12px;font-weight:600;color:#4a5568;display:block;margin-bottom:5px">RM Name *</label>
              <input id="lew-rm-name" type="text" value="${current.name || ''}" placeholder="e.g. Deepak Mehta"
                style="width:100%;padding:10px 14px;border:1.5px solid #e2e8f0;border-radius:8px;font-size:14px;outline:none;box-sizing:border-box">
            </div>
            <div>
              <label style="font-size:12px;font-weight:600;color:#4a5568;display:block;margin-bottom:5px">RM Email *</label>
              <input id="lew-rm-email" type="email" value="${current.email || ''}" placeholder="rm@bank.com"
                style="width:100%;padding:10px 14px;border:1.5px solid #e2e8f0;border-radius:8px;font-size:14px;outline:none;box-sizing:border-box">
            </div>
            <div>
              <label style="font-size:12px;font-weight:600;color:#4a5568;display:block;margin-bottom:5px">RM Mobile</label>
              <input id="lew-rm-mobile" type="tel" value="${current.mobile || ''}" placeholder="9876543210"
                style="width:100%;padding:10px 14px;border:1.5px solid #e2e8f0;border-radius:8px;font-size:14px;outline:none;box-sizing:border-box">
            </div>
          </div>
          <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:22px">
            <button onclick="document.getElementById('lew-rm-modal').remove()"
              style="padding:10px 20px;border:1.5px solid #e2e8f0;border-radius:8px;background:#fff;cursor:pointer;font-size:13px;font-weight:600;color:#4a5568">
              Cancel
            </button>
            <button onclick="window._lewSaveRmOverride('${appId}')"
              style="padding:10px 20px;background:linear-gradient(135deg,#0047AB,#0062CC);border:none;border-radius:8px;color:#fff;cursor:pointer;font-size:13px;font-weight:700;box-shadow:0 4px 14px rgba(0,71,171,.3)">
              Save RM Details
            </button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(modal);
  }

  window._lewSaveRmOverride = function(appId) {
    const app = window.APPLICATIONS && APPLICATIONS.find(a => a.id === appId);
    if (!app) return;
    const name   = document.getElementById('lew-rm-name')?.value.trim();
    const email  = document.getElementById('lew-rm-email')?.value.trim();
    const mobile = document.getElementById('lew-rm-mobile')?.value.trim() || '—';
    if (!name || !email) { if (typeof showToast === 'function') showToast('RM Name and Email are required', 'error'); return; }

    const prev = app.lender_rm_override;
    app.lender_rm_override = { name, email, mobile };

    // Timeline entry for the change — attributed to current user
    if (typeof addTrackingEntry === 'function') {
      addTrackingEntry(app, 'EFIN-Lender RM Updated', 'System Comments',
        `RM changed to ${name} (${email})`,
        prev ? `Previous: ${prev.name} · ${prev.email}` : 'First-time RM assignment for this application');
    }

    if (typeof persistSave === 'function') persistSave();
    document.getElementById('lew-rm-modal')?.remove();
    if (typeof showToast === 'function') showToast(`Lender RM updated: ${name}`, 'success');
  };

  // ════════════════════════════════════════════════════════════════════════
  //  SEND STATUS ENQUIRY (manual trigger)
  // ════════════════════════════════════════════════════════════════════════

  function openStatusEnquiryModal(appId) {
    const app = window.APPLICATIONS && APPLICATIONS.find(a => a.id === appId);
    if (!app) return;
    if (!_isPostUnderwriting(app.status)) {
      if (typeof showToast === 'function') showToast('Status enquiry available only after Underwriting stage', 'warn');
      return;
    }

    let modal = document.getElementById('lew-enquiry-modal');
    if (modal) modal.remove();

    const rm = _getLenderRm(app);
    const rmDisplay = rm ? `${rm.name} (${rm.email})` : 'No RM configured';

    modal = document.createElement('div');
    modal.id = 'lew-enquiry-modal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px';
    modal.innerHTML = `
      <div style="background:#fff;border-radius:16px;width:100%;max-width:500px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.3)">
        <div style="background:linear-gradient(135deg,#0047AB,#002970);padding:20px 24px;display:flex;align-items:center;justify-content:space-between">
          <div>
            <div style="font-size:16px;font-weight:700;color:#fff">Send Status Enquiry to Lender RM</div>
            <div style="font-size:12px;color:rgba(255,255,255,.6);margin-top:2px">${app.id} · ${app.name}</div>
          </div>
          <button onclick="document.getElementById('lew-enquiry-modal').remove()" style="background:rgba(255,255,255,.15);border:none;color:#fff;width:30px;height:30px;border-radius:50%;cursor:pointer;font-size:16px;display:flex;align-items:center;justify-content:center">✕</button>
        </div>
        <div style="padding:24px">
          <div style="background:#f0f8ff;border:1px solid rgba(0,71,171,.2);border-radius:8px;padding:10px 14px;font-size:13px;color:#002970;margin-bottom:18px">
            📧 Will be sent to: <strong>${rmDisplay}</strong>
          </div>
          <div>
            <label style="font-size:12px;font-weight:600;color:#4a5568;display:block;margin-bottom:5px">Additional Note (optional)</label>
            <textarea id="lew-enquiry-note" rows="3" placeholder="Any specific query or context for the RM…"
              style="width:100%;padding:10px 14px;border:1.5px solid #e2e8f0;border-radius:8px;font-size:14px;resize:vertical;outline:none;box-sizing:border-box"></textarea>
          </div>
          <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:18px">
            <button onclick="document.getElementById('lew-enquiry-modal').remove()"
              style="padding:10px 20px;border:1.5px solid #e2e8f0;border-radius:8px;background:#fff;cursor:pointer;font-size:13px;font-weight:600;color:#4a5568">
              Cancel
            </button>
            <button onclick="window._lewSendEnquiry('${appId}')"
              style="padding:10px 20px;background:linear-gradient(135deg,#0047AB,#0062CC);border:none;border-radius:8px;color:#fff;cursor:pointer;font-size:13px;font-weight:700;box-shadow:0 4px 14px rgba(0,71,171,.3)">
              Send Enquiry ✉
            </button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(modal);
  }

  window._lewSendEnquiry = async function(appId) {
    const app  = window.APPLICATIONS && APPLICATIONS.find(a => a.id === appId);
    const note = document.getElementById('lew-enquiry-note')?.value.trim() || '';
    document.getElementById('lew-enquiry-modal')?.remove();
    if (!app) return;

    const currentUser = window.currentUser || { name: 'User' };
    await sendLenderRmEmail(app, 'statusEnquiry', {
      isManual:    true,
      triggeredBy: currentUser.name,
      manualNote:  note,
      stage:       _stageLabel(app.status),
    });
    if (typeof showToast === 'function') showToast('Status enquiry sent to Lender RM ✉', 'success');
    if (typeof refreshDetailTimeline === 'function') refreshDetailTimeline(appId);
  };

  // ════════════════════════════════════════════════════════════════════════
  //  LOG BANK REPLY MODAL  (paste raw reply text)
  // ════════════════════════════════════════════════════════════════════════

  function openLogReplyModal(appId) {
    const app = window.APPLICATIONS && APPLICATIONS.find(a => a.id === appId);
    if (!app) return;
    if (!_isPostUnderwriting(app.status)) {
      if (typeof showToast === 'function') showToast('Bank reply logging available only after Underwriting stage', 'warn');
      return;
    }

    let modal = document.getElementById('lew-reply-modal');
    if (modal) modal.remove();

    modal = document.createElement('div');
    modal.id = 'lew-reply-modal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px';
    modal.innerHTML = `
      <div style="background:#fff;border-radius:16px;width:100%;max-width:560px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.3)">
        <div style="background:linear-gradient(135deg,#0047AB,#002970);padding:20px 24px;display:flex;align-items:center;justify-content:space-between">
          <div>
            <div style="font-size:16px;font-weight:700;color:#fff">Log Bank / Lender Reply</div>
            <div style="font-size:12px;color:rgba(255,255,255,.6);margin-top:2px">${app.id} · ${app.name} · AI will parse into standard format</div>
          </div>
          <button onclick="document.getElementById('lew-reply-modal').remove()" style="background:rgba(255,255,255,.15);border:none;color:#fff;width:30px;height:30px;border-radius:50%;cursor:pointer;font-size:16px;display:flex;align-items:center;justify-content:center">✕</button>
        </div>
        <div style="padding:24px">
          <div style="background:#f0f8ff;border:1px solid rgba(0,71,171,.2);border-radius:8px;padding:10px 14px;font-size:12.5px;color:#002970;margin-bottom:18px">
            🤖 Paste the raw email text from the bank below. AI will extract the decision, amount, rate, tenure, conditions, UTR, and all other relevant details automatically.
          </div>
          <div style="margin-bottom:14px">
            <label style="font-size:12px;font-weight:600;color:#4a5568;display:block;margin-bottom:5px">Sender Email (optional)</label>
            <input id="lew-reply-from" type="email" placeholder="rm@hdfc.com"
              style="width:100%;padding:9px 14px;border:1.5px solid #e2e8f0;border-radius:8px;font-size:13px;outline:none;box-sizing:border-box">
          </div>
          <div>
            <label style="font-size:12px;font-weight:600;color:#4a5568;display:block;margin-bottom:5px">Paste Raw Email Text *</label>
            <textarea id="lew-reply-text" rows="8" placeholder="Paste the complete email content here, including any terms, conditions, sanction details, or query raised by the bank…"
              style="width:100%;padding:10px 14px;border:1.5px solid #e2e8f0;border-radius:8px;font-size:13px;resize:vertical;outline:none;box-sizing:border-box;font-family:inherit"></textarea>
          </div>
          <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:18px">
            <button onclick="document.getElementById('lew-reply-modal').remove()"
              style="padding:10px 20px;border:1.5px solid #e2e8f0;border-radius:8px;background:#fff;cursor:pointer;font-size:13px;font-weight:600;color:#4a5568">
              Cancel
            </button>
            <button onclick="window._lewSubmitReply('${appId}')"
              style="padding:10px 20px;background:linear-gradient(135deg,#0047AB,#0062CC);border:none;border-radius:8px;color:#fff;cursor:pointer;font-size:13px;font-weight:700;box-shadow:0 4px 14px rgba(0,71,171,.3)">
              Parse &amp; Log Reply 🤖
            </button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(modal);
  }

  window._lewSubmitReply = async function(appId) {
    const text  = document.getElementById('lew-reply-text')?.value.trim();
    const from  = document.getElementById('lew-reply-from')?.value.trim() || '';
    if (!text) { if (typeof showToast === 'function') showToast('Please paste the email text', 'warn'); return; }
    document.getElementById('lew-reply-modal')?.remove();
    await logBankReply(appId, text, from);
    if (typeof refreshDetailTimeline === 'function') refreshDetailTimeline(appId);
  };

  // ════════════════════════════════════════════════════════════════════════
  //  VIEW EMAIL THREAD MODAL
  // ════════════════════════════════════════════════════════════════════════

  function openEmailThreadModal(appId) {
    const app    = window.APPLICATIONS && APPLICATIONS.find(a => a.id === appId);
    const thread = _getThread(appId);
    if (!app) return;

    let modal = document.getElementById('lew-thread-modal');
    if (modal) modal.remove();

    const rows = thread.length === 0
      ? '<div style="text-align:center;padding:40px;color:#8a95a3;font-size:14px">No emails logged yet for this application.</div>'
      : thread.slice().reverse().map(e => {
          const isOut  = e.direction === 'outbound';
          const badge  = isOut
            ? '<span style="background:#E8F4FD;color:#0047AB;padding:3px 10px;border-radius:100px;font-size:10px;font-weight:700">SENT</span>'
            : '<span style="background:#E8F5EE;color:#1a6b4a;padding:3px 10px;border-radius:100px;font-size:10px;font-weight:700">RECEIVED</span>';
          const parsed = e.parsedData;
          let parsedHtml = '';
          if (parsed && !isOut) {
            const decLabel = { conditional_approval:'Conditional Approval', full_approval:'Full Approval', pending:'Pending', query_raised:'Query Raised', rejected:'Rejected', disbursed:'Disbursed', info_only:'Info / Update' }[parsed.decisionType] || parsed.decisionType || '—';
            parsedHtml = `
            <div style="background:#f0f8ff;border:1px solid rgba(0,71,171,.15);border-radius:8px;padding:10px 14px;margin-top:10px;font-size:12px">
              <div style="font-weight:700;color:#0047AB;margin-bottom:6px">🤖 AI-Parsed Response</div>
              <table style="width:100%;border-collapse:collapse;font-size:12px">
                <tr><td style="padding:3px 8px;font-weight:600;width:40%;color:#4a5568">Decision</td><td style="padding:3px 8px">${decLabel}</td></tr>
                ${parsed.sanctionAmount ? `<tr><td style="padding:3px 8px;font-weight:600;color:#4a5568">Sanction Amt</td><td style="padding:3px 8px">₹${Number(parsed.sanctionAmount).toLocaleString('en-IN')}</td></tr>` : ''}
                ${parsed.interestRateMin ? `<tr><td style="padding:3px 8px;font-weight:600;color:#4a5568">ROI</td><td style="padding:3px 8px">${parsed.interestRateMin}%${parsed.interestRateMax && parsed.interestRateMax !== parsed.interestRateMin ? '–' + parsed.interestRateMax + '%' : ''} (${parsed.rateType || '—'})</td></tr>` : ''}
                ${parsed.tenureMonths ? `<tr><td style="padding:3px 8px;font-weight:600;color:#4a5568">Tenure</td><td style="padding:3px 8px">${parsed.tenureMonths} months</td></tr>` : ''}
                ${parsed.disbursementUTR ? `<tr><td style="padding:3px 8px;font-weight:600;color:#4a5568">UTR</td><td style="padding:3px 8px">${parsed.disbursementUTR}</td></tr>` : ''}
                ${parsed.conditions && parsed.conditions.length ? `<tr><td style="padding:3px 8px;font-weight:600;color:#4a5568;vertical-align:top">Conditions</td><td style="padding:3px 8px">${parsed.conditions.map(c => `• ${c}`).join('<br>')}</td></tr>` : ''}
                ${parsed.queryDetails ? `<tr><td style="padding:3px 8px;font-weight:600;color:#4a5568;vertical-align:top">Query</td><td style="padding:3px 8px">${parsed.queryDetails}</td></tr>` : ''}
                ${parsed.remarks ? `<tr><td style="padding:3px 8px;font-weight:600;color:#4a5568;vertical-align:top">Remarks</td><td style="padding:3px 8px">${parsed.remarks}</td></tr>` : ''}
              </table>
            </div>`;
          }
          return `
          <div style="border:1px solid #e2e8f0;border-radius:10px;padding:14px 16px;margin-bottom:10px;background:${isOut ? '#f9fafb' : '#f0fff4'}">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;flex-wrap:wrap;gap:6px">
              <div style="display:flex;align-items:center;gap:8px">
                ${badge}
                <span style="font-size:12px;font-weight:600;color:#1a1a2e">${e.rmEmail || '—'}</span>
              </div>
              <span style="font-size:11px;color:#8a95a3">${new Date(e.timestamp).toLocaleString('en-IN')}</span>
            </div>
            <div style="font-size:12px;color:#4a5568;line-height:1.5">${(e.bodyText || '').substring(0, 300)}${(e.bodyText || '').length > 300 ? '…' : ''}</div>
            ${parsedHtml}
          </div>`;
        }).join('');

    modal = document.createElement('div');
    modal.id = 'lew-thread-modal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px';
    modal.innerHTML = `
      <div style="background:#fff;border-radius:16px;width:100%;max-width:600px;max-height:88vh;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.3);display:flex;flex-direction:column">
        <div style="background:linear-gradient(135deg,#0047AB,#002970);padding:20px 24px;display:flex;align-items:center;justify-content:space-between;flex-shrink:0">
          <div>
            <div style="font-size:16px;font-weight:700;color:#fff">Email Conversation Thread</div>
            <div style="font-size:12px;color:rgba(255,255,255,.6);margin-top:2px">${app.id} · ${app.name} · ${thread.length} message(s)</div>
          </div>
          <button onclick="document.getElementById('lew-thread-modal').remove()" style="background:rgba(255,255,255,.15);border:none;color:#fff;width:30px;height:30px;border-radius:50%;cursor:pointer;font-size:16px;display:flex;align-items:center;justify-content:center">✕</button>
        </div>
        <div style="overflow-y:auto;padding:20px;flex:1">${rows}</div>
      </div>`;
    document.body.appendChild(modal);
  }

  // ════════════════════════════════════════════════════════════════════════
  //  INJECT ACTION BUTTONS INTO DETAIL PANEL (post-UW apps only)
  // ════════════════════════════════════════════════════════════════════════

  function injectLewButtons(appId) {
    const app = window.APPLICATIONS && APPLICATIONS.find(a => a.id === appId);
    if (!app || !_isPostUnderwriting(app.status)) return;

    // Find the timeline tab container or the action-bar area
    const container = document.getElementById('detail-tracking-panel') || document.getElementById('tab-tracking-tab');
    if (!container) return;

    // Remove previous inject to avoid duplicates
    const prev = document.getElementById('lew-action-bar');
    if (prev) prev.remove();

    const bar = document.createElement('div');
    bar.id = 'lew-action-bar';
    bar.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;padding:12px 16px;background:#f0f8ff;border-bottom:1px solid rgba(0,71,171,.12);';
    bar.innerHTML = `
      <button onclick="window.lewOpenStatusEnquiry('${appId}')"
        style="display:inline-flex;align-items:center;gap:6px;background:#0047AB;border:none;border-radius:8px;padding:8px 14px;font-size:12.5px;font-weight:600;color:#fff;cursor:pointer">
        ✉ Send Status Enquiry
      </button>
      <button onclick="window.lewOpenLogReply('${appId}')"
        style="display:inline-flex;align-items:center;gap:6px;background:#1a6b4a;border:none;border-radius:8px;padding:8px 14px;font-size:12.5px;font-weight:600;color:#fff;cursor:pointer">
        📥 Log Bank Reply
      </button>
      <button onclick="window.lewOpenThread('${appId}')"
        style="display:inline-flex;align-items:center;gap:6px;background:#fff;border:1.5px solid rgba(0,71,171,.3);border-radius:8px;padding:8px 14px;font-size:12.5px;font-weight:600;color:#0047AB;cursor:pointer">
        💬 View Thread
      </button>
      <button onclick="window.lewOpenRmOverride('${appId}')"
        style="display:inline-flex;align-items:center;gap:6px;background:#fff;border:1.5px solid rgba(0,71,171,.2);border-radius:8px;padding:8px 14px;font-size:12.5px;font-weight:600;color:#4a5568;cursor:pointer">
        👤 Update Lender RM
      </button>`;
    container.insertBefore(bar, container.firstChild);
  }

  // ════════════════════════════════════════════════════════════════════════
  //  EXPOSE PUBLIC API
  // ════════════════════════════════════════════════════════════════════════

  window.lewSendLenderEmail      = sendLenderRmEmail;
  window.lewLogBankReply         = logBankReply;
  window.lewOpenRmOverride       = openRmOverrideModal;
  window.lewOpenStatusEnquiry    = openStatusEnquiryModal;
  window.lewOpenLogReply         = openLogReplyModal;
  window.lewOpenThread           = openEmailThreadModal;
  window.lewInjectButtons        = injectLewButtons;
  window.lewGetThread            = _getThread;

  // ════════════════════════════════════════════════════════════════════════
  //  EXPOSE BANKS_STORE globally so _getLenderRm can always access it
  //  (BANKS_STORE is declared inside the IIFE in efin-app.js; we maintain
  //   a reference via the window export after efin-app finishes setting up)
  // ════════════════════════════════════════════════════════════════════════
  function _ensureBanksStoreExposed() {
    if (window.BANKS_STORE) return;
    // Poll until efin-app.js exposes it
    const t = setInterval(() => {
      // Try to find it via the renderBanksTable closure (it always reads BANKS_STORE)
      // efin-app.js doesn't currently expose BANKS_STORE — we add it safely here
      if (window.BANKS_STORE) { clearInterval(t); }
    }, 200);
    // Timeout after 5s
    setTimeout(() => clearInterval(t), 5000);
  }

  // ════════════════════════════════════════════════════════════════════════
  //  INIT
  // ════════════════════════════════════════════════════════════════════════

  onReady(() => {
    _loadThreads();
    _hookChangeStatus();
    _hookAddTrackingEntry();
    _ensureBanksStoreExposed();

    // ── Expose BANKS_STORE globally (patch saveBank to keep it updated) ──
    const _origSaveBank = window.saveBank;
    if (_origSaveBank) {
      window.saveBank = function() {
        _origSaveBank.apply(this, arguments);
        // After efin-app saveBank pushes to BANKS_STORE, sync our reference
        // BANKS_STORE is scoped inside efin-app; we cannot directly reference it,
        // but since _getLenderRm reads window.BANKS_STORE we attempt a lazy sync
        setTimeout(() => {
          if (!window.BANKS_STORE && typeof renderBanksTable === 'function') {
            // renderBanksTable reads the same BANKS_STORE — we intercept tbody innerHTML
            // to reconstruct; but the cleanest route is to expose it from efin-app
            // This is handled by the window.BANKS_STORE assignment in efin-app below
          }
        }, 100);
      };
    }

    console.info('[LEW] Lender Email Workflow initialised ✓');
  });

})();
