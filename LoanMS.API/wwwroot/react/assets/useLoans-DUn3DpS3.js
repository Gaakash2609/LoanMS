import{b as m,c as h,u as x}from"./query-C-zbL-AZ.js";import{loansApi as f}from"./loansApi-sqj3AajV.js";import{a as c}from"./axios-D8_tum83.js";const $={send:e=>c.post("/api/email/send",e)},w={getThread:e=>c.get(`/api/lenderemailthreads/${e}`),addEntry:e=>c.post("/api/lenderemailthreads",e)},A=["Approved","Disbursed"],E={Approved:"approved",Disbursed:"disbursed"},v={personal_loan:"Personal Loan",business_loan:"Business Loan",home_loan:"Home Loan",new_car_loan:"New Car Loan",used_car_loan:"Used Car Loan"},N=[{key:"offer",label:"Offer Stage Initiated"},{key:"approved",label:"Application Approved"},{key:"acceptance",label:"Acceptance — Documents Pending"},{key:"disbursed",label:"Disbursement Confirmed"},{key:"statusEnquiry",label:"Status Enquiry (manual)"}];function L(){const e=new Date;return e.toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric"})+" "+e.toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"})}function k(e,o,n,r){const s=e.bankLines?.[0]?.bankName||"Lender",t=e.customer.fullName,a=e.loanNumber,i=N.find(y=>y.key===n)?.label||n,p={offer:`EFIN Ref ${a} | ${t} — Offer Stage Initiated | ${s}`,approved:`EFIN Ref ${a} | ${t} — Application Approved | ${s}`,acceptance:`EFIN Ref ${a} | ${t} — Acceptance Stage — Documents Pending | ${s}`,disbursed:`EFIN Ref ${a} | ${t} — Disbursement Confirmed | ${s}`,statusEnquiry:`EFIN Ref ${a} | ${t} — Status Update Request | ${s}`},d=r&&r.trim()?`<p><em>Additional Note (from Processing Team):</em> ${r.trim()}</p>`:"",l={offer:`<p>We are pleased to inform you that the loan application for <strong>${t}</strong> (Application Reference: <strong>${a}</strong>) has successfully progressed to the <strong>Offer Stage</strong> following completion of underwriting evaluation.</p>
      <p>Kindly review the case and revert with the <strong>initial offer terms</strong> including sanctioned amount, rate of interest, tenure, and any applicable conditions at your earliest convenience.</p>
      ${d}
      <p>We look forward to your prompt response.</p>`,approved:`<p>We are delighted to inform you that the loan application for <strong>${t}</strong> (Ref: <strong>${a}</strong>) has been <strong>approved</strong>.</p>
      <p>Kindly coordinate with us for the next steps including sanction letter issuance, acceptance formalities, and disbursement scheduling. Please confirm receipt of this communication and advise on the expected timeline.</p>
      ${d}`,acceptance:`<p>The loan file for <strong>${t}</strong> (Ref: <strong>${a}</strong>) has moved to the <strong>Acceptance Stage</strong>.</p>
      <p>The customer acceptance documentation is being prepared/collected. We will share the duly executed acceptance set shortly. In parallel, please advise if there are any additional pre-disbursement conditions or documentation requirements pending at your end.</p>
      ${d}`,disbursed:`<p>We wish to confirm that the loan for <strong>${t}</strong> (Ref: <strong>${a}</strong>) has been successfully <strong>disbursed</strong>.</p>
      <p>Kindly share the <strong>UTR / NEFT reference number</strong>, disbursed amount, and the credit date at your earliest so we can update our records accordingly.</p>
      ${d}
      <p>Thank you for your continued support on this case.</p>`,statusEnquiry:`<p>We are writing to request a <strong>status update</strong> on the loan application for <strong>${t}</strong> (Ref: <strong>${a}</strong>), currently at the <strong>${i}</strong> stage.</p>
      <p>Please advise on the current status and expected timeline at your earliest convenience.</p>
      ${d}`},g=`
    <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:13px">
      <tr style="background:#f0f8ff"><td style="padding:7px 12px;border:1px solid #dde8f5;font-weight:600;width:40%">Applicant Name</td><td style="padding:7px 12px;border:1px solid #dde8f5">${t||"—"}</td></tr>
      <tr><td style="padding:7px 12px;border:1px solid #dde8f5;font-weight:600;background:#f9fafb">Application Ref</td><td style="padding:7px 12px;border:1px solid #dde8f5"><strong>${a}</strong></td></tr>
      <tr style="background:#f0f8ff"><td style="padding:7px 12px;border:1px solid #dde8f5;font-weight:600">Loan Type</td><td style="padding:7px 12px;border:1px solid #dde8f5">${v[e.loanType]||e.loanType||"—"}</td></tr>
      <tr><td style="padding:7px 12px;border:1px solid #dde8f5;font-weight:600;background:#f9fafb">Loan Amount</td><td style="padding:7px 12px;border:1px solid #dde8f5">${e.requestedAmount?"₹"+Number(e.requestedAmount).toLocaleString("en-IN"):"—"}</td></tr>
      <tr style="background:#f0f8ff"><td style="padding:7px 12px;border:1px solid #dde8f5;font-weight:600">Bank / NBFC</td><td style="padding:7px 12px;border:1px solid #dde8f5">${s}</td></tr>
      <tr><td style="padding:7px 12px;border:1px solid #dde8f5;font-weight:600;background:#f9fafb">Current Stage</td><td style="padding:7px 12px;border:1px solid #dde8f5">${e.status}</td></tr>
    </table>`,b=`
    <div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;color:#1a1a2e">
      <div style="background:linear-gradient(135deg,#0047AB,#002970);padding:24px 28px;border-radius:10px 10px 0 0">
        <div style="font-size:22px;font-weight:900;color:#fff;letter-spacing:-0.5px">EFIN — Loan Processing</div>
        <div style="font-size:12px;color:rgba(255,255,255,0.6);margin-top:4px">Case Communication · ${L()}</div>
      </div>
      <div style="background:#f6f8fb;border:1px solid #e2e8f0;border-top:none;padding:28px;border-radius:0 0 10px 10px">
        <div style="background:#fff;border-radius:8px;padding:22px;border:1px solid #e2e8f0;font-size:14px;line-height:1.7;color:#1a1a2e">
          <p>Dear <strong>${o||"Team"}</strong>,</p>
          ${l[n]||l.statusEnquiry}
          ${g}
        </div>
        <div style="margin-top:14px;font-size:11px;color:#8a95a3;text-align:center">
          This is a communication generated by the EFIN Loan Management System. Application Reference: <strong>${a}</strong>.
        </div>
      </div>
      
    <hr style="border:none;border-top:1px solid #e2e8f0;margin:18px 0">
    <p style="font-size:13px;color:#4a5568;margin:0">Warm regards,<br><strong>Loan Processing Team</strong><br>EFIN Financial Services<br>
    <em style="font-size:11px;color:#8a95a3">[This message was generated automatically by EFIN Workflow Engine]</em></p>
    </div>`;return{subject:p[n]||p.statusEnquiry,html:b}}const u={all:["loans"],list:e=>["loans","list",e],detail:e=>["loans","detail",e],dashboard:["loans","dashboard"]};function I(e){return m({queryKey:u.list(e),queryFn:()=>f.getAll(e).then(o=>o.data.data),staleTime:0,refetchOnMount:"always"})}function F(e){return m({queryKey:u.detail(e),queryFn:()=>f.getById(e).then(o=>o.data.data),enabled:!!e})}function C(){return m({queryKey:u.dashboard,queryFn:()=>f.getDashboard().then(e=>e.data.data),staleTime:6e4,refetchInterval:12e4})}async function T(e,o,n){try{const s=(await c.get(`/api/loans/${e}`)).data.data,t=s?.bankLines?.[0]?.bankName;if(!s||!t)return;const i=((await c.get("/api/banks")).data.data??[]).find(g=>(g.bankName||"").toLowerCase()===t.toLowerCase());if(!i?.email){console.warn("[LenderEmail] No lender RM email on file for",t,"— skipping auto-send for loan",e);return}const{subject:p,html:d}=k(s,i.rmName||"",o,n),l=await $.send({to:i.email,toName:i.rmName,subject:p,html:d});if(!l.data.success){console.warn("[LenderEmail] Auto-send failed for loan",e,l.data.message);return}await w.addEntry({loanApplicationId:e,direction:"sent",stage:o,rmName:i.rmName,rmEmail:i.email,subject:p,bodyText:d,source:"auto"})}catch(r){console.warn("[LenderEmail] Auto-send error for loan",e,r)}}function D(){const e=h();return x({mutationFn:({id:o,...n})=>f.updateStatus(o,n).then(r=>r.data),onSuccess:(o,n)=>{if(e.invalidateQueries({queryKey:u.detail(n.id)}),e.invalidateQueries({queryKey:u.all}),A.includes(n.newStatus)){const r=E[n.newStatus];r&&T(n.id,r,n.comment)}}})}export{u as L,N as S,F as a,k as b,I as c,D as d,$ as e,w as l,C as u};
