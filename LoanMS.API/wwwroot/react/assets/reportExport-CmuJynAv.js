import{h as m}from"./index-CmjB0ifR.js";function r(t){return t.map(n=>[n.id,n.customerName,n.loanType,n.requestedAmount,n.status,n.createdByName,m(n.createdAt)])}const c=["Application ID","Applicant Name","Loan Type","Amount","Status","Sales Person","Date"];function p(t){return'"'+String(t??"").replace(/"/g,'""')+'"'}function l(t,n,a){return[t,n.map(p).join(","),...a.map(e=>e.map(p).join(","))].join(`
`)}function f(t,n,a=[]){const e=[l("Summary",["Metric","Value"],[["Total Portfolio",t.totalPortfolio],["Average Loan Amount",t.averageLoanAmount],["Conversion Rate (%)",t.conversionRate],["Avg TAT (days)",t.avgTatDays],["DDR Ratio (%)",t.ddrRatio],["Disbursed Loans",t.disbursedLoans]]),l("Loans by Status",["Status","Count"],t.loansByStatus.map(o=>[o.status,o.count])),l("Loans by Type",["Loan Type","Count","Total Amount"],t.loansByType.map(o=>[o.loanType,o.count,o.totalAmount])),l("Top Agents",["Agent","Loan Count","Total Amount"],t.topAgents.map(o=>[o.agentName,o.loanCount,o.totalAmount])),l("Monthly Disbursements",["Month","Count","Amount"],t.monthlyDisbursements.map(o=>[o.month,o.count,o.amount]))];return a.length&&e.push(l("Applications",c,r(a))),`\uFEFFScope: ${n} | Generated: ${new Date().toLocaleString("en-IN")}

`+e.join(`

`)}function s(t,n){return`<table>
    <thead><tr>${t.map(a=>`<th>${a}</th>`).join("")}</tr></thead>
    <tbody>${n.map((a,e)=>`<tr style="background:${e%2===0?"#f8faff":"#fff"}">${a.map(o=>`<td>${o}</td>`).join("")}</tr>`).join("")}</tbody>
  </table>`}function h(t,n,a=[]){const e=`
    <h2 style="font-family:Arial;color:#1a4fa3">LoanMS — Portfolio Report</h2>
    <p style="font-family:Arial;font-size:12px;color:#666">Scope: ${n} | Generated: ${new Date().toLocaleString("en-IN")}</p>
    <h3 style="font-family:Arial;color:#1a4fa3">Loans by Status</h3>
    ${s(["Status","Count"],t.loansByStatus.map(o=>[o.status,o.count]))}
    <h3 style="font-family:Arial;color:#1a4fa3">Loans by Type</h3>
    ${s(["Loan Type","Count","Total Amount"],t.loansByType.map(o=>[o.loanType,o.count,o.totalAmount]))}
    <h3 style="font-family:Arial;color:#1a4fa3">Top Agents</h3>
    ${s(["Agent","Loan Count","Total Amount"],t.topAgents.map(o=>[o.agentName,o.loanCount,o.totalAmount]))}
    <h3 style="font-family:Arial;color:#1a4fa3">Monthly Disbursements</h3>
    ${s(["Month","Count","Amount"],t.monthlyDisbursements.map(o=>[o.month,o.count,o.amount]))}
    ${a.length?`<h3 style="font-family:Arial;color:#1a4fa3">Applications</h3>${s(c,r(a))}`:""}`;return u("LoanMS Report",e)}function u(t,n){return`<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
    <head><meta charset="UTF-8">
    <!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet>
    <x:Name>${t}</x:Name><x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions>
    </x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]-->
    <style>td,th{border:1px solid #c8d8f8;padding:6px 10px;font-size:12px;font-family:Arial}th{background:#1a4fa3;color:#fff;font-weight:bold}</style>
    </head><body>${n}</body></html>`}function b(t,n,a=[]){return`<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>LoanMS Report — ${new Date().toLocaleDateString("en-IN")}</title>
<style>
  body{font-family:Arial,sans-serif;margin:24px;color:#1a1a2e;font-size:12px}
  h1{color:#1a4fa3;font-size:20px;margin:0 0 4px} h3{color:#1a4fa3;font-size:14px;margin:20px 0 8px}
  .meta{color:#6b7280;font-size:11px;margin-bottom:16px}
  .stats{display:flex;gap:14px;margin-bottom:20px;flex-wrap:wrap}
  .stat{background:#f0f5ff;border:1px solid #c8d8f8;border-radius:8px;padding:10px 16px;min-width:120px}
  .stat-label{font-size:10px;color:#6b7280;text-transform:uppercase;letter-spacing:.5px}
  .stat-val{font-size:16px;font-weight:bold;color:#1a4fa3}
  table{width:100%;border-collapse:collapse;font-size:11px;margin-bottom:10px}
  th{background:#1a4fa3;color:#fff;padding:7px 8px;text-align:left} td{padding:6px 8px;border-bottom:1px solid #e5e7eb}
  @media print{body{margin:10px}@page{size:landscape;margin:10mm}}
</style></head><body>
<h1>📊 LoanMS — Portfolio Report</h1>
<div class="meta">Scope: <strong>${n}</strong> | Generated: ${new Date().toLocaleString("en-IN")}</div>
<div class="stats">
  <div class="stat"><div class="stat-label">Total Portfolio</div><div class="stat-val">₹${Number(t.totalPortfolio||0).toLocaleString("en-IN")}</div></div>
  <div class="stat"><div class="stat-label">Conversion Rate</div><div class="stat-val">${t.conversionRate}%</div></div>
  <div class="stat"><div class="stat-label">Avg TAT</div><div class="stat-val">${t.avgTatDays.toFixed(1)}d</div></div>
  <div class="stat"><div class="stat-label">Disbursed</div><div class="stat-val">${t.disbursedLoans}</div></div>
</div>
<h3>Loans by Status</h3>${s(["Status","Count"],t.loansByStatus.map(e=>[e.status,e.count]))}
<h3>Loans by Type</h3>${s(["Loan Type","Count","Total Amount"],t.loansByType.map(e=>[e.loanType,e.count,e.totalAmount]))}
<h3>Top Agents</h3>${s(["Agent","Loan Count","Total Amount"],t.topAgents.map(e=>[e.agentName,e.loanCount,e.totalAmount]))}
<h3>Monthly Disbursements</h3>${s(["Month","Count","Amount"],t.monthlyDisbursements.map(e=>[e.month,e.count,e.amount]))}
${a.length?`<h3>Applications</h3>${s(c,r(a))}`:""}
<script>window.onload=function(){window.print();}<\/script>
</body></html>`}function y(t,n,a){const e=new Blob([t],{type:a}),o=URL.createObjectURL(e),i=document.createElement("a");i.href=o,i.download=n,document.body.appendChild(i),i.click(),document.body.removeChild(i),setTimeout(()=>URL.revokeObjectURL(o),1e3)}function x(t){const n=new Blob([t],{type:"text/html;charset=utf-8"}),a=URL.createObjectURL(n),e=window.open(a,"_blank");return setTimeout(()=>URL.revokeObjectURL(a),3e3),e?"opened":"blocked"}export{h as a,f as b,b as c,y as d,s as h,x as o,u as w};
