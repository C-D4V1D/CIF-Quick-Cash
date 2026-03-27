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
// Build HTML for one copy (Business or Customer) — folded A4 booklet layout
// Each copy = 2 sheet-face divs (landscape A4), printed front and back, folded in half.
//   face1: left panel = back cover | right panel = page 1 (Parts A + B)
//   face2: left panel = page 2 (Parts C + D) | right panel = page 3 (clauses + signatures)
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
  const dailyFee = tx.dailyFee ?? Math.floor((tx.cashAdvance || 0) * Number(interestRate) / 100);
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
    </table>`;

  // ── BACK COVER (left panel of face 1) ──
  const backCoverHTML = isBusinessCopy ? `
    <div>
      <div class="biz-name" style="font-size:11pt">CHRIST-IN-FABIAN QUICK CASH</div>
      <div class="biz-sub">Cash Advance &amp; Buy-Back Agreement</div>
      <div style="margin-top:3mm;font-size:7.5pt"><b>${copyLabel}</b> &nbsp;·&nbsp; Ref: <b>${tx.ref || ''}</b></div>
    </div>
    ${officialUseHTML}
  ` : `
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;text-align:center;">
      <div class="biz-name" style="font-size:14pt;line-height:1.2">CHRIST-IN-FABIAN<br/>QUICK CASH</div>
      <div class="biz-sub" style="margin-top:3mm">Cash Advance &amp; Buy-Back Agreement</div>
      <div style="margin-top:8mm;font-size:7.5pt;color:#555;font-style:italic;line-height:1.7">
        Keep this agreement safely.<br/>It is proof of your transaction<br/>and protects your rights.
      </div>
      <div style="margin-top:6mm;font-size:7.5pt;color:#888">Ref: <b>${tx.ref || ''}</b></div>
    </div>
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
        </td>
      </tr>
    </table>

    <div class="section-hdr">PART A — CUSTOMER DETAILS</div>
    <div class="staff-note"><i>STAFF: Fill name, address, ID type and ID number from the customer's ID photo.</i></div>
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
    <div class="staff-note"><i>STAFF: Ask customer to say their numbers. Call at least one immediately to confirm it is real.</i></div>
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
    <div class="staff-note green-note"><i>STAFF: Inspect, test, and photograph the item. Note every scratch or fault honestly.</i></div>
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

    <table class="photos-tbl">
      <tr><td class="photos-hdr" colspan="3">Photos Taken — tick each when done:</td></tr>
      <tr>
        <td>${chk(!!tx.photoCustomerHolding)} &nbsp;<b>Customer holding Item</b></td>
        <td colspan="2">${chk(!!tx.photoSigning)} &nbsp;<b>Customer signing agreement</b></td>
      </tr>
      <tr>
        <td>${chk(!!tx.photoCustomerID)} &nbsp;<b>ID Card</b></td>
        <td>${chk(!!(tx.itemPhotos && tx.itemPhotos.front))} &nbsp;<b>Item — Front</b></td>
        <td>${chk(!!(tx.itemPhotos && (tx.itemPhotos.back || tx.itemPhotos.left || tx.itemPhotos.right)))} &nbsp;<b>Item — Back/Sides</b></td>
      </tr>
    </table>

    ${isBusinessCopy ? `
    <div class="value-row">
      <b>Estimated Market Value (resale):</b>&nbsp;&nbsp;
      <span class="underline-val">₦ ${(tx.estimatedValue || 0).toLocaleString()}</span>
      &nbsp;<span class="muted-italic">(internal — not on customer copy)</span>
    </div>
    ` : ''}
  `;

  // ── FACE 2 LEFT PANEL — PAGE 2 content (PART C + PART D terms) ──
  const page2Content = `
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
      <div class="muted-italic">Example: Advance of ₦10,000 = ₦${Math.floor(10000 * interestRate / 100).toLocaleString()} fee per day.</div>
      <div class="muted-italic">Your exact total will be calculated on the day you come to collect.</div>
    </div>

    <div class="daily-fee-row">
      <b>Your Daily Fee Amount: &nbsp;₦</b>&nbsp;
      <span class="underline-val"><b>${dailyFee.toLocaleString()}</b></span>
      &nbsp;&nbsp;
      <span class="muted-italic">(${interestRate}% of ₦${(tx.cashAdvance || 0).toLocaleString()} = ₦${dailyFee.toLocaleString()} per day)</span>
    </div>

    <div class="hr-gold"></div>

    <div class="section-hdr">PART D — TERMS &nbsp;<span style="font-weight:400">(Read every clause aloud to the customer before signing)</span></div>

    <div class="clause-hdr c1">1. &nbsp;YOUR ITEM IS SAFE WITH US</div>
    <div class="clause-body cb1">Your item stays in our shop and remains your property while this agreement is active. We will keep it safely. We are not responsible for any pre-existing hidden faults or internal damage not visible during testing today. We are also not responsible for loss of data on any phone or laptop. When you come to collect, you can only raise a complaint about a specific feature or function if you clearly demonstrated it was working at the time you brought the item — we are not responsible for anything you did not show us.</div>

    <div class="clause-hdr c2">2. &nbsp;HOW TO COLLECT YOUR ITEM</div>
    <div class="clause-body cb2">Pay back the advance amount plus the Daily Holding &amp; Service Fee for each day the advance has been running. Every new day that begins counts as a full day's fee. We will calculate your exact total on the day you arrive. Pay in full and your item will be returned to you immediately.</div>

    <div class="clause-hdr c3">3. &nbsp;THE ${maxLoanDays}-DAY PURCHASE RULE — READ CAREFULLY</div>
    <div class="clause-body cb3">
      You have <b>${loanDays} days</b> from the Date Given above to pay back in full and collect your item. Your agreed return date is <b>${fmtDateLong(tx.deadlineDate)}</b>. If you have not paid by then, your account will be marked overdue.<br/><br/>
      <b>If the ${maxLoanDays}th day (${fmtDateLong(internalDeadlineDate)}) arrives and you have not paid in full, your item is considered SOLD BY YOU and PURCHASED BY US</b> at the advance amount of <b>₦${(tx.cashAdvance || 0).toLocaleString()}</b> given to you — we may sell it, keep it, or use it as we choose. From that point, this is final and permanent — you cannot claim the item back and no refund will be given.
    </div>

    <div class="clause-hdr c4">4. &nbsp;YOUR RESPONSIBILITY TO REMEMBER</div>
  `;

  // ── FACE 2 RIGHT PANEL — PAGE 3 content (Clause 4 body + Clauses 5–6 + PART E) ──
  const page3Content = `
    <div class="clause-body cb4">
      <b>It is strictly YOUR responsibility to remember your return date (${fmtDateLong(tx.deadlineDate)}) and come back on time.</b><br/><br/>
      As a courtesy, we may try to send an SMS or call your phone numbers before Day ${maxLoanDays}. However, whether we reach you or not, the ${maxLoanDays}-Day Purchase Rule will apply automatically on <b>${fmtDateLong(internalDeadlineDate)}</b>. Failure to receive a reminder call is not a reason to dispute the purchase.
    </div>

    <div class="clause-hdr c5">5. &nbsp;DECLARATION OF OWNERSHIP</div>
    <div class="clause-body cb5">I swear that I am the true and legal owner of this item. It is NOT stolen property. If the Nigerian Police or any authority claims this item is stolen or linked to any crime, I take full legal and financial responsibility. I will protect Christ-in-Fabian Quick Cash from any arrest, seizure, or liability that arises from my false claim of ownership.</div>

    <div class="clause-hdr c6">6. &nbsp;DATA CONSENT</div>
    <div class="clause-body cb6">The customer consents to the collection and storage of personal data (NIN, photographs, contact details) for the purpose of this transaction.</div>

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

    <table class="field-tbl" style="margin-top:8px">
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

  return face1 + face2;
};

// ---------------------------------------------------------------------------
// Build HTML for one outright purchase receipt copy (Business or Customer)
// 2 pages per copy (4 total): page 1 = seller + item, page 2 = purchase + terms + signatures
// ---------------------------------------------------------------------------
const buildOutrightCopyHTML = (tx, settings, copyLabel, isBusinessCopy, pageOffset) => {
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

    <div class="page-footer">Page <b>${pageOffset}</b> of <b>4</b></div>
  </div>`;

  // ── PAGE 2 (purchase details + terms + signatures + official use) ──
  const page2 = `
  <div class="page">
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

    <div class="hr-gold"></div>

    <!-- PART D -->
    <div class="section-hdr">PART D — TERMS &nbsp;&nbsp;<span style="font-weight:400;font-size:10pt">(Read every clause aloud to the seller before signing)</span></div>

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
        <td class="fv" style="width:32%"></td>
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

    <div class="page-footer">Page <b>${pageOffset + 1}</b> of <b>4</b></div>
  </div>`;

  return page1 + page2;
};

// ---------------------------------------------------------------------------
// Main export: open print window with the complete filled-in agreement
// ---------------------------------------------------------------------------
export const printAgreement = (tx, settings = {}) => {
  const isOutright = tx.type === 'outright';
  const buildFn = isOutright ? buildOutrightCopyHTML : buildCopyHTML;
  // Outright: 2 pages/copy → customer copy starts at page 3 (pageOffset used by outright only)
  const customerPageOffset = isOutright ? 3 : 4;
  const businessHTML = buildFn(tx, settings, 'BUSINESS COPY', true, 1);
  const customerHTML = buildFn(tx, settings, isOutright ? 'SELLER COPY' : 'CUSTOMER COPY', false, customerPageOffset);

  const fullHTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<title>${isOutright ? 'Purchase Receipt' : 'Agreement'} — ${tx.ref || ''}</title>
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

/* === PAGE (outright portrait layout) === */
.page{
  width: 8.5in;
  min-height: 11in;
  padding: 0.6in 0.7in 0.55in 0.7in;
  page-break-after: always;
  position: relative;
  background: #fff;
}
.page:last-child{ page-break-after: auto; }

/* === FOLDED A4 BOOKLET (advance agreement) === */
.sheet-face{
  display: flex;
  width: 297mm;
  height: 210mm;
  margin: 0 auto 24px auto;
  page-break-after: always;
  overflow: hidden;
  background: #fff;
  box-shadow: 0 2px 10px rgba(0,0,0,0.15);
}
.sheet-face:last-child{ page-break-after: auto; }
.panel{
  width: 50%;
  height: 100%;
  padding: 6mm 7mm 5mm 7mm;
  box-sizing: border-box;
  overflow: hidden;
  position: relative;
}
.panel-left{ border-right: 1px dashed #bbb; }

${!isOutright ? `
/* Advance booklet: compact sizing for A5 panels */
body{ font-size:8pt; line-height:1.25; }
.hdr-tbl{ margin-bottom:8px; }
.hdr-right{ padding:6px 9px; }
.biz-name{ font-size:13pt; }
.biz-sub{ font-size:8pt; margin-top:2px; }
.copy-label{ font-size:8pt; margin-bottom:5px; }
.ref-line{ font-size:8pt; padding-top:5px; margin-top:3px; }
.ref-val{ font-size:9pt; min-width:80px; }
.section-hdr{ font-size:8pt; padding:3px 8px; margin:7px 0 4px 0; }
.sub-hdr{ font-size:8pt; padding:3px 8px; margin:5px 0 3px 0; }
.staff-note{ font-size:7.5pt; padding:3px 7px; margin-bottom:4px; }
.field-tbl{ margin-bottom:2px; }
.fl{ font-size:8pt; padding:2px 4px 2px 0; }
.fv{ font-size:8pt; padding:2px 3px; }
.big-val{ font-size:9pt; }
.check-row{ font-size:7.5pt; padding:2px 7px; margin:4px 0; }
.value-row{ font-size:7.5pt; padding:3px 7px; margin:4px 0; }
.underline-val{ min-width:90px; }
.muted-italic{ font-size:7pt; }
.photos-tbl td{ font-size:7.5pt; padding:2px 6px; }
.hr-gold{ margin:6px 0; border-top-width:2px; }
.fee-box{ font-size:7.5pt; padding:5px 9px; margin:5px 0; line-height:1.3; }
.daily-fee-row{ font-size:7.5pt; padding:3px 7px; margin-bottom:6px; }
.clause-hdr{ font-size:7.5pt; padding:3px 7px; margin:5px 0 0 0; }
.clause-body{ font-size:7.5pt; padding:4px 7px; margin-bottom:3px; line-height:1.35; }
.consent{ font-size:7.5pt; margin:6px 0; }
.sig-tbl{ margin-top:5px; }
.sig-space{ height:28px; }
.sig-line{ width:80%; margin-top:3px; }
.sig-sub{ font-size:7pt; }
.thumb-box{ height:52px; width:80%; padding:3px; margin-top:3px; }
.thumb-text{ font-size:6.5pt; }
.photo-note{ font-size:7pt; padding:3px 7px; margin-top:6px; }
.official-hdr{ font-size:8pt; padding:3px 8px; margin:7px 0 4px 0; }
` : ''}

@media print{
  ${isOutright ? `@page{ size: letter; margin: 0; }` : `@page{ size: A4 landscape; margin: 0; }`}
  .no-print{ display:none!important; }
  ${isOutright
    ? `.page{ width:100%; min-height:100vh; padding: 0.6in 0.7in 0.55in 0.7in; }`
    : `.sheet-face{ width:100%; height:100vh; margin:0; box-shadow:none; }`
  }
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
  <button class="print-btn" onclick="window.print()">🖨 Print ${isOutright ? 'Receipt' : 'Agreement'}</button>
  ${!isOutright ? `
  <div style="background:#fff;border:1px solid #ccc;border-radius:6px;padding:10px 14px;font-size:11px;color:#444;max-width:220px;line-height:1.6">
    <b>How to print &amp; fold:</b><br/>
    1. Click Print → set <b>Landscape</b><br/>
    2. Enable <b>two-sided / duplex</b> printing — <i>flip on short edge</i><br/>
    &nbsp;&nbsp;&nbsp;<i>Or: print page 1, re-insert paper, print page 2</i><br/>
    3. <b>Fold each sheet</b> in half (right over left)<br/>
    4. Two booklets print: <b>Business Copy</b> + <b>Customer Copy</b>
  </div>` : ''}
  <button class="close-btn" onclick="window.close()">✕ Close</button>
</div>

<!-- BUSINESS COPY (pages 1–3) -->
${businessHTML}

<div class="form-divider no-print">✂ — — — BUSINESS COPY booklet above / ${isOutright ? 'SELLER' : 'CUSTOMER'} COPY booklet below — — — ✂</div>

<!-- CUSTOMER COPY -->
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
