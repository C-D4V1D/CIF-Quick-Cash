// Shared signature helpers used by both the profile SignatureSection
// and the transaction wizard's customer-signature capture.

// Compress & read an uploaded file to a base64 data URL, max 1200px.
export const compressToDataUrl = (file, maxDim = 1200, quality = 0.9) =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        if (width > height) { height = Math.round((height * maxDim) / width); width = maxDim; }
        else { width = Math.round((width * maxDim) / height); height = maxDim; }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', quality));
      URL.revokeObjectURL(img.src);
    };
    img.onerror = () => reject(new Error('Could not read this image.'));
    img.src = URL.createObjectURL(file);
  });

// Client-side signature refinement:
//   1. Grayscale + adaptive threshold (keeps dark ink, drops paper)
//   2. Recolor ink pixels to a deep ballpoint blue
//   3. Crop to the bounding box of ink pixels
//   4. Return a transparent-background PNG data URL
export const refineSignatureImage = (dataUrl) =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const { data } = imgData;

        // Compute mean luminance for adaptive threshold
        let sum = 0;
        for (let i = 0; i < data.length; i += 4) {
          sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        }
        const mean = sum / (data.length / 4);
        // Pixels darker than (mean * 0.75) are treated as ink.
        const threshold = mean * 0.75;

        // Blue-pen target color (deep ballpoint blue)
        const INK_R = 18;
        const INK_G = 42;
        const INK_B = 138;

        let minX = canvas.width, minY = canvas.height, maxX = 0, maxY = 0;
        let inkCount = 0;
        for (let y = 0; y < canvas.height; y++) {
          for (let x = 0; x < canvas.width; x++) {
            const i = (y * canvas.width + x) * 4;
            const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
            if (lum < threshold) {
              // Ink pixel → recolor to blue pen. Darker source pixels become more opaque
              // (so pen strokes stay crisp while faint smudges soften).
              const strength = 1 - lum / threshold; // 0..1
              const alpha = Math.min(255, Math.round(180 + strength * 75));
              data[i]     = INK_R;
              data[i + 1] = INK_G;
              data[i + 2] = INK_B;
              data[i + 3] = alpha;
              if (x < minX) minX = x;
              if (y < minY) minY = y;
              if (x > maxX) maxX = x;
              if (y > maxY) maxY = y;
              inkCount++;
            } else {
              // Paper → transparent
              data[i + 3] = 0;
            }
          }
        }

        if (inkCount === 0) {
          reject(new Error('No visible ink detected. Try a clearer photo on white paper.'));
          return;
        }

        ctx.putImageData(imgData, 0, 0);

        // Crop to bounding box with a small padding
        const pad = Math.round(Math.max(canvas.width, canvas.height) * 0.02);
        const sx = Math.max(0, minX - pad);
        const sy = Math.max(0, minY - pad);
        const sw = Math.min(canvas.width - sx, maxX - minX + pad * 2);
        const sh = Math.min(canvas.height - sy, maxY - minY + pad * 2);

        const out = document.createElement('canvas');
        out.width = sw;
        out.height = sh;
        out.getContext('2d').drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
        resolve(out.toDataURL('image/png'));
      } catch (e) {
        reject(e);
      }
    };
    img.onerror = () => reject(new Error('Failed to load image for refinement.'));
    img.src = dataUrl;
  });

export const SIGNATURE_AI_PROMPT = `You are reviewing a photo uploaded as a user's handwritten signature on paper.
The photo may contain distracting elements: printed agreement text, ruling lines, the signature line label, hands, or paper edges.

Your job is to locate the handwritten signature ink and return its bounding box, ignoring all printed text and other distractions.

Respond with EXACTLY this JSON object on a single line and nothing else (no markdown fences, no commentary):
{"is_signature": true|false, "box_2d": [ymin, xmin, ymax, xmax], "note": "<one short sentence>"}

- box_2d must be in Gemini's standard normalized integer coordinates from 0 to 1000 (top-left origin, order is ymin, xmin, ymax, xmax).
- The box must tightly enclose ONLY the handwritten signature strokes. Exclude any printed text, the printed signature line, hands, fingers, and paper edges.
- If you cannot find a clear handwritten signature, set is_signature to false and box_2d to [0,0,1000,1000].`;

// Crop a data URL image to a Gemini-style normalized 0–1000 bbox (ymin,xmin,ymax,xmax).
// Adds a small padding so strokes near the edge aren't clipped.
// Returns a JPEG data URL. Falls back to the original on any failure.
export const cropImageToBbox = (dataUrl, bbox, paddingPct = 4) => new Promise((resolve) => {
  try {
    let [ymin, xmin, ymax, xmax] = bbox;
    // Normalize ordering in case the model returned them swapped
    if (ymax < ymin) [ymin, ymax] = [ymax, ymin];
    if (xmax < xmin) [xmin, xmax] = [xmax, xmin];
    if (!(ymax > ymin && xmax > xmin)) return resolve(dataUrl);
    const img = new Image();
    img.onload = () => {
      try {
        const W = img.width, H = img.height;
        // Add padding (% of bbox dimensions) so strokes aren't clipped
        const padX = ((xmax - xmin) * paddingPct) / 100;
        const padY = ((ymax - ymin) * paddingPct) / 100;
        const x0 = Math.max(0, xmin - padX);
        const y0 = Math.max(0, ymin - padY);
        const x1 = Math.min(1000, xmax + padX);
        const y1 = Math.min(1000, ymax + padY);
        const sx = Math.max(0, Math.floor((x0 / 1000) * W));
        const sy = Math.max(0, Math.floor((y0 / 1000) * H));
        const sw = Math.min(W - sx, Math.ceil(((x1 - x0) / 1000) * W));
        const sh = Math.min(H - sy, Math.ceil(((y1 - y0) / 1000) * H));
        if (sw < 10 || sh < 10) return resolve(dataUrl);
        const canvas = document.createElement('canvas');
        canvas.width = sw; canvas.height = sh;
        canvas.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
        resolve(canvas.toDataURL('image/jpeg', 0.92));
      } catch { resolve(dataUrl); }
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  } catch { resolve(dataUrl); }
});

// Parse a signature bbox out of a Gemini response. Handles:
//   - JSON: {"box_2d":[y,x,y,x], ...}
//   - JSON inside markdown fences
//   - Plain "BBOX: y,x,y,x" line
//   - "box_2d: [y, x, y, x]" key/value
// Returns [ymin,xmin,ymax,xmax] or null if no usable box was found.
export const parseSignatureBbox = (aiText) => {
  if (!aiText) return null;
  // Strip markdown fences if present
  const text = aiText.replace(/```(?:json)?/gi, '').trim();

  // Try JSON parse first (most common Gemini format)
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const obj = JSON.parse(jsonMatch[0]);
      const box = obj.box_2d || obj.bbox || obj.BBOX;
      if (Array.isArray(box) && box.length >= 4) {
        const nums = box.slice(0, 4).map(Number).filter(n => Number.isFinite(n));
        if (nums.length === 4) {
          if (obj.is_signature === false) return null;
          const [a, b, c, d] = nums;
          if (a === 0 && b === 0 && c === 1000 && d === 1000) return null;
          return [a, b, c, d];
        }
      }
    }
  } catch { /* fall through */ }

  // Fallback: BBOX: y,x,y,x  or  box_2d: [y, x, y, x]
  const re = /(?:BBOX|box_2d)\s*[:=]\s*\[?\s*([\d.\-,\s]+?)\]?(?:\s|$|,)/i;
  const m = text.match(re);
  if (m) {
    const nums = m[1].split(/[,\s]+/).map(Number).filter(n => Number.isFinite(n));
    if (nums.length >= 4) {
      const [ymin, xmin, ymax, xmax] = nums;
      if (ymin === 0 && xmin === 0 && ymax === 1000 && xmax === 1000) return null;
      return [ymin, xmin, ymax, xmax];
    }
  }
  return null;
};

// Parse is_signature + note from the AI response (JSON or legacy line format).
export const parseSignatureMeta = (aiText) => {
  if (!aiText) return { isSignature: null, note: '' };
  const text = aiText.replace(/```(?:json)?/gi, '').trim();
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const obj = JSON.parse(jsonMatch[0]);
      if (obj && (typeof obj.is_signature === 'boolean' || obj.note != null)) {
        return { isSignature: !!obj.is_signature, note: String(obj.note || '').trim() };
      }
    }
  } catch { /* ignore */ }
  const isSig = /IS_SIGNATURE:\s*yes/i.test(text) ? true
    : /IS_SIGNATURE:\s*no/i.test(text) ? false : null;
  const noteMatch = text.match(/NOTE:\s*(.+)/i);
  return { isSignature: isSig, note: noteMatch ? noteMatch[1].trim() : '' };
};
