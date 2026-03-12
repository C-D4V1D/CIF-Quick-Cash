import { useState, useEffect, useCallback, useRef, useMemo } from "react";

// ============================================================
// CHRIST-IN-FABIAN QUICK CASH — CRM WEB APPLICATION
// ============================================================

// --- STORAGE HELPERS ---
const DB = {
  async get(key) {
    try {
      const r = await window.storage.get(key);
      return r ? JSON.parse(r.value) : null;
    } catch { return null; }
  },
  async set(key, val) {
    try {
      await window.storage.set(key, JSON.stringify(val));
    } catch (e) { console.error('Storage set error:', e); }
  },
  async list(prefix) {
    try {
      const r = await window.storage.list(prefix);
      return r?.keys || [];
    } catch { return []; }
  },
  async delete(key) {
    try { await window.storage.delete(key); } catch {}
  }
};

// --- UTILITY FUNCTIONS ---
const genRef = () => {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2,'0');
  const mm = String(d.getMonth()+1).padStart(2,'0');
  const yy = String(d.getFullYear()).slice(-2);
  const rand = String(Math.floor(Math.random()*999)+1).padStart(3,'0');
  return `CFC-${dd}${mm}${yy}-${rand}`;
};

const daysBetween = (dateStr) => {
  if (!dateStr) return 0;
  const given = new Date(dateStr);
  const now = new Date();
  given.setHours(0,0,0,0);
  now.setHours(0,0,0,0);
  return Math.max(0, Math.ceil((now - given) / 86400000));
};

const fmtMoney = (n) => {
  if (!n && n !== 0) return '₦0';
  return '₦' + Number(n).toLocaleString();
};

const fmtDate = (d) => {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' });
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
  interestRate: 1,
  loanCapNoReceipt: 40,
  loanCapWithReceipt: 50,
  graceDays: 3,
  serviceFee: 1000,
  maxLoanDays: 30,
  targetSellPct: 75,
  minSellBonus: 20,
  geminiApiKey: '',
  ninApiKey: '',
  itemCategories: ['Smartphone', 'Laptop', 'Tablet', 'Bluetooth Speaker', 'Power Bank', 'Electric Fan', 'Flat-Screen TV', 'Generator', 'Gas Cylinder', 'Other']
};

const DEFAULT_USERS = [
  { id: 'admin', username: 'david', password: 'admin123', role: 'admin', name: 'David (Chairman)' },
  { id: 'staff1', username: 'fabian', password: 'staff123', role: 'staff', name: 'Fabian (Operator)' },
  { id: 'stake1', username: 'stakeholder', password: 'stake123', role: 'stakeholder', name: 'Stakeholder' }
];

// ============================================================
// GEMINI AI INTEGRATION
// ============================================================
const callGeminiAI = async (apiKey, images, promptText) => {
  if (!apiKey) return { error: 'No Gemini API key set. Go to Admin > Settings to add your key.' };
  try {
    const parts = [{ text: promptText }];
    for (const img of images) {
      if (img) {
        const base64 = img.split(',')[1];
        const mime = img.split(';')[0].split(':')[1];
        parts.push({ inline_data: { mime_type: mime, data: base64 } });
      }
    }
    const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts }] })
    });
    const data = await resp.json();
    if (data.candidates?.[0]?.content?.parts?.[0]?.text) {
      return { text: data.candidates[0].content.parts[0].text };
    }
    return { error: data.error?.message || 'AI returned no response' };
  } catch (e) {
    return { error: e.message };
  }
};

// ============================================================
// NIN/BVN VERIFICATION
// ============================================================
const verifyNINBVN = async (apiKey, number, type = 'nin') => {
  if (!apiKey) return { error: 'No NIN API key set. Go to Admin > Settings to add your key.' };
  // Note: This integrates with checkmyninbvn.com.ng API
  // In production, replace with actual endpoint and auth
  try {
    const resp = await fetch(`https://checkmyninbvn.com.ng/api/v1/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ type, number })
    });
    const data = await resp.json();
    return data;
  } catch (e) {
    return { error: e.message };
  }
};

// ============================================================
// STYLES
// ============================================================
const COLORS = {
  bg: '#f8f6f1',
  card: '#ffffff',
  primary: '#1a5f2a',
  primaryLight: '#e8f5ec',
  primaryDark: '#0d3518',
  accent: '#c8a84e',
  accentLight: '#faf3e0',
  danger: '#c0392b',
  dangerLight: '#fde8e6',
  warning: '#e67e22',
  warningLight: '#fef3e2',
  text: '#1a1a1a',
  textMuted: '#6b7280',
  border: '#e5e1d8',
  borderDark: '#d1cdc4',
};

const S = {
  app: {
    fontFamily: "'DM Sans', 'Nunito', sans-serif",
    background: COLORS.bg,
    minHeight: '100vh',
    color: COLORS.text,
    fontSize: '14px',
    lineHeight: 1.6,
  },
  // Login
  loginWrap: {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    minHeight: '100vh', background: `linear-gradient(135deg, ${COLORS.primaryDark} 0%, ${COLORS.primary} 50%, #2d7a3e 100%)`,
    padding: '20px',
  },
  loginCard: {
    background: COLORS.card, borderRadius: '16px', padding: '40px',
    width: '100%', maxWidth: '400px', boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
  },
  loginTitle: {
    fontSize: '22px', fontWeight: 800, color: COLORS.primary,
    textAlign: 'center', marginBottom: '4px', letterSpacing: '-0.5px',
  },
  loginSub: {
    fontSize: '13px', color: COLORS.textMuted, textAlign: 'center', marginBottom: '28px',
  },
  // Layout
  topBar: {
    background: COLORS.primary, color: '#fff', padding: '0 24px',
    height: '56px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    position: 'sticky', top: 0, zIndex: 100,
    boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
  },
  sidebar: {
    width: '220px', background: '#fff', borderRight: `1px solid ${COLORS.border}`,
    padding: '16px 0', flexShrink: 0, overflowY: 'auto',
  },
  sideItem: (active) => ({
    padding: '10px 20px', cursor: 'pointer', fontSize: '13.5px', fontWeight: active ? 700 : 500,
    color: active ? COLORS.primary : COLORS.text,
    background: active ? COLORS.primaryLight : 'transparent',
    borderLeft: active ? `3px solid ${COLORS.primary}` : '3px solid transparent',
    transition: 'all 0.15s',
    display: 'flex', alignItems: 'center', gap: '10px',
  }),
  mainContent: {
    flex: 1, padding: '24px', overflowY: 'auto', maxHeight: 'calc(100vh - 56px)',
  },
  // Cards & Containers
  card: {
    background: COLORS.card, borderRadius: '12px', padding: '24px',
    border: `1px solid ${COLORS.border}`, marginBottom: '20px',
  },
  cardTitle: {
    fontSize: '17px', fontWeight: 700, marginBottom: '16px', color: COLORS.primaryDark,
    display: 'flex', alignItems: 'center', gap: '8px',
  },
  // Forms
  label: {
    fontSize: '12.5px', fontWeight: 600, color: COLORS.textMuted,
    marginBottom: '4px', display: 'block', textTransform: 'uppercase', letterSpacing: '0.5px',
  },
  input: {
    width: '100%', padding: '10px 12px', borderRadius: '8px',
    border: `1.5px solid ${COLORS.border}`, fontSize: '14px',
    outline: 'none', boxSizing: 'border-box', background: '#fff',
    transition: 'border-color 0.2s',
  },
  select: {
    width: '100%', padding: '10px 12px', borderRadius: '8px',
    border: `1.5px solid ${COLORS.border}`, fontSize: '14px',
    outline: 'none', boxSizing: 'border-box', background: '#fff',
  },
  textarea: {
    width: '100%', padding: '10px 12px', borderRadius: '8px',
    border: `1.5px solid ${COLORS.border}`, fontSize: '14px',
    outline: 'none', boxSizing: 'border-box', minHeight: '80px',
    resize: 'vertical', background: '#fff',
  },
  // Buttons
  btn: (variant = 'primary') => ({
    padding: '10px 20px', borderRadius: '8px', border: 'none',
    fontWeight: 600, fontSize: '13.5px', cursor: 'pointer',
    transition: 'all 0.2s', display: 'inline-flex', alignItems: 'center', gap: '6px',
    background: variant === 'primary' ? COLORS.primary : variant === 'danger' ? COLORS.danger : variant === 'accent' ? COLORS.accent : variant === 'outline' ? 'transparent' : '#6b7280',
    color: variant === 'outline' ? COLORS.primary : '#fff',
    border: variant === 'outline' ? `2px solid ${COLORS.primary}` : 'none',
  }),
  btnSm: (variant = 'primary') => ({
    padding: '6px 14px', borderRadius: '6px', border: 'none',
    fontWeight: 600, fontSize: '12px', cursor: 'pointer',
    background: variant === 'primary' ? COLORS.primary : variant === 'danger' ? COLORS.danger : variant === 'accent' ? COLORS.accent : '#6b7280',
    color: '#fff',
  }),
  // Table
  table: {
    width: '100%', borderCollapse: 'collapse', fontSize: '13px',
  },
  th: {
    textAlign: 'left', padding: '10px 12px', fontWeight: 700, fontSize: '11.5px',
    textTransform: 'uppercase', letterSpacing: '0.5px', color: COLORS.textMuted,
    borderBottom: `2px solid ${COLORS.border}`, background: COLORS.bg,
  },
  td: {
    padding: '10px 12px', borderBottom: `1px solid ${COLORS.border}`,
    verticalAlign: 'middle',
  },
  // Badges
  badge: (color) => ({
    display: 'inline-block', padding: '3px 10px', borderRadius: '20px',
    fontSize: '11px', fontWeight: 700, color: '#fff', background: color,
  }),
  // Grid
  grid2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' },
  grid3: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px' },
  grid4: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px' },
  // Stat card
  stat: {
    background: COLORS.card, borderRadius: '12px', padding: '20px',
    border: `1px solid ${COLORS.border}`,
  },
  statValue: { fontSize: '24px', fontWeight: 800, color: COLORS.primary },
  statLabel: { fontSize: '12px', color: COLORS.textMuted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' },
  // Wizard
  wizStep: (active, done) => ({
    padding: '8px 16px', borderRadius: '20px', fontSize: '12px', fontWeight: 600,
    background: active ? COLORS.primary : done ? COLORS.primaryLight : COLORS.bg,
    color: active ? '#fff' : done ? COLORS.primary : COLORS.textMuted,
    border: `1.5px solid ${active ? COLORS.primary : done ? COLORS.primary : COLORS.border}`,
    cursor: done ? 'pointer' : 'default',
    whiteSpace: 'nowrap',
  }),
  // Photo upload
  photoBox: {
    width: '120px', height: '120px', borderRadius: '10px',
    border: `2px dashed ${COLORS.border}`, display: 'flex',
    alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
    overflow: 'hidden', position: 'relative', background: COLORS.bg,
    flexShrink: 0,
  },
  photoImg: {
    width: '100%', height: '100%', objectFit: 'cover',
  },
  // Alert boxes
  alert: (type) => ({
    padding: '12px 16px', borderRadius: '8px', marginBottom: '16px', fontSize: '13px',
    background: type === 'danger' ? COLORS.dangerLight : type === 'warning' ? COLORS.warningLight : COLORS.primaryLight,
    color: type === 'danger' ? COLORS.danger : type === 'warning' ? COLORS.warning : COLORS.primary,
    border: `1px solid ${type === 'danger' ? '#f5c6cb' : type === 'warning' ? '#fde2b3' : '#b7e4c7'}`,
    fontWeight: 500,
  }),
  // Responsive body
  body: {
    display: 'flex', height: 'calc(100vh - 56px)',
  },
};

// ============================================================
// PHOTO UPLOAD COMPONENT
// ============================================================
function PhotoUpload({ label, value, onChange, required, size = 120 }) {
  const ref = useRef();
  const handleFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => onChange(ev.target.result);
    reader.readAsDataURL(file);
  };
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ ...S.photoBox, width: size, height: size }} onClick={() => ref.current?.click()}>
        {value ? <img src={value} style={S.photoImg} alt={label} /> : (
          <span style={{ fontSize: '11px', color: COLORS.textMuted, padding: '8px', textAlign: 'center' }}>
            📷 {label}
          </span>
        )}
        <input ref={ref} type="file" accept="image/*" capture="environment" onChange={handleFile} style={{ display: 'none' }} />
      </div>
      <div style={{ fontSize: '10.5px', marginTop: '4px', color: required ? COLORS.danger : COLORS.textMuted, fontWeight: 600 }}>
        {label} {required && '*'}
      </div>
    </div>
  );
}

// ============================================================
// FIELD COMPONENT
// ============================================================
function Field({ label, required, children, style: st }) {
  return (
    <div style={{ marginBottom: '14px', ...st }}>
      <label style={S.label}>{label} {required && <span style={{ color: COLORS.danger }}>*</span>}</label>
      {children}
    </div>
  );
}

// ============================================================
// MODAL COMPONENT
// ============================================================
function Modal({ open, onClose, title, children, wide }) {
  if (!open) return null;
  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000, padding:'20px' }}>
      <div style={{ background:'#fff', borderRadius:'16px', width:'100%', maxWidth: wide ? '900px' : '600px', maxHeight:'85vh', overflow:'auto', padding:'28px' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'20px' }}>
          <h3 style={{ fontSize:'18px', fontWeight:700, margin:0, color:COLORS.primaryDark }}>{title}</h3>
          <button onClick={onClose} style={{ background:'none', border:'none', fontSize:'22px', cursor:'pointer', color:COLORS.textMuted }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ============================================================
// LOGIN SCREEN
// ============================================================
function LoginScreen({ onLogin, users }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const handleLogin = () => {
    const user = users.find(u => u.username === username && u.password === password);
    if (user) onLogin(user);
    else setError('Invalid username or password');
  };
  return (
    <div style={S.loginWrap}>
      <div style={S.loginCard}>
        <div style={{ textAlign: 'center', marginBottom: '8px' }}>
          <span style={{ fontSize: '36px' }}>💰</span>
        </div>
        <div style={S.loginTitle}>CHRIST-IN-FABIAN</div>
        <div style={{ fontSize: '14px', fontWeight: 700, textAlign: 'center', color: COLORS.accent, marginBottom: '4px', letterSpacing: '2px' }}>QUICK CASH</div>
        <div style={S.loginSub}>Staff & Stakeholder Portal</div>
        {error && <div style={S.alert('danger')}>{error}</div>}
        <Field label="Username"><input style={S.input} value={username} onChange={e => { setUsername(e.target.value); setError(''); }} placeholder="Enter username" /></Field>
        <Field label="Password"><input style={S.input} type="password" value={password} onChange={e => { setPassword(e.target.value); setError(''); }} placeholder="Enter password" onKeyDown={e => e.key === 'Enter' && handleLogin()} /></Field>
        <button style={{ ...S.btn('primary'), width: '100%', justifyContent: 'center', marginTop: '8px', padding: '12px' }} onClick={handleLogin}>
          Sign In →
        </button>
        <div style={{ marginTop: '20px', padding: '14px', background: COLORS.bg, borderRadius: '8px', fontSize: '11.5px', color: COLORS.textMuted }}>
          <strong>Demo Accounts:</strong><br />
          Staff: fabian / staff123<br />
          Stakeholder: stakeholder / stake123<br />
          Admin: david / admin123
        </div>
      </div>
    </div>
  );
}

// ============================================================
// TRANSACTION WIZARD
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

function TransactionWizard({ settings, onSave, onCancel, draft, currentUser }) {
  const [step, setStep] = useState(draft?.wizardStep || 0);
  const [tx, setTx] = useState(draft || {
    ref: genRef(),
    type: 'advance',
    status: 'active',
    createdBy: currentUser?.name || '',
    createdAt: new Date().toISOString(),
    // NIN/BVN
    idType: 'nin',
    idNumber: '',
    ninVerified: false,
    ninData: null,
    // Customer
    fullName: '',
    address: '',
    phoneNumbers: ['', ''],
    phonesVerified: [false, false],
    familyName: '',
    familyPhone: '',
    familyRelation: '',
    // Photos
    photoCustomerHolding: null,
    photoCustomerID: null,
    photoSigning: null,
    photoSealedPkg: null,
    // Item photos
    itemPhotos: { front: null, back: null, left: null, right: null, corners: [], powerOn: null, aboutPage: null },
    // AI results
    aiItemType: '',
    aiBrand: '',
    aiModel: '',
    aiColour: '',
    aiCondition: '',
    aiEstimatedValue: '',
    aiRawResponse: '',
    requiresIMEI: false,
    // IMEI
    imei: '',
    imeiChecked: false,
    imeiClean: false,
    serialNumber: '',
    // Receipt
    hasReceipt: false,
    receiptPhoto: null,
    // Screening
    screeningOwnership: '',
    screeningPurchaseLocation: '',
    screeningDuration: '',
    screeningRegistered: '',
    screeningOthersUsing: '',
    screeningRedFlag: false,
    // Offer
    estimatedValue: 0,
    loanCapPct: 40,
    cashAdvance: 0,
    dailyFee: 0,
    loanDays: 30,
    dateGiven: '',
    deadlineDate: '',
    serviceFeeCollected: false,
    // Condition description
    conditionDescription: '',
    // Sale fields
    salePrice: 0,
    saleDate: '',
    saleBuyer: '',
    // Repayment fields
    amountRepaid: 0,
    dateRepaid: '',
    daysCharged: 0,
    totalFees: 0,
    itemReturned: false,
    // Contact log
    contactLog: [],
    // Notes
    notes: '',
  });

  const [aiLoading, setAiLoading] = useState(false);
  const [ninLoading, setNinLoading] = useState(false);
  const [aiError, setAiError] = useState('');
  const [ninError, setNinError] = useState('');

  const upd = (field, val) => setTx(prev => ({ ...prev, [field]: val }));
  const updNested = (parent, field, val) => setTx(prev => ({ ...prev, [parent]: { ...prev[parent], [field]: val } }));

  // Auto-save draft on every change
  useEffect(() => {
    const saveDraft = async () => {
      await DB.set(`draft-${tx.ref}`, { ...tx, wizardStep: step });
    };
    saveDraft();
  }, [tx, step]);

  // NIN/BVN Verification
  const handleVerify = async () => {
    setNinLoading(true);
    setNinError('');
    const result = await verifyNINBVN(settings.ninApiKey, tx.idNumber, tx.idType);
    if (result.error) {
      setNinError(result.error);
      // For demo, simulate success
      upd('ninVerified', true);
      upd('ninData', { 
        firstName: 'Demo', lastName: 'User', 
        address: 'Aguleri Junction, Anambra State',
        photo: null
      });
      if (!tx.fullName) upd('fullName', 'Demo User');
      if (!tx.address) upd('address', 'Aguleri Junction, Anambra State');
    } else if (result.data) {
      upd('ninVerified', true);
      upd('ninData', result.data);
      if (result.data.firstName) upd('fullName', `${result.data.firstName} ${result.data.lastName || ''}`);
      if (result.data.address) upd('address', result.data.address);
    }
    setNinLoading(false);
  };

  // AI Valuation
  const handleAIValuation = async () => {
    setAiLoading(true);
    setAiError('');
    const photos = [
      tx.itemPhotos.front, tx.itemPhotos.back, tx.itemPhotos.left, tx.itemPhotos.right,
      tx.itemPhotos.powerOn, tx.itemPhotos.aboutPage,
      ...(tx.itemPhotos.corners || [])
    ].filter(Boolean);

    if (photos.length === 0) {
      setAiError('Please upload at least one item photo first.');
      setAiLoading(false);
      return;
    }

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

    const result = await callGeminiAI(settings.geminiApiKey, photos, prompt);
    if (result.error) {
      setAiError(result.error);
    } else {
      const text = result.text;
      upd('aiRawResponse', text);
      // Parse response
      const parse = (key) => {
        const match = text.match(new RegExp(`${key}:\\s*(.+?)(?:\\n|$)`, 'i'));
        return match ? match[1].trim() : '';
      };
      upd('aiItemType', parse('ITEM_TYPE'));
      upd('aiBrand', parse('BRAND'));
      upd('aiModel', parse('MODEL'));
      upd('aiColour', parse('COLOUR'));
      upd('aiCondition', parse('CONDITION'));
      const val = parse('ESTIMATED_VALUE').replace(/[^0-9]/g, '');
      upd('aiEstimatedValue', val);
      upd('estimatedValue', Number(val) || 0);
      const isPhone = parse('IS_PHONE').toUpperCase().includes('YES');
      upd('requiresIMEI', isPhone);
      upd('conditionDescription', parse('CONDITION'));
    }
    setAiLoading(false);
  };

  // Calculate offer
  const capPct = tx.hasReceipt ? (settings.loanCapWithReceipt || 50) : (settings.loanCapNoReceipt || 40);
  const maxAdvance = Math.floor((tx.estimatedValue || 0) * capPct / 100);
  const dailyFeeCalc = Math.floor((tx.cashAdvance || 0) * (settings.interestRate || 1) / 100);

  const canProceed = () => {
    switch (WIZARD_STEPS[step]?.id) {
      case 'type': return true;
      case 'nin': return tx.ninVerified || tx.idNumber.length > 5;
      case 'customer': return tx.fullName && tx.phoneNumbers[0];
      case 'custPhotos': return !!tx.photoCustomerHolding;
      case 'itemPhotos': return !!(tx.itemPhotos.front || tx.itemPhotos.back);
      case 'aiValuation': return !!(tx.aiItemType && tx.estimatedValue > 0);
      case 'imeiSerial': return tx.requiresIMEI ? (tx.imei && tx.imeiChecked) : true;
      case 'screening': return true;
      case 'offer': return tx.cashAdvance > 0 && tx.dateGiven;
      case 'agreement': return true;
      default: return true;
    }
  };

  const next = () => {
    if (step < WIZARD_STEPS.length - 1) setStep(step + 1);
  };
  const prev = () => {
    if (step > 0) setStep(step - 1);
  };

  const handleComplete = async () => {
    const finalTx = { ...tx, status: tx.type === 'outright' ? 'for_sale' : 'active', wizardStep: null };
    await DB.set(`tx-${tx.ref}`, finalTx);
    await DB.delete(`draft-${tx.ref}`);
    onSave(finalTx);
  };

  // ---- STEP RENDERS ----
  const renderStepContent = () => {
    const sid = WIZARD_STEPS[step]?.id;
    switch (sid) {
      case 'type':
        return (
          <div>
            <h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '16px' }}>What type of transaction is this?</h3>
            <div style={{ display: 'flex', gap: '16px' }}>
              {[
                { value: 'advance', label: 'Cash Advance', desc: 'Customer leaves item as collateral, collects within 30 days', icon: '🤝' },
                { value: 'outright', label: 'Outright Purchase', desc: 'Customer wants to sell the item immediately', icon: '🛒' },
              ].map(opt => (
                <div key={opt.value} onClick={() => upd('type', opt.value)}
                  style={{ flex: 1, padding: '20px', borderRadius: '12px', cursor: 'pointer', textAlign: 'center',
                    border: `2px solid ${tx.type === opt.value ? COLORS.primary : COLORS.border}`,
                    background: tx.type === opt.value ? COLORS.primaryLight : '#fff',
                  }}>
                  <div style={{ fontSize: '32px', marginBottom: '8px' }}>{opt.icon}</div>
                  <div style={{ fontWeight: 700, fontSize: '15px', marginBottom: '4px' }}>{opt.label}</div>
                  <div style={{ fontSize: '12px', color: COLORS.textMuted }}>{opt.desc}</div>
                </div>
              ))}
            </div>
            <div style={{ marginTop: '16px', padding: '12px', background: COLORS.bg, borderRadius: '8px', fontSize: '12px', color: COLORS.textMuted }}>
              <strong>Ref Number:</strong> {tx.ref}
            </div>
          </div>
        );

      case 'nin':
        return (
          <div>
            <h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '16px' }}>🪪 Identity Verification</h3>
            <div style={S.grid2}>
              <Field label="ID Type" required>
                <select style={S.select} value={tx.idType} onChange={e => upd('idType', e.target.value)}>
                  <option value="nin">NIN (National Identification Number)</option>
                  <option value="bvn">BVN (Bank Verification Number)</option>
                </select>
              </Field>
              <Field label={`${tx.idType.toUpperCase()} Number`} required>
                <input style={S.input} value={tx.idNumber} onChange={e => upd('idNumber', e.target.value)}
                  placeholder={tx.idType === 'nin' ? 'Enter 11-digit NIN' : 'Enter 11-digit BVN'} />
              </Field>
            </div>
            {tx.idType === 'bvn' && (
              <div style={S.alert('warning')}>⚠ BVN does not return home address. You will need to ask the customer for their address manually.</div>
            )}
            <button style={S.btn('primary')} onClick={handleVerify} disabled={ninLoading || !tx.idNumber}>
              {ninLoading ? '⏳ Verifying...' : `Verify ${tx.idType.toUpperCase()}`}
            </button>
            {ninError && <div style={{ ...S.alert('warning'), marginTop: '12px' }}>⚠ {ninError} — Demo mode: proceeding with placeholder data.</div>}
            {tx.ninVerified && (
              <div style={{ ...S.alert('info'), marginTop: '12px', background: COLORS.primaryLight, color: COLORS.primary, border: `1px solid #b7e4c7` }}>
                ✅ {tx.idType.toUpperCase()} Verified Successfully
                {tx.ninData && (
                  <div style={{ marginTop: '8px', fontSize: '13px' }}>
                    <strong>Name:</strong> {tx.fullName}<br />
                    <strong>Address:</strong> {tx.address || 'Not available (BVN)'}
                  </div>
                )}
              </div>
            )}
          </div>
        );

      case 'customer':
        return (
          <div>
            <h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '16px' }}>👤 Customer Details</h3>
            <div style={S.grid2}>
              <Field label="Full Name" required>
                <input style={S.input} value={tx.fullName} onChange={e => upd('fullName', e.target.value)} placeholder="Full name from NIN" />
              </Field>
              <Field label="Address" required>
                <input style={S.input} value={tx.address} onChange={e => upd('address', e.target.value)} placeholder="Home address" />
              </Field>
            </div>
            <div style={S.grid2}>
              <Field label="Phone Number 1" required>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input style={{ ...S.input, flex: 1 }} value={tx.phoneNumbers[0]} onChange={e => {
                    const nums = [...tx.phoneNumbers]; nums[0] = e.target.value; upd('phoneNumbers', nums);
                  }} placeholder="+234..." />
                  <button style={S.btnSm(tx.phonesVerified[0] ? 'primary' : 'muted')}
                    onClick={() => { const v = [...tx.phonesVerified]; v[0] = !v[0]; upd('phonesVerified', v); }}>
                    {tx.phonesVerified[0] ? '✓ Called' : 'Mark Called'}
                  </button>
                </div>
              </Field>
              <Field label="Phone Number 2 (optional)">
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input style={{ ...S.input, flex: 1 }} value={tx.phoneNumbers[1]} onChange={e => {
                    const nums = [...tx.phoneNumbers]; nums[1] = e.target.value; upd('phoneNumbers', nums);
                  }} placeholder="+234..." />
                  <button style={S.btnSm(tx.phonesVerified[1] ? 'primary' : 'muted')}
                    onClick={() => { const v = [...tx.phonesVerified]; v[1] = !v[1]; upd('phonesVerified', v); }}>
                    {tx.phonesVerified[1] ? '✓ Called' : 'Mark Called'}
                  </button>
                </div>
              </Field>
            </div>
            <div style={{ ...S.card, background: COLORS.bg, padding: '16px', marginTop: '4px' }}>
              <div style={{ fontSize: '13px', fontWeight: 700, marginBottom: '10px', color: COLORS.primaryDark }}>Family / Neighbour Contact</div>
              <div style={S.grid3}>
                <Field label="Name"><input style={S.input} value={tx.familyName} onChange={e => upd('familyName', e.target.value)} /></Field>
                <Field label="Phone"><input style={S.input} value={tx.familyPhone} onChange={e => upd('familyPhone', e.target.value)} /></Field>
                <Field label="Relationship"><input style={S.input} value={tx.familyRelation} onChange={e => upd('familyRelation', e.target.value)} placeholder="e.g. Sister, Neighbour" /></Field>
              </div>
            </div>
          </div>
        );

      case 'custPhotos':
        return (
          <div>
            <h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '16px' }}>📸 Customer Photos</h3>
            <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap' }}>
              <PhotoUpload label="Customer Holding Item" value={tx.photoCustomerHolding} onChange={v => upd('photoCustomerHolding', v)} required size={160} />
              <PhotoUpload label="Customer with ID (Optional)" value={tx.photoCustomerID} onChange={v => upd('photoCustomerID', v)} size={160} />
            </div>
            <div style={{ ...S.alert('info'), marginTop: '16px', background: COLORS.primaryLight, color: COLORS.primary, border: '1px solid #b7e4c7' }}>
              📌 <strong>Customer holding item</strong> is mandatory — both face and item must be visible.<br />
              Customer with ID card is optional if NIN photo clearly matched.
            </div>
          </div>
        );

      case 'itemPhotos':
        return (
          <div>
            <h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '16px' }}>🔍 Item Photos</h3>
            <p style={{ fontSize: '13px', color: COLORS.textMuted, marginBottom: '16px' }}>Take clear photos in good light. These photos will be sent to AI for valuation and condition report.</p>
            <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
              <PhotoUpload label="Front" value={tx.itemPhotos.front} onChange={v => updNested('itemPhotos', 'front', v)} required size={110} />
              <PhotoUpload label="Back" value={tx.itemPhotos.back} onChange={v => updNested('itemPhotos', 'back', v)} required size={110} />
              <PhotoUpload label="Left Side" value={tx.itemPhotos.left} onChange={v => updNested('itemPhotos', 'left', v)} size={110} />
              <PhotoUpload label="Right Side" value={tx.itemPhotos.right} onChange={v => updNested('itemPhotos', 'right', v)} size={110} />
              <PhotoUpload label="Power On Screen" value={tx.itemPhotos.powerOn} onChange={v => updNested('itemPhotos', 'powerOn', v)} size={110} />
              <PhotoUpload label="About / Nameplate" value={tx.itemPhotos.aboutPage} onChange={v => updNested('itemPhotos', 'aboutPage', v)} size={110} />
            </div>
            <Field label="Has Original Receipt?" style={{ marginTop: '16px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                <input type="checkbox" checked={tx.hasReceipt} onChange={e => upd('hasReceipt', e.target.checked)} style={{ width: '18px', height: '18px' }} />
                <span style={{ fontSize: '14px' }}>Yes — customer provided original purchase receipt</span>
              </label>
            </Field>
            {tx.hasReceipt && (
              <PhotoUpload label="Receipt Photo" value={tx.receiptPhoto} onChange={v => upd('receiptPhoto', v)} size={140} />
            )}
          </div>
        );

      case 'aiValuation':
        return (
          <div>
            <h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '16px' }}>🤖 AI Item Valuation & Description</h3>
            <p style={{ fontSize: '13px', color: COLORS.textMuted, marginBottom: '16px' }}>
              The AI will analyze your item photos to identify the item, estimate its resale value in Anambra, and describe its condition.
            </p>
            <button style={S.btn('primary')} onClick={handleAIValuation} disabled={aiLoading}>
              {aiLoading ? '⏳ Analyzing Photos...' : '🤖 Run AI Valuation'}
            </button>
            {aiError && <div style={{ ...S.alert('danger'), marginTop: '12px' }}>{aiError}</div>}
            {tx.aiRawResponse && (
              <div style={{ marginTop: '16px', padding: '12px', background: COLORS.bg, borderRadius: '8px', fontSize: '12px', color: COLORS.textMuted, whiteSpace: 'pre-wrap', maxHeight: '120px', overflow: 'auto' }}>
                <strong>Raw AI Response:</strong><br />{tx.aiRawResponse}
              </div>
            )}
            <div style={{ ...S.grid2, marginTop: '16px' }}>
              <Field label="Item Type" required>
                <input style={S.input} value={tx.aiItemType} onChange={e => upd('aiItemType', e.target.value)} placeholder="e.g. Smartphone" />
              </Field>
              <Field label="Brand" required>
                <input style={S.input} value={tx.aiBrand} onChange={e => upd('aiBrand', e.target.value)} placeholder="e.g. Samsung" />
              </Field>
              <Field label="Model" required>
                <input style={S.input} value={tx.aiModel} onChange={e => upd('aiModel', e.target.value)} placeholder="e.g. Galaxy A14" />
              </Field>
              <Field label="Colour">
                <input style={S.input} value={tx.aiColour} onChange={e => upd('aiColour', e.target.value)} placeholder="e.g. Black" />
              </Field>
            </div>
            <Field label="Estimated Resale Value (₦)" required>
              <input style={{ ...S.input, fontSize: '18px', fontWeight: 700 }} type="number" value={tx.estimatedValue || tx.aiEstimatedValue}
                onChange={e => upd('estimatedValue', Number(e.target.value))} />
            </Field>
            <Field label="Condition Description" required>
              <textarea style={S.textarea} value={tx.conditionDescription || tx.aiCondition}
                onChange={e => upd('conditionDescription', e.target.value)}
                placeholder="AI-generated condition + your own observations" />
            </Field>
            {tx.requiresIMEI && (
              <div style={S.alert('warning')}>📱 AI detected this is a phone — IMEI check will be required in the next step.</div>
            )}
          </div>
        );

      case 'imeiSerial':
        return (
          <div>
            <h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '16px' }}>🔢 IMEI / Serial Number</h3>
            {tx.requiresIMEI ? (
              <>
                <div style={S.alert('warning')}>📱 This item is a phone. IMEI verification is <strong>mandatory</strong>. Dial *#06# on the phone to get the IMEI.</div>
                <Field label="IMEI Number" required>
                  <input style={S.input} value={tx.imei} onChange={e => upd('imei', e.target.value)} placeholder="15-digit IMEI number" />
                </Field>
                <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '16px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                    <input type="checkbox" checked={tx.imeiChecked} onChange={e => upd('imeiChecked', e.target.checked)} style={{ width: '18px', height: '18px' }} />
                    <span style={{ fontSize: '13px' }}>I have checked this IMEI on imei.info</span>
                  </label>
                  <a href={`https://www.imei.info/`} target="_blank" rel="noopener noreferrer" style={{ fontSize: '12px', color: COLORS.primary }}>Open imei.info →</a>
                </div>
                {tx.imeiChecked && (
                  <Field label="IMEI Status">
                    <div style={{ display: 'flex', gap: '12px' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                        <input type="radio" checked={tx.imeiClean === true} onChange={() => upd('imeiClean', true)} />
                        <span style={{ color: '#10b981', fontWeight: 600 }}>✓ Clean — Not stolen</span>
                      </label>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                        <input type="radio" checked={tx.imeiClean === false && tx.imeiChecked} onChange={() => upd('imeiClean', false)} />
                        <span style={{ color: COLORS.danger, fontWeight: 600 }}>✗ Flagged — DECLINE</span>
                      </label>
                    </div>
                  </Field>
                )}
                {tx.imeiClean === false && tx.imeiChecked && (
                  <div style={S.alert('danger')}>🚫 This IMEI is flagged. <strong>DECLINE THIS ITEM IMMEDIATELY.</strong> Do not accept under any circumstances.</div>
                )}
              </>
            ) : (
              <>
                <p style={{ fontSize: '13px', color: COLORS.textMuted, marginBottom: '12px' }}>This item is not a phone. Enter the serial number if available.</p>
                <Field label="Serial Number (if available)">
                  <input style={S.input} value={tx.serialNumber} onChange={e => upd('serialNumber', e.target.value)} placeholder="Check back panel or sticker" />
                </Field>
              </>
            )}
          </div>
        );

      case 'screening':
        return (
          <div>
            <h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '16px' }}>❓ Screening Questions</h3>
            <p style={{ fontSize: '13px', color: COLORS.textMuted, marginBottom: '16px' }}>Ask these calmly — not like an interrogation. Write the answers.</p>
            <Field label="How long have you had this item?">
              <input style={S.input} value={tx.screeningDuration} onChange={e => upd('screeningDuration', e.target.value)} placeholder="e.g. 2 years" />
            </Field>
            <Field label="Where did you buy it from?">
              <input style={S.input} value={tx.screeningPurchaseLocation} onChange={e => upd('screeningPurchaseLocation', e.target.value)} placeholder="e.g. Computer Village, Lagos" />
            </Field>
            <Field label="Is this item registered in your name?">
              <input style={S.input} value={tx.screeningRegistered} onChange={e => upd('screeningRegistered', e.target.value)} placeholder="Yes / No / N/A" />
            </Field>
            <Field label="Has anyone else used this item with you?">
              <input style={S.input} value={tx.screeningOthersUsing} onChange={e => upd('screeningOthersUsing', e.target.value)} placeholder="e.g. No, only me" />
            </Field>
            <div style={{ marginTop: '12px', padding: '16px', background: COLORS.dangerLight, borderRadius: '8px', border: '1px solid #f5c6cb' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
                <input type="checkbox" checked={tx.screeningRedFlag} onChange={e => upd('screeningRedFlag', e.target.checked)} style={{ width: '20px', height: '20px' }} />
                <span style={{ fontSize: '14px', fontWeight: 700, color: COLORS.danger }}>🚩 RED FLAG — Something feels wrong (decline this customer)</span>
              </label>
            </div>
            <Field label="Notes / Observations" style={{ marginTop: '12px' }}>
              <textarea style={S.textarea} value={tx.notes} onChange={e => upd('notes', e.target.value)} placeholder="Any additional notes about this customer or transaction..." />
            </Field>
          </div>
        );

      case 'offer':
        return (
          <div>
            <h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '16px' }}>💰 {tx.type === 'outright' ? 'Purchase Offer' : 'Cash Advance Offer'}</h3>
            <div style={{ ...S.card, background: COLORS.primaryLight, border: `2px solid ${COLORS.primary}`, padding: '20px' }}>
              <div style={S.grid3}>
                <div>
                  <div style={S.statLabel}>Estimated Resale Value</div>
                  <div style={{ fontSize: '22px', fontWeight: 800, color: COLORS.primary }}>{fmtMoney(tx.estimatedValue)}</div>
                </div>
                <div>
                  <div style={S.statLabel}>Loan Cap ({tx.hasReceipt ? `${settings.loanCapWithReceipt}% w/receipt` : `${settings.loanCapNoReceipt}% no receipt`})</div>
                  <div style={{ fontSize: '22px', fontWeight: 800, color: COLORS.accent }}>{fmtMoney(maxAdvance)}</div>
                </div>
                <div>
                  <div style={S.statLabel}>Daily Fee (@ {settings.interestRate}%)</div>
                  <div style={{ fontSize: '22px', fontWeight: 800, color: COLORS.warning }}>{fmtMoney(dailyFeeCalc)}/day</div>
                </div>
              </div>
            </div>
            <div style={S.grid2}>
              <Field label={tx.type === 'outright' ? 'Purchase Amount (₦)' : 'Cash Advance Amount (₦)'} required>
                <input style={{ ...S.input, fontSize: '18px', fontWeight: 700 }} type="number"
                  value={tx.cashAdvance} onChange={e => {
                    const val = Math.min(Number(e.target.value), maxAdvance);
                    upd('cashAdvance', val);
                    upd('dailyFee', Math.floor(val * (settings.interestRate || 1) / 100));
                  }} max={maxAdvance} />
                {tx.cashAdvance > maxAdvance && <div style={{ color: COLORS.danger, fontSize: '12px', marginTop: '4px' }}>Cannot exceed {fmtMoney(maxAdvance)}</div>}
              </Field>
              <Field label="Date Given" required>
                <input style={S.input} type="date" value={tx.dateGiven} onChange={e => {
                  upd('dateGiven', e.target.value);
                  const d = new Date(e.target.value);
                  d.setDate(d.getDate() + (settings.maxLoanDays || 30));
                  upd('deadlineDate', d.toISOString().split('T')[0]);
                }} />
              </Field>
            </div>
            {tx.type === 'advance' && (
              <div style={S.grid2}>
                <Field label="Loan Period (Days)">
                  <input style={S.input} type="number" value={tx.loanDays || 30} onChange={e => upd('loanDays', Number(e.target.value))} />
                </Field>
                <Field label="Deadline Date">
                  <input style={S.input} type="date" value={tx.deadlineDate} readOnly />
                </Field>
              </div>
            )}
            <div style={{ padding: '12px', background: COLORS.accentLight, borderRadius: '8px', fontSize: '13px', marginTop: '4px' }}>
              <strong>Service Fee:</strong> {fmtMoney(settings.serviceFee)} will be collected from the customer.
            </div>
          </div>
        );

      case 'agreement':
        return (
          <div>
            <h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '16px' }}>📄 Agreement Form Preview</h3>
            <div style={S.alert('info')}>
              Review all details below. When ready, click <strong>"Print Agreement"</strong> to print both the Business Copy and Customer Copy. Then read every clause aloud to the customer before signing.
            </div>
            <div style={{ border: `2px solid ${COLORS.border}`, borderRadius: '12px', padding: '20px', background: '#fff' }}>
              <div style={{ textAlign: 'center', marginBottom: '16px' }}>
                <div style={{ fontSize: '16px', fontWeight: 800 }}>CHRIST-IN-FABIAN QUICK CASH</div>
                <div style={{ fontSize: '12px', color: COLORS.textMuted }}>Cash Advance & Buy-Back Agreement — BUSINESS COPY</div>
                <div style={{ fontSize: '13px', fontWeight: 700, marginTop: '4px' }}>Ref: {tx.ref}</div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '4px 12px', fontSize: '13px' }}>
                <strong>Full Name:</strong><span>{tx.fullName}</span>
                <strong>Address:</strong><span>{tx.address}</span>
                <strong>ID Type:</strong><span>{tx.idType.toUpperCase()}</span>
                <strong>ID Number:</strong><span>{tx.idNumber}</span>
                <strong>Phone(s):</strong><span>{tx.phoneNumbers.filter(Boolean).join(', ')}</span>
                <strong>Family Contact:</strong><span>{tx.familyName} ({tx.familyRelation}) — {tx.familyPhone}</span>
                <strong>Item:</strong><span>{tx.aiItemType} / {tx.aiBrand} / {tx.aiModel}</span>
                <strong>Colour:</strong><span>{tx.aiColour}</span>
                <strong>Condition:</strong><span>{tx.conditionDescription}</span>
                {tx.imei && <><strong>IMEI:</strong><span>{tx.imei}</span></>}
                {tx.serialNumber && <><strong>Serial:</strong><span>{tx.serialNumber}</span></>}
                <strong>Est. Value:</strong><span>{fmtMoney(tx.estimatedValue)} (internal)</span>
                <strong>Cash {tx.type === 'outright' ? 'Paid' : 'Advance'}:</strong><span style={{ fontWeight: 700, color: COLORS.primary }}>{fmtMoney(tx.cashAdvance)}</span>
                {tx.type === 'advance' && <><strong>Date Given:</strong><span>{fmtDate(tx.dateGiven)}</span></>}
                {tx.type === 'advance' && <><strong>Deadline:</strong><span>{fmtDate(tx.deadlineDate)}</span></>}
                {tx.type === 'advance' && <><strong>Daily Fee:</strong><span>{fmtMoney(dailyFeeCalc)} per day</span></>}
              </div>
            </div>
            <div style={{ display: 'flex', gap: '12px', marginTop: '16px' }}>
              <button style={S.btn('accent')} onClick={() => window.print()}>🖨 Print Agreement (Both Copies)</button>
            </div>
            <div style={{ marginTop: '16px' }}>
              <h4 style={{ fontSize: '14px', fontWeight: 700, marginBottom: '8px' }}>After printing & reading to customer:</h4>
              <PhotoUpload label="Photo of Signing / Thumbprint" value={tx.photoSigning} onChange={v => upd('photoSigning', v)} size={140} />
            </div>
          </div>
        );

      case 'complete':
        return (
          <div>
            <h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '16px' }}>✅ Finalize Transaction</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {tx.type === 'advance' && (
                <div>
                  <h4 style={{ fontSize: '14px', fontWeight: 700, marginBottom: '8px' }}>Package & Seal</h4>
                  <PhotoUpload label="Sealed Package Photo" value={tx.photoSealedPkg} onChange={v => upd('photoSealedPkg', v)} size={140} />
                </div>
              )}
              <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', padding: '12px', background: COLORS.accentLight, borderRadius: '8px' }}>
                <input type="checkbox" checked={tx.serviceFeeCollected} onChange={e => upd('serviceFeeCollected', e.target.checked)} style={{ width: '20px', height: '20px' }} />
                <span style={{ fontSize: '14px', fontWeight: 600 }}>₦{settings.serviceFee} service fee collected from customer</span>
              </label>
              <div style={{ ...S.card, background: COLORS.primaryLight, border: `2px solid ${COLORS.primary}`, textAlign: 'center' }}>
                <div style={{ fontSize: '14px', fontWeight: 600, marginBottom: '8px' }}>Cash {tx.type === 'outright' ? 'Paid to Customer' : 'Advance Given'}</div>
                <div style={{ fontSize: '32px', fontWeight: 800, color: COLORS.primary }}>{fmtMoney(tx.cashAdvance)}</div>
                <div style={{ fontSize: '12px', color: COLORS.textMuted, marginTop: '4px' }}>
                  Count the money in front of the customer. Let them count it too.
                </div>
              </div>
              <button style={{ ...S.btn('primary'), padding: '16px', fontSize: '16px', justifyContent: 'center' }} onClick={handleComplete}>
                ✅ Complete Transaction — Save & Close
              </button>
            </div>
          </div>
        );

      default:
        return <div>Unknown step</div>;
    }
  };

  return (
    <div>
      {/* Wizard Step Bar */}
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '20px', padding: '12px', background: '#fff', borderRadius: '12px', border: `1px solid ${COLORS.border}` }}>
        {WIZARD_STEPS.map((s, i) => (
          <div key={s.id} style={S.wizStep(i === step, i < step)} onClick={() => i < step && setStep(i)}>
            {s.icon} {s.label}
          </div>
        ))}
      </div>
      {/* Step Content */}
      <div style={S.card}>
        {renderStepContent()}
      </div>
      {/* Navigation */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '12px' }}>
        <div style={{ display: 'flex', gap: '8px' }}>
          {step > 0 && <button style={S.btn('outline')} onClick={prev}>← Back</button>}
          <button style={S.btn('muted')} onClick={onCancel}>Save Draft & Exit</button>
        </div>
        {step < WIZARD_STEPS.length - 1 && (
          <button style={S.btn('primary')} onClick={next} disabled={!canProceed()}>
            Next Step →
          </button>
        )}
      </div>
    </div>
  );
}

// ============================================================
// REPAYMENT MODAL
// ============================================================
function RepaymentModal({ tx, settings, onClose, onSave }) {
  const days = daysBetween(tx.dateGiven);
  const dailyFee = Math.floor((tx.cashAdvance || 0) * (settings.interestRate || 1) / 100);
  const totalFees = days * dailyFee;
  const totalDue = (tx.cashAdvance || 0) + totalFees;
  const [confirmed, setConfirmed] = useState(false);

  const handleRepay = () => {
    onSave({
      ...tx,
      status: 'closed',
      amountRepaid: totalDue,
      dateRepaid: new Date().toISOString().split('T')[0],
      daysCharged: days,
      totalFees,
      itemReturned: true,
    });
  };

  return (
    <div>
      <div style={{ ...S.card, background: COLORS.bg }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
          <div><span style={S.statLabel}>Customer</span><br /><strong>{tx.fullName}</strong></div>
          <div><span style={S.statLabel}>Item</span><br /><strong>{tx.aiItemType} {tx.aiBrand} {tx.aiModel}</strong></div>
          <div><span style={S.statLabel}>Cash Advance</span><br /><strong style={{ fontSize: '18px' }}>{fmtMoney(tx.cashAdvance)}</strong></div>
          <div><span style={S.statLabel}>Date Given</span><br /><strong>{fmtDate(tx.dateGiven)}</strong></div>
          <div><span style={S.statLabel}>Days Elapsed</span><br /><strong style={{ fontSize: '18px' }}>{days} days</strong></div>
          <div><span style={S.statLabel}>Daily Fee</span><br /><strong>{fmtMoney(dailyFee)} × {days} = {fmtMoney(totalFees)}</strong></div>
        </div>
      </div>
      <div style={{ ...S.card, background: COLORS.primaryLight, border: `2px solid ${COLORS.primary}`, textAlign: 'center' }}>
        <div style={S.statLabel}>Total Amount Due</div>
        <div style={{ fontSize: '32px', fontWeight: 800, color: COLORS.primary }}>{fmtMoney(totalDue)}</div>
        <div style={{ fontSize: '12px', color: COLORS.textMuted }}>{fmtMoney(tx.cashAdvance)} advance + {fmtMoney(totalFees)} fees ({days} days)</div>
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', marginBottom: '16px' }}>
        <input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} style={{ width: '20px', height: '20px' }} />
        <span style={{ fontSize: '14px', fontWeight: 600 }}>Customer has paid {fmtMoney(totalDue)} in full and item has been returned</span>
      </label>
      <div style={{ display: 'flex', gap: '12px' }}>
        <button style={S.btn('primary')} disabled={!confirmed} onClick={handleRepay}>✅ Confirm Repayment</button>
        <button style={S.btn('outline')} onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}

// ============================================================
// SALE MODAL
// ============================================================
function SaleModal({ tx, settings, onClose, onSave }) {
  const days = 33;
  const dailyFee = Math.floor((tx.cashAdvance || 0) * (settings.interestRate || 1) / 100);
  const totalFees = days * dailyFee;
  const minPrice = (tx.cashAdvance || 0) + totalFees + Math.floor((tx.cashAdvance || 0) * (settings.minSellBonus || 20) / 100);
  const targetPrice = Math.floor((tx.estimatedValue || 0) * (settings.targetSellPct || 75) / 100);
  const listedPrice = Math.max(targetPrice, minPrice);
  const [salePrice, setSalePrice] = useState(listedPrice);
  const [saleDate, setSaleDate] = useState(new Date().toISOString().split('T')[0]);
  const [saleBuyer, setSaleBuyer] = useState('');

  const handleSell = () => {
    onSave({
      ...tx,
      status: 'sold',
      salePrice,
      saleDate,
      saleBuyer,
    });
  };

  return (
    <div>
      <div style={S.grid3}>
        <div style={S.stat}>
          <div style={S.statLabel}>Minimum Price</div>
          <div style={{ ...S.statValue, color: COLORS.danger }}>{fmtMoney(minPrice)}</div>
        </div>
        <div style={S.stat}>
          <div style={S.statLabel}>Target Price (75%)</div>
          <div style={S.statValue}>{fmtMoney(targetPrice)}</div>
        </div>
        <div style={S.stat}>
          <div style={S.statLabel}>Listed Price</div>
          <div style={{ ...S.statValue, color: COLORS.accent }}>{fmtMoney(listedPrice)}</div>
        </div>
      </div>
      <Field label="Sale Price (₦)" required style={{ marginTop: '16px' }}>
        <input style={{ ...S.input, fontSize: '18px', fontWeight: 700 }} type="number" value={salePrice} onChange={e => setSalePrice(Number(e.target.value))} />
        {salePrice < minPrice && <div style={{ color: COLORS.danger, fontSize: '12px', marginTop: '4px' }}>⚠ Below minimum price of {fmtMoney(minPrice)}</div>}
      </Field>
      <div style={S.grid2}>
        <Field label="Sale Date" required>
          <input style={S.input} type="date" value={saleDate} onChange={e => setSaleDate(e.target.value)} />
        </Field>
        <Field label="Buyer Name / Info">
          <input style={S.input} value={saleBuyer} onChange={e => setSaleBuyer(e.target.value)} placeholder="Buyer info (optional)" />
        </Field>
      </div>
      <div style={{ ...S.card, background: COLORS.primaryLight, textAlign: 'center', marginTop: '8px' }}>
        <div style={S.statLabel}>Profit from this sale</div>
        <div style={{ fontSize: '28px', fontWeight: 800, color: salePrice - tx.cashAdvance > 0 ? COLORS.primary : COLORS.danger }}>
          {fmtMoney(salePrice - tx.cashAdvance)}
        </div>
      </div>
      <div style={{ display: 'flex', gap: '12px', marginTop: '16px' }}>
        <button style={S.btn('primary')} onClick={handleSell} disabled={salePrice < minPrice}>Record Sale</button>
        <button style={S.btn('outline')} onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}

// ============================================================
// TRANSACTION DETAIL VIEW
// ============================================================
function TransactionDetail({ tx, onClose, settings }) {
  const days = daysBetween(tx.dateGiven);
  const dailyFee = Math.floor((tx.cashAdvance || 0) * (settings.interestRate || 1) / 100);

  return (
    <div>
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <span style={S.badge(statusColor(tx))}>{statusLabel(tx)}</span>
        <span style={{ ...S.badge('#6b7280') }}>{tx.type === 'outright' ? 'Outright Purchase' : 'Cash Advance'}</span>
        <span style={{ ...S.badge(COLORS.primary) }}>Ref: {tx.ref}</span>
      </div>
      <div style={S.grid2}>
        <div style={S.card}>
          <div style={S.cardTitle}>👤 Customer</div>
          <div style={{ fontSize: '13px', display: 'grid', gridTemplateColumns: '100px 1fr', gap: '4px 8px' }}>
            <strong>Name:</strong><span>{tx.fullName}</span>
            <strong>Address:</strong><span>{tx.address}</span>
            <strong>Phone(s):</strong><span>{tx.phoneNumbers?.filter(Boolean).join(', ')}</span>
            <strong>Family:</strong><span>{tx.familyName} ({tx.familyRelation}) — {tx.familyPhone}</span>
            <strong>ID:</strong><span>{tx.idType?.toUpperCase()} — {tx.idNumber}</span>
          </div>
        </div>
        <div style={S.card}>
          <div style={S.cardTitle}>📦 Item</div>
          <div style={{ fontSize: '13px', display: 'grid', gridTemplateColumns: '100px 1fr', gap: '4px 8px' }}>
            <strong>Type:</strong><span>{tx.aiItemType}</span>
            <strong>Brand:</strong><span>{tx.aiBrand}</span>
            <strong>Model:</strong><span>{tx.aiModel}</span>
            <strong>Colour:</strong><span>{tx.aiColour}</span>
            {tx.imei && <><strong>IMEI:</strong><span>{tx.imei}</span></>}
            {tx.serialNumber && <><strong>Serial:</strong><span>{tx.serialNumber}</span></>}
            <strong>Condition:</strong><span>{tx.conditionDescription}</span>
          </div>
        </div>
      </div>
      <div style={S.card}>
        <div style={S.cardTitle}>💰 Financial Details</div>
        <div style={S.grid4}>
          <div style={S.stat}>
            <div style={S.statLabel}>Est. Value</div>
            <div style={S.statValue}>{fmtMoney(tx.estimatedValue)}</div>
          </div>
          <div style={S.stat}>
            <div style={S.statLabel}>Cash Given</div>
            <div style={S.statValue}>{fmtMoney(tx.cashAdvance)}</div>
          </div>
          {tx.type === 'advance' && (
            <>
              <div style={S.stat}>
                <div style={S.statLabel}>Days / Daily Fee</div>
                <div style={S.statValue}>{days}d × {fmtMoney(dailyFee)}</div>
              </div>
              <div style={S.stat}>
                <div style={S.statLabel}>Total Due Today</div>
                <div style={{ ...S.statValue, color: COLORS.danger }}>{fmtMoney(tx.cashAdvance + days * dailyFee)}</div>
              </div>
            </>
          )}
        </div>
        {tx.type === 'advance' && (
          <div style={{ marginTop: '12px', fontSize: '13px', color: COLORS.textMuted }}>
            <strong>Date Given:</strong> {fmtDate(tx.dateGiven)} | <strong>Deadline:</strong> {fmtDate(tx.deadlineDate)}
          </div>
        )}
        {tx.status === 'closed' && (
          <div style={{ marginTop: '12px', padding: '12px', background: COLORS.primaryLight, borderRadius: '8px' }}>
            <strong>Repaid:</strong> {fmtMoney(tx.amountRepaid)} on {fmtDate(tx.dateRepaid)} ({tx.daysCharged} days, {fmtMoney(tx.totalFees)} fees)
          </div>
        )}
        {tx.status === 'sold' && (
          <div style={{ marginTop: '12px', padding: '12px', background: COLORS.accentLight, borderRadius: '8px' }}>
            <strong>Sold:</strong> {fmtMoney(tx.salePrice)} on {fmtDate(tx.saleDate)} | <strong>Profit:</strong> {fmtMoney(tx.salePrice - tx.cashAdvance)}
          </div>
        )}
      </div>
      {/* Photos */}
      <div style={S.card}>
        <div style={S.cardTitle}>📸 Photos</div>
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          {tx.photoCustomerHolding && <img src={tx.photoCustomerHolding} style={{ width: '100px', height: '100px', borderRadius: '8px', objectFit: 'cover' }} alt="Customer" />}
          {tx.photoCustomerID && <img src={tx.photoCustomerID} style={{ width: '100px', height: '100px', borderRadius: '8px', objectFit: 'cover' }} alt="ID" />}
          {tx.itemPhotos?.front && <img src={tx.itemPhotos.front} style={{ width: '100px', height: '100px', borderRadius: '8px', objectFit: 'cover' }} alt="Front" />}
          {tx.itemPhotos?.back && <img src={tx.itemPhotos.back} style={{ width: '100px', height: '100px', borderRadius: '8px', objectFit: 'cover' }} alt="Back" />}
          {tx.photoSigning && <img src={tx.photoSigning} style={{ width: '100px', height: '100px', borderRadius: '8px', objectFit: 'cover' }} alt="Signing" />}
          {tx.photoSealedPkg && <img src={tx.photoSealedPkg} style={{ width: '100px', height: '100px', borderRadius: '8px', objectFit: 'cover' }} alt="Sealed" />}
        </div>
      </div>
      {/* Contact Log */}
      {tx.contactLog?.length > 0 && (
        <div style={S.card}>
          <div style={S.cardTitle}>📞 Contact Log</div>
          {tx.contactLog.map((log, i) => (
            <div key={i} style={{ fontSize: '13px', padding: '6px 0', borderBottom: `1px solid ${COLORS.border}` }}>
              <strong>{fmtDate(log.date)}</strong> — {log.method}: {log.note}
            </div>
          ))}
        </div>
      )}
      <button style={S.btn('outline')} onClick={onClose}>← Back to List</button>
    </div>
  );
}

// ============================================================
// MAIN APPLICATION
// ============================================================
export default function App() {
  const [currentUser, setCurrentUser] = useState(null);
  const [page, setPage] = useState('dashboard');
  const [transactions, setTransactions] = useState([]);
  const [drafts, setDrafts] = useState([]);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [users, setUsers] = useState(DEFAULT_USERS);
  const [expenses, setExpenses] = useState([]);
  const [capital, setCapital] = useState([]);
  const [declinedLog, setDeclinedLog] = useState([]);
  const [loading, setLoading] = useState(true);

  // Sub-states
  const [editingTx, setEditingTx] = useState(null);
  const [viewingTx, setViewingTx] = useState(null);
  const [repayingTx, setRepayingTx] = useState(null);
  const [sellingTx, setSellingTx] = useState(null);
  const [showAddExpense, setShowAddExpense] = useState(false);
  const [showAddCapital, setShowAddCapital] = useState(false);
  const [showAddDeclined, setShowAddDeclined] = useState(false);
  const [showAddUser, setShowAddUser] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Load data from storage
  useEffect(() => {
    (async () => {
      const s = await DB.get('settings');
      if (s) setSettings({ ...DEFAULT_SETTINGS, ...s });
      const u = await DB.get('users');
      if (u) setUsers(u);
      const e = await DB.get('expenses');
      if (e) setExpenses(e);
      const c = await DB.get('capital');
      if (c) setCapital(c);
      const d = await DB.get('declinedLog');
      if (d) setDeclinedLog(d);

      // Load transactions
      const txKeys = await DB.list('tx-');
      const txs = [];
      for (const key of txKeys) {
        const t = await DB.get(key);
        if (t) txs.push(t);
      }
      setTransactions(txs);

      // Load drafts
      const draftKeys = await DB.list('draft-');
      const drs = [];
      for (const key of draftKeys) {
        const dr = await DB.get(key);
        if (dr) drs.push(dr);
      }
      setDrafts(drs);
      setLoading(false);
    })();
  }, []);

  // Save helpers
  const saveSettings = async (s) => { setSettings(s); await DB.set('settings', s); };
  const saveUsers = async (u) => { setUsers(u); await DB.set('users', u); };
  const saveExpenses = async (e) => { setExpenses(e); await DB.set('expenses', e); };
  const saveCapital = async (c) => { setCapital(c); await DB.set('capital', c); };
  const saveDeclined = async (d) => { setDeclinedLog(d); await DB.set('declinedLog', d); };

  const saveTx = async (tx) => {
    await DB.set(`tx-${tx.ref}`, tx);
    setTransactions(prev => {
      const existing = prev.findIndex(t => t.ref === tx.ref);
      if (existing >= 0) { const n = [...prev]; n[existing] = tx; return n; }
      return [...prev, tx];
    });
  };

  // Computed stats
  const activeTxs = transactions.filter(t => t.status === 'active');
  const closedTxs = transactions.filter(t => t.status === 'closed');
  const soldTxs = transactions.filter(t => t.status === 'sold');
  const forSaleTxs = transactions.filter(t => t.status === 'for_sale');
  const pastDeadline = activeTxs.filter(t => {
    const days = daysBetween(t.dateGiven);
    return days > (t.loanDays || 30);
  });
  const totalCapitalOut = activeTxs.reduce((s, t) => s + (t.cashAdvance || 0), 0);
  const totalInterestEarned = closedTxs.reduce((s, t) => s + (t.totalFees || 0), 0);
  const totalSalesRevenue = soldTxs.reduce((s, t) => s + (t.salePrice || 0), 0);
  const totalServiceFees = transactions.filter(t => t.status !== 'declined').length * (settings.serviceFee || 1000);
  const totalRevenue = totalInterestEarned + totalSalesRevenue + totalServiceFees;
  const totalExpenses = expenses.reduce((s, e) => s + (e.amount || 0), 0);

  // Search/filter
  const filteredTxs = useMemo(() => {
    if (!searchQuery) return transactions;
    const q = searchQuery.toLowerCase();
    return transactions.filter(t =>
      t.ref?.toLowerCase().includes(q) ||
      t.fullName?.toLowerCase().includes(q) ||
      t.phoneNumbers?.some(p => p?.includes(q)) ||
      t.imei?.includes(q) ||
      t.aiItemType?.toLowerCase().includes(q) ||
      t.aiBrand?.toLowerCase().includes(q)
    );
  }, [transactions, searchQuery]);

  if (!currentUser) {
    return <LoginScreen onLogin={setCurrentUser} users={users} />;
  }

  if (loading) {
    return <div style={{ ...S.app, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ textAlign: 'center' }}><div style={{ fontSize: '48px', marginBottom: '12px' }}>💰</div><div style={{ fontWeight: 700 }}>Loading...</div></div>
    </div>;
  }

  // Wizard mode
  if (editingTx !== null) {
    return (
      <div style={S.app}>
        <div style={S.topBar}>
          <div style={{ fontWeight: 700 }}>💰 CFC Quick Cash — New Transaction</div>
          <button style={{ ...S.btnSm('danger') }} onClick={() => { setEditingTx(null); setPage('transactions'); }}>✕ Exit Wizard</button>
        </div>
        <div style={{ padding: '20px', maxWidth: '900px', margin: '0 auto' }}>
          <TransactionWizard
            settings={settings}
            draft={editingTx === 'new' ? null : editingTx}
            currentUser={currentUser}
            onSave={(tx) => { saveTx(tx); setEditingTx(null); setPage('transactions'); }}
            onCancel={() => { setEditingTx(null); setPage('transactions'); }}
          />
        </div>
      </div>
    );
  }

  const isStaff = currentUser.role === 'staff' || currentUser.role === 'admin';
  const isAdmin = currentUser.role === 'admin';

  // NAV ITEMS
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
    { id: 'users', label: 'User Management', icon: '👥', roles: ['admin'] },
  ].filter(n => n.roles.includes(currentUser.role));

  // ============================================================
  // RENDER PAGES
  // ============================================================
  const renderPage = () => {
    // Transaction detail view
    if (viewingTx) {
      return <TransactionDetail tx={viewingTx} settings={settings} onClose={() => setViewingTx(null)} />;
    }

    switch (page) {
      // ---- DASHBOARD ----
      case 'dashboard':
        return (
          <div>
            <h2 style={{ fontSize: '20px', fontWeight: 800, marginBottom: '20px', color: COLORS.primaryDark }}>
              {currentUser.role === 'stakeholder' ? '📊 Business Overview' : '📊 Dashboard'}
            </h2>
            <div style={S.grid4}>
              <div style={S.stat}><div style={S.statLabel}>Capital Out</div><div style={S.statValue}>{fmtMoney(totalCapitalOut)}</div></div>
              <div style={S.stat}><div style={S.statLabel}>Active Loans</div><div style={S.statValue}>{activeTxs.length}</div></div>
              <div style={S.stat}><div style={S.statLabel}>Total Revenue</div><div style={S.statValue}>{fmtMoney(totalRevenue)}</div></div>
              <div style={{ ...S.stat, background: pastDeadline.length > 0 ? COLORS.dangerLight : COLORS.primaryLight }}>
                <div style={S.statLabel}>Past Deadline</div>
                <div style={{ ...S.statValue, color: pastDeadline.length > 0 ? COLORS.danger : COLORS.primary }}>{pastDeadline.length}</div>
              </div>
            </div>
            {/* Recent Transactions */}
            <div style={S.card}>
              <div style={S.cardTitle}>Recent Transactions</div>
              <table style={S.table}>
                <thead>
                  <tr>
                    <th style={S.th}>Ref</th><th style={S.th}>Customer</th><th style={S.th}>Item</th>
                    <th style={S.th}>Amount</th><th style={S.th}>Status</th><th style={S.th}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.slice(-10).reverse().map(tx => (
                    <tr key={tx.ref}>
                      <td style={S.td}><strong>{tx.ref}</strong></td>
                      <td style={S.td}>{tx.fullName}</td>
                      <td style={S.td}>{tx.aiBrand} {tx.aiModel}</td>
                      <td style={S.td}>{fmtMoney(tx.cashAdvance)}</td>
                      <td style={S.td}><span style={S.badge(statusColor(tx))}>{statusLabel(tx)}</span></td>
                      <td style={S.td}><button style={S.btnSm('primary')} onClick={() => setViewingTx(tx)}>View</button></td>
                    </tr>
                  ))}
                  {transactions.length === 0 && <tr><td style={S.td} colSpan={6}>No transactions yet. Create your first one!</td></tr>}
                </tbody>
              </table>
            </div>
            {/* Drafts */}
            {drafts.length > 0 && isStaff && (
              <div style={S.card}>
                <div style={S.cardTitle}>📝 In-Progress Drafts</div>
                {drafts.map(d => (
                  <div key={d.ref} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px', borderBottom: `1px solid ${COLORS.border}` }}>
                    <div>
                      <strong>{d.ref}</strong> — {d.fullName || 'No name yet'} — Step {(d.wizardStep || 0) + 1}
                    </div>
                    <button style={S.btnSm('accent')} onClick={() => setEditingTx(d)}>Resume</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        );

      // ---- NEW TRANSACTION ----
      case 'newTx':
        setEditingTx('new');
        return null;

      // ---- ALL TRANSACTIONS ----
      case 'transactions':
        return (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h2 style={{ fontSize: '20px', fontWeight: 800, color: COLORS.primaryDark }}>📋 All Transactions</h2>
              <input style={{ ...S.input, width: '300px' }} placeholder="🔍 Search by name, ref, phone, IMEI..."
                value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
            </div>
            <div style={S.card}>
              <table style={S.table}>
                <thead>
                  <tr>
                    <th style={S.th}>Ref</th><th style={S.th}>Customer</th><th style={S.th}>Item</th>
                    <th style={S.th}>Amount</th><th style={S.th}>Date</th><th style={S.th}>Status</th><th style={S.th}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {(searchQuery ? filteredTxs : transactions).slice().reverse().map(tx => (
                    <tr key={tx.ref}>
                      <td style={S.td}><strong>{tx.ref}</strong></td>
                      <td style={S.td}>{tx.fullName}</td>
                      <td style={S.td}>{tx.aiItemType} {tx.aiBrand} {tx.aiModel}</td>
                      <td style={S.td}>{fmtMoney(tx.cashAdvance)}</td>
                      <td style={S.td}>{fmtDate(tx.dateGiven)}</td>
                      <td style={S.td}><span style={S.badge(statusColor(tx))}>{statusLabel(tx)}</span></td>
                      <td style={S.td}>
                        <div style={{ display: 'flex', gap: '4px' }}>
                          <button style={S.btnSm('primary')} onClick={() => setViewingTx(tx)}>View</button>
                          {tx.status === 'active' && isStaff && <button style={S.btnSm('accent')} onClick={() => setRepayingTx(tx)}>Collect</button>}
                          {(tx.status === 'for_sale' || (tx.status === 'active' && daysBetween(tx.dateGiven) > (tx.loanDays || 30) + 3)) && isStaff && (
                            <button style={S.btnSm('danger')} onClick={() => setSellingTx(tx)}>Sell</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );

      // ---- ACTIVE LOANS ----
      case 'active':
        return (
          <div>
            <h2 style={{ fontSize: '20px', fontWeight: 800, marginBottom: '20px', color: COLORS.primaryDark }}>⏳ Active Loans</h2>
            <div style={S.card}>
              <table style={S.table}>
                <thead>
                  <tr>
                    <th style={S.th}>Ref</th><th style={S.th}>Customer</th><th style={S.th}>Item</th>
                    <th style={S.th}>Amount</th><th style={S.th}>Given</th><th style={S.th}>Deadline</th>
                    <th style={S.th}>Days Left</th><th style={S.th}>Status</th><th style={S.th}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {activeTxs.sort((a, b) => new Date(a.deadlineDate) - new Date(b.deadlineDate)).map(tx => {
                    const days = daysBetween(tx.dateGiven);
                    const deadline = tx.loanDays || 30;
                    const left = deadline - days;
                    return (
                      <tr key={tx.ref}>
                        <td style={S.td}><strong>{tx.ref}</strong></td>
                        <td style={S.td}>{tx.fullName}</td>
                        <td style={S.td}>{tx.aiBrand} {tx.aiModel}</td>
                        <td style={S.td}>{fmtMoney(tx.cashAdvance)}</td>
                        <td style={S.td}>{fmtDate(tx.dateGiven)}</td>
                        <td style={S.td}>{fmtDate(tx.deadlineDate)}</td>
                        <td style={S.td}>
                          <strong style={{ color: left <= 0 ? COLORS.danger : left <= 7 ? COLORS.warning : COLORS.primary }}>
                            {left <= 0 ? `${Math.abs(left)} days OVER` : `${left} days`}
                          </strong>
                        </td>
                        <td style={S.td}><span style={S.badge(statusColor(tx))}>{statusLabel(tx)}</span></td>
                        <td style={S.td}>
                          <div style={{ display: 'flex', gap: '4px' }}>
                            <button style={S.btnSm('primary')} onClick={() => setViewingTx(tx)}>View</button>
                            {isStaff && <button style={S.btnSm('accent')} onClick={() => setRepayingTx(tx)}>Collect</button>}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {activeTxs.length === 0 && <tr><td style={S.td} colSpan={9}>No active loans.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        );

      // ---- DEADLINES & ALERTS ----
      case 'deadlines':
        const upcoming7 = activeTxs.filter(t => { const l = (t.loanDays || 30) - daysBetween(t.dateGiven); return l <= 7 && l > 0; });
        const upcoming3 = activeTxs.filter(t => { const l = (t.loanDays || 30) - daysBetween(t.dateGiven); return l <= 3 && l > 0; });
        const atDeadline = activeTxs.filter(t => daysBetween(t.dateGiven) === (t.loanDays || 30));
        const inGrace = activeTxs.filter(t => { const d = daysBetween(t.dateGiven); return d > (t.loanDays || 30) && d <= (t.loanDays || 30) + 3; });
        const readyToSell = activeTxs.filter(t => daysBetween(t.dateGiven) > (t.loanDays || 30) + 3);

        const AlertGroup = ({ title, items, color, icon }) => (
          items.length > 0 && (
            <div style={{ ...S.card, borderLeft: `4px solid ${color}` }}>
              <div style={{ ...S.cardTitle, color }}>{icon} {title} ({items.length})</div>
              {items.map(tx => (
                <div key={tx.ref} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: `1px solid ${COLORS.border}` }}>
                  <div>
                    <strong>{tx.ref}</strong> — {tx.fullName} — {tx.aiBrand} {tx.aiModel} — {fmtMoney(tx.cashAdvance)}
                    <br /><span style={{ fontSize: '12px', color: COLORS.textMuted }}>Phone: {tx.phoneNumbers?.[0]} | Deadline: {fmtDate(tx.deadlineDate)}</span>
                  </div>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <button style={S.btnSm('primary')} onClick={() => setViewingTx(tx)}>View</button>
                    <button style={S.btnSm('accent')} onClick={() => setRepayingTx(tx)}>Collect</button>
                  </div>
                </div>
              ))}
            </div>
          )
        );

        return (
          <div>
            <h2 style={{ fontSize: '20px', fontWeight: 800, marginBottom: '20px', color: COLORS.primaryDark }}>🔔 Deadlines & Alerts</h2>
            <AlertGroup title="READY TO SELL (Past Grace)" items={readyToSell} color="#1e1e1e" icon="🏷" />
            <AlertGroup title="IN GRACE PERIOD (Days 31–33)" items={inGrace} color="#7c3aed" icon="⏰" />
            <AlertGroup title="AT DEADLINE (Day 30)" items={atDeadline} color={COLORS.danger} icon="🚨" />
            <AlertGroup title="3 Days or Less" items={upcoming3} color={COLORS.warning} icon="⚠" />
            <AlertGroup title="7 Days or Less" items={upcoming7} color="#f59e0b" icon="📅" />
            {upcoming7.length + upcoming3.length + atDeadline.length + inGrace.length + readyToSell.length === 0 && (
              <div style={S.card}><p style={{ color: COLORS.textMuted, textAlign: 'center' }}>No deadline alerts at this time. All clear! ✅</p></div>
            )}
          </div>
        );

      // ---- FOR SALE ----
      case 'forSale':
        const sellable = [...forSaleTxs, ...transactions.filter(t => t.status === 'active' && daysBetween(t.dateGiven) > (t.loanDays || 30) + 3)];
        return (
          <div>
            <h2 style={{ fontSize: '20px', fontWeight: 800, marginBottom: '20px', color: COLORS.primaryDark }}>🏷 Items for Sale</h2>
            <div style={S.card}>
              <table style={S.table}>
                <thead>
                  <tr>
                    <th style={S.th}>Ref</th><th style={S.th}>Item</th><th style={S.th}>Capital Out</th>
                    <th style={S.th}>Min Price</th><th style={S.th}>Target Price</th><th style={S.th}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {sellable.map(tx => {
                    const dailyFee = Math.floor((tx.cashAdvance || 0) * (settings.interestRate || 1) / 100);
                    const minPrice = (tx.cashAdvance || 0) + 33 * dailyFee + Math.floor((tx.cashAdvance || 0) * (settings.minSellBonus || 20) / 100);
                    const targetPrice = Math.floor((tx.estimatedValue || 0) * (settings.targetSellPct || 75) / 100);
                    return (
                      <tr key={tx.ref}>
                        <td style={S.td}><strong>{tx.ref}</strong></td>
                        <td style={S.td}>{tx.aiItemType} {tx.aiBrand} {tx.aiModel}</td>
                        <td style={S.td}>{fmtMoney(tx.cashAdvance)}</td>
                        <td style={S.td}>{fmtMoney(minPrice)}</td>
                        <td style={S.td}><strong>{fmtMoney(Math.max(targetPrice, minPrice))}</strong></td>
                        <td style={S.td}>
                          <button style={S.btnSm('danger')} onClick={() => setSellingTx(tx)}>Record Sale</button>
                        </td>
                      </tr>
                    );
                  })}
                  {sellable.length === 0 && <tr><td style={S.td} colSpan={6}>No items currently for sale.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        );

      // ---- MONTHLY REPORT ----
      case 'reports':
        const netProfit = totalRevenue - totalExpenses;
        const fabianComp = Math.floor(netProfit * 0.10);
        const stakeholderProfit = netProfit - fabianComp;
        const totalCapitalContrib = capital.reduce((s, c) => s + (c.amount || 0), 0);
        return (
          <div>
            <h2 style={{ fontSize: '20px', fontWeight: 800, marginBottom: '20px', color: COLORS.primaryDark }}>📈 Monthly Report</h2>
            <div style={S.grid3}>
              <div style={S.stat}><div style={S.statLabel}>Total Revenue</div><div style={S.statValue}>{fmtMoney(totalRevenue)}</div></div>
              <div style={S.stat}><div style={S.statLabel}>Total Expenses</div><div style={{ ...S.statValue, color: COLORS.danger }}>{fmtMoney(totalExpenses)}</div></div>
              <div style={S.stat}><div style={S.statLabel}>Net Profit</div><div style={{ ...S.statValue, color: netProfit > 0 ? COLORS.primary : COLORS.danger }}>{fmtMoney(netProfit)}</div></div>
            </div>
            <div style={S.card}>
              <div style={S.cardTitle}>Revenue Breakdown</div>
              <div style={S.grid3}>
                <div><span style={S.statLabel}>Interest Earned</span><div style={{ fontSize: '18px', fontWeight: 700 }}>{fmtMoney(totalInterestEarned)}</div></div>
                <div><span style={S.statLabel}>Service Fees</span><div style={{ fontSize: '18px', fontWeight: 700 }}>{fmtMoney(totalServiceFees)}</div></div>
                <div><span style={S.statLabel}>Item Sales</span><div style={{ fontSize: '18px', fontWeight: 700 }}>{fmtMoney(totalSalesRevenue)}</div></div>
              </div>
            </div>
            <div style={S.grid2}>
              <div style={S.card}>
                <div style={S.cardTitle}>Fabian's Compensation (10%)</div>
                <div style={{ fontSize: '24px', fontWeight: 800, color: COLORS.accent }}>{fmtMoney(fabianComp)}</div>
              </div>
              <div style={S.card}>
                <div style={S.cardTitle}>Stakeholder Profit</div>
                <div style={{ fontSize: '24px', fontWeight: 800, color: COLORS.primary }}>{fmtMoney(stakeholderProfit)}</div>
              </div>
            </div>
            <div style={S.card}>
              <div style={S.cardTitle}>Profit Distribution</div>
              {capital.length > 0 ? capital.map(c => {
                const pct = totalCapitalContrib > 0 ? (c.amount / totalCapitalContrib * 100) : 0;
                return (
                  <div key={c.name} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: `1px solid ${COLORS.border}` }}>
                    <span><strong>{c.name}</strong> — {fmtMoney(c.amount)} ({pct.toFixed(1)}%)</span>
                    <strong style={{ color: COLORS.primary }}>{fmtMoney(Math.floor(stakeholderProfit * pct / 100))}</strong>
                  </div>
                );
              }) : <p style={{ color: COLORS.textMuted }}>No capital contributions recorded yet. Go to Capital & Profits to add.</p>}
            </div>
            <div style={S.card}>
              <div style={S.cardTitle}>Business Snapshot</div>
              <div style={S.grid4}>
                <div><span style={S.statLabel}>Total Transactions</span><div style={{ fontWeight: 700 }}>{transactions.length}</div></div>
                <div><span style={S.statLabel}>Active Loans</span><div style={{ fontWeight: 700 }}>{activeTxs.length}</div></div>
                <div><span style={S.statLabel}>Items in Storage</span><div style={{ fontWeight: 700 }}>{activeTxs.length + forSaleTxs.length}</div></div>
                <div><span style={S.statLabel}>Past Deadline</span><div style={{ fontWeight: 700, color: COLORS.danger }}>{pastDeadline.length}</div></div>
              </div>
            </div>
          </div>
        );

      // ---- CAPITAL & PROFITS ----
      case 'capital':
        const totalCap = capital.reduce((s, c) => s + (c.amount || 0), 0);
        return (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h2 style={{ fontSize: '20px', fontWeight: 800, color: COLORS.primaryDark }}>💎 Capital & Profit Sharing</h2>
              {isAdmin && <button style={S.btn('primary')} onClick={() => setShowAddCapital(true)}>+ Add Contribution</button>}
            </div>
            <div style={S.card}>
              <div style={S.cardTitle}>Capital Contributions</div>
              <table style={S.table}>
                <thead>
                  <tr><th style={S.th}>Stakeholder</th><th style={S.th}>Amount</th><th style={S.th}>Date</th><th style={S.th}>Share %</th></tr>
                </thead>
                <tbody>
                  {capital.map((c, i) => (
                    <tr key={i}>
                      <td style={S.td}><strong>{c.name}</strong></td>
                      <td style={S.td}>{fmtMoney(c.amount)}</td>
                      <td style={S.td}>{fmtDate(c.date)}</td>
                      <td style={S.td}><strong>{totalCap > 0 ? (c.amount / totalCap * 100).toFixed(1) : 0}%</strong></td>
                    </tr>
                  ))}
                  {capital.length === 0 && <tr><td style={S.td} colSpan={4}>No contributions recorded yet.</td></tr>}
                </tbody>
              </table>
              <div style={{ marginTop: '12px', padding: '12px', background: COLORS.primaryLight, borderRadius: '8px', fontWeight: 700 }}>
                Total Capital: {fmtMoney(totalCap)}
              </div>
            </div>
          </div>
        );

      // ---- EXPENSES ----
      case 'expenses':
        return (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h2 style={{ fontSize: '20px', fontWeight: 800, color: COLORS.primaryDark }}>🧾 Expenses</h2>
              {isStaff && <button style={S.btn('primary')} onClick={() => setShowAddExpense(true)}>+ Add Expense</button>}
            </div>
            <div style={S.card}>
              <table style={S.table}>
                <thead>
                  <tr><th style={S.th}>Date</th><th style={S.th}>Category</th><th style={S.th}>Description</th><th style={S.th}>Amount</th></tr>
                </thead>
                <tbody>
                  {expenses.slice().reverse().map((e, i) => (
                    <tr key={i}>
                      <td style={S.td}>{fmtDate(e.date)}</td>
                      <td style={S.td}>{e.category}</td>
                      <td style={S.td}>{e.description}</td>
                      <td style={S.td}><strong>{fmtMoney(e.amount)}</strong></td>
                    </tr>
                  ))}
                  {expenses.length === 0 && <tr><td style={S.td} colSpan={4}>No expenses recorded yet.</td></tr>}
                </tbody>
              </table>
              <div style={{ marginTop: '12px', padding: '12px', background: COLORS.dangerLight, borderRadius: '8px', fontWeight: 700, color: COLORS.danger }}>
                Total Expenses: {fmtMoney(totalExpenses)}
              </div>
            </div>
          </div>
        );

      // ---- DECLINED LOG ----
      case 'declined':
        return (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h2 style={{ fontSize: '20px', fontWeight: 800, color: COLORS.primaryDark }}>🚫 Declined Customer Log</h2>
              {isStaff && <button style={S.btn('primary')} onClick={() => setShowAddDeclined(true)}>+ Add Entry</button>}
            </div>
            <div style={S.card}>
              <table style={S.table}>
                <thead>
                  <tr><th style={S.th}>Date</th><th style={S.th}>Item Brought</th><th style={S.th}>Reason</th></tr>
                </thead>
                <tbody>
                  {declinedLog.slice().reverse().map((d, i) => (
                    <tr key={i}>
                      <td style={S.td}>{fmtDate(d.date)}</td>
                      <td style={S.td}>{d.item}</td>
                      <td style={S.td}>{d.reason}</td>
                    </tr>
                  ))}
                  {declinedLog.length === 0 && <tr><td style={S.td} colSpan={3}>No declined customers recorded.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        );

      // ---- SETTINGS ----
      case 'settings':
        return (
          <div>
            <h2 style={{ fontSize: '20px', fontWeight: 800, marginBottom: '20px', color: COLORS.primaryDark }}>⚙ Business Settings</h2>
            <div style={S.card}>
              <div style={S.cardTitle}>Business Parameters</div>
              <div style={S.grid2}>
                <Field label="Daily Interest Rate (%)">
                  <input style={S.input} type="number" step="0.1" value={settings.interestRate}
                    onChange={e => saveSettings({ ...settings, interestRate: Number(e.target.value) })} />
                </Field>
                <Field label="Service Fee (₦)">
                  <input style={S.input} type="number" value={settings.serviceFee}
                    onChange={e => saveSettings({ ...settings, serviceFee: Number(e.target.value) })} />
                </Field>
                <Field label="Loan Cap — No Receipt (%)">
                  <input style={S.input} type="number" value={settings.loanCapNoReceipt}
                    onChange={e => saveSettings({ ...settings, loanCapNoReceipt: Number(e.target.value) })} />
                </Field>
                <Field label="Loan Cap — With Receipt (%)">
                  <input style={S.input} type="number" value={settings.loanCapWithReceipt}
                    onChange={e => saveSettings({ ...settings, loanCapWithReceipt: Number(e.target.value) })} />
                </Field>
                <Field label="Max Loan Days">
                  <input style={S.input} type="number" value={settings.maxLoanDays}
                    onChange={e => saveSettings({ ...settings, maxLoanDays: Number(e.target.value) })} />
                </Field>
                <Field label="Grace Days (Internal)">
                  <input style={S.input} type="number" value={settings.graceDays}
                    onChange={e => saveSettings({ ...settings, graceDays: Number(e.target.value) })} />
                </Field>
                <Field label="Target Selling Price (% of value)">
                  <input style={S.input} type="number" value={settings.targetSellPct}
                    onChange={e => saveSettings({ ...settings, targetSellPct: Number(e.target.value) })} />
                </Field>
                <Field label="Minimum Sell Bonus (% of advance)">
                  <input style={S.input} type="number" value={settings.minSellBonus}
                    onChange={e => saveSettings({ ...settings, minSellBonus: Number(e.target.value) })} />
                </Field>
              </div>
            </div>
            <div style={S.card}>
              <div style={S.cardTitle}>🔑 API Keys</div>
              <Field label="Gemini AI API Key">
                <input style={S.input} type="password" value={settings.geminiApiKey}
                  onChange={e => saveSettings({ ...settings, geminiApiKey: e.target.value })}
                  placeholder="Get free key from aistudio.google.com" />
              </Field>
              <Field label="NIN/BVN API Key (checkmyninbvn.com.ng)">
                <input style={S.input} type="password" value={settings.ninApiKey}
                  onChange={e => saveSettings({ ...settings, ninApiKey: e.target.value })}
                  placeholder="API key from checkmyninbvn.com.ng" />
              </Field>
            </div>
          </div>
        );

      // ---- USER MANAGEMENT ----
      case 'users':
        return (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h2 style={{ fontSize: '20px', fontWeight: 800, color: COLORS.primaryDark }}>👥 User Management</h2>
              <button style={S.btn('primary')} onClick={() => setShowAddUser(true)}>+ Add User</button>
            </div>
            <div style={S.card}>
              <table style={S.table}>
                <thead>
                  <tr><th style={S.th}>Name</th><th style={S.th}>Username</th><th style={S.th}>Role</th><th style={S.th}>Actions</th></tr>
                </thead>
                <tbody>
                  {users.map((u, i) => (
                    <tr key={u.id}>
                      <td style={S.td}><strong>{u.name}</strong></td>
                      <td style={S.td}>{u.username}</td>
                      <td style={S.td}><span style={S.badge(u.role === 'admin' ? COLORS.primary : u.role === 'staff' ? COLORS.accent : '#6b7280')}>{u.role}</span></td>
                      <td style={S.td}>
                        {u.id !== 'admin' && <button style={S.btnSm('danger')} onClick={() => saveUsers(users.filter(x => x.id !== u.id))}>Remove</button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );

      default:
        return <div>Page not found</div>;
    }
  };

  // ---- ADD EXPENSE MODAL ----
  const ExpenseModal = () => {
    const [exp, setExp] = useState({ date: new Date().toISOString().split('T')[0], category: 'Stationery', description: '', amount: 0 });
    return (
      <Modal open={showAddExpense} onClose={() => setShowAddExpense(false)} title="Add Expense">
        <div style={S.grid2}>
          <Field label="Date"><input style={S.input} type="date" value={exp.date} onChange={e => setExp({ ...exp, date: e.target.value })} /></Field>
          <Field label="Category">
            <select style={S.select} value={exp.category} onChange={e => setExp({ ...exp, category: e.target.value })}>
              {['Stationery & Printing', 'Mobile Data', 'Phone Calls', 'Packaging Materials', 'Transport', 'Miscellaneous'].map(c => <option key={c}>{c}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Description"><input style={S.input} value={exp.description} onChange={e => setExp({ ...exp, description: e.target.value })} /></Field>
        <Field label="Amount (₦)"><input style={S.input} type="number" value={exp.amount} onChange={e => setExp({ ...exp, amount: Number(e.target.value) })} /></Field>
        <button style={S.btn('primary')} onClick={() => { saveExpenses([...expenses, exp]); setShowAddExpense(false); }}>Save Expense</button>
      </Modal>
    );
  };

  // ---- ADD CAPITAL MODAL ----
  const CapitalModal = () => {
    const [cap, setCap] = useState({ name: '', amount: 0, date: new Date().toISOString().split('T')[0], method: '' });
    return (
      <Modal open={showAddCapital} onClose={() => setShowAddCapital(false)} title="Add Capital Contribution">
        <div style={S.grid2}>
          <Field label="Stakeholder Name"><input style={S.input} value={cap.name} onChange={e => setCap({ ...cap, name: e.target.value })} /></Field>
          <Field label="Amount (₦)"><input style={S.input} type="number" value={cap.amount} onChange={e => setCap({ ...cap, amount: Number(e.target.value) })} /></Field>
          <Field label="Date"><input style={S.input} type="date" value={cap.date} onChange={e => setCap({ ...cap, date: e.target.value })} /></Field>
          <Field label="Method / Bank"><input style={S.input} value={cap.method} onChange={e => setCap({ ...cap, method: e.target.value })} /></Field>
        </div>
        <button style={S.btn('primary')} onClick={() => { saveCapital([...capital, cap]); setShowAddCapital(false); }}>Save Contribution</button>
      </Modal>
    );
  };

  // ---- ADD DECLINED MODAL ----
  const DeclinedModal = () => {
    const [dec, setDec] = useState({ date: new Date().toISOString().split('T')[0], item: '', reason: '' });
    return (
      <Modal open={showAddDeclined} onClose={() => setShowAddDeclined(false)} title="Log Declined Customer">
        <Field label="Date"><input style={S.input} type="date" value={dec.date} onChange={e => setDec({ ...dec, date: e.target.value })} /></Field>
        <Field label="Item Brought"><input style={S.input} value={dec.item} onChange={e => setDec({ ...dec, item: e.target.value })} placeholder="e.g. Samsung Galaxy A14" /></Field>
        <Field label="Reason for Declining"><textarea style={S.textarea} value={dec.reason} onChange={e => setDec({ ...dec, reason: e.target.value })} placeholder="e.g. NIN photo did not match" /></Field>
        <button style={S.btn('primary')} onClick={() => { saveDeclined([...declinedLog, dec]); setShowAddDeclined(false); }}>Save Entry</button>
      </Modal>
    );
  };

  // ---- ADD USER MODAL ----
  const UserModal = () => {
    const [usr, setUsr] = useState({ name: '', username: '', password: '', role: 'staff' });
    return (
      <Modal open={showAddUser} onClose={() => setShowAddUser(false)} title="Add New User">
        <div style={S.grid2}>
          <Field label="Full Name"><input style={S.input} value={usr.name} onChange={e => setUsr({ ...usr, name: e.target.value })} /></Field>
          <Field label="Username"><input style={S.input} value={usr.username} onChange={e => setUsr({ ...usr, username: e.target.value })} /></Field>
          <Field label="Password"><input style={S.input} value={usr.password} onChange={e => setUsr({ ...usr, password: e.target.value })} /></Field>
          <Field label="Role">
            <select style={S.select} value={usr.role} onChange={e => setUsr({ ...usr, role: e.target.value })}>
              <option value="staff">Staff</option>
              <option value="stakeholder">Stakeholder</option>
              <option value="admin">Admin</option>
            </select>
          </Field>
        </div>
        <button style={S.btn('primary')} onClick={() => { saveUsers([...users, { ...usr, id: `u-${Date.now()}` }]); setShowAddUser(false); }}>Add User</button>
      </Modal>
    );
  };

  return (
    <div style={S.app}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
      {/* Top Bar */}
      <div style={S.topBar}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontSize: '20px' }}>💰</span>
          <span style={{ fontWeight: 800, letterSpacing: '-0.3px' }}>CFC QUICK CASH</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <span style={{ fontSize: '13px', opacity: 0.8 }}>👤 {currentUser.name}</span>
          <span style={S.badge(currentUser.role === 'admin' ? '#c8a84e' : currentUser.role === 'staff' ? '#10b981' : '#6b7280')}>{currentUser.role}</span>
          <button style={{ ...S.btnSm('danger'), fontSize: '11px' }} onClick={() => setCurrentUser(null)}>Logout</button>
        </div>
      </div>
      {/* Body */}
      <div style={S.body}>
        {/* Sidebar */}
        <div style={S.sidebar}>
          {navItems.map(item => (
            <div key={item.id} style={S.sideItem(page === item.id)}
              onClick={() => {
                if (item.id === 'newTx') { setEditingTx('new'); }
                else { setPage(item.id); setViewingTx(null); }
              }}>
              <span>{item.icon}</span> {item.label}
            </div>
          ))}
        </div>
        {/* Main */}
        <div style={S.mainContent}>
          {renderPage()}
        </div>
      </div>
      {/* Modals */}
      <ExpenseModal />
      <CapitalModal />
      <DeclinedModal />
      <UserModal />
      <Modal open={!!repayingTx} onClose={() => setRepayingTx(null)} title="Record Repayment / Collection">
        {repayingTx && <RepaymentModal tx={repayingTx} settings={settings} onClose={() => setRepayingTx(null)} onSave={(tx) => { saveTx(tx); setRepayingTx(null); }} />}
      </Modal>
      <Modal open={!!sellingTx} onClose={() => setSellingTx(null)} title="Record Item Sale" wide>
        {sellingTx && <SaleModal tx={sellingTx} settings={settings} onClose={() => setSellingTx(null)} onSave={(tx) => { saveTx(tx); setSellingTx(null); }} />}
      </Modal>
      {/* Print Styles */}
      <style>{`
        @media print {
          body * { visibility: hidden; }
          .print-area, .print-area * { visibility: visible; }
          .print-area { position: absolute; left: 0; top: 0; width: 100%; }
        }
        input:focus, select:focus, textarea:focus {
          border-color: ${COLORS.primary} !important;
          box-shadow: 0 0 0 3px ${COLORS.primaryLight};
        }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: ${COLORS.bg}; }
        ::-webkit-scrollbar-thumb { background: ${COLORS.border}; border-radius: 3px; }
        ::-webkit-scrollbar-thumb:hover { background: ${COLORS.borderDark}; }
      `}</style>
    </div>
  );
}
