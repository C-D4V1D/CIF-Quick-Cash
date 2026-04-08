import { useRef, useState } from 'react';
import { COLORS } from '../theme';

const API_BASE = '/api';

const apiPost = async (path, body) => {
  const res = await fetch(`${API_BASE}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  });
  return res.json().catch(() => ({}));
};

const apiPut = async (path, body) => {
  const res = await fetch(`${API_BASE}/${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Request failed');
  }
  return res.json().catch(() => ({}));
};

const apiDel = (path) =>
  fetch(`${API_BASE}/${path}`, { method: 'DELETE', credentials: 'include' });

// Compress & read an uploaded file to a base64 data URL, max 1200px.
const compressToDataUrl = (file, maxDim = 1200, quality = 0.9) =>
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
//   2. Crop to the bounding box of ink pixels
//   3. Return a transparent-background PNG data URL
const refineSignatureImage = (dataUrl) =>
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

const SIGNATURE_AI_PROMPT = `You are reviewing a photo uploaded as a user's handwritten signature.
Respond with EXACTLY one line in this format:
IS_SIGNATURE: yes|no
NOTE: <one short sentence of feedback>
If the image does not clearly show a handwritten signature on a light background, answer "no".`;

export default function SignatureSection({ currentUser, settings = {}, callGeminiAI, onSaved, isMobile }) {
  const cameraRef = useRef();
  const fileRef = useRef();

  const [rawData, setRawData] = useState(null);       // base64 just uploaded (unrefined)
  const [refinedData, setRefinedData] = useState(null); // base64 after refinement
  const [stage, setStage] = useState('idle');         // idle | picked | refining | refined | saving
  const [error, setError] = useState('');
  const [aiNote, setAiNote] = useState('');
  const [saved, setSaved] = useState(false);
  const [zoomed, setZoomed] = useState(false);

  const currentUrl = currentUser.signature || null;

  const resetWizard = () => {
    setRawData(null);
    setRefinedData(null);
    setStage('idle');
    setError('');
    setAiNote('');
  };

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError('');
    setAiNote('');
    try {
      const b64 = await compressToDataUrl(file);
      setRawData(b64);
      setRefinedData(null);
      setStage('picked');
    } catch (err) {
      setError(err.message || 'Could not read this image.');
    }
  };

  const handleRefine = async () => {
    if (!rawData) return;
    setStage('refining');
    setError('');
    setAiNote('');
    try {
      // Optional AI verification (only if an API key is configured)
      if (callGeminiAI && settings.geminiApiKey) {
        const result = await callGeminiAI(
          settings.geminiApiKey,
          settings.geminiModel,
          [rawData],
          SIGNATURE_AI_PROMPT,
          settings.geminiThinkingBudget,
          settings.geminiTemperature,
        );
        if (result?.text) {
          const text = result.text;
          const isSig = /IS_SIGNATURE:\s*yes/i.test(text);
          const noteMatch = text.match(/NOTE:\s*(.+)/i);
          if (noteMatch) setAiNote(noteMatch[1].trim());
          if (!isSig) {
            setError('AI could not confirm a handwritten signature in this photo. You can still continue if you are sure.');
          }
        }
        // Ignore AI errors silently — refinement still works without AI.
      }
      const refined = await refineSignatureImage(rawData);
      setRefinedData(refined);
      setStage('refined');
    } catch (err) {
      setError(err.message || 'Could not refine this image.');
      setStage('picked');
    }
  };

  const handleSave = async () => {
    if (!refinedData) return;
    setStage('saving');
    setError('');
    try {
      const mimeType = refinedData.split(';')[0].split(':')[1];
      const data = refinedData.split(',')[1];
      const uploadResult = await apiPost('photos', { data, mimeType });
      const url = uploadResult?.url || null;
      if (!url) {
        throw new Error('Upload failed — photo service did not return a URL.');
      }
      // Persist on the user
      await apiPut(`users/${currentUser.id}`, { signature: url });
      // Clean up the previous signature from R2 (best-effort)
      if (currentUrl && currentUrl.startsWith('/api/photos/') && currentUrl !== url) {
        apiDel(currentUrl.slice(5)).catch(() => {});
      }
      if (onSaved) onSaved({ signature: url });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      resetWizard();
    } catch (err) {
      setError(err.message || 'Could not save signature.');
      setStage('refined');
    }
  };

  const handleRemove = async () => {
    if (!currentUrl) return;
    if (!window.confirm('Remove your saved signature? Printed copies will no longer include it.')) return;
    setError('');
    try {
      await apiPut(`users/${currentUser.id}`, { signature: null });
      if (currentUrl.startsWith('/api/photos/')) {
        apiDel(currentUrl.slice(5)).catch(() => {});
      }
      if (onSaved) onSaved({ signature: null });
    } catch (err) {
      setError(err.message || 'Could not remove signature.');
    }
  };

  const previewSrc = refinedData || rawData || currentUrl;
  const hasPreview = !!previewSrc;

  return (
    <div style={{ background: '#fff', borderRadius: '12px', padding: isMobile ? '20px' : '24px', border: `1px solid ${COLORS.border}`, marginBottom: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', flexWrap: 'wrap', gap: '10px' }}>
        <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 800, color: COLORS.primaryDark, display: 'flex', alignItems: 'center', gap: '8px' }}>
          ✍️ Signature
        </h3>
        {saved && <span style={{ fontSize: '13px', color: COLORS.primary, fontWeight: 600 }}>✅ Saved!</span>}
      </div>
      <div style={{ fontSize: '12.5px', color: COLORS.textMuted, marginBottom: '16px', lineHeight: 1.5 }}>
        Upload a photo of your signature on white paper. It will be cleaned up and used as the representative signature on printed agreement copies.
      </div>

      {/* Preview box */}
      <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', alignItems: isMobile ? 'stretch' : 'flex-start', gap: '16px' }}>
        <div
          onClick={() => { if (hasPreview) setZoomed(true); else cameraRef.current?.click(); }}
          style={{
            width: isMobile ? '100%' : 260,
            height: 120,
            borderRadius: '10px',
            border: `2px dashed ${COLORS.border}`,
            background: hasPreview ? '#fafaf7' : COLORS.bg,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
            cursor: 'pointer',
            position: 'relative',
          }}
        >
          {hasPreview ? (
            <img
              src={previewSrc}
              alt="Signature preview"
              style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
              onError={e => { e.currentTarget.onerror = null; e.currentTarget.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='80'%3E%3Crect width='200' height='80' fill='%23fee2e2'/%3E%3Ctext x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' font-size='11' fill='%23dc2626'%3ESignature unavailable%3C/text%3E%3C/svg%3E"; }}
            />
          ) : (
            <span style={{ fontSize: '12px', color: COLORS.textMuted, padding: '8px', textAlign: 'center' }}>📷 Tap to upload signature</span>
          )}
          {stage === 'refining' && (
            <div style={{ position: 'absolute', inset: 0, background: 'rgba(255,255,255,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ fontSize: '12px', fontWeight: 700, color: COLORS.primaryDark }}>✨ Refining…</span>
            </div>
          )}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Stage-based controls */}
          {stage === 'idle' && (
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <button type="button" onClick={() => cameraRef.current?.click()} style={btnStyle('primary')}>📷 Camera</button>
              <button type="button" onClick={() => fileRef.current?.click()} style={btnStyle('secondary')}>🖼 Gallery</button>
              {currentUrl && (
                <button type="button" onClick={handleRemove} style={btnStyle('danger')}>🗑 Remove</button>
              )}
            </div>
          )}

          {stage === 'picked' && (
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <button type="button" onClick={handleRefine} style={btnStyle('primary')}>✨ Refine with AI</button>
              <button type="button" onClick={resetWizard} style={btnStyle('secondary')}>Cancel</button>
            </div>
          )}

          {stage === 'refining' && (
            <div style={{ fontSize: '13px', color: COLORS.textMuted, fontWeight: 600 }}>Analyzing and cleaning up your signature…</div>
          )}

          {stage === 'refined' && (
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <button type="button" onClick={handleSave} style={btnStyle('primary')}>💾 Save Signature</button>
              <button type="button" onClick={handleRefine} style={btnStyle('secondary')}>↻ Refine Again</button>
              <button type="button" onClick={resetWizard} style={btnStyle('danger')}>Discard</button>
            </div>
          )}

          {stage === 'saving' && (
            <div style={{ fontSize: '13px', color: COLORS.textMuted, fontWeight: 600 }}>Uploading signature…</div>
          )}

          {aiNote && (
            <div style={{ marginTop: '10px', padding: '8px 12px', background: COLORS.primaryLight, borderRadius: '8px', fontSize: '12.5px', color: COLORS.primaryDark, fontWeight: 600 }}>
              🤖 {aiNote}
            </div>
          )}

          {error && (
            <div style={{ marginTop: '10px', padding: '10px 14px', background: COLORS.dangerLight, borderRadius: '8px', color: COLORS.danger, fontSize: '13px', fontWeight: 600 }}>
              {error}
            </div>
          )}
        </div>
      </div>

      <input ref={cameraRef} type="file" accept="image/*" capture="environment" onChange={handleFile} style={{ display: 'none' }} />
      <input ref={fileRef} type="file" accept="image/*" onChange={handleFile} style={{ display: 'none' }} />

      {zoomed && previewSrc && (
        <div onClick={() => setZoomed(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.88)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000, padding: '16px' }}>
          <div onClick={e => e.stopPropagation()} style={{ maxWidth: '100%', maxHeight: '100%', textAlign: 'center' }}>
            <img src={previewSrc} alt="Signature" style={{ maxWidth: '100%', maxHeight: '80vh', background: '#fff', padding: '20px', borderRadius: '12px' }} />
            <div style={{ marginTop: '16px' }}>
              <button type="button" onClick={() => setZoomed(false)} style={{ ...btnStyle('secondary'), background: '#fff' }}>✕ Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function btnStyle(variant) {
  const base = {
    padding: '9px 18px',
    borderRadius: '8px',
    border: 'none',
    fontWeight: 700,
    fontSize: '13px',
    cursor: 'pointer',
    fontFamily: 'inherit',
    whiteSpace: 'nowrap',
    transition: 'background 0.2s',
  };
  if (variant === 'primary') return { ...base, background: COLORS.primary, color: '#fff' };
  if (variant === 'danger') return { ...base, background: COLORS.dangerLight, color: COLORS.danger };
  return { ...base, background: COLORS.bg, color: COLORS.text, border: `1.5px solid ${COLORS.border}` };
}
