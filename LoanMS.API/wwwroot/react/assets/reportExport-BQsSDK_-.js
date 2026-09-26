import{w as m}from"./index-U4DLUxYL.js";function p(t){const n=[];let a="",e=!1;for(let o=0;o<t.length;o++){const s=t[o];e?s==='"'&&t[o+1]==='"'?(a+='"',o++):s==='"'?e=!1:a+=s:s==='"'?e=!0:s===","?(n.push(a),a=""):a+=s}return n.push(a),n.map(o=>o.trim())}function h(t,n){const a=t.split(/\r?\n/).filter(s=>s.trim());if(a.length===0)return[];const e=p(a[0]).map(s=>s.toLowerCase()),o=n?e[0]?.includes(n.toLowerCase()):!1;return a.slice(o?1:0).map(p)}function u(t){return'"'+String(t??"").replace(/"/g,'""')+'"'}function y(t){return["yes","true","1","y"].includes((t??"").trim().toLowerCase())}function r(t){return t.map(n=>[n.id,n.customerName,n.loanType,n.requestedAmount,n.status,n.createdByName,m(n.createdAt)])}const c=["Application ID","Applicant Name","Loan Type","Amount","Status","Sales Person","Date"];function i(t,n,a){return[t,n.map(u).join(","),...a.map(e=>e.map(u).join(","))].join(`
`)}function b(t,n,a=[]){const e=[i("Summary",["Metric","Value"],[["Total Portfolio",t.totalPortfolio],["Average Loan Amount",t.averageLoanAmount],["Conversion Rate (%)",t.conversionRate],["Avg TAT (days)",t.avgTatDays],["DDR Ratio (%)",t.ddrRatio],["Disbursed Loans",t.disbursedLoans]]),i("Loans by Status",["Status","Count"],t.loansByStatus.map(o=>[o.status,o.count])),i("Loans by Type",["Loan Type","Count","Total Amount"],t.loansByType.map(o=>[o.loanType,o.count,o.totalAmount])),i("Top Agents",["Agent","Loan Count","Total Amount"],t.topAgents.map(o=>[o.agentName,o.loanCount,o.totalAmount])),i("Monthly Disbursements",["Month","Count","Amount"],t.monthlyDisbursements.map(o=>[o.month,o.count,o.amount]))];return a.length&&e.push(i("Applications",c,r(a))),`\uFEFFScope: ${n} | Generated: ${new Date().toLocaleString("en-IN")}

`+e.join(`

`)}function l(t,n){return`<table>
    <thead><tr>${t.map(a=>`<th>${a}</th>`).join("")}</tr></thead>
    <tbody>${n.map((a,e)=>`<tr style="background:${e%2===0?"#f8faff":"#fff"}">${a.map(o=>`<td>${o}</td>`).join("")}</tr>`).join("")}</tbody>
  </table>`}function x(t,n,a=[]){const e=`
    <h2 style="font-family:Arial;color:#1a4fa3">LoanMS — Portfolio Report</h2>
    <p style="font-family:Arial;font-size:12px;color:#666">Scope: ${n} | Generated: ${new Date().toLocaleString("en-IN")}</p>
    <h3 style="font-family:Arial;color:#1a4fa3">Loans by Status</h3>
    ${l(["Status","Count"],t.loansByStatus.map(o=>[o.status,o.count]))}
    <h3 style="font-family:Arial;color:#1a4fa3">Loans by Type</h3>
    ${l(["Loan Type","Count","Total Amount"],t.loansByType.map(o=>[o.loanType,o.count,o.totalAmount]))}
    <h3 style="font-family:Arial;color:#1a4fa3">Top Agents</h3>
    ${l(["Agent","Loan Count","Total Amount"],t.topAgents.map(o=>[o.agentName,o.loanCount,o.totalAmount]))}
    <h3 style="font-family:Arial;color:#1a4fa3">Monthly Disbursements</h3>
    ${l(["Month","Count","Amount"],t.monthlyDisbursements.map(o=>[o.month,o.count,o.amount]))}
    ${a.length?`<h3 style="font-family:Arial;color:#1a4fa3">Applications</h3>${l(c,r(a))}`:""}`;return f("LoanMS Report",e)}function f(t,n){return`<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
    <head><meta charset="UTF-8">
    <!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet>
    <x:Name>${t}</x:Name><x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions>
    </x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]-->
    <style>td,th{border:1px solid #c8d8f8;padding:6px 10px;font-size:12px;font-family:Arial}th{background:#1a4fa3;color:#fff;font-weight:bold}</style>
    </head><body>${n}</body></html>`}function g(t,n,a=[]){return`<!DOCTYPE html><html><head><meta charset="UTF-8">
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
<h3>Loans by Status</h3>${l(["Status","Count"],t.loansByStatus.map(e=>[e.status,e.count]))}
<h3>Loans by Type</h3>${l(["Loan Type","Count","Total Amount"],t.loansByType.map(e=>[e.loanType,e.count,e.totalAmount]))}
<h3>Top Agents</h3>${l(["Agent","Loan Count","Total Amount"],t.topAgents.map(e=>[e.agentName,e.loanCount,e.totalAmount]))}
<h3>Monthly Disbursements</h3>${l(["Month","Count","Amount"],t.monthlyDisbursements.map(e=>[e.month,e.count,e.amount]))}
${a.length?`<h3>Applications</h3>${l(c,r(a))}`:""}
<script>window.onload=function(){window.print();}<\/script>
</body></html>`}function v(t,n,a){const e=new Blob([t],{type:a}),o=URL.createObjectURL(e),s=document.createElement("a");s.href=o,s.download=n,document.body.appendChild(s),s.click(),document.body.removeChild(s),setTimeout(()=>URL.revokeObjectURL(o),1e3)}function A(t){const n=new Blob([t],{type:"text/html;charset=utf-8"}),a=URL.createObjectURL(n),e=window.open(a,"_blank");return setTimeout(()=>URL.revokeObjectURL(a),3e3),e?"opened":"blocked"}export{x as a,b,g as c,y as d,u as e,v as f,h as g,l as h,A as o,p,f as w};
