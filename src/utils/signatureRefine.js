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

export const SIGNATURE_AI_PROMPT = `You are reviewing a photo uploaded as a user's handwritten signature.
Respond with EXACTLY one line in this format:
IS_SIGNATURE: yes|no
NOTE: <one short sentence of feedback>
If the image does not clearly show a handwritten signature on a light background, answer "no".`;
