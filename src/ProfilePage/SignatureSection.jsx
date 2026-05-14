import { useRef, useState } from 'react';
import { COLORS } from '../theme';
import { compressToDataUrl, refineSignatureImage, SIGNATURE_AI_PROMPT, parseSignatureBbox, parseSignatureMeta, cropImageToBbox } from '../utils/signatureRefine';

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
      // Optional AI verification + bounding-box crop. AI returns a tight bbox
      // around the ink so distracting text/background is removed before refinement.
      let preCropped = rawData;
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
          const { isSignature, note } = parseSignatureMeta(text);
          if (note) setAiNote(note);
          if (isSignature === false) {
            setError('AI could not confirm a handwritten signature in this photo. You can still continue if you are sure.');
          }
          const bbox = parseSignatureBbox(text);
          if (bbox) preCropped = await cropImageToBbox(rawData, bbox);
        }
        // Ignore AI errors silently — refinement still works without AI.
      }
      const refined = await refineSignatureImage(preCropped);
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
