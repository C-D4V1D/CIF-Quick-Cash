// Cloudflare Pages Function: /shop/:id
// Serves the SPA index.html with item-specific Open Graph meta tags injected
// so that link previews on WhatsApp, Facebook, Twitter etc. show the item image,
// title, price and description instead of the generic site defaults.

const MAX_DESC_LENGTH = 200;

const escHtml = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const fmtPrice = (n) =>
  n > 0 ? '\u20a6' + Number(n).toLocaleString('en-NG') : '';

export async function onRequestGet({ params, env, request }) {
  const id = decodeURIComponent(params.id || '');

  // --- Fetch index.html from Cloudflare Pages static assets ---
  const origin = new URL(request.url).origin;
  const assetResp = await env.ASSETS.fetch(new Request(`${origin}/index.html`));
  let html = await assetResp.text();

  // --- Query D1 for the item ---
  let item = null;
  try {
    const db = env.DB;
    const row = await db
      .prepare(
        "SELECT data FROM transactions WHERE (json_extract(data, '$.shopId') = ? OR ref = ?) AND status = 'for_sale' LIMIT 1"
      )
      .bind(id, id)
      .first();

    if (row) {
      const d = JSON.parse(row.data);
      const raw = Array.isArray(d.itemPhotos) ? d.itemPhotos : [];
      const hidden = Array.isArray(d.hiddenPhotoIndexes) ? d.hiddenPhotoIndexes : [];
      const photos = raw.filter((p, i) => p && !hidden.includes(i));
      item = {
        brand: d.aiBrand || '',
        model: d.aiModel || '',
        itemType: d.aiItemType || d.captureItemType || 'Item',
        salePrice: d.salePrice || 0,
        condition: d.shopCondition || d.aiCondition || '',
        shopNote: d.shopListingNote || '',
        photoFront: photos[0] || null,
      };
    }
  } catch (err) {
    // Non-fatal — fall through and serve generic index.html
    console.error('OG fetch error:', err);
  }

  if (item) {
    const pageUrl = `${origin}/shop/${encodeURIComponent(id)}`;
    const priceStr = fmtPrice(item.salePrice);
    const nameParts = [item.brand, item.model].filter(Boolean).join(' ') || item.itemType;
    const title = [nameParts, priceStr ? `\u2014 ${priceStr}` : '', '| CIF Quick Cash'].filter(Boolean).join(' ');

    let desc = '';
    if (item.shopNote) {
      desc = item.shopNote.slice(0, MAX_DESC_LENGTH) + (item.shopNote.length > MAX_DESC_LENGTH ? '\u2026' : '');
    } else {
      const parts = [];
      if (item.condition) parts.push(item.condition);
      parts.push(item.itemType);
      if (item.brand) parts.push(`by ${item.brand}`);
      if (priceStr) parts.push(`for ${priceStr}`);
      parts.push('\u2014 CIF Quick Cash, Enugwu-Aguleri, Anambra.');
      desc = parts.join(' ');
    }

    const imageUrl = item.photoFront
      // Photos are stored as relative paths (/api/photos/KEY); make absolute for OG tags
      ? (item.photoFront.startsWith('http') ? item.photoFront : `${origin}${item.photoFront.startsWith('/') ? '' : '/'}${item.photoFront}`)
      : `${origin}/og-image.png`;

    // Whether the image is an item photo (unknown dimensions) or the generic site image
    const isItemPhoto = !!item.photoFront;

    // Replace meta tags with item-specific values.
    // Patterns match the known structure of index.html; content is always double-quoted
    // and never contains unescaped double quotes or angle brackets.
    html = html
      .replace(/<title>[^<]*<\/title>/, `<title>${escHtml(title)}</title>`)
      .replace(
        /<link rel="canonical" href="[^"]*" \/>/,
        `<link rel="canonical" href="${escHtml(pageUrl)}" />`
      )
      .replace(
        /<meta property="og:type" content="[^"]*" \/>/,
        '<meta property="og:type" content="product" />'
      )
      .replace(
        /<meta property="og:url" content="[^"]*" \/>/,
        `<meta property="og:url" content="${escHtml(pageUrl)}" />`
      )
      .replace(
        /<meta property="og:title" content="[^"]*" \/>/,
        `<meta property="og:title" content="${escHtml(title)}" />`
      )
      .replace(
        /<meta property="og:description" content="[^"]*" \/>/,
        `<meta property="og:description" content="${escHtml(desc)}" />`
      )
      .replace(
        /<meta property="og:image" content="[^"]*" \/>/,
        `<meta property="og:image" content="${escHtml(imageUrl)}" />`
      )
      // When serving an item photo the dimensions are unknown — remove fixed width/height/type
      // so crawlers don't reject the image for dimension mismatch. Keep them for the fallback.
      .replace(
        /<meta property="og:image:type" content="[^"]*" \/>/,
        isItemPhoto ? '' : '<meta property="og:image:type" content="image/png" />'
      )
      .replace(
        /<meta property="og:image:width" content="[^"]*" \/>/,
        isItemPhoto ? '' : '<meta property="og:image:width" content="1200" />'
      )
      .replace(
        /<meta property="og:image:height" content="[^"]*" \/>/,
        isItemPhoto ? '' : '<meta property="og:image:height" content="630" />'
      )
      .replace(
        /<meta property="og:image:alt" content="[^"]*" \/>/,
        `<meta property="og:image:alt" content="${escHtml(nameParts + ' \u2014 CIF Quick Cash')}" />`
      )
      .replace(
        /<meta name="description" content="[^"]*" \/>/,
        `<meta name="description" content="${escHtml(desc)}" />`
      )
      .replace(
        /<meta name="twitter:title" content="[^"]*" \/>/,
        `<meta name="twitter:title" content="${escHtml(title)}" />`
      )
      .replace(
        /<meta name="twitter:description" content="[^"]*" \/>/,
        `<meta name="twitter:description" content="${escHtml(desc)}" />`
      )
      .replace(
        /<meta name="twitter:image" content="[^"]*" \/>/,
        `<meta name="twitter:image" content="${escHtml(imageUrl)}" />`
      )
      .replace(
        /<meta name="twitter:image:alt" content="[^"]*" \/>/,
        `<meta name="twitter:image:alt" content="${escHtml(nameParts + ' \u2014 CIF Quick Cash')}" />`
      );
  }

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html;charset=UTF-8',
      'Cache-Control': 'public, max-age=60, stale-while-revalidate=300',
    },
  });
}

