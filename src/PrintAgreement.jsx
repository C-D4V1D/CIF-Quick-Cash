// PrintAgreement.jsx
// Generates a fully filled-in agreement form that matches Aguleri_Loan_Agreement_Form_v6.docx
// Called from the Agreement step in App.jsx

const fmtMoney = (n) => {
  if (!n && n !== 0) return '';
  return '₦' + Number(n).toLocaleString();
};

const fmtDateLong = (d) => {
  if (!d) return '';
  return new Date(d + 'T00:00:00').toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric',
  });
};

const chk = (checked) => checked ? '☑' : '☐';

// Builds the full HTML for one copy of the agreement (Business or Customer)
const buildCopyHTML = (tx, settings, copyLabel, isBusinessCopy) => {
  const idTypeDisplay = tx.idType === 'bvn' ? 'BVN' : 'NIN';
  const phones = (tx.phoneNumbers || []).filter(Boolean).join('     /     ');
  const familyLine = [tx.familyName, tx.familyRelation ? `(${tx.familyRelation})` : '', tx.familyPhone]
    .filter(Boolean).join('  —  ');
  const itemLine = [tx.aiItemType, tx.aiBrand, tx.aiModel].filter(Boolean).join(' / ');
  const colourCondition = [tx.aiColour, tx.conditionDescription].filter(Boolean).join('  —  ');
  const serialImei = [tx.imei && `IMEI: ${tx.imei}`, tx.serialNumber && `S/N: ${tx.serialNumber}`]
    .filter(Boolean).join('   ');
  const interestRate = settings.interestRate || 1;
  const dailyFee = tx.dailyFee || Math.floor((tx.cashAdvance || 0) * interestRate / 100);

  const hasReceipt = tx.hasReceipt ? true : false;
  const p1Called = (tx.phonesVerified || [])[0];
  const p2Called = (tx.phonesVerified || [])[1];

  // --- Page A (fields + photos) ---
  const pageA = `
  <div class="page">
    <!-- HEADER -->
    <table class="header-table">
      <tr>
        <td class="header-left">
          <div class="biz-name">CHRIST-IN-FABIAN QUICK CASH</div>
          <div class="biz-sub">Cash Advance &amp; Buy-Back Agreement</div>
        </td>
        <td class="header-right">
          <div class="copy-label">${copyLabel}</div>
          <div class="ref-row">Ref:&nbsp;&nbsp;<span class="ref-value">${tx.ref || ''}</span></div>
        </td>
      </tr>
    </table>

    <!-- PART A -->
    <div class="section-header">PART A — CUSTOMER DETAILS</div>
    <div class="staff-note">STAFF: Fill name, address, ID type and ID number from the customer's ID photo.</div>

    <table class="field-table">
      <tr>
        <td class="field-label">Full Name:</td>
        <td class="field-value">${tx.fullName || ''}</td>
      </tr>
      <tr>
        <td class="field-label">Address:</td>
        <td class="field-value">${tx.address || ''}</td>
      </tr>
      <tr>
        <td class="field-label-half">ID Type:</td>
        <td class="field-value-half">${idTypeDisplay}</td>
        <td class="field-label-half"><b>NIN Number:</b></td>
        <td class="field-value-half">${tx.idNumber || ''}</td>
      </tr>
    </table>

    <div class="section-sub-header">PHONE NUMBERS — CUSTOMER FILLS THIS PART</div>
    <div class="staff-note">STAFF: Ask customer to say their numbers. Call at least one number immediately to confirm it is real.</div>

    <table class="field-table">
      <tr>
        <td class="field-label">Phone Numbers:</td>
        <td class="field-value" style="font-style:italic;color:#555;font-size:10px;">(if you have two, provide both)</td>
      </tr>
      <tr>
        <td></td>
        <td class="field-value"><b>${phones}</b></td>
      </tr>
      <tr>
        <td class="field-label">Family / Neighbour Phone:</td>
        <td class="field-value"><i style="color:#555;font-size:10px;">(family member or neighbour — must be a different person)</i></td>
      </tr>
      <tr>
        <td></td>
        <td class="field-value"><b>${familyLine}</b></td>
      </tr>
    </table>

    <div class="check-row">
      <b>Numbers confirmed by calling:</b>&nbsp;&nbsp;
      ${chk(p1Called)} Number 1 called ✓&nbsp;&nbsp;&nbsp;&nbsp;
      ${chk(p2Called)} Number 2 called ✓
    </div>

    <!-- PART B -->
    <div class="section-header">PART B — ITEM DETAILS</div>
    <div class="staff-note">STAFF: Inspect, test, and photograph the item. Note every scratch or fault honestly.</div>

    <table class="field-table">
      <tr>
        <td class="field-label">Item Type / Brand / Model:</td>
        <td class="field-value"><b>${itemLine}</b></td>
      </tr>
      <tr>
        <td class="field-label">Colour &amp; Condition:</td>
        <td class="field-value" style="font-size:10px;color:#555;font-style:italic;">(list ALL visible defects and scratches)</td>
      </tr>
      <tr>
        <td></td>
        <td class="field-value">${colourCondition}</td>
      </tr>
      <tr>
        <td class="field-label">Serial No / IMEI:</td>
        <td class="field-value" style="font-size:10px;color:#555;font-style:italic;">(dial *#06# for phones)</td>
      </tr>
      <tr>
        <td></td>
        <td class="field-value"><b>${serialImei || '—'}</b></td>
      </tr>
    </table>

    <div class="receipt-row">
      <b>Original receipt:</b>&nbsp;&nbsp;
      ${chk(hasReceipt)} Provided and filed&nbsp;&nbsp;&nbsp;&nbsp;
      ${chk(!hasReceipt)} NOT provided — advance amount reduced accordingly
    </div>

    ${isBusinessCopy ? `
    <div class="value-row">
      <b>Estimated Market Value (resale): ₦</b>&nbsp;
      <span class="value-underline">${fmtMoney(tx.estimatedValue)}</span>
      &nbsp;&nbsp;<span style="font-style:italic;color:#888;font-size:10px;">(internal — not on customer copy)</span>
    </div>
    ` : ''}

    <div class="photos-box">
      <table class="photos-table">
        <tr>
          <td class="photos-header" colspan="3"><b>Photos Taken — tick each when done:</b></td>
        </tr>
        <tr>
          <td>${chk(!!tx.photoCustomerHolding)} <b>Customer holding the Item</b></td>
          <td></td>
          <td>${chk(!!tx.photoSigning)} <b>Customer signing the agreement</b></td>
        </tr>
        <tr>
          <td>${chk(!!tx.photoCustomerID)} <b>ID Card</b></td>
          <td>${chk(!!(tx.itemPhotos && tx.itemPhotos.front))} <b>Item — Front</b></td>
          <td>${chk(!!(tx.itemPhotos && (tx.itemPhotos.back || tx.itemPhotos.left || tx.itemPhotos.right)))} <b>Item — Back / Sides</b></td>
        </tr>
      </table>
    </div>
  </div>`;

  // --- Page B (advance details + terms) ---
  const pageB = `
  <div class="page">
    <!-- PART C -->
    <div class="section-header">PART C — ADVANCE DETAILS</div>

    <table class="field-table">
      <tr>
        <td class="field-label-half">Cash Advance Given:</td>
        <td class="field-value-half field-important">₦ <b>${(tx.cashAdvance || 0).toLocaleString()}</b></td>
        <td class="field-label-half"><b>Date Given:</b></td>
        <td class="field-value-half field-important"><b>${fmtDateLong(tx.dateGiven)}</b></td>
      </tr>
      <tr>
        <td class="field-label-half">Agreed Return Date:</td>
        <td class="field-value-half field-important"><b>${fmtDateLong(tx.deadlineDate)}</b></td>
        <td class="field-label-half"><b>Number of Days:</b></td>
        <td class="field-value-half field-important"><b>${tx.loanDays || 30}</b></td>
      </tr>
    </table>

    <div class="fee-box">
      <b>Daily Holding &amp; Service Fee Rate: ${interestRate}% of the advance amount, per day</b><br/>
      Every new day that begins counts as a full day's fee.<br/>
      <i>Example: Advance of ₦10,000 = ₦100 fee for every day.</i><br/>
      <i>Your exact total will be calculated on the day you come to collect your item.</i>
    </div>

    <div class="daily-fee-row">
      <b>Your Daily Fee Amount: ₦</b>&nbsp;
      <span class="value-underline"><b>${dailyFee.toLocaleString()}</b></span>
      &nbsp;&nbsp;
      <span style="font-style:italic;color:#555;font-size:10px;">
        (${interestRate}% of ₦${(tx.cashAdvance || 0).toLocaleString()} = ₦${dailyFee.toLocaleString()} per day)
      </span>
    </div>

    <!-- PART D -->
    <div class="section-header">PART D — TERMS &nbsp;<span style="font-weight:400;font-size:11px;">(Read every clause aloud to the customer before signing)</span></div>

    <div class="clause-header c1">1. YOUR ITEM IS SAFE WITH US</div>
    <div class="clause-body">Your item stays in our shop and remains your property while this agreement is active. We will keep it safely. We are not responsible for any pre-existing hidden faults or internal damage not visible during testing today. We are also not responsible for loss of data on any phone or laptop. When you come to collect, you can only raise a complaint about a specific feature or function if you clearly demonstrated it was working at the time you brought the item — we are not responsible for anything you did not show us.</div>

    <div class="clause-header c2">2. HOW TO COLLECT YOUR ITEM</div>
    <div class="clause-body">Pay back the advance amount plus the Daily Holding &amp; Service Fee for each day the advance has been running. Every new day that begins counts as a full day's fee. We will calculate your exact total on the day you arrive. Pay in full and your item will be returned to you immediately.</div>

    <div class="clause-header c3">3. THE ${tx.loanDays || 30}-DAY PURCHASE RULE — READ CAREFULLY</div>
    <div class="clause-body">You have <b>${tx.loanDays || 30} days</b> from the Date Given above to pay back in full and collect your item.<br/><br/>
    <b>If ${tx.loanDays || 30} days pass and you have not paid, your item is considered SOLD BY YOU and PURCHASED BY US</b> at the advance amount given to you — we may sell it, keep it, or use it as we choose. From that point, this is final and permanent — you cannot claim the item back and no refund will be given.</div>

    <div class="clause-header c4">4. YOUR RESPONSIBILITY TO REMEMBER</div>
    <div class="clause-body"><b>It is strictly YOUR responsibility to remember your return date and come back on time.</b><br/><br/>
    As a courtesy, we may try to send an SMS or call your phone numbers before Day ${tx.loanDays || 30}. However, whether we reach you or not, the ${tx.loanDays || 30}-Day Rule will apply automatically. Failure to receive a reminder call is not a reason to dispute the purchase.</div>

    <div class="clause-header c5">5. DECLARATION OF OWNERSHIP</div>
    <div class="clause-body">I swear that I am the true and legal owner of this item. It is NOT stolen property. If the Nigerian Police or any authority claims this item is stolen or linked to any crime, I take full legal and financial responsibility. I will protect Christ-in-Fabian Quick Cash from any arrest, seizure, or liability that arises from my false claim of ownership.</div>
  </div>`;

  // --- Page C (signatures + official use) ---
  const pageC = `
  <div class="page">
    <!-- PART E -->
    <div class="section-header">PART E — SIGNATURES &amp; AUTHORIZATION</div>

    <p class="consent-text"><i>I have read and understood all the terms above (or they have been read and explained to me fully). I accept the cash advance given to me. I agree to everything stated in this agreement.</i></p>

    <table class="sig-table">
      <tr>
        <td class="sig-left">
          <div class="sig-label"><b>Customer Signature:</b></div>
          <div class="sig-area"></div>
          <div class="sig-underline"></div>
          <div class="sig-sub-label"><i>Name &amp; Date</i></div>
        </td>
        <td class="sig-right">
          <div class="sig-label"><b>Right Thumbprint — Press firmly:</b></div>
          <div class="thumbprint-box">
            <span class="thumbprint-text">RIGHT THUMBPRINT</span>
          </div>
        </td>
      </tr>
    </table>

    <table class="field-table" style="margin-top:20px;">
      <tr>
        <td class="field-label-half">Shop Rep Name:</td>
        <td class="field-value-half"></td>
        <td class="field-label-half"><b>Shop Rep Signature:</b></td>
        <td class="field-value-half"></td>
      </tr>
    </table>

    <div class="photo-note">
      <i>Note: Photographs of the customer holding the item, the customer signing this agreement, ID card if provided, and the item (front and back/sides) have been taken and stored securely with this transaction record.</i>
    </div>

    ${isBusinessCopy ? `
    <!-- OFFICIAL USE ONLY -->
    <div class="official-header">OFFICIAL USE ONLY</div>
    <table class="field-table">
      <tr>
        <td class="field-label-half">Amount Repaid:&nbsp; ₦</td>
        <td class="field-value-half"></td>
        <td class="field-label-half"><b>Date Repaid:</b></td>
        <td class="field-value-half"></td>
      </tr>
      <tr>
        <td class="field-label-half">No. of Days Charged:</td>
        <td class="field-value-half"></td>
        <td class="field-label-half"><b>Total Fees Charged (₦):</b></td>
        <td class="field-value-half"></td>
      </tr>
      <tr>
        <td class="field-label-half">Item Returned: ☐</td>
        <td class="field-value-half"></td>
        <td class="field-label-half"><b>Date Returned:</b></td>
        <td class="field-value-half"></td>
      </tr>
      <tr>
        <td class="field-label-half">Item Sold (if not redeemed): ☐</td>
        <td colspan="3" class="field-value-half">Date Sold:&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Amount Sold: ₦</td>
      </tr>
    </table>
    ` : ''}
  </div>`;

  return pageA + pageB + pageC;
};

// Main export: open print window with complete filled-in agreement
export const printAgreement = (tx, settings = {}) => {
  const businessHTML = buildCopyHTML(tx, settings, 'BUSINESS COPY', true);
  const customerHTML = buildCopyHTML(tx, settings, 'CUSTOMER COPY', false);

  const fullHTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <title>Agreement — ${tx.ref || ''}</title>
  <style>
    /* --- RESET & BASE --- */
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: Arial, Helvetica, sans-serif;
      font-size: 11pt;
      color: #000;
      background: #fff;
    }

    /* --- PAGE --- */
    .page {
      width: 8.5in;
      min-height: 11in;
      padding: 0.55in 0.6in 0.5in 0.6in;
      page-break-after: always;
      background: #fff;
      position: relative;
    }
    .page:last-child { page-break-after: auto; }

    @media print {
      @page { size: letter; margin: 0; }
      .no-print { display: none !important; }
      .page {
        width: 100%;
        min-height: 100vh;
        padding: 0.55in 0.6in 0.5in 0.6in;
      }
    }

    /* --- HEADER TABLE --- */
    .header-table { width: 100%; border-collapse: collapse; margin-bottom: 14px; }
    .header-left { width: 65%; vertical-align: bottom; }
    .header-right {
      width: 35%;
      vertical-align: top;
      border: 2px solid #1a3a5c;
      padding: 8px 12px;
      text-align: left;
    }
    .biz-name { font-size: 22pt; font-weight: bold; color: #1a3a5c; line-height: 1.1; }
    .biz-sub { font-size: 10pt; color: #444; margin-top: 2px; }
    .copy-label { font-size: 10pt; font-weight: bold; color: #1a3a5c; margin-bottom: 8px; }
    .ref-row { font-size: 10.5pt; border-top: 1.5px solid #aaa; padding-top: 6px; margin-top: 4px; }
    .ref-value {
      display: inline-block;
      font-weight: bold;
      font-size: 12pt;
      border-bottom: 2px solid #000;
      min-width: 140px;
      padding-bottom: 1px;
    }

    /* --- SECTION HEADERS --- */
    .section-header {
      background: #1a3a5c;
      color: #fff;
      font-weight: bold;
      font-size: 11pt;
      padding: 5px 10px;
      margin: 10px 0 6px 0;
    }
    .section-sub-header {
      background: #2e6699;
      color: #fff;
      font-weight: bold;
      font-size: 10.5pt;
      padding: 4px 10px;
      margin: 8px 0 4px 0;
    }
    .staff-note {
      background: #fdf6e3;
      border: 1px solid #e8d5a3;
      color: #5a4a00;
      font-style: italic;
      font-size: 9.5pt;
      padding: 5px 10px;
      margin-bottom: 6px;
    }

    /* --- FIELD TABLES --- */
    .field-table { width: 100%; border-collapse: collapse; margin-bottom: 4px; }
    .field-table tr { border-bottom: 1px solid #ddd; }
    .field-label {
      font-weight: bold;
      width: 28%;
      padding: 5px 8px 5px 0;
      vertical-align: top;
      white-space: nowrap;
      font-size: 10.5pt;
    }
    .field-value {
      padding: 5px 4px;
      font-size: 10.5pt;
      border-bottom: 1px solid #555;
      vertical-align: bottom;
    }
    .field-label-half {
      font-weight: bold;
      width: 22%;
      padding: 5px 6px 5px 0;
      font-size: 10.5pt;
      white-space: nowrap;
    }
    .field-value-half {
      padding: 5px 6px;
      font-size: 10.5pt;
      border-bottom: 1px solid #555;
      width: 28%;
    }
    .field-important {
      font-size: 11.5pt;
      color: #000;
    }

    /* --- CHECK ROWS --- */
    .check-row {
      border: 1px solid #bbb;
      padding: 5px 10px;
      font-size: 10.5pt;
      margin: 6px 0;
      background: #f8f8f8;
    }
    .receipt-row {
      border: 1px solid #bbb;
      padding: 5px 10px;
      font-size: 10.5pt;
      margin: 6px 0;
      background: #f8f8f8;
    }
    .value-row {
      border: 1px solid #bbb;
      padding: 5px 10px;
      font-size: 10.5pt;
      margin: 6px 0;
      background: #fdf6e3;
    }
    .value-underline {
      display: inline-block;
      min-width: 160px;
      border-bottom: 1.5px solid #000;
      padding-bottom: 1px;
    }

    /* --- PHOTOS BOX --- */
    .photos-box {
      border: 1.5px solid #3a7d3a;
      margin: 8px 0;
    }
    .photos-table { width: 100%; border-collapse: collapse; }
    .photos-table td { padding: 5px 10px; font-size: 10.5pt; }
    .photos-header {
      background: #3a7d3a;
      color: #fff;
      padding: 5px 10px !important;
    }
    .photos-table tr:not(:first-child) { border-top: 1px solid #b7d7b7; }

    /* --- PART C BOXES --- */
    .fee-box {
      border: 1.5px solid #1a3a5c;
      background: #eef4fb;
      padding: 10px 14px;
      margin: 10px 0;
      font-size: 10.5pt;
      line-height: 1.5;
    }
    .daily-fee-row {
      border: 1.5px solid #888;
      background: #f8f8f8;
      padding: 6px 12px;
      font-size: 10.5pt;
      margin-bottom: 10px;
    }

    /* --- TERMS / CLAUSES --- */
    .clause-header {
      font-weight: bold;
      font-size: 10.5pt;
      color: #fff;
      padding: 5px 10px;
      margin: 8px 0 0 0;
    }
    .c1 { background: #2e6699; }
    .c2 { background: #2e7a3a; }
    .c3 { background: #8b1a1a; }
    .c4 { background: #7a5a00; }
    .c5 { background: #5a1a5a; }
    .clause-body {
      border: 1px solid #ddd;
      padding: 7px 12px;
      font-size: 10pt;
      line-height: 1.45;
      margin-bottom: 4px;
    }

    /* --- SIGNATURES --- */
    .consent-text {
      font-size: 10pt;
      color: #222;
      margin: 12px 0;
      font-style: italic;
    }
    .sig-table { width: 100%; border-collapse: collapse; margin-top: 8px; }
    .sig-left { width: 50%; padding-right: 20px; vertical-align: top; }
    .sig-right { width: 50%; vertical-align: top; }
    .sig-label { font-weight: bold; font-size: 10.5pt; margin-bottom: 8px; }
    .sig-area { height: 60px; }
    .sig-underline { border-bottom: 1.5px solid #000; width: 80%; margin-top: 4px; }
    .sig-sub-label { font-style: italic; font-size: 9.5pt; color: #555; margin-top: 3px; }
    .thumbprint-box {
      border: 1.5px solid #555;
      height: 90px;
      width: 90%;
      display: flex;
      align-items: flex-end;
      justify-content: flex-end;
      padding: 6px;
    }
    .thumbprint-text { font-style: italic; font-size: 9pt; color: #888; }
    .photo-note {
      border: 1px solid #ccc;
      background: #f5f5f5;
      padding: 6px 12px;
      font-size: 9.5pt;
      font-style: italic;
      color: #444;
      margin-top: 12px;
    }

    /* --- OFFICIAL USE ONLY --- */
    .official-header {
      background: #444;
      color: #fff;
      font-weight: bold;
      font-size: 11pt;
      padding: 5px 10px;
      margin: 16px 0 8px 0;
    }

    /* --- PRINT BUTTON (screen only) --- */
    .print-controls {
      position: fixed;
      top: 16px;
      right: 16px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      z-index: 9999;
    }
    .print-btn {
      background: #1a5f2a;
      color: #fff;
      border: none;
      padding: 12px 22px;
      font-size: 14px;
      font-weight: 700;
      border-radius: 8px;
      cursor: pointer;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    }
    .close-btn {
      background: #888;
      color: #fff;
      border: none;
      padding: 8px 22px;
      font-size: 13px;
      font-weight: 600;
      border-radius: 8px;
      cursor: pointer;
    }
    .form-divider {
      border-top: 4px dashed #bbb;
      margin: 0;
      text-align: center;
      font-size: 10pt;
      color: #888;
      padding: 6px 0;
      background: #f0f0f0;
    }
    @media print { .print-controls { display: none; } .form-divider { display: none; } }
  </style>
</head>
<body>

  <!-- Screen-only controls -->
  <div class="print-controls no-print">
    <button class="print-btn" onclick="window.print()">🖨 Print Agreement</button>
    <button class="close-btn" onclick="window.close()">✕ Close</button>
  </div>

  <!-- BUSINESS COPY (pages 1–3) -->
  ${businessHTML}

  <div class="form-divider no-print">✂ — — — BUSINESS COPY ends above / CUSTOMER COPY begins below — — — ✂</div>

  <!-- CUSTOMER COPY (pages 4–6) -->
  ${customerHTML}

</body>
</html>`;

  const win = window.open('', '_blank', 'width=960,height=900');
  if (!win) {
    alert('Please allow pop-ups for this site to print the agreement.');
    return;
  }
  win.document.write(fullHTML);
  win.document.close();
  // Small delay so fonts/styles settle before auto-printing
  setTimeout(() => { win.focus(); }, 400);
};

export default printAgreement;
