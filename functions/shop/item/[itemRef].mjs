const htmlEscape = (value = '') => String(value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/\"/g, '&quot;')
  .replace(/'/g, '&#39;');

const extractVisiblePhotos = (d = {}) => {
  const raw = Array.isArray(d.itemPhotos)
    ? d.itemPhotos
    : (d.itemPhotos && typeof d.itemPhotos === 'object'
        ? [d.itemPhotos.front, d.itemPhotos.back, d.itemPhotos.left, d.itemPhotos.right, d.itemPhotos.powerOn, d.itemPhotos.aboutPage, ...(d.itemPhotos.corners || [])]
        : []);
  const hidden = Array.isArray(d.hiddenPhotoIndexes) ? d.hiddenPhotoIndexes : [];
  return raw.filter((p, i) => p && !hidden.includes(i));
};

const fmtMoney = (n) => {
  const amount = Number(n) || 0;
  return `₦${amount.toLocaleString('en-NG')}`;
};

export async function onRequest(context) {
  const { env, params, request } = context;
  const itemRef = decodeURIComponent(params.itemRef || '').trim();
  const requestUrl = new URL(request.url);
  const appUrl = `${requestUrl.origin}/shop?item=${encodeURIComponent(itemRef)}`;

  let title = 'Item for Sale — Christ-in-Fabian Quick Cash';
  let description = 'See item details, condition, and price from Christ-in-Fabian Quick Cash.';
  let image = `${requestUrl.origin}/og-image.png`;

  if (itemRef && env.DB) {
    const row = await env.DB
      .prepare("SELECT data FROM transactions WHERE ref = ? AND status = 'for_sale' LIMIT 1")
      .bind(itemRef)
      .first()
      .catch(() => null);

    if (row?.data) {
      const data = JSON.parse(row.data);
      const itemType = data.aiItemType || data.captureItemType || 'Item';
      const brand = data.aiBrand || '';
      const model = data.aiModel || '';
      const condition = data.shopCondition || data.aiCondition || data.conditionDescription || '';
      const price = data.salePrice ? fmtMoney(data.salePrice) : 'Contact for price';
      const name = `${brand} ${model}`.trim() || itemType;
      const notes = (data.shopListingNote || data.inspectionNotes || '').trim().slice(0, 180);
      title = `${name} — ${price}`;
      description = `${itemType}${condition ? ` • ${condition}` : ''}${notes ? ` • ${notes}` : ''}`;
      image = extractVisiblePhotos(data)[0] || image;
    }
  }

  const body = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${htmlEscape(title)}</title>
    <meta name="description" content="${htmlEscape(description)}" />
    <link rel="canonical" href="${htmlEscape(requestUrl.href)}" />

    <meta property="og:type" content="product" />
    <meta property="og:title" content="${htmlEscape(title)}" />
    <meta property="og:description" content="${htmlEscape(description)}" />
    <meta property="og:image" content="${htmlEscape(image)}" />
    <meta property="og:url" content="${htmlEscape(requestUrl.href)}" />

    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${htmlEscape(title)}" />
    <meta name="twitter:description" content="${htmlEscape(description)}" />
    <meta name="twitter:image" content="${htmlEscape(image)}" />

    <meta http-equiv="refresh" content="0;url=${htmlEscape(appUrl)}" />
    <script>window.location.replace(${JSON.stringify(appUrl)});</script>
  </head>
  <body>
    <p>Opening item details… <a href="${htmlEscape(appUrl)}">Continue</a></p>
  </body>
</html>`;

  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=120',
    },
  });
}
