// PrintAgreement.jsx
// Generates a fully filled-in agreement form that precisely matches
// Aguleri_Loan_Agreement_Form_v6.docx visual design.
// Called from the Agreement step in App.jsx via: printAgreement(tx, settings)

const fmtDateLong = (d) => {
  if (!d) return '';
  return new Date(d + 'T00:00:00').toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric',
  });
};

const chk = (checked) => checked ? '☑' : '☐';

// ---------------------------------------------------------------------------
// Build HTML for one copy (Business or Customer)
// ---------------------------------------------------------------------------
const buildCopyHTML = (tx, settings, copyLabel, isBusinessCopy, pageOffset) => {
  const idTypeDisplay = tx.idType === 'bvn' ? 'BVN' : 'NIN';
  const phones = (tx.phoneNumbers || []).filter(Boolean).join('     /     ');
  const familyLine = [tx.familyName, tx.familyRelation ? `(${tx.familyRelation})` : '', tx.familyPhone]
    .filter(Boolean).join('  —  ');
  const itemLine = [tx.aiItemType, tx.aiBrand, tx.aiModel].filter(Boolean).join(' / ');
  // Sanitize condition for HTML: strip newlines, escape HTML entities
  const safeCondition = (tx.conditionDescription || '').replace(/[\n\r]+/g, ' ').replace(/\s{2,}/g, ' ').replace(/[<>"&]/g, c => ({'<':'&lt;','>':'&gt;','"':'&quot;','&':'&amp;'}[c]));
  const colourCondition = [tx.aiColour, safeCondition].filter(Boolean).join('  —  ');
  const serialImei = [tx.imei && `IMEI: ${tx.imei}`, tx.serialNumber && `S/N: ${tx.serialNumber}`]
    .filter(Boolean).join('     ');
  const interestRate = settings.interestRate ?? 1;
  const dailyFee = tx.dailyFee ?? Math.floor((tx.cashAdvance || 0) * Number(interestRate) / 100);
  const loanDays = tx.loanDays || 30;

  const hasReceipt = tx.hasReceipt ? true : false;
  const p1Called = (tx.phonesVerified || [])[0];
  const p2Called = (tx.phonesVerified || [])[1];

  // ── PAGE 1 (fields + photos) ──
  const page1 = `
  <div class="page">
    <!-- HEADER -->
    <table class="hdr-tbl">
      <tr>
        <td class="hdr-left">
          <div class="biz-name">CHRIST-IN-FABIAN QUICK CASH</div>
          <div class="biz-sub">Cash Advance &amp; Buy-Back Agreement</div>
        </td>
        <td class="hdr-right">
          <div class="copy-label">${copyLabel}</div>
          <div class="ref-line">Ref: <span class="ref-val">${tx.ref || ''}</span></div>
        </td>
      </tr>
    </table>

    <!-- PART A -->
    <div class="section-hdr">PART A — CUSTOMER DETAILS</div>

    <div class="staff-note">
      <i>STAFF: Fill name, address, ID type and ID number from the customer's ID photo.</i>
    </div>

    <table class="field-tbl">
      <tr>
        <td class="fl" style="width:24%"><b>Full Name:</b></td>
        <td class="fv">${tx.fullName || ''}</td>
      </tr>
      <tr>
        <td class="fl"><b>Address:</b></td>
        <td class="fv">${tx.address || ''}</td>
      </tr>
    </table>
    <table class="field-tbl">
      <tr>
        <td class="fl" style="width:12%"><b>ID Type:</b></td>
        <td class="fv" style="width:28%">${idTypeDisplay}</td>
        <td class="fl" style="width:16%"><b>NIN Number:</b></td>
        <td class="fv" style="width:44%">${tx.idNumber || ''}</td>
      </tr>
    </table>

    <!-- Phone Numbers Sub-Header -->
    <div class="sub-hdr">PHONE NUMBERS — CUSTOMER FILLS THIS PART</div>

    <div class="staff-note">
      <i>STAFF: Ask customer to say their numbers. Call at least one number immediately to confirm it is real.</i>
    </div>

    <table class="field-tbl">
      <tr>
        <td class="fl" style="width:24%"><b>Phone Numbers:</b></td>
        <td class="fv">${phones || ''}</td>
      </tr>
      <tr>
        <td class="fl"><b>Family / Neighbour Phone:</b></td>
        <td class="fv">${familyLine || ''}</td>
      </tr>
    </table>

    <div class="check-row">
      <b>Numbers confirmed by calling:</b>&nbsp;&nbsp;
      ${chk(p1Called)} Number 1 called ✓ &nbsp;&nbsp;&nbsp;&nbsp;
      ${chk(p2Called)} Number 2 called ✓
    </div>

    <!-- Horizontal rule -->
    <div class="hr-gold"></div>

    <!-- PART B -->
    <div class="section-hdr">PART B — ITEM DETAILS</div>

    <div class="staff-note green-note">
      <i>STAFF: Inspect, test, and photograph the item. Note every scratch or fault honestly.</i>
    </div>

    <table class="field-tbl">
      <tr>
        <td class="fl" style="width:28%"><b>Item Type / Brand / Model:</b></td>
        <td class="fv">${itemLine || ''}</td>
      </tr>
      <tr>
        <td class="fl"><b>Colour &amp; Condition:</b></td>
        <td class="fv" style="font-size:9.5pt">${colourCondition || ''}</td>
      </tr>
      <tr>
        <td class="fl"><b>Serial No / IMEI:</b></td>
        <td class="fv">${serialImei || '—'}</td>
      </tr>
    </table>

    <div class="check-row">
      <b>Original receipt:</b>&nbsp;&nbsp;
      ${chk(hasReceipt)} Provided and filed &nbsp;&nbsp;&nbsp;&nbsp;
      ${chk(!hasReceipt)} NOT provided — advance amount reduced accordingly
    </div>

    <!-- Photos Table -->
    <table class="photos-tbl">
      <tr>
        <td class="photos-hdr" colspan="3">Photos Taken — tick each when done:</td>
      </tr>
      <tr>
        <td>${chk(!!tx.photoCustomerHolding)} &nbsp;<b>Customer holding the Item</b></td>
        <td colspan="2">${chk(!!tx.photoSigning)} &nbsp;<b>Customer signing the agreement</b></td>
      </tr>
      <tr>
        <td>${chk(!!tx.photoCustomerID)} &nbsp;<b>ID Card</b></td>
        <td>${chk(!!(tx.itemPhotos && tx.itemPhotos.front))} &nbsp;<b>Item — Front</b></td>
        <td>${chk(!!(tx.itemPhotos && (tx.itemPhotos.back || tx.itemPhotos.left || tx.itemPhotos.right)))} &nbsp;<b>Item — Back / Sides</b></td>
      </tr>
    </table>

    ${isBusinessCopy ? `
    <div class="value-row">
      <b>Estimated Market Value (resale):</b>&nbsp;&nbsp;
      <span class="underline-val">₦ ${(tx.estimatedValue || 0).toLocaleString()}</span>
      &nbsp;&nbsp;<span class="muted-italic">(internal — not on customer copy)</span>
    </div>
    ` : ''}

    <div class="page-footer">Page <b>${pageOffset}</b> of <b>6</b></div>
  </div>`;

  // ── PAGE 2 (advance details + terms clauses 1–4 header) ──
  const page2 = `
  <div class="page">
    <!-- PART C -->
    <div class="section-hdr">PART C — ADVANCE DETAILS</div>

    <table class="field-tbl">
      <tr>
        <td class="fl" style="width:22%"><b>Cash Advance Given:</b></td>
        <td class="fv big-val" style="width:28%">₦ ${(tx.cashAdvance || 0).toLocaleString()}</td>
        <td class="fl" style="width:16%"><b>Date Given:</b></td>
        <td class="fv big-val" style="width:34%">${fmtDateLong(tx.dateGiven)}</td>
      </tr>
      <tr>
        <td class="fl"><b>Agreed Return Date:</b></td>
        <td class="fv big-val">${fmtDateLong(tx.deadlineDate)}</td>
        <td class="fl"><b>Number of Days:</b></td>
        <td class="fv big-val">${loanDays}</td>
      </tr>
    </table>

    <!-- Fee info box -->
    <div class="fee-box">
      <div style="margin-bottom:4px"><b>Daily Holding &amp; Service Fee Rate: &nbsp;${interestRate}% of the advance amount, per day</b></div>
      <div>Every new day that begins counts as a full day's fee.</div>
      <div class="muted-italic">Example: Advance of ₦10,000 = ₦${Math.floor(10000 * interestRate / 100).toLocaleString()} fee for every day.</div>
      <div class="muted-italic">Your exact total will be calculated on the day you come to collect your item.</div>
    </div>

    <div class="daily-fee-row">
      <b>Your Daily Fee Amount: &nbsp;₦</b>&nbsp;
      <span class="underline-val"><b>${dailyFee.toLocaleString()}</b></span>
      &nbsp;&nbsp;&nbsp;
      <span class="muted-italic">(${interestRate}% of ₦${(tx.cashAdvance || 0).toLocaleString()} = ₦${dailyFee.toLocaleString()} per day)</span>
    </div>

    <!-- Horizontal rule -->
    <div class="hr-gold"></div>

    <!-- PART D -->
    <div class="section-hdr">PART D — TERMS &nbsp;&nbsp;<span style="font-weight:400;font-size:10pt">(Read every clause aloud to the customer before signing)</span></div>

    <!-- Clause 1 -->
    <div class="clause-hdr c1">1. &nbsp;YOUR ITEM IS SAFE WITH US</div>
    <div class="clause-body cb1">Your item stays in our shop and remains your property while this agreement is active. We will keep it safely. We are not responsible for any pre-existing hidden faults or internal damage not visible during testing today. We are also not responsible for loss of data on any phone or laptop. When you come to collect, you can only raise a complaint about a specific feature or function if you clearly demonstrated it was working at the time you brought the item — we are not responsible for anything you did not show us.</div>

    <!-- Clause 2 -->
    <div class="clause-hdr c2">2. &nbsp;HOW TO COLLECT YOUR ITEM</div>
    <div class="clause-body cb2">Pay back the advance amount plus the Daily Holding &amp; Service Fee for each day the advance has been running. Every new day that begins counts as a full day's fee. We will calculate your exact total on the day you arrive. Pay in full and your item will be returned to you immediately.</div>

    <!-- Clause 3 -->
    <div class="clause-hdr c3">3. &nbsp;THE ${loanDays}-DAY PURCHASE RULE — READ CAREFULLY</div>
    <div class="clause-body cb3">
      You have <b>${loanDays} days</b> from the Date Given above to pay back in full and collect your item. Your exact deadline is <b>${fmtDateLong(tx.deadlineDate)}</b>.<br/><br/>
      <b>If the ${loanDays}th day (${fmtDateLong(tx.deadlineDate)}) arrives and you have not paid in full, your item is considered SOLD BY YOU and PURCHASED BY US</b> at the advance amount of <b>₦${(tx.cashAdvance || 0).toLocaleString()}</b> given to you — we may sell it, keep it, or use it as we choose. From that point, this is final and permanent — you cannot claim the item back and no refund will be given.
    </div>

    <!-- Clause 4 -->
    <div class="clause-hdr c4">4. &nbsp;YOUR RESPONSIBILITY TO REMEMBER</div>

    <div class="page-footer">Page <b>${pageOffset + 1}</b> of <b>6</b></div>
  </div>`;

  // ── PAGE 3 (clause 4 body + clauses 5-6 + signatures + official use) ──
  const page3 = `
  <div class="page">
    <div class="clause-body cb4">
      <b>It is strictly YOUR responsibility to remember your return date (${fmtDateLong(tx.deadlineDate)}) and come back on time.</b><br/><br/>
      As a courtesy, we may try to send an SMS or call your phone numbers before Day ${loanDays}. However, whether we reach you or not, the ${loanDays}-Day Purchase Rule will apply automatically on <b>${fmtDateLong(tx.deadlineDate)}</b>. Failure to receive a reminder call is not a reason to dispute the purchase.
    </div>

    <!-- Clause 5 -->
    <div class="clause-hdr c5">5. &nbsp;DECLARATION OF OWNERSHIP</div>
    <div class="clause-body cb5">I swear that I am the true and legal owner of this item. It is NOT stolen property. If the Nigerian Police or any authority claims this item is stolen or linked to any crime, I take full legal and financial responsibility. I will protect Christ-in-Fabian Quick Cash from any arrest, seizure, or liability that arises from my false claim of ownership.</div>

    <!-- Clause 6 -->
    <div class="clause-hdr c6">6. &nbsp;DATA CONSENT</div>
    <div class="clause-body cb6">The customer consents to the collection and storage of personal data (NIN, photographs, contact details) for the purpose of this transaction.</div>

    <!-- Horizontal rule -->
    <div class="hr-gold"></div>

    <!-- PART E -->
    <div class="section-hdr">PART E — SIGNATURES &amp; AUTHORIZATION</div>

    <p class="consent"><i>I have read and understood all the terms above (or they have been read and explained to me fully). I accept the cash advance given to me. I agree to everything stated in this agreement.</i></p>

    <table class="sig-tbl">
      <tr>
        <td class="sig-left">
          <div><b>Customer Signature:</b></div>
          <div class="sig-space"></div>
          <div class="sig-line"></div>
          <div class="sig-sub"><i>Name &amp; Date</i></div>
        </td>
        <td class="sig-right">
          <div><b>Right Thumbprint — Press firmly:</b></div>
          <div class="thumb-box">
            <span class="thumb-text">RIGHT THUMBPRINT</span>
          </div>
        </td>
      </tr>
    </table>

    <table class="field-tbl" style="margin-top:16px">
      <tr>
        <td class="fl" style="width:18%"><b>Shop Rep Name:</b></td>
        <td class="fv" style="width:32%">${tx.completedBy || tx.createdBy || ''}</td>
        <td class="fl" style="width:18%"><b>Shop Rep Signature:</b></td>
        <td class="fv" style="width:32%"></td>
      </tr>
    </table>

    <div class="photo-note">
      <i>Note: Photographs of the customer holding the item, the customer signing this agreement, ID card if provided, and the item (front and back/sides) have been taken and stored securely with this transaction record.</i>
    </div>

    ${isBusinessCopy ? `
    <!-- Horizontal rule -->
    <div class="hr-gold"></div>

    <!-- OFFICIAL USE ONLY -->
    <div class="official-hdr">OFFICIAL USE ONLY</div>

    <table class="field-tbl">
      <tr>
        <td class="fl" style="width:18%"><b>Amount Repaid:</b></td>
        <td class="fv" style="width:32%">₦</td>
        <td class="fl" style="width:16%"><b>Date Repaid:</b></td>
        <td class="fv" style="width:34%"></td>
      </tr>
      <tr>
        <td class="fl"><b>No. of Days Charged:</b></td>
        <td class="fv"></td>
        <td class="fl"><b>Total Fees Charged (₦):</b></td>
        <td class="fv"></td>
      </tr>
      <tr>
        <td class="fl"><b>Item Returned: &nbsp;☐</b></td>
        <td class="fv"></td>
        <td class="fl"><b>Date Returned:</b></td>
        <td class="fv"></td>
      </tr>
      <tr>
        <td class="fl"><b>Item Sold (if not redeemed): &nbsp;☐</b></td>
        <td class="fv" colspan="3"><span class="muted-italic">Date Sold: _______________ &nbsp;&nbsp; Amount Sold: ₦ _______________</span></td>
      </tr>
    </table>
    ` : ''}

    <div class="page-footer">Page <b>${pageOffset + 2}</b> of <b>6</b></div>
  </div>`;

  return page1 + page2 + page3;
};

// ---------------------------------------------------------------------------
// Main export: open print window with the complete filled-in agreement
// ---------------------------------------------------------------------------
export const printAgreement = (tx, settings = {}) => {
  const businessHTML = buildCopyHTML(tx, settings, 'BUSINESS COPY', true, 1);
  const customerHTML = buildCopyHTML(tx, settings, 'CUSTOMER COPY', false, 4);

  const fullHTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<title>Agreement — ${tx.ref || ''}</title>
<style>
/* === RESET === */
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}

body{
  font-family: Calibri, 'Segoe UI', Arial, Helvetica, sans-serif;
  font-size: 10.5pt;
  color: #000;
  background: #fff;
  line-height: 1.35;
}

/* === PAGE === */
.page{
  width: 8.5in;
  min-height: 11in;
  padding: 0.6in 0.7in 0.55in 0.7in;
  page-break-after: always;
  position: relative;
  background: #fff;
}
.page:last-child{ page-break-after: auto; }

@media print{
  @page{ size: letter; margin: 0; }
  .no-print{ display:none!important; }
  .page{ width:100%; min-height:100vh; padding: 0.6in 0.7in 0.55in 0.7in; }
}

/* === HEADER === */
.hdr-tbl{ width:100%; border-collapse:collapse; margin-bottom:16px; }
.hdr-left{ width:62%; vertical-align:bottom; padding-right:12px; }
.hdr-right{
  width:38%; vertical-align:top;
  border: 2px solid #1A3A5C;
  padding: 10px 14px;
}
.biz-name{
  font-size: 22pt; font-weight: bold; color: #1A3A5C;
  line-height: 1.1; letter-spacing: -0.3px;
}
.biz-sub{ font-size: 11pt; color: #555F6E; margin-top: 3px; }
.copy-label{ font-size: 10.5pt; font-weight: bold; color: #1A3A5C; margin-bottom:10px; }
.ref-line{
  font-size: 10.5pt; border-top: 1.5px solid #AAA;
  padding-top: 8px; margin-top: 4px;
}
.ref-val{
  display: inline-block; font-weight: bold; font-size: 12pt;
  border-bottom: 2px solid #000; min-width: 130px; padding-bottom: 1px;
}

/* === SECTION HEADERS === */
.section-hdr{
  background: #1A3A5C; color: #fff; font-weight: bold;
  font-size: 11pt; padding: 6px 12px; margin: 14px 0 8px 0;
}
.sub-hdr{
  background: #2E6DA4; color: #fff; font-weight: bold;
  font-size: 10.5pt; padding: 5px 12px; margin: 10px 0 6px 0;
}

/* === STAFF NOTES === */
.staff-note{
  background: #FEF3D5; border: 1px solid #E8D5A3; border-left: 3px solid #C8A84E;
  color: #5A4A00; font-size: 9.5pt; padding: 5px 10px; margin-bottom: 8px;
}
.green-note{
  background: #EAF7EE; border-color: #B2D8C0; border-left-color: #1A6B3A;
  color: #1A4A2A;
}

/* === FIELD TABLES === */
.field-tbl{ width:100%; border-collapse:collapse; margin-bottom:4px; }
.field-tbl tr{ border-bottom: 1px solid #DDD; }
.fl{
  font-size: 10.5pt; padding: 6px 6px 6px 0;
  vertical-align: top; white-space: nowrap;
}
.fv{
  font-size: 10.5pt; padding: 6px 4px;
  border-bottom: 1px solid #555; vertical-align: bottom;
}
.big-val{ font-size: 11.5pt; font-weight: 600; }

/* === CHECK / RECEIPT ROWS === */
.check-row{
  border: 1px solid #BBB; padding: 5px 10px;
  font-size: 10.5pt; margin: 8px 0; background: #F4F6F7;
}

/* === ESTIMATED VALUE (business only) === */
.value-row{
  border: 1px solid #BBB; padding: 6px 10px;
  font-size: 10.5pt; margin: 8px 0; background: #FEF3D5;
}
.underline-val{
  display: inline-block; min-width: 160px;
  border-bottom: 1.5px solid #000; padding-bottom: 1px;
}
.muted-italic{
  font-style: italic; color: #666; font-size: 9.5pt;
}

/* === PHOTOS TABLE === */
.photos-tbl{
  width:100%; border-collapse:collapse;
  border: 1.5px solid #1A6B3A; margin: 8px 0;
}
.photos-tbl td{ padding: 5px 10px; font-size: 10.5pt; }
.photos-hdr{
  background: #1A6B3A; color: #fff; font-weight: bold;
  padding: 5px 10px !important;
}
.photos-tbl tr:not(:first-child){ border-top: 1px solid #B7D7B7; }
.photos-tbl tr:not(:first-child) td{ background: #EAF7EE; }

/* === PART C — FEE BOX === */
.fee-box{
  border: 1.5px solid #1A3A5C; background: #D8E8F5;
  padding: 10px 14px; margin: 10px 0; font-size: 10.5pt; line-height:1.45;
}
.daily-fee-row{
  border: 1.5px solid #888; background: #F4F6F7;
  padding: 6px 12px; font-size: 10.5pt; margin-bottom: 10px;
}

/* === HORIZONTAL RULE === */
.hr-gold{
  border-top: 2.5px solid #C8A84E; margin: 12px 0;
}

/* === CLAUSE HEADERS === */
.clause-hdr{
  font-weight: bold; font-size: 10.5pt; color: #fff;
  padding: 5px 12px; margin: 10px 0 0 0;
}
.c1{ background: #2E6DA4; }
.c2{ background: #1A6B3A; }
.c3{ background: #8B1A1A; }
.c4{ background: #7A5200; }
.c5{ background: #8B1A1A; }
.c6{ background: #2E6DA4; }

/* === CLAUSE BODIES === */
.clause-body{
  border: 1px solid #DDD; padding: 8px 12px;
  font-size: 10pt; line-height: 1.45; margin-bottom: 6px;
}
.cb1{ background: #D8E8F5; border-color: #B0CCE0; }
.cb2{ background: #D5F0E0; border-color: #AAD4BA; }
.cb3{ background: #F5D5D5; border-color: #E0B0B0; }
.cb4{ background: #FEF3D5; border-color: #E8D5A3; }
.cb5{ background: #F5D5D5; border-color: #E0B0B0; }
.cb6{ background: #D8E8F5; border-color: #B0CCE0; }

/* === SIGNATURES === */
.consent{
  font-size: 10pt; color: #222; margin: 12px 0;
}
.sig-tbl{ width:100%; border-collapse:collapse; margin-top:8px; }
.sig-left{ width:50%; padding-right:20px; vertical-align:top; }
.sig-right{ width:50%; vertical-align:top; }
.sig-space{ height: 55px; }
.sig-line{ border-bottom: 1.5px solid #000; width: 75%; margin-top:4px; }
.sig-sub{ font-size: 9.5pt; color: #555; margin-top:3px; }
.thumb-box{
  border: 1.5px solid #555; height: 95px; width: 85%;
  display: flex; align-items: flex-end; justify-content: flex-end;
  padding: 6px; margin-top: 4px;
}
.thumb-text{ font-style: italic; font-size: 9pt; color: #999; letter-spacing:1px; }

/* === PHOTO NOTE === */
.photo-note{
  border: 1px solid #CCC; background: #F4F6F7;
  padding: 6px 12px; font-size: 9.5pt; color: #444;
  margin-top: 14px;
}

/* === OFFICIAL USE ONLY === */
.official-hdr{
  background: #666; color: #fff; font-weight: bold;
  font-size: 11pt; padding: 5px 12px; margin: 16px 0 8px 0;
}

/* === PAGE FOOTER === */
.page-footer{
  position: absolute; bottom: 0.45in; right: 0.7in;
  font-size: 10pt; color: #333; text-align: right;
}

/* === PRINT CONTROLS (screen only) === */
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
.form-divider{
  border-top: 4px dashed #bbb; margin: 0;
  text-align: center; font-size: 10pt; color: #888;
  padding: 8px 0; background: #f0f0f0;
}
@media print{
  .print-controls{ display: none; }
  .form-divider{ display: none; }
}
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
  setTimeout(() => { win.focus(); }, 400);
};

export default printAgreement;
