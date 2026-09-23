import{g as h}from"./index-CZ_1fOGr.js";import{h as u,w as g}from"./reportExport-CBeMM1nC.js";function y(){return[{key:"id",label:"Application ID",checked:!0,get:e=>String(e.id)},{key:"loanNumber",label:"Loan Number",checked:!0,get:e=>e.loanNumber},{key:"name",label:"Customer Name",checked:!0,get:e=>e.customerName},{key:"mobile",label:"Mobile",checked:!0,get:e=>e.customerPhone},{key:"loanType",label:"Loan Type",checked:!0,get:e=>e.loanType},{key:"amount",label:"Loan Amount (₹)",checked:!0,get:e=>String(e.requestedAmount)},{key:"approvedAmount",label:"Approved Amount (₹)",checked:!1,get:e=>e.approvedAmount!=null?String(e.approvedAmount):""},{key:"loanRate",label:"Interest Rate (%)",checked:!1,get:e=>String(e.interestRate)},{key:"tenure",label:"Tenure (months)",checked:!1,get:e=>String(e.tenureMonths)},{key:"_emi",label:"Approx. EMI (₹)",checked:!1,get:e=>e.monthlyEmi!=null?String(e.monthlyEmi):""},{key:"status",label:"Status",checked:!0,get:e=>e.status},{key:"sales",label:"Created By",checked:!0,get:e=>e.createdByName},{key:"rm",label:"Assigned To",checked:!1,get:e=>e.assignedToName||""},{key:"date",label:"Created Date",checked:!0,get:e=>h(e.createdAt)}]}function d(e){return'"'+(e??"").replace(/"/g,'""')+'"'}function k(e,n){const t=[e.map(o=>d(String(o))).join(",")];return n.forEach(o=>t.push(o.map(a=>d(String(a??""))).join(","))),t.join(`
`)}function v(e,n){const t=n.filter(l=>l.checked),o=t.map(l=>d(l.label)).join(","),a=e.map(l=>t.map(r=>d(r.get(l))).join(","));return[o,...a].join(`
`)}function s(e){return String(e??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}function x(e,n){const t=n.filter(r=>r.checked),o=t.map(r=>s(r.label)),a=e.map(r=>t.map(c=>s(c.get(r)))),l=`
    <h2 style="font-family:Arial;color:#1a4fa3">LoanMS — Applications Export</h2>
    <p style="font-family:Arial;font-size:12px;color:#666">Rows: ${e.length} | Generated: ${new Date().toLocaleString("en-IN")}</p>
    ${u(o,a)}`;return g("Applications",l)}const m=12;function w(e,n){const t=n.filter(i=>i.checked),o=t.slice(0,m),a=t.length>m,l=o.map(i=>s(i.label)),r=e.map(i=>o.map(p=>s(p.get(i))||"—")),c=new Date().toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric"});return`<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>Applications Export — ${c}</title>
<style>
  @page { size: A4 landscape; margin: 12mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 9pt; color: #111; }
  .hdr { display:flex; justify-content:space-between; align-items:flex-end; padding-bottom:8px; border-bottom:2px solid #1a4fa3; margin-bottom:10px; }
  .hdr-title { font-size:15pt; font-weight:800; color:#1a4fa3; }
  .hdr-meta { font-size:8pt; color:#555; text-align:right; line-height:1.5; }
  table { width:100%; border-collapse:collapse; font-size:8pt; }
  thead tr { background:#1a4fa3; color:#fff; }
  thead th { padding:5px 6px; text-align:left; font-weight:700; white-space:nowrap; }
  tbody tr:nth-child(even) { background:#f0f4ff; }
  tbody td { padding:4px 6px; border-bottom:1px solid #dde3f0; vertical-align:top; }
  .truncate-note { color:#c0392b; font-size:8pt; margin-bottom:6px; }
  .footer { margin-top:10px; font-size:7.5pt; color:#888; text-align:right; }
</style></head><body>
<div class="hdr">
  <div>
    <div class="hdr-title">Applications Export</div>
    <div style="font-size:9pt;color:#444;margin-top:2px">${e.length} record${e.length===1?"":"s"} · Generated ${c}</div>
  </div>
  <div class="hdr-meta">${new Date().toLocaleTimeString("en-IN")}</div>
</div>
${a?`<div class="truncate-note">⚠ PDF shows the first ${m} columns. Use Excel or CSV for all ${t.length} columns.</div>`:""}
<table><thead><tr>${l.map(i=>`<th>${i}</th>`).join("")}</tr></thead>
<tbody>${r.map(i=>`<tr>${i.map(p=>`<td>${p}</td>`).join("")}</tr>`).join("")}</tbody></table>
<div class="footer">Mudrahub Loan Management System — Confidential</div>
<script>window.onload=function(){window.print();}<\/script>
</body></html>`}function A(e,n){const t=new Blob([e],{type:"text/csv"}),o=URL.createObjectURL(t),a=document.createElement("a");a.href=o,a.download=n,document.body.appendChild(a),a.click(),document.body.removeChild(a),URL.revokeObjectURL(o)}export{v as a,k as b,x as c,w as d,y as e,A as f};
