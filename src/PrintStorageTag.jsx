// PrintStorageTag.jsx
// Generates a printable A5 storage tag for a completed transaction.
// Called via: printStorageTag(tx, settings)

const fmtMoney = (n) => {
  if (!n && n !== 0) return '₦0';
  return '₦' + Number(n).toLocaleString('en-NG');
};

const fmtDate = (d) => {
  if (!d) return '—';
  return new Date(d + 'T00:00:00').toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
};

const escHtml = (s) =>
  String(s || '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

const statusDisplay = (tx) => {
  if (tx.status === 'closed') return { label: 'CLOSED', color: '#166534', bg: '#dcfce7' };
  if (tx.status === 'sold') return { label: 'SOLD', color: '#166534', bg: '#dcfce7' };
  if (tx.status === 'declined') return { label: 'DECLINED', color: '#991b1b', bg: '#fee2e2' };
  if (tx.status === 'for_sale') return { label: 'LISTED FOR SALE', color: '#92400e', bg: '#fef3c7' };
  if (tx.status === 'ready_to_sell') return { label: 'SURRENDERED', color: '#92400e', bg: '#fef3c7' };
  if (tx.type === 'outright') return { label: 'OUTRIGHT PURCHASE', color: '#1e3a8a', bg: '#dbeafe' };
  return { label: 'ACTIVE LOAN', color: '#1a5f2a', bg: '#e8f5ec' };
};

export const printStorageTag = (tx, settings = {}) => {
  const biz = escHtml(settings.businessName || 'CIF Quick Cash');
  const tagline = escHtml(settings.businessTagline || 'Fast Cash, Fair Deals');
  const location = escHtml(settings.location || '');
  const ref = escHtml(tx.ref || '');
  const customer = escHtml(tx.fullName || '—');
  const item = escHtml([tx.aiItemType, tx.aiBrand, tx.aiModel].filter(Boolean).join(' ') || tx.captureItemType || '—');
  const colour = escHtml(tx.aiColour || '');
  const imeiSerial = [tx.imei && `IMEI: ${escHtml(tx.imei)}`, tx.serialNumber && `S/N: ${escHtml(tx.serialNumber)}`].filter(Boolean).join(' &nbsp;/&nbsp; ');
  const cashGiven = fmtMoney(tx.cashAdvance);
  const dailyFee = tx.type === 'advance' ? fmtMoney(tx.dailyFee ?? Math.floor((tx.cashAdvance || 0) * (Number(settings.interestRate) || 1) / 100)) : '—';
  const dateGiven = fmtDate(tx.dateGiven);
  const deadline = tx.type === 'advance' ? fmtDate(tx.deadlineDate) : '—';
  const { label: statusLabel, color: statusColor, bg: statusBg } = statusDisplay(tx);
  const processedBy = escHtml(tx.completedBy || tx.createdBy || '');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Storage Tag — ${ref}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Segoe UI', Arial, sans-serif;
    background: #f0f0f0;
    display: flex;
    flex-direction: column;
    align-items: center;
    min-height: 100vh;
    padding: 20px;
  }

  /* ── Print controls (screen only) ── */
  .print-controls {
    position: sticky;
    top: 0;
    z-index: 9999;
    background: #f8f9fa;
    border-bottom: 2px solid #ddd;
    padding: 10px 20px;
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
    width: 100%;
    max-width: 600px;
    border-radius: 8px;
    margin-bottom: 16px;
  }
  .print-btn {
    background: #1a5f2a;
    color: #fff;
    border: none;
    padding: 12px 24px;
    font-size: 15px;
    font-weight: 700;
    border-radius: 8px;
    cursor: pointer;
    box-shadow: 0 4px 12px rgba(0,0,0,0.2);
  }
  .close-btn {
    background: #666;
    color: #fff;
    border: none;
    padding: 10px 20px;
    font-size: 13px;
    font-weight: 600;
    border-radius: 8px;
    cursor: pointer;
  }
  .hint { font-size: 12px; color: #666; }

  /* ── Storage Tag Card (A5: 148mm × 210mm) ── */
  .tag {
    width: 148mm;
    min-height: 210mm;
    background: #ffffff;
    border: 2px solid #1a5f2a;
    border-radius: 10px;
    overflow: hidden;
    box-shadow: 0 4px 20px rgba(0,0,0,0.15);
    page-break-inside: avoid;
  }

  /* Header band */
  .tag-header {
    background: #1a5f2a;
    color: #ffffff;
    padding: 14px 16px 10px;
    text-align: center;
  }
  .biz-name {
    font-size: 16px;
    font-weight: 800;
    letter-spacing: 0.5px;
    text-transform: uppercase;
  }
  .biz-tagline {
    font-size: 10px;
    opacity: 0.85;
    margin-top: 2px;
    font-style: italic;
  }
  .biz-location {
    font-size: 9px;
    opacity: 0.75;
    margin-top: 2px;
  }

  /* Storage tag label band */
  .tag-label-band {
    background: #c8a84e;
    color: #1a1a1a;
    text-align: center;
    padding: 6px;
    font-size: 13px;
    font-weight: 800;
    letter-spacing: 3px;
    text-transform: uppercase;
  }

  /* Ref block */
  .ref-block {
    background: #f8f6f1;
    border-bottom: 1px solid #e5e1d8;
    padding: 12px 16px;
    text-align: center;
  }
  .ref-label {
    font-size: 9.5px;
    font-weight: 700;
    color: #6b7280;
    text-transform: uppercase;
    letter-spacing: 1px;
    margin-bottom: 4px;
  }
  .ref-value {
    font-size: 22px;
    font-weight: 900;
    color: #1a5f2a;
    letter-spacing: 2px;
    font-family: 'Courier New', monospace;
  }
  /* Barcode-style decoration */
  .barcode {
    display: flex;
    justify-content: center;
    gap: 2px;
    margin-top: 6px;
    height: 22px;
    align-items: flex-end;
  }
  .bar { background: #1a1a1a; border-radius: 1px; }

  /* Body rows */
  .tag-body { padding: 12px 16px; }

  .section-title {
    font-size: 9px;
    font-weight: 700;
    color: #6b7280;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    padding: 8px 0 4px;
    border-bottom: 1px solid #e5e1d8;
    margin-bottom: 6px;
  }
  .section-title:not(:first-child) { margin-top: 10px; }

  .field-row {
    display: grid;
    grid-template-columns: 90px 1fr;
    gap: 4px 8px;
    padding: 4px 0;
    font-size: 12px;
    border-bottom: 1px dashed #f0ece6;
    align-items: baseline;
  }
  .field-row:last-child { border-bottom: none; }
  .fl { color: #6b7280; font-weight: 600; font-size: 10.5px; }
  .fv { color: #1a1a1a; font-weight: 700; word-break: break-word; }
  .fv-large { font-size: 15px; color: #1a5f2a; }

  /* Status badge */
  .status-band {
    margin: 10px 16px 4px;
    padding: 8px 12px;
    border-radius: 8px;
    text-align: center;
  }
  .status-label-text {
    font-size: 13px;
    font-weight: 800;
    letter-spacing: 1px;
    text-transform: uppercase;
  }

  /* Footer */
  .tag-footer {
    background: #f8f6f1;
    border-top: 1px solid #e5e1d8;
    padding: 8px 16px;
    font-size: 9.5px;
    color: #6b7280;
    text-align: center;
    margin-top: 8px;
  }

  /* ── Print styles ── */
  @media print {
    body { background: #fff; padding: 0; }
    .print-controls { display: none; }
    .tag {
      box-shadow: none;
      border-radius: 0;
      width: 148mm;
      min-height: 210mm;
    }
  }
  @page { size: A5 portrait; margin: 0; }
</style>
</head>
<body>

<div class="print-controls">
  <button class="print-btn" onclick="window.print()">🖨 Print Storage Tag</button>
  <button class="close-btn" onclick="window.close()">✕ Close</button>
  <span class="hint">Prints on A5 paper (or fold A4 in half)</span>
</div>

<div class="tag">

  <!-- Header -->
  <div class="tag-header">
    <div class="biz-name">${biz}</div>
    ${tagline ? `<div class="biz-tagline">${tagline}</div>` : ''}
    ${location ? `<div class="biz-location">📍 ${location}</div>` : ''}
  </div>

  <!-- "STORAGE TAG" band -->
  <div class="tag-label-band">📦 &nbsp; S T O R A G E &nbsp; T A G &nbsp; 📦</div>

  <!-- Reference number -->
  <div class="ref-block">
    <div class="ref-label">Transaction Reference</div>
    <div class="ref-value">${ref}</div>
    <!-- Barcode-style bars generated from ref string -->
    <div class="barcode" id="barcodeEl"></div>
  </div>

  <div class="tag-body">

    <!-- Status -->
    <div class="status-band" style="background:${statusBg}; border: 1px solid ${statusColor}30;">
      <div class="status-label-text" style="color:${statusColor};">${statusLabel}</div>
    </div>

    <!-- Customer & Item -->
    <div class="section-title">Customer &amp; Item</div>
    <div class="field-row"><div class="fl">Customer</div><div class="fv">${customer}</div></div>
    <div class="field-row"><div class="fl">Item</div><div class="fv">${item}</div></div>
    ${colour ? `<div class="field-row"><div class="fl">Colour</div><div class="fv">${colour}</div></div>` : ''}
    ${imeiSerial ? `<div class="field-row"><div class="fl">IMEI / S/N</div><div class="fv" style="font-size:10.5px;">${imeiSerial}</div></div>` : ''}

    <!-- Financial -->
    <div class="section-title">Financial</div>
    <div class="field-row"><div class="fl">Cash Given</div><div class="fv fv-large">${cashGiven}</div></div>
    <div class="field-row"><div class="fl">Daily Fee</div><div class="fv">${dailyFee}</div></div>

    <!-- Dates -->
    <div class="section-title">Dates</div>
    <div class="field-row"><div class="fl">Date Given</div><div class="fv">${dateGiven}</div></div>
    <div class="field-row"><div class="fl">Deadline</div><div class="fv">${deadline}</div></div>

  </div>

  <!-- Footer -->
  <div class="tag-footer">
    ${processedBy ? `Processed by: <strong>${processedBy}</strong> &nbsp;·&nbsp; ` : ''}Printed: <span id="printDate"></span>
  </div>

</div>

<script>
  // Inject current date
  document.getElementById('printDate').textContent = new Date().toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric'
  });

  // Generate simple barcode-like stripes from the ref string
  (function() {
    var el = document.getElementById('barcodeEl');
    if (!el) return;
    var ref = ${JSON.stringify(tx.ref || '')};
    var widths = [2,3,2,4,2,3,2,2,3,4,2,3,2,3,4,2,3,2,4,2,3,2,3,2,4,2,3,2];
    var seed = 0;
    for (var i = 0; i < ref.length; i++) seed = (seed * 31 + ref.charCodeAt(i)) & 0xffff;
    var bars = [];
    for (var j = 0; j < 28; j++) {
      var h = 12 + ((seed >> (j % 16)) & 7) * 1.5;
      var w = widths[j] || 2;
      bars.push('<div class="bar" style="width:' + w + 'px;height:' + h + 'px;"></div>');
      // LCG: multiplier 1103515245 and increment 12345 are standard Park-Miller constants
      seed = (seed * 1103515245 + 12345) & 0xffff;
    }
    el.innerHTML = bars.join('');
  })();
</script>
</body>
</html>`;

  const win = window.open('', '_blank', 'width=700,height=900');
  if (!win) {
    alert('Please allow pop-ups for this site to print the storage tag.');
    return;
  }
  win.document.write(html);
  win.document.close();
  setTimeout(() => win.focus(), 300);
};
