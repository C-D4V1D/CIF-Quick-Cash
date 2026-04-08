// PrintAgreement.jsx
// Generates A4 PDFs for Outright Purchase Receipt and Cash Advance Agreement.
// Uses jsPDF + html2canvas to produce a proper PDF (no browser print dialog).
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

const fmtDateLong = (d) => {
  if (!d) return '';
  return new Date(d + 'T00:00:00').toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric',
  });
};

const chk = (checked) => checked ? '☑' : '☐';

// ---------------------------------------------------------------------------
// Build HTML for one copy (Business or Customer) — folded A4 booklet layout
// Each copy = 2 sheet-face divs (landscape A4), printed front and back, folded in half.
//   face1: left panel = back cover (signatures + official use) | right panel = page 1 (Parts A + B)
//   face2: left panel = page 2 (photos + Part C + Part D Clauses 1–2) | right panel = page 3 (Clauses 3–6)
// ---------------------------------------------------------------------------
const buildCopyHTML = (tx, settings, copyLabel, isBusinessCopy) => {
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
  const dailyFee = tx.dailyFee ?? Math.round((tx.cashAdvance || 0) * Number(interestRate) / 100);
  const loanDays = tx.loanDays || 30;
  const maxLoanDays = Math.max(1, Number(settings.maxLoanDays) || 30);
  const internalDeadlineDate = (() => {
    if (!tx.dateGiven) return tx.deadlineDate || '';
    const d = new Date(tx.dateGiven);
    d.setUTCHours(0, 0, 0, 0);
    d.setUTCDate(d.getUTCDate() + maxLoanDays);
    return d.toISOString().split('T')[0];
  })();

  const hasReceipt = tx.hasReceipt ? true : false;
  const p1Called = (tx.phonesVerified || [])[0];
  const p2Called = (tx.phonesVerified || [])[1];

  // Rep signature image (attached via tx.repSignatureUrl) — embedded in Part E
  const repSigCell = tx.repSignatureUrl
    ? `<img src="${tx.repSignatureUrl}" alt="Shop Rep Signature" style="max-height:22px;max-width:100%;object-fit:contain;vertical-align:middle" />`
    : '';

  // ── PART E — SIGNATURES (lives on back cover for both copies) ──
  const partEContent = `
    <div class="hr-gold"></div>
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
    <table class="field-tbl" style="margin-top:4px">
      <tr>
        <td class="fl" style="width:18%"><b>Shop Rep Name:</b></td>
        <td class="fv" style="width:32%">${tx.completedBy || tx.createdBy || ''}</td>
        <td class="fl" style="width:18%"><b>Shop Rep Signature:</b></td>
        <td class="fv" style="width:32%">${repSigCell}</td>
      </tr>
    </table>
    <div class="photo-note">
      <i>Photos stored: customer holding item, signing agreement, ID card (if provided), item front &amp; back/sides.</i>
    </div>`;

  // ── OFFICIAL USE ONLY (business copy only — lives on back cover) ──
  const officialUseHTML = `
    <div class="hr-gold"></div>
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
    <div class="value-row">
      <b>Estimated Market Value (resale):</b>&nbsp;&nbsp;
      <span class="underline-val">₦ ${(tx.estimatedValue || 0).toLocaleString()}</span>
      &nbsp;<span class="muted-italic">(internal — not on customer copy)</span>
    </div>`;

  // ── BACK COVER (left panel of face 1) ──
  // Business: title + official use + market value + Part E signatures
  // Customer: title + tagline + Part E signatures
  const backCoverHTML = isBusinessCopy ? `
    <div>
      <div class="sheet-label">${copyLabel} &nbsp;·&nbsp; Page 4 of 4 &nbsp;·&nbsp; Ref: ${tx.ref || ''}</div>
      <div class="biz-name" style="font-size:11pt">CHRIST-IN-FABIAN QUICK CASH</div>
      <div class="biz-sub">Cash Advance &amp; Buy-Back Agreement</div>
    </div>
    ${officialUseHTML}
    ${partEContent}
  ` : `
    <div style="text-align:center;padding-top:2mm;">
      <div class="sheet-label" style="text-align:left">${copyLabel} &nbsp;·&nbsp; Page 4 of 4 &nbsp;·&nbsp; Ref: ${tx.ref || ''}</div>
      <div class="biz-name" style="font-size:13pt;line-height:1.2">CHRIST-IN-FABIAN QUICK CASH</div>
      <div class="biz-sub" style="margin-top:2mm">Cash Advance &amp; Buy-Back Agreement</div>
      <div style="margin-top:4mm;font-size:7.5pt;color:#555;font-style:italic;line-height:1.5">
        Keep this agreement safely. It is proof of your<br/>transaction and protects your rights.
      </div>
      <div style="margin-top:2mm;font-size:7.5pt;color:#888">Ref: <b>${tx.ref || ''}</b></div>
    </div>
    ${partEContent}
  `;

  // ── FACE 1 RIGHT PANEL — PAGE 1 content (PART A + PART B) ──
  const page1Content = `
    <table class="hdr-tbl">
      <tr>
        <td class="hdr-left">
          <div class="biz-name">CHRIST-IN-FABIAN QUICK CASH</div>
          <div class="biz-sub">Cash Advance &amp; Buy-Back Agreement</div>
        </td>
        <td class="hdr-right">
          <div class="copy-label">${copyLabel}</div>
          <div class="ref-line">Ref: <span class="ref-val">${tx.ref || ''}</span></div>
          <div style="font-size:6.5pt;color:#999;margin-top:3px">Page 1 of 4</div>
        </td>
      </tr>
    </table>

    <div class="section-hdr">PART A — CUSTOMER DETAILS</div>
    <table class="field-tbl">
      <tr><td class="fl" style="width:24%"><b>Full Name:</b></td><td class="fv">${tx.fullName || ''}</td></tr>
      <tr><td class="fl"><b>Address:</b></td><td class="fv">${tx.address || ''}</td></tr>
    </table>
    <table class="field-tbl">
      <tr>
        <td class="fl" style="width:12%"><b>ID Type:</b></td>
        <td class="fv" style="width:28%">${idTypeDisplay}</td>
        <td class="fl" style="width:16%"><b>${idTypeDisplay} Number:</b></td>
        <td class="fv" style="width:44%">${tx.idNumber || ''}</td>
      </tr>
    </table>

    <div class="sub-hdr">PHONE NUMBERS — CUSTOMER FILLS THIS PART</div>
    <table class="field-tbl">
      <tr><td class="fl" style="width:24%"><b>Phone Numbers:</b></td><td class="fv">${phones || ''}</td></tr>
      <tr><td class="fl"><b>Family / Neighbour Phone:</b></td><td class="fv">${familyLine || ''}</td></tr>
    </table>
    <div class="check-row">
      <b>Numbers confirmed by calling:</b>&nbsp;&nbsp;
      ${chk(p1Called)} Number 1 called ✓ &nbsp;&nbsp;&nbsp;
      ${chk(p2Called)} Number 2 called ✓
    </div>

    <div class="hr-gold"></div>

    <div class="section-hdr">PART B — ITEM DETAILS</div>
    <table class="field-tbl">
      <tr><td class="fl" style="width:28%"><b>Item Type / Brand / Model:</b></td><td class="fv">${itemLine || ''}</td></tr>
      <tr><td class="fl"><b>Colour &amp; Condition:</b></td><td class="fv">${colourCondition || ''}</td></tr>
      <tr><td class="fl"><b>Serial No / IMEI:</b></td><td class="fv">${serialImei || '—'}</td></tr>
    </table>
    <div class="check-row">
      <b>Original receipt:</b>&nbsp;&nbsp;
      ${chk(hasReceipt)} Provided and filed &nbsp;&nbsp;&nbsp;
      ${chk(!hasReceipt)} NOT provided — advance reduced accordingly
    </div>
  `;

  // ── FACE 2 LEFT PANEL — PAGE 2 content (PART C + PART D terms) ──
  const page2Content = `
    <div class="sheet-label">${copyLabel} &nbsp;·&nbsp; Page 2 of 4 &nbsp;·&nbsp; Ref: ${tx.ref || ''}</div>
    <table class="photos-tbl">
      <tr><td class="photos-hdr" colspan="3">Photos Taken — tick each when done:</td></tr>
      <tr>
        <td>${chk(!!tx.photoCustomerHolding)} &nbsp;<b>Customer holding Item</b></td>
        <td colspan="2">${chk(!!tx.photoSigning)} &nbsp;<b>Customer signing agreement</b></td>
      </tr>
      <tr>
        <td>${chk(!!tx.photoCustomerID)} &nbsp;<b>ID Card</b></td>
        <td>${chk(!!(tx.itemPhotos && tx.itemPhotos.length > 0))} &nbsp;<b>Item — Front</b></td>
        <td>${chk(!!(tx.itemPhotos && tx.itemPhotos.length > 1))} &nbsp;<b>Item — Back/Sides</b></td>
      </tr>
    </table>

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

    <div class="fee-box">
      <div style="margin-bottom:3px"><b>Daily Holding &amp; Service Fee Rate: &nbsp;${interestRate}% of the advance amount, per day</b></div>
      <div>Every new day that begins counts as a full day's fee.</div>
      <div class="muted-italic">Example: Advance of ₦10,000 = ₦${Math.round(10000 * interestRate / 100).toLocaleString()} fee per day.</div>
      <div class="muted-italic">Your exact total will be calculated on the day you come to collect.</div>
    </div>

    <div class="daily-fee-row">
      <b>Your Daily Fee Amount: &nbsp;₦</b>&nbsp;
      <span class="underline-val"><b>${dailyFee.toLocaleString()}</b></span>
      &nbsp;&nbsp;
      <span class="muted-italic">(${interestRate}% of ₦${(tx.cashAdvance || 0).toLocaleString()} = ₦${dailyFee.toLocaleString()} per day)</span>
    </div>

    <div class="hr-gold"></div>

    <div class="section-hdr">PART D — TERMS &nbsp;<span style="font-weight:400">(Please read every clause carefully before you sign)</span></div>

    <div class="clause-hdr c1">1. &nbsp;YOUR ITEM IS SAFE WITH US</div>
    <div class="clause-body cb1">Your item stays in our shop and remains your property while this agreement is active. We will keep it safely. We are not responsible for any pre-existing hidden faults or internal damage not visible during testing today. We are also not responsible for loss of data on any phone or laptop. When you come to collect, you can only raise a complaint about a specific feature or function if you clearly demonstrated it was working at the time you brought the item — we are not responsible for anything you did not show us.</div>

    <div class="clause-hdr c2">2. &nbsp;DATA CONSENT</div>
    <div class="clause-body cb2">The customer consents to the collection and storage of personal data (NIN, photographs, contact details) for the purpose of this transaction.</div>
  `;

  // ── FACE 2 RIGHT PANEL — PAGE 3 content (Clauses 3–6) ──
  const page3Content = `
    <div class="sheet-label">${copyLabel} &nbsp;·&nbsp; Page 3 of 4 &nbsp;·&nbsp; Ref: ${tx.ref || ''}</div>

    <div class="clause-hdr c3">3. &nbsp;HOW TO COLLECT YOUR ITEM</div>
    <div class="clause-body cb3">Pay back the advance amount plus the Daily Holding &amp; Service Fee for each day the advance has been running. Every new day that begins counts as a full day's fee. We will calculate your exact total on the day you arrive. Pay in full and your item will be returned to you immediately.</div>

    <div class="clause-hdr c4">4. &nbsp;THE ${maxLoanDays}-DAY PURCHASE RULE — READ CAREFULLY</div>
    <div class="clause-body cb4">
      You have <b>${loanDays} days</b> from the Date Given above to pay back in full and collect your item. Your agreed return date is <b>${fmtDateLong(tx.deadlineDate)}</b>. If you have not paid by then, your account will be marked overdue.<br/>
      <div style="margin-top:3px"><b>If the ${maxLoanDays}th day (${fmtDateLong(internalDeadlineDate)}) arrives and you have not paid in full, your item is considered SOLD BY YOU and PURCHASED BY US</b> at the advance amount of <b>₦${(tx.cashAdvance || 0).toLocaleString()}</b> given to you — we may sell it, keep it, or use it as we choose. From that point, this is final and permanent — you cannot claim the item back and no refund will be given.</div>
    </div>

    <div class="clause-hdr c5">5. &nbsp;YOUR RESPONSIBILITY TO REMEMBER</div>
    <div class="clause-body cb5">
      <b>It is strictly YOUR responsibility to remember your return date (${fmtDateLong(tx.deadlineDate)}) and come back on time.</b><br/>
      As a courtesy, we may try to send an SMS or call your phone numbers before Day ${maxLoanDays}. However, whether we reach you or not, the ${maxLoanDays}-Day Purchase Rule will apply automatically on <b>${fmtDateLong(internalDeadlineDate)}</b>. Failure to receive a reminder call is not a reason to dispute the purchase.
    </div>

    <div class="clause-hdr c6">6. &nbsp;DECLARATION OF OWNERSHIP</div>
    <div class="clause-body cb6">I swear that I am the true and legal owner of this item. It is NOT stolen property. If the Nigerian Police or any authority claims this item is stolen or linked to any crime, I take full legal and financial responsibility. I will protect Christ-in-Fabian Quick Cash from any arrest, seizure, or liability that arises from my false claim of ownership.</div>
  `;

  // ── Assemble: 2 sheet faces ──
  const face1 = `
  <div class="sheet-face">
    <div class="panel panel-left">${backCoverHTML}</div>
    <div class="panel panel-right">${page1Content}</div>
  </div>`;

  const face2 = `
  <div class="sheet-face">
    <div class="panel panel-left">${page2Content}</div>
    <div class="panel panel-right">${page3Content}</div>
  </div>`;

  return [face1, face2];
};

// ---------------------------------------------------------------------------
// Build HTML for one outright purchase receipt copy (Business or Customer)
// 2 pages per copy (4 total): page 1 = seller + item, page 2 = purchase + terms + signatures
// ---------------------------------------------------------------------------
const buildOutrightCopyHTML = (tx, settings, copyLabel, isBusinessCopy) => {
  const idTypeDisplay = tx.idType === 'bvn' ? 'BVN' : 'NIN';
  const phones = (tx.phoneNumbers || []).filter(Boolean).join('     /     ');
  const familyLine = [tx.familyName, tx.familyRelation ? `(${tx.familyRelation})` : '', tx.familyPhone]
    .filter(Boolean).join('  —  ');
  const itemLine = [tx.aiItemType, tx.aiBrand, tx.aiModel].filter(Boolean).join(' / ');
  const safeCondition = (tx.conditionDescription || '').replace(/[\n\r]+/g, ' ').replace(/\s{2,}/g, ' ').replace(/[<>"&]/g, c => ({'<':'&lt;','>':'&gt;','"':'&quot;','&':'&amp;'}[c]));
  const colourCondition = [tx.aiColour, safeCondition].filter(Boolean).join('  —  ');
  const serialImei = [tx.imei && `IMEI: ${tx.imei}`, tx.serialNumber && `S/N: ${tx.serialNumber}`]
    .filter(Boolean).join('     ');
  const p1Called = (tx.phonesVerified || [])[0];
  const p2Called = (tx.phonesVerified || [])[1];

  // Rep signature image (attached via tx.repSignatureUrl) — embedded in Part E
  const repSigCell = tx.repSignatureUrl
    ? `<img src="${tx.repSignatureUrl}" alt="Shop Rep Signature" style="max-height:22px;max-width:100%;object-fit:contain;vertical-align:middle" />`
    : '';

  // ── PAGE 1 (seller details + item details) ──
  const page1 = `
  <div class="page">
    <!-- HEADER -->
    <table class="hdr-tbl">
      <tr>
        <td class="hdr-left">
          <div class="biz-name">CHRIST-IN-FABIAN QUICK CASH</div>
          <div class="biz-sub">Outright Purchase Receipt</div>
        </td>
        <td class="hdr-right">
          <div class="copy-label">${copyLabel}</div>
          <div class="ref-line">Ref: <span class="ref-val">${tx.ref || ''}</span></div>
        </td>
      </tr>
    </table>

    <!-- PART A -->
    <div class="section-hdr">PART A — SELLER DETAILS</div>

    <div class="staff-note">
      <i>STAFF: Fill name, address, ID type and ID number from the seller's ID photo.</i>
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
        <td class="fl" style="width:16%"><b>${idTypeDisplay} Number:</b></td>
        <td class="fv" style="width:44%">${tx.idNumber || ''}</td>
      </tr>
    </table>

    <div class="sub-hdr">PHONE NUMBERS — SELLER FILLS THIS PART</div>
    <div class="staff-note">
      <i>STAFF: Ask seller to say their numbers. Call at least one immediately to confirm it rings.</i>
    </div>

    <table class="field-tbl">
      <tr>
        <td class="fl" style="width:24%"><b>Phone Numbers:</b></td>
        <td class="fv">${phones || ''}</td>
      </tr>
      ${familyLine ? `<tr><td class="fl"><b>Family / Neighbour Phone:</b></td><td class="fv">${familyLine}</td></tr>` : ''}
    </table>

    <div class="check-row">
      <b>Numbers confirmed by calling:</b>&nbsp;&nbsp;
      ${chk(p1Called)} Number 1 called ✓ &nbsp;&nbsp;&nbsp;&nbsp;
      ${chk(p2Called)} Number 2 called ✓
    </div>

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

    <table class="photos-tbl">
      <tr>
        <td class="photos-hdr" colspan="3">Photos Taken — tick each when done:</td>
      </tr>
      <tr>
        <td>${chk(!!tx.photoCustomerHolding)} &nbsp;<b>Seller holding the Item</b></td>
        <td colspan="2">${chk(!!tx.photoSigning)} &nbsp;<b>Seller signing the receipt</b></td>
      </tr>
      <tr>
        <td>${chk(!!tx.photoCustomerID)} &nbsp;<b>ID Card</b></td>
        <td>${chk(!!(tx.itemPhotos && tx.itemPhotos.length > 0))} &nbsp;<b>Item — Front</b></td>
        <td>${chk(!!(tx.itemPhotos && tx.itemPhotos.length > 1))} &nbsp;<b>Item — Back / Sides</b></td>
      </tr>
    </table>

    ${isBusinessCopy ? `
    <div class="value-row">
      <b>Estimated Resale Value:</b>&nbsp;&nbsp;
      <span class="underline-val">₦ ${(tx.estimatedValue || 0).toLocaleString()}</span>
      &nbsp;&nbsp;<span class="muted-italic">(internal — not on seller copy)</span>
    </div>
    ` : ''}

    <div class="hr-gold"></div>

    <!-- PART C -->
    <div class="section-hdr">PART C — PURCHASE DETAILS</div>

    <table class="field-tbl">
      <tr>
        <td class="fl" style="width:34%"><b>Amount Paid to Seller:</b></td>
        <td class="fv big-val" style="width:66%">₦ ${(tx.cashAdvance || 0).toLocaleString()}</td>
      </tr>
      <tr>
        <td class="fl"><b>Purchase Date:</b></td>
        <td class="fv big-val">${fmtDateLong(tx.dateGiven)}</td>
      </tr>
    </table>

    <div class="fee-box" style="background:#D5F0E0; border-color:#1A6B3A; padding:7px 14px;">
      <b>Outright permanent sale.</b> The seller receives the full amount above in cash today. No repayment is required. Ownership transfers immediately and permanently to Christ-in-Fabian Quick Cash.
    </div>

    <div class="page-footer">${copyLabel} — Page <b>1</b> of <b>2</b></div>
  </div>`;

  // ── PAGE 2 (terms + signatures + official use) ──
  const page2 = `
  <div class="page">
    <div style="font-size:9pt;color:#555;margin-bottom:10px"><b>${copyLabel}</b> &nbsp;·&nbsp; Ref: <b>${tx.ref || ''}</b> &nbsp;·&nbsp; Outright Purchase Receipt (continued)</div>

    <!-- PART D -->
    <div class="section-hdr">PART D — TERMS &nbsp;&nbsp;<span style="font-weight:400;font-size:10pt">(Please read every clause carefully before you sign)</span></div>

    <div class="clause-hdr c2">1. &nbsp;OWNERSHIP TRANSFER</div>
    <div class="clause-body cb2" style="font-size:10pt; padding:6px 12px;">As of the Purchase Date above, full and permanent ownership of the item in Part B passes to Christ-in-Fabian Quick Cash. We may sell, use, or dispose of it as we choose. The seller has no further claim to the item.</div>

    <div class="clause-hdr c3">2. &nbsp;FINAL SALE — NO BUY-BACK OR REFUND</div>
    <div class="clause-body cb3" style="font-size:10pt; padding:6px 12px;">This sale is final and cannot be reversed. Once signed and payment made, no refund will be given and the item cannot be reclaimed under any circumstances.</div>

    <div class="clause-hdr c4">3. &nbsp;CONDITION ACCEPTED AS SEEN</div>
    <div class="clause-body cb4" style="font-size:10pt; padding:6px 12px;">The item has been inspected today and the condition in Part B is agreed by both parties. Christ-in-Fabian Quick Cash is not responsible for hidden faults not visible during today's inspection.</div>

    <div class="clause-hdr c5">4. &nbsp;DECLARATION OF OWNERSHIP</div>
    <div class="clause-body cb5" style="font-size:10pt; padding:6px 12px;">I swear I am the true and legal owner of this item. It is NOT stolen. If any authority claims it is stolen or linked to crime, I take full legal and financial responsibility and will protect Christ-in-Fabian Quick Cash from any resulting arrest, seizure, or liability.</div>

    <div class="clause-hdr c6">5. &nbsp;DATA CONSENT</div>
    <div class="clause-body cb6" style="font-size:10pt; padding:6px 12px;">The seller consents to the collection and storage of personal data (NIN, photographs, contact details) for the purpose of this transaction and regulatory compliance.</div>

    <div class="hr-gold"></div>

    <!-- PART E -->
    <div class="section-hdr">PART E — SIGNATURES &amp; AUTHORIZATION</div>

    <p class="consent" style="margin:8px 0;"><i>I have read and understood all the terms above (or they were read and explained to me). I confirm I am voluntarily selling the item in Part B to Christ-in-Fabian Quick Cash. I have received <b>₦ ${(tx.cashAdvance || 0).toLocaleString()}</b> in cash. This sale is permanent and final.</i></p>

    <table class="sig-tbl">
      <tr>
        <td class="sig-left">
          <div><b>Seller Signature:</b></div>
          <div class="sig-space" style="height:45px;"></div>
          <div class="sig-line"></div>
          <div class="sig-sub"><i>Name &amp; Date</i></div>
        </td>
        <td class="sig-right">
          <div><b>Right Thumbprint — Press firmly:</b></div>
          <div class="thumb-box" style="height:80px;">
            <span class="thumb-text">RIGHT THUMBPRINT</span>
          </div>
        </td>
      </tr>
    </table>

    <table class="field-tbl" style="margin-top:10px">
      <tr>
        <td class="fl" style="width:18%"><b>Shop Rep Name:</b></td>
        <td class="fv" style="width:32%">${tx.completedBy || tx.createdBy || ''}</td>
        <td class="fl" style="width:18%"><b>Shop Rep Signature:</b></td>
        <td class="fv" style="width:32%">${repSigCell}</td>
      </tr>
    </table>

    <div class="photo-note" style="margin-top:10px;">
      <i>Photos of the seller holding the item, seller signing this receipt, ID card if provided, and item front/back have been taken and stored with this transaction record.</i>
    </div>

    ${isBusinessCopy ? `
    <div class="hr-gold"></div>
    <div class="official-hdr">OFFICIAL USE ONLY</div>
    <table class="field-tbl">
      <tr>
        <td class="fl" style="width:22%"><b>Listed for Sale: &nbsp;☐</b></td>
        <td class="fv" style="width:28%"></td>
        <td class="fl" style="width:14%"><b>Date Listed:</b></td>
        <td class="fv" style="width:36%"></td>
      </tr>
      <tr>
        <td class="fl"><b>Listing Price:</b></td>
        <td class="fv">₦</td>
        <td class="fl"><b>Shop Ref:</b></td>
        <td class="fv">${tx.shopId || ''}</td>
      </tr>
      <tr>
        <td class="fl"><b>Item Sold: &nbsp;☐</b></td>
        <td class="fv" colspan="3"><span class="muted-italic">Date: _______________ &nbsp;&nbsp; Sale Amount: ₦ _______________ &nbsp;&nbsp; Profit: ₦ _______________</span></td>
      </tr>
    </table>
    ` : ''}

    <div class="page-footer">${copyLabel} — Page <b>2</b> of <b>2</b></div>
  </div>`;

  return [page1, page2];
};

// ---------------------------------------------------------------------------
// CSS for document rendering
// ---------------------------------------------------------------------------
const getDocumentCSS = (isOutright) => `
/* === RESET === */
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}

body{
  font-family: Calibri, 'Segoe UI', Arial, Helvetica, sans-serif;
  font-size: 10.5pt;
  color: #000;
  background: #fff;
  line-height: 1.35;
}

/* === PAGE (outright portrait — A4 at 96dpi) === */
.page{
  width: 794px;
  min-height: 1123px;
  padding: 0.6in 0.7in 0.55in 0.7in;
  position: relative;
  background: #fff;
}

/* === FOLDED A4 BOOKLET (advance agreement — A4 landscape at 96dpi) === */
.sheet-face{
  display: flex;
  width: 1123px;
  height: 794px;
  margin: 0;
  overflow: hidden;
  background: #fff;
}
.panel{
  width: 50%;
  height: 100%;
  padding: 3mm 4mm 3mm 4mm;
  box-sizing: border-box;
  overflow: hidden;
  position: relative;
}
.panel-left{ border-right: 1px dashed #bbb; }

${!isOutright ? `
/* Advance booklet: very compact sizing for narrow A5 panels */
body{ font-size:7.5pt; line-height:1.2; }
.hdr-tbl{ margin-bottom:3px; }
.hdr-right{ padding:4px 6px; }
.biz-name{ font-size:10.5pt; }
.biz-sub{ font-size:7pt; margin-top:1px; }
.copy-label{ font-size:7.5pt; margin-bottom:3px; }
.ref-line{ font-size:7.5pt; padding-top:3px; margin-top:2px; }
.ref-val{ font-size:8.5pt; min-width:70px; }
.section-hdr{ font-size:7.5pt; padding:2px 6px; margin:4px 0 2px 0; }
.sub-hdr{ font-size:7.5pt; padding:2px 6px; margin:3px 0 2px 0; }
.staff-note{ font-size:7pt; padding:2px 6px; margin-bottom:2px; }
.field-tbl{ margin-bottom:1px; }
.fl{ font-size:7.5pt; padding:1px 3px 1px 0; }
.fv{ font-size:7.5pt; padding:1px 2px; }
.big-val{ font-size:8.5pt; }
.check-row{ font-size:7pt; padding:1px 6px; margin:2px 0; }
.value-row{ font-size:7pt; padding:2px 6px; margin:2px 0; }
.underline-val{ min-width:80px; }
.muted-italic{ font-size:6.5pt; }
.photos-tbl td{ font-size:7pt; padding:2px 5px; }
.hr-gold{ margin:2px 0; border-top-width:2px; }
.fee-box{ font-size:7pt; padding:3px 7px; margin:3px 0; line-height:1.25; }
.daily-fee-row{ font-size:7pt; padding:2px 6px; margin-bottom:4px; }
.clause-hdr{ font-size:7pt; padding:2px 6px; margin:3px 0 0 0; }
.clause-body{ font-size:7pt; padding:2px 6px; margin-bottom:2px; line-height:1.3; }
.consent{ font-size:7pt; margin:2px 0; }
.sig-tbl{ margin-top:3px; }
.sig-space{ height:26px; }
.sig-line{ width:80%; margin-top:2px; }
.sig-sub{ font-size:6.5pt; }
.thumb-box{ height:50px; width:80%; padding:3px; margin-top:2px; }
.thumb-text{ font-size:6pt; }
.photo-note{ font-size:6.5pt; padding:2px 6px; margin-top:3px; }
.official-hdr{ font-size:7.5pt; padding:2px 6px; margin:4px 0 2px 0; }
.sheet-label{ font-size:6.5pt; color:#999; border-bottom:1px solid #eee; padding-bottom:2px; margin-bottom:3px; }
` : ''}

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
  font-size: 10pt; color: #333; text-align: right;
  margin-top: 18px; padding-top: 6px;
  border-top: 1px solid #DDD;
}
`;

// ---------------------------------------------------------------------------
// Render one page's HTML off-screen and capture it as a JPEG data URL.
// No height constraint — content renders at its natural height.
// The caller is responsible for scaling the image to fit the PDF page.
// ---------------------------------------------------------------------------
async function capturePageHTML(contentHTML, css, widthPx) {
  const wrapper = document.createElement('div');
  // position:fixed at a far-left offset keeps it off-screen without clipping
  wrapper.style.cssText = [
    'position:fixed',
    `left:${-(widthPx + 20)}px`,
    'top:0',
    `width:${widthPx}px`,
    'background:#fff',
    // No height / overflow — content can expand to its full natural height
  ].join(';');

  const styleEl = document.createElement('style');
  styleEl.textContent = css;
  wrapper.appendChild(styleEl);

  const contentEl = document.createElement('div');
  contentEl.innerHTML = contentHTML;
  wrapper.appendChild(contentEl);

  document.body.appendChild(wrapper);
  try {
    const canvas = await html2canvas(wrapper, {
      width: widthPx,
      // No height option — html2canvas uses the element's natural scrollHeight
      scale: 2,
      useCORS: true,
      logging: false,
      backgroundColor: '#ffffff',
      windowWidth: widthPx,
      scrollX: 0,
      scrollY: 0,
    });
    return canvas.toDataURL('image/jpeg', 0.93);
  } finally {
    document.body.removeChild(wrapper);
  }
}

// ---------------------------------------------------------------------------
// Add a captured image to the current PDF page, scaled to fill the page
// width. If the content is taller than the page, it scales down to fit the
// page height (keeping the aspect ratio, centred horizontally).
// ---------------------------------------------------------------------------
function addImageToPage(pdf, imgData, pageMmW, pageMmH) {
  const props = pdf.getImageProperties(imgData);
  const naturalMmH = pageMmW * props.height / props.width;
  if (naturalMmH <= pageMmH) {
    // Content fits: fill width, natural height (small gap at bottom is fine)
    pdf.addImage(imgData, 'JPEG', 0, 0, pageMmW, naturalMmH);
  } else {
    // Content overflows: scale down uniformly to fit page height
    const scale = pageMmH / naturalMmH;
    const scaledW = pageMmW * scale;
    pdf.addImage(imgData, 'JPEG', (pageMmW - scaledW) / 2, 0, scaledW, pageMmH);
  }
}

// ---------------------------------------------------------------------------
// Build a jsPDF document for the given transaction
// Returns a jsPDF instance (caller can view or download it)
// ---------------------------------------------------------------------------
export async function generateAgreementPDF(tx, settings = {}) {
  const isOutright = tx.type === 'outright';
  const css = getDocumentCSS(isOutright);

  if (isOutright) {
    // Render at A4 portrait width (794px at 96dpi); height is unconstrained
    const W = 794;
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

    const allPages = [
      ...buildOutrightCopyHTML(tx, settings, 'BUSINESS COPY', true),
      ...buildOutrightCopyHTML(tx, settings, 'SELLER COPY',   false),
    ];

    for (let i = 0; i < allPages.length; i++) {
      if (i > 0) pdf.addPage();
      const imgData = await capturePageHTML(allPages[i], css, W);
      addImageToPage(pdf, imgData, 210, 297);
    }
    return pdf;

  } else {
    // Render at A4 landscape width (1123px at 96dpi); height is unconstrained
    const W = 1123;
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

    const allFaces = [
      ...buildCopyHTML(tx, settings, 'BUSINESS COPY',  true),
      ...buildCopyHTML(tx, settings, 'CUSTOMER COPY',  false),
    ];

    for (let i = 0; i < allFaces.length; i++) {
      if (i > 0) pdf.addPage();
      const imgData = await capturePageHTML(allFaces[i], css, W);
      addImageToPage(pdf, imgData, 297, 210);
    }
    return pdf;
  }
}

// Open the generated PDF in a new browser tab
export async function viewAgreementPDF(tx, settings = {}) {
  const pdf = await generateAgreementPDF(tx, settings);
  const url = pdf.output('bloburl');
  window.open(url, '_blank');
}

// Trigger a file download for the generated PDF
export async function downloadAgreementPDF(tx, settings = {}) {
  const pdf = await generateAgreementPDF(tx, settings);
  const isOutright = tx.type === 'outright';
  pdf.save(`${isOutright ? 'Receipt' : 'Agreement'}_${tx.ref || 'doc'}.pdf`);
}
