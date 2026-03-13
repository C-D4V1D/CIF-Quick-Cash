import { useState, useEffect, useRef, useMemo } from "react";

// --- MOBILE DETECTION HOOK ---
const useMobile = () => {
  const [mobile, setMobile] = useState(typeof window !== 'undefined' && window.innerWidth < 768);
  useEffect(() => {
    const fn = () => setMobile(window.innerWidth < 768);
    window.addEventListener('resize', fn);
    return () => window.removeEventListener('resize', fn);
  }, []);
  return mobile;
};

// ============================================================
// CHRIST-IN-FABIAN QUICK CASH — PRODUCTION CRM
// Connected to Neon PostgreSQL via Netlify Functions
// ============================================================

// --- API HELPERS ---
const API = {
  async get(endpoint) {
    try {
      const r = await fetch(`/api/${endpoint}`, { cache: 'no-store', credentials: 'same-origin' });
      if (!r.ok) throw new Error(`API error: ${r.status}`);
      return await r.json();
    } catch (e) { console.error(`GET /api/${endpoint}:`, e); return null; }
  },
  async post(endpoint, data) {
    try {
      const r = await fetch(`/api/${endpoint}`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
        credentials: 'include'
      });
      if (!r.ok) throw new Error(`API error: ${r.status}`);
      return await r.json();
    } catch (e) { console.error(`POST /api/${endpoint}:`, e); return null; }
  },
  async put(endpoint, data) {
    try {
      const r = await fetch(`/api/${endpoint}`, {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
        credentials: 'include'
      });
      if (!r.ok) throw new Error(`API error: ${r.status}`);
      return await r.json();
    } catch (e) { console.error(`PUT /api/${endpoint}:`, e); return null; }
  },
  async del(endpoint) {
    try {
      const r = await fetch(`/api/${endpoint}`, { method: 'DELETE', credentials: 'same-origin' });
      if (!r.ok) throw new Error(`API error: ${r.status}`);
      return await r.json();
    } catch (e) { console.error(`DELETE /api/${endpoint}:`, e); return null; }
  }
};

// --- UTILITY FUNCTIONS ---
const genRef = () => {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(-2);
  const rand = String(Math.floor(Math.random() * 999) + 1).padStart(3, '0');
  return `CIF-${dd}${mm}${yy}-${rand}`;
};

const daysBetween = (dateStr) => {
  if (!dateStr) return 0;
  const given = new Date(dateStr);
  const now = new Date();
  given.setHours(0, 0, 0, 0);
  now.setHours(0, 0, 0, 0);
  return Math.max(0, Math.ceil((now - given) / 86400000));
};

const fmtMoney = (n) => {
  if (!n && n !== 0) return '₦0';
  return '₦' + Number(n).toLocaleString();
};

const fmtDate = (d) => {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};

const statusColor = (tx) => {
  if (tx.status === 'closed' || tx.status === 'sold') return '#10b981';
  if (tx.status === 'for_sale') return '#8b5cf6';
  const days = daysBetween(tx.dateGiven);
  const deadline = tx.loanDays || 30;
  if (days > deadline + 3) return '#1e1e1e';
  if (days > deadline) return '#7c3aed';
  if (days > deadline - 7) return '#ef4444';
  if (days > deadline - 15) return '#f59e0b';
  return '#10b981';
};

const statusLabel = (tx) => {
  if (tx.status === 'closed') return 'Closed — Returned';
  if (tx.status === 'sold') return 'Sold';
  if (tx.status === 'for_sale') return 'Listed for Sale';
  if (tx.status === 'declined') return 'Declined';
  if (tx.type === 'outright') return 'Outright Purchase';
  const days = daysBetween(tx.dateGiven);
  const deadline = tx.loanDays || 30;
  if (days > deadline + 3) return 'Ready to Sell';
  if (days > deadline) return 'Grace Period';
  if (days > deadline - 7) return `⚠ ${deadline - days} days left`;
  return `Active — Day ${days}`;
};

// --- DEFAULT DATA ---
const DEFAULT_SETTINGS = {
  businessName: 'Christ-in-Fabian Quick Cash',
  location: 'Aguleri Junction, Anambra State, Nigeria',
  interestRate: 1, loanCapNoReceipt: 40, loanCapWithReceipt: 50,
  graceDays: 3, serviceFee: 1000, maxLoanDays: 30,
  targetSellPct: 75, minSellBonus: 20, geminiApiKey: '', geminiModel: 'gemini-2.5-flash', ninApiKey: '',
  itemCategories: ['Smartphone', 'Laptop', 'Tablet', 'Bluetooth Speaker', 'Power Bank', 'Electric Fan', 'Flat-Screen TV', 'Generator', 'Gas Cylinder', 'Other'],
  shopAddress: 'Current Filling Station, off Tourist Garden Hotel, Enugwu-Aguleri, Anambra East LGA, Anambra State',
  shopPhone1: '08165491908',
  shopPhone2: '09023540646',
  shopWhatsApp: '2348165491908',
  shopHours: 'Monday – Saturday, 8am – 6pm',
  shopMapsUrl: '',
};

// ============================================================
// GEMINI AI INTEGRATION
// ============================================================
const FALLBACK_GEMINI_MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite'];

const callGeminiAI = async (apiKey, model, images, promptText) => {
  if (!apiKey) return { error: 'No Gemini API key set. Go to Admin > Settings to add your key.' };
  try {
    const preferredModel = (model || '').trim() || DEFAULT_SETTINGS.geminiModel;
    const modelCandidates = [preferredModel, ...FALLBACK_GEMINI_MODELS]
      .filter(Boolean)
      .filter((m, idx, arr) => arr.indexOf(m) === idx);
    const parts = [{ text: promptText }];
    for (const img of images) {
      if (img) {
        const base64 = img.split(',')[1];
        const mime = img.split(';')[0].split(':')[1];
        parts.push({ inline_data: { mime_type: mime, data: base64 } });
      }
    }

    for (const modelName of modelCandidates) {
      const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts }] })
      });
      const data = await resp.json().catch(() => null);
      if (data?.candidates?.[0]?.content?.parts?.[0]?.text) return { text: data.candidates[0].content.parts[0].text, model: modelName };

      const errorMsg = (data?.error?.message || `Gemini request failed with status ${resp.status}.`).toLowerCase();
      const modelUnavailable = errorMsg.includes('no longer available') || errorMsg.includes('not found') || errorMsg.includes('unsupported');
      const canFallback = modelUnavailable && modelName !== modelCandidates[modelCandidates.length - 1];
      if (!canFallback) return { error: data?.error?.message || `Gemini request failed with status ${resp.status}.` };
    }

    return { error: `No supported Gemini model was available for this API key. Tried: ${modelCandidates.join(', ')}.` };
  } catch (e) { return { error: e.message }; }
};

// ============================================================
// STYLES
// ============================================================
const COLORS = {
  bg: '#f8f6f1', card: '#ffffff', primary: '#1a5f2a', primaryLight: '#e8f5ec',
  primaryDark: '#0d3518', accent: '#c8a84e', accentLight: '#faf3e0',
  danger: '#c0392b', dangerLight: '#fde8e6', warning: '#e67e22', warningLight: '#fef3e2',
  text: '#1a1a1a', textMuted: '#6b7280', border: '#e5e1d8', borderDark: '#d1cdc4',
};

const S = {
  app: { fontFamily: "'DM Sans', 'Nunito', sans-serif", background: COLORS.bg, minHeight: '100vh', color: COLORS.text, fontSize: '14px', lineHeight: 1.6 },
  loginWrap: { display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: `linear-gradient(135deg, ${COLORS.primaryDark} 0%, ${COLORS.primary} 50%, #2d7a3e 100%)`, padding: '20px' },
  loginCard: { background: COLORS.card, borderRadius: '16px', padding: 'clamp(24px, 6vw, 40px)', width: '100%', maxWidth: '400px', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' },
  loginTitle: { fontSize: '22px', fontWeight: 800, color: COLORS.primary, textAlign: 'center', marginBottom: '4px', letterSpacing: '-0.5px' },
  loginSub: { fontSize: '13px', color: COLORS.textMuted, textAlign: 'center', marginBottom: '28px' },
  topBar: { background: COLORS.primary, color: '#fff', padding: '0 24px', height: '56px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 100, boxShadow: '0 2px 8px rgba(0,0,0,0.15)' },
  sidebar: { width: '220px', background: '#fff', borderRight: `1px solid ${COLORS.border}`, padding: '16px 0', flexShrink: 0, overflowY: 'auto' },
  sideItem: (active) => ({ padding: '10px 20px', cursor: 'pointer', fontSize: '13.5px', fontWeight: active ? 700 : 500, color: active ? COLORS.primary : COLORS.text, background: active ? COLORS.primaryLight : 'transparent', borderLeft: active ? `3px solid ${COLORS.primary}` : '3px solid transparent', transition: 'all 0.15s', display: 'flex', alignItems: 'center', gap: '10px' }),
  mainContent: { flex: 1, padding: '24px', overflowY: 'auto', maxHeight: 'calc(100vh - 56px)' },
  card: { background: COLORS.card, borderRadius: '12px', padding: '24px', border: `1px solid ${COLORS.border}`, marginBottom: '20px', overflowX: 'auto' },
  cardTitle: { fontSize: '17px', fontWeight: 700, marginBottom: '16px', color: COLORS.primaryDark, display: 'flex', alignItems: 'center', gap: '8px' },
  label: { fontSize: '12.5px', fontWeight: 600, color: COLORS.textMuted, marginBottom: '4px', display: 'block', textTransform: 'uppercase', letterSpacing: '0.5px' },
  input: { width: '100%', padding: '10px 12px', borderRadius: '8px', border: `1.5px solid ${COLORS.border}`, fontSize: '14px', outline: 'none', boxSizing: 'border-box', background: '#fff', transition: 'border-color 0.2s' },
  select: { width: '100%', padding: '10px 12px', borderRadius: '8px', border: `1.5px solid ${COLORS.border}`, fontSize: '14px', outline: 'none', boxSizing: 'border-box', background: '#fff' },
  textarea: { width: '100%', padding: '10px 12px', borderRadius: '8px', border: `1.5px solid ${COLORS.border}`, fontSize: '14px', outline: 'none', boxSizing: 'border-box', minHeight: '80px', resize: 'vertical', background: '#fff' },
  btn: (v = 'primary') => ({ padding: '10px 20px', borderRadius: '8px', border: v === 'outline' ? `2px solid ${COLORS.primary}` : 'none', fontWeight: 600, fontSize: '13.5px', cursor: 'pointer', transition: 'all 0.2s', display: 'inline-flex', alignItems: 'center', gap: '6px', background: v === 'primary' ? COLORS.primary : v === 'danger' ? COLORS.danger : v === 'accent' ? COLORS.accent : v === 'outline' ? 'transparent' : '#6b7280', color: v === 'outline' ? COLORS.primary : '#fff' }),
  btnSm: (v = 'primary') => ({ padding: '6px 14px', borderRadius: '6px', border: 'none', fontWeight: 600, fontSize: '12px', cursor: 'pointer', background: v === 'primary' ? COLORS.primary : v === 'danger' ? COLORS.danger : v === 'accent' ? COLORS.accent : '#6b7280', color: '#fff' }),
  table: { width: '100%', borderCollapse: 'collapse', fontSize: '13px' },
  th: { textAlign: 'left', padding: '10px 12px', fontWeight: 700, fontSize: '11.5px', textTransform: 'uppercase', letterSpacing: '0.5px', color: COLORS.textMuted, borderBottom: `2px solid ${COLORS.border}`, background: COLORS.bg },
  td: { padding: '10px 12px', borderBottom: `1px solid ${COLORS.border}`, verticalAlign: 'middle' },
  badge: (color) => ({ display: 'inline-block', padding: '3px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 700, color: '#fff', background: color }),
  grid2: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '16px' },
  grid3: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '16px' },
  grid4: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '16px' },
  stat: { background: COLORS.card, borderRadius: '12px', padding: '20px', border: `1px solid ${COLORS.border}` },
  statValue: { fontSize: '24px', fontWeight: 800, color: COLORS.primary },
  statLabel: { fontSize: '12px', color: COLORS.textMuted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' },
  wizStep: (active, done) => ({ padding: '8px 16px', borderRadius: '20px', fontSize: '12px', fontWeight: 600, background: active ? COLORS.primary : done ? COLORS.primaryLight : COLORS.bg, color: active ? '#fff' : done ? COLORS.primary : COLORS.textMuted, border: `1.5px solid ${active ? COLORS.primary : done ? COLORS.primary : COLORS.border}`, cursor: done ? 'pointer' : 'default', whiteSpace: 'nowrap' }),
  photoBox: { width: '120px', height: '120px', borderRadius: '10px', border: `2px dashed ${COLORS.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', overflow: 'hidden', position: 'relative', background: COLORS.bg, flexShrink: 0 },
  photoImg: { width: '100%', height: '100%', objectFit: 'cover' },
  alert: (type) => ({ padding: '12px 16px', borderRadius: '8px', marginBottom: '16px', fontSize: '13px', background: type === 'danger' ? COLORS.dangerLight : type === 'warning' ? COLORS.warningLight : COLORS.primaryLight, color: type === 'danger' ? COLORS.danger : type === 'warning' ? COLORS.warning : COLORS.primary, border: `1px solid ${type === 'danger' ? '#f5c6cb' : type === 'warning' ? '#fde2b3' : '#b7e4c7'}`, fontWeight: 500 }),
  body: { display: 'flex', height: 'calc(100vh - 56px)' },
  mobileOverlay: { position: 'fixed', inset: 0, zIndex: 200 },
  mobileSidebar: { position: 'absolute', top: 0, left: 0, bottom: 0, width: '260px', background: '#fff', overflowY: 'auto', zIndex: 201, boxShadow: '4px 0 20px rgba(0,0,0,0.2)' },
  hamburger: { background: 'none', border: 'none', color: '#fff', fontSize: '22px', cursor: 'pointer', padding: '4px 6px', lineHeight: 1, display: 'flex', alignItems: 'center' },
};

// ============================================================
// REUSABLE COMPONENTS
// ============================================================
function PhotoUpload({ label, value, onChange, required, size = 120 }) {
  const ref = useRef();
  const handleFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      // Compress large images
      const canvas = document.createElement('canvas');
      const img = new Image();
      img.onload = () => {
        const max = 800;
        let w = img.width, h = img.height;
        if (w > max) { h = h * max / w; w = max; }
        if (h > max) { w = w * max / h; h = max; }
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        onChange(canvas.toDataURL('image/jpeg', 0.7));
      };
      img.src = URL.createObjectURL(file);
    } else {
      const reader = new FileReader();
      reader.onload = (ev) => onChange(ev.target.result);
      reader.readAsDataURL(file);
    }
  };
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ ...S.photoBox, width: size, height: size }} onClick={() => ref.current?.click()}>
        {value ? <img src={value} style={S.photoImg} alt={label} /> :
          <span style={{ fontSize: '11px', color: COLORS.textMuted, padding: '8px', textAlign: 'center' }}>📷 {label}</span>}
        <input ref={ref} type="file" accept="image/*" capture="environment" onChange={handleFile} style={{ display: 'none' }} />
      </div>
      <div style={{ fontSize: '10.5px', marginTop: '4px', color: required ? COLORS.danger : COLORS.textMuted, fontWeight: 600 }}>{label} {required && '*'}</div>
    </div>
  );
}

function Field({ label, required, children, style: st }) {
  return (<div style={{ marginBottom: '14px', ...st }}><label style={S.label}>{label} {required && <span style={{ color: COLORS.danger }}>*</span>}</label>{children}</div>);
}

function Modal({ open, onClose, title, children, wide }) {
  const isMobile = useMobile();
  if (!open) return null;
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: isMobile ? 'flex-end' : 'center', justifyContent: 'center', zIndex: 1000, padding: isMobile ? '0' : '12px' }}>
      <div style={{ background: '#fff', borderRadius: isMobile ? '16px 16px 0 0' : '16px', width: '100%', maxWidth: wide ? '900px' : '600px', maxHeight: isMobile ? '92vh' : '88vh', overflow: 'auto', padding: isMobile ? '20px 16px' : '28px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h3 style={{ fontSize: '18px', fontWeight: 700, margin: 0, color: COLORS.primaryDark }}>{title}</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: '22px', cursor: 'pointer', color: COLORS.textMuted, padding: '4px 8px' }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ============================================================
// WHATSAPP BUTTON
// ============================================================
function WhatsAppButton({ whatsAppNumber, style: extraStyle }) {
  const num = (whatsAppNumber || '2348165491908').replace(/\D/g, '');
  const msg = encodeURIComponent('Hello, I need help with my loan at CIF Quick Cash');
  const url = `https://wa.me/${num}?text=${msg}`;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        display: 'inline-flex', alignItems: 'center', gap: '10px',
        background: '#25D366', color: '#fff', padding: '12px 20px',
        borderRadius: '10px', textDecoration: 'none', fontWeight: 700,
        fontSize: '15px', justifyContent: 'center', width: '100%',
        boxSizing: 'border-box', ...extraStyle,
      }}
    >
      <svg width="22" height="22" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M16 3C9.373 3 4 8.373 4 15c0 2.385.668 4.61 1.82 6.51L4 29l7.7-1.79A11.92 11.92 0 0016 27c6.627 0 12-5.373 12-12S22.627 3 16 3z" fill="#25D366"/>
        <path d="M16 3C9.373 3 4 8.373 4 15c0 2.385.668 4.61 1.82 6.51L4 29l7.7-1.79A11.92 11.92 0 0016 27c6.627 0 12-5.373 12-12S22.627 3 16 3z" fill="white" fillOpacity="0.15"/>
        <path fillRule="evenodd" clipRule="evenodd" d="M21.5 18.3c-.3-.15-1.77-.87-2.04-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.17-.17.2-.35.22-.65.07-.3-.15-1.26-.46-2.4-1.48-.89-.79-1.49-1.77-1.66-2.07-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.07-.15-.67-1.62-.92-2.22-.24-.58-.49-.5-.67-.51H12.5c-.2 0-.52.07-.79.37-.27.3-1.04 1.02-1.04 2.49 0 1.47 1.07 2.89 1.22 3.09.15.2 2.1 3.2 5.09 4.49.71.31 1.27.49 1.7.63.72.23 1.37.2 1.89.12.58-.09 1.77-.72 2.02-1.42.25-.7.25-1.3.17-1.42-.07-.12-.27-.2-.57-.35z" fill="white"/>
      </svg>
      Chat with us on WhatsApp
    </a>
  );
}

// ============================================================
// LANDING PAGE
// ============================================================
function LandingPage({ onCheckLoan, onStaffLogin, settings }) {
  const s = settings || {};
  const phone1 = s.shopPhone1 || '08165491908';
  const phone2 = s.shopPhone2 || '09023540646';
  const address = s.shopAddress || 'Current Filling Station, off Tourist Garden Hotel, Enugwu-Aguleri, Anambra East LGA, Anambra State';
  const hours = s.shopHours || 'Monday – Saturday, 8am – 6pm';
  const mapsUrl = s.shopMapsUrl || `https://www.google.com/search?q=${encodeURIComponent(address)}`;
  const whatsApp = s.shopWhatsApp || '2348165491908';

  const items = ['Phones', 'Laptops', 'Tablets', 'Speakers', 'Power Banks', 'Fans', 'TVs', 'Generators', 'Gas Cylinders'];
  const features = [
    { icon: '⚡', title: 'Get quick cash', desc: 'Bring your item and leave with cash in hand' },
    { icon: '🔒', title: 'Item kept safe', desc: 'We store it securely until you return' },
    { icon: '🔄', title: 'Buy it back', desc: 'Pay us back within 30 days and collect your item' },
    { icon: '🏷', title: 'Fair prices', desc: 'We use current market value to price every item' },
  ];
  const steps = [
    'Walk into our shop with your item',
    'We check your ID — your NIN number (dial *346# on your phone)',
    'We check the value of your item and tell you how much we can offer you',
    'You agree, sign a simple form, and collect your cash',
    { bold: 'Cash Advance', rest: ': come back within 30 days, pay us back, and take your item home' },
    { bold: 'Outright Sale', rest: ': we pay you and the item is ours — no need to return' },
  ];
  const needs = [
    'Your item (phone, TV, generator, etc.)',
    'Your NIN number — dial *346# on your phone to find it',
    'At least one active phone number',
    'Original receipt if you have it — you get more cash with receipt',
    'The item must belong to you',
  ];

  return (
    <div style={{ fontFamily: "'DM Sans', 'Nunito', sans-serif", background: '#1a1a2e', minHeight: '100vh', color: '#fff', fontSize: '16px', lineHeight: 1.6 }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet" />

      {/* Hero */}
      <div style={{ background: '#1a5f2a', padding: '36px 20px 32px', textAlign: 'center' }}>
        <div style={{ display: 'inline-block', background: 'rgba(255,255,255,0.15)', borderRadius: '20px', padding: '4px 14px', fontSize: '13px', marginBottom: '14px', color: '#e0f0e3' }}>
          📍 Enugwu-Aguleri, Anambra
        </div>
        <div style={{ fontSize: '32px', marginBottom: '6px' }}>💰</div>
        <h1 style={{ fontSize: 'clamp(22px, 6vw, 32px)', fontWeight: 800, margin: '0 0 10px', lineHeight: 1.2 }}>Christ-in-Fabian Quick Cash</h1>
        <p style={{ fontSize: '17px', margin: '0 0 28px', opacity: 0.9, maxWidth: '420px', marginLeft: 'auto', marginRight: 'auto' }}>Need money fast? Bring your item and walk away with cash.</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', maxWidth: '420px', margin: '0 auto' }}>
          <button
            onClick={onCheckLoan}
            style={{ background: '#fff', color: '#1a5f2a', border: 'none', borderRadius: '10px', padding: '16px', fontSize: '17px', fontWeight: 700, cursor: 'pointer', minHeight: '52px' }}
          >
            Check My Loan Status
          </button>
          <button
            onClick={onStaffLogin}
            style={{ background: 'transparent', color: '#fff', border: '2px solid #fff', borderRadius: '10px', padding: '16px', fontSize: '17px', fontWeight: 600, cursor: 'pointer', minHeight: '52px' }}
          >
            Staff / Admin Login
          </button>
        </div>
      </div>

      {/* Our Two Services */}
      <div style={{ background: '#111827', padding: '32px 20px' }}>
        <h2 style={{ fontSize: '20px', fontWeight: 800, margin: '0 0 20px', color: '#fff' }}>Our two services</h2>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '20px' }}>
          <div style={{ background: '#1a3d22', border: '1.5px solid #1a5f2a', borderRadius: '12px', padding: '16px' }}>
            <div style={{ fontWeight: 800, color: '#4ade80', fontSize: '15px', marginBottom: '8px' }}>Cash Advance</div>
            <div style={{ fontSize: '14px', color: '#a7f3d0', lineHeight: 1.5 }}>Leave your item with us, collect cash, and buy it back within 30 days</div>
          </div>
          <div style={{ background: '#3d2e00', border: '1.5px solid #c8a84e', borderRadius: '12px', padding: '16px' }}>
            <div style={{ fontWeight: 800, color: '#fbbf24', fontSize: '15px', marginBottom: '8px' }}>Outright Sale</div>
            <div style={{ fontSize: '14px', color: '#fde68a', lineHeight: 1.5 }}>Want to sell your item immediately? We buy it from you on the spot</div>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          {features.map(f => (
            <div key={f.title} style={{ background: '#1e2433', borderRadius: '10px', padding: '14px', border: '1px solid #2a3447' }}>
              <div style={{ fontSize: '22px', marginBottom: '6px' }}>{f.icon}</div>
              <div style={{ fontWeight: 700, fontSize: '14px', marginBottom: '4px' }}>{f.title}</div>
              <div style={{ fontSize: '13px', color: '#9ca3af', lineHeight: 1.4 }}>{f.desc}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Items We Accept */}
      <div style={{ background: '#0f172a', padding: '28px 20px' }}>
        <h2 style={{ fontSize: '20px', fontWeight: 800, margin: '0 0 16px', color: '#fff' }}>Items we accept</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
          {items.map(item => (
            <div key={item} style={{ background: '#1e2433', border: '1px solid #2a3447', borderRadius: '8px', padding: '8px 6px', textAlign: 'center', fontSize: '13px', fontWeight: 500, color: '#d1d5db' }}>
              {item}
            </div>
          ))}
        </div>
      </div>

      {/* How It Works */}
      <div style={{ background: '#111827', padding: '28px 20px' }}>
        <h2 style={{ fontSize: '20px', fontWeight: 800, margin: '0 0 20px', color: '#fff' }}>How it works — step by step</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {steps.map((step, i) => (
            <div key={i} style={{ display: 'flex', gap: '14px', alignItems: 'flex-start' }}>
              <div style={{ background: '#1a5f2a', color: '#fff', borderRadius: '50%', width: '30px', height: '30px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '14px', flexShrink: 0, marginTop: '2px' }}>{i + 1}</div>
              <div style={{ fontSize: '15px', color: '#e5e7eb', lineHeight: 1.5 }}>
                {typeof step === 'string' ? step : <><strong style={{ color: '#fff' }}>{step.bold}</strong>{step.rest}</>}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* What You Need to Bring */}
      <div style={{ background: '#0f172a', padding: '28px 20px' }}>
        <h2 style={{ fontSize: '20px', fontWeight: 800, margin: '0 0 16px', color: '#fff' }}>What you need to bring</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {needs.map((n, i) => (
            <div key={i} style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
              <div style={{ color: '#4ade80', marginTop: '4px', flexShrink: 0 }}>●</div>
              <div style={{ fontSize: '15px', color: '#d1d5db', lineHeight: 1.5 }}>{n}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Contact & Location */}
      <div style={{ background: '#111827', padding: '28px 20px' }}>
        <h2 style={{ fontSize: '20px', fontWeight: 800, margin: '0 0 20px', color: '#fff' }}>Find us</h2>
        <div style={{ background: '#1e2433', borderRadius: '12px', padding: '20px', marginBottom: '16px', border: '1px solid #2a3447' }}>
          <div style={{ marginBottom: '10px' }}><strong style={{ color: '#9ca3af', fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Address</strong><div style={{ color: '#e5e7eb', fontSize: '15px', marginTop: '4px' }}>{address}</div></div>
          <div style={{ marginBottom: '10px' }}><strong style={{ color: '#9ca3af', fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Phone</strong><div style={{ color: '#e5e7eb', fontSize: '15px', marginTop: '4px' }}>{phone1}{phone2 ? ` / ${phone2}` : ''}</div></div>
          <div><strong style={{ color: '#9ca3af', fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Hours</strong><div style={{ color: '#e5e7eb', fontSize: '15px', marginTop: '4px' }}>{hours}</div></div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <WhatsAppButton whatsAppNumber={whatsApp} />
          <a
            href={mapsUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', background: '#1a5f2a', color: '#fff', padding: '12px', borderRadius: '10px', textDecoration: 'none', fontWeight: 600, fontSize: '15px' }}
          >
            📍 Get Directions
          </a>
        </div>
      </div>

      {/* Footer */}
      <div style={{ background: '#0a0f1a', padding: '20px', textAlign: 'center', fontSize: '13px', color: '#6b7280' }}>
        © 2026 Christ-in-Fabian Quick Cash. All rights reserved.
      </div>
    </div>
  );
}

// ============================================================
// CUSTOMER PORTAL
// ============================================================
function CustomerPortal({ onBack, settings }) {
  const [ref, setRef] = useState('');
  const [result, setResult] = useState(null); // null | 'not_found' | tx object
  const [searched, setSearched] = useState(false);

  const s = settings || {};
  const phone1 = s.shopPhone1 || '08165491908';
  const whatsApp = s.shopWhatsApp || '2348165491908';

  const handleCheck = async () => {
    if (!ref.trim()) return;
    const data = await API.get('transactions');
    const found = Array.isArray(data) ? data.find(t => t.ref?.toUpperCase() === ref.trim().toUpperCase()) : null;
    setResult(found || 'not_found');
    setSearched(true);
  };

  const formatDateLong = (d) => {
    if (!d) return '';
    return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  };

  const calcOwedToday = (tx) => {
    if (!tx || tx.type === 'outright') return tx?.cashAdvance || 0;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const given = new Date(tx.dateGiven); given.setHours(0, 0, 0, 0);
    const elapsed = Math.max(0, Math.floor((today - given) / 86400000));
    return (tx.cashAdvance || 0) + elapsed * (tx.dailyFee || 0);
  };

  const getDaysInfo = (tx) => {
    if (!tx.deadlineDate) return null;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const deadline = new Date(tx.deadlineDate); deadline.setHours(0, 0, 0, 0);
    const diff = Math.ceil((deadline - today) / 86400000);
    return diff;
  };

  const getStatusBadge = (tx) => {
    if (tx.status === 'closed') return { label: 'Closed — Returned', color: '#10b981' };
    if (tx.status === 'sold') return { label: 'Sold', color: '#6b7280' };
    if (tx.type === 'outright') return { label: 'Outright Purchase', color: '#8b5cf6' };
    const days = getDaysInfo(tx);
    if (days === null) return { label: 'Active', color: '#10b981' };
    const loanDays = tx.loanDays || 30;
    const elapsed = daysBetween(tx.dateGiven);
    if (elapsed > loanDays + 3) return { label: 'Overdue — Sell Pending', color: '#ef4444' };
    if (elapsed > loanDays) return { label: 'Grace Period', color: '#8b5cf6' };
    return { label: 'Active', color: '#10b981' };
  };

  return (
    <div style={{ fontFamily: "'DM Sans', 'Nunito', sans-serif", background: '#0f172a', minHeight: '100vh', color: '#fff', fontSize: '16px', lineHeight: 1.6 }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet" />

      {/* Header */}
      <div style={{ background: '#1a5f2a', padding: '24px 20px 20px' }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.8)', fontSize: '15px', cursor: 'pointer', padding: '0 0 12px', fontWeight: 500 }}>← Back to Home</button>
        <h1 style={{ fontSize: 'clamp(20px, 5vw, 28px)', fontWeight: 800, margin: '0 0 6px' }}>Check Your Loan Status</h1>
        <p style={{ margin: 0, opacity: 0.85, fontSize: '15px' }}>Enter the reference number from your agreement form (e.g. CIF-130326-001)</p>
      </div>

      <div style={{ padding: '24px 20px', maxWidth: '500px', margin: '0 auto' }}>
        {/* Search */}
        {(!searched || result === 'not_found') && (
          <div style={{ background: '#1e2433', borderRadius: '12px', padding: '20px', marginBottom: '20px', border: '1px solid #2a3447' }}>
            {result === 'not_found' && (
              <div style={{ background: '#3d1515', border: '1px solid #ef4444', borderRadius: '8px', padding: '14px', marginBottom: '16px', color: '#fca5a5', fontSize: '14px' }}>
                We could not find this reference number. Please check your agreement form and try again, or call us on {phone1}.
              </div>
            )}
            <label style={{ display: 'block', fontWeight: 600, color: '#9ca3af', fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' }}>Reference Number</label>
            <input
              style={{ width: '100%', padding: '14px', borderRadius: '8px', border: '1.5px solid #2a3447', fontSize: '16px', background: '#111827', color: '#fff', boxSizing: 'border-box', marginBottom: '12px' }}
              placeholder="e.g. CIF-130326-001"
              value={ref}
              onChange={e => { setRef(e.target.value); setSearched(false); }}
              onKeyDown={e => e.key === 'Enter' && handleCheck()}
            />
            <button
              onClick={handleCheck}
              style={{ width: '100%', background: '#1a5f2a', color: '#fff', border: 'none', borderRadius: '8px', padding: '14px', fontSize: '16px', fontWeight: 700, cursor: 'pointer', minHeight: '50px' }}
            >
              Check My Loan
            </button>
            {result === 'not_found' && (
              <div style={{ marginTop: '16px' }}>
                <WhatsAppButton whatsAppNumber={whatsApp} />
              </div>
            )}
          </div>
        )}

        {/* Result */}
        {searched && result && result !== 'not_found' && (() => {
          const tx = result;
          const badge = getStatusBadge(tx);
          const daysInfo = getDaysInfo(tx);
          const owed = calcOwedToday(tx);
          const isOverdue = daysInfo !== null && daysInfo < 0;
          return (
            <div>
              <div style={{ background: '#1e2433', borderRadius: '12px', padding: '20px', border: '1px solid #2a3447', marginBottom: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
                  <div>
                    <div style={{ fontSize: '13px', color: '#6b7280', marginBottom: '2px' }}>Reference</div>
                    <div style={{ fontWeight: 800, fontSize: '17px' }}>{tx.ref}</div>
                  </div>
                  <span style={{ background: badge.color, color: '#fff', borderRadius: '20px', padding: '4px 12px', fontSize: '12px', fontWeight: 700, flexShrink: 0, marginLeft: '8px' }}>{badge.label}</span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '14px' }}>
                  <div>
                    <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '2px' }}>Customer</div>
                    <div style={{ fontWeight: 600, fontSize: '15px' }}>{tx.fullName}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '2px' }}>Item</div>
                    <div style={{ fontWeight: 600, fontSize: '15px' }}>{[tx.aiItemType, tx.aiBrand, tx.aiModel].filter(Boolean).join(' ') || 'N/A'}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '2px' }}>Cash Advance Given</div>
                    <div style={{ fontWeight: 700, fontSize: '17px', color: '#4ade80' }}>{fmtMoney(tx.cashAdvance)}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '2px' }}>Daily Fee</div>
                    <div style={{ fontWeight: 600, fontSize: '15px' }}>{fmtMoney(tx.dailyFee)} per day</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '2px' }}>Date Given</div>
                    <div style={{ fontWeight: 600, fontSize: '15px' }}>{formatDateLong(tx.dateGiven)}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '2px' }}>Return Deadline</div>
                    <div style={{ fontWeight: 600, fontSize: '15px' }}>{formatDateLong(tx.deadlineDate)}</div>
                  </div>
                </div>

                {daysInfo !== null && tx.status === 'active' && tx.type !== 'outright' && (
                  <div style={{ background: isOverdue ? '#3d1515' : '#1a3d22', border: `1px solid ${isOverdue ? '#ef4444' : '#1a5f2a'}`, borderRadius: '8px', padding: '12px', marginBottom: '14px', textAlign: 'center' }}>
                    <div style={{ fontSize: '13px', color: isOverdue ? '#fca5a5' : '#a7f3d0' }}>{isOverdue ? `${Math.abs(daysInfo)} days overdue` : `${daysInfo} days remaining`}</div>
                  </div>
                )}

                {tx.status === 'active' && tx.type !== 'outright' && (
                  <div style={{ background: '#111827', borderRadius: '8px', padding: '14px', textAlign: 'center' }}>
                    <div style={{ fontSize: '13px', color: '#9ca3af', marginBottom: '4px' }}>Total owed today</div>
                    <div style={{ fontSize: '26px', fontWeight: 800, color: isOverdue ? '#ef4444' : '#4ade80' }}>{fmtMoney(owed)}</div>
                    <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '2px' }}>Updated live based on today's date</div>
                  </div>
                )}
              </div>

              <div style={{ background: '#1e2433', borderRadius: '10px', padding: '14px', marginBottom: '16px', fontSize: '14px', color: '#d1d5db', border: '1px solid #2a3447' }}>
                To pay back and collect your item, visit our shop or call <strong style={{ color: '#fff' }}>{phone1}</strong>
              </div>

              <WhatsAppButton whatsAppNumber={whatsApp} style={{ marginBottom: '14px' }} />

              <button
                onClick={() => { setResult(null); setSearched(false); setRef(''); }}
                style={{ background: 'none', border: 'none', color: '#9ca3af', fontSize: '15px', cursor: 'pointer', padding: '8px 0', textDecoration: 'underline', display: 'block', textAlign: 'center', width: '100%' }}
              >
                ← Check another reference number
              </button>
            </div>
          );
        })()}
      </div>
    </div>
  );
}

// ============================================================
// LOGIN SCREEN
// ============================================================
function LoginScreen({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Warm up database while user enters credentials.
  useEffect(() => {
    API.get('health');
  }, []);

  const handleLogin = async () => {
    setLoading(true);
    setError('');
    const result = await API.post('login', { username, password, rememberMe });
    if (result?.error) { setError(result.error); setLoading(false); return; }
    if (result?.user?.id) { onLogin(result.user); }
    else { setError('Invalid username or password'); }
    setLoading(false);
  };

  return (
    <div style={S.loginWrap}>
      <div style={S.loginCard}>
        <div style={{ textAlign: 'center', marginBottom: '8px' }}><span style={{ fontSize: '36px' }}>💰</span></div>
        <div style={S.loginTitle}>CHRIST-IN-FABIAN</div>
        <div style={{ fontSize: '14px', fontWeight: 700, textAlign: 'center', color: COLORS.accent, marginBottom: '4px', letterSpacing: '2px' }}>QUICK CASH</div>
        <div style={S.loginSub}>Staff & Stakeholder Portal</div>
        {error && <div style={S.alert('danger')}>{error}</div>}
        <Field label="Username"><input style={S.input} value={username} onChange={e => { setUsername(e.target.value); setError(''); }} placeholder="Enter username" /></Field>
        <Field label="Password"><input style={S.input} type="password" value={password} onChange={e => { setPassword(e.target.value); setError(''); }} placeholder="Enter password" onKeyDown={e => e.key === 'Enter' && handleLogin()} /></Field>
        <div style={{ marginTop: '-4px', marginBottom: '14px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: COLORS.text }}>
            <input type="checkbox" checked={rememberMe} onChange={e => setRememberMe(e.target.checked)} />
            Remember me on this device
          </label>
          <div style={{ fontSize: '11.5px', color: COLORS.textMuted, marginTop: '4px', lineHeight: 1.4 }}>
            Keeps you signed in for up to 30 days. Leave unchecked on shared computers.
          </div>
        </div>
        <button style={{ ...S.btn('primary'), width: '100%', justifyContent: 'center', marginTop: '8px', padding: '12px', opacity: loading ? 0.6 : 1 }} onClick={handleLogin} disabled={loading}>
          {loading ? '⏳ Signing in...' : 'Sign In →'}
        </button>
      </div>
    </div>
  );
}

// ============================================================
// TRANSACTION WIZARD (same 11-step flow, saves to database)
// ============================================================
const WIZARD_STEPS = [
  { id: 'type', label: '1. Type', icon: '📋' },
  { id: 'nin', label: '2. ID Verify', icon: '🪪' },
  { id: 'customer', label: '3. Customer', icon: '👤' },
  { id: 'custPhotos', label: '4. Photos', icon: '📸' },
  { id: 'itemPhotos', label: '5. Item Photos', icon: '🔍' },
  { id: 'aiValuation', label: '6. AI Value', icon: '🤖' },
  { id: 'imeiSerial', label: '7. IMEI/Serial', icon: '🔢' },
  { id: 'screening', label: '8. Screening', icon: '❓' },
  { id: 'offer', label: '9. Offer', icon: '💰' },
  { id: 'agreement', label: '10. Agreement', icon: '📄' },
  { id: 'complete', label: '11. Complete', icon: '✅' },
];

const EMPTY_TX = {
  type: 'advance', status: 'active', idType: 'nin', idNumber: '', ninVerified: false, ninData: null,
  fullName: '', address: '', phoneNumbers: ['', ''], phonesVerified: [false, false],
  familyName: '', familyPhone: '', familyRelation: '',
  photoCustomerHolding: null, photoCustomerID: null, photoSigning: null, photoSealedPkg: null,
  itemPhotos: { front: null, back: null, left: null, right: null, corners: [], powerOn: null, aboutPage: null },
  aiItemType: '', aiBrand: '', aiModel: '', aiColour: '', aiCondition: '', aiEstimatedValue: '', aiRawResponse: '', requiresIMEI: false,
  imei: '', imeiChecked: false, imeiClean: null, serialNumber: '',
  hasReceipt: false, receiptPhoto: null,
  screeningDuration: '', screeningPurchaseLocation: '', screeningRegistered: '', screeningOthersUsing: '', screeningRedFlag: false,
  estimatedValue: 0, loanCapPct: 40, cashAdvance: 0, dailyFee: 0, loanDays: 30,
  dateGiven: '', deadlineDate: '', serviceFeeCollected: false, conditionDescription: '',
  salePrice: 0, saleDate: '', saleBuyer: '',
  amountRepaid: 0, dateRepaid: '', daysCharged: 0, totalFees: 0, itemReturned: false,
  contactLog: [], notes: '',
};

function TransactionWizard({ settings, onSave, onCancel, draft, currentUser }) {
  const [step, setStep] = useState(draft?.wizardStep || 0);
  const [tx, setTx] = useState(draft || { ...EMPTY_TX, ref: genRef(), createdBy: currentUser?.name || '', createdAt: new Date().toISOString() });
  const [aiLoading, setAiLoading] = useState(false);
  const [ninLoading, setNinLoading] = useState(false);
  const [aiError, setAiError] = useState('');
  const [ninError, setNinError] = useState('');
  const saveTimer = useRef(null);

  const isMobile = useMobile();
  const upd = (field, val) => setTx(prev => ({ ...prev, [field]: val }));
  const updNested = (parent, field, val) => setTx(prev => ({ ...prev, [parent]: { ...prev[parent], [field]: val } }));
  const maxLoanDays = Math.max(1, Number(settings.maxLoanDays) || 30);

  useEffect(() => {
    if (tx.loanDays !== '' && Number(tx.loanDays) > maxLoanDays) {
      upd('loanDays', maxLoanDays);
      if (tx.dateGiven) {
        const d = new Date(tx.dateGiven);
        d.setDate(d.getDate() + maxLoanDays);
        upd('deadlineDate', d.toISOString().split('T')[0]);
      }
    }
  }, [maxLoanDays, tx.loanDays, tx.dateGiven]);

  // Auto-save draft every 3 seconds (debounced)
  useEffect(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      API.post('drafts', { ...tx, wizardStep: step });
    }, 3000);
    return () => clearTimeout(saveTimer.current);
  }, [tx, step]);

 // NIN/BVN Verification
  const handleVerify = async () => {
    setNinLoading(true); setNinError('');
    try {
      // Call our server-side proxy to avoid CORS issues
      const endpoint = tx.idType === 'nin' ? 'verify-nin' : 'verify-bvn';
      const body = tx.idType === 'nin' 
        ? { nin: tx.idNumber, apiKey: settings.ninApiKey }
        : { bvn: tx.idNumber, apiKey: settings.ninApiKey };
      const result = await API.post(endpoint, body);
      
      console.log('NIN/BVN API Response:', result);

      if ((result?.status === 'success' || result?.status === true || result?.status === 'true' || result?.code === 200) && (result?.data || result?.response)) {
        
        // Handle deeply nested data if the API buries it
        const d = (result.data?.firstname || result.data?.firstName) ? result.data : (result.data?.data || result.data || result.response);
        
        upd('ninVerified', true); upd('ninData', d);
        
        // Smart Name Extractor: handles both lowercase (NIN) and camelCase (BVN)
        const first = d.firstname || d.firstName;
        const middle = d.middlename || d.middleName;
        const last = d.surname || d.lastname || d.lastName;
        const fullName = [first, middle, last].filter(Boolean).join(' ');
        
        if (fullName) upd('fullName', fullName);
        
        // Smart Address Extractor
        const address = [d.residence_address, d.residence_town, d.residence_lga, d.residence_state].filter(Boolean).join(', ');
        if (address) upd('address', address);

        // Smart Phone Extractor
        const phone = d.telephoneno || d.phone || d.phoneNumber || d.phoneNumber1 || d.mobile;
        if (phone) {
          upd('phoneNumbers', [phone, tx.phoneNumbers[1]]);
        }
        
        // Fix Photo formatting
        let rawPhoto = d.photo || d.base64Image || d.picture || d.image;
        if (rawPhoto) {
          if (!rawPhoto.startsWith('data:image')) {
            rawPhoto = `data:image/jpeg;base64,${rawPhoto}`;
          }
          upd('ninPhoto', rawPhoto);
        }
        
      } else {
        throw new Error(result?.message || result?.detail || 'Verification failed - check console for details');
      }
    } catch (e) {
      console.error(e);
      // Safely extract the error message to avoid the "undefined" glitch
      const errorMessage = e?.message || String(e) || 'Unknown error occurred';
      setNinError(errorMessage + ' — Demo mode: proceeding with placeholder data.');
      upd('ninVerified', true);
      upd('ninData', { firstname: 'Demo', surname: 'User', residence_address: 'Aguleri Junction, Anambra State' });
      if (!tx.fullName) upd('fullName', 'Demo User');
      if (!tx.address) upd('address', 'Aguleri Junction, Anambra State');
    }
    setNinLoading(false);
  };

  // AI Valuation
  const handleAIValuation = async () => {
    setAiLoading(true); setAiError('');
    const photos = [tx.itemPhotos.front, tx.itemPhotos.back, tx.itemPhotos.left, tx.itemPhotos.right, tx.itemPhotos.powerOn, tx.itemPhotos.aboutPage, ...(tx.itemPhotos.corners || [])].filter(Boolean);
    if (photos.length === 0) { setAiError('Please upload at least one item photo first.'); setAiLoading(false); return; }
    const prompt = `I am running a second-hand item shop in Aguleri, Anambra State, Nigeria. I have uploaded photos of an item. Please do the following:
1. Identify the exact item type, brand, model, colour, and specifications from the photos.
2. Give me the current realistic second-hand resale price in Nigerian Naira (₦) for Aguleri or similar towns in Anambra State. Give ONLY the number.
3. Describe the physical condition in detail: note all visible damage, wear, scratches, dents, cracks, and any cosmetic or functional issues. Keep it under 5 sentences.
4. State if this appears to be a smartphone/phone (answer YES or NO).
RESPOND IN THIS EXACT FORMAT (no markdown):
ITEM_TYPE: [type]
BRAND: [brand]
MODEL: [model]
COLOUR: [colour]
ESTIMATED_VALUE: [number only, no symbol]
CONDITION: [detailed condition description]
IS_PHONE: [YES or NO]`;
    const result = await callGeminiAI(settings.geminiApiKey, settings.geminiModel, photos, prompt);
    if (result.error) { setAiError(result.error); }
    else {
      const text = result.text; upd('aiRawResponse', text);
      const parse = (key) => { const m = text.match(new RegExp(`${key}:\\s*(.+?)(?:\\n|$)`, 'i')); return m ? m[1].trim() : ''; };
      upd('aiItemType', parse('ITEM_TYPE')); upd('aiBrand', parse('BRAND')); upd('aiModel', parse('MODEL')); upd('aiColour', parse('COLOUR'));
      upd('aiCondition', parse('CONDITION')); upd('conditionDescription', parse('CONDITION'));
      const val = parse('ESTIMATED_VALUE').replace(/[^0-9]/g, '');
      upd('aiEstimatedValue', val); upd('estimatedValue', Number(val) || 0);
      upd('requiresIMEI', parse('IS_PHONE').toUpperCase().includes('YES'));
    }
    setAiLoading(false);
  };

  const capPct = tx.hasReceipt ? (settings.loanCapWithReceipt || 50) : (settings.loanCapNoReceipt || 40);
  const maxAdvance = Math.floor((tx.estimatedValue || 0) * capPct / 100);
  const dailyFeeCalc = Math.floor((tx.cashAdvance || 0) * (settings.interestRate || 1) / 100);

  const canProceed = () => {
    switch (WIZARD_STEPS[step]?.id) {
      case 'type': return true;
      case 'nin': return tx.ninVerified || tx.idNumber.length > 5;
      case 'customer': return !!(tx.fullName && tx.address && tx.phoneNumbers[0] && tx.familyName && tx.familyPhone && (tx.phonesVerified[0] || tx.phonesVerified[1]));
      case 'custPhotos': return !!tx.photoCustomerHolding;
      case 'itemPhotos': return !!(tx.itemPhotos.front || tx.itemPhotos.back) && (!tx.hasReceipt || !!tx.receiptPhoto);
      case 'aiValuation': return !!(tx.aiItemType && tx.estimatedValue > 0);
      case 'imeiSerial': return tx.requiresIMEI ? (tx.imei && tx.imeiChecked && tx.imeiClean !== null) : true;
      case 'screening': return true;
      case 'offer': return tx.cashAdvance > 0 && tx.dateGiven;
      case 'agreement': return !!tx.photoSigning;
      default: return true;
    }
  };

  const blockReasons = () => {
    const issues = [];
    switch (WIZARD_STEPS[step]?.id) {
      case 'nin':
        if (!(tx.ninVerified || tx.idNumber.length > 5)) issues.push('You must verify the customer\'s ID before proceeding.');
        break;
      case 'customer':
        if (!tx.fullName) issues.push('Full name is required.');
        if (!tx.address) issues.push('Address is required.');
        if (!tx.phoneNumbers[0]) issues.push('Phone 1 is required.');
        if (!tx.familyName) issues.push('Family contact name is required.');
        if (!tx.familyPhone) issues.push('Family contact phone is required.');
        if (!tx.phonesVerified[0] && !tx.phonesVerified[1]) issues.push('You must mark at least one phone number as called before proceeding.');
        break;
      case 'custPhotos':
        if (!tx.photoCustomerHolding) issues.push('You must upload a photo of the customer holding the item before proceeding.');
        break;
      case 'itemPhotos':
        if (!(tx.itemPhotos.front || tx.itemPhotos.back)) issues.push('You must upload at least one item photo (front or back) before proceeding.');
        if (tx.hasReceipt && !tx.receiptPhoto) issues.push('You ticked that a receipt was provided — you must upload a photo of it before proceeding.');
        break;
      case 'aiValuation':
        if (!(tx.aiItemType && tx.estimatedValue > 0)) issues.push('You must run AI Valuation and confirm the item type and value before proceeding.');
        break;
      case 'imeiSerial':
        if (tx.requiresIMEI) {
          if (!tx.imei) issues.push('You must enter the IMEI number before proceeding.');
          if (!tx.imeiChecked) issues.push('You must tick the "Checked on imei.info" checkbox before proceeding.');
          if (tx.imeiClean === null) issues.push('You must select Clean or Flagged after checking the IMEI before proceeding.');
        }
        break;
      case 'offer':
        if (!tx.cashAdvance) issues.push('You must enter the cash advance amount before proceeding.');
        if (!tx.dateGiven) issues.push('You must set the date given before proceeding.');
        break;
      case 'agreement':
        if (!tx.photoSigning) issues.push('You must upload a photo of the signed agreement before proceeding.');
        break;
      default: break;
    }
    return issues;
  };

  const handleComplete = async () => {
    const finalTx = { ...tx, status: tx.type === 'outright' ? 'for_sale' : 'active', wizardStep: null };
    await API.post('transactions', finalTx);
    await API.del(`drafts/${encodeURIComponent(tx.ref)}`);
    onSave(finalTx);
  };

  // Step renderer (abbreviated — same UI as before)
  const renderStep = () => {
    const sid = WIZARD_STEPS[step]?.id;
    switch (sid) {
      case 'type': return (<div><h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '16px' }}>What type of transaction?</h3><div style={S.alert('info')}>📋 Select the transaction type before proceeding. If unsure, choose <strong>Cash Advance</strong>.</div><div style={{ display: 'flex', gap: '16px' }}>{[{ value: 'advance', label: 'Cash Advance', desc: 'Customer leaves item as collateral', icon: '🤝' }, { value: 'outright', label: 'Outright Purchase', desc: 'Customer sells the item immediately', icon: '🛒' }].map(o => (<div key={o.value} onClick={() => upd('type', o.value)} style={{ flex: 1, padding: '20px', borderRadius: '12px', cursor: 'pointer', textAlign: 'center', border: `2px solid ${tx.type === o.value ? COLORS.primary : COLORS.border}`, background: tx.type === o.value ? COLORS.primaryLight : '#fff' }}><div style={{ fontSize: '32px', marginBottom: '8px' }}>{o.icon}</div><div style={{ fontWeight: 700 }}>{o.label}</div><div style={{ fontSize: '12px', color: COLORS.textMuted }}>{o.desc}</div></div>))}</div><div style={{ marginTop: '16px', padding: '12px', background: COLORS.bg, borderRadius: '8px', fontSize: '12px', color: COLORS.textMuted }}><strong>Ref:</strong> {tx.ref}</div></div>);

      case 'nin': return (<div><h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '16px' }}>🪪 Identity Verification</h3><div style={S.alert('info')}>📋 Dial <strong>*346#</strong> on the customer's phone to get their NIN. Type it in and click Verify. If NIN fails, switch to BVN as a backup.</div><div style={S.grid2}><Field label="ID Type" required><select style={S.select} value={tx.idType} onChange={e => upd('idType', e.target.value)}><option value="nin">NIN</option><option value="bvn">BVN</option></select></Field><Field label={`${tx.idType.toUpperCase()} Number`} required><input style={S.input} value={tx.idNumber} onChange={e => upd('idNumber', e.target.value)} placeholder="Enter 11-digit number" /></Field></div>{tx.idType === 'bvn' && <div style={S.alert('warning')}>⚠ BVN does not return home address. You will need to ask the customer manually.</div>}<button style={S.btn('primary')} onClick={handleVerify} disabled={ninLoading || !tx.idNumber}>{ninLoading ? '⏳ Verifying...' : `Verify ${tx.idType.toUpperCase()}`}</button>{ninError && <div style={{ ...S.alert('warning'), marginTop: '12px' }}>⚠ {ninError}</div>}{tx.ninVerified && <div style={{ marginTop: '16px', padding: '16px', background: COLORS.primaryLight, borderRadius: '12px', border: '1px solid #b7e4c7' }}><div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start' }}>{tx.ninPhoto && <img src={tx.ninPhoto} style={{ width: '100px', height: '120px', objectFit: 'cover', borderRadius: '8px', border: '2px solid ' + COLORS.primary }} alt="NIN Photo" />}<div><div style={{ fontSize: '15px', fontWeight: 700, color: COLORS.primary, marginBottom: '4px' }}>✅ {tx.idType.toUpperCase()} Verified</div><div style={{ fontSize: '14px' }}><strong>Name:</strong> {tx.fullName}</div><div style={{ fontSize: '14px' }}><strong>Address:</strong> {tx.address || 'Not available'}</div>{tx.ninPhoto && <div style={{ marginTop: '8px', padding: '8px', background: '#fff', borderRadius: '6px', fontSize: '12px', color: COLORS.warning, fontWeight: 600 }}>👁 Compare this photo with the customer standing in front of you</div>}</div></div></div>}</div>);

      case 'customer': return (<div><h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '16px' }}>👤 Customer Details</h3><div style={S.grid2}><Field label="Full Name" required><input style={S.input} value={tx.fullName} onChange={e => upd('fullName', e.target.value)} placeholder="e.g. David Ejimofor Chukwuemeka" /></Field><Field label="Address" required><input style={S.input} value={tx.address} onChange={e => upd('address', e.target.value)} placeholder="e.g. No. 5 Market Road, Aguleri" /></Field></div><div style={S.alert('info')}>📋 Ask the customer to call out all their phone numbers. <strong>Call at least Phone 1 immediately</strong> — the phone must ring in front of you — then click <strong>Mark Called</strong>. You cannot proceed until this is done.</div><div style={S.grid2}><Field label="Phone 1" required><div style={{ display: 'flex', gap: '8px' }}><input style={{ ...S.input, flex: 1 }} value={tx.phoneNumbers[0]} onChange={e => { const n = [...tx.phoneNumbers]; n[0] = e.target.value; upd('phoneNumbers', n); }} placeholder="e.g. 08012345678" /><button style={{ ...S.btnSm('primary'), background: tx.phonesVerified[0] ? '#10b981' : '#6b7280', transition: 'background 0.2s' }} onClick={() => { const v = [...tx.phonesVerified]; v[0] = !v[0]; upd('phonesVerified', v); }}>{tx.phonesVerified[0] ? '✓ Called' : 'Mark Called'}</button></div></Field><Field label="Phone 2 (optional)"><div style={{ display: 'flex', gap: '8px' }}><input style={{ ...S.input, flex: 1 }} value={tx.phoneNumbers[1]} onChange={e => { const n = [...tx.phoneNumbers]; n[1] = e.target.value; upd('phoneNumbers', n); if (!e.target.value) { const v = [...tx.phonesVerified]; v[1] = false; upd('phonesVerified', v); } }} placeholder="e.g. 09098765432" /><button style={{ ...S.btnSm('primary'), background: tx.phonesVerified[1] ? '#10b981' : '#6b7280', transition: 'background 0.2s', opacity: tx.phoneNumbers[1] ? 1 : 0.4, cursor: tx.phoneNumbers[1] ? 'pointer' : 'not-allowed' }} disabled={!tx.phoneNumbers[1]} onClick={() => { const v = [...tx.phonesVerified]; v[1] = !v[1]; upd('phonesVerified', v); }}>{tx.phonesVerified[1] ? '✓ Called' : 'Mark Called'}</button></div></Field></div><div style={{ ...S.card, background: COLORS.bg, padding: '16px', marginTop: '4px' }}><div style={{ fontSize: '13px', fontWeight: 700, marginBottom: '6px' }}>Family / Neighbour Contact</div><div style={{ fontSize: '12px', color: COLORS.textMuted, marginBottom: '10px' }}>📋 Ask for a family member or neighbour — must be a <strong>different person</strong> from the customer.</div><div style={S.grid3}><Field label="Name" required><input style={S.input} value={tx.familyName} onChange={e => upd('familyName', e.target.value)} placeholder="e.g. Emma Okonkwo" /></Field><Field label="Phone" required><input style={S.input} value={tx.familyPhone} onChange={e => upd('familyPhone', e.target.value)} placeholder="e.g. 08099887766" /></Field><Field label="Relationship"><input style={S.input} value={tx.familyRelation} onChange={e => upd('familyRelation', e.target.value)} placeholder="e.g. Sister" /></Field></div></div></div>);
      
      case 'custPhotos': return (<div><h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '16px' }}>📸 Customer Photos</h3><div style={S.alert('info')}>📋 Take a photo of the customer <strong>holding the item</strong> — both the customer's face and the item must be clearly visible in one photo. <strong>This is mandatory.</strong></div><div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap' }}><PhotoUpload label="Customer Holding Item" value={tx.photoCustomerHolding} onChange={v => upd('photoCustomerHolding', v)} required size={160} /><PhotoUpload label="Customer with ID (Optional)" value={tx.photoCustomerID} onChange={v => upd('photoCustomerID', v)} size={160} /></div></div>);

      case 'itemPhotos': return (<div><h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '16px' }}>🔍 Item Photos</h3><div style={S.alert('info')}>📋 Take photos in <strong>good light near a window</strong>. Front and back are mandatory. Power the item on and take a screenshot of the home/startup screen.</div><div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}><PhotoUpload label="Front" value={tx.itemPhotos.front} onChange={v => updNested('itemPhotos', 'front', v)} required size={110} /><PhotoUpload label="Back" value={tx.itemPhotos.back} onChange={v => updNested('itemPhotos', 'back', v)} required size={110} /><PhotoUpload label="Left Side" value={tx.itemPhotos.left} onChange={v => updNested('itemPhotos', 'left', v)} size={110} /><PhotoUpload label="Right Side" value={tx.itemPhotos.right} onChange={v => updNested('itemPhotos', 'right', v)} size={110} /><PhotoUpload label="Power On Screen" value={tx.itemPhotos.powerOn} onChange={v => updNested('itemPhotos', 'powerOn', v)} size={110} /><PhotoUpload label="About / Nameplate" value={tx.itemPhotos.aboutPage} onChange={v => updNested('itemPhotos', 'aboutPage', v)} size={110} /></div><Field label="Has Original Receipt?" style={{ marginTop: '16px' }}><label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}><input type="checkbox" checked={tx.hasReceipt} onChange={e => upd('hasReceipt', e.target.checked)} style={{ width: '18px', height: '18px' }} /><span>Yes — original purchase receipt provided</span></label></Field>{tx.hasReceipt && <><PhotoUpload label="Receipt Photo" value={tx.receiptPhoto} onChange={v => upd('receiptPhoto', v)} required size={140} />{!tx.receiptPhoto && <div style={{ ...S.alert('danger'), marginTop: '8px' }}>⛔ Receipt photo is required — you ticked that a receipt was provided.</div>}</>}</div>);

      case 'aiValuation': return (<div><h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '16px' }}>🤖 AI Item Valuation</h3><div style={S.alert('info')}>📋 Click <strong>Run AI Valuation</strong> after uploading photos. Wait for the result, then check the figures are reasonable before proceeding. You can edit any field manually if needed.</div><button style={S.btn('primary')} onClick={handleAIValuation} disabled={aiLoading}>{aiLoading ? '⏳ Analyzing...' : '🤖 Run AI Valuation'}</button>{aiError && <div style={{ ...S.alert('danger'), marginTop: '12px' }}>{aiError}</div>}{tx.aiRawResponse && <div style={{ marginTop: '16px', padding: '12px', background: COLORS.bg, borderRadius: '8px', fontSize: '12px', color: COLORS.textMuted, whiteSpace: 'pre-wrap', maxHeight: '120px', overflow: 'auto' }}><strong>Raw AI:</strong><br />{tx.aiRawResponse}</div>}<div style={{ ...S.grid2, marginTop: '16px' }}><Field label="Item Type" required><input style={S.input} value={tx.aiItemType} onChange={e => upd('aiItemType', e.target.value)} placeholder="e.g. Smartphone" /></Field><Field label="Brand" required><input style={S.input} value={tx.aiBrand} onChange={e => upd('aiBrand', e.target.value)} placeholder="e.g. Samsung" /></Field><Field label="Model" required><input style={S.input} value={tx.aiModel} onChange={e => upd('aiModel', e.target.value)} placeholder="e.g. Galaxy A14" /></Field><Field label="Colour"><input style={S.input} value={tx.aiColour} onChange={e => upd('aiColour', e.target.value)} placeholder="e.g. Black" /></Field></div><Field label="Estimated Resale Value (₦)" required><input style={{ ...S.input, fontSize: '18px', fontWeight: 700 }} type="number" value={tx.estimatedValue || tx.aiEstimatedValue} onChange={e => upd('estimatedValue', Number(e.target.value))} placeholder="e.g. 85000" /></Field><Field label="Condition Description" required><textarea style={S.textarea} value={tx.conditionDescription || tx.aiCondition} onChange={e => upd('conditionDescription', e.target.value)} placeholder="AI-generated condition + your own observations" /></Field>{tx.requiresIMEI && <div style={S.alert('warning')}>📱 Phone detected — IMEI check required next.</div>}</div>);

      case 'imeiSerial': return (<div><h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '16px' }}>🔢 IMEI / Serial Number</h3>{tx.requiresIMEI ? (<><div style={S.alert('info')}>📋 Dial <strong>*#06#</strong> on the phone to get the IMEI. Write it down, then open <strong>imei.info</strong> to check it is not stolen. You must tick the checkbox and select <strong>Clean or Flagged</strong> before proceeding.</div><div style={S.alert('warning')}>📱 This item was identified as a phone — IMEI check is required.</div><Field label="IMEI Number" required><input style={S.input} value={tx.imei} onChange={e => upd('imei', e.target.value)} placeholder="15-digit IMEI" /></Field><div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '16px' }}><label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}><input type="checkbox" checked={tx.imeiChecked} onChange={e => { upd('imeiChecked', e.target.checked); if (!e.target.checked) upd('imeiClean', null); }} style={{ width: '18px', height: '18px' }} /><span style={{ fontSize: '13px' }}>Checked on imei.info</span></label><a href="https://www.imei.info/" target="_blank" rel="noopener noreferrer" style={{ fontSize: '12px', color: COLORS.primary }}>Open imei.info →</a></div>{tx.imeiChecked && <Field label="IMEI Status — select one *"><div style={{ display: 'flex', gap: '16px' }}><label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', padding: '10px 16px', borderRadius: '8px', border: `2px solid ${tx.imeiClean === true ? '#10b981' : COLORS.border}`, background: tx.imeiClean === true ? '#ecfdf5' : '#fff' }}><input type="radio" checked={tx.imeiClean === true} onChange={() => upd('imeiClean', true)} /><span style={{ color: '#10b981', fontWeight: 700 }}>✓ Clean</span></label><label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', padding: '10px 16px', borderRadius: '8px', border: `2px solid ${tx.imeiClean === false ? COLORS.danger : COLORS.border}`, background: tx.imeiClean === false ? COLORS.dangerLight : '#fff' }}><input type="radio" checked={tx.imeiClean === false} onChange={() => upd('imeiClean', false)} /><span style={{ color: COLORS.danger, fontWeight: 700 }}>✗ Flagged — DECLINE</span></label></div></Field>}{tx.imeiChecked && tx.imeiClean === null && <div style={S.alert('warning')}>⚠ You must select Clean or Flagged to continue.</div>}{tx.imeiClean === false && tx.imeiChecked && <div style={S.alert('danger')}>🚫 IMEI flagged. <strong>DECLINE IMMEDIATELY.</strong></div>}</>) : (<><div style={S.alert('info')}>📋 Check the back panel or sticker for a serial number. If none is found, you may leave it blank and proceed.</div><Field label="Serial Number"><input style={S.input} value={tx.serialNumber} onChange={e => upd('serialNumber', e.target.value)} placeholder="Check back panel" /></Field></>)}</div>);

      case 'screening': return (<div><h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '16px' }}>❓ Screening Questions</h3><div style={S.alert('info')}>📋 Ask these questions calmly. Write down the answers <strong>exactly as the customer gives them</strong>. If anything feels wrong, tick the Red Flag box and do not proceed with the transaction.</div><Field label="How long have you had this item?"><input style={S.input} value={tx.screeningDuration} onChange={e => upd('screeningDuration', e.target.value)} placeholder="e.g. 2 years" /></Field><Field label="Where did you buy it?"><input style={S.input} value={tx.screeningPurchaseLocation} onChange={e => upd('screeningPurchaseLocation', e.target.value)} placeholder="e.g. Computer Village, Lagos" /></Field><Field label="Is this item registered in your name?"><input style={S.input} value={tx.screeningRegistered} onChange={e => upd('screeningRegistered', e.target.value)} placeholder="Yes / No / N/A" /></Field><Field label="Has anyone else used this item with you?"><input style={S.input} value={tx.screeningOthersUsing} onChange={e => upd('screeningOthersUsing', e.target.value)} placeholder="e.g. No, only me" /></Field><div style={{ marginTop: '12px', padding: '16px', background: COLORS.dangerLight, borderRadius: '8px', border: '1px solid #f5c6cb' }}><label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}><input type="checkbox" checked={tx.screeningRedFlag} onChange={e => upd('screeningRedFlag', e.target.checked)} style={{ width: '20px', height: '20px' }} /><span style={{ fontSize: '14px', fontWeight: 700, color: COLORS.danger }}>🚩 RED FLAG — Something feels wrong (decline this customer)</span></label></div><Field label="Notes / Observations" style={{ marginTop: '12px' }}><textarea style={S.textarea} value={tx.notes} onChange={e => upd('notes', e.target.value)} placeholder="Any additional notes about this customer or transaction..." /></Field></div>);

      case 'offer': return (<div><h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '16px' }}>💰 {tx.type === 'outright' ? 'Purchase Offer' : 'Cash Advance Offer'}</h3><div style={S.alert('info')}>📋 The maximum advance is calculated automatically. <strong>Do not exceed it.</strong> Enter the amount agreed with the customer, then set today's date.</div><div style={{ ...S.card, background: COLORS.primaryLight, border: `2px solid ${COLORS.primary}`, padding: '20px' }}><div style={S.grid3}><div><div style={S.statLabel}>Resale Value</div><div style={{ fontSize: '22px', fontWeight: 800, color: COLORS.primary }}>{fmtMoney(tx.estimatedValue)}</div></div><div><div style={S.statLabel}>Max ({capPct}%)</div><div style={{ fontSize: '22px', fontWeight: 800, color: COLORS.accent }}>{fmtMoney(maxAdvance)}</div></div><div><div style={S.statLabel}>Daily Fee ({settings.interestRate}%)</div><div style={{ fontSize: '22px', fontWeight: 800, color: COLORS.warning }}>{fmtMoney(dailyFeeCalc)}/day</div></div></div></div><div style={S.grid2}><Field label={tx.type === 'outright' ? 'Purchase Amount (₦)' : 'Cash Advance (₦)'} required><input style={{ ...S.input, fontSize: '18px', fontWeight: 700 }} type="number" value={tx.cashAdvance === 0 ? '' : tx.cashAdvance} onChange={e => { const raw = e.target.value; const val = raw === '' ? 0 : Number(raw); const v = Math.min(val, maxAdvance); upd('cashAdvance', v); upd('dailyFee', Math.floor(v * (settings.interestRate || 1) / 100)); }} max={maxAdvance} /></Field><Field label="Date Given" required><input style={S.input} type="date" value={tx.dateGiven} onClick={e => e.target.showPicker && e.target.showPicker()} onChange={e => { upd('dateGiven', e.target.value); if (e.target.value) { const d = new Date(e.target.value); d.setDate(d.getDate() + (Number(tx.loanDays) || 30)); upd('deadlineDate', d.toISOString().split('T')[0]); } }} /></Field></div>{tx.type === 'advance' && <div style={S.grid2}><Field label="Loan Days"><input style={S.input} type="number" min={1} max={maxLoanDays} value={tx.loanDays === '' ? '' : tx.loanDays} onChange={e => { const raw = e.target.value; const val = raw === '' ? '' : Number(raw); const v = raw === '' ? '' : Math.min(Math.max(val, 1), maxLoanDays); upd('loanDays', v); if (tx.dateGiven && raw !== '') { const d = new Date(tx.dateGiven); d.setDate(d.getDate() + Number(v)); upd('deadlineDate', d.toISOString().split('T')[0]); } }} /></Field><Field label="Deadline"><input style={S.input} type="date" value={tx.deadlineDate} readOnly /></Field></div>}<div style={{ padding: '12px', background: COLORS.accentLight, borderRadius: '8px', fontSize: '13px', marginTop: '4px' }}><strong>Service Fee:</strong> {fmtMoney(settings.serviceFee)} to collect.</div></div>);

      case 'agreement': return (<div><h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '16px' }}>📄 Agreement Preview</h3><div style={S.alert('info')}>📋 Click <strong>Print</strong> to print both copies. Read every clause aloud to the customer. After both copies are signed and thumbprinted, take a photo of the signing and upload it here before proceeding.</div><div style={{ border: `2px solid ${COLORS.border}`, borderRadius: '12px', padding: '20px', background: '#fff' }}><div style={{ textAlign: 'center', marginBottom: '16px' }}><div style={{ fontSize: '16px', fontWeight: 800 }}>CHRIST-IN-FABIAN QUICK CASH</div><div style={{ fontSize: '12px', color: COLORS.textMuted }}>Cash Advance & Buy-Back Agreement — BUSINESS COPY</div><div style={{ fontSize: '13px', fontWeight: 700, marginTop: '4px' }}>Ref: {tx.ref}</div></div><div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '4px 12px', fontSize: '13px' }}><strong>Name:</strong><span>{tx.fullName}</span><strong>Address:</strong><span>{tx.address}</span><strong>ID:</strong><span>{tx.idType.toUpperCase()} — {tx.idNumber}</span><strong>Phone(s):</strong><span>{tx.phoneNumbers.filter(Boolean).join(', ')}</span><strong>Family:</strong><span>{tx.familyName} ({tx.familyRelation}) — {tx.familyPhone}</span><strong>Item:</strong><span>{tx.aiItemType} / {tx.aiBrand} / {tx.aiModel}</span><strong>Condition:</strong><span>{tx.conditionDescription}</span>{tx.imei && <><strong>IMEI:</strong><span>{tx.imei}</span></>}<strong>Cash:</strong><span style={{ fontWeight: 700, color: COLORS.primary }}>{fmtMoney(tx.cashAdvance)}</span>{tx.type === 'advance' && <><strong>Date Given:</strong><span>{fmtDate(tx.dateGiven)}</span><strong>Deadline:</strong><span>{fmtDate(tx.deadlineDate)}</span><strong>Daily Fee:</strong><span>{fmtMoney(dailyFeeCalc)}/day</span></>}</div></div><button style={{ ...S.btn('accent'), marginTop: '16px' }} onClick={() => window.print()}>🖨 Print Agreement</button><div style={{ marginTop: '16px' }}><PhotoUpload label="Photo of Signing / Thumbprint" value={tx.photoSigning} onChange={v => upd('photoSigning', v)} required size={140} /></div></div>);

      case 'complete': return (<div><h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '16px' }}>✅ Finalize</h3><div style={S.alert('info')}>📋 Tick the service fee checkbox <strong>only after you have physically collected ₦{settings.serviceFee?.toLocaleString() || '1,000'}</strong> from the customer. Then count the cash advance in front of the customer, let them count it too, and click Complete.</div>{tx.type === 'advance' && <PhotoUpload label="Sealed Package Photo" value={tx.photoSealedPkg} onChange={v => upd('photoSealedPkg', v)} size={140} />}<label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', padding: '12px', background: COLORS.accentLight, borderRadius: '8px', marginTop: '12px' }}><input type="checkbox" checked={tx.serviceFeeCollected} onChange={e => upd('serviceFeeCollected', e.target.checked)} style={{ width: '20px', height: '20px' }} /><span style={{ fontSize: '14px', fontWeight: 600 }}>₦{settings.serviceFee} service fee collected <span style={{ color: COLORS.danger }}>*</span></span></label><div style={{ ...S.card, background: COLORS.primaryLight, border: `2px solid ${COLORS.primary}`, textAlign: 'center', marginTop: '12px' }}><div style={{ fontSize: '14px', fontWeight: 600, marginBottom: '8px' }}>Cash {tx.type === 'outright' ? 'Paid' : 'Advance Given'}</div><div style={{ fontSize: '32px', fontWeight: 800, color: COLORS.primary }}>{fmtMoney(tx.cashAdvance)}</div><div style={{ fontSize: '12px', color: COLORS.textMuted, marginTop: '4px' }}>Count in front of customer. Let them count too.</div></div><button style={{ ...S.btn('primary'), padding: '16px', fontSize: '16px', justifyContent: 'center', width: '100%', marginTop: '12px', opacity: !tx.serviceFeeCollected ? 0.5 : 1 }} disabled={!tx.serviceFeeCollected} onClick={handleComplete}>{!tx.serviceFeeCollected ? '⚠ Tick Service Fee to Complete' : '✅ Complete Transaction — Save to Database'}</button></div>);

      default: return <div>Unknown step</div>;
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: '6px', flexWrap: isMobile ? 'nowrap' : 'wrap', overflowX: isMobile ? 'auto' : 'visible', WebkitOverflowScrolling: 'touch', scrollbarWidth: 'none', marginBottom: '20px', padding: '12px', background: '#fff', borderRadius: '12px', border: `1px solid ${COLORS.border}` }}>
        {WIZARD_STEPS.map((s, i) => (<div key={s.id} style={{ ...S.wizStep(i === step, i < step), flexShrink: 0 }} onClick={() => i < step && setStep(i)}>{s.icon} {isMobile ? '' : s.label.split('. ')[1] || s.label}</div>))}
      </div>
      <div style={S.card}>{renderStep()}</div>
      <div style={{ marginTop: '12px' }}>
        {step < WIZARD_STEPS.length - 1 && !canProceed() && blockReasons().length > 0 && (
          <div style={{ ...S.alert('danger'), marginBottom: '8px' }}>
            {blockReasons().map((r, i) => <div key={i}>⛔ {r}</div>)}
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: '8px' }}>
            {step > 0 && <button style={S.btn('outline')} onClick={() => setStep(step - 1)}>← Back</button>}
            <button style={S.btn('muted')} onClick={onCancel}>Save Draft & Exit</button>
          </div>
          {step < WIZARD_STEPS.length - 1 && <button style={S.btn('primary')} onClick={() => setStep(step + 1)} disabled={!canProceed()}>Next Step →</button>}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// REPAYMENT & SALE MODALS
// ============================================================
function RepaymentModal({ tx, settings, onClose, onSave }) {
  const days = daysBetween(tx.dateGiven);
  const dailyFee = Math.floor((tx.cashAdvance || 0) * (settings.interestRate || 1) / 100);
  const totalFees = days * dailyFee;
  const totalDue = (tx.cashAdvance || 0) + totalFees;
  const [confirmed, setConfirmed] = useState(false);
  return (
    <div>
      <div style={{ ...S.card, background: COLORS.bg }}><div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}><div><span style={S.statLabel}>Customer</span><br /><strong>{tx.fullName}</strong></div><div><span style={S.statLabel}>Item</span><br /><strong>{tx.aiItemType} {tx.aiBrand} {tx.aiModel}</strong></div><div><span style={S.statLabel}>Advance</span><br /><strong style={{ fontSize: '18px' }}>{fmtMoney(tx.cashAdvance)}</strong></div><div><span style={S.statLabel}>Days</span><br /><strong style={{ fontSize: '18px' }}>{days} days × {fmtMoney(dailyFee)} = {fmtMoney(totalFees)}</strong></div></div></div>
      <div style={{ ...S.card, background: COLORS.primaryLight, border: `2px solid ${COLORS.primary}`, textAlign: 'center' }}><div style={S.statLabel}>Total Due</div><div style={{ fontSize: '32px', fontWeight: 800, color: COLORS.primary }}>{fmtMoney(totalDue)}</div></div>
      <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', marginBottom: '16px' }}><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} style={{ width: '20px', height: '20px' }} /><span style={{ fontWeight: 600 }}>Customer paid {fmtMoney(totalDue)} and item returned</span></label>
      <div style={{ display: 'flex', gap: '12px' }}><button style={S.btn('primary')} disabled={!confirmed} onClick={() => onSave({ ...tx, status: 'closed', amountRepaid: totalDue, dateRepaid: new Date().toISOString().split('T')[0], daysCharged: days, totalFees, itemReturned: true })}>✅ Confirm</button><button style={S.btn('outline')} onClick={onClose}>Cancel</button></div>
    </div>
  );
}

function SaleModal({ tx, settings, onClose, onSave }) {
  const dailyFee = Math.floor((tx.cashAdvance || 0) * (settings.interestRate || 1) / 100);
  const minPrice = (tx.cashAdvance || 0) + 33 * dailyFee + Math.floor((tx.cashAdvance || 0) * (settings.minSellBonus || 20) / 100);
  const targetPrice = Math.floor((tx.estimatedValue || 0) * (settings.targetSellPct || 75) / 100);
  const listedPrice = Math.max(targetPrice, minPrice);
  const [salePrice, setSalePrice] = useState(listedPrice);
  const [saleDate, setSaleDate] = useState(new Date().toISOString().split('T')[0]);
  const [saleBuyer, setSaleBuyer] = useState('');
  return (
    <div>
      <div style={S.grid3}><div style={S.stat}><div style={S.statLabel}>Minimum</div><div style={{ ...S.statValue, color: COLORS.danger }}>{fmtMoney(minPrice)}</div></div><div style={S.stat}><div style={S.statLabel}>Target (75%)</div><div style={S.statValue}>{fmtMoney(targetPrice)}</div></div><div style={S.stat}><div style={S.statLabel}>Listed</div><div style={{ ...S.statValue, color: COLORS.accent }}>{fmtMoney(listedPrice)}</div></div></div>
      <Field label="Sale Price (₦)" required style={{ marginTop: '16px' }}><input style={{ ...S.input, fontSize: '18px', fontWeight: 700 }} type="number" value={salePrice} onChange={e => setSalePrice(Number(e.target.value))} />{salePrice < minPrice && <div style={{ color: COLORS.danger, fontSize: '12px', marginTop: '4px' }}>⚠ Below minimum</div>}</Field>
      <div style={S.grid2}><Field label="Sale Date"><input style={S.input} type="date" value={saleDate} onChange={e => setSaleDate(e.target.value)} /></Field><Field label="Buyer"><input style={S.input} value={saleBuyer} onChange={e => setSaleBuyer(e.target.value)} /></Field></div>
      <div style={{ ...S.card, background: COLORS.primaryLight, textAlign: 'center', marginTop: '8px' }}><div style={S.statLabel}>Profit</div><div style={{ fontSize: '28px', fontWeight: 800, color: salePrice - tx.cashAdvance > 0 ? COLORS.primary : COLORS.danger }}>{fmtMoney(salePrice - tx.cashAdvance)}</div></div>
      <div style={{ display: 'flex', gap: '12px', marginTop: '16px' }}><button style={S.btn('primary')} onClick={() => onSave({ ...tx, status: 'sold', salePrice, saleDate, saleBuyer })} disabled={salePrice < minPrice}>Record Sale</button><button style={S.btn('outline')} onClick={onClose}>Cancel</button></div>
    </div>
  );
}

// ============================================================
// MAIN APPLICATION
// ============================================================
export default function App() {
  const [currentUser, setCurrentUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [publicScreen, setPublicScreen] = useState('landing'); // 'landing' | 'portal' | 'login'
  const [page, setPage] = useState('dashboard');
  const [transactions, setTransactions] = useState([]);
  const [drafts, setDrafts] = useState([]);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [users, setUsers] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [capital, setCapital] = useState([]);
  const [declinedLog, setDeclinedLog] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingTx, setEditingTx] = useState(null);
  const [viewingTx, setViewingTx] = useState(null);
  const [repayingTx, setRepayingTx] = useState(null);
  const [sellingTx, setSellingTx] = useState(null);
  const [showAddExpense, setShowAddExpense] = useState(false);
  const [showAddCapital, setShowAddCapital] = useState(false);
  const [showAddDeclined, setShowAddDeclined] = useState(false);
  const [showAddUser, setShowAddUser] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [dbStatus, setDbStatus] = useState('checking');
  const isMobile = useMobile();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [zoomedPhoto, setZoomedPhoto] = useState(null);

  useEffect(() => {
    const restoreSession = async () => {
      // Load public settings for landing page before auth check
      const pubData = await API.get('bootstrap?scope=critical');
      if (pubData?.settings) setSettings({ ...DEFAULT_SETTINGS, ...pubData.settings });
      const me = await API.get('me');
      if (me?.id) setCurrentUser(me);
      setAuthLoading(false);
    };
    restoreSession();
  }, []);

  // Load critical data first using a bundled bootstrap endpoint.
  const loadData = async () => {
    setLoading(true);

    const critical = await API.get('bootstrap?scope=critical');
    if (critical) {
      setSettings({ ...DEFAULT_SETTINGS, ...(critical.settings || {}) });
      setTransactions(critical.transactions || []);
      setDrafts(critical.drafts || []);
      setDbStatus('connected');
    } else {
      setDbStatus('error');
    }

    setLoading(false);

    // Load secondary datasets in one background request.
    const role = currentUser?.role || '';
    const secondary = await API.get(`bootstrap?scope=secondary&role=${encodeURIComponent(role)}`);
    if (secondary) {
      setExpenses(secondary.expenses || []);
      setCapital(secondary.capital || []);
      setDeclinedLog(secondary.declined || []);
      setUsers(secondary.users || []);
    }
  };

  useEffect(() => { if (currentUser) loadData(); }, [currentUser]);

  // Save helpers
  const saveSettings = async (s) => { setSettings(s); await API.put('settings', s); };
  const saveTx = async (tx) => {
    await API.post('transactions', tx);
    setTransactions(prev => { const i = prev.findIndex(t => t.ref === tx.ref); if (i >= 0) { const n = [...prev]; n[i] = tx; return n; } return [...prev, tx]; });
  };

  // Computed stats
  const activeTxs = transactions.filter(t => t.status === 'active');
  const closedTxs = transactions.filter(t => t.status === 'closed');
  const soldTxs = transactions.filter(t => t.status === 'sold');
  const forSaleTxs = transactions.filter(t => t.status === 'for_sale');
  const pastDeadline = activeTxs.filter(t => daysBetween(t.dateGiven) > (t.loanDays || 30));
  const totalCapitalOut = activeTxs.reduce((s, t) => s + (t.cashAdvance || 0), 0);
  const totalInterestEarned = closedTxs.reduce((s, t) => s + (t.totalFees || 0), 0);
  const totalSalesRevenue = soldTxs.reduce((s, t) => s + (t.salePrice || 0), 0);
  const totalServiceFees = transactions.filter(t => t.status !== 'declined').length * (settings.serviceFee || 1000);
  const totalRevenue = totalInterestEarned + totalSalesRevenue + totalServiceFees;
  const totalExpenses = expenses.reduce((s, e) => s + (e.amount || 0), 0);
  const netProfit = totalRevenue - totalExpenses;
  const totalCapital = capital.reduce((s, c) => s + (c.amount || 0), 0);
  const availableLendingCapital = totalCapital - totalCapitalOut + Math.min(netProfit, 0);

  const filteredTxs = useMemo(() => {
    if (!searchQuery) return transactions;
    const q = searchQuery.toLowerCase();
    return transactions.filter(t => t.ref?.toLowerCase().includes(q) || t.fullName?.toLowerCase().includes(q) || t.phoneNumbers?.some(p => p?.includes(q)) || t.imei?.includes(q) || t.aiBrand?.toLowerCase().includes(q));
  }, [transactions, searchQuery]);

  if (authLoading) return <div style={{ ...S.app, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><div style={{ textAlign: 'center' }}><div style={{ fontSize: '48px', marginBottom: '12px' }}>🔐</div><div style={{ fontWeight: 700 }}>Checking session...</div></div></div>;

  if (!currentUser) {
    if (publicScreen === 'portal') return <CustomerPortal settings={settings} onBack={() => setPublicScreen('landing')} />;
    if (publicScreen === 'login') return <LoginScreen onLogin={(u) => { setCurrentUser(u); setPublicScreen('landing'); }} />;
    return <LandingPage settings={settings} onCheckLoan={() => setPublicScreen('portal')} onStaffLogin={() => setPublicScreen('login')} />;
  }

  if (loading) return <div style={{ ...S.app, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><div style={{ textAlign: 'center' }}><div style={{ fontSize: '48px', marginBottom: '12px' }}>💰</div><div style={{ fontWeight: 700 }}>Loading from database...</div></div></div>;

  if (editingTx !== null) return (
    <div style={S.app}>
      <div style={{ ...S.topBar, padding: isMobile ? '0 12px' : '0 24px' }}>
        <div style={{ fontWeight: 700, fontSize: isMobile ? '13px' : '15px' }}>💰 {isMobile ? 'New Transaction' : 'CIF Quick Cash — New Transaction'}</div>
        <button style={S.btnSm('danger')} onClick={() => { setEditingTx(null); setPage('dashboard'); }}>✕ {isMobile ? '' : 'Exit'}</button>
      </div>
      <div style={{ padding: isMobile ? '12px' : '20px', maxWidth: '900px', margin: '0 auto' }}>
        <TransactionWizard settings={settings} draft={editingTx === 'new' ? null : editingTx} currentUser={currentUser} onSave={(tx) => { saveTx(tx); setEditingTx(null); loadData(); setPage('dashboard'); }} onCancel={() => { setEditingTx(null); setPage('dashboard'); }} />
      </div>
    </div>
  );

  const isStaff = currentUser.role === 'staff' || currentUser.role === 'admin';
  const isAdmin = currentUser.role === 'admin';

  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: '📊', roles: ['staff', 'admin', 'stakeholder'] },
    { id: 'newTx', label: 'New Transaction', icon: '➕', roles: ['staff', 'admin'] },
    { id: 'transactions', label: 'All Transactions', icon: '📋', roles: ['staff', 'admin', 'stakeholder'] },
    { id: 'active', label: 'Active Loans', icon: '⏳', roles: ['staff', 'admin', 'stakeholder'] },
    { id: 'deadlines', label: 'Deadlines & Alerts', icon: '🔔', roles: ['staff', 'admin'] },
    { id: 'forSale', label: 'For Sale', icon: '🏷', roles: ['staff', 'admin', 'stakeholder'] },
    { id: 'reports', label: 'Monthly Report', icon: '📈', roles: ['admin', 'stakeholder'] },
    { id: 'capital', label: 'Capital & Profits', icon: '💎', roles: ['admin', 'stakeholder'] },
    { id: 'expenses', label: 'Expenses', icon: '🧾', roles: ['staff', 'admin'] },
    { id: 'declined', label: 'Declined Log', icon: '🚫', roles: ['staff', 'admin'] },
    { id: 'settings', label: 'Settings', icon: '⚙', roles: ['admin'] },
    { id: 'users', label: 'Users', icon: '👥', roles: ['admin'] },
  ].filter(n => n.roles.includes(currentUser.role));

  // Render transaction detail
  const TxDetail = ({ tx }) => (<div>
    <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}><span style={S.badge(statusColor(tx))}>{statusLabel(tx)}</span><span style={S.badge('#6b7280')}>{tx.type === 'outright' ? 'Outright' : 'Advance'}</span><span style={S.badge(COLORS.primary)}>Ref: {tx.ref}</span></div>
    <div style={S.grid2}>
      <div style={S.card}><div style={S.cardTitle}>👤 Customer</div><div style={{ fontSize: '13px' }}><strong>{tx.fullName}</strong><br />{tx.address}<br />📱 {tx.phoneNumbers?.filter(Boolean).join(', ')}<br />👨‍👩‍👧 {tx.familyName} ({tx.familyRelation}) — {tx.familyPhone}<br />🪪 {tx.idType?.toUpperCase()} — {tx.idNumber}</div></div>
      <div style={S.card}><div style={S.cardTitle}>📦 Item</div><div style={{ fontSize: '13px' }}><strong>{tx.aiItemType} {tx.aiBrand} {tx.aiModel}</strong><br />Colour: {tx.aiColour}{tx.imei && <><br />IMEI: {tx.imei}</>}{tx.serialNumber && <><br />Serial: {tx.serialNumber}</>}<br />{tx.conditionDescription}</div></div>
    </div>
    <div style={S.card}><div style={S.cardTitle}>💰 Financials</div><div style={S.grid4}>
      <div style={S.stat}><div style={S.statLabel}>Value</div><div style={S.statValue}>{fmtMoney(tx.estimatedValue)}</div></div>
      <div style={S.stat}><div style={S.statLabel}>Cash Given</div><div style={S.statValue}>{fmtMoney(tx.cashAdvance)}</div></div>
      {tx.type === 'advance' && <><div style={S.stat}><div style={S.statLabel}>Days</div><div style={S.statValue}>{daysBetween(tx.dateGiven)}d</div></div><div style={S.stat}><div style={S.statLabel}>Due Today</div><div style={{ ...S.statValue, color: COLORS.danger }}>{fmtMoney(tx.cashAdvance + daysBetween(tx.dateGiven) * Math.floor((tx.cashAdvance || 0) * (settings.interestRate || 1) / 100))}</div></div></>}
    </div>
    {tx.status === 'closed' && <div style={{ marginTop: '12px', padding: '12px', background: COLORS.primaryLight, borderRadius: '8px' }}>Repaid: {fmtMoney(tx.amountRepaid)} on {fmtDate(tx.dateRepaid)}</div>}
    {tx.status === 'sold' && <div style={{ marginTop: '12px', padding: '12px', background: COLORS.accentLight, borderRadius: '8px' }}>Sold: {fmtMoney(tx.salePrice)} on {fmtDate(tx.saleDate)} — Profit: {fmtMoney(tx.salePrice - tx.cashAdvance)}</div>}
    </div>
    <div style={S.card}>
      <div style={S.cardTitle}>📸 Photos</div>
      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
        {[tx.photoCustomerHolding, tx.photoCustomerID, tx.itemPhotos?.front, tx.itemPhotos?.back, tx.photoSigning, tx.photoSealedPkg]
          .filter(Boolean)
          .map((p, i) => (
            <button
              key={i}
              onClick={() => setZoomedPhoto(p)}
              style={{
                border: 'none',
                padding: 0,
                background: 'transparent',
                cursor: 'zoom-in',
                borderRadius: '8px',
                overflow: 'hidden'
              }}
              title="Tap to view full image"
            >
              <img src={p} alt={`Transaction photo ${i + 1}`} style={{ width: '100px', height: '100px', borderRadius: '8px', objectFit: 'cover', display: 'block' }} />
            </button>
          ))}
      </div>
      <div style={{ marginTop: '8px', fontSize: '12px', color: COLORS.textMuted }}>Tap any photo to zoom and download.</div>
    </div>
    <button style={S.btn('outline')} onClick={() => setViewingTx(null)}>← Back</button>
  </div>);

  const PhotoViewer = () => {
    if (!zoomedPhoto) return null;
    return (
      <div
        onClick={() => setZoomedPhoto(null)}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0, 0, 0, 0.85)',
          zIndex: 1000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px'
        }}
      >
        <div onClick={e => e.stopPropagation()} style={{ maxWidth: '100%', maxHeight: '100%', textAlign: 'center' }}>
          <img src={zoomedPhoto} alt="Zoomed transaction" style={{ maxWidth: '100%', maxHeight: '80vh', borderRadius: '12px' }} />
          <div style={{ display: 'flex', justifyContent: 'center', gap: '12px', marginTop: '16px', flexWrap: 'wrap' }}>
            <a href={zoomedPhoto} download={`transaction-photo-${Date.now()}.jpg`} style={{ ...S.btn('primary'), textDecoration: 'none' }}>⬇ Download</a>
            <button style={S.btn('outline')} onClick={() => setZoomedPhoto(null)}>✕ Close</button>
          </div>
        </div>
      </div>
    );
  };

  // Main page renderer
  const renderPage = () => {
    if (viewingTx) return <TxDetail tx={viewingTx} />;

    const TxTable = ({ items, showActions = true }) => (<table style={S.table}><thead><tr><th style={S.th}>Ref</th><th style={S.th}>Customer</th><th style={S.th}>Item</th><th style={S.th}>Amount</th><th style={S.th}>Date</th><th style={S.th}>Status</th>{showActions && <th style={S.th}>Actions</th>}</tr></thead><tbody>{items.map(tx => (<tr key={tx.ref}><td style={S.td}><strong>{tx.ref}</strong></td><td style={S.td}>{tx.fullName}</td><td style={S.td}>{tx.aiBrand} {tx.aiModel}</td><td style={S.td}>{fmtMoney(tx.cashAdvance)}</td><td style={S.td}>{fmtDate(tx.dateGiven)}</td><td style={S.td}><span style={S.badge(statusColor(tx))}>{statusLabel(tx)}</span></td>{showActions && <td style={S.td}><div style={{ display: 'flex', gap: '4px' }}><button style={S.btnSm('primary')} onClick={() => setViewingTx(tx)}>View</button>{tx.status === 'active' && isStaff && <button style={S.btnSm('accent')} onClick={() => setRepayingTx(tx)}>Collect</button>}{(tx.status === 'for_sale' || (tx.status === 'active' && daysBetween(tx.dateGiven) > (tx.loanDays || 30) + 3)) && isStaff && <button style={S.btnSm('danger')} onClick={() => setSellingTx(tx)}>Sell</button>}</div></td>}</tr>))}{items.length === 0 && <tr><td style={S.td} colSpan={7}>No records.</td></tr>}</tbody></table>);

    switch (page) {
      case 'dashboard': return (<div>
        <h2 style={{ fontSize: '20px', fontWeight: 800, marginBottom: '20px', color: COLORS.primaryDark }}>📊 Dashboard</h2>
        <div style={S.grid4}>
          <div style={S.stat}><div style={S.statLabel}>Available Lending Capital</div><div style={S.statValue}>{fmtMoney(availableLendingCapital)}</div></div>
          <div style={S.stat}><div style={S.statLabel}>Capital Out</div><div style={S.statValue}>{fmtMoney(totalCapitalOut)}</div></div>
          <div style={S.stat}><div style={S.statLabel}>Active Loans</div><div style={S.statValue}>{activeTxs.length}</div></div>
          <div style={S.stat}><div style={S.statLabel}>Revenue</div><div style={S.statValue}>{fmtMoney(totalRevenue)}</div></div>
          <div style={{ ...S.stat, background: pastDeadline.length > 0 ? COLORS.dangerLight : COLORS.primaryLight }}><div style={S.statLabel}>Past Deadline</div><div style={{ ...S.statValue, color: pastDeadline.length > 0 ? COLORS.danger : COLORS.primary }}>{pastDeadline.length}</div></div>
        </div>
        <div style={{ ...S.card, marginBottom: '12px' }}><div style={{ fontSize: '12px', color: dbStatus === 'connected' ? '#10b981' : COLORS.danger, fontWeight: 600 }}>● Database: {dbStatus === 'connected' ? 'Connected to Neon PostgreSQL' : 'Connection error'}</div></div>
        <div style={S.card}><div style={S.cardTitle}>Recent Transactions</div><TxTable items={transactions.slice(0, 10)} /></div>
        {drafts.length > 0 && isStaff && <div style={S.card}><div style={S.cardTitle}>📝 In-Progress Drafts</div>{drafts.slice().sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0)).map(d => (<div key={d.ref} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px', borderBottom: `1px solid ${COLORS.border}` }}><div><strong>{d.ref}</strong> — {d.fullName || 'No name yet'} — Step {(d.wizardStep || 0) + 1}<br/><span style={{ fontSize: '12px', color: COLORS.textMuted }}>Created: {d.createdAt ? new Date(d.createdAt).toLocaleString() : 'Unknown'}</span></div><div style={{ display: 'flex', gap: '8px' }}><button style={S.btnSm('accent')} onClick={() => setEditingTx(d)}>Resume</button><button style={S.btnSm('danger')} onClick={async () => { if(window.confirm('Are you sure you want to delete this draft?')) { await API.del(`drafts/${encodeURIComponent(d.ref)}`); loadData(); } }}>Delete</button></div></div>))}</div>}
      </div>);

      case 'newTx': setEditingTx('new'); return null;

      case 'transactions': return (<div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}><h2 style={{ fontSize: '20px', fontWeight: 800, color: COLORS.primaryDark, margin: 0 }}>📋 All Transactions</h2><input style={{ ...S.input, flex: '1 1 180px', maxWidth: '300px' }} placeholder="🔍 Search..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} /></div>
        <div style={S.card}><TxTable items={searchQuery ? filteredTxs : transactions} /></div>
      </div>);

      case 'active': return (<div><h2 style={{ fontSize: '20px', fontWeight: 800, marginBottom: '20px', color: COLORS.primaryDark }}>⏳ Active Loans</h2><div style={S.card}><TxTable items={activeTxs.sort((a, b) => new Date(a.deadlineDate) - new Date(b.deadlineDate))} /></div></div>);

      case 'deadlines': {
        const AlertGroup = ({ title, items, color, icon }) => items.length > 0 && (<div style={{ ...S.card, borderLeft: `4px solid ${color}` }}><div style={{ ...S.cardTitle, color }}>{icon} {title} ({items.length})</div>{items.map(tx => (<div key={tx.ref} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: `1px solid ${COLORS.border}` }}><div><strong>{tx.ref}</strong> — {tx.fullName} — {tx.aiBrand} {tx.aiModel} — {fmtMoney(tx.cashAdvance)}<br /><span style={{ fontSize: '12px', color: COLORS.textMuted }}>Phone: {tx.phoneNumbers?.[0]} | Deadline: {fmtDate(tx.deadlineDate)}</span></div><div style={{ display: 'flex', gap: '6px' }}><button style={S.btnSm('primary')} onClick={() => setViewingTx(tx)}>View</button><button style={S.btnSm('accent')} onClick={() => setRepayingTx(tx)}>Collect</button></div></div>))}</div>);
        const readyToSell = activeTxs.filter(t => daysBetween(t.dateGiven) > (t.loanDays || 30) + 3);
        const inGrace = activeTxs.filter(t => { const d = daysBetween(t.dateGiven); return d > (t.loanDays || 30) && d <= (t.loanDays || 30) + 3; });
        const upcoming7 = activeTxs.filter(t => { const l = (t.loanDays || 30) - daysBetween(t.dateGiven); return l <= 7 && l > 0; });
        return (<div><h2 style={{ fontSize: '20px', fontWeight: 800, marginBottom: '20px', color: COLORS.primaryDark }}>🔔 Deadlines & Alerts</h2><AlertGroup title="READY TO SELL" items={readyToSell} color="#1e1e1e" icon="🏷" /><AlertGroup title="GRACE PERIOD" items={inGrace} color="#7c3aed" icon="⏰" /><AlertGroup title="7 DAYS OR LESS" items={upcoming7} color="#f59e0b" icon="📅" />{readyToSell.length + inGrace.length + upcoming7.length === 0 && <div style={S.card}><p style={{ color: COLORS.textMuted, textAlign: 'center' }}>All clear! ✅</p></div>}</div>);
      }

      case 'forSale': { const sellable = [...forSaleTxs, ...activeTxs.filter(t => daysBetween(t.dateGiven) > (t.loanDays || 30) + 3)]; return (<div><h2 style={{ fontSize: '20px', fontWeight: 800, marginBottom: '20px', color: COLORS.primaryDark }}>🏷 For Sale</h2><div style={S.card}><TxTable items={sellable} /></div></div>); }

      case 'reports': { const fabianComp = Math.floor(netProfit * 0.10); const stakeholderProfit = netProfit - fabianComp; return (<div><h2 style={{ fontSize: '20px', fontWeight: 800, marginBottom: '20px', color: COLORS.primaryDark }}>📈 Monthly Report</h2><div style={S.grid3}><div style={S.stat}><div style={S.statLabel}>Revenue</div><div style={S.statValue}>{fmtMoney(totalRevenue)}</div></div><div style={S.stat}><div style={S.statLabel}>Expenses</div><div style={{ ...S.statValue, color: COLORS.danger }}>{fmtMoney(totalExpenses)}</div></div><div style={S.stat}><div style={S.statLabel}>Net Profit</div><div style={{ ...S.statValue, color: netProfit > 0 ? COLORS.primary : COLORS.danger }}>{fmtMoney(netProfit)}</div></div></div><div style={S.grid2}><div style={S.card}><div style={S.cardTitle}>Fabian (10%)</div><div style={{ fontSize: '24px', fontWeight: 800, color: COLORS.accent }}>{fmtMoney(fabianComp)}</div></div><div style={S.card}><div style={S.cardTitle}>Stakeholders</div><div style={{ fontSize: '24px', fontWeight: 800, color: COLORS.primary }}>{fmtMoney(stakeholderProfit)}</div></div></div><div style={S.card}><div style={S.cardTitle}>Distribution</div>{capital.map(c => { const pct = totalCapital > 0 ? (c.amount / totalCapital * 100) : 0; return (<div key={c.name + c.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: `1px solid ${COLORS.border}` }}><span><strong>{c.name}</strong> — {fmtMoney(c.amount)} ({pct.toFixed(1)}%)</span><strong style={{ color: COLORS.primary }}>{fmtMoney(Math.floor(stakeholderProfit * pct / 100))}</strong></div>); })}{capital.length === 0 && <p style={{ color: COLORS.textMuted }}>No capital recorded yet.</p>}</div></div>); }

      case 'capital': { return (<div><div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}><h2 style={{ fontSize: '20px', fontWeight: 800, color: COLORS.primaryDark }}>💎 Capital</h2>{isAdmin && <button style={S.btn('primary')} onClick={() => setShowAddCapital(true)}>+ Add</button>}</div><div style={S.card}><table style={S.table}><thead><tr><th style={S.th}>Name</th><th style={S.th}>Amount</th><th style={S.th}>Date</th><th style={S.th}>Share %</th></tr></thead><tbody>{capital.map((c, i) => (<tr key={i}><td style={S.td}><strong>{c.name}</strong></td><td style={S.td}>{fmtMoney(c.amount)}</td><td style={S.td}>{fmtDate(c.date)}</td><td style={S.td}><strong>{totalCapital > 0 ? (c.amount / totalCapital * 100).toFixed(1) : 0}%</strong></td></tr>))}{capital.length === 0 && <tr><td style={S.td} colSpan={4}>None yet.</td></tr>}</tbody></table><div style={{ marginTop: '12px', padding: '12px', background: COLORS.primaryLight, borderRadius: '8px', fontWeight: 700 }}>Total: {fmtMoney(totalCapital)}</div></div></div>); }

      case 'expenses': return (<div><div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}><h2 style={{ fontSize: '20px', fontWeight: 800, color: COLORS.primaryDark }}>🧾 Expenses</h2>{isStaff && <button style={S.btn('primary')} onClick={() => setShowAddExpense(true)}>+ Add</button>}</div><div style={S.card}><table style={S.table}><thead><tr><th style={S.th}>Date</th><th style={S.th}>Category</th><th style={S.th}>Description</th><th style={S.th}>Amount</th></tr></thead><tbody>{expenses.map((e, i) => (<tr key={i}><td style={S.td}>{fmtDate(e.date)}</td><td style={S.td}>{e.category}</td><td style={S.td}>{e.description}</td><td style={S.td}><strong>{fmtMoney(e.amount)}</strong></td></tr>))}{expenses.length === 0 && <tr><td style={S.td} colSpan={4}>None yet.</td></tr>}</tbody></table><div style={{ marginTop: '12px', padding: '12px', background: COLORS.dangerLight, borderRadius: '8px', fontWeight: 700, color: COLORS.danger }}>Total: {fmtMoney(totalExpenses)}</div></div></div>);

      case 'declined': return (<div><div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}><h2 style={{ fontSize: '20px', fontWeight: 800, color: COLORS.primaryDark }}>🚫 Declined Log</h2>{isStaff && <button style={S.btn('primary')} onClick={() => setShowAddDeclined(true)}>+ Add</button>}</div><div style={S.card}><table style={S.table}><thead><tr><th style={S.th}>Date</th><th style={S.th}>Item</th><th style={S.th}>Reason</th></tr></thead><tbody>{declinedLog.map((d, i) => (<tr key={i}><td style={S.td}>{fmtDate(d.date)}</td><td style={S.td}>{d.item}</td><td style={S.td}>{d.reason}</td></tr>))}{declinedLog.length === 0 && <tr><td style={S.td} colSpan={3}>None.</td></tr>}</tbody></table></div></div>);

      case 'settings': return (<div><h2 style={{ fontSize: '20px', fontWeight: 800, marginBottom: '20px', color: COLORS.primaryDark }}>⚙ Settings</h2><div style={S.card}><div style={S.cardTitle}>Business Parameters</div><div style={S.grid2}><Field label="Daily Interest Rate (%)"><input style={S.input} type="number" step="0.1" value={settings.interestRate} onChange={e => saveSettings({ ...settings, interestRate: Number(e.target.value) })} /></Field><Field label="Service Fee (₦)"><input style={S.input} type="number" value={settings.serviceFee} onChange={e => saveSettings({ ...settings, serviceFee: Number(e.target.value) })} /></Field><Field label="Loan Cap No Receipt (%)"><input style={S.input} type="number" value={settings.loanCapNoReceipt} onChange={e => saveSettings({ ...settings, loanCapNoReceipt: Number(e.target.value) })} /></Field><Field label="Loan Cap With Receipt (%)"><input style={S.input} type="number" value={settings.loanCapWithReceipt} onChange={e => saveSettings({ ...settings, loanCapWithReceipt: Number(e.target.value) })} /></Field><Field label="Max Loan Days"><input style={S.input} type="number" value={settings.maxLoanDays} onChange={e => saveSettings({ ...settings, maxLoanDays: Number(e.target.value) })} /></Field><Field label="Grace Days"><input style={S.input} type="number" value={settings.graceDays} onChange={e => saveSettings({ ...settings, graceDays: Number(e.target.value) })} /></Field></div></div><div style={S.card}><div style={S.cardTitle}>🏪 Business Contact &amp; Hours</div><div style={{ fontSize: '13px', color: COLORS.textMuted, marginBottom: '14px' }}>These values appear on the public landing page and customer portal. Update them here and they change everywhere automatically.</div><Field label="Shop Address"><textarea style={S.textarea} value={settings.shopAddress || DEFAULT_SETTINGS.shopAddress} onChange={e => saveSettings({ ...settings, shopAddress: e.target.value })} /></Field><div style={S.grid2}><Field label="Phone Number 1"><input style={S.input} value={settings.shopPhone1 || DEFAULT_SETTINGS.shopPhone1} onChange={e => saveSettings({ ...settings, shopPhone1: e.target.value })} /></Field><Field label="Phone Number 2"><input style={S.input} value={settings.shopPhone2 || DEFAULT_SETTINGS.shopPhone2} onChange={e => saveSettings({ ...settings, shopPhone2: e.target.value })} /></Field></div><Field label="WhatsApp Number"><input style={S.input} value={settings.shopWhatsApp || DEFAULT_SETTINGS.shopWhatsApp} onChange={e => saveSettings({ ...settings, shopWhatsApp: e.target.value })} placeholder="2348165491908" /><div style={{ fontSize: '12px', color: COLORS.textMuted, marginTop: '4px' }}>Enter in international format without the + sign. Example: 2348165491908</div></Field><Field label="Operating Hours"><input style={S.input} value={settings.shopHours || DEFAULT_SETTINGS.shopHours} onChange={e => saveSettings({ ...settings, shopHours: e.target.value })} placeholder="Monday – Saturday, 8am – 6pm" /></Field><Field label="Google Maps Link (optional)"><input style={S.input} value={settings.shopMapsUrl || ''} onChange={e => saveSettings({ ...settings, shopMapsUrl: e.target.value })} placeholder="Paste a Google Maps share link here. If blank, falls back to a Google Search." /></Field></div><div style={S.card}><div style={S.cardTitle}>🔑 API Keys</div><Field label="Gemini AI API Key"><input style={S.input} type="password" value={settings.geminiApiKey} onChange={e => saveSettings({ ...settings, geminiApiKey: e.target.value })} placeholder="From aistudio.google.com" /></Field><Field label="Gemini Model"><input style={S.input} value={settings.geminiModel || DEFAULT_SETTINGS.geminiModel} onChange={e => saveSettings({ ...settings, geminiModel: e.target.value })} placeholder={DEFAULT_SETTINGS.geminiModel} /></Field><Field label="NIN/BVN API Key"><input style={S.input} type="password" value={settings.ninApiKey} onChange={e => saveSettings({ ...settings, ninApiKey: e.target.value })} placeholder="From checkmyninbvn.com.ng" /></Field></div></div>);

      case 'users': return (<div><div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}><h2 style={{ fontSize: '20px', fontWeight: 800, color: COLORS.primaryDark }}>👥 Users</h2><button style={S.btn('primary')} onClick={() => setShowAddUser(true)}>+ Add</button></div><div style={S.card}><table style={S.table}><thead><tr><th style={S.th}>Name</th><th style={S.th}>Username</th><th style={S.th}>Role</th><th style={S.th}>Actions</th></tr></thead><tbody>{users.map(u => (<tr key={u.id}><td style={S.td}><strong>{u.name}</strong></td><td style={S.td}>{u.username}</td><td style={S.td}><span style={S.badge(u.role === 'admin' ? COLORS.primary : u.role === 'staff' ? COLORS.accent : '#6b7280')}>{u.role}</span></td><td style={S.td}>{u.id !== 'admin' && <button style={S.btnSm('danger')} onClick={async () => { await API.del(`users/${u.id}`); loadData(); }}>Remove</button>}</td></tr>))}</tbody></table></div></div>);

      default: return <div>Page not found</div>;
    }
  };

  // Modals
  const ExpModal = () => { const [exp, setExp] = useState({ date: new Date().toISOString().split('T')[0], category: 'Stationery & Printing', description: '', amount: 0 }); return <Modal open={showAddExpense} onClose={() => setShowAddExpense(false)} title="Add Expense"><div style={S.grid2}><Field label="Date"><input style={S.input} type="date" value={exp.date} onChange={e => setExp({ ...exp, date: e.target.value })} /></Field><Field label="Category"><select style={S.select} value={exp.category} onChange={e => setExp({ ...exp, category: e.target.value })}>{['Stationery & Printing', 'Mobile Data', 'Phone Calls', 'Packaging Materials', 'Transport', 'Miscellaneous'].map(c => <option key={c}>{c}</option>)}</select></Field></div><Field label="Description"><input style={S.input} value={exp.description} onChange={e => setExp({ ...exp, description: e.target.value })} /></Field><Field label="Amount (₦)"><input style={S.input} type="number" value={exp.amount} onChange={e => setExp({ ...exp, amount: Number(e.target.value) })} /></Field><button style={S.btn('primary')} onClick={async () => { await API.post('expenses', exp); loadData(); setShowAddExpense(false); }}>Save</button></Modal>; };

  const CapModal = () => { const [cap, setCap] = useState({ name: '', amount: 0, date: new Date().toISOString().split('T')[0], method: '' }); return <Modal open={showAddCapital} onClose={() => setShowAddCapital(false)} title="Add Capital"><div style={S.grid2}><Field label="Stakeholder Name"><input style={S.input} value={cap.name} onChange={e => setCap({ ...cap, name: e.target.value })} /></Field><Field label="Amount (₦)"><input style={S.input} type="number" value={cap.amount} onChange={e => setCap({ ...cap, amount: Number(e.target.value) })} /></Field><Field label="Date"><input style={S.input} type="date" value={cap.date} onChange={e => setCap({ ...cap, date: e.target.value })} /></Field><Field label="Method/Bank"><input style={S.input} value={cap.method} onChange={e => setCap({ ...cap, method: e.target.value })} /></Field></div><button style={S.btn('primary')} onClick={async () => { await API.post('capital', cap); loadData(); setShowAddCapital(false); }}>Save</button></Modal>; };

  const DecModal = () => { const [dec, setDec] = useState({ date: new Date().toISOString().split('T')[0], item: '', reason: '' }); return <Modal open={showAddDeclined} onClose={() => setShowAddDeclined(false)} title="Log Declined"><Field label="Date"><input style={S.input} type="date" value={dec.date} onChange={e => setDec({ ...dec, date: e.target.value })} /></Field><Field label="Item"><input style={S.input} value={dec.item} onChange={e => setDec({ ...dec, item: e.target.value })} /></Field><Field label="Reason"><textarea style={S.textarea} value={dec.reason} onChange={e => setDec({ ...dec, reason: e.target.value })} /></Field><button style={S.btn('primary')} onClick={async () => { await API.post('declined', dec); loadData(); setShowAddDeclined(false); }}>Save</button></Modal>; };

  const UsrModal = () => { const [usr, setUsr] = useState({ name: '', username: '', password: '', role: 'staff' }); return <Modal open={showAddUser} onClose={() => setShowAddUser(false)} title="Add User"><div style={S.grid2}><Field label="Name"><input style={S.input} value={usr.name} onChange={e => setUsr({ ...usr, name: e.target.value })} /></Field><Field label="Username"><input style={S.input} value={usr.username} onChange={e => setUsr({ ...usr, username: e.target.value })} /></Field><Field label="Password"><input style={S.input} value={usr.password} onChange={e => setUsr({ ...usr, password: e.target.value })} /></Field><Field label="Role"><select style={S.select} value={usr.role} onChange={e => setUsr({ ...usr, role: e.target.value })}><option value="staff">Staff</option><option value="stakeholder">Stakeholder</option><option value="admin">Admin</option></select></Field></div><button style={S.btn('primary')} onClick={async () => { await API.post('users', { ...usr, id: `u-${Date.now()}` }); loadData(); setShowAddUser(false); }}>Add</button></Modal>; };

  const navAction = (item) => {
    setSidebarOpen(false);
    if (item.id === 'newTx') setEditingTx('new');
    else { setPage(item.id); setViewingTx(null); }
  };

  return (
    <div style={S.app}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet" />

      {/* Top Bar */}
      <div style={{ ...S.topBar, padding: isMobile ? '0 12px' : '0 24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {isMobile && <button style={S.hamburger} onClick={() => setSidebarOpen(o => !o)} aria-label="Menu">☰</button>}
          <span style={{ fontSize: '20px' }}>💰</span>
          <span style={{ fontWeight: 800, letterSpacing: '-0.3px', fontSize: isMobile ? '14px' : '16px' }}>CIF QUICK CASH</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? '8px' : '16px' }}>
          {!isMobile && <span style={{ fontSize: '13px', opacity: 0.8 }}>👤 {currentUser.name}</span>}
          <span style={S.badge(currentUser.role === 'admin' ? '#c8a84e' : currentUser.role === 'staff' ? '#10b981' : '#6b7280')}>{currentUser.role}</span>
          <button style={{ ...S.btnSm('danger'), fontSize: '11px' }} onClick={async () => { await API.post('logout', {}); setCurrentUser(null); }}>{isMobile ? '✕' : 'Logout'}</button>
        </div>
      </div>

      {/* Mobile Sidebar Overlay */}
      {isMobile && sidebarOpen && (
        <div style={S.mobileOverlay}>
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)' }} onClick={() => setSidebarOpen(false)} />
          <div style={S.mobileSidebar}>
            <div style={{ padding: '16px 20px', borderBottom: `1px solid ${COLORS.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div><div style={{ fontWeight: 800, color: COLORS.primaryDark, fontSize: '15px' }}>Menu</div><div style={{ fontSize: '12px', color: COLORS.textMuted }}>👤 {currentUser.name}</div></div>
              <button onClick={() => setSidebarOpen(false)} style={{ background: 'none', border: 'none', fontSize: '22px', cursor: 'pointer', color: COLORS.textMuted }}>✕</button>
            </div>
            {navItems.map(item => (
              <div key={item.id} style={S.sideItem(page === item.id)} onClick={() => navAction(item)}>
                <span>{item.icon}</span> {item.label}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Main Layout */}
      <div style={{ ...S.body, flexDirection: 'row', height: isMobile ? 'auto' : 'calc(100vh - 56px)' }}>
        {/* Desktop Sidebar */}
        {!isMobile && (
          <div style={S.sidebar}>
            {navItems.map(item => (
              <div key={item.id} style={S.sideItem(page === item.id)} onClick={() => navAction(item)}>
                <span>{item.icon}</span> {item.label}
              </div>
            ))}
          </div>
        )}
        <div style={{ ...S.mainContent, padding: isMobile ? '16px' : '24px', maxHeight: isMobile ? 'none' : 'calc(100vh - 56px)', paddingBottom: isMobile ? '80px' : '24px' }}>
          {renderPage()}
          <PhotoViewer />
        </div>
      </div>

      {/* Mobile Bottom Navigation */}
      {isMobile && (
        <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, background: '#fff', borderTop: `2px solid ${COLORS.border}`, display: 'flex', zIndex: 100, boxShadow: '0 -2px 12px rgba(0,0,0,0.1)' }}>
          {navItems.slice(0, 4).map(item => (
            <div key={item.id} onClick={() => navAction(item)}
              style={{ flex: 1, padding: '8px 4px 6px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px', cursor: 'pointer', background: page === item.id ? COLORS.primaryLight : 'transparent', borderTop: page === item.id ? `2px solid ${COLORS.primary}` : '2px solid transparent', marginTop: '-2px' }}>
              <span style={{ fontSize: '20px' }}>{item.icon}</span>
              <span style={{ fontSize: '10px', fontWeight: 600, color: page === item.id ? COLORS.primary : COLORS.textMuted, lineHeight: 1 }}>{item.label.split(' ')[0]}</span>
            </div>
          ))}
          <div onClick={() => setSidebarOpen(o => !o)}
            style={{ flex: 1, padding: '8px 4px 6px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px', cursor: 'pointer' }}>
            <span style={{ fontSize: '20px' }}>⋯</span>
            <span style={{ fontSize: '10px', fontWeight: 600, color: COLORS.textMuted, lineHeight: 1 }}>More</span>
          </div>
        </div>
      )}

      <ExpModal /><CapModal /><DecModal /><UsrModal />
      <Modal open={!!repayingTx} onClose={() => setRepayingTx(null)} title="Record Repayment">{repayingTx && <RepaymentModal tx={repayingTx} settings={settings} onClose={() => setRepayingTx(null)} onSave={async (tx) => { await saveTx(tx); setRepayingTx(null); loadData(); }} />}</Modal>
      <Modal open={!!sellingTx} onClose={() => setSellingTx(null)} title="Record Sale" wide>{sellingTx && <SaleModal tx={sellingTx} settings={settings} onClose={() => setSellingTx(null)} onSave={async (tx) => { await saveTx(tx); setSellingTx(null); loadData(); }} />}</Modal>
      <style>{`
        input:focus,select:focus,textarea:focus{border-color:${COLORS.primary}!important;box-shadow:0 0 0 3px ${COLORS.primaryLight};}
        ::-webkit-scrollbar{width:6px}::-webkit-scrollbar-track{background:${COLORS.bg}}::-webkit-scrollbar-thumb{background:${COLORS.border};border-radius:3px}
        @media (max-width: 768px) {
          table { min-width: 480px; }
          .wiz-steps::-webkit-scrollbar { display: none; }
        }
        * { -webkit-tap-highlight-color: transparent; touch-action: manipulation; }
        input, select, textarea, button { font-size: 16px; }
        @media (min-width: 769px) { input, select, textarea { font-size: 14px; } }
      `}</style>
    </div>
  );
}
