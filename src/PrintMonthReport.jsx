// PrintMonthReport.jsx
// Generates a styled monthly report for print / Save as PDF.
// Called from App.jsx via: printMonthReport(reportData)

const fmtMoney = (n) => {
  if (!n && n !== 0) return '₦0';
  return '₦' + Number(n).toLocaleString();
};

const fmtDate = (d) => {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};

const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ---------------------------------------------------------------------------
// Build the full report HTML
// ---------------------------------------------------------------------------
const buildReportHTML = ({
  periodLabel,
  rClosed, rSold, rNewTxs, rExpenses,
  rRepaymentFees, rSalesRevenue, rServiceFees, rRevenue,
  rExpTotal, rProfit, rStaff, rStakeholder,
  rCapitalDeployed, rCapitalReturned,
  serviceFee,
  stakeholders, // [{ name, total, pct, share }]
  staffUsers, staffSharePct, staffSharePerPerson,
  expByCategory,
}) => {
  const rows = (items, cols) => items.length === 0
    ? `<tr><td colspan="${cols}" class="empty-row">No records</td></tr>`
    : items.map(cols).join('');

  const repaymentRows = rows(rClosed, t => `
    <tr>
      <td>${esc(t.ref)}</td>
      <td>${esc(t.fullName)}</td>
      <td class="num">${fmtMoney(t.cashAdvance)}</td>
      <td class="num green">${fmtMoney(t.totalFees)}</td>
      <td>${fmtDate(t.dateRepaid || t.updated_at)}</td>
    </tr>`);

  const saleRows = rows(rSold, t => {
    const margin = (t.salePrice || 0) - (t.cashAdvance || 0);
    return `
    <tr>
      <td>${esc(t.ref)}</td>
      <td>${esc(t.aiBrand || t.description)}</td>
      <td class="num">${fmtMoney(t.cashAdvance)}</td>
      <td class="num">${fmtMoney(t.salePrice)}</td>
      <td class="num ${margin >= 0 ? 'green' : 'red'}">${fmtMoney(margin)}</td>
      <td>${esc(t.saleBuyer)}</td>
      <td>${fmtDate(t.saleDate || t.updated_at)}</td>
    </tr>`;
  });

  const newLoanRows = rows(rNewTxs, t => `
    <tr>
      <td>${esc(t.ref)}</td>
      <td>${esc(t.fullName)}</td>
      <td class="num">${fmtMoney(t.cashAdvance)}</td>
      <td class="num green">${fmtMoney(serviceFee)}</td>
      <td class="num">${t.loanDays || 30} days</td>
      <td>${fmtDate(t.created_at)}</td>
      <td>${esc(t.status)}</td>
    </tr>`);

  const expenseRows = rows(
    [...rExpenses].sort((a, b) => new Date(b.date) - new Date(a.date)),
    e => `
    <tr>
      <td>${fmtDate(e.date)}</td>
      <td>${esc(e.category)}</td>
      <td>${esc(e.description || e.note)}</td>
      <td class="num red">${fmtMoney(e.amount)}</td>
    </tr>`
  );

  const categoryRows = Object.entries(expByCategory)
    .sort((a, b) => b[1] - a[1])
    .map(([cat, amt]) => `
    <tr>
      <td>${esc(cat)}</td>
      <td class="num red">${fmtMoney(amt)}</td>
    </tr>`).join('');

  const stakeholderRows = stakeholders.length === 0
    ? `<tr><td colspan="4" class="empty-row">No capital recorded</td></tr>`
    : stakeholders.map(s => `
    <tr>
      <td>${esc(s.name)}</td>
      <td class="num">${fmtMoney(s.total)}</td>
      <td class="num">${s.pct.toFixed(1)}%</td>
      <td class="num green">${fmtMoney(s.share)}</td>
    </tr>`).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<title>Report — ${esc(periodLabel)}</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{
  font-family: Calibri, 'Segoe UI', Arial, Helvetica, sans-serif;
  font-size: 10.5pt;
  color: #111;
  background: #fff;
  line-height: 1.4;
}

/* PAGE */
.page{
  width: 8.5in;
  padding: 0.6in 0.7in 0.6in 0.7in;
  background: #fff;
}
@media print{
  @page{ size: letter; margin: 0; }
  .no-print{ display:none!important; }
  .page{ width:100%; padding: 0.6in 0.7in; }
  .page-break{ page-break-before: always; }
}

/* PRINT CONTROLS */
.print-controls{
  position: fixed; top: 16px; right: 16px;
  display: flex; flex-direction: column; gap: 8px; z-index: 9999;
}
.print-btn{
  background: #1a5f2a; color: #fff; border: none;
  padding: 14px 24px; font-size: 15px; font-weight: 700;
  border-radius: 8px; cursor: pointer;
  box-shadow: 0 4px 12px rgba(0,0,0,0.3);
}
.print-btn:hover{ background: #0d3518; }
.close-btn{
  background: #666; color: #fff; border: none;
  padding: 10px 24px; font-size: 13px; font-weight: 600;
  border-radius: 8px; cursor: pointer;
}
.close-btn:hover{ background: #444; }

/* HEADER */
.report-header{
  display: flex; justify-content: space-between; align-items: flex-start;
  margin-bottom: 18px; padding-bottom: 12px;
  border-bottom: 3px solid #1A3A5C;
}
.biz-name{ font-size: 20pt; font-weight: bold; color: #1A3A5C; line-height: 1.1; }
.biz-sub{ font-size: 10.5pt; color: #555; margin-top: 3px; }
.report-title-block{ text-align: right; }
.report-title{ font-size: 14pt; font-weight: bold; color: #1A3A5C; }
.report-period{
  font-size: 11.5pt; font-weight: 600; color: #333; margin-top: 4px;
  border: 1.5px solid #1A3A5C; padding: 4px 12px; display: inline-block;
}

/* SECTION HEADERS */
.section-hdr{
  background: #1A3A5C; color: #fff; font-weight: bold;
  font-size: 10.5pt; padding: 5px 10px; margin: 18px 0 8px 0;
}
.section-hdr-green{
  background: #1A6B3A; color: #fff; font-weight: bold;
  font-size: 10.5pt; padding: 5px 10px; margin: 18px 0 8px 0;
}
.section-hdr-red{
  background: #8B1A1A; color: #fff; font-weight: bold;
  font-size: 10.5pt; padding: 5px 10px; margin: 18px 0 8px 0;
}
.section-hdr-gold{
  background: #7A5200; color: #fff; font-weight: bold;
  font-size: 10.5pt; padding: 5px 10px; margin: 18px 0 8px 0;
}

/* SUMMARY GRID */
.summary-grid{
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px;
  margin-bottom: 10px;
}
.summary-box{
  border: 1.5px solid #ccc; padding: 10px 14px; background: #f8f9fa;
}
.summary-label{ font-size: 9pt; color: #555; text-transform: uppercase; letter-spacing: 0.5px; }
.summary-value{ font-size: 15pt; font-weight: bold; color: #1A3A5C; margin-top: 2px; }
.summary-value.green{ color: #1A6B3A; }
.summary-value.red{ color: #8B1A1A; }

/* BREAKDOWN TABLE (key-value) */
.kv-table{ width: 100%; border-collapse: collapse; margin-bottom: 6px; }
.kv-table td{ padding: 5px 6px; border-bottom: 1px solid #e5e7eb; font-size: 10pt; }
.kv-table td:last-child{ text-align: right; font-weight: 600; }

/* DISTRIBUTION BOXES */
.dist-grid{ display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin: 10px 0; }
.dist-box{
  border: 1.5px solid #ccc; padding: 10px 14px;
}
.dist-label{ font-size: 9pt; color: #555; text-transform: uppercase; letter-spacing: 0.5px; }
.dist-value{ font-size: 15pt; font-weight: bold; margin-top: 2px; }

/* DATA TABLES */
table.data{ width: 100%; border-collapse: collapse; font-size: 9.5pt; margin-bottom: 6px; }
table.data th{
  background: #1A3A5C; color: #fff; padding: 5px 8px;
  text-align: left; font-size: 9pt; font-weight: 700;
  text-transform: uppercase; letter-spacing: 0.4px;
}
table.data td{ padding: 5px 8px; border-bottom: 1px solid #e5e7eb; vertical-align: middle; }
table.data tr:nth-child(even) td{ background: #f8f9fa; }
table.data td.num{ text-align: right; white-space: nowrap; }
table.data td.green{ color: #1A6B3A; font-weight: 600; }
table.data td.red{ color: #8B1A1A; font-weight: 600; }
.empty-row{ color: #888; font-style: italic; padding: 10px 8px !important; }

/* FOOTER */
.report-footer{
  margin-top: 24px; padding-top: 10px;
  border-top: 1.5px solid #ccc;
  font-size: 9pt; color: #666; text-align: center;
}
</style>
</head>
<body>

<!-- Screen-only controls -->
<div class="print-controls no-print">
  <button class="print-btn" onclick="window.print()">🖨 Print / Save PDF</button>
  <button class="close-btn" onclick="window.close()">✕ Close</button>
</div>

<div class="page">

  <!-- HEADER -->
  <div class="report-header">
    <div>
      <div class="biz-name">CHRIST-IN-FABIAN QUICK CASH</div>
      <div class="biz-sub">Cash Advance &amp; Buy-Back — Period Report</div>
    </div>
    <div class="report-title-block">
      <div class="report-title">Report</div>
      <div class="report-period">${esc(periodLabel)}</div>
    </div>
  </div>

  <!-- ACTIVITY SUMMARY -->
  <div class="section-hdr">📊 Activity Summary</div>
  <div class="summary-grid">
    <div class="summary-box">
      <div class="summary-label">New Loans</div>
      <div class="summary-value">${rNewTxs.length}</div>
    </div>
    <div class="summary-box">
      <div class="summary-label">Repayments</div>
      <div class="summary-value green">${rClosed.length}</div>
    </div>
    <div class="summary-box">
      <div class="summary-label">Sales</div>
      <div class="summary-value">${rSold.length}</div>
    </div>
  </div>
  <div class="summary-grid" style="margin-top:0">
    <div class="summary-box">
      <div class="summary-label">Expenses</div>
      <div class="summary-value red">${rExpenses.length}</div>
    </div>
    <div class="summary-box">
      <div class="summary-label">Capital Deployed</div>
      <div class="summary-value">${fmtMoney(rCapitalDeployed)}</div>
    </div>
    <div class="summary-box">
      <div class="summary-label">Capital Returned</div>
      <div class="summary-value green">${fmtMoney(rCapitalReturned)}</div>
    </div>
  </div>

  <!-- FINANCIAL SUMMARY -->
  <div class="section-hdr">💰 Financial Summary</div>
  <div class="summary-grid">
    <div class="summary-box">
      <div class="summary-label">Total Revenue</div>
      <div class="summary-value">${fmtMoney(rRevenue)}</div>
    </div>
    <div class="summary-box">
      <div class="summary-label">Total Expenses</div>
      <div class="summary-value red">${fmtMoney(rExpTotal)}</div>
    </div>
    <div class="summary-box">
      <div class="summary-label">Net Profit</div>
      <div class="summary-value ${rProfit >= 0 ? 'green' : 'red'}">${fmtMoney(rProfit)}</div>
    </div>
  </div>

  <!-- REVENUE BREAKDOWN -->
  <div style="margin-top:12px">
    <div style="font-size:9pt;font-weight:700;color:#555;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px">Revenue Breakdown</div>
    <table class="kv-table">
      <tr><td>Repayment fees (${rClosed.length} loan${rClosed.length !== 1 ? 's' : ''})</td><td style="color:#1A6B3A">${fmtMoney(rRepaymentFees)}</td></tr>
      <tr><td>Sales proceeds (${rSold.length} item${rSold.length !== 1 ? 's' : ''})</td><td style="color:#1A6B3A">${fmtMoney(rSalesRevenue)}</td></tr>
      <tr style="border-top:1.5px solid #ccc"><td>Service fees (${rNewTxs.length} loan${rNewTxs.length !== 1 ? 's' : ''} × ${fmtMoney(serviceFee)})</td><td style="color:#1A6B3A">${fmtMoney(rServiceFees)}</td></tr>
    </table>
  </div>

  <!-- PROFIT DISTRIBUTION -->
  <div class="section-hdr">🏦 Profit Distribution</div>
  <div class="dist-grid">
    <div class="dist-box">
      <div class="dist-label">Staff Share (${staffSharePct ?? 10}%)</div>
      <div class="dist-value" style="color:#b45309">${fmtMoney(rStaff)}</div>
    </div>
    <div class="dist-box">
      <div class="dist-label">Stakeholders (${100 - (staffSharePct ?? 10)}%)</div>
      <div class="dist-value" style="color:#1A3A5C">${fmtMoney(rStakeholder)}</div>
    </div>
  </div>

  ${(staffUsers && staffUsers.length > 0) ? `
  <div style="font-size:9pt;font-weight:700;color:#555;text-transform:uppercase;letter-spacing:0.5px;margin:10px 0 4px">Staff Members (equal share)</div>
  <table class="data" style="margin-top:0">
    <thead><tr><th>Name</th><th>Username</th><th>Share</th></tr></thead>
    <tbody>${staffUsers.map(u => `<tr><td>${esc(u.name)}</td><td>@${esc(u.username)}</td><td class="num" style="color:#b45309">${fmtMoney(staffSharePerPerson)}</td></tr>`).join('')}</tbody>
  </table>` : ''}

  <table class="data" style="margin-top:10px">
    <thead>
      <tr>
        <th>Stakeholder</th>
        <th>Capital</th>
        <th>Share %</th>
        <th>Profit Share</th>
      </tr>
    </thead>
    <tbody>${stakeholderRows}</tbody>
  </table>

  <!-- REPAYMENTS -->
  ${rClosed.length > 0 ? `
  <div class="section-hdr-green page-break">✅ Repayments (${rClosed.length})</div>
  <table class="data">
    <thead>
      <tr>
        <th>Ref</th><th>Customer</th><th>Cash Advanced</th><th>Fees Collected</th><th>Date Repaid</th>
      </tr>
    </thead>
    <tbody>${repaymentRows}</tbody>
  </table>` : ''}

  <!-- SALES -->
  ${rSold.length > 0 ? `
  <div class="section-hdr">🏷 Sales (${rSold.length})</div>
  <table class="data">
    <thead>
      <tr>
        <th>Ref</th><th>Item</th><th>Cash Advanced</th><th>Sale Price</th><th>Margin</th><th>Buyer</th><th>Date</th>
      </tr>
    </thead>
    <tbody>${saleRows}</tbody>
  </table>` : ''}

  <!-- NEW LOANS -->
  ${rNewTxs.length > 0 ? `
  <div class="section-hdr-gold">📋 New Loans (${rNewTxs.length})</div>
  <table class="data">
    <thead>
      <tr>
        <th>Ref</th><th>Customer</th><th>Cash Advanced</th><th>Service Fee</th><th>Term</th><th>Date</th><th>Status</th>
      </tr>
    </thead>
    <tbody>${newLoanRows}</tbody>
  </table>` : ''}

  <!-- EXPENSES -->
  ${rExpenses.length > 0 ? `
  <div class="section-hdr-red">🧾 Expenses (${rExpenses.length}) — ${fmtMoney(rExpTotal)}</div>
  ${Object.keys(expByCategory).length > 1 ? `
    <div style="margin-bottom:10px">
      <div style="font-size:9pt;font-weight:700;color:#555;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px">By Category</div>
      <table class="data" style="width:50%">
        <thead><tr><th>Category</th><th>Total</th></tr></thead>
        <tbody>${categoryRows}</tbody>
      </table>
    </div>` : ''}
  <table class="data">
    <thead>
      <tr>
        <th>Date</th><th>Category</th><th>Description</th><th>Amount</th>
      </tr>
    </thead>
    <tbody>${expenseRows}</tbody>
  </table>` : ''}

  ${rClosed.length === 0 && rSold.length === 0 && rNewTxs.length === 0 && rExpenses.length === 0
    ? `<div style="text-align:center;padding:30px;color:#888;font-style:italic">No activity recorded for ${esc(periodLabel)}.</div>`
    : ''}

  <!-- FOOTER -->
  <div class="report-footer">
    Generated on ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
    &nbsp;·&nbsp; Christ-in-Fabian Quick Cash &nbsp;·&nbsp; ${esc(periodLabel)}
  </div>

</div>

<!-- GLOSSARY PAGE -->
<div class="page page-break">
  <div class="report-header" style="margin-bottom:14px;padding-bottom:10px">
    <div>
      <div class="biz-name">CHRIST-IN-FABIAN QUICK CASH</div>
      <div class="biz-sub">Terms &amp; Definitions — Plain-Language Guide</div>
    </div>
    <div class="report-title-block">
      <div class="report-title">Glossary</div>
      <div class="report-period">${esc(periodLabel)}</div>
    </div>
  </div>

  <div class="section-hdr">📖 What Do These Terms Mean?</div>
  <p style="font-size:9.5pt;color:#444;margin-bottom:12px;line-height:1.5">
    This page explains the financial words used in this report in simple, everyday language.
    It is meant to help all stakeholders — regardless of their financial background — understand the numbers.
  </p>

  ${[
    ['Revenue', 'All the money the business received in this period — from loan fees, sales, and service charges combined. Think of it as the total money that came in through the door.'],
    ['Expenses', 'Money that was spent to run the business, such as stationery, printing, airtime, transport, or other running costs. These are the costs of keeping the business going.'],
    ['Net Profit', 'Revenue minus Expenses. This is what the business truly earned after paying all its costs. It is the "real" money made.'],
    ['Cash Advanced', 'The amount of money given to a customer when they bring in an item as collateral. This is the loan amount the customer receives on the spot.'],
    ['Repayment Fees', 'The daily holding and service charges that a customer pays when they come back to collect their item. These fees are how the business earns from loans.'],
    ['Sales Proceeds', 'Money received when an item is sold. This happens when a customer does not return within the agreed number of days. The item is then sold to recover the advance.'],
    ['Service Fee', 'A one-time charge paid upfront when a new loan is started. It is charged before daily fees begin and covers the cost of processing the agreement.'],
    ['Margin (on sales)', 'The extra money earned above the original advance when an item is sold. For example: advance was ₦5,000 and item sold for ₦7,000 — margin is ₦2,000 profit.'],
    ['Capital Deployed', 'The total amount of money given out as new loans in this period. This money is "in the field" — out with customers — and will return when they repay.'],
    ['Capital Returned', 'The total advance money that came back from customers who repaid their loans in this period. This money is now available to be lent out again.'],
    [`Staff Share (${staffSharePct ?? 10}%)`, `The staff's collective share for running the business — ${staffSharePct ?? 10}% of the net profit split equally among all active staff members. This covers day-to-day operations: handling customers, agreements, collections, and operations.`],
    [`Stakeholders (${100 - (staffSharePct ?? 10)}%)`, `The remaining ${100 - (staffSharePct ?? 10)}% of net profit is shared among all investors (stakeholders). Each investor gets a portion based on how much capital they contributed to the business.`],
    ['Stakeholder % Share', 'Each stakeholder\'s percentage is worked out by dividing their capital by the total capital invested. A person who put in more money receives a proportionally larger share of the profit.'],
  ].map(([term, def]) => `
  <div style="margin-bottom:10px;padding:8px 12px;border:1px solid #e5e7eb;background:#f8f9fa;border-left:4px solid #1A3A5C">
    <div style="font-weight:700;font-size:10.5pt;color:#1A3A5C;margin-bottom:4px">${esc(term)}</div>
    <div style="font-size:10pt;color:#222;line-height:1.55">${esc(def)}</div>
  </div>`).join('')}

  <div class="report-footer">
    Generated on ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
    &nbsp;·&nbsp; Christ-in-Fabian Quick Cash &nbsp;·&nbsp; ${esc(periodLabel)}
  </div>
</div>
</body>
</html>`;
};

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------
export const printMonthReport = (data) => {
  const html = buildReportHTML(data);
  const win = window.open('', '_blank', 'width=1000,height=900');
  if (!win) {
    alert('Please allow pop-ups for this site to print the report.');
    return;
  }
  win.document.write(html);
  win.document.close();
  setTimeout(() => { win.focus(); }, 400);
};

export default printMonthReport;
