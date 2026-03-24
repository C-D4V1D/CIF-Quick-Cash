import { useState, useEffect, useRef, useMemo, Fragment } from "react";
import { useNavigate, useLocation, Routes, Route, Navigate } from "react-router-dom";
import { printAgreement } from './PrintAgreement.jsx';
import { printMonthReport } from './PrintMonthReport.jsx';

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
// Connected to Cloudflare D1 via Cloudflare Pages Functions
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
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      const body = await r.json().catch(() => null);
      if (!r.ok) return body || { error: `Server error ${r.status}` };
      return body;
    } catch (e) { console.error(`POST /api/${endpoint}:`, e); return { error: 'Network error — please try again' }; }
  },
  async put(endpoint, data) {
    try {
      const r = await fetch(`/api/${endpoint}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      const body = await r.json().catch(() => null);
      if (!r.ok) return body || { error: `Server error ${r.status}` };
      return body;
    } catch (e) { console.error(`PUT /api/${endpoint}:`, e); return { error: 'Network error — please try again' }; }
  },
  async del(endpoint) {
    try {
      const r = await fetch(`/api/${endpoint}`, { method: 'DELETE', credentials: 'same-origin' });
      if (!r.ok) throw new Error(`API error: ${r.status}`);
      return await r.json();
    } catch (e) { console.error(`DELETE /api/${endpoint}:`, e); return null; }
  }
};

// --- LOCAL CACHE (instant page load) ---
const readCache = (k) => { try { const r = localStorage.getItem(k); return r ? JSON.parse(r) : null; } catch { return null; } };
const writeCache = (k, v) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch (error) {
    console.debug('Failed to write cache', error);
  }
};
const clearAuthCache = () => {
  try {
    localStorage.removeItem('cfc_user');
    localStorage.removeItem('cfc_critical');
    localStorage.removeItem('cfc_transactions');
  } catch (error) {
    console.debug('Failed to clear auth cache', error);
  }
};

const SHOP_CACHE_KEY = 'cfc_shop_items';
const SHOP_CACHE_TTL_MS = 5 * 60 * 1000;
const readShopCache = () => {
  const cached = readCache(SHOP_CACHE_KEY);
  if (!cached?.savedAt || Date.now() - cached.savedAt > SHOP_CACHE_TTL_MS) return null;
  return cached;
};
const writeShopCache = (payload) => writeCache(SHOP_CACHE_KEY, { ...payload, savedAt: Date.now() });

const normalizeUser = (user) => {
  if (!user) return null;
  let roles = user.roles;
  if (typeof roles === 'string') {
    try { roles = JSON.parse(roles); } catch { roles = []; }
  }
  if (!Array.isArray(roles)) roles = [];
  return { ...user, roles };
};

// --- UTILITY FUNCTIONS ---
// Nigeria's IANA timezone identifier (WAT = UTC+1).
const NIGERIA_TZ = 'Africa/Lagos';

const genRef = () => {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: NIGERIA_TZ, day: '2-digit', month: '2-digit', year: '2-digit',
  }).formatToParts(new Date());
  const dd   = parts.find(p => p.type === 'day').value;
  const mm   = parts.find(p => p.type === 'month').value;
  const yy   = parts.find(p => p.type === 'year').value;
  const rand = String(Math.floor(Math.random() * 999) + 1).padStart(3, '0');
  return `CIF-${dd}${mm}${yy}-${rand}`;
};

// Returns today's date as a YYYY-MM-DD string in Nigeria time (WAT = UTC+1).
// Using toISOString() would give the UTC date, which can be a different calendar
// day (e.g. between midnight and 1 am Nigeria time). Using 'Africa/Lagos' ensures
// the correct calendar date regardless of the device's own timezone setting.
const localISODate = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: NIGERIA_TZ }).format(new Date());

// Returns the number of whole calendar days elapsed since dateStr (YYYY-MM-DD or ISO)
// using Nigeria midnight (WAT = UTC+1) so that day transitions happen at the correct
// time for Nigerian users. Mirrors the server-side elapsedDaysSince() helper.
const daysBetween = (dateStr) => {
  if (!dateStr) return 0;
  const given = new Date(dateStr);
  if (Number.isNaN(given.getTime())) return 0;
  const nowNigeria = new Date(localISODate()); // Nigeria calendar date as UTC midnight
  const givenMidnight = Date.UTC(given.getUTCFullYear(), given.getUTCMonth(), given.getUTCDate());
  const nowMidnight   = Date.UTC(nowNigeria.getUTCFullYear(), nowNigeria.getUTCMonth(), nowNigeria.getUTCDate());
  return Math.max(0, Math.floor((nowMidnight - givenMidnight) / 86400000));
};

// Adds N calendar days to a YYYY-MM-DD (or ISO) date string and returns YYYY-MM-DD.
// Uses UTC throughout so that the result is the same calendar date regardless of
// the device's local timezone (mirrors the server-side addDaysToDate() helper).
const addDays = (dateStr, daysToAdd) => {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return '';
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + daysToAdd);
  return date.toISOString().split('T')[0];
};

// Returns a short human-readable label for how far a date is from today (Nigeria time).
// e.g. "Today", "Yesterday", "Tomorrow", "5 days ago", "In 10 days".
const relativeDateLabel = (dateStr) => {
  if (!dateStr) return '';
  const given = new Date(dateStr);
  if (Number.isNaN(given.getTime())) return '';
  const nowNigeria = new Date(localISODate());
  const givenMidnight = Date.UTC(given.getUTCFullYear(), given.getUTCMonth(), given.getUTCDate());
  const nowMidnight   = Date.UTC(nowNigeria.getUTCFullYear(), nowNigeria.getUTCMonth(), nowNigeria.getUTCDate());
  const diff = Math.floor((nowMidnight - givenMidnight) / 86400000); // positive = past
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff === -1) return 'Tomorrow';
  if (diff > 1) return `${diff} day${diff !== 1 ? 's' : ''} ago`;
  return `In ${Math.abs(diff)} days`;
};

// settings is optional — falls back to safe defaults when not yet loaded.
const getLoanTimeline = (tx, settings = {}) => {
  const maxLoanDays = Math.max(1, Number(settings.maxLoanDays) || 30);
  const graceDays   = Math.max(0, Number(settings.graceDays)   || 3);
  const elapsedDays = daysBetween(tx?.dateGiven);
  const customerDueDate = tx?.deadlineDate || addDays(tx?.dateGiven, Number(tx?.loanDays) || maxLoanDays);
  const internalDeadline = addDays(tx?.dateGiven, maxLoanDays);
  const graceEndDate     = addDays(tx?.dateGiven, maxLoanDays + graceDays);
  const saleAllowedDate  = addDays(tx?.dateGiven, maxLoanDays + graceDays + 1);
  const isOverdueToCustomerAgreement = !!customerDueDate && daysBetween(customerDueDate) > 0;
  const isOwnedByBusiness = elapsedDays >= maxLoanDays;
  const isInFinalGrace    = elapsedDays >= maxLoanDays + 1 && elapsedDays <= maxLoanDays + graceDays;
  const isEligibleForSale = elapsedDays >= maxLoanDays + graceDays + 1;
  return {
    elapsedDays,
    customer_due_date: customerDueDate,
    internal_deadline: internalDeadline,
    grace_end_date: graceEndDate,
    sale_allowed_date: saleAllowedDate,
    isOverdueToCustomerAgreement,
    isOwnedByBusiness,
    isInFinalGrace,
    isEligibleForSale,
  };
};

const withLoanTimeline = (tx, settings = {}) => {
  if (!tx || tx.type === 'outright') return tx;
  return { ...tx, ...getLoanTimeline(tx, settings) };
};

const withLoanTimelines = (items = [], settings = {}) => items.map(tx => withLoanTimeline(tx, settings));

const getCustomerDaysLeft = (tx) => {
  const dueDate = tx?.deadlineDate || tx?.customer_due_date;
  if (!dueDate) return null;
  // Use Nigeria calendar date for "today" so the comparison is always in WAT,
  // regardless of the device's own timezone setting.
  const today    = new Date(localISODate());
  const deadline = new Date(dueDate);
  return Math.ceil((deadline - today) / 86400000);
};

const getForSaleListedDate = (tx) => tx.listedForSaleDate || tx.updated_at || tx.created_at || null;

// Round price to nearest ₦50 for cleaner suggested prices
const roundToNice = (n) => Math.round(Math.max(0, n) / 50) * 50;

// Standard condition grades shown to buyers
const CONDITION_GRADES = [
  'Like New — Barely used, no visible wear',
  'Excellent — Excellent condition, minimal signs of use',
  'Gently Used — Good condition, minor cosmetic marks',
  'Good Used — Good working condition, some signs of use',
  'Well Used — Visible signs of use, fully functional',
  'Heavily Used — Major signs of use, all functions working',
  'For Parts — Not fully functional, sold for parts or repair',
];

// Auto-derive a condition grade string from free-form condition text
const deriveConditionGrade = (condText) => {
  const t = (condText || '').toLowerCase();
  if (!t) return CONDITION_GRADES[3];
  if (t.includes('like new') || t.includes('mint') || t.includes('brand new') || t.includes('perfect')) return CONDITION_GRADES[0];
  if (t.includes('excellent')) return CONDITION_GRADES[1];
  if (t.includes('gently') || t.includes('light scratch') || t.includes('minor')) return CONDITION_GRADES[2];
  if (t.includes('parts') || t.includes('repair') || t.includes('not work') || t.includes('broken')) return CONDITION_GRADES[6];
  if (t.includes('heavily') || t.includes('heavy') || t.includes('crack') || t.includes('major')) return CONDITION_GRADES[5];
  if (t.includes('visible') || t.includes('well used') || t.includes('dent') || t.includes('scuff') || t.includes('worn')) return CONDITION_GRADES[4];
  if (t.includes('good') || t.includes('fair') || t.includes('moderate')) return CONDITION_GRADES[3];
  return CONDITION_GRADES[3];
};

const getForSaleDaysListed = (tx) => {
  const listedDate = getForSaleListedDate(tx);
  if (!listedDate) return null;
  return daysBetween(listedDate);
};

const getTargetSaleDate = (tx, settings = {}) => {
  if (!tx?.dateGiven) return null;
  const maxLoanDays = Math.max(1, Number(settings.maxLoanDays) || 30);
  const graceDays = Math.max(0, Number(settings.graceDays) || 3);
  const targetDays = Math.max(1, Number(settings.targetSaleDeadlineDays) || 14);
  return addDays(tx.dateGiven, maxLoanDays + graceDays + targetDays);
};

const getDaysUntilTargetSale = (tx, settings = {}) => {
  const targetDate = getTargetSaleDate(tx, settings);
  if (!targetDate) return null;
  const today = new Date(localISODate());
  const target = new Date(targetDate);
  return Math.ceil((target - today) / 86400000);
};

const getForSaleDaysBadgeStyle = (days) => {
  if (days === null || days === undefined) return null;
  if (days >= 14) return { bg: '#fee2e2', fg: '#b91c1c', border: '#fecaca' };
  if (days >= 7) return { bg: '#fef3c7', fg: '#92400e', border: '#fde68a' };
  return { bg: '#dcfce7', fg: '#166534', border: '#86efac' };
};

const fmtMoney = (n) => {
  if (!n && n !== 0) return '₦0';
  return '₦' + Number(n).toLocaleString();
};

const fmtDate = (d) => {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: NIGERIA_TZ });
};

const statusColor = (tx, settings = {}) => {
  if (tx.status === 'declined') return '#6b7280';          // Gray
  if (tx.status === 'closed') return '#10b981';            // Green
  if (tx.status === 'sold') return '#4b5563';              // Dark gray (distinct from declined's lighter gray)
  if (tx.status === 'for_sale') return '#0ea5e9';          // Sky blue — clearly distinct from grace period purple
  if (tx.status === 'ready_to_sell') return '#dc2626';     // Red — explicit early surrender
  if (tx.type === 'outright') return '#0ea5e9';            // Sky blue — listed outright purchase
  const maxLoanDays = Math.max(1, Number(settings.maxLoanDays) || 30);
  const graceDays = Math.max(0, Number(settings.graceDays) || 3);
  const elapsed = daysBetween(tx?.dateGiven);
  const customerDaysLeft = getCustomerDaysLeft(tx);
  if (elapsed >= maxLoanDays + graceDays + 1) return '#ea580c';       // Orange — timeline-eligible ready to sell (distinct from red surrender)
  if (graceDays > 0 && elapsed === maxLoanDays + graceDays) return '#dc2626'; // Red — last day of grace
  if (elapsed > maxLoanDays && elapsed < maxLoanDays + graceDays) return '#7c3aed'; // Indigo — in grace period
  if (elapsed === maxLoanDays) return '#b45309';                       // Amber-brown — last day of ownership
  if (customerDaysLeft !== null && customerDaysLeft < 0) return '#f59e0b'; // Amber — overdue by customer agreement
  if (customerDaysLeft !== null && customerDaysLeft === 0) return '#ef4444'; // Red — due today
  if (customerDaysLeft !== null && customerDaysLeft <= 7) return '#ef4444'; // Red — 7 days or less
  if (customerDaysLeft !== null && customerDaysLeft <= 15) return '#f59e0b'; // Amber — 15 days or less
  return '#10b981';                                                     // Green — active, healthy
};

const statusLabel = (tx, settings = {}) => {
  if (tx.status === 'closed') return '✅ Closed — Returned';
  if (tx.status === 'sold') return '✅ Sold';
  if (tx.status === 'for_sale') return '🏷️ Listed for Sale';
  if (tx.status === 'declined') return 'Declined';
  if (tx.status === 'ready_to_sell') return '🤝 Customer Surrendered';  // Early voluntary surrender
  if (tx.type === 'outright') return 'Outright Purchase';
  const maxLoanDays = Math.max(1, Number(settings.maxLoanDays) || 30);
  const graceDays = Math.max(0, Number(settings.graceDays) || 3);
  const elapsed = daysBetween(tx?.dateGiven);
  const customerDaysLeft = getCustomerDaysLeft(tx);
  if (elapsed >= maxLoanDays + graceDays + 1) return '🏷 Ready to Sell';
  if (graceDays > 0 && elapsed === maxLoanDays + graceDays) return '🔴 Last Day of Grace';
  if (elapsed > maxLoanDays && elapsed < maxLoanDays + graceDays) return '💜 Grace Period';
  if (elapsed === maxLoanDays) return '🔴 Last Day of Ownership';
  if (customerDaysLeft !== null && customerDaysLeft < 0) return `⚠️ ${Math.abs(customerDaysLeft)} day${Math.abs(customerDaysLeft) !== 1 ? 's' : ''} overdue`;
  if (customerDaysLeft !== null && customerDaysLeft === 0) return '🔴 Due Today';
  if (customerDaysLeft !== null && customerDaysLeft <= 7) return `⚠ ${customerDaysLeft} day${customerDaysLeft !== 1 ? 's' : ''} left`;
  return `Active — Day ${elapsed}`;
};

// Check whether a user holds a given role (primary or additional)
const hasRole = (u, r) => u?.role === r || (u?.roles || []).includes(r);

// --- DEFAULT DATA ---
const DEFAULT_SETTINGS = {
  // Business Profile
  businessName: 'Christ-in-Fabian Quick Cash',
  businessTagline: 'Fast Cash, Fair Deals',
  location: 'Aguleri Junction, Anambra State, Nigeria',
  cacRegNumber: '',
  // Loan Parameters
  interestRate: 1, loanCapNoReceipt: 40, loanCapWithReceipt: 50,
  graceDays: 3, serviceFee: 1000, maxLoanDays: 30,
  // Sales Configuration
  targetSellPct: 75, minSellBonus: 20, outrightMinMarkupPct: 20, maxPartsOnlyAdvance: 5000,
  priceDropEnabled: false, priceDropIntervalDays: 3,
  shopShowSoldHistory: true, shopMaxSoldHistoryItems: 8,
  // AI & API Keys
  geminiApiKey: '', geminiModel: 'gemini-2.5-flash', cloudVisionApiKey: '', ninApiKey: '',
  // API Free Tier Limits (adjustable in case Google changes them)
  geminiDailyLimit: 100, // Gemini 2.5 Pro free tier: 100 RPD (Flash: 250, Flash-Lite: 1000)
  geminiRpmLimit: 5,     // Gemini 2.5 Pro free tier: 5 RPM (Flash: 10, Flash-Lite: 15)
  visionMonthlyLimit: 1000, // Cloud Vision free tier: 1,000 images/month (per feature)
  // Identity Verification
  requireNinVerification: false,
  ninCreditCost: 150,
  ninLowCreditThreshold: 5,
  ninRechargeBank: '',
  ninRechargeAccountNumber: '',
  ninRechargeAccountName: '',
  // Item Categories
  itemCategories: ['Smartphone', 'Laptop', 'Tablet', 'Bluetooth Speaker', 'Power Bank', 'Electric Fan', 'Flat-Screen TV', 'Generator', 'Gas Cylinder', 'Other'],
  // Expense Categories
  expenseCategories: ['Stationery & Printing', 'Mobile Data', 'Phone Calls', 'Packaging Materials', 'Transport', 'Miscellaneous'],
  // Business Contact & Hours
  shopAddress: 'Current Filling Station, off Tourist Garden Hotel, Enugwu-Aguleri, Anambra East LGA, Anambra State',
  shopPhone1: '08165491908',
  shopPhone2: '09023540646',
  shopWhatsApp: '2348165491908',
  shopHours: 'Monday – Saturday, 8am – 6pm',
  shopMapsUrl: '',
  // Overdue & Penalty Rules
  autoForfeitDays: 0,
  overdueContactReminderDays: 2,
  dueDateFollowUpDays: [1, 0],
  ownershipFollowUpDays: [3, 0],
  penaltyRateMultiplier: 1.5,
  distributionAuthorizedUserIds: [],
  // Security
  sessionTimeoutMinutes: 480,
  minPasswordLength: 6,
  maxLoginAttempts: 5,
  loginCooldownMinutes: 15,
  // WhatsApp Message Templates
  whatsappLoanReminder: 'Hello {customerName}, this is a reminder that your loan (Ref: {ref}) of ₦{amount} is due in {daysLeft} day(s). Please visit our shop to make payment. Thank you!',
  whatsappOverdueNotice: 'Dear {customerName}, your loan (Ref: {ref}) of ₦{amount} is now {daysOverdue} day(s) overdue. Please come in immediately to avoid your item being listed for sale. Contact us: {shopPhone}',
  whatsappPickupReady: 'Hello {customerName}, your item is ready for pickup at our shop. Please bring your agreement form and valid ID. Ref: {ref}. Thank you for choosing {businessName}!',
  // Receipt & Agreement
  agreementTermsExtra: '',
  receiptFooter: 'Thank you for your patronage!',
  // Profit Sharing
  staffSharePct: 10,
  targetSaleDeadlineDays: 14,
  // Data Management
  activityLogRetentionDays: 90,
};

const PAGE_PATHS = {
  dashboard: '/dashboard',
  newTransaction: '/transactions/new',
  transactions: '/transactions',
  actionLoans: '/recovery-queue',
  deadlines: '/daily-follow-ups',
  forSale: '/for-sale',
  reports: '/reports',
  capital: '/capital',
  expenses: '/expenses',
  declined: '/declined',
  settings: '/admin/settings',
  users: '/admin/users',
  activity: '/activity',
};

const PAGE_FROM_PATH = {
  ...Object.fromEntries(Object.entries(PAGE_PATHS).map(([k, v]) => [v, k])),
  '/alerts': 'actionLoans',
  '/action-loans': 'actionLoans',
  '/follow-ups': 'deadlines',
  '/loans/active': 'transactions',
};
const txDetailPath = (ref) => `/transactions/${encodeURIComponent(ref)}`;
const txRepayPath = (ref) => `/transactions/${encodeURIComponent(ref)}/collect`;
const txSellPath  = (ref) => `/transactions/${encodeURIComponent(ref)}/sell`;

const ACTIVITY_PAGE_SIZE = 50;

// ============================================================
// API USAGE TRACKING (stays within free tier limits)
// ============================================================
const API_USAGE_KEY = 'cifcash_api_usage';

const getApiUsage = () => {
  try {
    const raw = localStorage.getItem(API_USAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch { return {}; }
};

const saveApiUsage = (usage) => {
  try { localStorage.setItem(API_USAGE_KEY, JSON.stringify(usage)); } catch {}
};

const getTodayKey = () => localISODate(); // Nigeria-local YYYY-MM-DD
const getMonthKey = () => localISODate().slice(0, 7);  // Nigeria-local YYYY-MM

const trackGeminiCall = () => {
  const usage = getApiUsage();
  const today = getTodayKey();
  if (!usage.gemini) usage.gemini = {};
  if (!usage.gemini[today]) usage.gemini[today] = { count: 0, timestamps: [] };
  usage.gemini[today].count++;
  // Track last 10 timestamps for RPM calculation
  usage.gemini[today].timestamps.push(Date.now());
  if (usage.gemini[today].timestamps.length > 50) usage.gemini[today].timestamps = usage.gemini[today].timestamps.slice(-50);
  // Clean up old days (keep last 7)
  const keys = Object.keys(usage.gemini).sort();
  if (keys.length > 7) { for (const k of keys.slice(0, -7)) delete usage.gemini[k]; }
  saveApiUsage(usage);
};

const trackVisionCall = (imageCount = 1) => {
  const usage = getApiUsage();
  const month = getMonthKey();
  if (!usage.vision) usage.vision = {};
  if (!usage.vision[month]) usage.vision[month] = 0;
  usage.vision[month] += imageCount;
  // Clean up old months (keep last 3)
  const keys = Object.keys(usage.vision).sort();
  if (keys.length > 3) { for (const k of keys.slice(0, -3)) delete usage.vision[k]; }
  saveApiUsage(usage);
};

const getGeminiUsageToday = () => {
  const usage = getApiUsage();
  const today = getTodayKey();
  return (usage.gemini?.[today]?.count) || 0;
};

const getGeminiRpm = () => {
  const usage = getApiUsage();
  const today = getTodayKey();
  const timestamps = usage.gemini?.[today]?.timestamps || [];
  const oneMinAgo = Date.now() - 60000;
  return timestamps.filter(t => t > oneMinAgo).length;
};

const getVisionUsageThisMonth = () => {
  const usage = getApiUsage();
  const month = getMonthKey();
  return (usage.vision?.[month]) || 0;
};

const checkGeminiLimit = (settings) => {
  const dailyLimit = settings.geminiDailyLimit || 100;
  const rpmLimit = settings.geminiRpmLimit || 5;
  const usedToday = getGeminiUsageToday();
  const rpm = getGeminiRpm();
  if (usedToday >= dailyLimit) return { blocked: true, reason: `Gemini daily limit reached (${usedToday}/${dailyLimit}). Resets at midnight. Use manual mode or wait until tomorrow.` };
  if (rpm >= rpmLimit) return { blocked: true, reason: `Gemini rate limit reached (${rpm}/${rpmLimit} per minute). Please wait 30-60 seconds and try again.` };
  return { blocked: false, remaining: dailyLimit - usedToday };
};

const checkVisionLimit = (settings) => {
  const monthlyLimit = settings.visionMonthlyLimit || 1000;
  const usedThisMonth = getVisionUsageThisMonth();
  if (usedThisMonth >= monthlyLimit) return { blocked: true, reason: `Cloud Vision monthly limit reached (${usedThisMonth}/${monthlyLimit}). Resets next month. AI will use Gemini only.` };
  return { blocked: false, remaining: monthlyLimit - usedThisMonth };
};

// ============================================================
// GEMINI AI INTEGRATION
// ============================================================
const FALLBACK_GEMINI_MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite'];

const toBase64 = (blob) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onloadend = () => {
    const result = typeof reader.result === 'string' ? reader.result : '';
    const data = result.includes(',') ? result.split(',')[1] : result;
    resolve(data || '');
  };
  reader.onerror = () => reject(new Error('Failed to read uploaded image.'));
  reader.readAsDataURL(blob);
});

const imageToGeminiInlineData = async (img) => {
  if (!img) return null;

  if (img.startsWith('data:')) {
    const [meta, data = ''] = img.split(',');
    const mime = meta.match(/^data:([^;]+)/i)?.[1] || '';
    if (!mime || !data) throw new Error('Unsupported image format. Please re-upload the photo.');
    return { mime_type: mime, data };
  }

  const resp = await fetch(img);
  if (!resp.ok) throw new Error('Failed to load one of the uploaded photos. Please re-upload and try again.');
  const blob = await resp.blob();
  const mime = blob.type || 'image/jpeg';
  const data = await toBase64(blob);
  if (!data) throw new Error('Failed to process one of the uploaded photos. Please re-upload and try again.');
  return { mime_type: mime, data };
};

// Extract the actual response text from Gemini, skipping thinking/thought parts
const extractGeminiText = (data) => {
  const parts = data?.candidates?.[0]?.content?.parts;
  if (!parts || !Array.isArray(parts)) return null;
  // Find the first non-thought text part (thinking models return thought: true for reasoning parts)
  for (const part of parts) {
    if (part.text && !part.thought) return part.text;
  }
  // Fallback: if all parts are thoughts or no thought flag exists, use the last text part
  for (let i = parts.length - 1; i >= 0; i--) {
    if (parts[i].text) return parts[i].text;
  }
  return null;
};

const callGeminiAI = async (apiKey, model, images, promptText) => {
  if (!apiKey) return { error: 'No Gemini API key set. Go to Admin > Settings to add your key.' };
  try {
    const preferredModel = (model || '').trim() || DEFAULT_SETTINGS.geminiModel;
    const modelCandidates = [preferredModel, ...FALLBACK_GEMINI_MODELS]
      .filter(Boolean)
      .filter((m, idx, arr) => arr.indexOf(m) === idx);
    const parts = [{ text: promptText }];
    for (const img of images) {
      const inlineData = await imageToGeminiInlineData(img);
      if (inlineData) parts.push({ inline_data: inlineData });
    }

    for (const modelName of modelCandidates) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
      // For thinking models (2.5-pro), set a low thinking budget to reduce latency
      const isThinkingModel = modelName.includes('pro');
      const body = { contents: [{ parts }] };
      if (isThinkingModel) body.generationConfig = { thinkingConfig: { thinkingBudget: 2048 } };
      const options = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
      trackGeminiCall();
      let resp = await fetch(url, options);
      // Retry once on transient errors (429/500/502/503)
      if (!resp.ok && [429, 500, 502, 503].includes(resp.status)) {
        await new Promise(r => setTimeout(r, 2000));
        resp = await fetch(url, options);
      }
      const data = await resp.json().catch(() => null);
      const responseText = extractGeminiText(data);
      if (responseText) return { text: responseText, model: modelName };

      const errorMsg = (data?.error?.message || `Gemini request failed with status ${resp.status}.`).toLowerCase();
      const isTransient = [429, 500, 502, 503].includes(resp.status);
      const modelUnavailable = isTransient || errorMsg.includes('no longer available') || errorMsg.includes('not found') || errorMsg.includes('unsupported');
      const canFallback = modelUnavailable && modelName !== modelCandidates[modelCandidates.length - 1];
      if (!canFallback) return { error: data?.error?.message || `Gemini request failed with status ${resp.status}.` };
    }

    return { error: `No supported Gemini model was available for this API key. Tried: ${modelCandidates.join(', ')}.` };
  } catch (e) { return { error: e.message }; }
};

// Gemini AI call with Google Search grounding (for real-time price lookups)
const callGeminiWithSearch = async (apiKey, model, images, promptText) => {
  if (!apiKey) return { error: 'No Gemini API key set. Go to Admin > Settings to add your key.' };
  try {
    const preferredModel = (model || '').trim() || DEFAULT_SETTINGS.geminiModel;
    const modelCandidates = [preferredModel, ...FALLBACK_GEMINI_MODELS]
      .filter(Boolean)
      .filter((m, idx, arr) => arr.indexOf(m) === idx);
    const parts = [{ text: promptText }];
    for (const img of (images || [])) {
      const inlineData = await imageToGeminiInlineData(img);
      if (inlineData) parts.push({ inline_data: inlineData });
    }

    for (const modelName of modelCandidates) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
      const isThinkingModel = modelName.includes('pro');
      const body = { contents: [{ parts }], tools: [{ google_search: {} }] };
      if (isThinkingModel) body.generationConfig = { thinkingConfig: { thinkingBudget: 2048 } };
      const options = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
      trackGeminiCall();
      let resp = await fetch(url, options);
      // Retry once on transient errors (429/500/502/503)
      if (!resp.ok && [429, 500, 502, 503].includes(resp.status)) {
        await new Promise(r => setTimeout(r, 2000));
        resp = await fetch(url, options);
      }
      const data = await resp.json().catch(() => null);
      const responseText = extractGeminiText(data);
      if (responseText) return { text: responseText, model: modelName };

      const errorMsg = (data?.error?.message || `Gemini request failed with status ${resp.status}.`).toLowerCase();
      const isTransient = [429, 500, 502, 503].includes(resp.status);
      const modelUnavailable = isTransient || errorMsg.includes('no longer available') || errorMsg.includes('not found') || errorMsg.includes('unsupported');
      const canFallback = modelUnavailable && modelName !== modelCandidates[modelCandidates.length - 1];
      if (!canFallback) return { error: data?.error?.message || `Gemini request failed with status ${resp.status}.` };
    }

    return { error: `No supported Gemini model was available for this API key. Tried: ${modelCandidates.join(', ')}.` };
  } catch (e) { return { error: e.message }; }
};

// Google Cloud Vision API — reverse image search for item identification
const callCloudVision = async (apiKey, imageData) => {
  if (!apiKey) return { error: 'No Cloud Vision API key set.' };
  try {
    // imageData can be a data URI or a URL
    let request;
    if (imageData.startsWith('data:')) {
      const base64 = imageData.split(',')[1] || '';
      request = { image: { content: base64 }, features: [
        { type: 'LOGO_DETECTION', maxResults: 5 },
        { type: 'LABEL_DETECTION', maxResults: 15 },
        { type: 'TEXT_DETECTION', maxResults: 5 },
        { type: 'WEB_DETECTION', maxResults: 10 },
        { type: 'OBJECT_LOCALIZATION', maxResults: 5 }
      ] };
    } else {
      // Fetch and convert URL to base64
      const resp = await fetch(imageData);
      if (!resp.ok) return { error: 'Failed to load image for Vision analysis.' };
      const blob = await resp.blob();
      const base64 = await toBase64(blob);
      request = { image: { content: base64 }, features: [
        { type: 'LOGO_DETECTION', maxResults: 5 },
        { type: 'LABEL_DETECTION', maxResults: 15 },
        { type: 'TEXT_DETECTION', maxResults: 5 },
        { type: 'WEB_DETECTION', maxResults: 10 },
        { type: 'OBJECT_LOCALIZATION', maxResults: 5 }
      ] };
    }

    trackVisionCall(1);
    const resp = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests: [request] })
    });
    const data = await resp.json().catch(() => null);
    if (data?.error) return { error: data.error.message || 'Cloud Vision request failed.' };
    const result = data?.responses?.[0];
    if (!result) return { error: 'Cloud Vision returned no results.' };

    // Extract useful information
    const logos = (result.logoAnnotations || []).map(l => l.description).filter(Boolean);
    const labels = (result.labelAnnotations || []).map(l => `${l.description} (${Math.round((l.score || 0) * 100)}%)`).filter(Boolean);
    const texts = (result.textAnnotations || []).slice(0, 1).map(t => t.description).filter(Boolean);
    const webEntities = (result.webDetection?.webEntities || []).filter(e => e.description && (e.score || 0) > 0.3).map(e => `${e.description} (${Math.round((e.score || 0) * 100)}%)`);
    const bestGuess = (result.webDetection?.bestGuessLabels || []).map(l => l.label).filter(Boolean);
    const pagesWithMatch = (result.webDetection?.pagesWithMatchingImages || []).slice(0, 5).map(p => p.pageTitle || p.url).filter(Boolean);

    return {
      logos,
      labels,
      texts: texts[0] || '',
      webEntities,
      bestGuess,
      pagesWithMatch,
      summary: [
        bestGuess.length > 0 ? `Best guess: ${bestGuess.join(', ')}` : '',
        logos.length > 0 ? `Logos: ${logos.join(', ')}` : '',
        webEntities.length > 0 ? `Web matches: ${webEntities.slice(0, 5).join(', ')}` : '',
        pagesWithMatch.length > 0 ? `Found on: ${pagesWithMatch.slice(0, 3).join('; ')}` : '',
        texts[0] ? `Text detected on device: ${texts[0].substring(0, 500)}` : '',
      ].filter(Boolean).join('\n')
    };
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
const compressImageFile = (file, { maxDimension = 1400, quality = 0.82 } = {}) => new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => {
    let { width, height } = img;
    if (width > maxDimension || height > maxDimension) {
      if (width > height) {
        height = Math.round((height * maxDimension) / width);
        width = maxDimension;
      } else {
        width = Math.round((width * maxDimension) / height);
        height = maxDimension;
      }
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d').drawImage(img, 0, 0, width, height);
    resolve(canvas.toDataURL('image/jpeg', quality));
    URL.revokeObjectURL(img.src);
  };
  img.onerror = () => reject(new Error('Failed to read uploaded image.'));
  img.src = URL.createObjectURL(file);
});

function PhotoUpload({ label, value, onChange, required, size = 120 }) {
  const cameraRef = useRef();
  const fileRef = useRef();
  // Local base64 preview shown while the R2 upload is in flight.
  // The parent tx state only ever receives the final /api/photos/ URL.
  const [preview, setPreview] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const [zoomed, setZoomed] = useState(false);
  const handleFile = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = '';
    setUploadError(null);
    let base64;
    try {
      base64 = await compressImageFile(file);
    } catch {
      setUploadError('Could not read this image. Please try a different photo.');
      return;
    }
    setPreview(base64); // instant local preview
    setUploading(true);
    // Capture the old URL so we can delete it from R2 after the new upload succeeds.
    const oldValue = value;
    try {
      const mimeType = base64.split(';')[0].split(':')[1];
      const data = base64.split(',')[1];
      const result = await API.post('photos', { data, mimeType });
      if (result?.url) {
        // Delete the previous R2 photo now that a new one is safely uploaded.
        if (oldValue && oldValue.startsWith('/api/photos/')) {
          API.del(oldValue.slice(5)).catch(err => console.error('Failed to delete old photo from R2:', err));
        }
        onChange(result.url); // store only the URL in tx state
        setPreview(null);
      } else {
        onChange(base64); // R2 not configured yet — fall back to base64
        setPreview(null);
      }
    } catch {
      onChange(base64); // network error — fall back to base64
      setPreview(null);
    } finally {
      setUploading(false);
    }
  };

  const displaySrc = preview || value;

  return (
    <div style={{ textAlign: 'center' }}>
      {zoomed && (
        <div onClick={() => setZoomed(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.88)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000, padding: '16px' }}>
          <div onClick={e => e.stopPropagation()} style={{ maxWidth: '100%', maxHeight: '100%', textAlign: 'center' }}>
            <img
              src={displaySrc}
              alt={label}
              style={{ maxWidth: '100%', maxHeight: '80vh', borderRadius: '12px', display: 'block' }}
              onError={e => { e.currentTarget.onerror = null; e.currentTarget.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Crect width='200' height='200' fill='%23fee2e2'/%3E%3Ctext x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' font-size='14' fill='%23dc2626'%3EPhoto unavailable%3C/text%3E%3C/svg%3E"; }}
            />
            <div style={{ display: 'flex', justifyContent: 'center', gap: '12px', marginTop: '16px', flexWrap: 'wrap' }}>
              {displaySrc && <button type="button" style={{ ...S.btn('primary'), border: 'none', cursor: 'pointer' }} onClick={async () => {
                try {
                  const resp = await fetch(displaySrc);
                  const blob = await resp.blob();
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url; a.download = `photo-${Date.now()}.jpg`; a.click();
                  URL.revokeObjectURL(url);
                } catch { /* fall back to direct navigation */ window.open(displaySrc, '_blank'); }
              }}>⬇ Download</button>}
              <button type="button" style={S.btn('outline')} onClick={() => setZoomed(false)}>✕ Close</button>
            </div>
          </div>
        </div>
      )}
      <div style={{ ...S.photoBox, width: size, height: size, cursor: uploading ? 'default' : 'pointer' }} onClick={() => { if (uploading) return; displaySrc ? setZoomed(true) : cameraRef.current?.click(); }}>
        {displaySrc
          ? <img src={displaySrc} style={S.photoImg} alt={label} onError={e => { e.currentTarget.onerror = null; e.currentTarget.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Crect width='120' height='120' fill='%23fee2e2'/%3E%3Ctext x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' font-size='11' fill='%23dc2626'%3EPhoto%0Aunavailable%3C/text%3E%3C/svg%3E"; }} />
          : <span style={{ fontSize: '11px', color: COLORS.textMuted, padding: '8px', textAlign: 'center' }}>📷 {label}</span>}
        {uploading && (
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '8px' }}>
            <span style={{ color: '#fff', fontSize: '11px', fontWeight: 700 }}>Uploading…</span>
          </div>
        )}
        {displaySrc && !uploading && (
          <button type="button" onClick={e => { e.stopPropagation(); if (value && value.startsWith('/api/photos/')) { API.del(value.slice(5)).catch(() => {}); } onChange(null); setPreview(null); }} style={{ position: 'absolute', top: '4px', right: '4px', width: '20px', height: '20px', borderRadius: '50%', border: 'none', background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: '11px', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, lineHeight: 1 }}>✕</button>
        )}
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" onChange={handleFile} style={{ display: 'none' }} />
        <input ref={fileRef} type="file" accept="image/*" onChange={handleFile} style={{ display: 'none' }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'center', gap: '6px', marginTop: '6px' }}>
        <button type="button" style={S.btnSm('primary')} onClick={() => { if (!uploading) cameraRef.current?.click(); }} disabled={uploading}>📷 Camera</button>
        <button type="button" style={S.btnSm('secondary')} onClick={() => { if (!uploading) fileRef.current?.click(); }} disabled={uploading}>🖼 Gallery</button>
      </div>
      <div style={{ fontSize: '10.5px', marginTop: '4px', color: required ? COLORS.danger : COLORS.textMuted, fontWeight: 600 }}>{label} {required && '*'}</div>
      {uploadError && <div style={{ fontSize: '11px', color: COLORS.danger, marginTop: '4px', maxWidth: size }}>{uploadError}</div>}
    </div>
  );
}

function Field({ label, required, children, style: st }) {
  return (<div style={{ marginBottom: '14px', ...st }}><label style={S.label}>{label} {required && <span style={{ color: COLORS.danger }}>*</span>}</label>{children}</div>);
}

// ============================================================
// INFO ICON — contextual help tooltip (hover on desktop, tap on mobile)
// Tooltip uses position:fixed so it is never clipped by overflow:hidden parents.
// Placement is computed from the icon's bounding rect and clamped to the viewport.
// ============================================================
function InfoIcon({ tip }) {
  const [coords, setCoords] = useState(null);
  const ref = useRef();
  const TIP_W = 240;
  const GAP = 8;
  const EDGE_PAD = 10;
  const MIN_SPACE_ABOVE = 80; // px — flip tooltip below the icon if less space than this above it

  const show = (e) => {
    if (!ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // Prefer above the icon; flip below if too close to top
    const spaceAbove = r.top;
    const placeBelow = spaceAbove < MIN_SPACE_ABOVE;
    const top = placeBelow ? r.bottom + GAP : r.top - GAP;
    // Centre on the icon, then clamp to viewport edges
    let left = r.left + r.width / 2 - TIP_W / 2;
    left = Math.max(EDGE_PAD, Math.min(left, vw - TIP_W - EDGE_PAD));
    setCoords({ top, left, below: placeBelow });
  };

  const hide = () => setCoords(null);

  useEffect(() => {
    if (!coords) return;
    const close = (e) => {
      if (ref.current && !ref.current.contains(e.target)) hide();
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('touchstart', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('touchstart', close);
    };
  }, [coords]);

  const tooltipStyle = {
    position: 'fixed',
    zIndex: 99999,
    background: '#1a1a2e',
    color: '#fff',
    fontSize: '13px',
    fontWeight: 400,
    lineHeight: 1.55,
    textTransform: 'none',
    letterSpacing: 'normal',
    padding: '10px 13px',
    borderRadius: '10px',
    width: TIP_W + 'px',
    boxShadow: '0 6px 24px rgba(0,0,0,0.32)',
    pointerEvents: 'none',
    top: coords ? (coords.below ? coords.top : undefined) : undefined,
    bottom: coords && !coords.below ? (window.innerHeight - coords.top) + 'px' : undefined,
    left: coords ? coords.left + 'px' : undefined,
  };

  return (
    <span
      ref={ref}
      style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', verticalAlign: 'middle', marginLeft: '4px', flexShrink: 0 }}
      onMouseEnter={show}
      onMouseLeave={hide}
      onClick={e => { e.stopPropagation(); coords ? hide() : show(e); }}
    >
      <span style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: '14px', height: '14px', borderRadius: '50%',
        background: COLORS.primaryLight, color: COLORS.primary,
        fontSize: '9px', fontWeight: 800, cursor: 'pointer',
        border: `1px solid ${COLORS.primary}`, lineHeight: 1, userSelect: 'none',
        flexShrink: 0, textTransform: 'none', letterSpacing: 'normal',
      }}>ℹ</span>
      {coords && <span style={tooltipStyle}>{tip}</span>}
    </span>
  );
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
// PARTNERSHIP FOOTNOTE — shown on all public & logged-in pages
// dark=true for pre-login pages (dark background),
// dark=false (default) for the post-login light-themed area
// ============================================================
function PartnershipFootnote({ dark = false }) {
  const textMain  = dark ? '#6b7280' : COLORS.textMuted;
  const textBold  = dark ? '#9ca3af' : COLORS.text;
  const dotColor  = dark ? '#6b7280' : COLORS.textMuted;
  return (
    <div style={{ fontSize: '11px', color: textMain, textAlign: 'center', lineHeight: 1.6, letterSpacing: '0.1px' }}>
      <span>A joint venture between <strong style={{ color: textBold }}>Vido Hub</strong> &amp; <strong style={{ color: textBold }}>FATK Enterprises</strong></span>
      <span style={{ margin: '0 6px', color: dotColor, opacity: 0.5 }}>·</span>
      <span>Platform developed &amp; managed by <strong style={{ color: textBold }}>Vido Hub</strong></span>
    </div>
  );
}

// ============================================================
// LANDING PAGE
// ============================================================
function LandingPage({ onCheckLoan, onStaffLogin, onShop, settings }) {
  const s = settings || {};
  const phone1 = s.shopPhone1 ?? '08165491908';
  const phone2 = s.shopPhone2 ?? '09023540646';
  const address = s.shopAddress ?? 'Current Filling Station, off Tourist Garden Hotel, Enugwu-Aguleri, Anambra East LGA, Anambra State';
  const hours = s.shopHours ?? 'Monday – Saturday, 8am – 6pm';
  const mapsUrl = s.shopMapsUrl || `https://www.google.com/search?q=${encodeURIComponent(address)}`;
  const whatsApp = s.shopWhatsApp ?? '2348165491908';

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
      <div style={{ width: '100%', maxWidth: '1126px', margin: '0 auto', textAlign: 'center', borderInline: '1px solid rgba(229, 228, 231, 0.2)' }}>
        {/* Hero */}
        <div style={{ background: '#1a5f2a', padding: '36px 20px 32px', textAlign: 'center' }}>
          <div style={{ display: 'inline-block', background: 'rgba(255,255,255,0.15)', borderRadius: '20px', padding: '4px 14px', fontSize: '13px', marginBottom: '14px', color: '#e0f0e3' }}>
            📍 Enugwu-Aguleri, Anambra
          </div>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '6px' }}>
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="56" height="56">
              <path d="M38 35 L25 15 Q50 22 75 15 L62 35 Z" fill="#d2b48c" stroke="#8b7355" strokeWidth="2" strokeLinejoin="round"/>
              <path d="M40 35 L60 35 C75 35 85 60 80 80 C75 95 25 95 20 80 C15 60 25 35 40 35 Z" fill="#deb887" stroke="#8b7355" strokeWidth="2" strokeLinejoin="round"/>
              <path d="M35 35 Q50 38 65 35" fill="none" stroke="#5c4033" strokeWidth="3" strokeLinecap="round"/>
              <text x="50" y="72" fontFamily="Arial, sans-serif" fontSize="34" fontWeight="bold" fill="#2c1e16" textAnchor="middle">₦</text>
            </svg>
          </div>
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
              onClick={onShop}
              style={{ background: '#c8a84e', color: '#fff', border: 'none', borderRadius: '10px', padding: '16px', fontSize: '17px', fontWeight: 700, cursor: 'pointer', minHeight: '52px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', width: '100%' }}
            >
              🛍 Browse Items for Sale
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
              <div key={i} style={{ display: 'flex', gap: '14px', alignItems: 'flex-start', textAlign: 'left' }}>
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
              <div key={i} style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', textAlign: 'left' }}>
                <div style={{ color: '#4ade80', marginTop: '4px', flexShrink: 0 }}>●</div>
                <div style={{ fontSize: '15px', color: '#d1d5db', lineHeight: 1.5 }}>{n}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Contact & Location */}
        <div style={{ background: '#111827', padding: '28px 20px' }}>
          <h2 style={{ fontSize: '20px', fontWeight: 800, margin: '0 0 20px', color: '#fff' }}>Find us</h2>
          <div style={{ background: '#1e2433', borderRadius: '12px', padding: '20px', marginBottom: '16px', border: '1px solid #2a3447', textAlign: 'left' }}>
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
          <div style={{ marginBottom: '10px' }}>© 2026 Christ-in-Fabian Quick Cash. All rights reserved.</div>
          <div style={{ marginBottom: '12px' }}><PartnershipFootnote dark /></div>
          <button
            onClick={onStaffLogin}
            style={{ background: 'none', border: 'none', color: '#4b5563', fontSize: '12px', cursor: 'pointer', textDecoration: 'underline', padding: '4px' }}
          >
            Staff / Admin Login
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// PUBLIC SALES PAGE
// ============================================================
function SalesPage({ onBack, settings }) {
  const cachedShopData = useMemo(() => readShopCache(), []);
  const [items, setItems] = useState(cachedShopData?.items || []);
  const [loading, setLoading] = useState(!cachedShopData);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [sortBy, setSortBy] = useState('newest');
  const [selectedItem, setSelectedItem] = useState(null);
  const [soldItems, setSoldItems] = useState(cachedShopData?.soldItems || []);
  const [photoIdx, setPhotoIdx] = useState(0);
  const isMobile = useMobile();

  const s = settings || {};
  const phone1 = s.shopPhone1 ?? '08165491908';
  const whatsApp = s.shopWhatsApp ?? '2348165491908';
  const address = s.shopAddress ?? 'Current Filling Station, off Tourist Garden Hotel, Enugwu-Aguleri, Anambra East LGA, Anambra State';
  const hours = s.shopHours ?? 'Monday – Saturday, 8am – 6pm';

  useEffect(() => {
    if (cachedShopData?.soldItems) setSoldItems(cachedShopData.soldItems);

    let cancelled = false;
    const load = async () => {
      if (!cachedShopData) setLoading(true);
      const data = await API.get('shop-items');
      if (cancelled) return;
      if (data?.items) setItems(data.items);
      if (data?.soldItems) setSoldItems(data.soldItems);
      if (data?.items || data?.soldItems) {
        writeShopCache({
          items: data?.items || [],
          soldItems: data?.soldItems || [],
        });
      }
      setLoading(false);
    };
    load();
    return () => { cancelled = true; };
  }, [cachedShopData]);

  const categories = useMemo(() => {
    const cats = new Set(items.map(i => i.itemType));
    return ['all', ...Array.from(cats).sort()];
  }, [items]);

  const filtered = useMemo(() => {
    let result = [...items];
    if (categoryFilter !== 'all') {
      result = result.filter(i => i.itemType === categoryFilter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(i =>
        (i.brand + ' ' + i.model + ' ' + i.itemType + ' ' + i.colour).toLowerCase().includes(q)
      );
    }
    if (sortBy === 'price-low') result.sort((a, b) => (a.salePrice || 0) - (b.salePrice || 0));
    else if (sortBy === 'price-high') result.sort((a, b) => (b.salePrice || 0) - (a.salePrice || 0));
    // newest is default order from API
    return result;
  }, [items, categoryFilter, search, sortBy]);

  const getWhatsAppLink = (item) => {
    const displayRef = item?.shopId || item?.ref || '';
    const msg = item
      ? `Hello! I am interested in the ${item.brand} ${item.model} (${item.itemType}) listed for ${fmtMoney(item.salePrice)}. Item Ref: ${displayRef}. Is it still available?`
      : 'Hello! I want to check what items you have for sale.';
    return `https://wa.me/${whatsApp}?text=${encodeURIComponent(msg)}`;
  };

  const getCallLink = () => `tel:${phone1}`;

  const itemIcon = (type) => {
    const t = (type || '').toLowerCase();
    if (t.includes('phone') || t.includes('smart')) return '📱';
    if (t.includes('laptop')) return '💻';
    if (t.includes('tablet')) return '📱';
    if (t.includes('speaker')) return '🔊';
    if (t.includes('power bank')) return '🔋';
    if (t.includes('fan')) return '🌀';
    if (t.includes('tv')) return '📺';
    if (t.includes('generator')) return '⚡';
    if (t.includes('gas') || t.includes('cylinder')) return '🔥';
    return '📦';
  };

  const conditionBadge = (cond) => {
    if (!cond) return null;
    const c = cond.toLowerCase();
    let color = '#6b7280';
    if (c.includes('excellent') || c.includes('new') || c.includes('perfect')) color = '#10b981';
    else if (c.includes('good') || c.includes('fair')) color = '#f59e0b';
    else if (c.includes('poor') || c.includes('bad')) color = '#ef4444';
    return { label: cond, color };
  };

  const selectItem = (item) => { setSelectedItem(item); setPhotoIdx(0); };

  // ── Full-page item detail view ──
  if (selectedItem) {
    const item = selectedItem;
    const photos = item.photos?.length > 0 ? item.photos : item.photoFront ? [item.photoFront] : [];
    const similarItems = items.filter(i => i.ref !== item.ref && i.itemType === item.itemType).slice(0, 4);
    const listedAgo = item.listedDate ? daysBetween(item.listedDate) : null;
    const listedAgoText = listedAgo === 0 ? 'Listed today' : listedAgo === 1 ? 'Listed yesterday' : listedAgo !== null ? `Listed ${listedAgo} days ago` : '';
    const WA_SVG = <svg width="18" height="18" viewBox="0 0 32 32" fill="none"><path d="M16 3C9.373 3 4 8.373 4 15c0 2.385.668 4.61 1.82 6.51L4 29l7.7-1.79A11.92 11.92 0 0016 27c6.627 0 12-5.373 12-12S22.627 3 16 3z" fill="white" fillOpacity="0.3"/><path fillRule="evenodd" clipRule="evenodd" d="M21.5 18.3c-.3-.15-1.77-.87-2.04-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.17-.17.2-.35.22-.65.07-.3-.15-1.26-.46-2.4-1.48-.89-.79-1.49-1.77-1.66-2.07-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.07-.15-.67-1.62-.92-2.22-.24-.58-.49-.5-.67-.51H12.5c-.2 0-.52.07-.79.37-.27.3-1.04 1.02-1.04 2.49 0 1.47 1.07 2.89 1.22 3.09.15.2 2.1 3.2 5.09 4.49.71.31 1.27.49 1.7.63.72.23 1.37.2 1.89.12.58-.09 1.77-.72 2.02-1.42.25-.7.25-1.3.17-1.42-.07-.12-.27-.2-.57-.35z" fill="white"/></svg>;
    return (
      <div style={{ fontFamily: "'DM Sans', 'Nunito', sans-serif", background: '#f8f6f1', minHeight: '100vh', color: '#1a1a1a' }}>
        <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet" />

        {/* Header */}
        <div style={{ background: '#1a5f2a', padding: '12px 20px', position: 'sticky', top: 0, zIndex: 100, boxShadow: '0 2px 8px rgba(0,0,0,0.15)' }}>
          <div style={{ maxWidth: '1000px', margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <button onClick={() => setSelectedItem(null)} style={{ background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff', borderRadius: '8px', padding: '8px 14px', fontSize: '14px', fontWeight: 600, cursor: 'pointer' }}>← Back to Shop</button>
            <div style={{ fontSize: '13px', fontWeight: 700, color: '#a7f3d0' }}>Christ-in-Fabian Quick Cash</div>
            <a href={getWhatsAppLink(item)} target="_blank" rel="noopener noreferrer" style={{ background: '#25D366', border: 'none', color: '#fff', borderRadius: '8px', padding: '8px 12px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '5px' }}>{WA_SVG}{isMobile ? '' : 'Chat'}</a>
          </div>
        </div>

        <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
          {/* Photo Section */}
          <div style={{ background: '#fff' }}>
            <div style={{ position: 'relative', height: isMobile ? '320px' : '440px', background: '#f3f4f6', overflow: 'hidden' }}>
              {photos.length > 0 ? (
                <img src={photos[photoIdx]} alt={`${item.brand} ${item.model}`} style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#f3f4f6' }} loading="eager" fetchPriority="high" decoding="async" onError={e => { e.currentTarget.onerror = null; }} />
              ) : (
                <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '80px', background: 'linear-gradient(135deg, #e8f5ec, #d1fae5)' }}>{itemIcon(item.itemType)}</div>
              )}
              {photos.length > 1 && <div style={{ position: 'absolute', bottom: '12px', left: '50%', transform: 'translateX(-50%)', background: 'rgba(0,0,0,0.55)', color: '#fff', borderRadius: '20px', padding: '4px 14px', fontSize: '13px', fontWeight: 600 }}>{photoIdx + 1}/{photos.length}</div>}
              {photos.length > 1 && <>
                <button onClick={() => setPhotoIdx(i => (i - 1 + photos.length) % photos.length)} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', width: '40px', height: '40px', borderRadius: '50%', background: 'rgba(0,0,0,0.45)', border: 'none', color: '#fff', fontSize: '24px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>‹</button>
                <button onClick={() => setPhotoIdx(i => (i + 1) % photos.length)} style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', width: '40px', height: '40px', borderRadius: '50%', background: 'rgba(0,0,0,0.45)', border: 'none', color: '#fff', fontSize: '24px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>›</button>
              </>}
            </div>
            {photos.length > 1 && (
              <div style={{ display: 'flex', gap: '6px', padding: '10px 16px', overflowX: 'auto', borderTop: '1px solid #e5e7eb' }}>
                {photos.map((p, i) => (
                  <button key={i} onClick={() => setPhotoIdx(i)} style={{ flex: '0 0 62px', height: '62px', border: `2.5px solid ${i === photoIdx ? '#1a5f2a' : 'transparent'}`, borderRadius: '8px', overflow: 'hidden', padding: 0, cursor: 'pointer', background: '#f9fafb' }}>
                    <img src={p} alt={`Thumb ${i + 1}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} loading="lazy" decoding="async" />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Info Section */}
          <div style={{ background: '#fff', padding: isMobile ? '20px 16px' : '28px 24px', marginTop: '2px' }}>
            <div style={{ fontSize: '11px', fontWeight: 700, color: '#1a5f2a', textTransform: 'uppercase', letterSpacing: '1.2px', marginBottom: '6px' }}>For Sale · {item.itemType}</div>
            <h1 style={{ fontSize: isMobile ? '22px' : '28px', fontWeight: 800, margin: '0 0 10px', color: '#111', lineHeight: 1.2 }}>{item.brand} {item.model}</h1>
            <div style={{ fontSize: isMobile ? '36px' : '44px', fontWeight: 900, color: '#1a5f2a', marginBottom: '14px', lineHeight: 1, letterSpacing: '-0.5px' }}>
              {item.salePrice ? fmtMoney(item.salePrice) : 'Contact us for price'}
            </div>

            {/* Listed date */}
            {item.listedDate && (
              <div style={{ fontSize: '13px', color: '#6b7280', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span>{listedAgoText}</span>
                <span style={{ color: '#d1d5db' }}>·</span>
                <span>{fmtDate(item.listedDate)}</span>
              </div>
            )}

            {/* Savings badge — only shown when staff has set the item's new retail price */}
            {item.itemNewPrice > 0 && item.salePrice > 0 && item.itemNewPrice > item.salePrice && (
              <div style={{ background: '#f0fdf4', borderRadius: '10px', padding: '12px 16px', marginBottom: '16px', border: '1px solid #bbf7d0', display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{ fontSize: '28px' }}>🏷️</div>
                <div>
                  <div style={{ fontSize: '15px', fontWeight: 800, color: '#166534' }}>
                    You save {fmtMoney(item.itemNewPrice - item.salePrice)} ({Math.round((item.itemNewPrice - item.salePrice) / item.itemNewPrice * 100)}% off new price)
                  </div>
                  <div style={{ fontSize: '12px', color: '#059669', marginTop: '1px' }}>
                    New item price: {fmtMoney(item.itemNewPrice)} · Our price: {fmtMoney(item.salePrice)}
                  </div>
                </div>
              </div>
            )}

            {/* Condition + spec chips */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '18px' }}>
              {item.condition && (
                <span style={{ padding: '6px 14px', borderRadius: '8px', border: '1.5px solid #d1d5db', fontSize: '13px', fontWeight: 500, color: '#374151', background: '#f9fafb' }}>
                  {item.condition.includes(' — ')
                    ? <><span style={{ color: '#6b7280' }}>Condition: </span><strong>{item.condition.split(' — ')[0]}</strong><span style={{ color: '#6b7280' }}> — {item.condition.split(' — ')[1]}</span></>
                    : <><span style={{ color: '#6b7280' }}>Condition: </span><strong>{item.condition}</strong></>
                  }
                </span>
              )}
              {item.brand && <span style={{ padding: '6px 14px', borderRadius: '8px', border: '1.5px solid #d1d5db', fontSize: '13px', fontWeight: 500, color: '#374151', background: '#f9fafb' }}>Brand: <strong>{item.brand}</strong></span>}
              {item.colour && <span style={{ padding: '6px 14px', borderRadius: '8px', border: '1.5px solid #d1d5db', fontSize: '13px', fontWeight: 500, color: '#374151', background: '#f9fafb' }}>Colour: <strong>{item.colour}</strong></span>}
            </div>

            {/* Description (shop note) */}
            {item.shopNote && (
              <div style={{ background: '#f8f6f1', borderRadius: '10px', padding: '14px 16px', marginBottom: '16px', fontSize: '14px', color: '#374151', lineHeight: 1.7, border: '1px solid #e5e1d8', whiteSpace: 'pre-line' }}>
                {item.shopNote}
              </div>
            )}

            {/* IMEI / Serial Number */}
            {(item.imei || item.serialNumber) && (
              <div style={{ marginBottom: '16px', background: '#f9fafb', borderRadius: '10px', padding: '12px 16px', border: '1px solid #e5e7eb' }}>
                <div style={{ fontSize: '11px', fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px' }}>Device Identifier</div>
                {item.imei && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginBottom: item.serialNumber ? '6px' : '0' }}>
                    <div style={{ fontSize: '13px', color: '#374151' }}>IMEI: <strong style={{ fontFamily: 'monospace', letterSpacing: '0.5px' }}>{item.imei}</strong></div>
                    <a href={`https://www.imei.info/?imei=${item.imei}`} target="_blank" rel="noopener noreferrer" style={{ fontSize: '12px', color: '#1a5f2a', fontWeight: 600, textDecoration: 'none', background: '#f0fdf4', padding: '3px 8px', borderRadius: '6px', border: '1px solid #bbf7d0' }}>Verify on imei.info →</a>
                  </div>
                )}
                {item.serialNumber && (
                  <div style={{ fontSize: '13px', color: '#374151' }}>Serial No: <strong style={{ fontFamily: 'monospace', letterSpacing: '0.5px' }}>{item.serialNumber}</strong></div>
                )}
                <div style={{ fontSize: '11px', color: '#9ca3af', marginTop: '6px' }}>Use this to verify the device history before buying.</div>
              </div>
            )}

            {/* Inspection notes (public-facing) */}
            {item.inspectionNotes && (
              <div style={{ marginBottom: '16px' }}>
                <div style={{ fontSize: '12px', fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' }}>Inspection Notes</div>
                <div style={{ fontSize: '14px', color: '#4b5563', lineHeight: 1.6 }}>{item.inspectionNotes}</div>
              </div>
            )}

            <div style={{ height: '1px', background: '#e5e7eb', margin: '0 0 14px' }} />
            <div style={{ fontSize: '13px', color: '#6b7280', marginBottom: '4px' }}>
              Item Ref: <strong style={{ color: '#374151', fontFamily: 'monospace' }}>{item.shopId || item.ref}</strong>
              <span style={{ color: '#d1d5db', margin: '0 8px' }}>·</span>
              Quote this reference when contacting us about this item
            </div>
          </div>

          {/* CTA Buttons */}
          <div style={{ background: '#fff', padding: isMobile ? '16px' : '20px 24px', marginTop: '2px' }}>
            <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: '10px' }}>
              <a href={getWhatsAppLink(item)} target="_blank" rel="noopener noreferrer" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', background: '#25D366', color: '#fff', padding: '16px', borderRadius: '12px', textDecoration: 'none', fontWeight: 700, fontSize: '16px' }}>{WA_SVG} I Want to Buy This</a>
              <a href={getCallLink()} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', background: '#1a5f2a', color: '#fff', padding: '16px', borderRadius: '12px', textDecoration: 'none', fontWeight: 700, fontSize: '16px' }}>📞 Call Us Now</a>
            </div>
            <div style={{ fontSize: '12px', color: '#9ca3af', textAlign: 'center', marginTop: '10px' }}>Visit our shop to inspect the item before buying</div>
          </div>

          {/* More Like This */}
          {similarItems.length > 0 && (
            <div style={{ padding: isMobile ? '24px 16px' : '28px 24px' }}>
              <h2 style={{ fontSize: '18px', fontWeight: 800, marginBottom: '14px', color: '#1a1a1a' }}>More Like This</h2>
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)', gap: '10px' }}>
                {similarItems.map(sim => (
                  <div key={sim.ref} onClick={() => selectItem(sim)} style={{ background: '#fff', borderRadius: '10px', overflow: 'hidden', border: '1px solid #e5e1d8', cursor: 'pointer' }}>
                    {sim.photoFront ? (
                      <div style={{ height: '100px', background: '#f3f4f6', overflow: 'hidden' }}><img src={sim.photoFront} alt={sim.brand} style={{ width: '100%', height: '100%', objectFit: 'cover' }} loading="lazy" decoding="async" /></div>
                    ) : (
                      <div style={{ height: '80px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '28px', background: '#f3f4f6' }}>{itemIcon(sim.itemType)}</div>
                    )}
                    <div style={{ padding: '8px' }}>
                      <div style={{ fontWeight: 700, fontSize: '12px', color: '#374151', marginBottom: '3px' }}>{sim.brand} {sim.model}</div>
                      <div style={{ fontSize: '15px', fontWeight: 900, color: '#1a5f2a' }}>{sim.salePrice ? fmtMoney(sim.salePrice) : 'Contact'}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ background: '#111827', padding: '24px 20px', color: '#fff', textAlign: 'center' }}>
          <div style={{ maxWidth: '600px', margin: '0 auto' }}>
            <div style={{ fontWeight: 700, marginBottom: '8px' }}>Want to buy? Contact us!</div>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', marginBottom: '12px' }}>
              <a href={getWhatsAppLink(item)} target="_blank" rel="noopener noreferrer" style={{ background: '#25D366', color: '#fff', padding: '10px 20px', borderRadius: '8px', textDecoration: 'none', fontWeight: 700, fontSize: '14px', display: 'flex', alignItems: 'center', gap: '6px' }}>{WA_SVG} WhatsApp</a>
              <a href={getCallLink()} style={{ background: '#1a5f2a', color: '#fff', padding: '10px 20px', borderRadius: '8px', textDecoration: 'none', fontWeight: 700, fontSize: '14px' }}>📞 Call</a>
            </div>
            <div style={{ fontSize: '12px', color: '#6b7280' }}>{address}</div>
            <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '4px' }}>{hours}</div>
          </div>
        </div>
        <div style={{ background: '#0a0f1a', padding: '12px 20px', textAlign: 'center', fontSize: '12px', color: '#6b7280' }}>© 2026 Christ-in-Fabian Quick Cash</div>
      </div>
    );
  }

  return (
    <div style={{ fontFamily: "'DM Sans', 'Nunito', sans-serif", background: '#f8f6f1', minHeight: '100vh', color: '#1a1a1a' }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet" />

      {/* Header */}
      <div style={{ background: '#1a5f2a', padding: '16px 20px', position: 'sticky', top: 0, zIndex: 100, boxShadow: '0 2px 8px rgba(0,0,0,0.15)' }}>
        <div style={{ maxWidth: '1200px', margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <button onClick={onBack} style={{ background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff', borderRadius: '8px', padding: '8px 14px', fontSize: '14px', fontWeight: 600, cursor: 'pointer' }}>
            ← Back
          </button>
          <div style={{ textAlign: 'center', flex: 1 }}>
            <div style={{ fontSize: isMobile ? '15px' : '18px', fontWeight: 800, color: '#fff' }}>🏷 Items for Sale</div>
            <div style={{ fontSize: '12px', color: '#a7f3d0' }}>Christ-in-Fabian Quick Cash</div>
          </div>
          <a href={getWhatsAppLink()} target="_blank" rel="noopener noreferrer" style={{ background: '#25D366', border: 'none', color: '#fff', borderRadius: '8px', padding: '8px 14px', fontSize: '14px', fontWeight: 600, cursor: 'pointer', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <svg width="16" height="16" viewBox="0 0 32 32" fill="none"><path d="M16 3C9.373 3 4 8.373 4 15c0 2.385.668 4.61 1.82 6.51L4 29l7.7-1.79A11.92 11.92 0 0016 27c6.627 0 12-5.373 12-12S22.627 3 16 3z" fill="white" fillOpacity="0.3"/><path fillRule="evenodd" clipRule="evenodd" d="M21.5 18.3c-.3-.15-1.77-.87-2.04-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.17-.17.2-.35.22-.65.07-.3-.15-1.26-.46-2.4-1.48-.89-.79-1.49-1.77-1.66-2.07-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.07-.15-.67-1.62-.92-2.22-.24-.58-.49-.5-.67-.51H12.5c-.2 0-.52.07-.79.37-.27.3-1.04 1.02-1.04 2.49 0 1.47 1.07 2.89 1.22 3.09.15.2 2.1 3.2 5.09 4.49.71.31 1.27.49 1.7.63.72.23 1.37.2 1.89.12.58-.09 1.77-.72 2.02-1.42.25-.7.25-1.3.17-1.42-.07-.12-.27-.2-.57-.35z" fill="white"/></svg>
            {isMobile ? '' : 'Chat'}
          </a>
        </div>
      </div>

      {/* Hero banner */}
      <div style={{ background: 'linear-gradient(135deg, #0d3518, #1a5f2a, #2d7a3e)', padding: isMobile ? '24px 20px' : '32px 20px', textAlign: 'center', color: '#fff' }}>
        <div style={{ maxWidth: '700px', margin: '0 auto' }}>
          <div style={{ fontSize: '36px', marginBottom: '8px' }}>🛍</div>
          <h1 style={{ fontSize: isMobile ? '22px' : '28px', fontWeight: 800, margin: '0 0 8px', lineHeight: 1.3 }}>Quality Items at Low Prices</h1>
          <p style={{ fontSize: '15px', opacity: 0.9, margin: '0 0 4px' }}>
            Phones, Laptops, TVs, Generators and more — all checked and ready
          </p>
          <p style={{ fontSize: '13px', opacity: 0.7, margin: 0 }}>
            Walk into our shop or contact us on WhatsApp to buy
          </p>
        </div>
      </div>

      {/* How to Buy section */}
      <div style={{ background: '#fff', borderBottom: '1px solid #e5e1d8', padding: '20px' }}>
        <div style={{ maxWidth: '800px', margin: '0 auto' }}>
          <h2 style={{ fontSize: '16px', fontWeight: 800, margin: '0 0 12px', color: '#1a5f2a', textAlign: 'center' }}>How to Buy — 3 Easy Steps</h2>
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr 1fr', gap: '12px' }}>
            {[
              { num: '1', icon: '👀', title: 'See What You Like', desc: 'Look through the items below. Tap any item to see more details.' },
              { num: '2', icon: '💬', title: 'Contact Us', desc: 'Tap "I Want to Buy This" or call us. Tell us the item ref number.' },
              { num: '3', icon: '🤝', title: 'Come and Collect', desc: 'Visit our shop, check the item, pay, and take it home.' },
            ].map(step => (
              <div key={step.num} style={{ background: '#f0fdf4', borderRadius: '12px', padding: '16px', textAlign: 'center', border: '1px solid #bbf7d0' }}>
                <div style={{ width: '32px', height: '32px', background: '#1a5f2a', color: '#fff', borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '15px', marginBottom: '8px' }}>{step.num}</div>
                <div style={{ fontSize: '20px', marginBottom: '4px' }}>{step.icon}</div>
                <div style={{ fontWeight: 700, fontSize: '14px', marginBottom: '4px', color: '#1a1a1a' }}>{step.title}</div>
                <div style={{ fontSize: '13px', color: '#6b7280', lineHeight: 1.4 }}>{step.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Search + Filters */}
      <div style={{ background: '#fff', borderBottom: '1px solid #e5e1d8', padding: '16px 20px', position: 'sticky', top: isMobile ? '52px' : '56px', zIndex: 50 }}>
        <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
          {/* Search bar */}
          <div style={{ position: 'relative', marginBottom: '12px' }}>
            <span style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', fontSize: '18px' }}>🔍</span>
            <input
              type="text"
              placeholder="Search items... e.g. Samsung, iPhone, TV, Generator"
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ width: '100%', padding: '12px 12px 12px 40px', borderRadius: '10px', border: '2px solid #e5e1d8', fontSize: '15px', outline: 'none', boxSizing: 'border-box', background: '#f8f6f1' }}
            />
          </div>
          {/* Filter chips + sort */}
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', flex: 1 }}>
              {categories.map(cat => (
                <button
                  key={cat}
                  onClick={() => setCategoryFilter(cat)}
                  style={{
                    padding: '6px 14px', borderRadius: '20px', border: 'none',
                    fontSize: '13px', fontWeight: 600, cursor: 'pointer',
                    background: categoryFilter === cat ? '#1a5f2a' : '#f3f4f6',
                    color: categoryFilter === cat ? '#fff' : '#4b5563',
                    transition: 'all 0.15s',
                  }}
                >
                  {cat === 'all' ? 'All Items' : cat}
                </button>
              ))}
            </div>
            <select
              value={sortBy}
              onChange={e => setSortBy(e.target.value)}
              style={{ padding: '6px 10px', borderRadius: '8px', border: '1.5px solid #e5e1d8', fontSize: '13px', background: '#fff', cursor: 'pointer' }}
            >
              <option value="newest">Newest First</option>
              <option value="price-low">Lowest Price</option>
              <option value="price-high">Highest Price</option>
            </select>
          </div>
        </div>
      </div>

      {/* Items count */}
      <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '16px 20px 0' }}>
        <div style={{ fontSize: '14px', color: '#6b7280', fontWeight: 600 }}>
          {loading ? 'Loading items...' : `${filtered.length} item${filtered.length !== 1 ? 's' : ''} available`}
        </div>
      </div>

      {/* Items grid */}
      <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '12px 20px 32px' }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: '60px 20px' }}>
            <div style={{ fontSize: '48px', marginBottom: '12px' }}>🔄</div>
            <div style={{ fontWeight: 700, fontSize: '16px', color: '#6b7280' }}>Loading items for sale...</div>
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 20px' }}>
            <div style={{ fontSize: '48px', marginBottom: '12px' }}>{items.length === 0 ? '🏪' : '🔍'}</div>
            <div style={{ fontWeight: 700, fontSize: '18px', marginBottom: '8px', color: '#1a1a1a' }}>
              {items.length === 0 ? 'No Items Available Right Now' : 'No items match your search'}
            </div>
            <div style={{ fontSize: '15px', color: '#6b7280', maxWidth: '400px', margin: '0 auto', lineHeight: 1.5, marginBottom: '20px' }}>
              {items.length === 0
                ? 'We don\'t have any items for sale at the moment. Check back later or contact us to ask about upcoming items.'
                : 'Try a different search or tap "All Items" to see everything.'}
            </div>
            {items.length === 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxWidth: '320px', margin: '0 auto' }}>
                <a href={getWhatsAppLink()} target="_blank" rel="noopener noreferrer" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', background: '#25D366', color: '#fff', padding: '14px', borderRadius: '10px', textDecoration: 'none', fontWeight: 700, fontSize: '15px' }}>
                  <svg width="18" height="18" viewBox="0 0 32 32" fill="none"><path d="M16 3C9.373 3 4 8.373 4 15c0 2.385.668 4.61 1.82 6.51L4 29l7.7-1.79A11.92 11.92 0 0016 27c6.627 0 12-5.373 12-12S22.627 3 16 3z" fill="white" fillOpacity="0.3"/><path fillRule="evenodd" clipRule="evenodd" d="M21.5 18.3c-.3-.15-1.77-.87-2.04-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.17-.17.2-.35.22-.65.07-.3-.15-1.26-.46-2.4-1.48-.89-.79-1.49-1.77-1.66-2.07-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.07-.15-.67-1.62-.92-2.22-.24-.58-.49-.5-.67-.51H12.5c-.2 0-.52.07-.79.37-.27.3-1.04 1.02-1.04 2.49 0 1.47 1.07 2.89 1.22 3.09.15.2 2.1 3.2 5.09 4.49.71.31 1.27.49 1.7.63.72.23 1.37.2 1.89.12.58-.09 1.77-.72 2.02-1.42.25-.7.25-1.3.17-1.42-.07-.12-.27-.2-.57-.35z" fill="white"/></svg>
                  Ask Us on WhatsApp
                </a>
                <a href={getCallLink()} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', background: '#1a5f2a', color: '#fff', padding: '14px', borderRadius: '10px', textDecoration: 'none', fontWeight: 700, fontSize: '15px' }}>
                  📞 Call Us: {phone1}
                </a>
              </div>
            )}
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(auto-fill, minmax(240px, 1fr))', gap: isMobile ? '10px' : '16px', marginTop: '12px' }}>
            {filtered.map((item, index) => {
              return (
                <div
                  key={item.ref}
                  onClick={() => selectItem(item)}
                  style={{
                    background: '#fff', borderRadius: '12px', overflow: 'hidden',
                    border: '1px solid #e5e1d8', cursor: 'pointer',
                    transition: 'transform 0.15s, box-shadow 0.15s',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 8px 20px rgba(0,0,0,0.1)'; }}
                  onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.06)'; }}
                >
                  {/* Image */}
                  {(item.photoFront || item.photoPowerOn) ? (
                    <div style={{ width: '100%', height: isMobile ? '140px' : '180px', background: '#f3f4f6', overflow: 'hidden' }}>
                      <img src={item.photoFront || item.photoPowerOn} alt={`${item.brand} ${item.model}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} loading={index < 4 ? "eager" : "lazy"} fetchPriority={index < 2 ? "high" : "auto"} decoding="async" />
                    </div>
                  ) : (
                    <div style={{ width: '100%', height: isMobile ? '140px' : '180px', background: 'linear-gradient(135deg, #e8f5ec, #d1fae5)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: isMobile ? '40px' : '48px' }}>
                      {itemIcon(item.itemType)}
                    </div>
                  )}

                  {/* Info */}
                  <div style={{ padding: isMobile ? '10px' : '14px' }}>
                    <div style={{ fontSize: '10px', fontWeight: 700, color: '#1a5f2a', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '3px' }}>{item.itemType}</div>
                    <div style={{ fontWeight: 800, fontSize: isMobile ? '13px' : '15px', color: '#1a1a1a', marginBottom: '4px', lineHeight: 1.2 }}>
                      {item.brand} {item.model}
                    </div>
                    {/* Key specs */}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '8px' }}>
                      {item.colour && <span style={{ fontSize: '10px', padding: '2px 7px', borderRadius: '999px', background: '#f3f4f6', color: '#374151', border: '1px solid #e5e7eb', fontWeight: 500 }}>{item.colour}</span>}
                      {item.condition && (() => { const grade = item.condition.split(' — ')[0]; return grade ? <span style={{ fontSize: '10px', padding: '2px 7px', borderRadius: '999px', background: '#f0fdf4', color: '#166534', border: '1px solid #bbf7d0', fontWeight: 600 }}>{grade}</span> : null; })()}
                    </div>
                    <div style={{ fontSize: isMobile ? '20px' : '22px', fontWeight: 900, color: '#1a5f2a', letterSpacing: '-0.3px' }}>
                      {item.salePrice ? fmtMoney(item.salePrice) : 'Contact us'}
                    </div>
                    {item.itemNewPrice > 0 && item.salePrice > 0 && item.itemNewPrice > item.salePrice && (
                      <div style={{ fontSize: '10px', color: '#059669', fontWeight: 700, marginTop: '2px' }}>
                        Save {Math.round((item.itemNewPrice - item.salePrice) / item.itemNewPrice * 100)}% off new price
                      </div>
                    )}
                    <div style={{ fontSize: '11px', color: '#9ca3af', marginTop: '5px' }}>Tap to see details →</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Recently Sold Section */}
      {soldItems.length > 0 && s.shopShowSoldHistory !== false && (
        <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '0 20px 36px' }}>
          <div style={{ borderTop: '2px solid #e5e1d8', paddingTop: '32px', marginTop: '8px' }}>
            <h2 style={{ fontSize: '20px', fontWeight: 800, marginBottom: '4px', color: '#1a1a1a' }}>Recently Sold</h2>
            <p style={{ fontSize: '13px', color: '#6b7280', marginBottom: '20px' }}>Items we've sold recently — proof of quality and fair pricing.</p>
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(auto-fill, minmax(190px, 1fr))', gap: isMobile ? '8px' : '12px' }}>
              {soldItems.map(item => (
                <div key={item.ref} style={{ background: '#fff', borderRadius: '10px', overflow: 'hidden', border: '1px solid #e5e1d8', position: 'relative' }}>
                  <div style={{ position: 'absolute', top: '8px', left: '8px', background: '#374151', color: '#fff', fontSize: '10px', fontWeight: 800, padding: '3px 8px', borderRadius: '4px', letterSpacing: '0.5px', textTransform: 'uppercase', zIndex: 1 }}>Sold</div>
                  {item.photoFront ? (
                    <div style={{ width: '100%', height: '110px', background: '#f3f4f6', overflow: 'hidden' }}>
                      <img src={item.photoFront} alt={`${item.brand} ${item.model}`} style={{ width: '100%', height: '100%', objectFit: 'cover', filter: 'grayscale(25%)' }} loading="lazy" decoding="async" onError={e => { e.currentTarget.onerror = null; e.currentTarget.style.display = 'none'; }} />
                    </div>
                  ) : (
                    <div style={{ width: '100%', height: '90px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '32px', background: '#f3f4f6' }}>{itemIcon(item.itemType)}</div>
                  )}
                  <div style={{ padding: '10px' }}>
                    <div style={{ fontWeight: 700, fontSize: '13px', color: '#374151', marginBottom: '1px' }}>{item.brand} {item.model}</div>
                    <div style={{ fontSize: '11px', color: '#9ca3af', marginBottom: '5px' }}>{item.itemType}</div>
                    <div style={{ fontSize: '16px', fontWeight: 800, color: '#374151' }}>{item.salePrice ? fmtMoney(item.salePrice) : '—'}</div>
                    {item.saleDate && <div style={{ fontSize: '11px', color: '#9ca3af', marginTop: '2px' }}>{fmtDate(item.saleDate)}</div>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Contact footer */}
      <div style={{ background: '#111827', padding: '28px 20px', color: '#fff' }}>
        <div style={{ maxWidth: '800px', margin: '0 auto', textAlign: 'center' }}>
          <h2 style={{ fontSize: '20px', fontWeight: 800, margin: '0 0 8px' }}>Want to Buy? Contact Us!</h2>
          <p style={{ fontSize: '15px', color: '#9ca3af', margin: '0 0 20px' }}>Visit our shop or chat with us. We are happy to help.</p>
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '12px', maxWidth: '500px', margin: '0 auto 20px' }}>
            <a href={getWhatsAppLink()} target="_blank" rel="noopener noreferrer" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', background: '#25D366', color: '#fff', padding: '14px', borderRadius: '10px', textDecoration: 'none', fontWeight: 700, fontSize: '15px' }}>
              <svg width="18" height="18" viewBox="0 0 32 32" fill="none"><path d="M16 3C9.373 3 4 8.373 4 15c0 2.385.668 4.61 1.82 6.51L4 29l7.7-1.79A11.92 11.92 0 0016 27c6.627 0 12-5.373 12-12S22.627 3 16 3z" fill="white" fillOpacity="0.3"/><path fillRule="evenodd" clipRule="evenodd" d="M21.5 18.3c-.3-.15-1.77-.87-2.04-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.17-.17.2-.35.22-.65.07-.3-.15-1.26-.46-2.4-1.48-.89-.79-1.49-1.77-1.66-2.07-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.07-.15-.67-1.62-.92-2.22-.24-.58-.49-.5-.67-.51H12.5c-.2 0-.52.07-.79.37-.27.3-1.04 1.02-1.04 2.49 0 1.47 1.07 2.89 1.22 3.09.15.2 2.1 3.2 5.09 4.49.71.31 1.27.49 1.7.63.72.23 1.37.2 1.89.12.58-.09 1.77-.72 2.02-1.42.25-.7.25-1.3.17-1.42-.07-.12-.27-.2-.57-.35z" fill="white"/></svg>
              WhatsApp Us
            </a>
            <a href={getCallLink()} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', background: '#1a5f2a', color: '#fff', padding: '14px', borderRadius: '10px', textDecoration: 'none', fontWeight: 700, fontSize: '15px' }}>
              📞 Call {phone1}
            </a>
          </div>
          <div style={{ background: '#1e2433', borderRadius: '12px', padding: '16px', marginBottom: '16px', border: '1px solid #2a3447', textAlign: 'left' }}>
            <div style={{ marginBottom: '8px' }}><strong style={{ color: '#9ca3af', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Our Address</strong><div style={{ color: '#e5e7eb', fontSize: '14px', marginTop: '2px' }}>{address}</div></div>
            <div><strong style={{ color: '#9ca3af', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Opening Hours</strong><div style={{ color: '#e5e7eb', fontSize: '14px', marginTop: '2px' }}>{hours}</div></div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div style={{ background: '#0a0f1a', padding: '16px 20px', textAlign: 'center', fontSize: '13px', color: '#6b7280' }}>
        <div style={{ marginBottom: '8px' }}>© 2026 Christ-in-Fabian Quick Cash. All rights reserved.</div>
        <PartnershipFootnote dark />
      </div>

    </div>
  );
}

// ============================================================
// SHOP LISTING MODAL — Staff/Admin manage a for-sale listing
// ============================================================
function ShopListingModal({ tx, settings, onClose, onSave }) {
  // Stable price reference values (computed from props, not state)
  const isOutright = tx.type === 'outright';
  const dailyFee = Math.floor((tx.cashAdvance || 0) * (settings.interestRate || 1) / 100);
  const maxHoldDays = Math.max(1, Number(settings.maxLoanDays) || 30) + Math.max(0, Number(settings.graceDays) || 3);
  const outrightMinMarkupPct = settings.outrightMinMarkupPct ?? DEFAULT_SETTINGS.outrightMinMarkupPct;
  const minPrice = isOutright
    ? roundToNice(
        Math.floor((tx.cashAdvance || 0) * (1 + outrightMinMarkupPct / 100))
      )
    : roundToNice(
        (tx.cashAdvance || 0) + maxHoldDays * dailyFee + Math.floor((tx.cashAdvance || 0) * (settings.minSellBonus || 20) / 100)
      );
  const targetPrice = roundToNice(Math.floor((tx.estimatedValue || 0) * (settings.targetSellPct || 75) / 100));
  const listedPrice = Math.max(targetPrice, minPrice);
  const targetDeadline = Math.max(1, Number(settings.targetSaleDeadlineDays) || 14);
  const targetSaleDate = getTargetSaleDate(tx, settings);
  const today = localISODate();
  const totalDays = targetSaleDate
    ? Math.max(1, Math.round((new Date(targetSaleDate) - new Date(tx.dateGiven)) / 86400000))
    : 1;
  const elapsedSinceGiven = daysBetween(tx.dateGiven);
  const deadlineProgress = Math.min(100, Math.round((elapsedSinceGiven / totalDays) * 100));
  const daysUntilTarget = getDaysUntilTargetSale(tx, settings);
  const isPastTarget = !!targetSaleDate && today > targetSaleDate;
  const isNewListing = tx.status !== 'for_sale';

  // Raw condition text from inspection for initialising state
  const rawCondText = tx.shopCondition || tx.conditionDescription || tx.aiCondition || '';

  // Initialise conditionGrade: prefer an exact stored grade, else derive from text
  const initGrade = CONDITION_GRADES.includes(tx.shopCondition)
    ? tx.shopCondition
    : (rawCondText ? deriveConditionGrade(rawCondText) : '');

  const [photosList, setPhotosList] = useState(() => normalizeItemPhotos(tx.itemPhotos).filter(Boolean));
  const [conditionGrade, setConditionGrade] = useState(initGrade);
  const [shopNote, setShopNote] = useState(tx.shopListingNote || rawCondText);
  const [salePrice, setSalePrice] = useState(tx.salePrice > 0 ? tx.salePrice : listedPrice);
  // itemNewPrice = what this item costs brand new (retail). Used to display buyer savings in the shop.
  // Priority: explicitly saved itemNewPrice > AI Run 3 aiNewMarketPrice > 0 (blank).
  const aiMarketPrice = Number(tx.aiNewMarketPrice) || 0;
  const [itemNewPrice, setItemNewPrice] = useState(tx.itemNewPrice > 0 ? tx.itemNewPrice : aiMarketPrice > 0 ? aiMarketPrice : 0);
  const [hiddenPhotoIndexes, setHiddenPhotoIndexes] = useState(Array.isArray(tx.hiddenPhotoIndexes) ? tx.hiddenPhotoIndexes : []);
  const [priceDropEnabled, setPriceDropEnabled] = useState(tx.priceDropEnabled || false);
  const [priceDropIntervalDays, setPriceDropIntervalDays] = useState(tx.priceDropIntervalDays || 3);
  const [aiToneLoading, setAiToneLoading] = useState(null); // null | 'paragraph' | 'bullets' | 'short'
  const [saving, setSaving] = useState(false);
  const [showInspection, setShowInspection] = useState(false);
  const [showDropSchedule, setShowDropSchedule] = useState(false);
  const addPhotoRef = useRef(null);

  const visibleCount = photosList.filter((_, i) => !hiddenPhotoIndexes.includes(i)).length;
  const daysListed = getForSaleDaysListed(tx) || 0;
  const listedDate = getForSaleListedDate(tx);

  // Price drop calculations (all prices rounded to nearest ₦50)
  const dropInterval = Math.max(1, priceDropIntervalDays);
  const maxDrops = Math.floor(targetDeadline / dropInterval);
  const drops = Math.min(Math.floor(daysListed / dropInterval), maxDrops);
  const dropPerInterval = (maxDrops > 0 && priceDropEnabled) ? roundToNice(Math.floor((listedPrice - minPrice) / maxDrops)) : 0;
  const suggestedPrice = (priceDropEnabled && drops > 0 && dropPerInterval > 0) ? Math.max(minPrice, listedPrice - drops * dropPerInterval) : listedPrice;

  const dropSchedule = (priceDropEnabled && maxDrops > 0 && dropPerInterval > 0)
    ? Array.from({ length: maxDrops + 1 }, (_, i) => ({
        day: i * dropInterval,
        price: Math.max(minPrice, listedPrice - i * dropPerInterval),
        isCurrent: !isNewListing && i * dropInterval <= daysListed && (i + 1) * dropInterval > daysListed,
      }))
    : [];

  // Inspection data
  const inspectionNotes = tx.inspectionNotes || '';
  const inspectionChecklist = tx.inspectionChecklist || {};
  const hasInspectionData = !!(inspectionNotes || Object.keys(inspectionChecklist).length);

  // Photo operations
  const swapPhotos = (i, j) => {
    const next = [...photosList];
    [next[i], next[j]] = [next[j], next[i]];
    setPhotosList(next);
    setHiddenPhotoIndexes(hiddenPhotoIndexes.map(idx => idx === i ? j : idx === j ? i : idx));
  };
  const handleAddPhoto = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    try {
      const compressed = await compressImageFile(file, { maxDimension: 1200, quality: 0.8 });
      setPhotosList(prev => [...prev, compressed]);
    } catch { alert('Failed to process photo. Try a different image.'); }
    e.target.value = '';
  };
  const handleRemovePhoto = (i) => {
    const isVisible = !hiddenPhotoIndexes.includes(i);
    if (isVisible && visibleCount <= 2) { alert('Cannot remove — at least 2 photos must be visible. Hide this one first or add another.'); return; }
    setPhotosList(photosList.filter((_, idx) => idx !== i));
    setHiddenPhotoIndexes(hiddenPhotoIndexes.filter(idx => idx !== i).map(idx => idx > i ? idx - 1 : idx));
  };
  const togglePhotoVisibility = (i) => {
    const isHidden = hiddenPhotoIndexes.includes(i);
    if (!isHidden && visibleCount <= 2) return; // blocked — need at least 2 visible
    setHiddenPhotoIndexes(isHidden ? hiddenPhotoIndexes.filter(x => x !== i) : [...hiddenPhotoIndexes, i]);
  };

  // AI description tone rewrite
  const inspRef = inspectionNotes ? `\nInspection notes: "${inspectionNotes}"` : '';
  const handleAiTone = async (tone) => {
    if (!settings.geminiApiKey) { alert('No Gemini API key configured. Go to Settings to add it.'); return; }
    if (!shopNote.trim()) { alert('Enter a description first before polishing.'); return; }
    setAiToneLoading(tone);
    const toneMap = {
      paragraph: 'Rewrite as a clear, honest, flowing 2-3 sentence paragraph. Be factual and appealing. Do not use bullet points or markdown.',
      bullets: 'Rewrite as 3-5 concise bullet points starting each with "•". Each point should cover a key fact about condition, features, or included accessories.',
      short: 'Rewrite as a single short, punchy statement (max 15 words) highlighting the most important selling point.',
    };
    const prompt = `You are writing a product listing description for a used ${tx.aiBrand || ''} ${tx.aiModel || ''} sold in a second-hand shop in Nigeria.
Current description: "${shopNote}"${inspRef}
Condition grade: "${conditionGrade}"
${toneMap[tone]}
Be honest and truthful. Do not invent specs. Respond with ONLY the rewritten text, nothing else.`;
    const result = await callGeminiAI(settings.geminiApiKey, settings.geminiModel, [], prompt);
    if (result?.text) setShopNote(result.text.trim());
    else alert(result?.error || 'AI generation failed. Check your Gemini API key in Settings.');
    setAiToneLoading(null);
  };

  // Validation
  const hasEnoughPhotos = photosList.length === 0 || visibleCount >= 2;
  const priceValid = salePrice > 0;
  const priceBelowMin = salePrice > 0 && salePrice < minPrice;
  const canSave = hasEnoughPhotos && priceValid && !saving && !aiToneLoading;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    const shopId = (!tx.shopId && isNewListing)
      ? 'SHP-' + 'ABCDEFGHJKLMNPQRSTUVWXYZ'[Math.floor(Math.random() * 23)] + String(Math.floor(Math.random() * 10000)).padStart(4, '0')
      : (tx.shopId || undefined);
    const updates = {
      ...tx,
      shopCondition: conditionGrade,
      shopListingNote: shopNote.trim(),
      salePrice,
      itemNewPrice: itemNewPrice > 0 ? itemNewPrice : undefined,
      itemPhotos: photosList,
      hiddenPhotoIndexes: hiddenPhotoIndexes.filter(i => i < photosList.length),
      priceDropEnabled,
      priceDropIntervalDays,
      ...(shopId ? { shopId } : {}),
    };
    if (isNewListing) {
      updates.status = 'for_sale';
      updates.listedForSaleDate = new Date().toISOString().slice(0, 10);
    }
    await onSave(updates);
    setSaving(false);
  };

  const S_LABEL = { fontWeight: 600, fontSize: '13px', color: '#1a3a2a', display: 'block', marginBottom: '6px' };
  const S_INPUT = { width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1.5px solid #d1d5db', fontSize: '14px', boxSizing: 'border-box', outline: 'none', background: '#fff', color: '#111', fontFamily: 'inherit' };
  const S_SECTION = { marginBottom: '20px' };
  const S_AI_BTN = (active) => ({ padding: '6px 12px', borderRadius: '8px', border: '1.5px solid #8b5cf6', background: active ? '#ede9fe' : '#fff', color: active ? '#6d28d9' : '#7c3aed', fontWeight: 600, fontSize: '12px', cursor: (!settings.geminiApiKey || !!aiToneLoading) ? 'not-allowed' : 'pointer', opacity: !settings.geminiApiKey ? 0.5 : 1 });

  return (
    <div>
      {/* ── Item summary ── */}
      <div style={{ background: '#f0fdf4', borderRadius: '10px', padding: '12px 14px', marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '12px', border: '1px solid #bbf7d0' }}>
        {photosList[0] && <img src={photosList[0]} alt="" style={{ width: '60px', height: '60px', borderRadius: '8px', objectFit: 'cover', flexShrink: 0 }} />}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: '15px', color: '#111' }}>{tx.aiBrand} {tx.aiModel}</div>
          <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '2px' }}>{tx.aiItemType || tx.captureItemType} · Ref: {tx.ref}</div>
          {tx.cashAdvance > 0 && <div style={{ fontSize: '12px', color: '#374151', fontWeight: 600, marginTop: '2px' }}>Cash advance: {fmtMoney(tx.cashAdvance)}</div>}
          {tx.type === 'advance' && tx.cashAdvance > 0 && (() => { const elapsed = daysBetween(tx.dateGiven); const amountDue = tx.cashAdvance + elapsed * dailyFee; return <div style={{ fontSize: '12px', color: '#dc2626', fontWeight: 600, marginTop: '2px' }}>Amount due: {fmtMoney(amountDue)}</div>; })()}
          {tx.imei && <div style={{ fontSize: '11px', color: '#6b7280', marginTop: '2px' }}>IMEI: {tx.imei}</div>}
          {tx.serialNumber && <div style={{ fontSize: '11px', color: '#6b7280', marginTop: '2px' }}>Serial: {tx.serialNumber}</div>}
        </div>
        {!isNewListing && (
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div style={{ fontSize: '11px', color: '#6b7280', fontWeight: 500 }}>Listed</div>
            <div style={{ fontSize: '13px', fontWeight: 700, color: '#1a5f2a' }}>{daysListed}d ago</div>
          </div>
        )}
      </div>

      {/* ── Listing progress (existing listings only) ── */}
      {!isNewListing && (
        <div style={{ ...S_SECTION, background: deadlineProgress >= 100 ? '#fef2f2' : deadlineProgress >= 70 ? '#fefce8' : '#f0fdf4', borderRadius: '10px', padding: '12px 14px', border: `1px solid ${deadlineProgress >= 100 ? '#fecaca' : deadlineProgress >= 70 ? '#fde68a' : '#bbf7d0'}` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
            <div>
              <div style={{ fontSize: '12px', fontWeight: 700, color: '#374151', marginBottom: '2px' }}>Listing Progress</div>
              {listedDate && <div style={{ fontSize: '11px', color: '#6b7280' }}>Listed: {fmtDate(listedDate)}</div>}
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '12px', fontWeight: 700, color: isPastTarget ? '#dc2626' : '#374151' }}>
                {daysUntilTarget === null
                  ? 'Target sale date unavailable'
                  : isPastTarget
                    ? `${Math.abs(daysUntilTarget)} day${Math.abs(daysUntilTarget) !== 1 ? 's' : ''} past target`
                    : `${daysUntilTarget} day${daysUntilTarget !== 1 ? 's' : ''} remaining`}
              </div>
              {targetSaleDate && <div style={{ fontSize: '11px', color: '#6b7280' }}>Target sale date: {fmtDate(targetSaleDate)}</div>}
            </div>
          </div>
          <div style={{ height: '6px', borderRadius: '999px', background: '#e5e7eb', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${deadlineProgress}%`, borderRadius: '999px', background: deadlineProgress >= 100 ? '#dc2626' : deadlineProgress >= 70 ? '#f59e0b' : '#10b981', transition: 'width 0.3s' }} />
          </div>
          {isPastTarget && targetSaleDate && <div style={{ fontSize: '12px', color: '#dc2626', fontWeight: 600, marginTop: '6px' }}>⚠ Past target sale date ({fmtDate(targetSaleDate)}) — consider lowering the price or reviewing the listing.</div>}
        </div>
      )}

      {/* ── Photos: visibility, rearrange, add ── */}
      <div style={S_SECTION}>
        <label style={S_LABEL}>
          Photos
          <span style={{ marginLeft: '8px', fontWeight: 400, fontSize: '12px', color: visibleCount < 2 ? '#dc2626' : '#6b7280' }}>
            ({visibleCount}/{photosList.length} shown in shop{visibleCount < 2 ? ' — need at least 2' : ''})
          </span>
        </label>
        <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '10px' }}>
          Tap photo to show/hide · Use ← → to reorder · ✕ to remove · Add button for new photos
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'flex-start' }}>
          {photosList.map((photo, i) => {
            const isHidden = hiddenPhotoIndexes.includes(i);
            const canHide = !isHidden && visibleCount > 2;
            return (
              <div key={i} style={{ textAlign: 'center', position: 'relative' }}>
                {/* Remove button */}
                <button onClick={() => handleRemovePhoto(i)} title="Remove photo" style={{ position: 'absolute', top: '-6px', left: '-6px', width: '18px', height: '18px', borderRadius: '50%', background: '#ef4444', border: '2px solid #fff', color: '#fff', fontSize: '9px', cursor: 'pointer', zIndex: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, padding: 0 }}>✕</button>
                {/* Photo tile — tap to toggle visibility */}
                <div
                  title={isHidden ? 'Click to show in shop' : canHide ? 'Click to hide from shop' : 'Cannot hide — need at least 2 visible'}
                  onClick={() => togglePhotoVisibility(i)}
                  style={{ position: 'relative', width: '72px', cursor: (isHidden || canHide) ? 'pointer' : 'default' }}
                >
                  <img src={photo} alt={`Photo ${i + 1}`} style={{ width: '72px', height: '72px', objectFit: 'cover', borderRadius: '8px', opacity: isHidden ? 0.25 : 1, border: `2.5px solid ${isHidden ? '#ef4444' : '#10b981'}`, display: 'block' }} />
                  <div style={{ position: 'absolute', bottom: '2px', right: '2px', width: '18px', height: '18px', borderRadius: '50%', background: isHidden ? '#ef4444' : '#10b981', color: '#fff', fontSize: '9px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>{isHidden ? '✕' : '✓'}</div>
                  {i === 0 && <div style={{ position: 'absolute', top: '2px', left: '2px', fontSize: '9px', background: 'rgba(0,0,0,0.6)', color: '#fff', borderRadius: '3px', padding: '1px 4px', fontWeight: 700 }}>COVER</div>}
                </div>
                {/* Reorder arrows */}
                <div style={{ display: 'flex', justifyContent: 'center', gap: '2px', marginTop: '4px' }}>
                  <button onClick={() => i > 0 && swapPhotos(i, i - 1)} disabled={i === 0} title="Move left" style={{ padding: '2px 5px', fontSize: '10px', borderRadius: '4px', border: '1px solid #d1d5db', background: '#fff', cursor: i === 0 ? 'not-allowed' : 'pointer', opacity: i === 0 ? 0.3 : 1 }}>←</button>
                  <button onClick={() => i < photosList.length - 1 && swapPhotos(i, i + 1)} disabled={i === photosList.length - 1} title="Move right" style={{ padding: '2px 5px', fontSize: '10px', borderRadius: '4px', border: '1px solid #d1d5db', background: '#fff', cursor: i === photosList.length - 1 ? 'not-allowed' : 'pointer', opacity: i === photosList.length - 1 ? 0.3 : 1 }}>→</button>
                </div>
                <div style={{ fontSize: '9px', color: isHidden ? '#ef4444' : '#10b981', fontWeight: 700, marginTop: '2px' }}>{isHidden ? 'Hidden' : 'Shown'}</div>
              </div>
            );
          })}
          {/* Add photo button */}
          <div style={{ textAlign: 'center' }}>
            <div onClick={() => addPhotoRef.current?.click()} style={{ width: '72px', height: '72px', borderRadius: '8px', border: '2px dashed #d1d5db', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', background: '#f9fafb', gap: '4px' }}>
              <span style={{ fontSize: '22px', lineHeight: 1 }}>+</span>
              <span style={{ fontSize: '9px', color: '#6b7280', fontWeight: 600 }}>Add Photo</span>
            </div>
            <input ref={addPhotoRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleAddPhoto} />
            <div style={{ fontSize: '9px', color: '#9ca3af', marginTop: '6px' }}>&nbsp;</div>
          </div>
        </div>
        {!hasEnoughPhotos && <div style={{ marginTop: '8px', fontSize: '12px', color: '#dc2626', fontWeight: 600 }}>Show at least 2 photos before saving.</div>}
      </div>

      {/* ── Inspection reference (collapsible) ── */}
      {hasInspectionData && (
        <div style={{ ...S_SECTION, borderRadius: '10px', border: '1px solid #e5e7eb', overflow: 'hidden' }}>
          <button onClick={() => setShowInspection(v => !v)} style={{ width: '100%', padding: '10px 14px', background: '#f9fafb', border: 'none', textAlign: 'left', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontWeight: 600, fontSize: '13px', color: '#374151' }}>
            <span>🔍 Inspection Notes (staff reference)</span>
            <span style={{ fontSize: '12px', color: '#6b7280' }}>{showInspection ? '▲ Hide' : '▼ Show'}</span>
          </button>
          {showInspection && (
            <div style={{ padding: '12px 14px', borderTop: '1px solid #e5e7eb', background: '#fff' }}>
              {inspectionNotes && (
                <div style={{ marginBottom: '8px' }}>
                  <div style={{ fontSize: '11px', fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' }}>Inspector Notes</div>
                  <div style={{ fontSize: '13px', color: '#374151', lineHeight: 1.6, background: '#f9fafb', borderRadius: '6px', padding: '8px 10px' }}>{inspectionNotes}</div>
                </div>
              )}
              {Object.keys(inspectionChecklist).length > 0 && (
                <div>
                  <div style={{ fontSize: '11px', fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' }}>Checklist Results</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                    {Object.entries(inspectionChecklist).map(([k, v]) => (
                      <span key={k} style={{ fontSize: '11px', padding: '3px 8px', borderRadius: '999px', background: v ? '#dcfce7' : '#fef2f2', color: v ? '#166534' : '#991b1b', border: `1px solid ${v ? '#86efac' : '#fecaca'}`, fontWeight: 600 }}>
                        {v ? '✓' : '✕'} {k}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              <div style={{ marginTop: '10px', fontSize: '11px', color: '#9ca3af', fontStyle: 'italic' }}>Internal reference only — not shown to buyers. Use the description below for public-facing text.</div>
            </div>
          )}
        </div>
      )}

      {/* ── Condition Grade (dropdown) ── */}
      <div style={S_SECTION}>
        <label style={S_LABEL}>Condition Grade <span style={{ fontWeight: 400, color: '#6b7280', fontSize: '12px' }}>(shown as a badge to buyers)</span></label>
        {initGrade && initGrade !== conditionGrade && <div style={{ fontSize: '11px', color: '#6b7280', marginBottom: '6px' }}>Auto-suggested from inspection: <strong>{initGrade}</strong></div>}
        <select value={conditionGrade} onChange={e => setConditionGrade(e.target.value)} style={{ ...S_INPUT }}>
          <option value="">— Select condition grade —</option>
          {CONDITION_GRADES.map(g => <option key={g} value={g}>{g}</option>)}
        </select>
        {!conditionGrade && <div style={{ fontSize: '12px', color: '#f59e0b', fontWeight: 600, marginTop: '4px' }}>Selecting a condition grade helps buyers make faster decisions.</div>}
      </div>

      {/* ── Description for buyers (seller note) with multi-tone AI ── */}
      <div style={S_SECTION}>
        <label style={S_LABEL}>Description for Buyers <span style={{ fontWeight: 400, color: '#6b7280', fontSize: '12px' }}>(main listing text shown to buyers)</span></label>
        <textarea
          value={shopNote}
          onChange={e => setShopNote(e.target.value)}
          placeholder="Describe the item honestly and clearly. What's included? What condition is it in? Any cosmetic marks? E.g. 'Screen in perfect condition, minor scratches on casing, battery healthy. Comes with original charger and box.'"
          style={{ ...S_INPUT, minHeight: '90px', resize: 'vertical', lineHeight: 1.7 }}
        />
        <div style={{ marginTop: '8px', display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: '12px', color: '#7c3aed', fontWeight: 600 }}>✨ AI Rewrite:</span>
          {[
            { key: 'paragraph', label: '📝 Paragraph' },
            { key: 'bullets', label: '📋 Bullet Points' },
            { key: 'short', label: '💬 Short & Punchy' },
          ].map(({ key, label }) => (
            <button key={key} disabled={!settings.geminiApiKey || !!aiToneLoading} onClick={() => handleAiTone(key)} style={S_AI_BTN(aiToneLoading === key)}>
              {aiToneLoading === key ? '⏳ Rewriting...' : label}
            </button>
          ))}
          {!settings.geminiApiKey && <span style={{ fontSize: '11px', color: '#9ca3af' }}>Gemini key required (Settings)</span>}
        </div>
      </div>

      {/* ── Sale Price ── */}
      <div style={S_SECTION}>
        <label style={S_LABEL}>Sale Price (₦)</label>
        <div style={{ display: 'flex', gap: '8px', marginBottom: '6px' }}>
          <input type="number" min="0" step="50" value={salePrice} onChange={e => setSalePrice(Number(e.target.value))} onBlur={e => setSalePrice(roundToNice(Number(e.target.value)))} style={{ ...S_INPUT, flex: 1, fontSize: '22px', fontWeight: 800, color: priceBelowMin ? '#dc2626' : '#1a5f2a' }} />
          <button onClick={() => setSalePrice(listedPrice)} style={{ padding: '8px 14px', borderRadius: '8px', border: '1.5px solid #d1d5db', background: '#f9fafb', fontWeight: 600, fontSize: '12px', cursor: 'pointer', whiteSpace: 'nowrap', color: '#374151' }}>Reset to Target</button>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>
          <span>Target: <strong style={{ color: '#1a5f2a' }}>{fmtMoney(listedPrice)}</strong></span>
          <span>
            Min floor: <strong style={{ color: '#92400e' }}>{fmtMoney(minPrice)}</strong>
            <span style={{ fontSize: '11px', color: COLORS.textMuted, marginLeft: '6px' }}>
              {isOutright
                ? `(cost + ${outrightMinMarkupPct}% markup)`
                : `(advance + ${maxHoldDays}d fees + bonus)`}
            </span>
          </span>
          {tx.estimatedValue > 0 && <span>Est. resale value: <strong>{fmtMoney(tx.estimatedValue)}</strong></span>}
        </div>
        {itemNewPrice > 0 && salePrice > 0 && itemNewPrice > salePrice && (
          <div style={{ fontSize: '12px', color: '#059669', fontWeight: 600, marginTop: '4px' }}>
            Buyer saves {fmtMoney(itemNewPrice - salePrice)} ({Math.round((itemNewPrice - salePrice) / itemNewPrice * 100)}% off new price) — shown on shop page
          </div>
        )}
        {!priceValid && <div style={{ fontSize: '12px', color: '#dc2626', fontWeight: 600, marginTop: '4px' }}>Sale price must be greater than zero.</div>}
        {priceBelowMin && <div style={{ fontSize: '12px', color: '#dc2626', fontWeight: 600, marginTop: '4px' }}>⚠ Below minimum floor ({fmtMoney(minPrice)}) — this may result in a loss.</div>}
        {salePrice > listedPrice && tx.estimatedValue > 0 && salePrice > tx.estimatedValue && <div style={{ fontSize: '12px', color: '#f59e0b', fontWeight: 600, marginTop: '4px' }}>Above estimated resale value — buyers may push back on price.</div>}
      </div>

      {/* ── Price Auto-Drop ── */}
      {/* ── New Item Price (for savings display) ── */}
      <div style={S_SECTION}>
        <label style={S_LABEL}>
          New Item Price (₦) <span style={{ fontWeight: 400, color: '#6b7280', fontSize: '12px' }}>— optional, for buyer savings display</span>
        </label>
        <input
          type="number" min="0" step="50"
          value={itemNewPrice || ''}
          onChange={e => setItemNewPrice(Number(e.target.value))}
          onBlur={e => setItemNewPrice(roundToNice(Number(e.target.value)))}
          placeholder="e.g. 150000 — what this item costs brand new in the market"
          style={{ ...S_INPUT }}
        />
        <div style={{ fontSize: '11px', color: '#6b7280', marginTop: '4px' }}>
          What this item costs brand new — <em>not</em> the estimated resale value. When set, buyers see "You save ₦X" on the shop page.
          {aiMarketPrice > 0 && tx.itemNewPrice !== aiMarketPrice && <span style={{ marginLeft: '6px', color: '#059669', fontWeight: 600 }}>Pre-filled from AI Run 3 valuation</span>}
          {tx.estimatedValue > 0 && <span style={{ marginLeft: '6px' }}>· Resale estimate: <strong>{fmtMoney(tx.estimatedValue)}</strong></span>}
        </div>
      </div>

      <div style={{ ...S_SECTION, background: '#fefce8', borderRadius: '10px', padding: '14px', border: '1px solid #fde68a' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginBottom: priceDropEnabled ? '12px' : '0' }}>
          <input type="checkbox" checked={priceDropEnabled} onChange={e => setPriceDropEnabled(e.target.checked)} style={{ width: '18px', height: '18px', cursor: 'pointer' }} />
          <span style={{ fontWeight: 700, fontSize: '14px', color: '#92400e' }}>Enable automatic price drop for this item</span>
        </label>
        {priceDropEnabled && (
          <div>
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '13px', color: '#92400e', fontWeight: 500 }}>Drop every</span>
              <input type="number" min="1" max="30" value={priceDropIntervalDays} onChange={e => setPriceDropIntervalDays(Math.max(1, Number(e.target.value)))} style={{ ...S_INPUT, width: '64px', textAlign: 'center', padding: '6px' }} />
              <span style={{ fontSize: '13px', color: '#92400e', fontWeight: 500 }}>days · target sell within {targetDeadline} days</span>
            </div>
            {dropPerInterval > 0 && (
              <div style={{ fontSize: '12px', color: '#92400e', marginBottom: '10px' }}>
                Drops by <strong>{fmtMoney(dropPerInterval)}</strong> every {dropInterval} day{dropInterval > 1 ? 's' : ''} · {maxDrops} step{maxDrops !== 1 ? 's' : ''} · floor: <strong>{fmtMoney(minPrice)}</strong>
              </div>
            )}
            {!isNewListing && daysListed > 0 && (
              <div style={{ background: '#fff', borderRadius: '8px', padding: '10px 12px', marginBottom: '10px', border: '1px solid #fde68a' }}>
                <div style={{ fontSize: '12px', color: '#92400e', marginBottom: suggestedPrice < salePrice ? '8px' : '0' }}>
                  Day <strong>{daysListed}</strong> listed — suggested price today: <strong style={{ fontSize: '15px' }}>{fmtMoney(suggestedPrice)}</strong>
                  {suggestedPrice === salePrice && <span style={{ color: '#10b981', marginLeft: '8px' }}>✓ Matches current price</span>}
                </div>
                {suggestedPrice < salePrice && (
                  <button onClick={() => setSalePrice(suggestedPrice)} style={{ padding: '6px 14px', borderRadius: '8px', border: '1.5px solid #f59e0b', background: '#fffbeb', color: '#92400e', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}>
                    Apply Suggested Price ({fmtMoney(suggestedPrice)})
                  </button>
                )}
              </div>
            )}
            {dropSchedule.length > 1 && (
              <div>
                <button onClick={() => setShowDropSchedule(v => !v)} style={{ fontSize: '12px', color: '#92400e', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600, padding: 0, marginBottom: showDropSchedule ? '8px' : '0' }}>
                  {showDropSchedule ? '▲ Hide' : '▼ Show'} full price drop schedule
                </button>
                {showDropSchedule && (
                  <div style={{ background: '#fff', borderRadius: '8px', overflow: 'hidden', border: '1px solid #fde68a', maxHeight: '200px', overflowY: 'auto' }}>
                    {dropSchedule.map((step, i) => (
                      <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 12px', background: step.isCurrent ? '#fef9c3' : i % 2 === 0 ? '#fff' : '#fafafa', borderBottom: i < dropSchedule.length - 1 ? '1px solid #fde68a' : 'none' }}>
                        <span style={{ fontSize: '12px', color: '#92400e', fontWeight: step.isCurrent ? 700 : 400 }}>Day {step.day}{step.isCurrent ? ' ← today' : ''}</span>
                        <span style={{ fontSize: '12px', color: step.price === minPrice ? '#dc2626' : '#92400e', fontWeight: step.isCurrent ? 700 : 500 }}>{fmtMoney(step.price)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Action buttons ── */}
      <div style={{ display: 'flex', gap: '10px', paddingTop: '4px' }}>
        <button onClick={handleSave} disabled={!canSave} style={{ flex: 1, padding: '14px', borderRadius: '10px', border: 'none', background: canSave ? '#1a5f2a' : '#d1d5db', color: '#fff', fontWeight: 700, fontSize: '15px', cursor: canSave ? 'pointer' : 'not-allowed', transition: 'background 0.2s' }}>
          {saving ? '⏳ Saving...' : isNewListing ? '🏪 List in Shop' : '💾 Save Changes'}
        </button>
        <button onClick={onClose} disabled={saving} style={{ padding: '14px 20px', borderRadius: '10px', border: '1.5px solid #d1d5db', background: '#fff', color: '#374151', fontWeight: 600, fontSize: '14px', cursor: saving ? 'not-allowed' : 'pointer' }}>Cancel</button>
      </div>
    </div>
  );
}

// ============================================================
// CUSTOMER PORTAL
// ============================================================
function CustomerPortal({ onBack, settings }) {
  const [refDate, setRefDate] = useState('');   // 6-digit DDMMYY part
  const [refNum, setRefNum] = useState('');     // 3-digit NNN part
  const [result, setResult] = useState(null); // null | 'not_found' | tx object
  const [searched, setSearched] = useState(false);
  const refNumInput = useRef(null);

  const s = settings || {};
  const phone1 = s.shopPhone1 ?? '08165491908';
  const whatsApp = s.shopWhatsApp ?? '2348165491908';
  const shopHours = s.shopHours ?? 'Monday – Saturday, 8am – 6pm';

  const fullRef = `CIF-${refDate}-${refNum}`;

  const handleCheck = async () => {
    if (!refDate.trim() || !refNum.trim()) return;
    // Basic date validation: DD must be 01-31, MM must be 01-12
    const dd = parseInt(refDate.slice(0, 2), 10);
    const mm = parseInt(refDate.slice(2, 4), 10);
    if (refDate.length === 6 && (dd < 1 || dd > 31 || mm < 1 || mm > 12)) {
      setResult('not_found');
      setSearched(true);
      return;
    }
    const data = await API.get(`check-loan?ref=${encodeURIComponent(fullRef)}`);
    const found = data?.found ? data : null;
    setResult(found || 'not_found');
    setSearched(true);
  };

  const handleDateInput = (e) => {
    const val = e.target.value.replace(/\D/g, '').slice(0, 6);
    setRefDate(val);
    setSearched(false);
    if (val.length === 6) {
      refNumInput.current?.focus();
    }
  };

  const handleNumInput = (e) => {
    const val = e.target.value.replace(/\D/g, '').slice(0, 3);
    setRefNum(val);
    setSearched(false);
  };

  const formatDateLong = (d) => {
    if (!d) return '';
    return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: NIGERIA_TZ });
  };

  const calcOwedToday = (tx) => {
    if (!tx || tx.type === 'outright') return tx?.cashAdvance || 0;
    const elapsed = daysBetween(tx.dateGiven);
    return (tx.cashAdvance || 0) + elapsed * (tx.dailyFee || 0);
  };

  const getDaysInfo = (tx) => {
    if (!tx || tx.type === 'outright') return null;
    const maxLoanDays  = Math.max(1, Number(s.maxLoanDays) || 30);
    const graceDays    = Math.max(0, Number(s.graceDays)   || 3);
    const elapsed = daysBetween(tx.dateGiven);
    const agreedDueDay = Math.max(0, Number(tx.loanDays) || maxLoanDays);
    const saleEligibleDay = maxLoanDays + graceDays + 1;
    const today = new Date(localISODate()); // Nigeria calendar date, parsed as UTC midnight
    const agreedDueDate = tx.deadlineDate ? new Date(tx.deadlineDate) : null;
    const saleEligibleDate = tx.dateGiven ? new Date(tx.dateGiven) : null;
    if (saleEligibleDate) {
      saleEligibleDate.setUTCDate(saleEligibleDate.getUTCDate() + saleEligibleDay);
    }

    // Key business milestone dates
    const maxLoanDayDate = tx.dateGiven ? new Date(tx.dateGiven) : null;
    if (maxLoanDayDate) {
      maxLoanDayDate.setUTCDate(maxLoanDayDate.getUTCDate() + maxLoanDays);
    }
    const graceEndDate = tx.dateGiven ? new Date(tx.dateGiven) : null;
    if (graceEndDate) {
      graceEndDate.setUTCDate(graceEndDate.getUTCDate() + maxLoanDays + graceDays);
    }

    const daysUntilAgreedDue = agreedDueDate ? Math.ceil((agreedDueDate - today) / 86400000) : null;
    const daysUntilSaleEligible = saleEligibleDate ? Math.ceil((saleEligibleDate - today) / 86400000) : null;
    const daysOverdue = daysUntilAgreedDue !== null && daysUntilAgreedDue < 0 ? Math.abs(daysUntilAgreedDue) : 0;

    return {
      elapsed,
      agreedDueDay,
      saleEligibleDay,
      agreedDueDate,
      saleEligibleDate,
      maxLoanDayDate,
      graceEndDate,
      daysUntilAgreedDue,
      daysUntilSaleEligible,
      daysOverdue,
      isBeforeAgreedDue: daysUntilAgreedDue !== null ? daysUntilAgreedDue > 0 : elapsed < agreedDueDay,
      isAfterAgreedDue: daysUntilAgreedDue !== null ? daysUntilAgreedDue < 0 : elapsed > agreedDueDay,
      isOnAgreedDueDate: daysUntilAgreedDue === 0,
      isOnMaxLoanDay: elapsed === maxLoanDays,
      isInGracePeriod: elapsed > maxLoanDays && elapsed < maxLoanDays + graceDays,
      isLastDayOfGrace: graceDays > 0 && elapsed === maxLoanDays + graceDays,
      isGraceWindow: elapsed >= maxLoanDays + 1 && elapsed <= maxLoanDays + graceDays,
      isSaleEligible: elapsed >= saleEligibleDay,
    };
  };

  const getStatusBadge = (tx) => {
    if (tx.status === 'closed') return { label: '✅ Closed — Returned', color: '#10b981' };
    if (tx.status === 'sold') return { label: '✅ Sold', color: '#6b7280' };
    if (tx.status === 'for_sale') return { label: '🏷️ For Sale', color: '#374151' };
    if (tx.type === 'outright') return { label: 'Outright Purchase', color: '#8b5cf6' };
    const info = getDaysInfo(tx);
    if (!info) return { label: 'Active', color: '#10b981' };
    if (info.isSaleEligible) return { label: '📦 Ready to Sell', color: '#92400e' };
    if (info.isLastDayOfGrace) return { label: '🔴 Last Day of Grace', color: '#dc2626' };
    if (info.isInGracePeriod) return { label: `💜 Grace Period Ends ${info.graceEndDate ? formatDateLong(info.graceEndDate) : ''}`, color: '#8b5cf6' };
    if (info.isOnMaxLoanDay) return { label: '🔴 Last Day of Ownership', color: '#dc2626' };
    if (info.isAfterAgreedDue) return { label: `⚠️ ${info.daysOverdue} Day${info.daysOverdue !== 1 ? 's' : ''} Overdue`, color: '#f59e0b' };
    if (info.isOnAgreedDueDate) return { label: '🔴 Due Today', color: '#ef4444' };
    return { label: 'Active', color: '#10b981' };
  };

  return (
    <div style={{ fontFamily: "'DM Sans', 'Nunito', sans-serif", background: '#0f172a', minHeight: '100vh', color: '#fff', fontSize: '16px', lineHeight: 1.6 }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet" />

      {/* Header */}
      <div style={{ background: '#1a5f2a', padding: '24px 20px 20px' }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.8)', fontSize: '15px', cursor: 'pointer', padding: '0 0 12px', fontWeight: 500 }}>← Back to Home</button>
        <h1 style={{ fontSize: 'clamp(20px, 5vw, 28px)', fontWeight: 800, margin: '0 0 6px' }}>Check Your Loan Status</h1>
        <p style={{ margin: 0, opacity: 0.85, fontSize: '15px' }}>Type the number from your agreement form — just the digits, no need to type "CIF".</p>
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
            <label style={{ display: 'block', fontWeight: 600, color: '#9ca3af', fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px' }}>Reference Number</label>
            {/* Segmented reference input: CIF-[DDMMYY]-[NNN] */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '12px' }}>
              <span style={{ fontWeight: 800, fontSize: '18px', color: '#4ade80', letterSpacing: '1px', flexShrink: 0 }}>CIF</span>
              <span style={{ fontWeight: 700, fontSize: '20px', color: '#6b7280' }}>–</span>
              <input
                inputMode="numeric"
                maxLength={6}
                style={{ flex: '3', padding: '13px 10px', borderRadius: '8px', border: '1.5px solid #2a3447', fontSize: '20px', background: '#111827', color: '#fff', textAlign: 'center', letterSpacing: '2px', minWidth: 0, fontWeight: 700 }}
                placeholder="DDMMYY"
                value={refDate}
                onChange={handleDateInput}
                onKeyDown={e => { if (e.key === 'Enter') { refDate.length === 6 ? refNumInput.current?.focus() : handleCheck(); } }}
              />
              <span style={{ fontWeight: 700, fontSize: '20px', color: '#6b7280' }}>–</span>
              <input
                ref={refNumInput}
                inputMode="numeric"
                maxLength={3}
                style={{ flex: '2', padding: '13px 10px', borderRadius: '8px', border: '1.5px solid #2a3447', fontSize: '20px', background: '#111827', color: '#fff', textAlign: 'center', letterSpacing: '2px', minWidth: 0, fontWeight: 700 }}
                placeholder="NNN"
                value={refNum}
                onChange={handleNumInput}
                onKeyDown={e => e.key === 'Enter' && handleCheck()}
              />
            </div>
            <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '14px', textAlign: 'center' }}>
              Example: for reference <strong style={{ color: '#9ca3af' }}>CIF-130326-001</strong>, type <strong style={{ color: '#9ca3af' }}>130326</strong> and <strong style={{ color: '#9ca3af' }}>001</strong>
            </div>
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
          const agreedDueDateLabel = formatDateLong(tx.deadlineDate);
          const isOverdue = !!daysInfo && daysInfo.isAfterAgreedDue;
          // Pre-compute key milestone date labels (using current settings, used for all scenarios)
          const maxLoanDaysNum = Math.max(1, Number(s.maxLoanDays) || 30);
          const graceDaysNum = Math.max(0, Number(s.graceDays) || 3);
          const maxLoanDayLabel = formatDateLong(addDays(tx.dateGiven, maxLoanDaysNum));
          const graceEndLabel = formatDateLong(addDays(tx.dateGiven, maxLoanDaysNum + graceDaysNum));
          // Show repayment amount block for active advance loans that haven't reached sale eligibility
          const showRepaymentInfo = tx.status === 'active' && tx.type !== 'outright' && (!daysInfo || !daysInfo.isSaleEligible);
          // Show contact block for all scenarios where customer can still repay
          const showContactBlock = showRepaymentInfo;

          const getStatusMessage = () => {
            const todayLabel = formatDateLong(localISODate());
            // Scenario 9: Closed — Returned
            if (tx.status === 'closed') return {
              bg: '#0f2920', border: '#10b981', textColor: '#a7f3d0',
              msg: (
                <>
                  ✅ <strong>Transaction Closed</strong><br /><br />
                  You successfully repaid your loan on <strong>{formatDateLong(tx.dateRepaid) || 'the agreed date'}</strong> and collected your item.<br /><br />
                  <strong>Summary:</strong><br />
                  &bull; Cash advance: <strong>{fmtMoney(tx.cashAdvance)}</strong><br />
                  &bull; Daily fee ({tx.daysCharged ?? 0} day{(tx.daysCharged ?? 0) !== 1 ? 's' : ''} × {fmtMoney(tx.dailyFee ?? 0)}): <strong>{fmtMoney(tx.totalFees ?? 0)}</strong><br />
                  &bull; Total repaid: <strong>{fmtMoney(tx.amountRepaid)}</strong><br /><br />
                  Thank you for your business! We&apos;re here whenever you need cash again.<br />
                  <span style={{ opacity: 0.65, fontSize: '12px' }}>Agreement Ref: {tx.ref}</span>
                </>
              ),
            };

            // Scenario 8: Sold (purchased by public)
            if (tx.status === 'sold') return {
              bg: '#111827', border: '#374151', textColor: '#9ca3af',
              msg: (
                <>
                  ✅ <strong>Item Sold</strong><br /><br />
                  Your item was sold to us on <strong>{maxLoanDayLabel}</strong> as per our signed agreement.<br />
                  {tx.saleDate
                    ? <>We subsequently sold it to the public on <strong>{formatDateLong(tx.saleDate)}</strong>{tx.salePrice ? <> for <strong>{fmtMoney(tx.salePrice)}</strong></> : null}.</>
                    : <>The item has since been sold to the public.</>
                  }<br /><br />
                  Your original loan of <strong>{fmtMoney(tx.cashAdvance)}</strong> has been fully offset. No further action is needed.<br /><br />
                  <hr style={{ border: 'none', borderTop: '1px solid #374151', margin: '8px 0' }} />
                  <span style={{ opacity: 0.65, fontSize: '12px' }}>Original agreement: Ref {tx.ref}</span>
                </>
              ),
            };

            // Scenario 7: For Sale (explicitly listed by admin or grace period expired)
            if (tx.status === 'for_sale' || (daysInfo && daysInfo.isSaleEligible)) return {
              bg: '#1a1a1a', border: '#374151', textColor: '#9ca3af',
              msg: (
                <>
                  🏷️ <strong>Item Now for Sale</strong><br /><br />
                  Your item was sold to us on <strong>{maxLoanDayLabel}</strong> as per our signed agreement.<br />
                  We are currently offering it for sale to the public.{tx.salePrice ? <> The sale price is <strong>{fmtMoney(tx.salePrice)}</strong>.</> : null}<br /><br />
                  You <strong>no longer have ownership rights</strong> to this item. It cannot be reclaimed by you under any circumstances.<br /><br />
                  <hr style={{ border: 'none', borderTop: '1px solid #374151', margin: '8px 0' }} />
                  <span style={{ opacity: 0.65, fontSize: '12px' }}>If you have questions or disputes about this, please contact us in writing with your original agreement.</span>
                </>
              ),
            };

            if (tx.type === 'outright' || !daysInfo) return null;

            // Scenario 6: Last Day of Grace Period
            if (daysInfo.isLastDayOfGrace) return {
              bg: '#2d0000', border: '#dc2626', textColor: '#fca5a5',
              msg: (
                <>
                  🔴 <strong>FINAL CHANCE — Grace period expires TODAY.</strong><br /><br />
                  Your item was sold to us on <strong>{maxLoanDayLabel}</strong> as per our signed agreement.<br />
                  Today (<strong>{todayLabel}</strong>) is your <strong>final day</strong> to pay the full amount and collect your item.<br /><br />
                  After today, we will list it for sale to others and you will have <strong>no further right</strong> to reclaim it.<br /><br />
                  <strong>Amount due today: {fmtMoney(owed)}</strong><br /><br />
                  📞 <strong>Contact us urgently: {phone1}</strong>
                </>
              ),
            };

            // Scenario 5: Grace Period (after max loan days, before last grace day)
            if (daysInfo.isInGracePeriod) return {
              bg: '#1a0a3d', border: '#8b5cf6', textColor: '#c4b5fd',
              msg: (
                <>
                  💜 <strong>Grace Period Extended</strong><br /><br />
                  Your item was sold to us on <strong>{maxLoanDayLabel}</strong> as per our signed agreement.<br />
                  We are giving you a <strong>grace period until {graceEndLabel}</strong> to pay and collect your item. During this time, we have not listed it for sale yet.<br /><br />
                  <strong>Important:</strong> After {graceEndLabel}, the item will be listed for sale to the public and you will lose all rights to it.<br /><br />
                  <strong>Amount due today: {fmtMoney(owed)}</strong> (includes daily fees)<br /><br />
                  📞 Contact us to arrange payment: <strong>{phone1}</strong>
                </>
              ),
            };

            // Scenario 4: Last Day of Ownership (ownership transfers today)
            if (daysInfo.isOnMaxLoanDay) return {
              bg: '#2d0000', border: '#dc2626', textColor: '#fca5a5',
              msg: (
                <>
                  🔴 <strong>FINAL DAY — Item ownership transfers today.</strong><br /><br />
                  Today is <strong>{todayLabel}</strong> — your final day to pay and collect your item.<br /><br />
                  <strong>This is your last chance.</strong> If you do not collect your item today, it automatically becomes our property and we will sell it to others. You will lose all ownership rights.<br /><br />
                  <strong>Amount due today: {fmtMoney(owed)}</strong><br /><br />
                  🏪 <strong>Our shop hours:</strong> {shopHours}<br />
                  📞 <strong>Contact us immediately: {phone1}</strong>
                </>
              ),
            };

            // Scenario 3: Overdue (after agreed return date, before max loan days)
            if (daysInfo.isAfterAgreedDue) return {
              bg: '#3d2600', border: '#f59e0b', textColor: '#fcd34d',
              msg: (
                <>
                  ⚠️ <strong>Your loan is overdue.</strong><br /><br />
                  Your agreed return date was <strong>{agreedDueDateLabel}</strong>.<br />
                  You still have until <strong>{maxLoanDayLabel}</strong> to pay and collect your item. After that date, the item will no longer be yours to reclaim — it will become our property and we will sell it to others.<br /><br />
                  <strong>Amount due today: {fmtMoney(owed)}</strong> (includes daily fees)<br /><br />
                  📞 Please contact us urgently: <strong>{phone1}</strong>
                </>
              ),
            };

            // Scenario 2: Due Today
            if (daysInfo.isOnAgreedDueDate) return {
              bg: '#3d0000', border: '#ef4444', textColor: '#fca5a5',
              msg: (
                <>
                  🔴 <strong>Your item is due today.</strong><br /><br />
                  Your agreed return date is <strong>TODAY ({agreedDueDateLabel})</strong>. Please visit our shop or call us immediately to pay and collect your item.<br /><br />
                  ⚠️ <strong>Important:</strong> You can still repay and collect your item up to <strong>{maxLoanDayLabel}</strong>. After that date, the item will move into our ownership according to the agreement.<br /><br />
                  📞 Call us now: <strong>{phone1}</strong>
                </>
              ),
            };

            // Scenario 1: Active Loan
            if (daysInfo.isBeforeAgreedDue || daysInfo.daysUntilAgreedDue !== null) return {
              bg: '#0f2920', border: '#10b981', textColor: '#a7f3d0',
              msg: (
                <>
                  ✅ Your loan is active.<br /><br />
                  Your agreed return date is <strong>{agreedDueDateLabel}</strong>. Please ensure you repay on time to collect your item.<br /><br />
                  ⚠️ <strong>Important:</strong> As per our signed agreement, if you do not pay and collect your item by <strong>{maxLoanDayLabel}</strong>, the item will be considered sold to us and we will sell it to others. There will be no option to reclaim it after that date.
                </>
              ),
            };

            return null;
          };

          const statusMsg = getStatusMessage();

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
                    <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '2px' }}>Your agreed return date</div>
                    <div style={{ fontWeight: 700, fontSize: '15px', color: isOverdue ? '#f59e0b' : '#fff' }}>{agreedDueDateLabel}</div>
                  </div>
                </div>

                {statusMsg && (
                  <div style={{ background: statusMsg.bg, border: `1px solid ${statusMsg.border}`, borderRadius: '8px', padding: '12px 14px', marginBottom: '14px', fontSize: '14px', color: statusMsg.textColor, lineHeight: 1.5 }}>
                    {statusMsg.msg}
                  </div>
                )}

                {showRepaymentInfo && (
                  <div style={{ background: '#111827', borderRadius: '8px', padding: '14px', textAlign: 'center' }}>
                    <div style={{ fontSize: '13px', color: '#9ca3af', marginBottom: '4px' }}>Total owed today</div>
                    <div style={{ fontSize: '26px', fontWeight: 800, color: isOverdue ? '#ef4444' : '#4ade80' }}>{fmtMoney(owed)}</div>
                    <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '2px' }}>Calculated live based on today's date</div>
                  </div>
                )}
              </div>

              {showContactBlock && (
                <div style={{ background: '#1e2433', borderRadius: '10px', padding: '14px', marginBottom: '16px', fontSize: '14px', color: '#d1d5db', border: '1px solid #2a3447' }}>
                  To pay back and collect your item, visit our shop or call <strong style={{ color: '#fff' }}>{phone1}</strong>
                </div>
              )}

              <WhatsAppButton whatsAppNumber={whatsApp} style={{ marginBottom: '14px' }} />

              <button
                onClick={() => { setResult(null); setSearched(false); setRefDate(''); setRefNum(''); }}
                style={{ background: 'none', border: 'none', color: '#9ca3af', fontSize: '15px', cursor: 'pointer', padding: '8px 0', textDecoration: 'underline', display: 'block', textAlign: 'center', width: '100%' }}
              >
                ← Check another reference number
              </button>
            </div>
          );
        })()}
      </div>
      {/* Footer */}
      <div style={{ background: '#0a0f1a', padding: '16px 20px', textAlign: 'center', fontSize: '12px', color: '#4b5563', lineHeight: 1.6 }}>
        <div style={{ marginBottom: '6px', color: '#6b7280' }}>© 2026 Christ-in-Fabian Quick Cash. All rights reserved.</div>
        <PartnershipFootnote dark />
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
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const WARMUP_TIMEOUT_MS = 1800;
  const ENABLE_LOGIN_TELEMETRY = true;

  const warmupHealthCheck = async ({ timeoutMs = WARMUP_TIMEOUT_MS, source = 'unknown' } = {}) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    const start = performance.now();

    if (ENABLE_LOGIN_TELEMETRY) {
      console.time(`[login] warmup (${source})`);
    }

    try {
      const response = await fetch('/api/health', {
        method: 'GET',
        cache: 'no-store',
        credentials: 'same-origin',
        signal: controller.signal,
      });

      return response.ok;
    } catch (e) {
      if (ENABLE_LOGIN_TELEMETRY) {
        console.debug(`[login] warmup failed (${source}):`, e?.name || e);
      }
      return false;
    } finally {
      clearTimeout(timeoutId);
      if (ENABLE_LOGIN_TELEMETRY) {
        console.timeEnd(`[login] warmup (${source})`);
        console.debug(`[login] warmup (${source}) duration=${Math.round(performance.now() - start)}ms`);
      }
    }
  };

  // Warm up database while user enters credentials.
  useEffect(() => {
    warmupHealthCheck({ source: 'screen-load' });
  }, []);

  const handleLogin = async () => {
    if (loading) return;
    setLoading(true);
    setError('');

    const loginStart = performance.now();
    if (ENABLE_LOGIN_TELEMETRY) {
      console.time('[login] total');
      console.time('[login] request');
    }

    // Opportunistic warmup: this should never block indefinitely.
    await warmupHealthCheck({ source: 'pre-login' });

    const result = await API.post('login', { username, password, rememberMe });
    if (ENABLE_LOGIN_TELEMETRY) {
      console.timeEnd('[login] request');
      console.timeEnd('[login] total');
      console.debug(`[login] total duration=${Math.round(performance.now() - loginStart)}ms`);
    }

    if (result?.error) { setError(result.error); setLoading(false); return; }
    if (result?.user?.id) { onLogin(result.user); }
    else { setError('Invalid username or password'); }
    setLoading(false);
  };

  return (
    <div style={S.loginWrap}>
      <div style={S.loginCard}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '8px' }}>
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="48" height="48">
            <path d="M38 35 L25 15 Q50 22 75 15 L62 35 Z" fill="#d2b48c" stroke="#8b7355" strokeWidth="2" strokeLinejoin="round"/>
            <path d="M40 35 L60 35 C75 35 85 60 80 80 C75 95 25 95 20 80 C15 60 25 35 40 35 Z" fill="#deb887" stroke="#8b7355" strokeWidth="2" strokeLinejoin="round"/>
            <path d="M35 35 Q50 38 65 35" fill="none" stroke="#5c4033" strokeWidth="3" strokeLinecap="round"/>
            <text x="50" y="72" fontFamily="Arial, sans-serif" fontSize="34" fontWeight="bold" fill="#2c1e16" textAnchor="middle">₦</text>
          </svg>
        </div>
        <div style={S.loginTitle}>CHRIST-IN-FABIAN</div>
        <div style={{ fontSize: '14px', fontWeight: 700, textAlign: 'center', color: COLORS.accent, marginBottom: '4px', letterSpacing: '2px' }}>QUICK CASH</div>
        <div style={S.loginSub}>Staff & Stakeholder Portal</div>
        {error && <div style={S.alert('danger')}>{error}</div>}
        <Field label="Username" required><input style={S.input} value={username} onChange={e => { setUsername(e.target.value); setError(''); }} placeholder="Enter username" /></Field>
        <Field label="Password" required><div style={{ display: 'flex', gap: '8px' }}><input style={S.input} type={showPassword ? 'text' : 'password'} value={password} onChange={e => { setPassword(e.target.value); setError(''); }} placeholder="Enter password" onKeyDown={e => e.key === 'Enter' && handleLogin()} /><button type="button" style={S.btnSm('outline')} onClick={() => setShowPassword(v => !v)}>{showPassword ? '🙈 Hide' : '👁 Show'}</button></div></Field>
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
// SCREENING STEP COMPONENT
// ============================================================
const DURATION_OPTIONS = ['Less than 6 months', '6–12 months', '1–2 years', '2–5 years', '5+ years', 'Other'];
const PURCHASE_LOCATION_OPTIONS = ['Phone shop / electronics store', 'Online (Jumia / Jiji / Konga)', 'Open market', 'Gift / received as present', 'Employer / workplace', 'Other'];
const OTHERS_USING_OPTIONS = ['No — only me', 'Yes — family member(s)', 'Yes — multiple people / shared', 'Yes — business / work use', 'Other'];

// Standard decline reasons — used in both the manual log form and the wizard auto-populate modal
const DECLINE_REASONS = [
  'NIN photo did not match',
  'Item appeared modified',
  'Customer gave inconsistent answers',
  'Item does not power on',
  'Item appears stolen / suspicious origin',
  'Customer could not provide valid ID',
  'Item in poor or heavily damaged condition',
  'Item not acceptable as collateral',
  'Customer refused photos or terms',
  'Flagged by staff during screening',
  'Other',
];

function ScreeningStep({ tx, upd, onRedFlagExit, onDecline }) {
  const showDurationOther = tx.screeningDuration === 'Other';
  const showLocationOther = tx.screeningPurchaseLocation === 'Other';

  return (
    <div>
      <h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '16px' }}>❓ Screening Questions</h3>
      <div style={S.alert('info')}>📋 Ask these questions calmly and select the closest answer from the dropdown. If anything feels wrong, tick the Red Flag box.</div>

      <Field label={<span style={{ display: 'inline-flex', alignItems: 'center' }}>How long have you had this item?<InfoIcon tip="If they've had it less than 6 months, be extra careful. A short ownership time together with other strange answers can be a sign the item was stolen." /></span>} required>
        <select style={S.select} value={tx.screeningDuration} onChange={e => { upd('screeningDuration', e.target.value); if (e.target.value !== 'Other') upd('screeningDurationOther', ''); }}>
          <option value="">— Select —</option>
          {DURATION_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
        {showDurationOther && (
          <input style={{ ...S.input, marginTop: '8px' }} value={tx.screeningDurationOther} onChange={e => upd('screeningDurationOther', e.target.value)} placeholder="Please specify…" />
        )}
      </Field>

      <Field label={<span style={{ display: 'inline-flex', alignItems: 'center' }}>Where did you buy it?<InfoIcon tip="Market or online purchases are harder to trace. If the customer seems unsure or keeps changing their answer, that's a warning sign." /></span>} required>
        <select style={S.select} value={tx.screeningPurchaseLocation} onChange={e => { upd('screeningPurchaseLocation', e.target.value); if (e.target.value !== 'Other') upd('screeningPurchaseLocationOther', ''); }}>
          <option value="">— Select —</option>
          {PURCHASE_LOCATION_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
        <input
          style={{ ...S.input, marginTop: '8px' }}
          value={tx.screeningPurchaseLocationOther}
          onChange={e => upd('screeningPurchaseLocationOther', e.target.value)}
          placeholder={showLocationOther ? 'Required — please specify…' : 'Additional detail (optional)'}
        />
        {showLocationOther && !tx.screeningPurchaseLocationOther && (
          <div style={{ fontSize: '12px', color: COLORS.danger, marginTop: '4px' }}>⛔ Please specify the purchase location.</div>
        )}
      </Field>

      <Field label={<span style={{ display: 'inline-flex', alignItems: 'center' }}>Is this item registered in your name?<InfoIcon tip="For phones, the SIM and IMEI should match who they say they are. Pick 'N/A' for things like fans or speakers that don't need to be registered to anyone." /></span>} required>
        <select style={S.select} value={tx.screeningRegistered} onChange={e => upd('screeningRegistered', e.target.value)}>
          <option value="">— Select —</option>
          <option value="Yes">Yes</option>
          <option value="No">No</option>
          <option value="N/A">N/A</option>
        </select>
      </Field>

      <Field label={<span style={{ display: 'inline-flex', alignItems: 'center' }}>Has anyone (or is anyone) else used/using this item with you?<InfoIcon tip="If someone else also uses the item (like a boss or partner), make sure this customer actually has permission to hand it over as a pledge." /></span>} required>
        <select style={S.select} value={tx.screeningOthersUsing} onChange={e => upd('screeningOthersUsing', e.target.value)}>
          <option value="">— Select —</option>
          {OTHERS_USING_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      </Field>

      <div style={{ marginTop: '16px', padding: '16px', background: COLORS.dangerLight, borderRadius: '8px', border: '1px solid #f5c6cb' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
          <input type="checkbox" checked={tx.screeningRedFlag} onChange={e => upd('screeningRedFlag', e.target.checked)} style={{ width: '20px', height: '20px' }} />
          <span style={{ fontSize: '14px', fontWeight: 700, color: COLORS.danger }}>🚩 RED FLAG — Something feels wrong (Decline Customer)</span>
          <InfoIcon tip="Tick this if something just feels off — like they're nervous, their story keeps changing, or the item looks suspicious. The system will quietly turn down the transaction without telling the customer why." />
        </label>
        {tx.screeningRedFlag && (
          <div style={{ marginTop: '14px' }}>
            <div style={{ fontSize: '13px', color: COLORS.danger, marginBottom: '10px' }}>⚠ Red flag is set. Click <strong>Save &amp; Exit</strong> to decline this transaction quietly.</div>
            <button
              style={{ ...S.btn('danger'), width: '100%', justifyContent: 'center' }}
              onClick={onRedFlagExit}
            >
              🚩 Save &amp; Exit (Decline)
            </button>
          </div>
        )}
      </div>

      <div style={{ marginTop: '16px', paddingTop: '12px', borderTop: `1px solid ${COLORS.border}` }}>
        <div style={{ fontSize: '12px', fontWeight: 600, color: COLORS.textMuted, marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>End transaction</div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button style={S.btnSm('muted')} onClick={() => onDecline('Customer gave inconsistent answers')}>Inconsistent answers</button>
          <button style={S.btnSm('muted')} onClick={() => onDecline('Item appears stolen / suspicious origin')}>Suspicious origin</button>
          <button style={S.btnSm('muted')} onClick={() => onDecline('Flagged by staff during screening')}>Flagged by staff</button>
        </div>
      </div>

      <Field label="Notes / Observations" style={{ marginTop: '16px' }}>
        <textarea style={S.textarea} value={tx.notes} onChange={e => upd('notes', e.target.value)} placeholder="Any additional notes about this customer or transaction..." />
      </Field>
    </div>
  );
}


// ============================================================
// CAPTURE STEP — Item type options, photo slot definitions
// ============================================================
const CAPTURE_ITEM_TYPES = [
  'Smartphone', 'Laptop', 'Tablet', 'Bluetooth Speaker', 'Power Bank',
  'Electric Fan (Standing)', 'Electric Fan (Table/Desk)', 'Flat-Screen TV',
  'Generator', 'Gas Cylinder', 'Motorcycle', 'Other',
];

// Item types that require IMEI verification (not just serial number)
const IMEI_ITEM_TYPES = ['Smartphone', 'Tablet'];

// Item types that physically cannot "power on" — skip the power-on gatekeeper
const NON_POWERED_ITEM_TYPES = ['Gas Cylinder'];

const ITEM_PHOTO_SLOTS = {
  'Smartphone': [
    'About Phone/Settings',
    'Front (Screen ON)',
    'Back Panel',
    'Left Edge',
    'Right Edge',
    'Bottom Edge',
    'Locks/Security',
  ],
  'Laptop': [
    'Specs/Model Label',
    'Keyboard & Trackpad',
    'Closed Lid',
    'Bottom Panel',
    'Left/Right Ports',
    'Power Charger',
    'Battery Health',
  ],
  'Tablet': [
    'About Tablet/Settings',
    'Front (Screen ON)',
    'Back Panel',
    'Left Edge',
    'Right Edge',
    'Bottom Edge',
  ],
  'Motorcycle': [
    'Full Right Side',
    'Full Left Side',
    'Dashboard/Odometer',
    'Engine Area',
    'Tires & Wheels',
    'Seat & Tail',
  ],
  'Generator': [
    'Nameplate/Model Label',
    'Full Unit Front',
    'Fuel Tank',
    'Engine Side',
    'Output Sockets',
    'Back/Exhaust',
  ],
  'Gas Cylinder': [
    'Full Cylinder Front',
    'Valve Head',
    'Base Ring',
    'Collar/Handle',
    'Date/Weight Stamp',
    'Full Cylinder Back',
  ],
  'Flat-Screen TV': [
    'Model Label/Back Sticker',
    'Screen ON',
    'Back Panel',
    'HDMI/AV Ports',
    'Remote Control',
    'Side Profile',
  ],
};
const DEFAULT_PHOTO_SLOTS = ['Brand/Model Label', 'Front', 'Back', 'Left/Right Side', 'Top/Bottom', 'Working (Power ON)'];
// Bluetooth Speaker, Power Bank, Electric Fan (Standing/Desk) are not listed above;
// they intentionally use DEFAULT_PHOTO_SLOTS (6-slot generic layout).
const getPhotoSlots = (itemType) => ITEM_PHOTO_SLOTS[itemType] || DEFAULT_PHOTO_SLOTS;

// Maximum cash offer for a Parts-Only (non-functional) item (default; overridden by settings.maxPartsOnlyAdvance)
const MAX_PARTS_ONLY_ADVANCE = 5000;

// Inspection checklists per item type (Step 7)
const INSPECTION_CHECKLISTS = {
  'Smartphone': [
    'Screen powers on normally',
    'Screen has no cracks or dead pixels',
    'Touchscreen responds everywhere (tap all corners)',
    'Can make and receive phone calls',
    'Front camera takes clear photos',
    'Back camera takes clear photos',
    'Earpiece speaker works (hold to ear during a call)',
    'Loudspeaker works (play audio on loud mode)',
    'Microphone works (customer speaks — other side hears clearly)',
    'Charging port is firm, not loose or wobbly',
    'Phone charges when plugged in (test with our cable)',
    'WiFi connects to a network',
    'All physical buttons work (power, volume up, volume down)',
    'No iCloud lock, Google account lock, or PIN we cannot remove',
    'SIM tray is present and not damaged',
    'Face ID or fingerprint sensor works (if present)',
  ],
  'Laptop': [
    'Powers on and reaches the desktop/login screen',
    'Screen has no cracks, dead pixels, or dark patches',
    'All keyboard keys work (type a sentence to test)',
    'Trackpad responds correctly',
    'WiFi connects to a network',
    'USB ports work (plug in a flash drive)',
    'Charging port works, laptop charges when plugged in',
    'Battery holds charge (not dead or swollen)',
    'Speakers produce clear sound',
    'Camera works (if built in)',
    'No password or BitLocker/FileVault lock we cannot remove',
  ],
  'Tablet': [
    'Powers on',
    'Screen intact, no cracks or dead areas',
    'Touchscreen responds everywhere',
    'WiFi connects',
    'Camera works (front and back)',
    'Speaker works',
    'Charges normally',
    'No lock screen we cannot remove',
  ],
  'Bluetooth Speaker': [
    'Powers on (light or display shows)',
    'Pairs with a phone via Bluetooth within 30 seconds',
    'Audio plays clearly with no crackling or distortion',
    'Volume controls work (test high and low)',
    'Input charging port works, speaker accepts charge',
    'Battery holds charge (not dead)',
    'All buttons and controls work',
  ],
  'Power Bank': [
    'Indicator lights come on when power button pressed',
    'Charges a phone (plug in staff\'s phone — watch for charging indicator)',
    'Both USB ports work (if it has two)',
    'Input charging port accepts charge',
    'No swelling or unusual heat',
  ],
  'Electric Fan (Standing)': [
    'Powers on',
    'All speed settings work (slow, medium, fast)',
    'Fan oscillates (turns side to side) if it has that function',
    'No unusual noise, grinding, or burning smell',
    'All blades are intact (none broken or cracked)',
    'Remote control works (if included)',
    'Stand or base is stable, not cracked',
  ],
  'Electric Fan (Table/Desk)': [
    'Powers on',
    'All speed settings work (slow, medium, fast)',
    'Fan oscillates (turns side to side) if it has that function',
    'No unusual noise, grinding, or burning smell',
    'All blades are intact (none broken or cracked)',
    'Remote control works (if included)',
    'Stand or base is stable, not cracked',
  ],
  'Flat-Screen TV': [
    'Powers on, reaches the home/channel screen',
    'Screen has no cracks, dead pixels, vertical lines, or burn-in',
    'HDMI port works (test with a cable)',
    'AV input works (if applicable)',
    'Sound works clearly',
    'Remote control works',
    'Smart TV features work (if applicable — WiFi, apps)',
    'All physical buttons on the TV work',
  ],
  'Generator': [
    'Starts (pull start or electric start — both if both present)',
    'Runs steadily without stalling or stuttering',
    'No unusual smoke, burning smell, or engine noise',
    'Output voltage is correct (test with a voltage tester if available)',
    'At least one output socket provides power (plug in a light or phone)',
    'Fuel tank is not leaking',
    'Oil level is adequate (check dipstick if accessible)',
    'All sockets and switches work',
  ],
  'Gas Cylinder': [
    'Valve opens and closes smoothly (no seizing or excessive force)',
    'No visible cracks, deep dents, or cuts in the body',
    'No heavy rust on the base or body',
    'Valve does not leak (pour small soapy water on valve, no bubbles)',
    'Cylinder has usable weight (not completely empty)',
    'Safety cap is present',
  ],
  'Motorcycle': [
    'Starts (kick-start or electric start — both if both present)',
    'Runs steadily without stalling or stuttering',
    'Engine sounds normal (no knocking or unusual noise)',
    'Headlight works',
    'Tail/brake light works',
    'Horn works',
    'Throttle is responsive and smooth',
    'Front brake works',
    'Rear brake works',
    'Both tyres are inflated and not visibly worn or cracked',
    'Fuel tank is not leaking',
    'Chain or belt is intact and not excessively loose',
    'Speedometer or dashboard displays correctly (if fitted)',
    'Mirrors are present and intact (if fitted)',
    'Seat is secure and not torn',
    'Registration plate is attached',
    'No visible frame cracks or bent forks',
  ],
};

// Normalise legacy object-format itemPhotos to flat array (for drafts created before this update)
const normalizeItemPhotos = (ip) => {
  if (Array.isArray(ip)) return ip;
  if (ip && typeof ip === 'object') {
    return [ip.front, ip.back, ip.left, ip.right, ip.powerOn, ip.aboutPage, ...(ip.corners || [])].filter(v => v != null);
  }
  return [];
};

const AI_PROMPT_IMEI = `Look at this image carefully. This is a photo of a device screen showing the IMEI number (typically displayed after dialing *#06#, or visible in Settings > About Device / About Phone / About Tablet). Extract the IMEI number. It is a 15-digit number made up entirely of digits.

Reply in this exact format only:
IMEI: [15 digits only, no spaces or dashes, or NOT_FOUND]
CONFIDENCE: [percentage from 0% to 100%]

Set CONFIDENCE based on how clearly you can read every digit. If even 1 digit is uncertain, lower the confidence. If you cannot find a full 15-digit IMEI, reply with IMEI: NOT_FOUND.`;

const AI_PROMPT_SERIAL = `Look at this image carefully. Find the serial number on the label. A serial number is usually labelled "S/N", "Serial No.", "Serial Number", or "SN:" and is a combination of letters and digits.

Reply in this exact format only:
SERIAL_NUMBER: [serial number exactly as printed, or NOT_FOUND]
CONFIDENCE: [percentage from 0% to 100%]

Set CONFIDENCE based on how clearly you can read the characters. If any character is uncertain, lower the confidence.`;

const OCR_CONFIRMATION_THRESHOLD = 90;
const parseAiField = (text, key) => {
  const escapedKey = String(key || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`(?:^|\\n)\\s*(?:\\d+[.)]\\s*)?${escapedKey}:\\s*(.+?)(?=\\n\\s*(?:\\d+[.)]\\s*)?[A-Z][A-Z_]+:|$)`, 'is');
  const match = String(text || '').match(pattern);
  return match ? match[1].trim().replace(/[\n\r]+/g, ' ').replace(/\s{2,}/g, ' ') : '';
};
const parseConfidencePercent = (value) => {
  const match = String(value || '').match(/(\d{1,3})/);
  if (!match) return null;
  return Math.max(0, Math.min(100, Number(match[1])));
};
const makeDigitStates = (value = '', count = 15) => Array.from({ length: count }, (_, idx) => value[idx] || '');
const joinDigitStates = (digits) => (Array.isArray(digits) ? digits.join('').replace(/\D/g, '') : '');

// ============================================================
// CAPTURE STEP COMPONENT (6A → 6B → 6C → 6D)
// ============================================================
function CaptureStep({ tx, upd, settings, onJumpToOffer, onEndTransaction, onDecline }) {
  const [imeiAiLoading, setImeiAiLoading] = useState(false);
  const [imeiAiError, setImeiAiError] = useState('');
  const [serialAiLoading, setSerialAiLoading] = useState(false);
  const [serialAiError, setSerialAiError] = useState('');
  const imeiDigits = Array.isArray(tx.imeiDigits) ? tx.imeiDigits : makeDigitStates(tx.imei);
  const imeiConfidence = parseConfidencePercent(tx.imeiOcrConfidence);
  const serialConfidence = parseConfidencePercent(tx.serialOcrConfidence);
  const imeiNeedsManualConfirmation = !!tx.imei && imeiConfidence !== null && imeiConfidence < OCR_CONFIRMATION_THRESHOLD && !tx.imeiManualConfirmed;
  const serialNeedsManualConfirmation = !!tx.serialNumber && serialConfidence !== null && serialConfidence < OCR_CONFIRMATION_THRESHOLD && !tx.serialManualConfirmed;

  const requiresImei = IMEI_ITEM_TYPES.includes(tx.captureItemType);
  const isNonPowered = NON_POWERED_ITEM_TYPES.includes(tx.captureItemType);
  const slots = tx.captureItemType ? getPhotoSlots(tx.captureItemType) : [];
  const photoArr = Array.isArray(tx.itemPhotos) ? tx.itemPhotos : [];
  const photoCount = photoArr.filter(Boolean).length;
  const showCaptureBody = tx.captureItemType && (tx.itemPowersOn === true || tx.partsOnly);

  // For non-powered items the gatekeeper is skipped but we still need the body to appear
  // (itemPowersOn is auto-set to true above, so showCaptureBody will be true already)

  const updPhoto = (idx, val) => {
    const arr = [...(Array.isArray(tx.itemPhotos) ? tx.itemPhotos : [])];
    arr[idx] = val || null;
    upd('itemPhotos', arr);
  };

  const setImeiDigits = (digits) => {
    const nextDigits = Array.isArray(digits) ? digits.slice(0, 15) : makeDigitStates('');
    while (nextDigits.length < 15) nextDigits.push('');
    upd('imeiDigits', nextDigits);
    upd('imei', joinDigitStates(nextDigits));
    upd('imeiManualConfirmed', false);
  };

  const handleImeiInputChange = (value) => {
    const digits = value.replace(/\D/g, '').slice(0, 15);
    upd('imei', digits);
    upd('imeiDigits', makeDigitStates(digits));
    upd('imeiManualConfirmed', false);
  };

  const handleImeiDigitChange = (idx, value) => {
    const digit = value.replace(/\D/g, '').slice(-1);
    const next = [...imeiDigits];
    next[idx] = digit;
    setImeiDigits(next);
  };

  const handleExtractIMEI = async () => {
    setImeiAiLoading(true); setImeiAiError('');
    if (!tx.imeiPhoto) { setImeiAiError('Upload a photo of the IMEI screen first.'); setImeiAiLoading(false); return; }
    const result = await callGeminiAI(settings.geminiApiKey, settings.geminiModel, [tx.imeiPhoto], AI_PROMPT_IMEI);
    if (result.error) { setImeiAiError(result.error); }
    else {
      const extracted = (parseAiField(result.text, 'IMEI') || result.text || '').trim().replace(/\D/g, '');
      const confidence = parseConfidencePercent(parseAiField(result.text, 'CONFIDENCE'));
      upd('imeiOcrConfidence', confidence === null ? '' : String(confidence));
      upd('imeiManualConfirmed', false);
      if (!extracted || extracted.length !== 15) { setImeiAiError('AI could not read a valid 15-digit IMEI from the photo. Try a clearer, closer shot of the screen.'); }
      else {
        upd('imei', extracted);
        upd('imeiDigits', makeDigitStates(extracted));
        setImeiAiError('');
      }
    }
    setImeiAiLoading(false);
  };

  const handleExtractSerial = async () => {
    setSerialAiLoading(true); setSerialAiError('');
    if (!tx.serialNumberPhoto) { setSerialAiError('Upload a photo of the serial label first.'); setSerialAiLoading(false); return; }
    const result = await callGeminiAI(settings.geminiApiKey, settings.geminiModel, [tx.serialNumberPhoto], AI_PROMPT_SERIAL);
    if (result.error) { setSerialAiError(result.error); }
    else {
      const extracted = (parseAiField(result.text, 'SERIAL_NUMBER') || result.text || '').trim();
      const confidence = parseConfidencePercent(parseAiField(result.text, 'CONFIDENCE'));
      upd('serialOcrConfidence', confidence === null ? '' : String(confidence));
      upd('serialManualConfirmed', false);
      if (extracted === 'NOT_FOUND' || extracted === '') { setSerialAiError('AI could not find a serial number in the photo. Try a clearer, closer shot of the label.'); }
      else { upd('serialNumber', extracted); setSerialAiError(''); }
    }
    setSerialAiLoading(false);
  };

  return (
    <div>
      <h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '16px' }}>📷 Item Capture</h3>

      {/* 6A — Item Type */}
      <Field label={<span style={{ display: 'inline-flex', alignItems: 'center' }}>Item Type<InfoIcon tip="Pick the type that best matches the item. This decides which photos to take, what to check during inspection, and whether an IMEI number is needed." /></span>} required>
        <select
          style={S.select}
          value={tx.captureItemType}
          onChange={e => {
            const newType = e.target.value;
            upd('captureItemType', newType);
            upd('requiresIMEI', IMEI_ITEM_TYPES.includes(newType));
            // Non-powered items (e.g. Gas Cylinder) cannot be asked to "power on"
            upd('itemPowersOn', NON_POWERED_ITEM_TYPES.includes(newType) ? true : null);
            upd('partsOnly', false);
            upd('itemPhotos', []);
            upd('imei', '');
            upd('imeiDigits', makeDigitStates(''));
            upd('imeiOcrConfidence', '');
            upd('imeiManualConfirmed', false);
            upd('imeiPhoto', null);
            upd('imeiModelMatch', false);
            upd('serialNumber', '');
            upd('serialOcrConfidence', '');
            upd('serialManualConfirmed', false);
            upd('serialNumberPhoto', null);
          }}
        >
          <option value="">— Select item type —</option>
          {CAPTURE_ITEM_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        {!tx.captureItemType && <div style={{ fontSize: '12px', color: COLORS.danger, marginTop: '4px' }}>⛔ Item type is required before proceeding.</div>}
      </Field>
      <div style={{ ...S.alert('warning'), marginTop: '4px' }}>
        ⚠ Only accept items you can confidently sell within <strong>14 days</strong> in Aguleri. If in doubt, decline politely. <strong>Do not accept jewellery, clothing, or documents.</strong>
      </div>

      {/* 6A — Power-on Gatekeeper (skipped for items that physically cannot power on) */}
      {tx.captureItemType && !isNonPowered && (
        <div style={{ marginTop: '16px', padding: '16px', background: COLORS.bg, borderRadius: '10px', border: `1px solid ${COLORS.border}` }}>
          <div style={{ fontSize: '14px', fontWeight: 700, marginBottom: '12px' }}>Does this item power on and function at a basic level?</div>
          <div style={{ display: 'flex', gap: '12px' }}>
            <button style={{ ...S.btn(tx.itemPowersOn === true ? 'primary' : 'outline'), flex: 1, justifyContent: 'center' }} onClick={() => { upd('itemPowersOn', true); upd('partsOnly', false); }}>✅ Yes — Powers On</button>
            <button style={{ ...S.btn(tx.itemPowersOn === false ? 'danger' : 'outline'), flex: 1, justifyContent: 'center' }} onClick={() => upd('itemPowersOn', false)}>❌ No — Does Not Power On</button>
          </div>
          {tx.itemPowersOn === null && <div style={{ fontSize: '12px', color: COLORS.danger, marginTop: '8px' }}>⛔ You must confirm whether this item powers on before proceeding.</div>}
        </div>
      )}

      {/* Parts-Only Branch (only for items that can power on) */}
      {tx.captureItemType && !isNonPowered && tx.itemPowersOn === false && !tx.partsOnly && (
        <div style={{ ...S.alert('danger'), marginTop: '12px' }}>
          <div style={{ fontWeight: 700, marginBottom: '8px' }}>⚠️ Value: ₦0 (Scrap Only)</div>
          <div style={{ marginBottom: '12px' }}>This item does not power on. Do you wish to proceed with a <strong>Parts Only</strong> transaction? The maximum offer will be ₦{(settings.maxPartsOnlyAdvance || MAX_PARTS_ONLY_ADVANCE).toLocaleString()}.</div>
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            <button style={{ ...S.btn('primary'), flex: 1, justifyContent: 'center' }} onClick={() => { upd('partsOnly', true); upd('estimatedValue', 0); onJumpToOffer(); }}>Yes — Proceed as Parts Only (Max ₦{(settings.maxPartsOnlyAdvance || MAX_PARTS_ONLY_ADVANCE).toLocaleString()})</button>
            <button style={{ ...S.btn('muted'), flex: 1, justifyContent: 'center' }} onClick={onEndTransaction}>No — End Transaction</button>
          </div>
        </div>
      )}

      {/* 6B — Item Photos */}
      {showCaptureBody && (
        <>
          <div style={{ marginTop: '20px', paddingTop: '16px', borderTop: `2px solid ${COLORS.border}` }}>
            <div style={{ fontSize: '14px', fontWeight: 700, marginBottom: '4px' }}>📸 Item Photos</div>
            <div style={{ fontSize: '12px', color: COLORS.textMuted, marginBottom: '12px' }}>
              Take photos in <strong>good light near a window</strong>. Minimum <strong>3 photos</strong> required ({slots.length} slots for this item type). <strong>Photo 1 must be the brand/model label</strong> — this helps the AI identify the exact model. Then capture exterior and working condition.
            </div>
            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
              {slots.map((slotLabel, i) => (
                <PhotoUpload
                  key={i}
                  label={`${i + 1}. ${slotLabel}`}
                  value={photoArr[i] || null}
                  onChange={v => updPhoto(i, v)}
                  required={i < 3}
                  size={110}
                />
              ))}
            </div>
            {photoCount < 3 && (
              <div style={{ ...S.alert('danger'), marginTop: '12px' }}>
                ⛔ At least 3 photos are required. You have uploaded {photoCount} so far.
              </div>
            )}
          </div>

          {/* 6C — IMEI (Smartphone/Tablet) or Serial Number (all others) */}
          <div style={{ marginTop: '20px', paddingTop: '16px', borderTop: `2px solid ${COLORS.border}` }}>
            {requiresImei ? (
              <>
                <div style={{ fontSize: '14px', fontWeight: 700, marginBottom: '8px' }}>📱 IMEI Capture</div>
                <div style={{ ...S.alert('info'), marginBottom: '12px' }}>
                  📱 The IMEI permanently identifies this specific device. Dial <strong>*#06#</strong> on the device — a number will appear on screen. Take a clear close-up photo. We use the IMEI to confirm this is the exact device the customer says it is. Check that the brand and model on imei.info matches what you see in the device's About/Settings screen.</div>
                <PhotoUpload label="Photo of IMEI on screen (*#06#)" value={tx.imeiPhoto} onChange={v => { upd('imeiPhoto', v); if (!v) { upd('imei', ''); upd('imeiDigits', makeDigitStates('')); upd('imeiOcrConfidence', ''); upd('imeiManualConfirmed', false); upd('imeiModelMatch', false); } }} required size={130} />
                {tx.imeiPhoto && (
                  <div style={{ marginTop: '10px' }}>
                    <button style={S.btn('primary')} onClick={handleExtractIMEI} disabled={imeiAiLoading}>
                      {imeiAiLoading ? '⏳ Extracting...' : '🤖 Extract IMEI with AI'}
                    </button>
                  </div>
                )}
                {tx.imeiPhoto && !tx.imei && !imeiAiLoading && <div style={{ ...S.alert('danger'), marginTop: '8px' }}>⛔ Please extract or enter the IMEI number.</div>}
                {imeiAiError && <div style={{ ...S.alert('danger'), marginTop: '8px' }}>{imeiAiError}</div>}
                <Field label="IMEI Number" required style={{ marginTop: '12px' }}>
                  <input style={S.input} inputMode="numeric" value={tx.imei} onChange={e => handleImeiInputChange(e.target.value)} placeholder="15-digit IMEI — auto-filled by AI or type manually" />
                  {!tx.imei && <div style={{ fontSize: '12px', color: COLORS.danger, marginTop: '4px' }}>⛔ IMEI is required for this device.</div>}
                  {imeiConfidence !== null && (
                    <div style={{ marginTop: '8px', fontSize: '12px', color: imeiConfidence < OCR_CONFIRMATION_THRESHOLD ? COLORS.warn : '#166534', fontWeight: 600 }}>
                      OCR confidence: {imeiConfidence}%
                    </div>
                  )}
                  {!!tx.imei && imeiConfidence !== 100 && (
                    <div style={{ marginTop: '10px', padding: '12px', background: '#f8fafc', border: `1px solid ${COLORS.border}`, borderRadius: '8px' }}>
                      <div style={{ fontSize: '12px', fontWeight: 700, marginBottom: '8px', color: '#334155' }}>Digit-by-digit IMEI check</div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: '8px' }}>
                        {imeiDigits.map((digit, idx) => (
                          <label key={idx} style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '11px', color: '#64748b' }}>
                            <span>#{idx + 1}</span>
                            <input
                              style={{ ...S.input, textAlign: 'center', padding: '10px 0', fontFamily: 'monospace', borderColor: digit ? COLORS.border : '#f59e0b' }}
                              inputMode="numeric"
                              maxLength={1}
                              value={digit}
                              onChange={e => handleImeiDigitChange(idx, e.target.value)}
                              placeholder="•"
                            />
                          </label>
                        ))}
                      </div>
                      <div style={{ marginTop: '8px', fontSize: '12px', color: '#475569' }}>Review each box against the photo so staff can quickly fix any wrong digit.</div>
                    </div>
                  )}
                  {imeiNeedsManualConfirmation && <div style={{ ...S.alert('warning'), marginTop: '8px' }}>⚠ OCR confidence is below {OCR_CONFIRMATION_THRESHOLD}%. A staff member must manually confirm all IMEI digits before continuing.</div>}
                  {!!tx.imei && imeiConfidence !== null && imeiConfidence < OCR_CONFIRMATION_THRESHOLD && (
                    <label style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', cursor: 'pointer', padding: '12px', background: '#fff7ed', borderRadius: '8px', border: '1px solid #fdba74', marginTop: '8px' }}>
                      <input type="checkbox" checked={!!tx.imeiManualConfirmed} onChange={e => upd('imeiManualConfirmed', e.target.checked)} style={{ width: '18px', height: '18px', marginTop: '2px', flexShrink: 0 }} />
                      <span style={{ fontSize: '13px' }}>I manually checked every IMEI digit against the photo and corrected any OCR mistakes.</span>
                    </label>
                  )}
                </Field>
                {tx.imei && (
                  <>
                    <div style={{ marginBottom: '12px' }}>
                      <a href={`https://www.imei.info/?imei=${tx.imei}`} target="_blank" rel="noopener noreferrer" style={{ ...S.btn('primary'), display: 'inline-flex', textDecoration: 'none' }}>
                        🔍 Verify on imei.info →
                      </a>
                    </div>
                    <label style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', cursor: 'pointer', padding: '12px', background: COLORS.bg, borderRadius: '8px', border: `1px solid ${COLORS.border}` }}>
                      <input type="checkbox" checked={tx.imeiModelMatch} onChange={e => upd('imeiModelMatch', e.target.checked)} style={{ width: '18px', height: '18px', marginTop: '2px', flexShrink: 0 }} />
                      <span style={{ fontSize: '13px' }}>✅ Brand and model on imei.info matches what we saw on the device</span>
                    </label>
                    {!tx.imeiModelMatch && <div style={{ ...S.alert('danger'), marginTop: '8px' }}>⛔ You must confirm the brand and model match before proceeding.</div>}
                  </>
                )}
              </>
            ) : (
              <>
                <div style={{ fontSize: '14px', fontWeight: 700, marginBottom: '8px' }}>📦 Serial Number</div>
                <div style={{ ...S.alert('info'), marginBottom: '12px' }}>
                  📦 Check the back panel, bottom sticker, or inside compartment for a serial/model number. If you find one, photograph the label and let AI read it. This helps identify this specific unit if there is ever a dispute.
                </div>
                <PhotoUpload label="Photo of serial number label" value={tx.serialNumberPhoto} onChange={v => { upd('serialNumberPhoto', v); if (!v) { upd('serialNumber', ''); upd('serialOcrConfidence', ''); upd('serialManualConfirmed', false); } }} size={130} />
                {tx.serialNumberPhoto && (
                  <div style={{ marginTop: '10px' }}>
                    <button style={S.btn('primary')} onClick={handleExtractSerial} disabled={serialAiLoading}>
                      {serialAiLoading ? '⏳ Extracting...' : '🤖 Extract Serial Number with AI'}
                    </button>
                  </div>
                )}
                {tx.serialNumberPhoto && !tx.serialNumber && !serialAiLoading && <div style={{ ...S.alert('danger'), marginTop: '8px' }}>⛔ You uploaded a serial photo — please extract or enter the serial number.</div>}
                {serialAiError && <div style={{ ...S.alert('danger'), marginTop: '8px' }}>{serialAiError}</div>}
                <Field label="Serial Number" style={{ marginTop: '12px' }}>
                  <input style={S.input} value={tx.serialNumber} onChange={e => { upd('serialNumber', e.target.value); upd('serialManualConfirmed', false); }} placeholder="Auto-filled by AI or type manually (optional)" />
                  {serialConfidence !== null && (
                    <div style={{ marginTop: '8px', fontSize: '12px', color: serialConfidence < OCR_CONFIRMATION_THRESHOLD ? COLORS.warn : '#166534', fontWeight: 600 }}>
                      OCR confidence: {serialConfidence}%
                    </div>
                  )}
                  {serialNeedsManualConfirmation && <div style={{ ...S.alert('warning'), marginTop: '8px' }}>⚠ OCR confidence is below {OCR_CONFIRMATION_THRESHOLD}%. Staff must manually confirm the serial number before continuing.</div>}
                  {!!tx.serialNumber && serialConfidence !== null && serialConfidence < OCR_CONFIRMATION_THRESHOLD && (
                    <label style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', cursor: 'pointer', padding: '12px', background: '#fff7ed', borderRadius: '8px', border: '1px solid #fdba74', marginTop: '8px' }}>
                      <input type="checkbox" checked={!!tx.serialManualConfirmed} onChange={e => upd('serialManualConfirmed', e.target.checked)} style={{ width: '18px', height: '18px', marginTop: '2px', flexShrink: 0 }} />
                      <span style={{ fontSize: '13px' }}>I manually checked the serial number against the photo.</span>
                    </label>
                  )}
                </Field>
              </>
            )}
          </div>

          {/* 6D — Receipt */}
          <div style={{ marginTop: '20px', paddingTop: '16px', borderTop: `2px solid ${COLORS.border}` }}>
            <div style={{ fontSize: '14px', fontWeight: 700, marginBottom: '8px', display: 'flex', alignItems: 'center' }}>🧾 Original Purchase Receipt<InfoIcon tip="A receipt shows the customer bought it properly, so we can offer more money. No receipt means we give less, just to be safe." /></div>
            <div style={{ fontSize: '13px', color: COLORS.textMuted, marginBottom: '12px' }}>Does the customer have the original purchase receipt?</div>
            <div style={{ display: 'flex', gap: '12px', marginBottom: '12px' }}>
              <button style={{ ...S.btn(tx.hasReceipt === true ? 'primary' : 'outline'), flex: 1, justifyContent: 'center' }} onClick={() => upd('hasReceipt', true)}>✅ Yes — Has Receipt</button>
              <button style={{ ...S.btn(tx.hasReceipt === false ? 'primary' : 'outline'), flex: 1, justifyContent: 'center' }} onClick={() => { upd('hasReceipt', false); upd('receiptPhoto', null); }}>❌ No — No Receipt</button>
            </div>
            {tx.hasReceipt === true && (
              <>
                <PhotoUpload label="Receipt Photo" value={tx.receiptPhoto} onChange={v => upd('receiptPhoto', v)} required size={140} />
                {!tx.receiptPhoto && <div style={{ ...S.alert('danger'), marginTop: '8px' }}>⛔ Receipt photo is required — you indicated a receipt was provided.</div>}
              </>
            )}
          </div>
        </>
      )}

      {tx.captureItemType && <div style={{ marginTop: '16px', paddingTop: '12px', borderTop: `1px solid ${COLORS.border}` }}><div style={{ fontSize: '12px', fontWeight: 600, color: COLORS.textMuted, marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>End transaction</div><div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}><button style={S.btnSm('muted')} onClick={() => onDecline('Item appeared modified')}>Item appeared modified</button></div></div>}
    </div>
  );
}

// ============================================================
// INSPECTION STEP COMPONENT (Step 7)
// ============================================================
function InspectionStep({ tx, upd }) {
  const itemType = tx.captureItemType || '';
  const checklist = INSPECTION_CHECKLISTS[itemType] || [];
  const isOther = itemType === 'Other' || checklist.length === 0;

  const checkedMap = tx.inspectionChecklist || {};
  const notes = tx.inspectionNotes || '';

  // Determine if any checklist item is unticked (only relevant when there is a checklist)
  const anyUnticked = !isOther && checklist.some(item => !checkedMap[item]);

  const toggleItem = (item) => {
    upd('inspectionChecklist', { ...checkedMap, [item]: !checkedMap[item] });
  };

  return (
    <div>
      <h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '16px' }}>✅ Item Inspection Checklist</h3>

      <div style={{ ...S.alert('warning'), marginBottom: '16px' }}>
        ✅ <strong>Test every item below in front of the customer.</strong> Tick only what you have physically tested and confirmed. Anything you do not test becomes your responsibility if there is a dispute later.
      </div>

      {isOther ? (
        <div style={{ ...S.alert('info'), marginBottom: '16px' }}>
          ℹ️ No standard checklist for &quot;{itemType}&quot;. Use the notes field below to document your inspection observations.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '20px' }}>
          {checklist.map((item) => {
            const checked = !!checkedMap[item];
            return (
              <label
                key={item}
                style={{
                  display: 'flex', alignItems: 'flex-start', gap: '10px', cursor: 'pointer',
                  padding: '12px', borderRadius: '8px', border: `1px solid ${checked ? '#b7e4c7' : COLORS.border}`,
                  background: checked ? COLORS.primaryLight : COLORS.bg,
                  transition: 'background 0.15s, border-color 0.15s',
                }}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleItem(item)}
                  style={{ width: '18px', height: '18px', marginTop: '2px', flexShrink: 0, accentColor: COLORS.primary }}
                />
                <span style={{ fontSize: '13px', lineHeight: '1.4', color: checked ? COLORS.text : COLORS.textMuted }}>
                  {checked ? '✅ ' : '⬜ '}{item}
                </span>
              </label>
            );
          })}
        </div>
      )}

      {/* Prompt if any items are unticked */}
      {anyUnticked && (
        <div style={{ ...S.alert('warning'), marginBottom: '12px' }}>
          ⚠ You have left one or more items unticked. Please write a reason in the Notes field below explaining anything you could not test or confirm.
        </div>
      )}

      {/* Staff Notes */}
      <div style={{ marginTop: '4px' }}>
        <div style={{ fontSize: '14px', fontWeight: 700, marginBottom: '6px', display: 'flex', alignItems: 'center' }}>
          📝 Staff Notes
          {anyUnticked && <span style={{ color: COLORS.danger, fontWeight: 700 }}> *</span>}
          <InfoIcon tip="Only staff can see this. Write down anything odd you noticed — strange smells, loose parts, battery issues, missing accessories, or why you skipped any checklist item." />
        </div>
        <div style={{ fontSize: '12px', color: COLORS.textMuted, marginBottom: '8px' }}>
          Write anything extra you noticed that is not captured above. Examples: &quot;Customer says battery drains in 3 hours.&quot; / &quot;One key sticks slightly.&quot; / &quot;TV remote is missing — customer says they never had one.&quot; / &quot;Generator started on second pull.&quot; This is a private internal record.
        </div>
        <textarea
          style={{ ...S.textarea, minHeight: '100px' }}
          value={notes}
          onChange={e => upd('inspectionNotes', e.target.value)}
          placeholder={anyUnticked ? 'Required — explain what you could not test and why…' : 'Optional — add any extra observations here…'}
        />
        {anyUnticked && !notes.trim() && (
          <div style={{ fontSize: '12px', color: COLORS.danger, marginTop: '4px' }}>
            ⛔ Notes are required when one or more checklist items are left unticked.
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// TRANSACTION WIZARD (11-step flow, saves to database)
// ============================================================
const WIZARD_STEPS = [
  { id: 'type', label: '1. Type', icon: '📋' },
  { id: 'nin', label: '2. ID Verify', icon: '🪪' },
  { id: 'customer', label: '3. Customer', icon: '👤' },
  { id: 'custPhotos', label: '4. Photos', icon: '📸' },
  { id: 'screening', label: '5. Screening', icon: '❓' },
  { id: 'itemPhotos', label: '6. Capture', icon: '📷' },
  { id: 'inspection', label: '7. Inspection', icon: '✅' },
  { id: 'aiValuation', label: '8. AI Value', icon: '🤖' },
  { id: 'offer', label: '9. Offer', icon: '💰' },
  { id: 'agreement', label: '10. Agreement', icon: '📄' },
  { id: 'complete', label: '11. Complete', icon: '🏁' },
];

const EMPTY_TX = {
  type: 'advance', status: 'active', idType: 'nin', idNumber: '', ninVerified: false, ninVerificationAttempted: false, ninVerificationStatus: 'not_attempted', ninData: null, ninPhoto: null,
  fullName: '', address: '', phoneNumbers: ['', ''], phonesVerified: [false, false],
  familyName: '', familyPhone: '', familyRelation: '',
  photoCustomerHolding: null, photoCustomerID: null, photoSigning: null, photoSealedPkg: null,
  captureItemType: '', itemPowersOn: null, partsOnly: false,
  itemPhotos: [],
  inspectionChecklist: {}, inspectionNotes: '',
  aiItemType: '', aiBrand: '', aiModel: '', aiColour: '', aiKeySpecs: '', aiConfidence: '', aiSpecsUnreadable: '',
  aiCondition: '', aiEstimatedValue: '', aiNewMarketPrice: '', aiPriceBasis: '', aiPriceRangeLow: '', aiPriceRangeHigh: '', aiValuationConfidence: '',
  aiVisionUsed: false, aiVisionLabels: '', aiModelVerified: '',
  aiRawResponse: '', aiRawResponse2: '', aiRawResponse3: '',
  aiRun1Done: false, aiRun2Done: false, aiRun3Done: false, aiManualMode: false,
  requiresIMEI: false,
  imei: '', imeiDigits: makeDigitStates(''), imeiOcrConfidence: '', imeiManualConfirmed: false, imeiPhoto: null, imeiModelMatch: false,
  serialNumber: '', serialOcrConfidence: '', serialManualConfirmed: false, serialNumberPhoto: null,
  hasReceipt: null, receiptPhoto: null,
  screeningDuration: '', screeningDurationOther: '', screeningPurchaseLocation: '', screeningPurchaseLocationOther: '', screeningRegistered: '', screeningOthersUsing: '', screeningRedFlag: false,
  estimatedValue: 0, loanCapPct: 40, cashAdvance: 0, dailyFee: 0, loanDays: 30,
  dateGiven: '', deadlineDate: '', serviceFeeCollected: false, conditionDescription: '',
  salePrice: 0, saleDate: '', saleBuyer: '',
  amountRepaid: 0, dateRepaid: '', daysCharged: 0, totalFees: 0, itemReturned: false,
  contactLog: [], notes: '',
};

function TransactionWizard({ settings, onSave, onCancel, draft, currentUser }) {
  const [step, setStep] = useState(draft?.wizardStep || 0);
  const [tx, setTx] = useState(() => {
    const base = draft || { ...EMPTY_TX, ref: genRef(), createdBy: currentUser?.name || '', createdAt: new Date().toISOString() };
    // Normalize legacy object-format itemPhotos to array
    return { ...base, itemPhotos: normalizeItemPhotos(base.itemPhotos) };
  });
  const [aiLoading, setAiLoading] = useState(false);
  const [aiLoadingPhase, setAiLoadingPhase] = useState(''); // 'run1', 'run2', 'run3'
  const [ninLoading, setNinLoading] = useState(false);
  const [aiError, setAiError] = useState('');
  const [ninError, setNinError] = useState('');
  const [ninCredits, setNinCredits] = useState(null); // number of credits, or null if unknown
  const [ninCreditsLoading, setNinCreditsLoading] = useState(false);
  const [showRechargeModal, setShowRechargeModal] = useState(false);
  const [redFlagModal, setRedFlagModal] = useState(false);
  const [ninSuggestions, setNinSuggestions] = useState([]);
  const [showNinSuggestions, setShowNinSuggestions] = useState(false);
  const ninSuggestTimerRef = useRef(null);
  // Wizard decline log modal — shown when a transaction is declined during the wizard so staff
  // can review / edit the pre-populated entry before it is saved to the declined log.
  // Shape: { date, item, reason, notes, onAfter } | null
  const [wizDeclineModal, setWizDeclineModal] = useState(null);
  const saveTimer = useRef(null);

  const isMobile = useMobile();
  const upd = (field, val) => setTx(prev => ({ ...prev, [field]: val }));
  const maxLoanDays = Math.max(1, Number(settings.maxLoanDays) || 30);

  useEffect(() => {
    if (tx.loanDays !== '' && Number(tx.loanDays) > maxLoanDays) {
      upd('loanDays', maxLoanDays);
      if (tx.dateGiven) {
        upd('deadlineDate', addDays(tx.dateGiven, maxLoanDays));
      }
    }
  }, [maxLoanDays, tx.loanDays, tx.dateGiven]);

  // Auto-save draft every 3 seconds (debounced) after identity step has been passed.
  // On unmount, flush any pending save immediately so exiting via ✕ never loses a draft.
  const pendingDraftRef = useRef(null);
  useEffect(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const canPersistDraft = step > 1 || tx.ninVerified || tx.ninVerificationAttempted;
    pendingDraftRef.current = canPersistDraft ? { ...tx, wizardStep: step } : null;
    saveTimer.current = setTimeout(() => {
      if (canPersistDraft) API.post('drafts', { ...tx, wizardStep: step });
      else API.del(`drafts/${encodeURIComponent(tx.ref)}`);
      pendingDraftRef.current = null;
    }, 3000);
    return () => clearTimeout(saveTimer.current);
  }, [tx, step]);
  useEffect(() => {
    return () => { if (pendingDraftRef.current) API.post('drafts', pendingDraftRef.current); };
  }, []);

  // Fetch verification credits when the NIN step becomes active.
  // Only fetches if the NIN API key is configured.
  useEffect(() => {
    if (WIZARD_STEPS[step]?.id !== 'nin') return;
    if (!settings.ninApiKey) return;
    setNinCreditsLoading(true);
    API.get('nin-balance').then(data => {
      setNinCredits(data?.credits ?? null);
    }).catch(() => {
      setNinCredits(null);
    }).finally(() => setNinCreditsLoading(false));
  }, [step, settings.ninApiKey]);

  // Immediate (non-debounced) draft save — call before navigating away or advancing steps.
  const saveDraftNow = async (nextStep) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const stepToSave = nextStep !== undefined ? nextStep : step;
    const canPersistDraft = stepToSave > 1 || tx.ninVerified || tx.ninVerificationAttempted;
    if (canPersistDraft) await API.post('drafts', { ...tx, wizardStep: stepToSave });
  };

 // NIN/BVN Verification
  const handleVerify = async () => {
    setNinLoading(true); setNinError('');
    upd('ninVerificationAttempted', true);
    try {
      const endpoint = tx.idType === 'nin' ? 'verify-nin' : 'verify-bvn';
      const body = tx.idType === 'nin'
        ? { nin: tx.idNumber, apiKey: settings.ninApiKey }
        : { bvn: tx.idNumber, apiKey: settings.ninApiKey };
      const result = await API.post(endpoint, body);

      if ((result?.status === 'success' || result?.status === true || result?.status === 'true' || result?.code === 200) && (result?.data || result?.response)) {
        const d = (result.data?.firstname || result.data?.firstName) ? result.data : (result.data?.data || result.data || result.response);

        upd('ninVerified', true);
        upd('ninVerificationStatus', 'verified');
        upd('ninData', d);
        upd('ninSource', result._source === 'cache' ? 'cache' : 'api');

        const first = d.firstname || d.firstName;
        const middle = d.middlename || d.middleName;
        const last = d.surname || d.lastname || d.lastName;
        const fullName = [first, middle, last].filter(Boolean).join(' ');
        if (fullName) upd('fullName', fullName);

        const address = [d.residence_address, d.residence_town, d.residence_lga, d.residence_state].filter(Boolean).join(', ');
        if (address) upd('address', address);

        const phone = d.telephoneno || d.phone || d.phoneNumber || d.phoneNumber1 || d.mobile;
        if (phone) upd('phoneNumbers', [phone, tx.phoneNumbers[1]]);

        let rawPhoto = d.photo || d.base64Image || d.picture || d.image;
        if (rawPhoto) {
          if (!rawPhoto.startsWith('data:image')) rawPhoto = `data:image/jpeg;base64,${rawPhoto}`;
          // Upload NIN photo to R2 to avoid bloating the database with base64
          try {
            const mimeType = rawPhoto.split(';')[0].split(':')[1] || 'image/jpeg';
            const photoData = rawPhoto.split(',')[1];
            const uploadResult = await API.post('photos', { data: photoData, mimeType });
            upd('ninPhoto', uploadResult?.url || rawPhoto);
          } catch {
            upd('ninPhoto', rawPhoto); // fall back to base64 if R2 upload fails
          }
        }
      } else {
        throw new Error(result?.message || result?.detail || 'Verification failed');
      }
    } catch (e) {
      const errorMessage = e?.message || String(e) || 'Unknown error occurred';
      setNinError(`${errorMessage} — Proceeding with placeholder (demo) identity data.`);
      upd('ninVerified', false);
      upd('ninVerificationStatus', 'demo_placeholder');
      upd('ninData', { firstname: 'Demo', surname: 'User', residence_address: 'Aguleri Junction, Anambra State' });
      if (!tx.fullName) upd('fullName', 'Demo User');
      if (!tx.address) upd('address', 'Aguleri Junction, Anambra State');
    }
    setNinLoading(false);
  };

  // AI Analysis Engine — 3 Sequential Runs
  const getPhotos = () => (Array.isArray(tx.itemPhotos) ? tx.itemPhotos : []).filter(Boolean);
  // Parse a KEY: value field from AI response. Handles:
  // - Numbered prefixes: "1. KEY:" or "1) KEY:" or "1 KEY:"
  // - Multi-line values: captures until next KEY_LIKE_THIS: pattern or end of text
  // - Collapses newlines into spaces
  const aiParseField = (text, key) => {
    const pattern = new RegExp(`(?:^|\\n)\\s*(?:\\d+[.)\\s]*)?${key}:\\s*(.+?)(?=\\n\\s*(?:\\d+[.)\\s]*)?[A-Z][A-Z_]+:|$)`, 'is');
    const m = text.match(pattern);
    return m ? m[1].trim().replace(/[\n\r]+/g, ' ').replace(/\s{2,}/g, ' ') : '';
  };
  const AI_TIMEOUT = 120000; // 120s timeout per AI call (Pro thinking models need more time)

  const callWithTimeout = (fn, timeout) => Promise.race([
    fn(),
    new Promise((_, reject) => setTimeout(() => reject(new Error('AI request timed out. Please try again or enter details manually.')), timeout))
  ]);

  const switchToManualMode = (errorMsg) => {
    upd('aiManualMode', true);
    setAiError(errorMsg || 'AI failed. Please enter all details manually.');
    setAiLoading(false);
    setAiLoadingPhase('');
  };

  // RUN 1: Item Identification & Spec Verification
  // Strategy: Gemini first. If confidence is 100%, done. Otherwise, if Cloud Vision API key
  // is configured, run reverse image search to get additional context, then re-ask Gemini
  // with the Vision data to improve accuracy.
  const handleAIRun1 = async () => {
    setAiLoading(true); setAiLoadingPhase('run1'); setAiError(''); upd('aiModelVerified', '');
    // Check API usage limits before making calls
    const geminiCheck = checkGeminiLimit(settings);
    if (geminiCheck.blocked) { setAiError(geminiCheck.reason); setAiLoading(false); setAiLoadingPhase(''); return; }
    const photos = getPhotos();
    if (photos.length === 0) { setAiError('Please upload at least one item photo first.'); setAiLoading(false); setAiLoadingPhase(''); return; }
    const itemTypeHint = tx.captureItemType && tx.captureItemType !== 'Other' ? tx.captureItemType : '';
    const basePrompt = (visionContext) => `You are helping a second-hand shop in Aguleri, Anambra State, Nigeria. Look carefully at all the photos uploaded.${itemTypeHint ? ` The staff selected item type: "${itemTypeHint}".` : ' Identify what the item actually is.'} Tell me the exact details of the item. Use simple everyday English — no big grammar words.
${visionContext ? `\nADDITIONAL CONTEXT FROM IMAGE ANALYSIS AND WEB SEARCH (use this to confirm or correct your identification — pay special attention to any "Text detected on device" as it may contain the exact model number):\n${visionContext}\n` : ''}
IMPORTANT: Look carefully at ALL text visible on the item — labels, stickers, printed text on the body, capacity markings (e.g. mAh for power banks), serial number plates, About screens, spec sheets. The model name/number is often printed directly on the device.

CRITICAL INSTRUCTION: Reply in this exact format (no numbered prefixes, no markdown, no extra text):

AI_ITEM_TYPE: [what the item is]
BRAND: [brand name]
MODEL: [exact model name or number as printed on the device]
KEY_SPECS: [the most important specs that affect resale value — keep it under 12 words]
COLOUR: [colour(s)]
CONFIDENCE: [your confidence score as a percentage, e.g. 92%]

If text on the device is blurry, unreadable, or missing, you MUST ALSO include this line BEFORE the other fields:
SPECS_UNREADABLE: [List exactly what you cannot read and why (very concise)]

Then still reply with ALL 6 fields above with your best guess based on what you can see in the photos and any internet research. Your CONFIDENCE score should reflect how certain you are about the MODEL and KEY_SPECS.`;

    const parseGeminiResult = (text) => {
      const specsUnreadable = aiParseField(text, 'SPECS_UNREADABLE');
      if (specsUnreadable) upd('aiSpecsUnreadable', specsUnreadable);
      upd('aiItemType', aiParseField(text, 'AI_ITEM_TYPE') || tx.captureItemType);
      upd('aiBrand', aiParseField(text, 'BRAND'));
      upd('aiModel', aiParseField(text, 'MODEL'));
      upd('aiKeySpecs', aiParseField(text, 'KEY_SPECS'));
      upd('aiColour', aiParseField(text, 'COLOUR'));
      const confidence = aiParseField(text, 'CONFIDENCE');
      upd('aiConfidence', confidence);
      return { confidence, specsUnreadable };
    };

    try {
      const hasVisionKey = !!(settings.cloudVisionApiKey || '').trim();
      let visionContext = '';

      // Step 1: Run Cloud Vision FIRST (if configured) for OCR + web detection
      // Vision provides OCR text, logo detection, and web entity matching that
      // significantly improves Gemini's ability to identify exact model numbers
      const visionCheck = checkVisionLimit(settings);
      if (hasVisionKey && !visionCheck.blocked) {
        setAiLoadingPhase('run1_vision');
        const visionPhotos = photos.slice(0, 2);
        const visionResults = [];
        const allVisionLabels = [];
        for (const photo of visionPhotos) {
          const vr = await callWithTimeout(() => callCloudVision(settings.cloudVisionApiKey, photo), 30000);
          if (!vr.error && vr.summary) visionResults.push(vr.summary);
          if (!vr.error) {
            allVisionLabels.push(...(vr.bestGuess || []), ...(vr.logos || []), ...((vr.webEntities || []).slice(0, 3).map(e => e.split(' (')[0])));
          }
        }
        const uniqueLabels = [...new Set(allVisionLabels.filter(Boolean))];
        if (uniqueLabels.length > 0) upd('aiVisionLabels', uniqueLabels.join(', '));
        if (visionResults.length > 0) {
          upd('aiVisionUsed', true);
          visionContext = visionResults.join('\n---\n');
        }
      }

      // Step 2: Gemini with Vision context (or without if no Vision key)
      setAiLoadingPhase('run1');
      const result = await callWithTimeout(() => callGeminiAI(settings.geminiApiKey, settings.geminiModel, photos, basePrompt(visionContext)), AI_TIMEOUT);
      if (result.error) { switchToManualMode(result.error); return; }
      upd('aiRawResponse', result.text);
      parseGeminiResult(result.text);

      // Step 3: ALWAYS verify model via Google Search grounding
      // Gemini can be 98% confident but still hallucinate the model number.
      // This step searches the internet to confirm the model exists and corrects it if needed.
      setAiLoadingPhase('run1_verify');
      const identBrand = aiParseField(result.text, 'BRAND');
      const identModel = aiParseField(result.text, 'MODEL');
      const identItemType = aiParseField(result.text, 'AI_ITEM_TYPE');
      const identKeySpecs = aiParseField(result.text, 'KEY_SPECS');

      const verifyPrompt = `You are verifying a product identification for a second-hand shop in Nigeria.

The AI identified this item from photos:
- Item type: ${identItemType}
- Brand: ${identBrand}
- Model: ${identModel}
- Key specs: ${identKeySpecs}
${visionContext ? `\nImage analysis context:\n${visionContext}\n` : ''}
YOUR TASK: Search the internet for "${identBrand} ${identModel}" and verify ALL of these:
1. Does "${identBrand} ${identModel}" exist as a real product?
2. Is it a ${identItemType}? (Not a different type of product from the same brand)
3. Do the specs match? (${identKeySpecs})

If ALL 3 checks pass: confirm the identification and return the same details.
If ANY check fails (model doesn't exist, OR it exists but is a different product type, OR the specs don't match): search for the correct ${identBrand} ${identItemType} model that matches these specs: ${identKeySpecs}. Look at product databases, review sites, and retailer listings. Compare search results with the photos.

CRITICAL: The model name/number must be a REAL product that exists AND must match the item type and specs. Do not guess or make up model numbers.

Reply in this exact format (no markdown, no extra text):

AI_ITEM_TYPE: ${identItemType}
BRAND: [confirmed or corrected brand]
MODEL: [the VERIFIED real model name/number]
KEY_SPECS: [confirmed or corrected specs — under 12 words]
COLOUR: [colour]
CONFIDENCE: [your confidence now, as percentage]
MODEL_VERIFIED: [YES if you confirmed it exists with matching type and specs, CORRECTED if you found a different model, UNVERIFIED if you could not confirm]`;

      const geminiCheck2 = checkGeminiLimit(settings);
      if (!geminiCheck2.blocked) {
        const result2 = await callWithTimeout(() => callGeminiWithSearch(settings.geminiApiKey, settings.geminiModel, photos, verifyPrompt), AI_TIMEOUT);
        if (!result2.error && result2.text) {
          const verifyStatus = aiParseField(result2.text, 'MODEL_VERIFIED');
          if (verifyStatus) {
            upd('aiRawResponse', result2.text);
            parseGeminiResult(result2.text);
            upd('aiModelVerified', verifyStatus);
          }
        }
      }

      upd('aiRun1Done', true);
    } catch (e) {
      switchToManualMode(e.message);
      return;
    }
    setAiLoading(false); setAiLoadingPhase('');
  };

  // RUN 2: Condition Description
  const handleAIRun2 = async () => {
    setAiLoading(true); setAiLoadingPhase('run2'); setAiError('');
    const geminiCheck = checkGeminiLimit(settings);
    if (geminiCheck.blocked) { setAiError(geminiCheck.reason); setAiLoading(false); setAiLoadingPhase(''); return; }
    const photos = getPhotos();
    // Build inspection results text
    const checklist = INSPECTION_CHECKLISTS[tx.captureItemType] || [];
    const checkedMap = tx.inspectionChecklist || {};
    const inspResults = checklist.map(item => `${checkedMap[item] ? '✅' : '❌'} ${item}`).join('\n');
    const staffNotes = (tx.inspectionNotes || '').trim() || 'None';
    const prompt = `You are a second-hand shop assistant in Aguleri, Anambra Nigeria. Look at all the photos of this ${tx.aiItemType || tx.captureItemType} — ${tx.aiBrand || 'Unknown brand'} — ${tx.aiModel || 'Unknown model'}.
Also read the inspection checklist results and staff notes below.

Write a condition description in TWO parts joined into one flowing paragraph:

PART A (from photos — write this FIRST, about 240 characters):
Describe what you can SEE in the photos — scratches, dents, cracks, screen condition, body wear, missing parts, colour fading, stains, bent edges, etc. Only mention issues that affect how much we can sell it for.

PART B (from inspection & staff notes — write this SECOND, about 160 characters):
Summarize the key findings from the checklist and notes — which checks failed, what the staff noticed during hands-on testing, any functional issues.

Rules:
- Combine both parts into ONE paragraph, no line breaks, no bullet points
- Maximum 400 characters total
- Use simple everyday English — no big grammar words
- Do not repeat yourself
- Focus only on things that affect resale price

Inspection results:
${inspResults}

Staff notes: ${staffNotes}

Reply with the condition description only. Nothing else.`;
    try {
      const result = await callWithTimeout(() => callGeminiAI(settings.geminiApiKey, settings.geminiModel, photos, prompt), AI_TIMEOUT);
      if (result.error) { switchToManualMode(result.error); return; }
      // Post-process: sanitize newlines, collapse spaces, enforce 400 char limit
      let text = (result.text || '').trim().replace(/[\n\r]+/g, ' ').replace(/\s{2,}/g, ' ');
      if (text.length > 400) text = text.substring(0, 397) + '...';
      upd('aiRawResponse2', result.text);
      upd('aiCondition', text);
      upd('conditionDescription', text);
      upd('aiRun2Done', true);
    } catch (e) {
      switchToManualMode(e.message);
      return;
    }
    setAiLoading(false); setAiLoadingPhase('');
  };

  // RUN 3: Resale Valuation (with Google Search grounding)
  const handleAIRun3 = async () => {
    setAiLoading(true); setAiLoadingPhase('run3'); setAiError('');
    const geminiCheck = checkGeminiLimit(settings);
    if (geminiCheck.blocked) { setAiError(geminiCheck.reason); setAiLoading(false); setAiLoadingPhase(''); return; }
    const photos = getPhotos();
    const conditionText = tx.conditionDescription || tx.aiCondition || '';
    const prompt = `You are a pricing expert helping a second-hand item shop in Aguleri, Anambra State, Nigeria. We need to know the fair resale price of this item so we can sell it within 14 days.

CRITICAL: All prices MUST be in Nigerian Naira (NGN). Do not use dollars, pounds, or any other currency. If you find prices in other currencies, convert them to Naira at the current exchange rate.

Item details:
* Type: ${tx.aiItemType || tx.captureItemType || 'Unknown'}
* Brand and model: ${tx.aiBrand || 'Unknown'} ${tx.aiModel || 'Unknown'}
* Colour: ${tx.aiColour || 'Unknown'}
* Specs: ${tx.aiKeySpecs || 'Not available'}
* Condition: ${conditionText || '(assess from the photos)'}

Instructions:
1. Search Jumia.com.ng and Konga.com or similar Nigerian online stores for the BRAND NEW retail price of this exact model in Nigeria TODAY. (If this is a generic/unbranded Chinese item, search for equivalent items with similar specs).

2. Search the internet for the current selling price of this exact item (used/second-hand) on Jiji.ng, Facebook Marketplace Nigeria, and any similar Nigerian resale platforms. Include listings from Anambra, Onitsha, Awka, Lagos, and other Nigerian cities.

CRITICAL ANTI-SCAM RULE for Jiji.ng prices:
- Sort all listings for this item by price from lowest to highest
- Throw away the cheapest 20% of listings — these are usually scam bait
- From the remaining 80%, find the MEDIAN price (the middle value, not the average)
- Use this median as your base for the used price

3. Use those prices as your base. Then adjust for:
   - The item condition described above${conditionText ? '' : ' (also look at the photos)'}
   - Current supply/demand — if this item is very common in resale markets, price competitively; if rare, price slightly higher
   - Age of the model — older models lose value faster

IMPORTANT PRICING CONTEXT:
- Prices in Aguleri/Anambra State are comparable to Onitsha and Lagos — do NOT discount for location. Aguleri is a trading town near Onitsha Main Market.
- We need to sell this item within 14 days, so price it to move — but do NOT undervalue it. We want the best realistic price a buyer will pay within 2 weeks, not a desperate clearance price.
- Second-hand items in good working condition typically sell for 50-75% of brand new price. Items in fair condition sell for 35-55% of brand new price.
- Do NOT lowball. If the brand new price is ₦50,000 and the item is in good condition, the used price should be around ₦25,000-₦37,500 — not ₦10,000.

4. Give me the realistic price we can sell this item for in Aguleri within 14 days. This should be a fair market price — not inflated, not deflated.

5. Use simple everyday English. No big words.

Reply in this exact format only (no numbered prefixes, no markdown, no extra text):
ESTIMATED_RESALE_VALUE: [number only — no naira sign, no comma]
PRICE_BASIS: [2 to 3 short sentences explaining what brand new prices and used prices you found, and how you calculated your estimate]
NEW_MARKET_PRICE: [number only — the brand new price in Nigeria, or 0 if not found]
PRICE_RANGE: [lowest realistic price — highest realistic price, e.g. 45000-60000]
VALUATION_CONFIDENCE: [your confidence as a percentage, e.g. 85% — higher if you found real price data, lower if you had to estimate]`;
    try {
      const result = await callWithTimeout(() => callGeminiWithSearch(settings.geminiApiKey, settings.geminiModel, photos, prompt), AI_TIMEOUT);
      if (result.error) { switchToManualMode(result.error); return; }
      const text = result.text;
      upd('aiRawResponse3', text);
      const estimatedVal = aiParseField(text, 'ESTIMATED_RESALE_VALUE').replace(/[^0-9]/g, '');
      upd('aiEstimatedValue', estimatedVal);
      upd('estimatedValue', Number(estimatedVal) || 0);
      upd('aiPriceBasis', aiParseField(text, 'PRICE_BASIS'));
      upd('aiNewMarketPrice', aiParseField(text, 'NEW_MARKET_PRICE').replace(/[^0-9]/g, ''));
      // Parse PRICE_RANGE: handles "45000-60000", "₦45,000 to ₦60,000", "45000 – 60000"
      const rangeRaw = aiParseField(text, 'PRICE_RANGE');
      const rangeCleaned = rangeRaw.replace(/[₦NGN,\s]/gi, '');
      const rangeMatch = rangeCleaned.match(/(\d+)\s*(?:[-–—]|to)\s*(\d+)/i);
      if (rangeMatch) {
        const low = Number(rangeMatch[1]);
        const high = Number(rangeMatch[2]);
        upd('aiPriceRangeLow', String(Math.min(low, high)));
        upd('aiPriceRangeHigh', String(Math.max(low, high)));
      }
      upd('aiValuationConfidence', aiParseField(text, 'VALUATION_CONFIDENCE'));

      // Post-parse sanity checks — warning only, staff can still proceed
      const val = Number(estimatedVal) || 0;
      const parsedLow = Number(rangeMatch?.[1]) || 0;
      const parsedHigh = Number(rangeMatch?.[2]) || 0;
      const warnings = [];
      if (val > 0 && (val < 1000 || val > 5000000)) {
        warnings.push(`AI estimated ₦${val.toLocaleString()} — this seems unusual. Please verify manually.`);
      }
      if (parsedLow > 0 && parsedHigh > 0 && parsedHigh > parsedLow * 5) {
        warnings.push('Price range spread is very wide — estimate may be unreliable.');
      }
      if (warnings.length > 0) setAiError('Warning: ' + warnings.join(' '));
      // Clamp estimated value within price range
      if (val > 0 && parsedHigh > 0 && val > parsedHigh) upd('estimatedValue', parsedHigh);
      if (val > 0 && parsedLow > 0 && val < parsedLow) upd('estimatedValue', parsedLow);

      upd('aiRun3Done', true);
    } catch (e) {
      switchToManualMode(e.message);
      return;
    }
    setAiLoading(false); setAiLoadingPhase('');
  };

  const capPct = tx.hasReceipt === true ? (settings.loanCapWithReceipt || 50) : (settings.loanCapNoReceipt || 40);
  const maxAdvance = tx.partsOnly ? (settings.maxPartsOnlyAdvance || MAX_PARTS_ONLY_ADVANCE) : Math.floor((tx.estimatedValue || 0) * capPct / 100);
  const dailyFeeCalc = Math.floor((tx.cashAdvance || 0) * (settings.interestRate || 1) / 100);

  const canProceed = () => {
    switch (WIZARD_STEPS[step]?.id) {
      case 'type': return true;
      case 'nin': return settings.requireNinVerification ? (tx.ninVerified && !!tx.ninPhoto) : tx.ninVerificationAttempted;
      case 'customer': return !!(tx.fullName && tx.address && tx.phoneNumbers[0] && tx.familyName && tx.familyPhone && (tx.phonesVerified[0] || tx.phonesVerified[1]));
      case 'custPhotos': return !!tx.photoCustomerHolding;
      case 'screening': {
        if (!tx.screeningDuration) return false;
        if (tx.screeningDuration === 'Other' && !tx.screeningDurationOther) return false;
        if (!tx.screeningPurchaseLocation) return false;
        if (tx.screeningPurchaseLocation === 'Other' && !tx.screeningPurchaseLocationOther) return false;
        if (!tx.screeningRegistered) return false;
        if (!tx.screeningOthersUsing) return false;
        return true;
      }
      case 'itemPhotos': {
        const requiresImei = IMEI_ITEM_TYPES.includes(tx.captureItemType);
        const photoArr = Array.isArray(tx.itemPhotos) ? tx.itemPhotos : [];
        const photoCount = photoArr.filter(Boolean).length;
        if (!tx.captureItemType) return false;
        if (tx.itemPowersOn !== true && !tx.partsOnly) return false;
        if (photoCount < 3) return false;
        if (requiresImei) {
          const imeiConfidence = parseConfidencePercent(tx.imeiOcrConfidence);
          if (!tx.imei || !tx.imeiModelMatch) return false;
          if (imeiConfidence !== null && imeiConfidence < OCR_CONFIRMATION_THRESHOLD && !tx.imeiManualConfirmed) return false;
        }
        else {
          const serialConfidence = parseConfidencePercent(tx.serialOcrConfidence);
          if (tx.serialNumberPhoto && !tx.serialNumber) return false;
          if (tx.serialNumber && serialConfidence !== null && serialConfidence < OCR_CONFIRMATION_THRESHOLD && !tx.serialManualConfirmed) return false;
        }
        if (tx.hasReceipt === true && !tx.receiptPhoto) return false;
        return true;
      }
      case 'inspection': {
        const checklist = INSPECTION_CHECKLISTS[tx.captureItemType] || [];
        const checkedMap = tx.inspectionChecklist || {};
        const anyUnticked = checklist.some(item => !checkedMap[item]);
        if (anyUnticked && !(tx.inspectionNotes || '').trim()) return false;
        return true;
      }
      case 'aiValuation': return tx.partsOnly || !!(tx.aiItemType && tx.aiBrand && tx.estimatedValue > 0 && (tx.conditionDescription || tx.aiCondition));
      case 'offer': return tx.cashAdvance > 0 && tx.dateGiven;
      case 'agreement': return !!tx.photoSigning;
      default: return true;
    }
  };

  const blockReasons = () => {
    const issues = [];
    switch (WIZARD_STEPS[step]?.id) {
      case 'nin':
        if (settings.requireNinVerification) {
          if (!tx.ninVerified) issues.push('NIN/BVN must be successfully verified via API before proceeding.');
          else if (!tx.ninPhoto) issues.push('NIN/BVN verification must include a retrieved photo before proceeding.');
        } else {
          if (!tx.ninVerificationAttempted) issues.push('You must attempt NIN/BVN verification before proceeding.');
        }
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
      case 'screening':
        if (tx.screeningPurchaseLocation === 'Other' && !tx.screeningPurchaseLocationOther) issues.push('Please specify where the item was purchased (you selected "Other").');
        break;
      case 'itemPhotos': {
        const requiresImei = IMEI_ITEM_TYPES.includes(tx.captureItemType);
        const photoArr = Array.isArray(tx.itemPhotos) ? tx.itemPhotos : [];
        const photoCount = photoArr.filter(Boolean).length;
        if (!tx.captureItemType) {
          issues.push('You must select the item type before proceeding.');
        } else if (tx.itemPowersOn !== true && !tx.partsOnly) {
          issues.push('You must confirm whether this item powers on before proceeding.');
        } else {
          if (photoCount < 3) issues.push(`At least 3 item photos are required. You have uploaded ${photoCount} so far.`);
          if (requiresImei) {
            const imeiConfidence = parseConfidencePercent(tx.imeiOcrConfidence);
            if (!tx.imei) issues.push('IMEI number is required. Upload a photo of the *#06# screen and extract with AI.');
            if (tx.imei && imeiConfidence !== null && imeiConfidence < OCR_CONFIRMATION_THRESHOLD && !tx.imeiManualConfirmed) issues.push(`OCR confidence for the IMEI is below ${OCR_CONFIRMATION_THRESHOLD}%. A staff member must manually confirm every digit before proceeding.`);
            if (tx.imei && !tx.imeiModelMatch) issues.push('You must confirm the brand and model on imei.info match the device before proceeding.');
          } else {
            const serialConfidence = parseConfidencePercent(tx.serialOcrConfidence);
            if (tx.serialNumberPhoto && !tx.serialNumber) issues.push('You uploaded a serial number photo — please extract or enter the serial number before proceeding.');
            if (tx.serialNumber && serialConfidence !== null && serialConfidence < OCR_CONFIRMATION_THRESHOLD && !tx.serialManualConfirmed) issues.push(`OCR confidence for the serial number is below ${OCR_CONFIRMATION_THRESHOLD}%. Staff must manually confirm it before proceeding.`);
          }
          if (tx.hasReceipt === true && !tx.receiptPhoto) issues.push('Receipt photo is required — you indicated a receipt was provided.');
        }
        break;
      }
      case 'inspection': {
        const checklist = INSPECTION_CHECKLISTS[tx.captureItemType] || [];
        const checkedMap = tx.inspectionChecklist || {};
        const anyUnticked = checklist.some(item => !checkedMap[item]);
        if (anyUnticked && !(tx.inspectionNotes || '').trim()) {
          issues.push('One or more checklist items are unticked. You must write a reason in the Staff Notes field before proceeding.');
        }
        break;
      }
      case 'aiValuation':
        if (!tx.partsOnly) {
          if (!tx.aiItemType) issues.push('Item type is required. Run AI identification or enter it manually.');
          if (!tx.aiBrand) issues.push('Brand is required. Run AI identification or enter it manually.');
          if (!tx.estimatedValue || tx.estimatedValue <= 0) issues.push('Estimated resale value is required. Run AI valuation or enter it manually.');
          if (!(tx.conditionDescription || tx.aiCondition)) issues.push('Condition description is required. Run AI condition check or enter it manually.');
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

  const handleEndTransaction = async () => {
    const declinedTx = { ...tx, status: 'declined', declineReason: 'Declined - Item does not power on (no parts-only agreement)', wizardStep: null, completedBy: currentUser?.name || '', completedAt: new Date().toISOString() };
    // Open the decline log modal first — saving happens only when user confirms
    setWizDeclineModal({
      date: localISODate(),
      ref: tx.ref,
      customerName: tx.fullName || '',
      ninBvn: tx.idNumber ? `${tx.idType?.toUpperCase() || 'ID'}: ${tx.idNumber}` : '',
      item: tx.captureItemType || 'Unknown item',
      reason: 'Item does not power on',
      notes: '',
      declinedTx,
      onAfter: onCancel,
    });
  };

  const handlePartsOnlyJump = () => {
    // Jump directly to the Offer step (skipping AI Valuation)
    const offerIdx = WIZARD_STEPS.findIndex(s => s.id === 'offer');
    if (offerIdx !== -1) { saveDraftNow(offerIdx); setStep(offerIdx); }
  };

  // Generic decline handler — called from any wizard step with a pre-selected reason.
  // Opens the decline log modal; saving the transaction + log entry happens only when the user confirms.
  const handleDeclineFromStep = async (reason) => {
    const declinedTx = { ...tx, status: 'declined', declineReason: `Declined - ${reason}`, wizardStep: null, completedBy: currentUser?.name || '', completedAt: new Date().toISOString() };
    setWizDeclineModal({
      date: localISODate(),
      ref: tx.ref,
      customerName: tx.fullName || '',
      ninBvn: tx.idNumber ? `${tx.idType?.toUpperCase() || 'ID'}: ${tx.idNumber}` : '',
      item: tx.aiItemType ? `${tx.aiItemType} ${tx.aiBrand || ''} ${tx.aiModel || ''}`.trim() : (tx.captureItemType || ''),
      reason,
      notes: '',
      declinedTx,
      onAfter: onCancel,
    });
  };

  const handleComplete = async () => {
    const finalTx = { ...tx, status: tx.type === 'outright' ? 'for_sale' : 'active', wizardStep: null, completedBy: currentUser?.name || '', completedAt: new Date().toISOString(), serviceFeeAmount: tx.type === 'advance' && tx.serviceFeeCollected ? (settings.serviceFee || 1000) : 0 };
    const saved = await API.post('transactions', finalTx);
    if (!saved?.success) return;
    await API.del(`drafts/${encodeURIComponent(tx.ref)}`);
    onSave(finalTx);
  };

  const handleRedFlagExit = async () => {
    const flaggedTx = { ...tx, status: 'declined', screeningRedFlag: true, declineReason: 'Declined - Flagged', wizardStep: null, completedBy: currentUser?.name || '', completedAt: new Date().toISOString() };
    // Open the decline log modal first — saving happens only when user confirms
    setWizDeclineModal({
      date: localISODate(),
      ref: tx.ref,
      customerName: tx.fullName || '',
      ninBvn: tx.idNumber ? `${tx.idType?.toUpperCase() || 'ID'}: ${tx.idNumber}` : '',
      item: tx.aiItemType ? `${tx.aiItemType} ${tx.aiBrand || ''} ${tx.aiModel || ''}`.trim() : (tx.captureItemType || 'Item (screening stage)'),
      reason: 'Flagged by staff during screening',
      notes: '',
      declinedTx: flaggedTx,
      onAfter: () => setRedFlagModal(true),
    });
  };

  // Step renderer (abbreviated — same UI as before)
  const renderStep = () => {
    const sid = WIZARD_STEPS[step]?.id;
    switch (sid) {
      case 'type': return (<div><h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '16px' }}>What type of transaction?</h3><div style={S.alert('info')}>📋 Select the transaction type before proceeding. If unsure, choose <strong>Cash Advance</strong>.</div><div style={{ display: 'flex', gap: '16px' }}>{[{ value: 'advance', label: 'Cash Advance', desc: 'Customer leaves item as collateral', icon: '🤝' }, { value: 'outright', label: 'Outright Purchase', desc: 'Customer sells the item immediately', icon: '🛒' }].map(o => (<div key={o.value} onClick={() => upd('type', o.value)} style={{ flex: 1, padding: '20px', borderRadius: '12px', cursor: 'pointer', textAlign: 'center', border: `2px solid ${tx.type === o.value ? COLORS.primary : COLORS.border}`, background: tx.type === o.value ? COLORS.primaryLight : '#fff' }}><div style={{ fontSize: '32px', marginBottom: '8px' }}>{o.icon}</div><div style={{ fontWeight: 700 }}>{o.label}</div><div style={{ fontSize: '12px', color: COLORS.textMuted }}>{o.desc}</div></div>))}</div><div style={{ marginTop: '16px', padding: '12px', background: COLORS.bg, borderRadius: '8px', fontSize: '12px', color: COLORS.textMuted }}><strong>Ref:</strong> {tx.ref}</div></div>);

      case 'nin': {
        const lowThreshold = Number(settings.ninLowCreditThreshold) || 5;
        const creditsLow = ninCredits !== null && ninCredits <= lowThreshold;
        const creditsOut = ninCredits !== null && ninCredits === 0;
        return (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px', flexWrap: 'wrap', gap: '8px' }}>
              <h3 style={{ fontSize: '16px', fontWeight: 700, margin: 0 }}>🪪 Identity Verification</h3>
              {settings.ninApiKey && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 12px', borderRadius: '20px', background: creditsOut ? COLORS.dangerLight : creditsLow ? COLORS.warningLight : COLORS.primaryLight, border: `1px solid ${creditsOut ? '#f5c6cb' : creditsLow ? '#fde2b3' : '#b7e4c7'}`, fontSize: '12px', fontWeight: 600, color: creditsOut ? COLORS.danger : creditsLow ? COLORS.warning : COLORS.primaryDark }}>
                  {ninCreditsLoading ? (
                    <span>⏳ Checking credits…</span>
                  ) : ninCredits === null ? (
                    <span>🔑 Credits for New Verification: —</span>
                  ) : (
                    <span>{creditsOut ? '🚫' : creditsLow ? '⚠️' : '✅'} Credits for New Verification: <strong>{ninCredits}</strong></span>
                  )}
                  <button
                    onClick={() => setShowRechargeModal(true)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: creditsOut ? COLORS.danger : creditsLow ? COLORS.warning : COLORS.primary, fontWeight: 700, fontSize: '11px', textDecoration: 'underline', padding: 0, lineHeight: 1 }}
                    title="Learn how to top up verification credits"
                  >
                    Recharge
                  </button>
                </div>
              )}
            </div>
            {creditsOut && <div style={{ ...S.alert('danger'), marginBottom: '12px' }}>🚫 <strong>No verification credits remaining.</strong> New NIN/BVN lookups will fail. Tap <strong>Recharge</strong> above to top up the wallet. Customers already in the system can still be verified at no cost.</div>}
            {creditsLow && !creditsOut && <div style={{ ...S.alert('warning'), marginBottom: '12px' }}>⚠️ <strong>Only {ninCredits} credit{ninCredits !== 1 ? 's' : ''} remaining.</strong> Consider recharging soon to avoid interruption. Tap <strong>Recharge</strong> above for payment details.</div>}
            <div style={S.alert('info')}>📋 Dial <strong>*346#</strong> on the customer's phone to get their NIN. Type it in and click Verify. If NIN fails, switch to BVN as a backup.</div>
            <div style={S.grid2}>
              <Field label={<span style={{ display: 'inline-flex', alignItems: 'center' }}>ID Type<InfoIcon tip="NIN is the first choice — the customer dials *346# on their own phone to get it. BVN (from their bank) is a backup, but it won't give us their home address." /></span>} required>
                <select style={S.select} value={tx.idType} onChange={e => { upd('idType', e.target.value); setNinSuggestions([]); setShowNinSuggestions(false); }}>
                  <option value="nin">NIN</option>
                  <option value="bvn">BVN</option>
                </select>
              </Field>
              <Field label={<span style={{ display: 'inline-flex', alignItems: 'center' }}>{tx.idType.toUpperCase()} Number<InfoIcon tip={`The customer's ${tx.idType === 'nin' ? '11-digit ID number from the government. They find it by dialling *346# on their own phone.' : '11-digit number tied to their bank account. Use this if the NIN check fails.'}`} /></span>} required>
                <div style={{ position: 'relative' }}>
                  <input
                    style={S.input}
                    inputMode="numeric"
                    value={tx.idNumber}
                    autoComplete="off"
                    onChange={e => {
                      const val = e.target.value.replace(/\D/g, '');
                      upd('idNumber', val);
                      clearTimeout(ninSuggestTimerRef.current);
                      if (val.length >= 2) {
                        ninSuggestTimerRef.current = setTimeout(async () => {
                          const data = await API.get(`nin-suggestions?prefix=${encodeURIComponent(val)}&type=${tx.idType}`);
                          if (data?.suggestions?.length > 0) {
                            setNinSuggestions(data.suggestions);
                            setShowNinSuggestions(true);
                          } else {
                            setNinSuggestions([]);
                            setShowNinSuggestions(false);
                          }
                        }, 250);
                      } else {
                        setNinSuggestions([]);
                        setShowNinSuggestions(false);
                      }
                    }}
                    onBlur={() => setTimeout(() => setShowNinSuggestions(false), 150 /* allow onMouseDown on suggestions to fire before blur hides the list */)}
                    onFocus={() => { if (ninSuggestions.length > 0) setShowNinSuggestions(true); }}
                    placeholder="Enter 11-digit number"
                  />
                  {showNinSuggestions && ninSuggestions.length > 0 && (
                    <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 100, background: '#fff', border: `1px solid ${COLORS.border}`, borderRadius: '8px', boxShadow: '0 4px 12px rgba(0,0,0,0.12)', marginTop: '2px', overflow: 'hidden' }}>
                      {ninSuggestions.map(s => (
                        <div
                          key={s.number}
                          onMouseDown={e => { e.preventDefault(); upd('idNumber', s.number); setShowNinSuggestions(false); setNinSuggestions([]); }}
                          style={{ padding: '10px 14px', cursor: 'pointer', borderBottom: `1px solid ${COLORS.border}` }}
                          onMouseEnter={e => { e.currentTarget.style.background = COLORS.primaryLight; }}
                          onMouseLeave={e => { e.currentTarget.style.background = '#fff'; }}
                        >
                          <span style={{ fontFamily: 'monospace', fontSize: '14px', color: COLORS.text }}>{s.number}</span>
                          {s.name && <span style={{ marginLeft: '10px', fontSize: '13px', color: COLORS.textMuted }}>{s.name}</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </Field>
            </div>
            {tx.idType === 'bvn' && <div style={S.alert('warning')}>⚠ BVN does not return home address. You will need to ask the customer manually.</div>}
            <button style={S.btn('primary')} onClick={handleVerify} disabled={ninLoading || !tx.idNumber}>{ninLoading ? '⏳ Verifying...' : `Verify ${tx.idType.toUpperCase()}`}</button>
            {!ninLoading && ninError && <div style={{ ...S.alert('warning'), marginTop: '12px' }}>⚠ {ninError}</div>}
            {tx.ninVerificationAttempted && !ninLoading && (
              <div style={{ marginTop: '16px', padding: '16px', background: tx.ninVerified ? COLORS.primaryLight : COLORS.warningLight, borderRadius: '12px', border: `1px solid ${tx.ninVerified ? '#b7e4c7' : '#fde2b3'}` }}>
                <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start' }}>
                  {tx.ninPhoto && <img src={tx.ninPhoto} style={{ width: '100px', height: '120px', objectFit: 'cover', borderRadius: '8px', border: '2px solid ' + (tx.ninVerified ? COLORS.primary : COLORS.warning) }} alt="NIN/BVN Photo" />}
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '15px', fontWeight: 700, color: tx.ninVerified ? COLORS.primary : COLORS.warning, marginBottom: '4px' }}>{tx.ninVerified ? `✅ ${tx.idType.toUpperCase()} Verified` : `⚠ ${tx.idType.toUpperCase()} API unavailable — Demo Placeholder Data`}</div>
                    <div style={{ fontSize: '14px' }}><strong>Name:</strong> {tx.fullName || 'Not available'}</div>
                    <div style={{ fontSize: '14px' }}><strong>Address:</strong> {tx.address || 'Not available'}</div>
                    {tx.ninVerified && tx.ninSource === 'cache' && <div style={{ fontSize: '12px', color: COLORS.textMuted, marginTop: '6px' }}>💡 This record was retrieved from our local database — no credit was spent.</div>}
                    {tx.ninVerified && tx.ninSource === 'api' && ninCredits !== null && <div style={{ fontSize: '12px', color: COLORS.textMuted, marginTop: '6px' }}>💡 This lookup used 1 credit from your wallet ({Math.max(0, ninCredits - 1)} estimated remaining after this).</div>}
                    {tx.ninPhoto && <div style={{ marginTop: '8px', padding: '8px', background: '#fff', borderRadius: '6px', fontSize: '12px', color: COLORS.warning, fontWeight: 600 }}>👁 Compare this photo with the customer standing in front of you</div>}
                  </div>
                </div>
              </div>
            )}
            <div style={{ marginTop: '16px', paddingTop: '12px', borderTop: `1px solid ${COLORS.border}` }}>
              <div style={{ fontSize: '12px', fontWeight: 600, color: COLORS.textMuted, marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>End transaction</div>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <button style={S.btnSm('muted')} onClick={() => handleDeclineFromStep('NIN photo did not match')}>NIN photo did not match</button>
                <button style={S.btnSm('muted')} onClick={() => handleDeclineFromStep('Customer could not provide valid ID')}>Customer could not provide valid ID</button>
              </div>
            </div>
          </div>
        );
      }

      case 'customer': return (<div><h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '16px' }}>👤 Customer Details</h3><div style={S.grid2}><Field label="Full Name" required><input style={S.input} value={tx.fullName} onChange={e => upd('fullName', e.target.value)} placeholder="e.g. David Ejimofor Chukwuemeka" /></Field><Field label="Address" required><input style={S.input} value={tx.address} onChange={e => upd('address', e.target.value)} placeholder="e.g. No. 5 Market Road, Aguleri" /></Field></div><div style={S.alert('info')}>📋 Ask the customer to call out all their phone numbers. <strong>Call at least Phone 1 immediately</strong> — the phone must ring in front of you — then click <strong>Mark Called</strong>. You cannot proceed until this is done.</div><div style={S.grid2}><Field label="Phone 1" required><div style={{ display: 'flex', gap: '8px' }}><input style={{ ...S.input, flex: 1 }} inputMode="numeric" value={tx.phoneNumbers[0]} onChange={e => { const n = [...tx.phoneNumbers]; n[0] = e.target.value.replace(/\D/g, ''); upd('phoneNumbers', n); }} placeholder="e.g. 08012345678" /><button style={{ ...S.btnSm('primary'), background: tx.phonesVerified[0] ? '#10b981' : '#6b7280', transition: 'background 0.2s' }} onClick={() => { const v = [...tx.phonesVerified]; v[0] = !v[0]; upd('phonesVerified', v); }}>{tx.phonesVerified[0] ? '✓ Called' : 'Mark Called'}</button></div></Field><Field label="Phone 2 (optional)"><div style={{ display: 'flex', gap: '8px' }}><input style={{ ...S.input, flex: 1 }} inputMode="numeric" value={tx.phoneNumbers[1]} onChange={e => { const val = e.target.value.replace(/\D/g, ''); const n = [...tx.phoneNumbers]; n[1] = val; upd('phoneNumbers', n); if (!val) { const v = [...tx.phonesVerified]; v[1] = false; upd('phonesVerified', v); } }} placeholder="e.g. 09098765432" /><button style={{ ...S.btnSm('primary'), background: tx.phonesVerified[1] ? '#10b981' : '#6b7280', transition: 'background 0.2s', opacity: tx.phoneNumbers[1] ? 1 : 0.4, cursor: tx.phoneNumbers[1] ? 'pointer' : 'not-allowed' }} disabled={!tx.phoneNumbers[1]} onClick={() => { const v = [...tx.phonesVerified]; v[1] = !v[1]; upd('phonesVerified', v); }}>{tx.phonesVerified[1] ? '✓ Called' : 'Mark Called'}</button></div></Field></div><div style={{ ...S.card, background: COLORS.bg, padding: '16px', marginTop: '4px' }}><div style={{ fontSize: '13px', fontWeight: 700, marginBottom: '6px' }}>Family / Neighbour Contact</div><div style={{ fontSize: '12px', color: COLORS.textMuted, marginBottom: '10px' }}>📋 Ask for a family member or neighbour — must be a <strong>different person</strong> from the customer.</div><div style={S.grid3}><Field label="Name" required><input style={S.input} value={tx.familyName} onChange={e => upd('familyName', e.target.value)} placeholder="e.g. Emma Okonkwo" /></Field><Field label="Phone" required><input style={S.input} inputMode="numeric" value={tx.familyPhone} onChange={e => upd('familyPhone', e.target.value.replace(/\D/g, ''))} placeholder="e.g. 08099887766" /></Field><Field label="Relationship"><input style={S.input} value={tx.familyRelation} onChange={e => upd('familyRelation', e.target.value)} placeholder="e.g. Sister" /></Field></div></div></div>);
      
      case 'custPhotos': return (<div><h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '16px' }}>📸 Customer Photos</h3><div style={S.alert('info')}>📋 Take a photo of the customer <strong>holding the item</strong> — both the customer's face and the item must be clearly visible in one photo. <strong>This is mandatory.</strong></div><div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap' }}><PhotoUpload label="Customer Holding Item" value={tx.photoCustomerHolding} onChange={v => upd('photoCustomerHolding', v)} required size={160} /><PhotoUpload label="Customer with ID (Optional)" value={tx.photoCustomerID} onChange={v => upd('photoCustomerID', v)} size={160} /></div><div style={{ marginTop: '16px', paddingTop: '12px', borderTop: `1px solid ${COLORS.border}` }}><div style={{ fontSize: '12px', fontWeight: 600, color: COLORS.textMuted, marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>End transaction</div><div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}><button style={S.btnSm('muted')} onClick={() => handleDeclineFromStep('Customer refused photos or terms')}>Customer refused photos or terms</button></div></div></div>);

      case 'itemPhotos': return (
        <CaptureStep
          tx={tx}
          upd={upd}
          settings={settings}
          onJumpToOffer={handlePartsOnlyJump}
          onEndTransaction={handleEndTransaction}
          onDecline={handleDeclineFromStep}
        />
      );

      case 'inspection': return (<InspectionStep tx={tx} upd={upd} />);

      case 'aiValuation': return (<div>
        <h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '16px' }}>🧠 AI Analysis Engine</h3>

        {tx.partsOnly ? (
          <div style={S.alert('warning')}>⚠️ This is a <strong>Parts Only</strong> transaction. The item does not power on. The maximum offer is ₦5,000. Skip to the Offer step to set the amount.</div>
        ) : (<>
          {/* Manual mode warning */}
          {tx.aiManualMode && (
            <div style={{ ...S.alert('danger'), marginBottom: '16px', border: '2px solid ' + COLORS.danger }}>
              ⚠️ <strong>AI failed or timed out.</strong> Please enter all item details manually. You can retry any AI step using the buttons below.
            </div>
          )}

          <div style={S.alert('info')}>📋 Run each AI step in order. Wait for each result before proceeding to the next. You can edit any field after each step.</div>
          {/* API Usage Indicator */}
          <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', fontSize: '11px', color: COLORS.textMuted, marginTop: '8px' }}>
            <span>Gemini: {getGeminiUsageToday()}/{settings.geminiDailyLimit || 100} today</span>
            {settings.cloudVisionApiKey && <span>Vision: {getVisionUsageThisMonth()}/{settings.visionMonthlyLimit || 1000} this month</span>}
          </div>

          {/* ══════════════ RUN 1: Item Identification ══════════════ */}
          <div style={{ border: `2px solid ${tx.aiRun1Done ? COLORS.primary : COLORS.border}`, borderRadius: '12px', padding: '16px', marginTop: '16px', background: tx.aiRun1Done ? COLORS.primaryLight : '#fff' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
              <span style={{ fontSize: '20px' }}>{tx.aiRun1Done ? '✅' : '1️⃣'}</span>
              <span style={{ fontWeight: 700, fontSize: '14px' }}>Item Identification & Spec Verification</span>
              {tx.aiConfidence && <span style={{ marginLeft: 'auto', fontSize: '12px', fontWeight: 700, padding: '2px 8px', borderRadius: '12px', background: parseInt(tx.aiConfidence) >= 80 ? '#dcfce7' : parseInt(tx.aiConfidence) >= 50 ? '#fef3c7' : '#fde8e6', color: parseInt(tx.aiConfidence) >= 80 ? '#166534' : parseInt(tx.aiConfidence) >= 50 ? '#92400e' : COLORS.danger }}>Confidence: {tx.aiConfidence}</span>}
              {tx.aiModelVerified && <span style={{ fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: '12px', marginLeft: '4px', background: tx.aiModelVerified === 'YES' ? '#dcfce7' : tx.aiModelVerified === 'CORRECTED' ? '#fef3c7' : '#fde8e6', color: tx.aiModelVerified === 'YES' ? '#166534' : tx.aiModelVerified === 'CORRECTED' ? '#92400e' : COLORS.danger }}>{tx.aiModelVerified === 'YES' ? '✓ Model verified' : tx.aiModelVerified === 'CORRECTED' ? '⚠ Model corrected' : '? Unverified'}</span>}
            </div>
            <button style={S.btn('primary')} onClick={handleAIRun1} disabled={aiLoading}>
              {aiLoading && aiLoadingPhase === 'run1' ? '⏳ Identifying Item...' :
               aiLoading && aiLoadingPhase === 'run1_vision' ? '⏳ Running reverse image search...' :
               aiLoading && aiLoadingPhase === 'run1_verify' ? '⏳ Verifying model online...' :
               tx.aiRun1Done ? '🔄 Re-run Identification' : '🤖 Identify Item with AI'}
            </button>
            {aiError && !aiLoading && !tx.aiRun1Done && <div style={{ ...S.alert('danger'), marginTop: '8px' }}>{aiError}</div>}
            {tx.aiSpecsUnreadable && <div style={{ ...S.alert('warning'), marginTop: '8px' }}>⚠️ <strong>Specs unreadable:</strong> {tx.aiSpecsUnreadable}</div>}
            {tx.aiVisionUsed && <div style={{ ...S.alert('info'), marginTop: '8px' }}>🔍 <strong>Cloud Vision used</strong> — reverse image search helped refine identification.{tx.aiVisionLabels && <span style={{ display: 'block', fontSize: '11px', marginTop: '4px', color: COLORS.textMuted }}>Detected: {tx.aiVisionLabels}</span>}</div>}

            {/* Editable fields — always visible */}
            <div style={{ ...S.grid2, marginTop: '12px' }}>
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
            <Field label="Key Specs">
              <input style={S.input} value={tx.aiKeySpecs} onChange={e => upd('aiKeySpecs', e.target.value)} placeholder="e.g. 128GB, 6GB RAM, 6.6-inch display" />
            </Field>
            {tx.aiRawResponse && <details style={{ marginTop: '8px' }}><summary style={{ fontSize: '11px', color: COLORS.textMuted, cursor: 'pointer' }}>View raw AI response</summary><div style={{ padding: '8px', background: COLORS.bg, borderRadius: '6px', fontSize: '11px', color: COLORS.textMuted, whiteSpace: 'pre-wrap', maxHeight: '100px', overflow: 'auto', marginTop: '4px' }}>{tx.aiRawResponse}</div></details>}
          </div>

          {/* ══════════════ RUN 2: Condition Description ══════════════ */}
          <div style={{ border: `2px solid ${tx.aiRun2Done ? COLORS.primary : COLORS.border}`, borderRadius: '12px', padding: '16px', marginTop: '16px', background: tx.aiRun2Done ? COLORS.primaryLight : '#fff', opacity: (!tx.aiRun1Done && !tx.aiManualMode) ? 0.5 : 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
              <span style={{ fontSize: '20px' }}>{tx.aiRun2Done ? '✅' : '2️⃣'}</span>
              <span style={{ fontWeight: 700, fontSize: '14px' }}>Condition Description</span>
            </div>
            <button style={S.btn('primary')} onClick={handleAIRun2} disabled={aiLoading || (!tx.aiRun1Done && !tx.aiManualMode && !tx.aiItemType)}>
              {aiLoading && aiLoadingPhase === 'run2' ? '⏳ Generating Description...' : tx.aiRun2Done ? '🔄 Re-generate Description' : '📝 Generate Condition Description'}
            </button>
            {aiError && !aiLoading && tx.aiRun1Done && !tx.aiRun2Done && <div style={{ ...S.alert('danger'), marginTop: '8px' }}>{aiError}</div>}

            <Field label={<span style={{ display: 'inline-flex', alignItems: 'center' }}>Condition Description<InfoIcon tip="Write what the item looks like right now — scratches, cracks, dents, anything missing, etc. This goes on the agreement form and protects us if the customer later claims we damaged it." /></span>} required>
              <textarea style={{ ...S.textarea, minHeight: '80px' }} value={tx.conditionDescription || tx.aiCondition} onChange={e => upd('conditionDescription', e.target.value)} placeholder="AI-generated condition + your own observations" maxLength={400} />
              {(tx.conditionDescription || tx.aiCondition) && <div style={{ fontSize: '11px', color: COLORS.textMuted, textAlign: 'right', marginTop: '2px' }}>{(tx.conditionDescription || tx.aiCondition).length}/400 characters</div>}
            </Field>
            {tx.aiRawResponse2 && <details style={{ marginTop: '4px' }}><summary style={{ fontSize: '11px', color: COLORS.textMuted, cursor: 'pointer' }}>View raw AI response</summary><div style={{ padding: '8px', background: COLORS.bg, borderRadius: '6px', fontSize: '11px', color: COLORS.textMuted, whiteSpace: 'pre-wrap', maxHeight: '100px', overflow: 'auto', marginTop: '4px' }}>{tx.aiRawResponse2}</div></details>}
          </div>

          {/* ══════════════ RUN 3: Resale Valuation ══════════════ */}
          <div style={{ border: `2px solid ${tx.aiRun3Done ? COLORS.primary : COLORS.border}`, borderRadius: '12px', padding: '16px', marginTop: '16px', background: tx.aiRun3Done ? COLORS.primaryLight : '#fff', opacity: (!tx.aiRun2Done && !tx.aiManualMode) ? 0.5 : 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
              <span style={{ fontSize: '20px' }}>{tx.aiRun3Done ? '✅' : '3️⃣'}</span>
              <span style={{ fontWeight: 700, fontSize: '14px' }}>Resale Valuation</span>
              {tx.aiValuationConfidence && <span style={{ marginLeft: 'auto', fontSize: '12px', fontWeight: 700, padding: '2px 8px', borderRadius: '12px', background: parseInt(tx.aiValuationConfidence) >= 80 ? '#dcfce7' : parseInt(tx.aiValuationConfidence) >= 50 ? '#fef3c7' : '#fde8e6', color: parseInt(tx.aiValuationConfidence) >= 80 ? '#166534' : parseInt(tx.aiValuationConfidence) >= 50 ? '#92400e' : COLORS.danger }}>Confidence: {tx.aiValuationConfidence}</span>}
              {tx.aiRun3Done && !tx.aiValuationConfidence && <span style={{ marginLeft: 'auto', fontSize: '11px', color: COLORS.textMuted }}>Powered by Google Search</span>}
            </div>
            <button style={{ ...S.btn('primary'), background: '#e67e22' }} onClick={handleAIRun3} disabled={aiLoading || (!tx.aiRun2Done && !tx.aiManualMode && !tx.aiItemType)}>
              {aiLoading && aiLoadingPhase === 'run3' ? '⏳ Searching Market Prices...' : tx.aiRun3Done ? '🔄 Re-check Market Price' : '💰 Get Market Price'}
            </button>
            {aiError && !aiLoading && tx.aiRun2Done && !tx.aiRun3Done && <div style={{ ...S.alert('danger'), marginTop: '8px' }}>{aiError}</div>}

            {/* Price range display */}
            {tx.aiRun3Done && tx.aiPriceRangeLow && tx.aiPriceRangeHigh && (
              <div style={{ marginTop: '12px', padding: '12px', background: '#fff', borderRadius: '8px', border: `1px solid ${COLORS.border}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <span style={{ fontSize: '12px', color: COLORS.textMuted }}>Price Range</span>
                  {tx.aiNewMarketPrice && Number(tx.aiNewMarketPrice) > 0 && <span style={{ fontSize: '11px', color: COLORS.textMuted }}>New price: {fmtMoney(Number(tx.aiNewMarketPrice))}</span>}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '13px', fontWeight: 600 }}>{fmtMoney(Number(tx.aiPriceRangeLow))}</span>
                  <div style={{ flex: 1, height: '8px', background: '#e5e7eb', borderRadius: '4px', position: 'relative' }}>
                    {(() => {
                      const low = Number(tx.aiPriceRangeLow) || 0;
                      const high = Number(tx.aiPriceRangeHigh) || 1;
                      const val = Number(tx.estimatedValue) || 0;
                      const pct = high > low ? Math.min(100, Math.max(0, ((val - low) / (high - low)) * 100)) : 50;
                      return <div style={{ position: 'absolute', left: `${pct}%`, top: '-4px', width: '16px', height: '16px', borderRadius: '50%', background: COLORS.primary, border: '2px solid #fff', boxShadow: '0 1px 3px rgba(0,0,0,0.3)', transform: 'translateX(-50%)' }} />;
                    })()}
                  </div>
                  <span style={{ fontSize: '13px', fontWeight: 600 }}>{fmtMoney(Number(tx.aiPriceRangeHigh))}</span>
                </div>
              </div>
            )}

            {/* Price basis — shown below the range */}
            {tx.aiPriceBasis && (
              <div style={{ marginTop: '8px', padding: '10px', background: COLORS.accentLight, borderRadius: '8px', fontSize: '12px', color: COLORS.text }}>
                <strong>How this price was calculated:</strong> {tx.aiPriceBasis}
              </div>
            )}

            <Field label={<span style={{ display: 'inline-flex', alignItems: 'center' }}>Estimated Resale Value (₦)<InfoIcon tip="How much this item would realistically sell for second-hand around Aguleri. The max cash we can give is based on this number. Staff can adjust but cannot set above the highest realistic price." /></span>} required>
              <input style={{ ...S.input, fontSize: '18px', fontWeight: 700 }} type="number" value={tx.estimatedValue ?? tx.aiEstimatedValue ?? ''} onChange={e => {
                let val = Number(e.target.value) || 0;
                const maxPrice = Number(tx.aiPriceRangeHigh) || 0;
                if (maxPrice > 0 && val > maxPrice) val = maxPrice;
                upd('estimatedValue', val);
              }} placeholder="e.g. 85000" />
              {Number(tx.aiPriceRangeHigh) > 0 && <div style={{ fontSize: '11px', color: COLORS.textMuted, marginTop: '2px' }}>Maximum allowed: {fmtMoney(Number(tx.aiPriceRangeHigh))}</div>}
            </Field>
            {tx.aiRawResponse3 && <details style={{ marginTop: '4px' }}><summary style={{ fontSize: '11px', color: COLORS.textMuted, cursor: 'pointer' }}>View raw AI response</summary><div style={{ padding: '8px', background: COLORS.bg, borderRadius: '6px', fontSize: '11px', color: COLORS.textMuted, whiteSpace: 'pre-wrap', maxHeight: '100px', overflow: 'auto', marginTop: '4px' }}>{tx.aiRawResponse3}</div></details>}
          </div>
        </>)}

        {/* End transaction options */}
        <div style={{ marginTop: '16px', paddingTop: '12px', borderTop: `1px solid ${COLORS.border}` }}>
          <div style={{ fontSize: '12px', fontWeight: 600, color: COLORS.textMuted, marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>End transaction</div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button style={S.btnSm('muted')} onClick={() => handleDeclineFromStep('Item in poor or heavily damaged condition')}>Item in poor or heavily damaged condition</button>
            <button style={S.btnSm('muted')} onClick={() => handleDeclineFromStep('Item appeared modified')}>Item appeared modified</button>
          </div>
        </div>
      </div>);


      case 'screening': return (<ScreeningStep tx={tx} upd={upd} onRedFlagExit={handleRedFlagExit} onDecline={handleDeclineFromStep} />);

      case 'offer': return (<div><h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '16px' }}>💰 {tx.type === 'outright' ? 'Purchase Offer' : 'Cash Advance Offer'}</h3><div style={S.alert('info')}>📋 The maximum advance is calculated automatically. <strong>Do not exceed it.</strong> Enter the amount agreed with the customer, then set today's date.</div><div style={{ ...S.card, background: COLORS.primaryLight, border: `2px solid ${COLORS.primary}`, padding: '20px' }}><div style={S.grid3}><div><div style={{ ...S.statLabel, display: 'flex', alignItems: 'center' }}>Resale Value<InfoIcon tip="What the AI thinks this item is worth second-hand. The max amount we can give the customer is based on this number." /></div><div style={{ fontSize: '22px', fontWeight: 800, color: COLORS.primary }}>{fmtMoney(tx.estimatedValue)}</div></div><div><div style={{ ...S.statLabel, display: 'flex', alignItems: 'center' }}>Max ({capPct}%)<InfoIcon tip={`The most you can give is ${capPct}% of the resale value. It's ${tx.hasReceipt ? 'a bit higher because they brought a receipt' : 'lower because they have no receipt'}. Do not give more than this.`} /></div><div style={{ fontSize: '22px', fontWeight: 800, color: COLORS.accent }}>{fmtMoney(maxAdvance)}</div></div><div><div style={{ ...S.statLabel, display: 'flex', alignItems: 'center' }}>Daily Fee ({settings.interestRate}%)<InfoIcon tip={`Every day, this extra amount gets added to what the customer owes. It is ${settings.interestRate}% of the cash you gave them.`} /></div><div style={{ fontSize: '22px', fontWeight: 800, color: COLORS.warning }}>{fmtMoney(dailyFeeCalc)}/day</div></div></div></div><div style={S.grid2}><Field label={tx.type === 'outright' ? 'Purchase Amount (₦)' : 'Cash Advance (₦)'} required><input style={{ ...S.input, fontSize: '18px', fontWeight: 700 }} type="number" value={tx.cashAdvance === 0 ? '' : tx.cashAdvance} onChange={e => { const raw = e.target.value; const val = raw === '' ? 0 : Number(raw); const v = Math.min(val, maxAdvance); upd('cashAdvance', v); upd('dailyFee', Math.floor(v * (settings.interestRate || 1) / 100)); }} max={maxAdvance} /></Field><Field label="Date Given" required><input style={S.input} type="date" value={tx.dateGiven} onClick={e => e.target.showPicker && e.target.showPicker()} onChange={e => { upd('dateGiven', e.target.value); if (e.target.value) { upd('deadlineDate', addDays(e.target.value, Number(tx.loanDays) || maxLoanDays)); } }} /></Field></div>{tx.type === 'advance' && <div style={S.grid2}><Field label={<span style={{ display: 'inline-flex', alignItems: 'center' }}>Loan Days<InfoIcon tip={`How many days the customer has to come back and pay. The limit is ${maxLoanDays} days. The return date is worked out from this.`} /></span>}><input style={S.input} type="number" min={1} max={maxLoanDays} value={tx.loanDays === '' ? '' : tx.loanDays} onChange={e => { const raw = e.target.value; const val = raw === '' ? '' : Number(raw); const v = raw === '' ? '' : Math.min(Math.max(val, 1), maxLoanDays); upd('loanDays', v); if (tx.dateGiven && raw !== '') { upd('deadlineDate', addDays(tx.dateGiven, Number(v))); } }} /></Field><Field label={<span style={{ display: 'inline-flex', alignItems: 'center' }}>Deadline<InfoIcon tip="The date the customer must come back to pay. It's worked out automatically from the date we gave the money plus the number of loan days." /></span>}><input style={S.input} type="date" value={tx.deadlineDate} readOnly /></Field></div>}<div style={{ padding: '12px', background: COLORS.accentLight, borderRadius: '8px', fontSize: '13px', marginTop: '4px' }}><strong>Service Fee:</strong> {fmtMoney(settings.serviceFee)} to collect. <InfoIcon tip="Collect this flat fee from the customer today, on top of the cash you're giving them. Tick the box on the last step once you've collected it." /></div><div style={{ marginTop: '16px', paddingTop: '12px', borderTop: `1px solid ${COLORS.border}` }}><div style={{ fontSize: '12px', fontWeight: 600, color: COLORS.textMuted, marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>End transaction</div><div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}><button style={S.btnSm('muted')} onClick={() => handleDeclineFromStep('Item not acceptable as collateral')}>Item not acceptable as collateral</button><button style={S.btnSm('muted')} onClick={() => handleDeclineFromStep('Other')}>Other</button></div></div></div>);

      case 'agreement': return (<div><h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '16px' }}>📄 Agreement Preview</h3><div style={S.alert('info')}>📋 Click <strong>Print Agreement</strong> — a filled-in form will open in a new window ready to print. Load plain paper in your printer, click the Print button in that window, and it prints both the Business Copy and Customer Copy with all the transaction data already filled in. Read every clause aloud to the customer. After both copies are signed and thumbprinted, take a photo of the signing and upload it here before proceeding.</div>
      <div style={{ border: `2px solid ${COLORS.border}`, borderRadius: '12px', padding: '20px', background: '#fff' }}>
        <div style={{ textAlign: 'center', marginBottom: '16px' }}>
          <div style={{ fontSize: '16px', fontWeight: 800 }}>CHRIST-IN-FABIAN QUICK CASH</div>
          <div style={{ fontSize: '12px', color: COLORS.textMuted }}>Cash Advance & Buy-Back Agreement</div>
          <div style={{ fontSize: '13px', fontWeight: 700, marginTop: '4px' }}>Ref: {tx.ref}</div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '4px 12px', fontSize: '13px' }}>
          <strong>Name:</strong><span>{tx.fullName}</span>
          <strong>Address:</strong><span>{tx.address}</span>
          <strong>ID:</strong><span>{tx.idType?.toUpperCase()} — {tx.idNumber}</span>
          <strong>Phone(s):</strong><span>{tx.phoneNumbers?.filter(Boolean).join(', ')}</span>
          <strong>Family:</strong><span>{tx.familyName} ({tx.familyRelation}) — {tx.familyPhone}</span>
          <strong>Item:</strong><span>{tx.aiItemType} / {tx.aiBrand} / {tx.aiModel}</span>
          <strong>Condition:</strong><span>{tx.conditionDescription}</span>
          {tx.imei && <><strong>IMEI:</strong><span>{tx.imei}</span></>}
          <strong>Cash:</strong><span style={{ fontWeight: 700, color: COLORS.primary }}>{fmtMoney(tx.cashAdvance)}</span>
          {tx.type === 'advance' && <><strong>Date Given:</strong><span>{fmtDate(tx.dateGiven)}</span><strong>Deadline:</strong><span>{fmtDate(tx.deadlineDate)}</span><strong>Daily Fee:</strong><span>{fmtMoney(dailyFeeCalc)}/day</span></>}
        </div>
      </div>
      <button
        style={{ ...S.btn('accent'), marginTop: '16px', padding: '12px 24px', fontSize: '15px' }}
        onClick={() => printAgreement(tx, settings)}
      >
        🖨 Print Agreement (Both Copies)
      </button>
      <div style={{ marginTop: '16px' }}>
        <PhotoUpload label="Photo of Signing / Thumbprint" value={tx.photoSigning} onChange={v => upd('photoSigning', v)} required size={140} />
      </div>
      <div style={{ marginTop: '16px', paddingTop: '12px', borderTop: `1px solid ${COLORS.border}` }}><div style={{ fontSize: '12px', fontWeight: 600, color: COLORS.textMuted, marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>End transaction</div><div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}><button style={S.btnSm('muted')} onClick={() => handleDeclineFromStep('Customer refused photos or terms')}>Customer refused photos or terms</button></div></div></div>);

      case 'complete': return (<div><h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '16px' }}>✅ Finalize</h3><div style={S.alert('info')}>📋 Tick the service fee checkbox <strong>only after you have physically collected ₦{settings.serviceFee?.toLocaleString() || '1,000'}</strong> from the customer. Then count the cash advance in front of the customer, let them count it too, and click Complete.</div>{tx.type === 'advance' && <PhotoUpload label="Sealed Package Photo" value={tx.photoSealedPkg} onChange={v => upd('photoSealedPkg', v)} size={140} />}<label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', padding: '12px', background: COLORS.accentLight, borderRadius: '8px', marginTop: '12px' }}><input type="checkbox" checked={tx.serviceFeeCollected} onChange={e => upd('serviceFeeCollected', e.target.checked)} style={{ width: '20px', height: '20px' }} /><span style={{ fontSize: '14px', fontWeight: 600 }}>₦{settings.serviceFee} service fee collected <span style={{ color: COLORS.danger }}>*</span></span></label><div style={{ ...S.card, background: COLORS.primaryLight, border: `2px solid ${COLORS.primary}`, textAlign: 'center', marginTop: '12px' }}><div style={{ fontSize: '14px', fontWeight: 600, marginBottom: '8px' }}>Cash {tx.type === 'outright' ? 'Paid' : 'Advance Given'}</div><div style={{ fontSize: '32px', fontWeight: 800, color: COLORS.primary }}>{fmtMoney(tx.cashAdvance)}</div><div style={{ fontSize: '12px', color: COLORS.textMuted, marginTop: '4px' }}>Count in front of customer. Let them count too.</div></div><button style={{ ...S.btn('primary'), padding: '16px', fontSize: '16px', justifyContent: 'center', width: '100%', marginTop: '12px', opacity: !tx.serviceFeeCollected ? 0.5 : 1 }} disabled={!tx.serviceFeeCollected} onClick={handleComplete}>{!tx.serviceFeeCollected ? '⚠ Tick Service Fee to Complete' : '✅ Complete Transaction — Save to Database'}</button></div>);

      default: return <div>Unknown step</div>;
    }
  };

  return (
    <div>
      {redFlagModal && (
        <Modal open={redFlagModal} onClose={() => { setRedFlagModal(false); onCancel(); }} title="Transaction Declined">
          <div style={{ textAlign: 'center', padding: '8px 0 16px' }}>
            <div style={{ fontSize: '48px', marginBottom: '12px' }}>🙏</div>
            <div style={{ fontSize: '16px', fontWeight: 700, marginBottom: '8px', color: COLORS.textDark }}>We're sorry</div>
            <div style={{ fontSize: '14px', color: COLORS.textMuted, lineHeight: 1.6 }}>Our system is unable to process this transaction at this time. Thank you for your understanding.</div>
          </div>
          <button style={{ ...S.btn('primary'), width: '100%', justifyContent: 'center' }} onClick={() => { setRedFlagModal(false); onCancel(); }}>Return to Home</button>
        </Modal>
      )}
      {wizDeclineModal && (
        <WizardDeclineLogModal
          prefill={wizDeclineModal}
          onSave={async (entry) => {
            const { onAfter, declinedTx, ref } = wizDeclineModal;
            setWizDeclineModal(null);
            await API.post('transactions', declinedTx);
            await API.del(`drafts/${encodeURIComponent(ref)}`);
            await API.post('declined', entry);
            onAfter?.();
          }}
          onCancel={() => setWizDeclineModal(null)}
        />
      )}
      {showRechargeModal && (
        <NinRechargeModal onClose={() => setShowRechargeModal(false)} settings={settings} />
      )}
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
            <button style={S.btn('muted')} onClick={async () => { await saveDraftNow(); onCancel(); }}>Save Draft & Exit</button>
          </div>
          {step < WIZARD_STEPS.length - 1 && <button style={S.btn('primary')} onClick={async () => { await saveDraftNow(step + 1); setStep(step + 1); }} disabled={!canProceed()}>Next Step →</button>}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// NIN/BVN RECHARGE MODAL — shows payment details for topping up
// the checkmyninbvn.com.ng wallet
// ============================================================
function NinRechargeModal({ onClose, settings }) {
  const bank = settings.ninRechargeBank || '';
  const accountNumber = settings.ninRechargeAccountNumber || '';
  const accountName = settings.ninRechargeAccountName || '';
  const hasDetails = bank || accountNumber || accountName;
  return (
    <Modal open onClose={onClose} title="💳 Recharge Verification Credits">
      <div style={{ ...S.alert('info'), marginBottom: '16px' }}>
        ℹ️ Each verification credit costs <strong>₦{(settings.ninCreditCost ?? 150).toLocaleString()}</strong>. One credit is used each time a new (uncached) NIN or BVN is verified via the API.
      </div>
      {hasDetails ? (
        <div style={{ background: COLORS.primaryLight, border: `1px solid #b7e4c7`, borderRadius: '12px', padding: '20px', marginBottom: '16px' }}>
          <div style={{ fontSize: '14px', fontWeight: 700, color: COLORS.primaryDark, marginBottom: '14px' }}>Transfer funds to this account:</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {bank && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '13px', color: COLORS.textMuted, fontWeight: 600 }}>Bank</span>
                <span style={{ fontSize: '15px', fontWeight: 700, color: COLORS.text }}>{bank}</span>
              </div>
            )}
            {accountNumber && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '13px', color: COLORS.textMuted, fontWeight: 600 }}>Account Number</span>
                <span style={{ fontSize: '18px', fontWeight: 800, color: COLORS.primaryDark, letterSpacing: '1px' }}>{accountNumber}</span>
              </div>
            )}
            {accountName && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '13px', color: COLORS.textMuted, fontWeight: 600 }}>Account Name</span>
                <span style={{ fontSize: '15px', fontWeight: 700, color: COLORS.text }}>{accountName}</span>
              </div>
            )}
          </div>
          <div style={{ marginTop: '14px', paddingTop: '14px', borderTop: `1px solid #b7e4c7`, fontSize: '12px', color: COLORS.textMuted }}>
            After transferring, log in to <strong>checkmyninbvn.com.ng</strong> to confirm your wallet has been topped up. Credits reflect here automatically when you refresh the page.
          </div>
        </div>
      ) : (
        <div style={{ ...S.alert('warning'), marginBottom: '16px' }}>
          ⚠️ No recharge payment details have been configured yet. Ask your admin to set them up in <strong>Settings → Identity Verification</strong>.
        </div>
      )}
      <div style={{ fontSize: '13px', color: COLORS.textMuted, padding: '12px 14px', background: COLORS.bg, borderRadius: '8px', border: `1px solid ${COLORS.border}` }}>
        <strong>Tip:</strong> Cached verifications (repeat customers with the same NIN/BVN already stored) do not use credits — only first-time lookups do.
      </div>
      <button style={{ ...S.btn('muted'), width: '100%', justifyContent: 'center', marginTop: '16px' }} onClick={onClose}>Close</button>
    </Modal>
  );
}

// ============================================================
// WIZARD DECLINE LOG MODAL — pre-filled for staff to review
// ============================================================
function WizardDeclineLogModal({ prefill, onSave, onCancel }) {
  const [showErrors, setShowErrors] = useState(false);
  const [entry, setEntry] = useState({
    date: prefill.date || localISODate(),
    ref: prefill.ref || '',
    customerName: prefill.customerName || '',
    ninBvn: prefill.ninBvn || '',
    item: prefill.item || '',
    reason: prefill.reason || '',
    notes: prefill.notes || '',
  });
  const upd = (k, v) => setEntry(prev => ({ ...prev, [k]: v }));
  const missingRequired = !entry.date || !entry.item.trim() || !entry.reason;
  return (
    <Modal open onClose={onCancel} title="📋 Log Declined Customer">
      <div style={{ ...S.alert('warning'), marginBottom: '12px' }}>
        ⚠️ Fill in the details below and click <strong>Decline &amp; Save to Log</strong> to record this declined transaction. Fields marked with <strong>*</strong> are mandatory. Ref #, customer name and NIN/BVN are optional because staff may not always have those details when declining. Clicking Cancel or ✕ returns you to the wizard without saving.
      </div>
      {showErrors && missingRequired && <div style={{ ...S.alert('danger'), marginBottom: '12px' }}>⛔ Date, Item Brought, and Decline Reason are required before you can save this decline log entry.</div>}
      <div style={S.grid2}>
        <Field label="Date" required>
          <input style={S.input} type="date" value={entry.date} onClick={e => e.target.showPicker && e.target.showPicker()} onChange={e => upd('date', e.target.value)} />
        </Field>
        <Field label="Ref #">
          <input style={S.input} value={entry.ref} onChange={e => upd('ref', e.target.value)} placeholder="e.g. CFC-20240101-A1B2" />
        </Field>
      </div>
      <div style={S.grid2}>
        <Field label="Customer Name">
          <input style={S.input} value={entry.customerName} onChange={e => upd('customerName', e.target.value)} placeholder="e.g. David Chukwuemeka" />
        </Field>
        <Field label="NIN / BVN">
          <input style={S.input} value={entry.ninBvn} onChange={e => upd('ninBvn', e.target.value)} placeholder="e.g. NIN: 12345678901" />
        </Field>
      </div>
      <Field label="Item Brought" required>
        <input style={S.input} value={entry.item} onChange={e => upd('item', e.target.value)} placeholder="e.g. Smartphone Samsung Galaxy A14" />
      </Field>
      <Field label="Decline Reason" required>
        <select style={S.select} value={entry.reason} onChange={e => upd('reason', e.target.value)}>
          <option value="">— Select a reason —</option>
          {DECLINE_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
      </Field>
      <Field label="Additional Notes (optional)">
        <textarea style={S.textarea} value={entry.notes} onChange={e => upd('notes', e.target.value)} placeholder="e.g. Customer appeared nervous, gave two different answers about purchase date…" rows={3} />
      </Field>
      <div style={{ display: 'flex', gap: '12px', marginTop: '4px' }}>
        <button style={{ ...S.btn('danger'), flex: 1, justifyContent: 'center' }} disabled={missingRequired} onClick={() => { setShowErrors(true); if (missingRequired) return; onSave(entry); }}>
          🚫 Decline &amp; Save to Log
        </button>
        <button style={{ ...S.btn('muted'), flex: 1, justifyContent: 'center' }} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}

// ============================================================
// REPAYMENT & SALE MODALS
// ============================================================
function RepaymentModal({ tx, settings, onClose, onSave, currentUser }) {
  const days = daysBetween(tx.dateGiven);
  const today = localISODate();
  const dailyFee = Math.floor((tx.cashAdvance || 0) * (settings.interestRate || 1) / 100);
  const totalFees = days * dailyFee;
  const totalDue = (tx.cashAdvance || 0) + totalFees;
  const [confirmed, setConfirmed] = useState(false);
  return (
    <div>
      <div style={{ ...S.card, background: COLORS.bg }}><div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}><div><span style={S.statLabel}>Customer</span><br /><strong>{tx.fullName}</strong></div><div><span style={S.statLabel}>Item</span><br /><strong>{tx.aiItemType} {tx.aiBrand} {tx.aiModel}</strong></div><div><span style={S.statLabel}>Advance</span><br /><strong style={{ fontSize: '18px' }}>{fmtMoney(tx.cashAdvance)}</strong></div><div><span style={S.statLabel}>Days</span><br /><strong style={{ fontSize: '18px' }}>{days} days × {fmtMoney(dailyFee)} = {fmtMoney(totalFees)}</strong></div></div></div>
      <div style={{ ...S.card, background: '#f8fafc', border: `1px solid ${COLORS.border}`, marginTop: '-8px' }}>
        <div style={{ fontSize: '14px', fontWeight: 700 }}>
          Date Given: {fmtDate(tx.dateGiven)} → Today: {fmtDate(today)} = {days} day{days === 1 ? '' : 's'}
        </div>
        <div style={{ fontSize: '12px', color: COLORS.textMuted, marginTop: '4px' }}>Today is counted as a full day.</div>
      </div>
      <div style={{ ...S.card, background: COLORS.primaryLight, border: `2px solid ${COLORS.primary}`, textAlign: 'center' }}><div style={S.statLabel}>Total Due</div><div style={{ fontSize: '32px', fontWeight: 800, color: COLORS.primary }}>{fmtMoney(totalDue)}</div></div>
      <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', marginBottom: '16px' }}><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} style={{ width: '20px', height: '20px' }} /><span style={{ fontWeight: 600 }}>Day count confirmed and customer paid {fmtMoney(totalDue)}; item returned</span></label>
      <div style={{ display: 'flex', gap: '12px' }}><button style={S.btn('primary')} disabled={!confirmed} onClick={() => onSave({ ...tx, status: 'closed', amountRepaid: totalDue, dateRepaid: localISODate(), daysCharged: days, totalFees, itemReturned: true, repaidBy: currentUser?.name || '' })}>✅ Confirm</button><button style={S.btn('outline')} onClick={onClose}>Cancel</button></div>
    </div>
  );
}

const SALE_CONDITIONS = [
  { value: 'Excellent', label: 'Excellent — Like new, no visible wear' },
  { value: 'Good',      label: 'Good — Minor cosmetic marks, fully functional' },
  { value: 'Fair',      label: 'Fair — Noticeable scratches/dents, fully functional' },
  { value: 'Poor',      label: 'Poor — Significant wear, may have minor functional issues' },
  { value: 'For Parts', label: 'For Parts — Not fully functional, sold as-is' },
];
const SALE_CONDITION_VALUES = new Set(SALE_CONDITIONS.map(c => c.value));

function SaleModal({ tx, settings, onClose, onSave, currentUser }) {
  const dailyFee = Math.floor((tx.cashAdvance || 0) * (settings.interestRate || 1) / 100);
  const maxHoldDays = (Math.max(1, Number(settings.maxLoanDays) || 30)) + (Math.max(0, Number(settings.graceDays) || 3));
  const minPrice = (tx.cashAdvance || 0) + maxHoldDays * dailyFee + Math.floor((tx.cashAdvance || 0) * (settings.minSellBonus || 20) / 100);
  const targetPrice = Math.floor((tx.estimatedValue || 0) * (settings.targetSellPct || 75) / 100);
  const listedPrice = Math.max(targetPrice, minPrice);
  const [salePrice, setSalePrice] = useState(listedPrice);
  const [saleDate, setSaleDate] = useState(localISODate());
  const [saleBuyer, setSaleBuyer] = useState('');

  // Pre-fill condition from existing intake data if it matches a dropdown option
  const intakeCondition = tx.shopCondition || tx.aiCondition || tx.conditionDescription || '';
  const defaultCondition = SALE_CONDITION_VALUES.has(intakeCondition) ? intakeCondition : '';
  const [saleCondition, setSaleCondition] = useState(defaultCondition);
  const [salePhotos, setSalePhotos] = useState([]);
  const [salePhotoNote, setSalePhotoNote] = useState('');
  const [salePhotoUploading, setSalePhotoUploading] = useState(false);
  const salePhotoFileRef = useRef();

  const intakePhotos = normalizeItemPhotos(tx.itemPhotos).filter(Boolean);

  const handleAddSalePhoto = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = '';
    setSalePhotoUploading(true);
    try {
      let base64;
      try { base64 = await compressImageFile(file); }
      catch { setSalePhotoUploading(false); return; }
      const mimeType = base64.split(';')[0].split(':')[1];
      const data = base64.split(',')[1];
      const result = await API.post('photos', { data, mimeType });
      const url = result?.url || base64;
      setSalePhotos(prev => [...prev, url]);
    } catch { /* ignore upload errors */ }
    finally { setSalePhotoUploading(false); }
  };

  const removeSalePhoto = (idx) => {
    const url = salePhotos[idx];
    if (url && url.startsWith('/api/photos/')) API.del(url.slice(5)).catch(() => {});
    setSalePhotos(prev => prev.filter((_, i) => i !== idx));
  };

  const canConfirm = salePrice >= minPrice && !!saleCondition;

  return (
    <div>
      <div style={S.grid3}><div style={S.stat}><div style={S.statLabel}>Minimum</div><div style={{ ...S.statValue, color: COLORS.danger }}>{fmtMoney(minPrice)}</div></div><div style={S.stat}><div style={S.statLabel}>Target (75%)</div><div style={S.statValue}>{fmtMoney(targetPrice)}</div></div><div style={S.stat}><div style={S.statLabel}>Listed</div><div style={{ ...S.statValue, color: COLORS.accent }}>{fmtMoney(listedPrice)}</div></div></div>
      <Field label="Sale Price (₦)" required style={{ marginTop: '16px' }}><input style={{ ...S.input, fontSize: '18px', fontWeight: 700 }} type="number" value={salePrice} onChange={e => setSalePrice(Number(e.target.value))} />{salePrice < minPrice && <div style={{ color: COLORS.danger, fontSize: '12px', marginTop: '4px' }}>⚠ Below minimum</div>}</Field>
      <Field label="Buyer Name"><input style={S.input} value={saleBuyer} onChange={e => setSaleBuyer(e.target.value)} /></Field>
      <Field label="Condition at Sale" required>
        <select style={S.select} value={saleCondition} onChange={e => setSaleCondition(e.target.value)}>
          <option value="">— Select condition —</option>
          {SALE_CONDITIONS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
        {!saleCondition && <div style={{ color: COLORS.danger, fontSize: '12px', marginTop: '4px' }}>⛔ Condition is required before confirming sale</div>}
      </Field>
      <Field label="Sale Date"><input style={S.input} type="date" value={saleDate} onClick={e => e.target.showPicker && e.target.showPicker()} onChange={e => setSaleDate(e.target.value)} /></Field>
      <div style={{ ...S.card, background: COLORS.primaryLight, textAlign: 'center', marginTop: '8px' }}><div style={S.statLabel}>Profit</div><div style={{ fontSize: '28px', fontWeight: 800, color: salePrice - tx.cashAdvance > 0 ? COLORS.primary : COLORS.danger }}>{fmtMoney(salePrice - tx.cashAdvance)}</div></div>

      {/* Photos at Sale */}
      <div style={{ borderTop: `1px solid ${COLORS.border}`, marginTop: '16px', paddingTop: '12px' }}>
        <div style={{ fontSize: '13px', fontWeight: 700, color: COLORS.textMuted, marginBottom: '8px' }}>📷 Photos at Sale <span style={{ fontWeight: 400 }}>(optional)</span></div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
          {salePhotos.map((url, idx) => (
            <div key={idx} style={{ position: 'relative', width: '72px', height: '72px' }}>
              <img src={url} alt={`Sale photo ${idx + 1}`} style={{ width: '72px', height: '72px', objectFit: 'cover', borderRadius: '8px', border: `1px solid ${COLORS.border}` }} onError={e => { e.currentTarget.onerror = null; e.currentTarget.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='72' height='72'%3E%3Crect width='72' height='72' fill='%23fee2e2'/%3E%3Ctext x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' font-size='9' fill='%23dc2626'%3EError%3C/text%3E%3C/svg%3E"; }} />
              <button type="button" onClick={() => removeSalePhoto(idx)} style={{ position: 'absolute', top: '2px', right: '2px', width: '18px', height: '18px', borderRadius: '50%', border: 'none', background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: '10px', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, lineHeight: 1 }}>✕</button>
            </div>
          ))}
          <button type="button" style={{ ...S.btnSm('secondary'), display: 'flex', alignItems: 'center', gap: '4px' }} onClick={() => salePhotoFileRef.current?.click()} disabled={salePhotoUploading}>
            {salePhotoUploading ? 'Uploading…' : '+ Add Photo'}
          </button>
          <input ref={salePhotoFileRef} type="file" accept="image/*" capture="environment" onChange={handleAddSalePhoto} style={{ display: 'none' }} />
        </div>
        <Field label="Note" style={{ marginTop: '10px' }}>
          <textarea style={{ ...S.input, minHeight: '64px', resize: 'vertical' }} value={salePhotoNote} onChange={e => setSalePhotoNote(e.target.value)} placeholder="e.g. Battery cover missing since intake. New scratch on left edge from storage." />
        </Field>
      </div>

      {/* Intake Photos (read-only reference) */}
      {intakePhotos.length > 0 && (
        <div style={{ borderTop: `1px solid ${COLORS.border}`, marginTop: '12px', paddingTop: '12px' }}>
          <div style={{ fontSize: '13px', fontWeight: 700, color: COLORS.textMuted, marginBottom: '8px' }}>📁 Photos from Intake <span style={{ fontWeight: 400 }}>(reference only)</span></div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            {intakePhotos.map((url, idx) => (
              <img key={idx} src={url} alt={`Intake photo ${idx + 1}`} style={{ width: '64px', height: '64px', objectFit: 'cover', borderRadius: '8px', border: `1px solid ${COLORS.border}`, opacity: 0.85 }} onError={e => { e.currentTarget.onerror = null; e.currentTarget.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='64' height='64'%3E%3Crect width='64' height='64' fill='%23fee2e2'/%3E%3Ctext x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' font-size='9' fill='%23dc2626'%3EError%3C/text%3E%3C/svg%3E"; }} />
            ))}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: '12px', marginTop: '16px' }}><button style={S.btn('primary')} onClick={() => onSave({ ...tx, status: 'sold', salePrice, saleDate, saleBuyer, saleCondition, salePhotos, salePhotoNote, soldBy: currentUser?.name || '' })} disabled={!canConfirm}>✓ Confirm Sale</button><button style={S.btn('outline')} onClick={onClose}>Cancel</button></div>
    </div>
  );
}

// ============================================================
// CONTACT LOG
// ============================================================
const CONTACT_OUTCOMES = [
  { value: 'no_answer',           label: 'No Answer' },
  { value: 'voicemail',           label: 'Voicemail Left' },
  { value: 'answered_promises',   label: 'Answered — Promises to Pay' },
  { value: 'answered_refuses',    label: 'Answered — Refuses to Pay' },
  { value: 'answered_disputed',   label: 'Answered — Disputed Debt' },
  { value: 'wrong_number',        label: 'Wrong Number / Disconnected' },
  { value: 'number_unreachable',  label: 'Number Not Reachable' },
  { value: 'in_person',           label: 'In-Person Visit' },
  { value: 'partial_payment',     label: 'Partial Payment Received' },
  { value: 'other',               label: 'Other' },
];
const CONTACT_OUTCOME_LABEL = Object.fromEntries(CONTACT_OUTCOMES.map(o => [o.value, o.label]));

const OUTCOME_COLORS = {
  no_answer:          '#6b7280',
  voicemail:          '#8b5cf6',
  answered_promises:  '#10b981',
  answered_refuses:   '#ef4444',
  answered_disputed:  '#f59e0b',
  wrong_number:       '#ef4444',
  number_unreachable: '#6b7280',
  in_person:          '#3b82f6',
  partial_payment:    '#10b981',
  other:              '#6b7280',
};

const SUCCESSFUL_CONTACT_OUTCOMES = new Set(['answered_promises', 'answered_refuses', 'answered_disputed', 'in_person', 'partial_payment']);

const normalizeReminderDays = (value, fallback = []) => {
  const source = Array.isArray(value)
    ? value
    : String(value ?? '')
        .split(',')
        .map(v => v.trim())
        .filter(Boolean);
  const parsed = source
    .map(v => Number(v))
    .filter(v => Number.isFinite(v) && v >= 0);
  const unique = Array.from(new Set(parsed));
  return unique.length ? unique : fallback;
};

const formatReminderDays = (value, fallback = []) => normalizeReminderDays(value, fallback).join(', ');

// Input that lets the user type freely (e.g. "3, 0") and only
// normalises/sorts the value when they leave the field (onBlur).
function ReminderDaysInput({ value, fallback, onChange, style, placeholder }) {
  const formatted = formatReminderDays(value, fallback);
  const [draft, setDraft] = useState(formatted);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setDraft(formatReminderDays(value, fallback));
  }, [value, fallback, focused]);
  return (
    <input
      style={style}
      value={focused ? draft : formatted}
      placeholder={placeholder}
      onChange={e => setDraft(e.target.value)}
      onFocus={() => { setFocused(true); setDraft(formatted); }}
      onBlur={() => { setFocused(false); onChange(normalizeReminderDays(draft, fallback)); }}
    />
  );
}

const isSuccessfulContactEntry = (entry) => SUCCESSFUL_CONTACT_OUTCOMES.has(entry?.result);

const hasSuccessfulContactToday = (tx) => (tx?.contactLog || []).some(entry => entry?.date === localISODate() && isSuccessfulContactEntry(entry));

function ContactLogModal({ tx, onClose, onSave, currentUser }) {
  const [date, setDate] = useState(localISODate());
  const [time, setTime] = useState(() => {
    const tp = new Intl.DateTimeFormat('en-GB', { timeZone: NIGERIA_TZ, hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date());
    return `${tp.find(p => p.type === 'hour').value}:${tp.find(p => p.type === 'minute').value}`;
  });
  const [result, setResult] = useState('no_answer');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    const entry = {
      date,
      time,
      result,
      notes: notes.trim(),
      loggedBy: currentUser?.name || currentUser?.username || 'Staff',
      loggedAt: new Date().toISOString(),
    };
    await onSave({ ...tx, contactLog: [...(tx.contactLog || []), entry] });
    setSaving(false);
  };

  return (
    <div>
      <div style={{ ...S.card, background: COLORS.bg, marginBottom: '16px' }}>
        <div style={{ fontSize: '13px' }}>
          <strong>{tx.fullName}</strong> — {tx.aiBrand} {tx.aiModel}<br />
          📱 {tx.phoneNumbers?.filter(Boolean).join(' / ')}
          {tx.familyPhone && <><br />👨‍👩‍👧 {tx.familyName} ({tx.familyRelation}): {tx.familyPhone}</>}
        </div>
      </div>
      <div style={S.grid2}>
        <Field label="Date" required><input style={S.input} type="date" value={date} onClick={e => e.target.showPicker && e.target.showPicker()} onChange={e => setDate(e.target.value)} /></Field>
        <Field label="Time"><input style={S.input} type="time" value={time} onChange={e => setTime(e.target.value)} /></Field>
      </div>
      <Field label="Outcome" required style={{ marginTop: '12px' }}>
        <select style={S.select} value={result} onChange={e => setResult(e.target.value)}>
          {CONTACT_OUTCOMES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </Field>
      <Field label="Notes (optional)" style={{ marginTop: '12px' }}>
        <textarea style={S.textarea} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Additional context, what was said, next steps..." />
      </Field>
      <div style={{ display: 'flex', gap: '12px', marginTop: '20px' }}>
        <button style={S.btn('primary')} onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : '📋 Save Entry'}</button>
        <button style={S.btn('outline')} onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}

// ============================================================
// TXDETAIL — defined outside App so React never remounts it
// when unrelated App state changes, which would cause flicker.
// ============================================================
function TxDetail({ tx, settings, isStaff, currentUser, setZoomedPhoto, setLoggingContactTx, saveTx, loadData, setShopListingTx }) {
  const navigate = useNavigate();
  const timeline = tx.type === 'advance' ? getLoanTimeline(tx, settings) : null;
  const customerDaysLeft = tx.type === 'advance' ? getCustomerDaysLeft(tx) : null;
  const dailyInterest = tx.cashAdvance ? Math.floor((tx.cashAdvance * (settings.interestRate || 1)) / 100) : 0;
  const daysOut = timeline ? timeline.elapsedDays : 0;
  const amountDueToday = tx.cashAdvance ? tx.cashAdvance + daysOut * dailyInterest : 0;
  const row = (label, value, color) => (value !== null && value !== undefined && value !== '') ? (
    <div style={{ display: 'grid', gridTemplateColumns: '165px 1fr', gap: '8px', padding: '6px 0', borderBottom: `1px solid ${COLORS.border}`, fontSize: '13px', alignItems: 'start' }}>
      <div style={{ fontWeight: 600, color: COLORS.textMuted, fontSize: '11.5px', textTransform: 'uppercase', letterSpacing: '0.3px', paddingTop: '2px' }}>{label}</div>
      <div style={{ color: color || COLORS.text }}>{value}</div>
    </div>
  ) : null;
  return (<div>
    {/* ── Header ── */}
    <div style={{ marginBottom: '20px' }}>
      <div style={{ display: 'flex', gap: '8px', marginBottom: '10px', flexWrap: 'wrap' }}>
        <span style={S.badge(statusColor(tx, settings))}>{statusLabel(tx, settings)}</span>
        <span style={S.badge('#6b7280')}>{tx.type === 'outright' ? '📦 Outright Purchase' : '💳 Cash Advance'}</span>
        <span style={{ ...S.badge(COLORS.primary), letterSpacing: '0.5px' }}>Ref: {tx.ref}</span>
      </div>
      <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', fontSize: '12px', color: COLORS.textMuted, lineHeight: 1.9 }}>
        {tx.created_at && <span>🕐 Created: <strong style={{ color: COLORS.text }}>{new Date(tx.created_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</strong></span>}
        <span>📅 Date Given: <strong style={{ color: COLORS.text }}>{fmtDate(tx.dateGiven)}</strong></span>
        {tx.type === 'advance' && tx.deadlineDate && <span>⏰ Agreed Return: <strong style={{ color: customerDaysLeft !== null && customerDaysLeft <= 0 ? COLORS.danger : COLORS.text }}>{fmtDate(tx.deadlineDate)}</strong></span>}
        <span>👤 By: <strong style={{ color: COLORS.text }}>{tx.completedBy || tx.createdBy || 'Unknown'}</strong></span>
      </div>
    </div>

    {/* ── Customer & Item ── */}
    <div style={S.grid2}>
      <div style={S.card}>
        <div style={S.cardTitle}>👤 Customer</div>
        {row('Full Name', <strong>{tx.fullName}</strong>)}
        {row('Address', tx.address)}
        {row('Phone(s)', tx.phoneNumbers?.filter(Boolean).join(', '))}
        {tx.familyName && row('Emergency Contact', `${tx.familyName} (${tx.familyRelation || 'N/A'}) — ${tx.familyPhone || ''}`)}
        {row('ID Type', tx.idType?.toUpperCase())}
        {row('ID Number', tx.idNumber)}
        {row('NIN Verification', tx.ninVerified ? '✅ Verified via API' : tx.ninVerificationAttempted ? '⚠️ Attempted (placeholder data)' : '❌ Not attempted')}
        {row('Processed By', tx.completedBy || tx.createdBy)}
      </div>
      <div style={S.card}>
        <div style={S.cardTitle}>📦 Item</div>
        {tx.captureItemType && row('Category', <>{tx.captureItemType}{tx.partsOnly && <span style={{ marginLeft: '6px', color: COLORS.danger, fontWeight: 700 }}>(Parts Only)</span>}</>)}
        {row('Identified As', [tx.aiItemType, tx.aiBrand, tx.aiModel].filter(Boolean).join(' '))}
        {row('Colour', tx.aiColour)}
        {tx.aiKeySpecs && row('Key Specs', tx.aiKeySpecs)}
        {tx.aiConfidence && row('AI Confidence', tx.aiConfidence)}
        {row('Condition', tx.aiCondition)}
        {tx.imei && row('IMEI', <>{tx.imei}{tx.imeiModelMatch !== undefined && <span style={{ marginLeft: '8px', fontSize: '12px', color: tx.imeiModelMatch ? '#10b981' : '#f59e0b' }}>{tx.imeiModelMatch ? '✅ Model matched' : '⚠ Not confirmed'}</span>}</>)}
        {tx.serialNumber && row('Serial No.', tx.serialNumber)}
        {tx.inspectionNotes && row('Inspection Result', tx.inspectionNotes)}
        {tx.hasReceipt != null && row('Receipt', tx.hasReceipt === true ? '✅ Has receipt' : '❌ No receipt')}
        {tx.aiPriceBasis && row('Price Basis', tx.aiPriceBasis)}
        {tx.aiNewMarketPrice && Number(tx.aiNewMarketPrice) > 0 && row('New Market Price', fmtMoney(Number(tx.aiNewMarketPrice)))}
        {tx.aiPriceRangeLow && tx.aiPriceRangeHigh && row('Price Range', `${fmtMoney(Number(tx.aiPriceRangeLow))} — ${fmtMoney(Number(tx.aiPriceRangeHigh))}`)}
        {tx.aiValuationConfidence && row('Valuation Confidence', tx.aiValuationConfidence)}
        {tx.aiVisionUsed && row('Cloud Vision', 'Used for identification')}
      </div>
    </div>

    {/* ── Financial Summary ── */}
    <div style={S.card}>
      <div style={S.cardTitle}>💰 Financial Summary</div>
      <div style={S.grid4}>
        <div style={S.stat}><div style={{ ...S.statLabel, display: 'flex', alignItems: 'center' }}>Estimated Value<InfoIcon tip="What the AI estimates this item would sell for second-hand. The max we can give is a percentage of this number." /></div><div style={S.statValue}>{fmtMoney(tx.estimatedValue)}</div></div>
        <div style={S.stat}><div style={{ ...S.statLabel, display: 'flex', alignItems: 'center' }}>Cash Advanced<InfoIcon tip="The cash we handed to the customer when they left the item with us." /></div><div style={S.statValue}>{fmtMoney(tx.cashAdvance)}</div></div>
        {tx.type === 'advance' && <>
          <div style={S.stat}><div style={{ ...S.statLabel, display: 'flex', alignItems: 'center' }}>Days Outstanding<InfoIcon tip="How many days have passed since we gave the customer money. A small fee is added for every single day." /></div><div style={S.statValue}>{daysOut}d</div></div>
          <div style={{ ...S.stat, background: tx.status === 'active' ? COLORS.dangerLight : COLORS.primaryLight }}>
            <div style={{ ...S.statLabel, display: 'flex', alignItems: 'center' }}>Amount Due Today<InfoIcon tip="The full amount the customer owes us today — the cash we gave them plus all the daily fees added up so far. It grows bigger every day." /></div>
            <div style={{ ...S.statValue, color: tx.status === 'active' ? COLORS.danger : COLORS.primary }}>{fmtMoney(amountDueToday)}</div>
          </div>
        </>}
      </div>
      {tx.type === 'advance' && (
        <div style={{ marginTop: '12px', padding: '10px 12px', background: COLORS.bg, borderRadius: '8px', fontSize: '12.5px', color: COLORS.textMuted }}>
          Daily interest: <strong>{fmtMoney(dailyInterest)}/day</strong> ({settings.interestRate || 1}% of principal){Number(settings.serviceFee) > 0 && <> · Service fee: <strong>{fmtMoney(settings.serviceFee)}</strong></>}
        </div>
      )}
      {tx.status === 'closed' && <div style={{ marginTop: '12px', padding: '12px 14px', background: COLORS.primaryLight, borderRadius: '8px', fontSize: '13px' }}>✅ <strong>Repaid:</strong> {fmtMoney(tx.amountRepaid)} on {fmtDate(tx.dateRepaid)}</div>}
      {tx.status === 'sold' && <div style={{ marginTop: '12px', padding: '12px 14px', background: COLORS.accentLight, borderRadius: '8px', fontSize: '13px' }}>💰 <strong>Sold:</strong> {fmtMoney(tx.salePrice)} on {fmtDate(tx.saleDate)} · Profit: <strong>{fmtMoney((tx.salePrice || 0) - (tx.cashAdvance || 0))}</strong>{tx.saleBuyer ? ` · Buyer: ${tx.saleBuyer}` : ''}</div>}
    </div>

    {/* ── Loan Timeline (advance only) ── */}
    {tx.type === 'advance' && timeline && (
      <div style={S.card}>
        <div style={S.cardTitle}>📅 Loan Timeline</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '10px', marginBottom: '12px' }}>
          {[
            { label: 'Date Given', date: tx.dateGiven, bg: COLORS.bg, fg: COLORS.text, border: COLORS.border, tip: 'The day we gave the customer money and the loan started.' },
            { label: 'Agreed Return', date: tx.deadlineDate, bg: customerDaysLeft !== null && customerDaysLeft <= 0 ? COLORS.dangerLight : COLORS.bg, fg: customerDaysLeft !== null && customerDaysLeft <= 0 ? COLORS.danger : COLORS.text, border: customerDaysLeft !== null && customerDaysLeft <= 0 ? '#f5c6cb' : COLORS.border, tip: 'The date the customer said they\'d come back to pay. Try to reach them before this date.' },
            { label: 'Internal Deadline', date: timeline.internal_deadline, bg: COLORS.bg, fg: COLORS.text, border: COLORS.border, tip: 'A private reminder date for staff — set earlier than the customer\'s return date. Start chasing the customer by this point.' },
            { label: 'Grace Period Ends', date: timeline.grace_end_date, bg: '#f3e8ff', fg: '#7c3aed', border: '#d8b4fe', tip: 'The last day of the extra time after the internal deadline. After this, we can start selling the item.' },
            { label: 'Sale Eligible From', date: timeline.sale_allowed_date, bg: '#f0fdf4', fg: '#166534', border: '#86efac', tip: 'From this date, if the customer still hasn\'t paid, we\'re allowed to sell their item to get our money back.' },
          ].filter(item => item.date).map(({ label, date, bg, fg, border, tip }) => (
            <div key={label} style={{ padding: '10px 12px', background: bg, borderRadius: '8px', border: `1px solid ${border}` }}>
              <div style={{ fontSize: '10.5px', fontWeight: 700, color: fg === COLORS.text ? COLORS.textMuted : fg, textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: '4px', display: 'flex', alignItems: 'center' }}>{label}<InfoIcon tip={tip} /></div>
              <div style={{ fontSize: '13.5px', fontWeight: 700, color: fg }}>{fmtDate(date)}</div>
              <div style={{ marginTop: '5px', display: 'inline-block', fontSize: '10px', fontWeight: 600, padding: '2px 7px', borderRadius: '20px', background: 'rgba(0,0,0,0.07)', color: fg === COLORS.text ? COLORS.textMuted : fg, letterSpacing: '0.2px' }}>{relativeDateLabel(date)}</div>
            </div>
          ))}
        </div>
        {customerDaysLeft !== null && (
          <div style={{ padding: '10px 12px', background: customerDaysLeft < 0 ? COLORS.dangerLight : customerDaysLeft === 0 ? COLORS.dangerLight : customerDaysLeft <= 7 ? '#fef3c7' : COLORS.primaryLight, borderRadius: '8px', fontSize: '13px', color: customerDaysLeft <= 0 ? COLORS.danger : customerDaysLeft <= 7 ? '#92400e' : COLORS.primary, fontWeight: 600 }}>
            {customerDaysLeft < 0 ? `⚠️ Customer is ${Math.abs(customerDaysLeft)} day${Math.abs(customerDaysLeft) !== 1 ? 's' : ''} overdue on their agreed return date.` : customerDaysLeft === 0 ? '🔴 Customer return is due today.' : `⏰ ${customerDaysLeft} day${customerDaysLeft !== 1 ? 's' : ''} remaining until customer's agreed return date.`}
          </div>
        )}
      </div>
    )}

    {/* ── Screening & Notes ── */}
    <div style={S.card}>
      <div style={S.cardTitle}>🧾 Screening & Notes</div>
      {row('Duration in Use', tx.screeningDuration ? (tx.screeningDuration === 'Other' ? `Other — ${tx.screeningDurationOther || 'unspecified'}` : tx.screeningDuration) : null)}
      {row('Where Purchased', tx.screeningPurchaseLocation ? (tx.screeningPurchaseLocation === 'Other' ? `Other — ${tx.screeningPurchaseLocationOther || 'unspecified'}` : tx.screeningPurchaseLocationOther ? `${tx.screeningPurchaseLocation} (${tx.screeningPurchaseLocationOther})` : tx.screeningPurchaseLocation) : null)}
      {row('Registered in Customer Name', tx.screeningRegistered)}
      {row('Other Users on Device', tx.screeningOthersUsing)}
      {row('Red Flag Detected', tx.screeningRedFlag ? '🚩 Yes — Review required' : '✅ None', tx.screeningRedFlag ? COLORS.danger : '#166534')}
      {tx.notes && row('Staff Notes', tx.notes)}
      {!tx.screeningDuration && !tx.screeningPurchaseLocation && !tx.screeningRegistered && !tx.screeningOthersUsing && !tx.notes && (
        <div style={{ color: COLORS.textMuted, fontSize: '13px' }}>No screening data captured.</div>
      )}
    </div>

    {/* ── Photos ── */}
    <div style={S.card}>
      <div style={S.cardTitle}>📸 Photos</div>
      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
        {[
          tx.ninPhoto,
          tx.photoCustomerHolding,
          tx.photoCustomerID,
          ...(normalizeItemPhotos(tx.itemPhotos)),
          tx.imeiPhoto,
          tx.serialNumberPhoto,
          tx.receiptPhoto,
          tx.photoSigning,
          tx.photoSealedPkg,
        ]
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
              <img
                src={p}
                alt={`Transaction photo ${i + 1}`}
                style={{ width: '100px', height: '100px', borderRadius: '8px', objectFit: 'cover', display: 'block' }}
                onError={e => {
                  e.currentTarget.onerror = null;
                  e.currentTarget.style.background = '#fee2e2';
                  e.currentTarget.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100'%3E%3Crect width='100' height='100' fill='%23fee2e2'/%3E%3Ctext x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' font-size='11' fill='%23dc2626'%3EPhoto%0Aunavailable%3C/text%3E%3C/svg%3E";
                }}
              />
            </button>
          ))}
      </div>
      <div style={{ marginTop: '8px', fontSize: '12px', color: COLORS.textMuted }}>Tap any photo to zoom and download.</div>
    </div>

    {/* ── Contact Log ── */}
    <div style={S.card}>
      <div style={{ ...S.cardTitle, justifyContent: 'space-between', alignItems: 'center' }}>
        <span>📋 Contact Log</span>
        {tx.status === 'active' && isStaff && (
          <button style={S.btnSm('accent')} onClick={() => setLoggingContactTx(tx)}>+ Log Contact Attempt</button>
        )}
      </div>
      {(tx.contactLog?.length > 0) ? (
        <div>
          {[...tx.contactLog].reverse().map((entry, i) => (
            <div key={i} style={{ padding: '10px 0', borderBottom: i < tx.contactLog.length - 1 ? `1px solid ${COLORS.border}` : 'none' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px', flexWrap: 'wrap', gap: '4px' }}>
                <span style={{ ...S.badge(OUTCOME_COLORS[entry.result] || '#6b7280'), fontSize: '12px' }}>{CONTACT_OUTCOME_LABEL[entry.result] || entry.result}</span>
                <span style={{ fontSize: '12px', color: COLORS.textMuted }}>{entry.date} {entry.time}</span>
              </div>
              {entry.notes && <div style={{ fontSize: '13px', marginTop: '4px' }}>{entry.notes}</div>}
              <div style={{ fontSize: '11px', color: COLORS.textMuted, marginTop: '3px' }}>Logged by {entry.loggedBy}</div>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ color: COLORS.textMuted, fontSize: '13px' }}>No contact attempts logged yet.{tx.status === 'active' && ' Use the button above to record a call attempt.'}</div>
      )}
    </div>

    <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginTop: '16px' }}>
      <button style={S.btn('outline')} onClick={() => navigate(-1)}>← Back</button>
      {tx.status === 'active' && isStaff && (
        <button style={S.btn('accent')} onClick={() => navigate(txRepayPath(tx.ref))}>💰 Collect Repayment</button>
      )}
      {tx.status === 'active' && isStaff && (
        <button style={S.btn('outline')} onClick={async () => {
          const ok = window.confirm(
            `⚠️ CUSTOMER EARLY SURRENDER\n\n` +
            `This marks the item as voluntarily surrendered by the customer.\n\n` +
            `What this means:\n` +
            `• The customer is giving up their right to reclaim this item\n` +
            `• They forfeit any claim even if their deadline has not yet passed\n` +
            `• The item moves to "Ready to Sell" so it can be listed in the shop\n` +
            `• This action CANNOT be undone\n\n` +
            `Only do this if the customer has explicitly agreed and confirmed in person.\n\n` +
            `Proceed with marking "${tx.aiBrand || ''} ${tx.aiModel || ''}" as surrendered?`
          );
          if (!ok) return;
          await saveTx({ ...tx, status: 'ready_to_sell', surrenderDate: new Date().toISOString().slice(0, 10), surrenderedBy: currentUser?.name || currentUser?.email || 'Staff' });
          loadData();
        }}>🤝 Customer Surrenders Item</button>
      )}
      {(tx.status === 'active' && tx.isEligibleForSale) || tx.status === 'ready_to_sell' ? (
        isStaff ? <button style={S.btn('accent')} onClick={() => setShopListingTx(tx)}>🏪 List in Shop</button> : null
      ) : null}
      {tx.status === 'for_sale' && isStaff && (
        <button style={S.btn('accent')} onClick={() => setShopListingTx(tx)}>🏪 Edit Listing</button>
      )}
      {tx.status === 'for_sale' && isStaff && (
        <button style={S.btn('outline')} onClick={async () => {
          if (window.confirm('Remove this item from the public shop?\n\nIt will be removed from the public shop and moved back into sellable inventory so it can be re-listed at any time.')) {
            const returnStatus = tx.surrenderDate ? 'ready_to_sell' : 'active';
            await saveTx({ ...tx, status: returnStatus, listedForSaleDate: null });
            loadData();
          }
        }}>✕ Unlist</button>
      )}
      {(tx.status === 'for_sale' || (tx.status === 'active' && tx.isEligibleForSale) || tx.status === 'ready_to_sell') && isStaff && (
        <button style={S.btn('danger')} onClick={() => navigate(txSellPath(tx.ref))}>🏷 Record Sale</button>
      )}
    </div>
  </div>);
}

// ============================================================
// MAIN APPLICATION
// ============================================================
// --- Modal components lifted outside App so React never remounts them on re-renders (prevents input focus loss) ---

function SettingsPwdModal({ showSettingsPwdModal, setShowSettingsPwdModal, settingsPwdInput, setSettingsPwdInput, settingsPwdError, setSettingsPwdError, settingsPwdLoading, setSettingsPwdLoading, pendingSettings, setPendingSettings, saveSettings }) {
  const handleConfirm = async () => {
    if (!settingsPwdInput.trim()) { setSettingsPwdError('Please enter your password.'); return; }
    setSettingsPwdLoading(true);
    setSettingsPwdError('');
    const res = await API.post('verify-password', { password: settingsPwdInput });
    setSettingsPwdLoading(false);
    if (res?.ok) {
      await saveSettings(pendingSettings);
      setPendingSettings(null);
      setShowSettingsPwdModal(false);
      setSettingsPwdInput('');
    } else {
      setSettingsPwdError(res?.error || 'Incorrect password. Please try again.');
    }
  };
  return (
    <Modal open={showSettingsPwdModal} onClose={() => { setShowSettingsPwdModal(false); setSettingsPwdError(''); }} title="Confirm Settings Changes">
      <p style={{ fontSize: '14px', color: COLORS.text, marginBottom: '16px' }}>Enter your admin password to apply the settings changes.</p>
      <Field label="Admin Password" required>
        <input
          style={S.input}
          type="password"
          autoFocus
          value={settingsPwdInput}
          onChange={e => setSettingsPwdInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleConfirm()}
          placeholder="Your password"
        />
      </Field>
      {settingsPwdError && <div style={{ color: COLORS.danger, fontSize: '13px', marginBottom: '10px' }}>{settingsPwdError}</div>}
      <div style={{ display: 'flex', gap: '10px' }}>
        <button style={S.btn('primary')} onClick={handleConfirm} disabled={settingsPwdLoading}>
          {settingsPwdLoading ? 'Verifying…' : 'Confirm & Save'}
        </button>
        <button style={S.btn('outline')} onClick={() => { setShowSettingsPwdModal(false); setSettingsPwdError(''); }}>Cancel</button>
      </div>
    </Modal>
  );
}

function ExpModal({ showAddExpense, setShowAddExpense, expForm, setExpForm, settings, currentUser, setExpenses, loadData }) {
  const expCats = settings.expenseCategories || DEFAULT_SETTINGS.expenseCategories;
  const missingRequired = !expForm.date || !expForm.description.trim() || !(Number(expForm.amount) > 0);
  return (
    <Modal open={showAddExpense} onClose={() => setShowAddExpense(false)} title="Add Expense">
      <div style={{ ...S.alert('info'), marginBottom: '12px' }}>Fields marked with <strong>*</strong> are mandatory. Use a clear description so stakeholders understand why money left the business.</div>
      {missingRequired && <div style={{ ...S.alert('danger'), marginBottom: '12px' }}>⛔ Date, Description, and a valid Amount are required to save an expense.</div>}
      <div style={S.grid2}>
        <Field label="Date" required><input style={S.input} type="date" value={expForm.date} onClick={e => e.target.showPicker && e.target.showPicker()} onChange={e => setExpForm({ ...expForm, date: e.target.value })} /></Field>
        <Field label="Category" required>
          <select style={S.select} value={expForm.category} onChange={e => setExpForm({ ...expForm, category: e.target.value })}>
            {expCats.map(c => <option key={c}>{c}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Description" required><input style={S.input} value={expForm.description} onChange={e => setExpForm({ ...expForm, description: e.target.value })} /></Field>
      <Field label="Amount (₦)" required><input style={S.input} type="number" value={expForm.amount} placeholder="0" onChange={e => setExpForm({ ...expForm, amount: e.target.value })} /></Field>
      <button style={S.btn('primary')} disabled={missingRequired} onClick={async () => {
        const e2 = { ...expForm, amount: Number(expForm.amount) || 0 };
        const registeredBy = currentUser?.username || currentUser?.name || null;
        setExpenses(prev => [{ ...e2, id: Date.now(), registered_by: registeredBy }, ...prev]);
        setShowAddExpense(false);
        await API.post('expenses', e2);
        loadData();
      }}>Save</button>
    </Modal>
  );
}

function CapModal({ showAddCapital, setShowAddCapital, capitalTopUpFor, setCapitalTopUpFor, capital, setCapital, capForm, setCapForm, capShowPwd, setCapShowPwd, capAccountMode, setCapAccountMode, capSelectedUserId, setCapSelectedUserId, users, setUsers, loadData }) {
  const isTopUp = !!capitalTopUpFor;
  const existingNames = [...new Set(capital.map(c => c.name))];
  const linkedEntry = isTopUp ? capital.find(c => c.name.toLowerCase() === capitalTopUpFor.toLowerCase()) : null;
  const linkedUserId = linkedEntry?.user_id || null;
  const linkedUser = linkedUserId ? users.find(u => u.id === linkedUserId) : null;
  const availableUsers = users.filter(u => u.id !== 'admin');
  const closeModal = () => { setShowAddCapital(false); setCapitalTopUpFor(null); };
  const missingBaseFields = !capForm.name.trim() || !(Number(capForm.amount) > 0) || !capForm.date || !capForm.method.trim();
  const requiresExistingUserSelection = !isTopUp && capAccountMode === 'existing' && !capSelectedUserId;
  const requiresNewAccountCredentials = !isTopUp && capAccountMode === 'new' && (!capForm.username.trim() || !capForm.password.trim());
  const missingRequired = missingBaseFields || requiresExistingUserSelection || requiresNewAccountCredentials;
  const handleSave = async () => {
    const amount = Number(capForm.amount) || 0;
    if (missingRequired) return;
    let userId = linkedUserId;
    if (!isTopUp) {
      if (capAccountMode === 'existing' && capSelectedUserId) {
        userId = capSelectedUserId;
        // Grant stakeholder role to the linked user if they don't have it yet
        const existingUser = users.find(u => u.id === capSelectedUserId);
        if (existingUser && !hasRole(existingUser, 'stakeholder')) {
          const newRoles = [...(existingUser.roles || []), 'stakeholder'];
          setUsers(prev => prev.map(x => x.id === capSelectedUserId ? { ...x, roles: newRoles } : x));
          await API.put(`users/${capSelectedUserId}`, { roles: newRoles });
        }
      } else if (capAccountMode === 'new' && capForm.username.trim() && capForm.password.trim()) {
        userId = `u-${Date.now()}`;
        const newUser = { id: userId, name: capForm.name.trim(), username: capForm.username.trim(), password: capForm.password.trim(), role: 'stakeholder' };
        setUsers(prev => [...prev, { ...newUser, roles: [], created_at: new Date().toISOString() }]);
        await API.post('users', newUser);
      }
    }
    const capEntry = { name: capForm.name.trim(), amount, date: capForm.date, method: capForm.method.trim(), receipt: capForm.receipt, user_id: userId };
    setCapital(prev => [...prev, { ...capEntry, id: Date.now() }]);
    closeModal();
    await API.post('capital', capEntry);
    loadData();
  };
  return (
    <Modal open={showAddCapital} onClose={closeModal} title={isTopUp ? `Top Up Capital — ${capitalTopUpFor}` : 'Add New Stakeholder'}>
      <div style={{ ...S.alert('info'), marginBottom: '12px' }}>Fields marked with <strong>*</strong> are mandatory. A login account is optional unless you choose <strong>Link to existing user</strong> or <strong>Create new stakeholder account</strong>.</div>
      {missingRequired && <div style={{ ...S.alert('danger'), marginBottom: '12px' }}>⛔ {missingBaseFields ? 'Stakeholder Name, Amount, Date, and Method/Bank are required.' : requiresExistingUserSelection ? 'Select the existing user account you want to link to this stakeholder.' : 'Username and Password are required when creating a new stakeholder login.'}</div>}
      <div style={S.grid2}>
        <Field label="Stakeholder Name" required>
          {isTopUp
            ? <input style={{ ...S.input, background: '#f3f4f6', color: COLORS.textMuted }} value={capForm.name} readOnly />
            : <><input style={S.input} list="cap-names" value={capForm.name} onChange={e => setCapForm({ ...capForm, name: e.target.value })} placeholder="Full name" /><datalist id="cap-names">{existingNames.map(n => <option key={n} value={n} />)}</datalist></>}
        </Field>
        {isTopUp
          ? <Field label="Account">{linkedUser ? <input style={{ ...S.input, background: '#f3f4f6', color: COLORS.textMuted }} value={`@${linkedUser.username}`} readOnly /> : <span style={{ fontSize: '13px', color: COLORS.textMuted, lineHeight: '40px' }}>No account linked</span>}</Field>
          : <div />}
        <Field label="Amount (₦)" required><input style={S.input} type="number" value={capForm.amount} placeholder="0" onChange={e => setCapForm({ ...capForm, amount: e.target.value })} /></Field>
        <Field label="Date" required><input style={S.input} type="date" value={capForm.date} onClick={e => e.target.showPicker && e.target.showPicker()} onChange={e => setCapForm({ ...capForm, date: e.target.value })} /></Field>
        <Field label="Method/Bank" required style={{ gridColumn: '1 / -1' }}><input style={S.input} value={capForm.method} onChange={e => setCapForm({ ...capForm, method: e.target.value })} placeholder="e.g. GTBank Transfer" /></Field>
      </div>
      {!isTopUp && (
        <div style={{ margin: '16px 0 8px', padding: '14px', background: COLORS.primaryLight, borderRadius: '10px', border: `1px solid ${COLORS.border}` }}>
          <div style={{ fontSize: '13px', fontWeight: 700, marginBottom: '10px', color: COLORS.primaryDark }}>Login Account</div>
          <Field label="Account type"><div style={{ fontSize: '11px', color: COLORS.textMuted, marginBottom: '4px' }}>Choose <strong>No account</strong> if this investor should not log in. Choose one of the other options only when business policy requires login access.</div>
            <select style={S.select} value={capAccountMode} onChange={e => { setCapAccountMode(e.target.value); setCapSelectedUserId(''); }}>
              <option value="none">No account — stakeholder without login</option>
              <option value="existing">Link to existing user (e.g. staff who is also a stakeholder)</option>
              <option value="new">Create new stakeholder account</option>
            </select>
          </Field>
          {capAccountMode === 'existing' && (
            <Field label="Select User" required>
              <select style={S.select} value={capSelectedUserId} onChange={e => { setCapSelectedUserId(e.target.value); const u = availableUsers.find(x => x.id === e.target.value); if (u && !capForm.name.trim()) setCapForm(prev => ({ ...prev, name: u.name })); }}>
                <option value="">— Select a user —</option>
                {availableUsers.map(u => <option key={u.id} value={u.id}>{u.name} (@{u.username}) — {u.role}{(u.roles || []).length ? ` + ${u.roles.join(', ')}` : ''}</option>)}
              </select>
              <div style={{ fontSize: '11px', color: COLORS.textMuted, marginTop: '4px' }}>The stakeholder role will be automatically granted to this user so they can view capital &amp; profits.</div>
            </Field>
          )}
          {capAccountMode === 'new' && (
            <div style={S.grid2}>
              <Field label="Username" required><input style={S.input} value={capForm.username} onChange={e => setCapForm({ ...capForm, username: e.target.value })} placeholder="Login username" autoComplete="off" /></Field>
              <Field label="Password" required><div style={{ display: 'flex', gap: '8px' }}><input style={S.input} type={capShowPwd ? 'text' : 'password'} value={capForm.password} onChange={e => setCapForm({ ...capForm, password: e.target.value })} placeholder="Set a password" autoComplete="new-password" /><button type="button" style={S.btnSm('accent')} onClick={() => setCapShowPwd(v => !v)}>{capShowPwd ? '🙈' : '👁'}</button></div></Field>
            </div>
          )}
        </div>
      )}
      <Field label="Transfer Receipt (optional)"><PhotoUpload label="Receipt" value={capForm.receipt} onChange={v => setCapForm({ ...capForm, receipt: v })} size={120} /></Field>
      <button style={S.btn('primary')} disabled={missingRequired} onClick={handleSave}>Save</button>
    </Modal>
  );
}

function DistModal({ showAddDistribution, setShowAddDistribution, distForm, setDistForm, setDistributions, currentUser, loadData }) {
  const missingRequired = !distForm.date || !(Number(distForm.amount) > 0) || !distForm.method;
  const handleSave = async () => {
    const amount = Number(distForm.amount) || 0;
    if (!amount || !distForm.date || !distForm.method) return;
    const entry = { date: distForm.date, amount, method: distForm.method, note: distForm.note.trim(), receipt: distForm.receipt };
    const res = await API.post('distributions', entry);
    if (res?.error) { window.alert(res.error); return; }
    setDistributions(prev => [{ ...entry, id: Date.now(), created_by: currentUser?.name || currentUser?.username || '', created_at: new Date().toISOString() }, ...prev]);
    setShowAddDistribution(false);
    loadData();
  };
  return (
    <Modal open={showAddDistribution} onClose={() => setShowAddDistribution(false)} title="Record Profit Distribution">
      <div style={{ fontSize: '13px', color: COLORS.textMuted, marginBottom: '16px', padding: '10px 12px', background: COLORS.primaryLight, borderRadius: '8px' }}>
        Record a payment made to stakeholders from the business profit. Fields marked with <strong>*</strong> are mandatory. This amount will be deducted from the available lending capital.
      </div>
      {missingRequired && <div style={{ ...S.alert('danger'), marginBottom: '12px' }}>⛔ Date, Total Amount Distributed, and Payment Method are required.</div>}
      <div style={S.grid2}>
        <Field label="Date" required><input style={S.input} type="date" value={distForm.date} onClick={e => e.target.showPicker && e.target.showPicker()} onChange={e => setDistForm({ ...distForm, date: e.target.value })} /></Field>
        <Field label="Total Amount Distributed (₦)" required><input style={S.input} type="number" value={distForm.amount} placeholder="0" onChange={e => setDistForm({ ...distForm, amount: e.target.value })} /></Field>
        <Field label="Payment Method" required style={{ gridColumn: '1 / -1' }}>
          <select style={S.select} value={distForm.method} onChange={e => setDistForm({ ...distForm, method: e.target.value })}>
            <option value="">— Select method —</option>
            <option value="Cash">Cash</option>
            <option value="Bank Transfer">Bank Transfer</option>
            <option value="Mobile Transfer (Opay/Palmpay)">Mobile Transfer (Opay/Palmpay)</option>
            <option value="Cheque">Cheque</option>
          </select>
        </Field>
        <Field label="Note (optional)" style={{ gridColumn: '1 / -1' }}>
          <textarea style={S.textarea} value={distForm.note} placeholder="e.g. Q1 2026 profit share, Month of January…" onChange={e => setDistForm({ ...distForm, note: e.target.value })} rows={2} />
        </Field>
      </div>
      <Field label="Receipt / Proof of Payment (optional)">
        <PhotoUpload label="Receipt" value={distForm.receipt} onChange={v => setDistForm({ ...distForm, receipt: v })} size={120} />
      </Field>
      <button style={S.btn('primary')} disabled={missingRequired} onClick={handleSave}>Save Distribution</button>
    </Modal>
  );
}

function DecModal({ showAddDeclined, setShowAddDeclined, decForm, setDecForm, setDeclinedLog, loadData }) {
  const missingRequired = !decForm.date || !decForm.item.trim() || !decForm.reason;
  return (
    <Modal open={showAddDeclined} onClose={() => setShowAddDeclined(false)} title="Log Declined Customer">
      <div style={{ ...S.alert('info'), marginBottom: '12px' }}>Fields marked with <strong>*</strong> are mandatory. Customer name and NIN/BVN stay optional because some declines happen before ID capture is complete.</div>
      {missingRequired && <div style={{ ...S.alert('danger'), marginBottom: '12px' }}>⛔ Date, Item Brought, and Decline Reason are required before saving this log entry.</div>}
      <div style={S.grid2}>
        <Field label="Date" required>
          <input style={S.input} type="date" value={decForm.date} onClick={e => e.target.showPicker && e.target.showPicker()} onChange={e => setDecForm({ ...decForm, date: e.target.value })} />
        </Field>
        <Field label="Ref # (optional)">
          <input style={S.input} value={decForm.ref} onChange={e => setDecForm({ ...decForm, ref: e.target.value })} placeholder="e.g. CFC-20240101-A1B2" />
        </Field>
      </div>
      <div style={S.grid2}>
        <Field label="Customer Name (optional)">
          <input style={S.input} value={decForm.customerName} onChange={e => setDecForm({ ...decForm, customerName: e.target.value })} placeholder="e.g. David Chukwuemeka" />
        </Field>
        <Field label="NIN / BVN (optional)">
          <input style={S.input} value={decForm.ninBvn} onChange={e => setDecForm({ ...decForm, ninBvn: e.target.value })} placeholder="e.g. NIN: 12345678901" />
        </Field>
      </div>
      <Field label="Item Brought" required>
        <input style={S.input} value={decForm.item} onChange={e => setDecForm({ ...decForm, item: e.target.value })} placeholder="e.g. Smartphone Samsung Galaxy A14" />
      </Field>
      <Field label="Decline Reason" required>
        <select style={S.select} value={decForm.reason} onChange={e => setDecForm({ ...decForm, reason: e.target.value })}>
          <option value="">— Select a reason —</option>
          {DECLINE_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
      </Field>
      <Field label="Additional Notes (optional)">
        <textarea style={S.textarea} value={decForm.notes} onChange={e => setDecForm({ ...decForm, notes: e.target.value })} placeholder="e.g. NIN photo did not match, customer gave two different answers about purchase date…" rows={3} />
      </Field>
      <button style={S.btn('primary')} disabled={missingRequired} onClick={async () => { if (missingRequired) return; const result = await API.post('declined', decForm); if (result?.success) { setDeclinedLog(prev => [{ ...decForm, id: Date.now() }, ...prev]); setShowAddDeclined(false); } loadData(); }}>Save</button>
    </Modal>
  );
}

function DeclineDraftModal({ declineDraftModal, setDeclineDraftModal, declineDraftDec, setDeclineDraftDec, setDeclinedLog, setDrafts, currentUser, loadData }) {
  const d = declineDraftModal;
  if (!d) return null;
  const missingRequired = !declineDraftDec.date || !declineDraftDec.item.trim() || !declineDraftDec.reason;
  const handleSave = async () => {
    const declinedTx = { ...d, status: 'declined', declineReason: `Declined - ${declineDraftDec.reason}`, wizardStep: null, completedBy: currentUser?.name || '', completedAt: new Date().toISOString() };
    const entry = { ...declineDraftDec, id: Date.now() };
    setDeclinedLog(prev => [entry, ...prev]);
    setDeclineDraftModal(null);
    setDrafts(prev => prev.filter(x => x.ref !== d.ref));
    await API.post('transactions', declinedTx);
    await API.post('declined', declineDraftDec);
    await API.del(`drafts/${encodeURIComponent(d.ref)}`);
    loadData();
  };
  return (
    <Modal open={!!d} onClose={() => setDeclineDraftModal(null)} title="🚫 Decline In-Progress Draft">
      <div style={{ ...S.alert('warning'), marginBottom: '12px' }}>
        ⚠️ This will decline and remove the draft. Fields marked with <strong>*</strong> are mandatory. Customer details stay optional because staff may decline before full ID capture is completed.
      </div>
      {missingRequired && <div style={{ ...S.alert('danger'), marginBottom: '12px' }}>⛔ Date, Item Brought, and Decline Reason are required before you can decline this draft.</div>}
      <div style={S.grid2}>
        <Field label="Date" required>
          <input style={S.input} type="date" value={declineDraftDec.date} onClick={e => e.target.showPicker && e.target.showPicker()} onChange={e => setDeclineDraftDec({ ...declineDraftDec, date: e.target.value })} />
        </Field>
        <Field label="Ref #">
          <input style={{ ...S.input, background: COLORS.bg }} value={declineDraftDec.ref} readOnly />
        </Field>
      </div>
      <div style={S.grid2}>
        <Field label="Customer Name">
          <input style={S.input} value={declineDraftDec.customerName} onChange={e => setDeclineDraftDec({ ...declineDraftDec, customerName: e.target.value })} placeholder="e.g. David Chukwuemeka" />
        </Field>
        <Field label="NIN / BVN">
          <input style={S.input} value={declineDraftDec.ninBvn} onChange={e => setDeclineDraftDec({ ...declineDraftDec, ninBvn: e.target.value })} placeholder="e.g. NIN: 12345678901" />
        </Field>
      </div>
      <Field label="Item Brought" required>
        <input style={S.input} value={declineDraftDec.item} onChange={e => setDeclineDraftDec({ ...declineDraftDec, item: e.target.value })} placeholder="e.g. Smartphone Samsung Galaxy A14" />
      </Field>
      <Field label="Decline Reason" required>
        <select style={S.select} value={declineDraftDec.reason} onChange={e => setDeclineDraftDec({ ...declineDraftDec, reason: e.target.value })}>
          <option value="">— Select a reason —</option>
          {DECLINE_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
      </Field>
      <Field label="Additional Notes (optional)">
        <textarea style={S.textarea} value={declineDraftDec.notes} onChange={e => setDeclineDraftDec({ ...declineDraftDec, notes: e.target.value })} placeholder="e.g. Customer gave two different answers about purchase date…" rows={3} />
      </Field>
      <div style={{ display: 'flex', gap: '12px', marginTop: '4px' }}>
        <button style={{ ...S.btn('danger'), flex: 1, justifyContent: 'center' }} disabled={missingRequired} onClick={handleSave}>
          🚫 Decline &amp; Save to Log
        </button>
        <button style={{ ...S.btn('muted'), flex: 1, justifyContent: 'center' }} onClick={() => setDeclineDraftModal(null)}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}

function EditUserModal({ showEditUser, setShowEditUser, editUserUsername, setEditUserUsername, editUserPassword, setEditUserPassword, editUserShowPwd, setEditUserShowPwd, setUsers, loadData, loadActivityLogs }) {
  const u = showEditUser;
  if (!u) return null;
  const handleSave = async () => {
    const payload = {};
    if (editUserUsername.trim() && editUserUsername.trim() !== u.username) payload.username = editUserUsername.trim();
    if (editUserPassword.trim()) payload.password = editUserPassword.trim();
    if (!Object.keys(payload).length) { setShowEditUser(null); return; }
    setUsers(prev => prev.map(x => x.id === u.id ? { ...x, ...(payload.username ? { username: payload.username } : {}) } : x));
    setShowEditUser(null);
    await API.put(`users/${u.id}`, payload);
    loadData(); loadActivityLogs();
  };
  return (
    <Modal open={!!showEditUser} onClose={() => setShowEditUser(null)} title={`Edit Account — ${u.name}`}>
      <div style={{ fontSize: '13px', color: COLORS.textMuted, marginBottom: '16px' }}>Leave a field blank to keep it unchanged.</div>
      <Field label="New Username"><input style={S.input} value={editUserUsername} onChange={e => setEditUserUsername(e.target.value)} placeholder={u.username} autoComplete="off" /></Field>
      <Field label="New Password"><div style={{ display: 'flex', gap: '8px' }}><input style={S.input} type={editUserShowPwd ? 'text' : 'password'} value={editUserPassword} onChange={e => setEditUserPassword(e.target.value)} placeholder="Leave blank to keep current" autoComplete="new-password" /><button type="button" style={S.btnSm('accent')} onClick={() => setEditUserShowPwd(v => !v)}>{editUserShowPwd ? '🙈' : '👁'}</button></div></Field>
      <button style={S.btn('primary')} onClick={handleSave}>Save Changes</button>
    </Modal>
  );
}

function UsrModal({ showAddUser, setShowAddUser, usrForm, setUsrForm, usrShowPwd, setUsrShowPwd, loadData }) {
  const missingRequired = !usrForm.name.trim() || !usrForm.username.trim() || !usrForm.password.trim() || !usrForm.role;
  return (
    <Modal open={showAddUser} onClose={() => setShowAddUser(false)} title="Add User">
      <div style={{ ...S.alert('info'), marginBottom: '12px' }}>Fields marked with <strong>*</strong> are mandatory. A single user can later be granted the stakeholder role as an extra permission, so only choose <strong>Stakeholder</strong> as the main role when that person is not staff/admin.</div>
      {missingRequired && <div style={{ ...S.alert('danger'), marginBottom: '12px' }}>⛔ Name, Username, Password, and Role are required to create a user account.</div>}
      <div style={S.grid2}>
        <Field label="Name" required><input style={S.input} value={usrForm.name} onChange={e => setUsrForm({ ...usrForm, name: e.target.value })} /></Field>
        <Field label="Username" required><input style={S.input} value={usrForm.username} onChange={e => setUsrForm({ ...usrForm, username: e.target.value })} /></Field>
        <Field label="Password" required><div style={{ display: 'flex', gap: '8px' }}><input style={S.input} type={usrShowPwd ? 'text' : 'password'} value={usrForm.password} onChange={e => setUsrForm({ ...usrForm, password: e.target.value })} /><button type="button" style={S.btnSm('accent')} onClick={() => setUsrShowPwd(v => !v)}>{usrShowPwd ? '🙈 Hide' : '👁 Show'}</button></div></Field>
        <Field label="Role" required><select style={S.select} value={usrForm.role} onChange={e => setUsrForm({ ...usrForm, role: e.target.value })}><option value="staff">Staff</option><option value="stakeholder">Stakeholder</option><option value="admin">Admin</option></select></Field>
      </div>
      <button style={S.btn('primary')} disabled={missingRequired} onClick={async () => { if (missingRequired) return; const payload = { ...usrForm, id: `u-${Date.now()}` }; const res = await API.post('users', payload); if (res?.error) { window.alert(res.error); return; } setShowAddUser(false); setUsrForm({ name: '', username: '', password: '', role: 'staff' }); await loadData(); }}>Add</button>
    </Modal>
  );
}

export default function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const [currentUser, setCurrentUser] = useState(() => readCache('cfc_user'));
  const [authLoading, setAuthLoading] = useState(() => !readCache('cfc_user'));
  const [transactions, setTransactions] = useState(() => {
    const cachedSettings = { ...DEFAULT_SETTINGS, ...(readCache('cfc_critical')?.settings || {}) };
    return withLoanTimelines(readCache('cfc_transactions')?.transactions || [], cachedSettings);
  });
  const [drafts, setDrafts] = useState(() => readCache('cfc_transactions')?.drafts || []);
  const [settings, setSettings] = useState(() => ({ ...DEFAULT_SETTINGS, ...(readCache('cfc_critical')?.settings || {}) }));
  const [users, setUsers] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [capital, setCapital] = useState([]);
  const [distributions, setDistributions] = useState([]);
  const [declinedLog, setDeclinedLog] = useState([]);
  const [activityLogs, setActivityLogs] = useState([]);
  const [activityMeta, setActivityMeta] = useState({ total: 0, limit: ACTIVITY_PAGE_SIZE, offset: 0 });
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityFilter, setActivityFilter] = useState({ q: '', from: '', to: '', category: '', sort: 'desc' });
  const [showEditUser, setShowEditUser] = useState(null);
  const [loading, setLoading] = useState(() => !readCache('cfc_user') || !readCache('cfc_critical'));
  const [listLoading, setListLoading] = useState(() => !readCache('cfc_transactions'));
  const [editingTx, setEditingTx] = useState(null);
  const [loggingContactTx, setLoggingContactTx] = useState(null);
  const [shopListingTx, setShopListingTx] = useState(null);
  const [reportYear, setReportYear] = useState(() => new Date().getFullYear());
  const [reportMonth, setReportMonth] = useState(() => new Date().getMonth() + 1);
  const [reportEndYear, setReportEndYear] = useState(() => new Date().getFullYear());
  const [reportEndMonth, setReportEndMonth] = useState(() => new Date().getMonth() + 1);
  const [showAddExpense, setShowAddExpense] = useState(false);
  const [expSearch, setExpSearch] = useState('');
  const [expCategoryFilter, setExpCategoryFilter] = useState('all');
  const [expSortKey, setExpSortKey] = useState('date');
  const [expSortDir, setExpSortDir] = useState('desc');
  const [expDateFrom, setExpDateFrom] = useState('');
  const [expDateTo, setExpDateTo] = useState('');
  const [showAddCapital, setShowAddCapital] = useState(false);
  const [capitalTopUpFor, setCapitalTopUpFor] = useState(null);
  const [showAddDistribution, setShowAddDistribution] = useState(false);
  const [expandedCapital, setExpandedCapital] = useState(new Set());
  const [showAddDeclined, setShowAddDeclined] = useState(false);
  const [declineDraftModal, setDeclineDraftModal] = useState(null); // holds draft object being declined
  const [showAddUser, setShowAddUser] = useState(false);
  const [pendingSettings, setPendingSettings] = useState(null);
  const [showSettingsPwdModal, setShowSettingsPwdModal] = useState(false);
  const [settingsPwdInput, setSettingsPwdInput] = useState('');
  const [settingsPwdError, setSettingsPwdError] = useState('');
  const [settingsPwdLoading, setSettingsPwdLoading] = useState(false);
  // Lifted modal form state — prevents form fields resetting when App re-renders while a modal is open
  const [expForm, setExpForm] = useState({ date: '', category: '', description: '', amount: '' });
  const [distForm, setDistForm] = useState({ date: '', amount: '', method: '', note: '', receipt: '' });
  const [decForm, setDecForm] = useState({ date: '', ref: '', customerName: '', ninBvn: '', item: '', reason: '', notes: '' });
  const [declineDraftDec, setDeclineDraftDec] = useState({ date: '', ref: '', customerName: '', ninBvn: '', item: '', reason: '', notes: '' });
  const [capForm, setCapForm] = useState({ name: '', amount: '', date: '', method: '', receipt: '', username: '', password: '' });
  const [capShowPwd, setCapShowPwd] = useState(false);
  const [capAccountMode, setCapAccountMode] = useState('none');
  const [capSelectedUserId, setCapSelectedUserId] = useState('');
  const [usrForm, setUsrForm] = useState({ name: '', username: '', password: '', role: 'staff' });
  const [usrShowPwd, setUsrShowPwd] = useState(false);
  const [editUserUsername, setEditUserUsername] = useState('');
  const [editUserPassword, setEditUserPassword] = useState('');
  const [editUserShowPwd, setEditUserShowPwd] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [txPages, setTxPages] = useState({});
  const [txSortKey, setTxSortKey] = useState('dateGiven');
  const [txSortDir, setTxSortDir] = useState('desc');
  // For Sale page local state — kept here to avoid defining components with hooks inside switch/case
  const [fsSearch, setFsSearch] = useState('');
  const [fsFilter, setFsFilter] = useState('all'); // 'all' | 'listed' | 'ready'
  const [fsSort, setFsSort] = useState('days_desc');
  const [txStatusFilter, setTxStatusFilter] = useState('all');
  const [txDateFrom, setTxDateFrom] = useState('');
  const [txDateTo, setTxDateTo] = useState('');
  const [txTypeFilter, setTxTypeFilter] = useState('all');
  const [recentTxCount, setRecentTxCount] = useState(5);
  const [dbStatus, setDbStatus] = useState('checking');
  const isMobile = useMobile();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [zoomedPhoto, setZoomedPhoto] = useState(null);

  useEffect(() => {
    const restoreSession = async () => {
      const me = await API.get('me');
      if (me?.id) {
        const normalizedMe = normalizeUser(me);
        writeCache('cfc_user', normalizedMe);
        setCurrentUser(normalizedMe);
      } else {
        // Session invalid or expired — clear cache so next load starts fresh
        clearAuthCache();
        setCurrentUser(null);
      }
      setAuthLoading(false);
      // If not logged in, load public settings in background for landing page
      if (!me?.id) {
        API.get('bootstrap?scope=critical').then(pubData => {
          if (pubData?.settings) setSettings({ ...DEFAULT_SETTINGS, ...pubData.settings });
        }).catch(() => {});
      }
    };
    restoreSession();
  }, []);

  // Load critical data first, then hydrate heavy lists in the background.
  const ACTIVITY_CATS = [
    { value: '', label: 'All Events', type: '', action: '' },
    { value: 'loans', label: '📋 New Loans', type: 'transaction', action: 'entry' },
    { value: 'repayments', label: '✅ Repayments', type: 'transaction', action: 'repaid' },
    { value: 'sales', label: '💰 Sales', type: 'transaction', action: 'sold' },
    { value: 'expense', label: '🧾 Expenses', type: 'expense', action: '' },
    { value: 'capital', label: '💎 Capital', type: 'capital', action: '' },
    { value: 'auth', label: '🔐 Logins', type: 'auth', action: '' },
    { value: 'user', label: '👤 User Changes', type: 'user', action: '' },
    { value: 'settings', label: '⚙️ Settings', type: 'settings', action: '' },
    { value: 'declined', label: '🚫 Declined', type: 'declined', action: '' },
  ];
  const loadActivityLogs = async (filter, offset = 0, append = false) => {
    const f = filter !== undefined ? filter : activityFilter;
    setActivityLoading(true);
    const cat = ACTIVITY_CATS.find(c => c.value === f.category) || ACTIVITY_CATS[0];
    const p = new URLSearchParams({ limit: String(ACTIVITY_PAGE_SIZE), offset: String(offset), sort: f.sort || 'desc' });
    if (f.q && f.q.trim()) p.set('q', f.q.trim());
    if (f.from) p.set('from', f.from);
    if (f.to) p.set('to', f.to);
    if (cat.type) p.set('type', cat.type);
    if (cat.action) p.set('action', cat.action);
    const data = await API.get(`activity-logs?${p}`);
    if (data) {
      setActivityLogs(prev => append ? [...prev, ...(data.logs || [])] : (data.logs || []));
      setActivityMeta({ total: data.total ?? 0, limit: data.limit ?? ACTIVITY_PAGE_SIZE, offset: data.offset ?? offset });
    }
    setActivityLoading(false);
  };
  const loadData = async () => {
    const criticalCache = readCache('cfc_critical');
    const listCache = readCache('cfc_transactions');

    // Only show a full-screen loader if we cannot render the shell from cache.
    if (!criticalCache) setLoading(true);
    if (!listCache) setListLoading(true);

    const critical = await API.get('bootstrap?scope=critical');
    const freshSettings = { ...DEFAULT_SETTINGS, ...(critical?.settings || {}) };
    if (critical) {
      setSettings(freshSettings);
      setDbStatus('connected');
      writeCache('cfc_critical', { settings: critical.settings, summary: critical.summary || {} });
    } else {
      setDbStatus('error');
    }

    setLoading(false);

    // Load large list datasets in the background so navigation/header remain interactive.
    const lists = await API.get('bootstrap?scope=transactions&limit=200&offset=0');
    if (lists) {
      const normalizedTransactions = withLoanTimelines(lists.transactions || [], freshSettings);
      setTransactions(normalizedTransactions);
      setDrafts(lists.drafts || []);
      writeCache('cfc_transactions', { transactions: normalizedTransactions, drafts: lists.drafts || [], pagination: lists.pagination || null });
    }
    setListLoading(false);

    // Load secondary datasets in one background request.
    const role = currentUser?.role || '';
    const secondary = await API.get(`bootstrap?scope=secondary&role=${encodeURIComponent(role)}`);
    if (secondary) {
      setExpenses(secondary.expenses || []);
      setCapital(secondary.capital || []);
      setDistributions(secondary.distributions || []);
      setDeclinedLog(secondary.declined || []);
      setUsers(secondary.users || []);
    }

    await loadActivityLogs();
  };

  useEffect(() => { if (currentUser) loadData(); }, [currentUser]);

  // Reset transaction table to page 1 when route, search, filters, or list data changes
  useEffect(() => { setTxPages({}); }, [location.pathname, searchQuery, txStatusFilter, txDateFrom, txDateTo, txTypeFilter, txSortKey, txSortDir, listLoading]);

  // Auto-open wizard when navigating directly to /transactions/new
  useEffect(() => {
    if (currentUser && location.pathname === PAGE_PATHS.newTransaction && editingTx === null) {
      setEditingTx('new');
    }
  }, [currentUser, location.pathname]);

  // Save helpers
  const saveSettings = async (s) => { setSettings(s); await API.put('settings', s); };
  const saveTx = async (tx) => {
    const existing = transactions.find(t => t.ref === tx.ref);
    const nowIso = new Date().toISOString();
    const preparedTx = withLoanTimeline(tx, settings);
    const nextTx = preparedTx.status === 'for_sale'
      ? { ...preparedTx, listedForSaleDate: preparedTx.listedForSaleDate || existing?.listedForSaleDate || nowIso }
      : preparedTx;
    if (existing) {
      await API.put(`transactions/${encodeURIComponent(nextTx.ref)}`, nextTx);
    } else {
      await API.post('transactions', nextTx);
    }
    setTransactions(prev => { const i = prev.findIndex(t => t.ref === nextTx.ref); if (i >= 0) { const n = [...prev]; n[i] = nextTx; return n; } return [...prev, nextTx]; });
  };

  // Computed stats
  const activeTxs = transactions.filter(t => t.status === 'active');
  const closedTxs = transactions.filter(t => t.status === 'closed');
  const soldTxs = transactions.filter(t => t.status === 'sold');
  const forSaleTxs = transactions.filter(t => t.status === 'for_sale');
  const surrenderedTxs = transactions.filter(t => t.status === 'ready_to_sell'); // early voluntary surrender
  const inGracePeriod = activeTxs.filter(t => t.isInFinalGrace);
  // readyToSell = timeline-eligible actives + explicitly surrendered items
  const readyToSell = [...activeTxs.filter(t => t.isEligibleForSale), ...surrenderedTxs];
  const dueTodayLoans = activeTxs.filter(t => getCustomerDaysLeft(t) === 0);
  const overdueLoans = activeTxs.filter(t => { const dl = getCustomerDaysLeft(t); return dl !== null && dl < 0; });
  const totalCapitalOut = activeTxs.reduce((s, t) => s + (t.cashAdvance || 0), 0);
  const totalCapitalInForSaleInventory = forSaleTxs.reduce((s, t) => s + (t.cashAdvance || 0), 0);
  const totalInterestEarned = closedTxs.reduce((s, t) => s + (t.totalFees || 0), 0);
  const totalSalesRevenue = soldTxs.reduce((s, t) => s + (t.salePrice || 0), 0);
  const totalServiceFees = transactions.filter(t => t.type !== 'outright' && t.status !== 'declined').reduce((sum, t) => sum + (t.serviceFeeAmount ?? (t.serviceFeeCollected ? (settings.serviceFee || 1000) : 0)), 0);
  const totalRevenue = totalInterestEarned + totalSalesRevenue + totalServiceFees;
  const totalExpenses = expenses.reduce((s, e) => s + (e.amount || 0), 0);
  const netProfit = totalRevenue - totalExpenses;
  const totalCapital = capital.reduce((s, c) => s + (c.amount || 0), 0);
  const totalDistributions = distributions.reduce((s, d) => s + (d.amount || 0), 0);
  const availableLendingCapital = totalCapital + netProfit - totalCapitalOut - totalCapitalInForSaleInventory - totalDistributions;

  const filteredTxs = useMemo(() => {
    let result = [...transactions];
    // Text search
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(t =>
        t.ref?.toLowerCase().includes(q) ||
        t.fullName?.toLowerCase().includes(q) ||
        t.phoneNumbers?.some(p => p?.includes(q)) ||
        t.imei?.toLowerCase().includes(q) ||
        t.serialNumber?.toLowerCase().includes(q) ||
        t.idNumber?.toLowerCase().includes(q) ||
        t.aiBrand?.toLowerCase().includes(q) ||
        t.aiModel?.toLowerCase().includes(q) ||
        t.aiColour?.toLowerCase().includes(q) ||
        t.aiCondition?.toLowerCase().includes(q) ||
        t.captureItemType?.toLowerCase().includes(q) ||
        t.address?.toLowerCase().includes(q) ||
        t.familyName?.toLowerCase().includes(q) ||
        t.familyPhone?.includes(q) ||
        t.notes?.toLowerCase().includes(q) ||
        t.conditionDescription?.toLowerCase().includes(q) ||
        t.saleBuyer?.toLowerCase().includes(q)
      );
    }
    // Status filter
    if (txStatusFilter !== 'all') {
      result = result.filter(t => t.status === txStatusFilter);
    }
    // Type filter
    if (txTypeFilter !== 'all') {
      result = result.filter(t => t.type === txTypeFilter);
    }
    // Date range filter
    if (txDateFrom) {
      const from = new Date(txDateFrom);
      result = result.filter(t => t.dateGiven && new Date(t.dateGiven) >= from);
    }
    if (txDateTo) {
      const to = new Date(txDateTo);
      to.setHours(23, 59, 59, 999);
      result = result.filter(t => t.dateGiven && new Date(t.dateGiven) <= to);
    }
    // Sort
    result.sort((a, b) => {
      let av, bv;
      if (txSortKey === 'dateGiven') { av = a.dateGiven ? new Date(a.dateGiven) : null; bv = b.dateGiven ? new Date(b.dateGiven) : null; }
      else if (txSortKey === 'cashAdvance') { av = a.cashAdvance || 0; bv = b.cashAdvance || 0; }
      else if (txSortKey === 'fullName') { av = (a.fullName || '').toLowerCase(); bv = (b.fullName || '').toLowerCase(); }
      else if (txSortKey === 'status') { av = a.status || ''; bv = b.status || ''; }
      else if (txSortKey === 'aiBrand') { av = (a.aiBrand || '').toLowerCase(); bv = (b.aiBrand || '').toLowerCase(); }
      else { av = a[txSortKey]; bv = b[txSortKey]; }
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      if (av < bv) return txSortDir === 'asc' ? -1 : 1;
      if (av > bv) return txSortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return result;
  }, [transactions, searchQuery, txStatusFilter, txTypeFilter, txDateFrom, txDateTo, txSortKey, txSortDir]);

  if (authLoading) return <div style={{ ...S.app, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><div style={{ textAlign: 'center' }}><div style={{ fontSize: '48px', marginBottom: '12px' }}>🔐</div><div style={{ fontWeight: 700 }}>Checking session...</div></div></div>;

  if (loading && currentUser) return <div style={{ ...S.app, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><div style={{ textAlign: 'center' }}><div style={{ display: 'flex', justifyContent: 'center', marginBottom: '12px' }}><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="48" height="48"><path d="M38 35 L25 15 Q50 22 75 15 L62 35 Z" fill="#d2b48c" stroke="#8b7355" strokeWidth="2" strokeLinejoin="round"/><path d="M40 35 L60 35 C75 35 85 60 80 80 C75 95 25 95 20 80 C15 60 25 35 40 35 Z" fill="#deb887" stroke="#8b7355" strokeWidth="2" strokeLinejoin="round"/><path d="M35 35 Q50 38 65 35" fill="none" stroke="#5c4033" strokeWidth="3" strokeLinecap="round"/><text x="50" y="72" fontFamily="Arial, sans-serif" fontSize="34" fontWeight="bold" fill="#2c1e16" textAnchor="middle">₦</text></svg></div><div style={{ fontWeight: 700 }}>Loading essentials...</div></div></div>;

  if (!currentUser) {
    return (
      <Routes>
        <Route path="/check-loan-status" element={<CustomerPortal settings={settings} onBack={() => navigate('/')} />} />
        <Route path="/checkloanstatus" element={<Navigate to="/check-loan-status" replace />} />
        <Route path="/shop" element={<SalesPage settings={settings} onBack={() => navigate('/')} />} />
        <Route path="/login" element={<LoginScreen onLogin={(u) => {
          const normalizedUser = normalizeUser(u);
          writeCache('cfc_user', normalizedUser);
          setCurrentUser(normalizedUser);
          navigate('/dashboard');
        }} />} />
        <Route path="*" element={<LandingPage settings={settings} onCheckLoan={() => navigate('/check-loan-status')} onStaffLogin={() => navigate('/login')} onShop={() => navigate('/shop')} />} />
      </Routes>
    );
  }

  // Allow authenticated users to view the public shop page
  if (location.pathname === '/shop') {
    return <SalesPage settings={settings} onBack={() => navigate('/dashboard')} />;
  }

  // Allow authenticated users to view the landing page
  if (location.pathname === '/landing') {
    return <LandingPage settings={settings} onCheckLoan={() => navigate('/check-loan-status')} onStaffLogin={() => navigate('/dashboard')} onShop={() => navigate('/shop')} />;
  }

  // Redirect authenticated users away from public paths (including root)
  if (['/', '/login', '/checkloanstatus', '/check-loan-status'].includes(location.pathname)) {
    return <Navigate to="/dashboard" replace />;
  }

  // Redirect authenticated users from unknown paths to dashboard
  const knownAuthPaths = Object.values(PAGE_PATHS);
  const txSubUrlMatch = location.pathname.match(/^\/transactions\/(?!new$)([^/]+)(\/collect|\/sell)?$/);
  const isTxSubPageUrl = !!txSubUrlMatch;
  if (!knownAuthPaths.includes(location.pathname) && !isTxSubPageUrl) {
    return <Navigate to="/dashboard" replace />;
  }

  if (editingTx !== null) return (
    <div style={S.app}>
      <div style={{ ...S.topBar, padding: isMobile ? '0 12px' : '0 24px' }}>
        <div style={{ fontWeight: 700, fontSize: isMobile ? '13px' : '15px', display: 'flex', alignItems: 'center', gap: '6px' }}><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="20" height="20" style={{ flexShrink: 0 }}><path d="M38 35 L25 15 Q50 22 75 15 L62 35 Z" fill="#d2b48c" stroke="#8b7355" strokeWidth="2" strokeLinejoin="round"/><path d="M40 35 L60 35 C75 35 85 60 80 80 C75 95 25 95 20 80 C15 60 25 35 40 35 Z" fill="#deb887" stroke="#8b7355" strokeWidth="2" strokeLinejoin="round"/><path d="M35 35 Q50 38 65 35" fill="none" stroke="#5c4033" strokeWidth="3" strokeLinecap="round"/><text x="50" y="72" fontFamily="Arial, sans-serif" fontSize="34" fontWeight="bold" fill="#2c1e16" textAnchor="middle">₦</text></svg><span>{isMobile ? 'New Transaction' : 'CIF Quick Cash — New Transaction'}</span></div>
        <button style={S.btnSm('danger')} onClick={() => { setEditingTx(null); navigate('/dashboard', { replace: true }); loadData(); }}>✕ {isMobile ? '' : 'Exit'}</button>
      </div>
      <div style={{ padding: isMobile ? '12px' : '20px', maxWidth: '900px', margin: '0 auto' }}>
        <TransactionWizard settings={settings} draft={editingTx === 'new' ? null : editingTx} currentUser={currentUser} onSave={(tx) => { saveTx(tx); setEditingTx(null); loadData(); navigate('/dashboard', { replace: true }); }} onCancel={() => { setEditingTx(null); navigate('/dashboard', { replace: true }); loadData(); }} />
      </div>
    </div>
  );

  const isStaff = hasRole(currentUser, 'staff') || hasRole(currentUser, 'admin');
  const isAdmin = hasRole(currentUser, 'admin');
  const distributionAuthorizedUserIds = settings.distributionAuthorizedUserIds || DEFAULT_SETTINGS.distributionAuthorizedUserIds;
  const canRecordDistributions = isAdmin || distributionAuthorizedUserIds.includes(currentUser?.id);

  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: '📊', path: PAGE_PATHS.dashboard, roles: ['staff', 'admin', 'stakeholder'] },
    { id: 'newTx', label: 'New Transaction', icon: '➕', path: PAGE_PATHS.newTransaction, roles: ['staff', 'admin'] },
    { id: 'transactions', label: 'All Transactions', icon: '📋', path: PAGE_PATHS.transactions, roles: ['staff', 'admin', 'stakeholder'] },
    { id: 'actionLoans', label: 'Recovery Queue', icon: '🚨', path: PAGE_PATHS.actionLoans, roles: ['staff', 'admin'] },
    { id: 'deadlines', label: 'Daily Follow-ups', icon: '📞', path: PAGE_PATHS.deadlines, roles: ['staff', 'admin'] },
    { id: 'forSale', label: 'For Sale', icon: '🏷', path: PAGE_PATHS.forSale, roles: ['staff', 'admin', 'stakeholder'] },
    { id: 'reports', label: 'Monthly Report', icon: '📈', path: PAGE_PATHS.reports, roles: ['admin', 'stakeholder'] },
    { id: 'capital', label: 'Capital & Profits', icon: '💎', path: PAGE_PATHS.capital, roles: ['admin', 'stakeholder'] },
    { id: 'expenses', label: 'Expenses', icon: '🧾', path: PAGE_PATHS.expenses, roles: ['staff', 'admin', 'stakeholder'] },
    { id: 'declined', label: 'Declined Log', icon: '🚫', path: PAGE_PATHS.declined, roles: ['staff', 'admin'] },
    { id: 'activity', label: 'Activity Log', icon: '🕘', path: PAGE_PATHS.activity, roles: ['staff', 'admin', 'stakeholder'] },
    { id: 'settings', label: 'Settings', icon: '⚙', path: PAGE_PATHS.settings, roles: ['admin'] },
    { id: 'users', label: 'Users', icon: '👥', path: PAGE_PATHS.users, roles: ['admin'] },
  ].filter(n => n.roles.some(r => hasRole(currentUser, r)));


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
          <img
            src={zoomedPhoto}
            alt="Zoomed transaction"
            style={{ maxWidth: '100%', maxHeight: '80vh', borderRadius: '12px' }}
            onError={e => { e.currentTarget.onerror = null; e.currentTarget.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Crect width='200' height='200' fill='%23fee2e2'/%3E%3Ctext x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' font-size='14' fill='%23dc2626'%3EPhoto unavailable%3C/text%3E%3C/svg%3E"; }}
          />
          <div style={{ display: 'flex', justifyContent: 'center', gap: '12px', marginTop: '16px', flexWrap: 'wrap' }}>
            <button style={{ ...S.btn('primary'), border: 'none', cursor: 'pointer' }} onClick={async () => {
              try {
                const resp = await fetch(zoomedPhoto);
                const blob = await resp.blob();
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url; a.download = `transaction-photo-${Date.now()}.jpg`; a.click();
                URL.revokeObjectURL(url);
              } catch { window.open(zoomedPhoto, '_blank'); }
            }}>⬇ Download</button>
            <button style={S.btn('outline')} onClick={() => setZoomedPhoto(null)}>✕ Close</button>
          </div>
        </div>
      </div>
    );
  };

  // Main page renderer
  const renderPage = () => {
    const page = PAGE_FROM_PATH[location.pathname] || 'dashboard';
    const listLoadingNotice = listLoading ? (<div style={{ ...S.alert('info'), marginBottom: '16px' }}>⏳ Transactions and drafts are still loading in the background...</div>) : null;

    // Transaction sub-pages: /transactions/:ref, /transactions/:ref/collect, /transactions/:ref/sell
    if (isTxSubPageUrl) {
      const txRef = decodeURIComponent(txSubUrlMatch[1]);
      const subPage = txSubUrlMatch[2]; // '/collect', '/sell', or undefined
      const tx = transactions.find(t => t.ref === txRef);
      if (!tx) {
        if (listLoading) return <div style={{ textAlign: 'center', padding: '40px', color: COLORS.textMuted }}>⏳ Loading transaction...</div>;
        return (<div style={S.card}><p style={{ color: COLORS.textMuted }}>Transaction <strong>{txRef}</strong> not found.</p><button style={S.btn('outline')} onClick={() => navigate(PAGE_PATHS.transactions)}>← Back to Transactions</button></div>);
      }
      if (subPage === '/collect') {
        if (!isStaff || tx.status !== 'active') return <Navigate to={txDetailPath(txRef)} replace />;
        return (
          <div>
            <div style={{ marginBottom: '20px' }}>
              <button style={S.btn('outline')} onClick={() => navigate(txDetailPath(txRef))}>← Back to Transaction</button>
              <h2 style={{ fontSize: '20px', fontWeight: 800, color: COLORS.primaryDark, marginTop: '12px' }}>💰 Collect Repayment</h2>
              <div style={{ fontSize: '13px', color: COLORS.textMuted, marginTop: '4px' }}>Ref: <strong>{txRef}</strong> · Customer: <strong>{tx.fullName}</strong> · Item: {tx.aiBrand} {tx.aiModel}</div>
            </div>
            <RepaymentModal tx={tx} settings={settings} currentUser={currentUser} onClose={() => navigate(txDetailPath(txRef))} onSave={async (updatedTx) => { await saveTx(updatedTx); loadData(); navigate(txDetailPath(txRef)); }} />
          </div>
        );
      }
      if (subPage === '/sell') {
        if (!isStaff || (tx.status !== 'for_sale' && tx.status !== 'ready_to_sell' && !(tx.status === 'active' && tx.isEligibleForSale))) return <Navigate to={txDetailPath(txRef)} replace />;
        return (
          <div>
            <div style={{ marginBottom: '20px' }}>
              <button style={S.btn('outline')} onClick={() => navigate(txDetailPath(txRef))}>← Back to Transaction</button>
              <h2 style={{ fontSize: '20px', fontWeight: 800, color: COLORS.primaryDark, marginTop: '12px' }}>🏷 Record Sale</h2>
              <div style={{ fontSize: '13px', color: COLORS.textMuted, marginTop: '4px' }}>Ref: <strong>{txRef}</strong> · Customer: <strong>{tx.fullName}</strong> · Item: {tx.aiBrand} {tx.aiModel}</div>
            </div>
            <SaleModal tx={tx} settings={settings} currentUser={currentUser} onClose={() => navigate(txDetailPath(txRef))} onSave={async (updatedTx) => { await saveTx(updatedTx); loadData(); navigate(txDetailPath(txRef)); }} />
          </div>
        );
      }
      // No sub-page segment → transaction detail
      return <TxDetail tx={tx} settings={settings} isStaff={isStaff} currentUser={currentUser} setZoomedPhoto={setZoomedPhoto} setLoggingContactTx={setLoggingContactTx} saveTx={saveTx} loadData={loadData} setShopListingTx={setShopListingTx} />;
    }

    const TX_PAGE_SIZE = 25;
    const TxTable = ({ items, showActions = true, showDaysListed = false, pageKey = 'default' }) => {
      const totalPages = Math.max(1, Math.ceil(items.length / TX_PAGE_SIZE));
      const currentPage = txPages[pageKey] || 1;
      const safePage = Math.min(currentPage, totalPages);
      const pageItems = items.slice((safePage - 1) * TX_PAGE_SIZE, safePage * TX_PAGE_SIZE);
      const colSpan = showActions ? (showDaysListed ? 8 : 7) : (showDaysListed ? 7 : 6);
      const paginationStyle = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 4px 0', flexWrap: 'wrap', gap: '8px' };
      const pageBtnStyle = (disabled) => ({ padding: '5px 12px', borderRadius: '6px', border: `1.5px solid ${disabled ? COLORS.border : COLORS.primary}`, background: 'transparent', color: disabled ? COLORS.textMuted : COLORS.primary, fontWeight: 600, fontSize: '12px', cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1 });
      const setPage = (nextPage) => setTxPages(prev => ({ ...prev, [pageKey]: nextPage }));
      return (<>
        <table style={S.table}><thead><tr><th style={S.th}>Ref</th><th style={S.th}>Customer</th><th style={S.th}>Item</th><th style={S.th}>Amount</th><th style={S.th}>Date</th>{showDaysListed && <th style={S.th}>Days Listed</th>}<th style={S.th}>Status</th>{showActions && <th style={S.th}>Actions</th>}</tr></thead><tbody>{pageItems.map(tx => { const daysListed = showDaysListed ? getForSaleDaysListed(tx) : null; const daysListedStyle = showDaysListed ? getForSaleDaysBadgeStyle(daysListed) : null; const daysUntilTarget = showDaysListed ? getDaysUntilTargetSale(tx, settings) : null; return (<tr key={tx.ref}><td style={S.td}><button style={{ background: 'none', border: 'none', color: COLORS.primary, fontWeight: 700, cursor: 'pointer', padding: 0, fontSize: '13px', textDecoration: 'underline' }} onClick={() => navigate(txDetailPath(tx.ref))}>{tx.ref}</button></td><td style={S.td}>{tx.fullName}</td><td style={S.td}>{tx.aiBrand} {tx.aiModel}</td><td style={S.td}>{fmtMoney(tx.cashAdvance)}</td><td style={S.td}>{fmtDate(tx.dateGiven)}</td>{showDaysListed && <td style={S.td}>{daysListedStyle ? <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}><span style={{ display: 'inline-block', width: 'fit-content', padding: '4px 8px', borderRadius: '999px', border: `1px solid ${daysListedStyle.border}`, background: daysListedStyle.bg, color: daysListedStyle.fg, fontSize: '12px', fontWeight: 700 }}>{daysListed} day{daysListed === 1 ? '' : 's'}</span>{daysUntilTarget !== null && daysUntilTarget < 0 && <span style={{ fontSize: '11px', color: '#dc2626', fontWeight: 700 }}>⚠ {Math.abs(daysUntilTarget)}d past target</span>}{daysUntilTarget !== null && daysUntilTarget >= 0 && daysUntilTarget <= 7 && <span style={{ fontSize: '11px', color: '#f59e0b', fontWeight: 700 }}>{daysUntilTarget}d to target</span>}</div> : <span style={{ color: COLORS.textMuted, fontSize: '12px' }}>—</span>}</td>}<td style={S.td}><span style={S.badge(statusColor(tx, settings))}>{statusLabel(tx, settings)}</span></td>{showActions && <td style={S.td}><div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}><button style={S.btnSm('primary')} onClick={() => navigate(txDetailPath(tx.ref))}>View</button>{tx.status === 'active' && isStaff && <button style={S.btnSm('accent')} onClick={() => navigate(txRepayPath(tx.ref))}>Collect</button>}{(tx.status === 'ready_to_sell' || (tx.status === 'active' && tx.isEligibleForSale)) && isStaff && <button style={S.btnSm('accent')} onClick={() => setShopListingTx(tx)}>List in Shop</button>}{tx.status === 'for_sale' && isStaff && <button style={S.btnSm('accent')} onClick={() => setShopListingTx(tx)}>Edit Listing</button>}{tx.status === 'for_sale' && isStaff && <button style={S.btnSm('outline')} onClick={async () => { if (window.confirm(`Remove "${tx.aiBrand} ${tx.aiModel}" (${tx.ref}) from the public shop?\n\nIt will return to sellable inventory so it can be listed again later.`)) { const rts = tx.surrenderDate ? 'ready_to_sell' : 'active'; await saveTx({ ...tx, status: rts, listedForSaleDate: null }); loadData(); } }}>Unlist</button>}{(tx.status === 'for_sale' || tx.status === 'ready_to_sell' || (tx.status === 'active' && tx.isEligibleForSale)) && isStaff && <button style={S.btnSm('danger')} onClick={() => navigate(txSellPath(tx.ref))}>Sell</button>}{isAdmin && <button style={S.btnSm('danger')} onClick={async () => { if (window.confirm(`Delete transaction ${tx.ref}? This cannot be undone.`)) { setTransactions(prev => prev.filter(x => x.ref !== tx.ref)); await API.del(`transactions/${encodeURIComponent(tx.ref)}`); loadData(); } }}>Delete</button>}</div></td>}</tr>); })}{items.length === 0 && <tr><td style={S.td} colSpan={colSpan}>No records.</td></tr>}</tbody></table>
        {totalPages > 1 && (<div style={paginationStyle}>
          <div style={{ fontSize: '12px', color: COLORS.textMuted }}>Page {safePage} of {totalPages} · {items.length.toLocaleString()} records</div>
          <div style={{ display: 'flex', gap: '4px' }}>
            <button style={pageBtnStyle(safePage === 1)} disabled={safePage === 1} onClick={() => setPage(1)}>«</button>
            <button style={pageBtnStyle(safePage === 1)} disabled={safePage === 1} onClick={() => setPage(Math.max(1, safePage - 1))}>‹ Prev</button>
            <button style={pageBtnStyle(safePage === totalPages)} disabled={safePage === totalPages} onClick={() => setPage(Math.min(totalPages, safePage + 1))}>Next ›</button>
            <button style={pageBtnStyle(safePage === totalPages)} disabled={safePage === totalPages} onClick={() => setPage(totalPages)}>»</button>
          </div>
        </div>)}
      </>);
    };

    switch (page) {
      case 'dashboard': return (<div>{listLoadingNotice}
        <h2 style={{ fontSize: '20px', fontWeight: 800, marginBottom: '20px', color: COLORS.primaryDark }}>📊 Dashboard</h2>
        <div style={S.grid4}>
          <div style={S.stat}><div style={{ ...S.statLabel, display: 'flex', alignItems: 'center' }}>Available Lending Capital<InfoIcon tip="The money we have available to give out as new loans right now. It's what's left after taking away everything that's already out or paid out." /></div><div style={S.statValue}>{fmtMoney(availableLendingCapital)}</div></div>
          <div style={S.stat}><div style={{ ...S.statLabel, display: 'flex', alignItems: 'center' }}>Capital Out<InfoIcon tip="The total cash that's currently with customers who haven't paid back yet." /></div><div style={S.statValue}>{fmtMoney(totalCapitalOut)}</div></div>
          <div style={S.stat}><div style={{ ...S.statLabel, display: 'flex', alignItems: 'center' }}>Active Loans<InfoIcon tip="How many customers still have active loans — they took money but haven't come back yet." /></div><div style={S.statValue}>{activeTxs.length}</div></div>
          <div style={S.stat}><div style={{ ...S.statLabel, display: 'flex', alignItems: 'center' }}>Revenue<InfoIcon tip="All the money the business has ever earned — from daily fees, selling items, and service charges." /></div><div style={S.statValue}>{fmtMoney(totalRevenue)}</div></div>
          <div style={{ ...S.stat, background: inGracePeriod.length > 0 ? '#f3e8ff' : COLORS.primaryLight }}><div style={{ ...S.statLabel, display: 'flex', alignItems: 'center' }}>In Grace Period<InfoIcon tip="Customers who are overdue but we haven't listed their item for sale yet. We're giving them a little more time." /></div><div style={{ ...S.statValue, color: inGracePeriod.length > 0 ? '#7c3aed' : COLORS.primary }}>{inGracePeriod.length}</div></div>
          <div style={{ ...S.stat, background: readyToSell.length > 0 ? COLORS.dangerLight : COLORS.primaryLight }}><div style={{ ...S.statLabel, display: 'flex', alignItems: 'center' }}>Ready to Sell<InfoIcon tip="Items where the customer ran out of time. We can now sell these to get our money back." /></div><div style={{ ...S.statValue, color: readyToSell.length > 0 ? COLORS.danger : COLORS.primary }}>{readyToSell.length}</div></div>
          <div style={{ ...S.stat, background: forSaleTxs.length > 0 ? '#ede9fe' : COLORS.primaryLight }}><div style={{ ...S.statLabel, display: 'flex', alignItems: 'center' }}>Listed for Sale<InfoIcon tip="Items already moved into listed inventory so the team can focus on selling them and recovering capital." /></div><div style={{ ...S.statValue, color: forSaleTxs.length > 0 ? '#6d28d9' : COLORS.primary }}>{forSaleTxs.length}</div></div>
          {(() => { const overdueCapital = overdueLoans.reduce((s, t) => s + (t.cashAdvance || 0), 0); return overdueLoans.length > 0 ? (<div style={{ ...S.stat, background: '#fef2f2' }}><div style={{ ...S.statLabel, display: 'flex', alignItems: 'center' }}>Overdue Capital<InfoIcon tip="Total cash advanced for loans where the customer has passed their agreed return date. This capital needs urgent recovery." /></div><div style={{ ...S.statValue, color: '#dc2626' }}>{fmtMoney(overdueCapital)}</div><div style={{ fontSize: '11px', color: '#991b1b', marginTop: '2px' }}>{overdueLoans.length} loan{overdueLoans.length !== 1 ? 's' : ''} overdue</div></div>) : null; })()}
          {dueTodayLoans.length > 0 ? (<div style={{ ...S.stat, background: '#fef3c7' }}><div style={{ ...S.statLabel, display: 'flex', alignItems: 'center' }}>Due Today<InfoIcon tip="Loans where the customer agreed to return today. Follow up to ensure they come in." /></div><div style={{ ...S.statValue, color: '#92400e' }}>{dueTodayLoans.length}</div></div>) : null}
        </div>
        <div style={{ ...S.card, marginBottom: '12px' }}><div style={{ fontSize: '12px', color: dbStatus === 'connected' ? '#10b981' : COLORS.danger, fontWeight: 600 }}>● Database: {dbStatus === 'connected' ? 'Connected to Cloudflare D1' : 'Connection error'}</div></div>
        <div style={S.card}><div style={{ ...S.cardTitle, justifyContent: 'space-between', alignItems: 'center' }}><span>Recent Transactions</span><select value={recentTxCount} onChange={e => setRecentTxCount(Number(e.target.value))} style={{ padding: '4px 8px', borderRadius: '6px', border: `1.5px solid ${COLORS.border}`, fontSize: '12px', fontWeight: 600, color: COLORS.primaryDark, background: '#fff', cursor: 'pointer' }}>{[3, 5, 10, 15, 20].map(n => <option key={n} value={n}>Show {n}</option>)}</select></div><TxTable items={transactions.slice(0, recentTxCount)} /></div>
        {drafts.length > 0 && isStaff && <div style={S.card}><div style={S.cardTitle}>📝 In-Progress Drafts</div>{drafts.slice().sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0)).map(d => (<div key={d.ref} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px', borderBottom: `1px solid ${COLORS.border}` }}><div><strong>{d.ref}</strong> — {d.fullName || 'No name yet'} — Step {(d.wizardStep || 0) + 1}<br/><span style={{ fontSize: '12px', color: COLORS.textMuted }}>Created: {d.createdAt ? new Date(d.createdAt).toLocaleString() : 'Unknown'}</span></div><div style={{ display: 'flex', gap: '8px' }}><button style={S.btnSm('accent')} onClick={() => { setEditingTx(d); navigate(PAGE_PATHS.newTransaction); }}>Resume</button><button style={S.btnSm('danger')} onClick={() => { const ninBvn = d.idNumber ? `${d.idType?.toUpperCase() || 'ID'}: ${d.idNumber}` : ''; const item = d.aiItemType ? `${d.aiItemType} ${d.aiBrand || ''} ${d.aiModel || ''}`.trim() : (d.captureItemType || ''); setDeclineDraftDec({ date: localISODate(), ref: d.ref || '', customerName: d.fullName || '', ninBvn, item, reason: '', notes: '' }); setDeclineDraftModal(d); }}>Decline</button><button style={S.btnSm('danger')} onClick={async () => { if(window.confirm('Are you sure you want to delete this draft?')) { setDrafts(prev => prev.filter(x => x.ref !== d.ref)); await API.del(`drafts/${encodeURIComponent(d.ref)}`); loadData(); } }}>Delete</button></div></div>))}</div>}
      </div>);

      case 'transactions': {
        const txStatusCounts = { all: transactions.length, active: 0, closed: 0, sold: 0, for_sale: 0, ready_to_sell: 0, declined: 0 };
        transactions.forEach(t => { if (txStatusCounts[t.status] !== undefined) txStatusCounts[t.status]++; });
        const hasActiveFilters = searchQuery || txStatusFilter !== 'all' || txTypeFilter !== 'all' || txDateFrom || txDateTo;
        const sortOptions = [
          { value: 'dateGiven', label: 'Date' },
          { value: 'cashAdvance', label: 'Amount' },
          { value: 'fullName', label: 'Customer' },
          { value: 'aiBrand', label: 'Item' },
          { value: 'status', label: 'Status' },
        ];
        const statusChips = [
          { key: 'all', label: 'All', color: COLORS.primary },
          { key: 'active', label: '⏳ Active Loans', color: '#10b981' },
          { key: 'for_sale', label: '🏷️ For Sale', color: '#8b5cf6' },
          { key: 'ready_to_sell', label: '🤝 Surrendered', color: '#dc2626' },
          { key: 'closed', label: '✅ Closed', color: '#10b981' },
          { key: 'sold', label: '💰 Sold', color: '#6b7280' },
          { key: 'declined', label: '❌ Declined', color: '#6b7280' },
        ];
        const exportCsv = () => {
          const cols = ['Ref', 'Customer', 'Phone', 'Item Brand', 'Item Model', 'Amount (₦)', 'Date', 'Status', 'Type'];
          const rows = filteredTxs.map(t => [
            t.ref || '', t.fullName || '', (t.phoneNumbers || []).join('; '), t.aiBrand || '', t.aiModel || '',
            t.cashAdvance || 0, t.dateGiven ? new Date(t.dateGiven).toLocaleDateString('en-GB', { timeZone: NIGERIA_TZ }) : '',
            statusLabel(t, settings), t.type || '',
          ]);
          const csv = [cols, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
          const blob = new Blob([csv], { type: 'text/csv' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `transactions-${new Date().toISOString().slice(0, 10)}.csv`;
          a.click();
          URL.revokeObjectURL(url);
        };
        const chipStyle = (active, color) => ({ padding: '5px 12px', borderRadius: '999px', fontSize: '12px', fontWeight: 700, cursor: 'pointer', border: `1.5px solid ${active ? color : COLORS.border}`, background: active ? color : '#fff', color: active ? '#fff' : COLORS.textMuted, whiteSpace: 'nowrap' });
        const sortBtnStyle = (active) => ({ padding: '5px 10px', borderRadius: '6px', border: `1.5px solid ${active ? COLORS.primary : COLORS.border}`, background: active ? COLORS.primaryLight : '#fff', color: active ? COLORS.primary : COLORS.textMuted, fontWeight: 700, fontSize: '12px', cursor: 'pointer' });
        return (<div>{listLoadingNotice}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
            <h2 style={{ fontSize: '20px', fontWeight: 800, color: COLORS.primaryDark, margin: 0 }}>📋 All Transactions</h2>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
              <button style={S.btnSm('primary')} onClick={exportCsv} title="Export filtered results to CSV">⬇ Export CSV</button>
            </div>
          </div>

          {/* Filter & Sort Controls */}
          <div style={{ ...S.card, marginBottom: '16px', padding: '16px 20px' }}>
            {/* Search */}
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: '14px' }}>
              <div style={{ flex: '2 1 200px' }}>
                <div style={S.label}>Search</div>
                <input style={S.input} placeholder="🔍 Ref, name, phone, IMEI, brand, address, notes..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
              </div>
              <div style={{ flex: '1 1 140px' }}>
                <div style={S.label}>Type</div>
                <select style={S.select} value={txTypeFilter} onChange={e => setTxTypeFilter(e.target.value)}>
                  <option value="all">All Types</option>
                  <option value="advance">Cash Advance</option>
                  <option value="outright">Outright Purchase</option>
                </select>
              </div>
              <div style={{ flex: '1 1 130px' }}>
                <div style={S.label}>From Date</div>
                <input type="date" style={S.input} value={txDateFrom} onChange={e => setTxDateFrom(e.target.value)} />
              </div>
              <div style={{ flex: '1 1 130px' }}>
                <div style={S.label}>To Date</div>
                <input type="date" style={S.input} value={txDateTo} onChange={e => setTxDateTo(e.target.value)} />
              </div>
              <div style={{ flex: '1 1 150px' }}>
                <div style={S.label}>Sort By</div>
                <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                  <select style={{ ...S.select, flex: 1 }} value={txSortKey} onChange={e => setTxSortKey(e.target.value)}>
                    {sortOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                  <button style={sortBtnStyle(true)} onClick={() => setTxSortDir(d => d === 'asc' ? 'desc' : 'asc')} title="Toggle sort direction">{txSortDir === 'asc' ? '↑' : '↓'}</button>
                </div>
              </div>
              {hasActiveFilters && <div style={{ flex: '0 0 auto', paddingBottom: '2px' }}><button style={{ ...S.btnSm('danger'), opacity: 0.85 }} onClick={() => { setSearchQuery(''); setTxStatusFilter('all'); setTxTypeFilter('all'); setTxDateFrom(''); setTxDateTo(''); }}>✕ Clear</button></div>}
            </div>

            {/* Status chips */}
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{ fontSize: '12px', fontWeight: 600, color: COLORS.textMuted, marginRight: '4px' }}>Status:</span>
              {statusChips.map(({ key, label, color }) => (
                <button key={key} style={chipStyle(txStatusFilter === key, color)} onClick={() => setTxStatusFilter(key)}>
                  {label}{txStatusCounts[key] !== undefined ? ` (${txStatusCounts[key]})` : ''}
                </button>
              ))}
            </div>
          </div>

          {/* Results summary */}
          {hasActiveFilters && (
            <div style={{ fontSize: '12px', color: COLORS.textMuted, marginBottom: '10px', paddingLeft: '2px' }}>
              Showing <strong>{filteredTxs.length}</strong> of <strong>{transactions.length}</strong> transactions
            </div>
          )}

          <div style={S.card}><TxTable items={filteredTxs} pageKey="transactions" /></div>
        </div>);
      }

      case 'actionLoans': {
        // --- Helper: compute penalty / total owed for a loan ---
        const computeTotalOwed = (tx) => {
          const elapsed = daysBetween(tx.dateGiven);
          const dailyFee = Number(tx.dailyFee) || 0;
          const cashAdvance = Number(tx.cashAdvance) || 0;
          const maxLD = Math.max(1, Number(settings.maxLoanDays) || 30);
          const penaltyMult = Number(settings.penaltyRateMultiplier) || 1.5;
          const normalDays = Math.min(elapsed, maxLD);
          const overdueDays = Math.max(0, elapsed - maxLD);
          const normalFees = normalDays * dailyFee;
          const penaltyFees = overdueDays * dailyFee * penaltyMult;
          return { cashAdvance, normalFees, penaltyFees, totalOwed: cashAdvance + normalFees + penaltyFees, overdueDays };
        };

        // --- Helper: build WhatsApp send link for a specific loan ---
        const getAlertWhatsAppLink = (tx, templateType) => {
          const phone = tx.phoneNumbers?.[0]?.replace(/\D/g, '') || '';
          const waPhone = phone.startsWith('0') ? '234' + phone.slice(1) : phone;
          if (!waPhone) return null;
          const customerDaysLeft = getCustomerDaysLeft(tx);
          const daysOverdue = customerDaysLeft !== null && customerDaysLeft < 0 ? Math.abs(customerDaysLeft) : 0;
          const daysLeft = customerDaysLeft !== null && customerDaysLeft > 0 ? customerDaysLeft : 0;
          let template = '';
          if (templateType === 'reminder') {
            template = (settings.whatsappLoanReminder || DEFAULT_SETTINGS.whatsappLoanReminder);
          } else {
            template = (settings.whatsappOverdueNotice || DEFAULT_SETTINGS.whatsappOverdueNotice);
          }
          const msg = template
            .replace('{customerName}', tx.fullName || 'Customer')
            .replace('{ref}', tx.ref)
            .replace('{amount}', fmtMoney(tx.cashAdvance))
            .replace('{daysLeft}', String(daysLeft))
            .replace('{daysOverdue}', String(daysOverdue))
            .replace('{shopPhone}', settings.shopPhone1 ?? DEFAULT_SETTINGS.shopPhone1)
            .replace('{businessName}', settings.businessName || DEFAULT_SETTINGS.businessName);
          return `https://wa.me/${waPhone}?text=${encodeURIComponent(msg)}`;
        };

        const maxLD = Math.max(1, Number(settings.maxLoanDays) || 30);
        const gd = Math.max(0, Number(settings.graceDays) || 3);

        const graceLastDay = activeTxs.filter(t => {
          const elapsed = daysBetween(t.dateGiven);
          return elapsed === maxLD + gd && !t.isEligibleForSale;
        });

        const inGrace = activeTxs.filter(t => {
          const elapsed = daysBetween(t.dateGiven);
          return elapsed >= maxLD + 1 && elapsed < maxLD + gd;
        });

        const lastDayOwnership = activeTxs.filter(t => {
          const elapsed = daysBetween(t.dateGiven);
          return elapsed === maxLD;
        });

        const overdue = activeTxs.filter(t => {
          const daysLeft = getCustomerDaysLeft(t);
          const elapsed = daysBetween(t.dateGiven);
          return daysLeft !== null && daysLeft < 0 && elapsed < maxLD;
        });

        const dueToday = activeTxs.filter(t => {
          const daysLeft = getCustomerDaysLeft(t);
          const elapsed = daysBetween(t.dateGiven);
          return daysLeft !== null && daysLeft === 0 && elapsed !== maxLD;
        });

        const dedupeByRef = (items) => Array.from(new Map(items.map(tx => [tx.ref, tx])).values());
        const allActionLoans = dedupeByRef([...forSaleTxs, ...readyToSell, ...graceLastDay, ...inGrace, ...lastDayOwnership, ...overdue, ...dueToday]);
        const totalAtRisk = allActionLoans.reduce((s, t) => s + (t.cashAdvance || 0), 0);
        const customerFollowUps = overdue.length + dueToday.length + graceLastDay.length + lastDayOwnership.length;

        const AlertGroup = ({ title, items, color, icon, infoTip, templateType, defaultExpanded }) => {
          const [expanded, setExpanded] = useState(defaultExpanded !== false);
          const [sortBy, setSortBy] = useState('deadline');
          if (items.length === 0) return null;
          const sorted = [...items].sort((a, b) => {
            if (sortBy === 'amount') return (b.cashAdvance || 0) - (a.cashAdvance || 0);
            if (sortBy === 'days') return daysBetween(b.dateGiven) - daysBetween(a.dateGiven);
            return new Date(a.deadlineDate || a.customer_due_date || a.internal_deadline || 0) - new Date(b.deadlineDate || b.customer_due_date || b.internal_deadline || 0);
          });
          const groupTotal = items.reduce((s, t) => s + (t.cashAdvance || 0), 0);
          return (
            <div style={{ ...S.card, borderLeft: `4px solid ${color}`, marginBottom: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }} onClick={() => setExpanded(e => !e)}>
                <div style={{ ...S.cardTitle, color, display: 'flex', alignItems: 'center', margin: 0 }}>
                  {icon} {title} ({items.length}) — {fmtMoney(groupTotal)}
                  {infoTip && <InfoIcon tip={infoTip} />}
                </div>
                <span style={{ fontSize: '18px', color: COLORS.textMuted, transform: expanded ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 0.2s' }}>▼</span>
              </div>
              {expanded && (
                <div style={{ marginTop: '12px' }}>
                  <div style={{ display: 'flex', gap: '6px', marginBottom: '10px' }}>
                    <span style={{ fontSize: '11px', color: COLORS.textMuted, alignSelf: 'center' }}>Sort:</span>
                    {[{ k: 'deadline', l: 'Deadline' }, { k: 'amount', l: 'Amount' }, { k: 'days', l: 'Days Elapsed' }].map(o => (
                      <button key={o.k} onClick={(e) => { e.stopPropagation(); setSortBy(o.k); }} style={{ padding: '3px 8px', borderRadius: '4px', border: `1px solid ${sortBy === o.k ? color : COLORS.border}`, background: sortBy === o.k ? color + '15' : 'transparent', color: sortBy === o.k ? color : COLORS.textMuted, fontSize: '11px', fontWeight: 600, cursor: 'pointer' }}>{o.l}</button>
                    ))}
                  </div>
                  {sorted.map(tx => {
                    const owed = computeTotalOwed(tx);
                    const customerDaysLeft = getCustomerDaysLeft(tx);
                    const waLink = getAlertWhatsAppLink(tx, templateType || (customerDaysLeft > 0 ? 'reminder' : 'overdue'));
                    return (
                      <div key={tx.ref} style={{ padding: '10px 0', borderBottom: `1px solid ${COLORS.border}` }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '8px' }}>
                          <div style={{ flex: 1, minWidth: '200px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                              <strong style={{ fontSize: '13px' }}>{tx.ref}</strong>
                              <span style={{ fontSize: '13px' }}>{tx.fullName}</span>
                            </div>
                            <div style={{ fontSize: '12px', color: COLORS.textMuted, marginTop: '2px' }}>
                              {tx.aiBrand} {tx.aiModel} — Advanced: {fmtMoney(tx.cashAdvance)}
                            </div>
                            <div style={{ fontSize: '12px', color: COLORS.textMuted, marginTop: '2px' }}>
                              Phone: {tx.phoneNumbers?.[0] || 'N/A'} | Due: {fmtDate(tx.deadlineDate || tx.customer_due_date)}
                              {customerDaysLeft !== null && customerDaysLeft < 0 && (
                                <span style={{ color: '#dc2626', fontWeight: 700 }}> ({Math.abs(customerDaysLeft)} day{Math.abs(customerDaysLeft) !== 1 ? 's' : ''} overdue)</span>
                              )}
                              {customerDaysLeft !== null && customerDaysLeft === 0 && (
                                <span style={{ color: '#dc2626', fontWeight: 700 }}> (Due today!)</span>
                              )}
                              {customerDaysLeft !== null && customerDaysLeft > 0 && (
                                <span style={{ color: '#f59e0b', fontWeight: 600 }}> ({customerDaysLeft} day{customerDaysLeft !== 1 ? 's' : ''} left)</span>
                              )}
                            </div>
                            <div style={{ fontSize: '12px', color: COLORS.textMuted, marginTop: '2px' }}>
                              Ownership date: {fmtDate(tx.internal_deadline || addDays(tx.dateGiven, maxLD))}
                            </div>
                            {owed.penaltyFees > 0 && (
                              <div style={{ fontSize: '12px', marginTop: '4px', padding: '4px 8px', background: '#fef2f2', borderRadius: '4px', display: 'inline-block' }}>
                                <span style={{ color: '#991b1b', fontWeight: 600 }}>Total owed: {fmtMoney(owed.totalOwed)}</span>
                                <span style={{ color: '#dc2626', fontSize: '11px', marginLeft: '6px' }}>(incl. {fmtMoney(owed.penaltyFees)} penalty)</span>
                              </div>
                            )}
                          </div>
                          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
                            {waLink && (
                              <a href={waLink} target="_blank" rel="noopener noreferrer" style={{ ...S.btnSm('primary'), background: '#25D366', borderColor: '#25D366', color: '#fff', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px' }}>
                                WhatsApp
                              </a>
                            )}
                            {tx.phoneNumbers?.[0] && (
                              <a href={`tel:${tx.phoneNumbers[0]}`} style={{ ...S.btnSm('outline'), textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px' }}>
                                Call
                              </a>
                            )}
                            {tx.status === 'active' && isStaff && <button style={S.btnSm('accent')} onClick={() => setLoggingContactTx(tx)}>Log Contact</button>}
                            <button style={S.btnSm('primary')} onClick={() => navigate(txDetailPath(tx.ref))}>View</button>
                            {tx.status === 'active' && <button style={S.btnSm('accent')} onClick={() => navigate(txRepayPath(tx.ref))}>Collect</button>}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        };

        return (
          <div>
            {listLoadingNotice}
            <h2 style={{ fontSize: '20px', fontWeight: 800, marginBottom: '8px', color: COLORS.primaryDark }}>🚨 Recovery Queue</h2>
            <p style={{ fontSize: '13px', color: COLORS.textMuted, marginBottom: '20px', lineHeight: '1.5' }}>
              This page is the capital-recovery queue for staff. It shows every loan or item that needs action to recover money, sorted from the most urgent sale and ownership states down to customer follow-ups due today.
            </p>

            <div style={{ ...S.grid2, marginBottom: '20px' }}>
              <div style={{ ...S.stat, background: allActionLoans.length > 0 ? '#fef3c7' : COLORS.primaryLight }}>
                <div style={S.statLabel}>Recovery Queue</div>
                <div style={{ ...S.statValue, color: allActionLoans.length > 0 ? '#92400e' : COLORS.primary }}>{allActionLoans.length}</div>
              </div>
              <div style={{ ...S.stat, background: totalAtRisk > 0 ? '#fee2e2' : COLORS.primaryLight }}>
                <div style={{ ...S.statLabel, display: 'flex', alignItems: 'center' }}>Capital at Risk<InfoIcon tip="Total cash tied up in every loan or item on this recovery queue, including sale-ready and listed inventory." /></div>
                <div style={{ ...S.statValue, color: totalAtRisk > 0 ? '#dc2626' : COLORS.primary }}>{fmtMoney(totalAtRisk)}</div>
              </div>
            </div>

            <AlertGroup title="LISTED FOR SALE" items={forSaleTxs} color="#6d28d9" icon="🏷️" templateType="overdue" defaultExpanded={true}
              infoTip="Items already listed for sale. Keep pushing them until they are sold and the capital is recovered." />

            <AlertGroup title="READY TO SELL" items={readyToSell} color="#1e1e1e" icon="🏷" templateType="overdue" defaultExpanded={true}
              infoTip="Items that have passed the final grace period and can now be sold." />

            <AlertGroup title="GRACE PERIOD — LAST DAY" items={graceLastDay} color="#dc2626" icon="🔴" templateType="overdue" defaultExpanded={true}
              infoTip="The final day before an item becomes ready to sell. This is the last urgent recovery call window." />

            <AlertGroup title="GRACE PERIOD" items={inGrace} color="#7c3aed" icon="⏰" templateType="overdue" defaultExpanded={true}
              infoTip="Loans already inside the business-owned grace window. Staff should follow up and prepare for sale if no payment comes in." />

            <AlertGroup title="LAST DAY OF OWNERSHIP" items={lastDayOwnership} color="#b91c1c" icon="🚨" templateType="overdue" defaultExpanded={true}
              infoTip="Today is the internal ownership deadline. These are high priority because the business takes ownership today." />

            <AlertGroup title="OVERDUE" items={overdue} color="#f59e0b" icon="⚠️" templateType="overdue" defaultExpanded={true}
              infoTip="Customers missed their agreed due date and still need urgent recovery follow-up." />

            <AlertGroup title="DUE TODAY" items={dueToday} color="#ef4444" icon="📍" templateType="reminder" defaultExpanded={true}
              infoTip="Customers scheduled to return today. Reach out before these loans become overdue." />

            {allActionLoans.length === 0 && (
              <div style={S.card}><p style={{ color: COLORS.textMuted, textAlign: 'center' }}>All clear! No capital-recovery actions are pending right now.</p></div>
            )}
          </div>
        );
      }

      case 'deadlines': {
        const maxLD = Math.max(1, Number(settings.maxLoanDays) || 30);
        const dueDateRules = normalizeReminderDays(settings.dueDateFollowUpDays, DEFAULT_SETTINGS.dueDateFollowUpDays);
        const ownershipRules = normalizeReminderDays(settings.ownershipFollowUpDays, DEFAULT_SETTINGS.ownershipFollowUpDays);
        const overdueCadence = Math.max(0, Number(settings.overdueContactReminderDays) || 0);

        const buildFollowUpTriggers = (tx) => {
          const triggers = [];
          const customerDaysLeft = getCustomerDaysLeft(tx);
          const elapsed = daysBetween(tx.dateGiven);
          const ownershipDaysLeft = maxLD - elapsed;
          const overdueDays = customerDaysLeft !== null && customerDaysLeft < 0 ? Math.abs(customerDaysLeft) : 0;

          dueDateRules.forEach(days => {
            if (customerDaysLeft === days) {
              triggers.push({
                key: `due-${days}`,
                priority: days === 0 ? 70 : 90 + days,
                label: days === 0 ? 'Due date is today' : `${days} day${days !== 1 ? 's' : ''} before due date`,
                type: days === 0 ? 'due_today' : 'due_upcoming',
                color: days === 0 ? '#ef4444' : '#f59e0b',
              });
            }
          });

          ownershipRules.forEach(days => {
            if (ownershipDaysLeft >= 0 && ownershipDaysLeft === days) {
              triggers.push({
                key: `ownership-${days}`,
                priority: days === 0 ? 40 : 60 + days,
                label: days === 0 ? 'Last day of ownership is today' : `${days} day${days !== 1 ? 's' : ''} before last day of ownership`,
                type: days === 0 ? 'ownership_today' : 'ownership_upcoming',
                color: days === 0 ? '#b91c1c' : '#dc2626',
              });
            }
          });

          if (overdueCadence > 0 && overdueDays > 0 && overdueDays % overdueCadence === 0 && elapsed < maxLD) {
            triggers.push({
              key: `overdue-${overdueDays}`,
              priority: 20,
              label: `Overdue follow-up due (${overdueDays} day${overdueDays !== 1 ? 's' : ''} overdue)`,
              type: 'overdue_followup',
              color: '#f59e0b',
            });
          }

          return triggers.sort((a, b) => a.priority - b.priority);
        };

        const followUpCandidates = activeTxs
          .map(tx => ({ tx, triggers: buildFollowUpTriggers(tx), clearedToday: hasSuccessfulContactToday(tx) }))
          .filter(item => item.triggers.length > 0);

        const clearedToday = followUpCandidates.filter(item => item.clearedToday);
        const pendingFollowUps = followUpCandidates.filter(item => !item.clearedToday).sort((a, b) => {
          const p = (a.triggers[0]?.priority || 999) - (b.triggers[0]?.priority || 999);
          if (p !== 0) return p;
          return (b.tx.cashAdvance || 0) - (a.tx.cashAdvance || 0);
        });
        const pendingCapital = pendingFollowUps.reduce((s, item) => s + (item.tx.cashAdvance || 0), 0);
        const overdueFollowUps = pendingFollowUps.filter(item => item.triggers.some(t => t.type === 'overdue_followup')).length;

        const getFollowUpWhatsAppLink = (tx, triggers) => {
          const phone = tx.phoneNumbers?.[0]?.replace(/\D/g, '') || '';
          const waPhone = phone.startsWith('0') ? '234' + phone.slice(1) : phone;
          if (!waPhone) return null;
          const isReminder = triggers.every(t => t.type !== 'overdue_followup' && t.type !== 'ownership_today');
          const template = isReminder
            ? (settings.whatsappLoanReminder || DEFAULT_SETTINGS.whatsappLoanReminder)
            : (settings.whatsappOverdueNotice || DEFAULT_SETTINGS.whatsappOverdueNotice);
          const customerDaysLeft = getCustomerDaysLeft(tx);
          const daysOverdue = customerDaysLeft !== null && customerDaysLeft < 0 ? Math.abs(customerDaysLeft) : 0;
          const daysLeft = customerDaysLeft !== null && customerDaysLeft > 0 ? customerDaysLeft : 0;
          const msg = template
            .replace('{customerName}', tx.fullName || 'Customer')
            .replace('{ref}', tx.ref)
            .replace('{amount}', fmtMoney(tx.cashAdvance))
            .replace('{daysLeft}', String(daysLeft))
            .replace('{daysOverdue}', String(daysOverdue))
            .replace('{shopPhone}', settings.shopPhone1 ?? DEFAULT_SETTINGS.shopPhone1)
            .replace('{businessName}', settings.businessName || DEFAULT_SETTINGS.businessName);
          return `https://wa.me/${waPhone}?text=${encodeURIComponent(msg)}`;
        };

        return (
          <div>
            {listLoadingNotice}
            <h2 style={{ fontSize: '20px', fontWeight: 800, marginBottom: '8px', color: COLORS.primaryDark }}>📞 Daily Follow-ups</h2>
            <p style={{ fontSize: '13px', color: COLORS.textMuted, marginBottom: '20px', lineHeight: '1.5' }}>
              This page is the daily follow-up queue. It only shows loans that match the admin-configured contact schedule for today, and a loan clears from this list once staff logs a successful contact attempt today.
            </p>

            <div style={{ ...S.grid4, marginBottom: '20px' }}>
              <div style={{ ...S.stat, background: pendingFollowUps.length > 0 ? '#fef3c7' : COLORS.primaryLight }}>
                <div style={S.statLabel}>Follow-Ups Due</div>
                <div style={{ ...S.statValue, color: pendingFollowUps.length > 0 ? '#92400e' : COLORS.primary }}>{pendingFollowUps.length}</div>
              </div>
              <div style={{ ...S.stat, background: clearedToday.length > 0 ? '#dcfce7' : COLORS.primaryLight }}>
                <div style={S.statLabel}>Cleared Today</div>
                <div style={{ ...S.statValue, color: clearedToday.length > 0 ? '#166534' : COLORS.primary }}>{clearedToday.length}</div>
              </div>
              <div style={{ ...S.stat, background: pendingCapital > 0 ? '#fee2e2' : COLORS.primaryLight }}>
                <div style={{ ...S.statLabel, display: 'flex', alignItems: 'center' }}>Capital in Today&apos;s Queue<InfoIcon tip="Cash tied to the loans that still require follow-up contact today." /></div>
                <div style={{ ...S.statValue, color: pendingCapital > 0 ? '#dc2626' : COLORS.primary }}>{fmtMoney(pendingCapital)}</div>
              </div>
              <div style={S.stat}>
                <div style={{ ...S.statLabel, display: 'flex', alignItems: 'center' }}>Overdue Follow-Ups<InfoIcon tip="How many of today&apos;s follow-ups are overdue reminder contacts based on the overdue cadence setting." /></div>
                <div style={{ ...S.statValue, color: overdueFollowUps > 0 ? '#dc2626' : COLORS.primary }}>{overdueFollowUps}</div>
              </div>
            </div>

            <div style={{ ...S.card, marginBottom: '16px' }}>
              <div style={{ ...S.cardTitle, marginBottom: '8px' }}>Today&apos;s follow-up rules</div>
              <div style={{ fontSize: '13px', color: COLORS.textMuted, lineHeight: '1.6' }}>
                {(() => {
                  const sortedDue = [...dueDateRules].sort((a, b) => b - a);
                  const sortedOwnership = [...ownershipRules].sort((a, b) => b - a);

                  const duePhrases = sortedDue.map(d =>
                    d === 0
                      ? <strong>on the due date</strong>
                      : <><strong>{d} day{d !== 1 ? 's' : ''} before</strong> their due date</>
                  );

                  const ownershipPhrases = sortedOwnership.map(d =>
                    d === 0
                      ? <><strong>on the last day</strong> of ownership</>
                      : <><strong>{d} day{d !== 1 ? 's' : ''} before</strong> it ends</>
                  );

                  const joinPhrases = (phrases) =>
                    phrases.length === 0 ? null :
                    phrases.reduce((acc, phrase, i) =>
                      i === 0 ? phrase : <>{acc} and again {phrase}</>);

                  const dueJoined = joinPhrases(duePhrases);
                  const ownershipJoined = joinPhrases(ownershipPhrases);

                  return (
                    <>
                      {dueJoined && <>Follow up with clients {dueJoined}.</>}
                      {ownershipJoined && <>{' '}For ownership, reach out {ownershipJoined}.</>}
                      {overdueCadence > 0 && <>{' '}For overdue transactions, follow up every <strong>{overdueCadence} day{overdueCadence !== 1 ? 's' : ''}</strong> until resolved.</>}
                    </>
                  );
                })()}
              </div>
            </div>

            <div style={S.card}>
              <div style={{ ...S.cardTitle, justifyContent: 'space-between', alignItems: 'center' }}>
                <span>Follow-Up Queue</span>
                <span style={{ fontSize: '12px', color: COLORS.textMuted }}>{pendingFollowUps.length} pending</span>
              </div>
              {pendingFollowUps.length === 0 ? (
                <p style={{ color: COLORS.textMuted, textAlign: 'center' }}>All clear! No customers are due for follow-up today.</p>
              ) : pendingFollowUps.map(({ tx, triggers }) => {
                const waLink = getFollowUpWhatsAppLink(tx, triggers);
                const customerDaysLeft = getCustomerDaysLeft(tx);
                const currentStatusLabel = statusLabel(tx, settings);
                const currentStatusColor = statusColor(tx, settings);
                return (
                  <div key={tx.ref} style={{ padding: '12px 0', borderBottom: `1px solid ${COLORS.border}` }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px', flexWrap: 'wrap' }}>
                      <div style={{ flex: 1, minWidth: '240px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                          <strong style={{ fontSize: '13px' }}>{tx.ref}</strong>
                          <span style={{ fontSize: '13px' }}>{tx.fullName}</span>
                          <span style={{ display: 'inline-flex', alignItems: 'center', padding: '3px 8px', borderRadius: '999px', background: `${currentStatusColor}15`, color: currentStatusColor, border: `1px solid ${currentStatusColor}33`, fontSize: '11px', fontWeight: 700 }}>
                            Current status: {currentStatusLabel}
                          </span>
                        </div>
                        <div style={{ fontSize: '12px', color: COLORS.textMuted, marginTop: '2px' }}>
                          {tx.aiBrand} {tx.aiModel} — Advanced: {fmtMoney(tx.cashAdvance)} — Due: {fmtDate(tx.deadlineDate || tx.customer_due_date)}
                          {customerDaysLeft !== null && customerDaysLeft < 0 && <span style={{ color: '#dc2626', fontWeight: 700 }}> ({Math.abs(customerDaysLeft)} day{Math.abs(customerDaysLeft) !== 1 ? 's' : ''} overdue)</span>}
                          {customerDaysLeft !== null && customerDaysLeft === 0 && <span style={{ color: '#dc2626', fontWeight: 700 }}> (Due today)</span>}
                        </div>
                        <div style={{ fontSize: '11px', color: COLORS.textMuted, fontWeight: 700, marginTop: '8px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                          Follow-up reason for today
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '6px' }}>
                          {triggers.map(trigger => (
                            <span key={trigger.key} style={{ display: 'inline-flex', alignItems: 'center', padding: '4px 8px', borderRadius: '999px', background: `${trigger.color}15`, color: trigger.color, border: `1px solid ${trigger.color}33`, fontSize: '11px', fontWeight: 700 }}>
                              {trigger.label}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
                        {waLink && <a href={waLink} target="_blank" rel="noopener noreferrer" style={{ ...S.btnSm('primary'), background: '#25D366', borderColor: '#25D366', color: '#fff', textDecoration: 'none' }}>WhatsApp</a>}
                        {tx.phoneNumbers?.[0] && <a href={`tel:${tx.phoneNumbers[0]}`} style={{ ...S.btnSm('outline'), textDecoration: 'none' }}>Call</a>}
                        <button style={S.btnSm('accent')} onClick={() => setLoggingContactTx(tx)}>Log Successful Contact</button>
                        <button style={S.btnSm('primary')} onClick={() => navigate(txDetailPath(tx.ref))}>View</button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {clearedToday.length > 0 && (
              <div style={{ ...S.card, marginTop: '16px' }}>
                <div style={{ ...S.cardTitle, marginBottom: '8px' }}>Cleared from today&apos;s follow-up queue</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  {clearedToday.map(({ tx }) => (
                    <span key={tx.ref} style={{ display: 'inline-flex', alignItems: 'center', padding: '6px 10px', borderRadius: '999px', background: '#dcfce7', color: '#166534', fontSize: '12px', fontWeight: 700 }}>
                      {tx.ref} — {tx.fullName}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      }

      case 'forSale': {
        // ── For Sale page — state lives at App level (fsSearch/fsFilter/fsSort) to avoid
        // defining a component with hooks inside a switch/case block. ──
        const allSellable = [...forSaleTxs, ...readyToSell];

        // Deep search across all transaction fields
        const fsSearched = !fsSearch.trim() ? allSellable : (() => {
          const q = fsSearch.toLowerCase();
          return allSellable.filter(t =>
            (t.ref || '').toLowerCase().includes(q) ||
            (t.fullName || '').toLowerCase().includes(q) ||
            (t.aiBrand || '').toLowerCase().includes(q) ||
            (t.aiModel || '').toLowerCase().includes(q) ||
            (t.aiItemType || '').toLowerCase().includes(q) ||
            (t.aiColour || '').toLowerCase().includes(q) ||
            (t.captureItemType || '').toLowerCase().includes(q) ||
            (t.imei || '').toLowerCase().includes(q) ||
            (t.serialNumber || '').toLowerCase().includes(q) ||
            (t.shopId || '').toLowerCase().includes(q) ||
            (t.shopCondition || '').toLowerCase().includes(q) ||
            (t.shopListingNote || '').toLowerCase().includes(q) ||
            (t.aiCondition || '').toLowerCase().includes(q) ||
            (t.conditionDescription || '').toLowerCase().includes(q) ||
            (t.inspectionNotes || '').toLowerCase().includes(q) ||
            (t.notes || '').toLowerCase().includes(q) ||
            (t.address || '').toLowerCase().includes(q) ||
            (t.phoneNumbers || []).some(p => (p || '').toLowerCase().includes(q)) ||
            (t.salePrice && String(t.salePrice).includes(q)) ||
            (t.cashAdvance && String(t.cashAdvance).includes(q)) ||
            (t.screeningPurchaseLocation || '').toLowerCase().includes(q) ||
            (t.contactLog || []).some(e => (e.notes || '').toLowerCase().includes(q))
          );
        })();

        const fsFiltered = fsFilter === 'listed' ? fsSearched.filter(t => t.status === 'for_sale')
          : fsFilter === 'ready' ? fsSearched.filter(t => t.status !== 'for_sale')
          : fsSearched;

        const fsSorted = [...fsFiltered].sort((a, b) => {
          if (fsSort === 'days_asc') return (getForSaleDaysListed(a) || 0) - (getForSaleDaysListed(b) || 0);
          if (fsSort === 'price_high') return (b.salePrice || 0) - (a.salePrice || 0);
          if (fsSort === 'price_low') return (a.salePrice || 0) - (b.salePrice || 0);
          if (fsSort === 'name') return (`${a.aiBrand} ${a.aiModel}`).localeCompare(`${b.aiBrand} ${b.aiModel}`);
          return (getForSaleDaysListed(b) || 0) - (getForSaleDaysListed(a) || 0); // days_desc default
        });

        // Stat calculations
        const totalAskingValue = forSaleTxs.reduce((s, t) => s + (t.salePrice || 0), 0);
        const totalCapitalRisk = allSellable.reduce((s, t) => s + (t.cashAdvance || 0), 0);
        const listedDaysArr = forSaleTxs.map(t => getForSaleDaysListed(t) || 0).filter(d => d > 0);
        const avgDaysListed = listedDaysArr.length > 0 ? Math.round(listedDaysArr.reduce((a, b) => a + b, 0) / listedDaysArr.length) : 0;
        const targetDeadlineDays = Math.max(1, Number(settings.targetSaleDeadlineDays) || 14);
        const pastDeadline = forSaleTxs.filter(t => {
          const daysUntilTarget = getDaysUntilTargetSale(t, settings);
          return daysUntilTarget !== null && daysUntilTarget < 0;
        }).length;
        const SC = {
          wrap: { ...S.stat, flex: '1 1 140px' },
          label: { ...S.statLabel, display: 'flex', alignItems: 'center' },
          value: S.statValue,
          sub: { fontSize: '11px', color: COLORS.textMuted, marginTop: '2px' },
        };

        return (
          <div>
            {listLoadingNotice}
            <h2 style={{ fontSize: '20px', fontWeight: 800, marginBottom: '16px', color: COLORS.primaryDark }}>🏷 For Sale</h2>

            {/* ── Stat Cards ── */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', marginBottom: '20px' }}>
              <div style={{ ...SC.wrap, background: COLORS.primaryLight }}>
                <div style={SC.label}>Listed in Shop<InfoIcon tip="Items currently visible on the public shop page." /></div>
                <div style={{ ...SC.value, color: COLORS.primary }}>{forSaleTxs.length}</div>
                <div style={SC.sub}>Asking: {fmtMoney(totalAskingValue)}</div>
              </div>
              <div style={{ ...SC.wrap, background: readyToSell.length > 0 ? COLORS.dangerLight : COLORS.primaryLight }}>
                <div style={SC.label}>Ready to Sell<InfoIcon tip="Items eligible to list but not yet in the shop (timeline expired or customer surrendered)." /></div>
                <div style={{ ...SC.value, color: readyToSell.length > 0 ? COLORS.danger : COLORS.primary }}>{readyToSell.length}</div>
                {surrenderedTxs.length > 0 && <div style={SC.sub}>{surrenderedTxs.length} early surrender{surrenderedTxs.length !== 1 ? 's' : ''}</div>}
              </div>
              <div style={{ ...SC.wrap, background: '#fef3c7' }}>
                <div style={SC.label}>Capital at Risk<InfoIcon tip="Total cash advanced across all items not yet sold (both listed and ready to sell)." /></div>
                <div style={{ ...SC.value, color: '#92400e' }}>{fmtMoney(totalCapitalRisk)}</div>
                <div style={SC.sub}>{allSellable.length} item{allSellable.length !== 1 ? 's' : ''}</div>
              </div>
              <div style={{ ...SC.wrap, background: avgDaysListed > targetDeadlineDays ? '#fef2f2' : COLORS.bg }}>
                <div style={SC.label}>Avg Days Listed<InfoIcon tip="Average number of days listed items have been in the shop. Target is below the sale deadline setting." /></div>
                <div style={{ ...SC.value, color: avgDaysListed > targetDeadlineDays ? COLORS.danger : COLORS.text }}>{avgDaysListed > 0 ? avgDaysListed : '—'}</div>
                <div style={SC.sub}>Target ≤ {targetDeadlineDays} days</div>
              </div>
              {pastDeadline > 0 && (
                <div style={{ ...SC.wrap, background: '#fef2f2' }}>
                  <div style={SC.label}>Past Target Deadline<InfoIcon tip="Listed items whose intake-anchored target sale date has passed. Consider reducing prices." /></div>
                  <div style={{ ...SC.value, color: COLORS.danger }}>{pastDeadline}</div>
                  <div style={{ ...SC.sub, color: '#991b1b' }}>Consider price drops</div>
                </div>
              )}
            </div>

            {/* ── Search + Filter + Sort controls ── */}
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '16px', alignItems: 'center' }}>
              <input
                type="text"
                value={fsSearch}
                onChange={e => setFsSearch(e.target.value)}
                placeholder="Deep search — ref, customer, item, IMEI, serial, notes, price..."
                style={{ flex: '1 1 240px', padding: '9px 12px', borderRadius: '8px', border: `1.5px solid ${COLORS.border}`, fontSize: '14px', outline: 'none', fontFamily: 'inherit', background: '#fff', color: COLORS.text }}
              />
              <select value={fsFilter} onChange={e => setFsFilter(e.target.value)} style={{ padding: '9px 10px', borderRadius: '8px', border: `1.5px solid ${COLORS.border}`, fontSize: '13px', background: '#fff', cursor: 'pointer' }}>
                <option value="all">All ({allSellable.length})</option>
                <option value="listed">Listed in Shop ({forSaleTxs.length})</option>
                <option value="ready">Ready to Sell ({readyToSell.length})</option>
              </select>
              <select value={fsSort} onChange={e => setFsSort(e.target.value)} style={{ padding: '9px 10px', borderRadius: '8px', border: `1.5px solid ${COLORS.border}`, fontSize: '13px', background: '#fff', cursor: 'pointer' }}>
                <option value="days_desc">Longest Listed First</option>
                <option value="days_asc">Newest Listed First</option>
                <option value="price_high">Price: High → Low</option>
                <option value="price_low">Price: Low → High</option>
                <option value="name">Item Name (A–Z)</option>
              </select>
              {fsSearch && (
                <button onClick={() => setFsSearch('')} style={{ padding: '9px 12px', borderRadius: '8px', border: `1.5px solid ${COLORS.border}`, background: '#fff', color: COLORS.textMuted, cursor: 'pointer', fontSize: '13px', fontWeight: 600 }}>✕ Clear</button>
              )}
            </div>

            {fsSearch && (
              <div style={{ fontSize: '13px', color: COLORS.textMuted, marginBottom: '10px' }}>
                {fsSorted.length} result{fsSorted.length !== 1 ? 's' : ''} for "<strong>{fsSearch}</strong>"
                {fsSorted.length === 0 && <span style={{ marginLeft: '8px', color: COLORS.danger }}>— no matches found</span>}
              </div>
            )}

            <div style={S.card}>
              <TxTable items={fsSorted} showDaysListed pageKey="for-sale" />
            </div>
          </div>
        );
      }

      case 'reports': {
        const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
        const thisYear = new Date().getFullYear();
        const years = [thisYear, thisYear - 1, thisYear - 2, thisYear - 3];
        const startVal = reportYear * 12 + reportMonth;
        const endVal = reportEndYear * 12 + reportEndMonth;
        const [fromYear, fromMonth, toYear, toMonth] = startVal <= endVal
          ? [reportYear, reportMonth, reportEndYear, reportEndMonth]
          : [reportEndYear, reportEndMonth, reportYear, reportMonth];
        const inPeriod = (dateStr) => {
          if (!dateStr) return false;
          const d = new Date(dateStr.replace(' ', 'T'));
          const v = d.getFullYear() * 12 + d.getMonth() + 1;
          return v >= fromYear * 12 + fromMonth && v <= toYear * 12 + toMonth;
        };
        const isSingleMonth = fromYear === toYear && fromMonth === toMonth;
        const periodLabel = isSingleMonth
          ? `${MONTH_NAMES[fromMonth - 1]} ${fromYear}`
          : `${MONTH_NAMES[fromMonth - 1]} ${fromYear} – ${MONTH_NAMES[toMonth - 1]} ${toYear}`;
        const rClosed = closedTxs.filter(t => inPeriod(t.dateRepaid || t.updated_at));
        const rSold = soldTxs.filter(t => inPeriod(t.saleDate || t.updated_at));
        const rNewTxs = transactions.filter(t => t.status !== 'declined' && inPeriod(t.created_at));
        const rNewLoans = rNewTxs.filter(t => t.type !== 'outright');
        const rExpenses = expenses.filter(e => inPeriod(e.date));
        const rRepaymentFees = rClosed.reduce((s, t) => s + (t.totalFees || 0), 0);
        const rSalesRevenue = rSold.reduce((s, t) => s + (t.salePrice || 0), 0);
        const rServiceFees = rNewLoans.reduce((sum, t) => sum + (t.serviceFeeAmount ?? (t.serviceFeeCollected ? (settings.serviceFee || 1000) : 0)), 0);
        const rRevenue = rRepaymentFees + rSalesRevenue + rServiceFees;
        const rExpTotal = rExpenses.reduce((s, e) => s + (e.amount || 0), 0);
        const rProfit = rRevenue - rExpTotal;
        const staffSharePct = settings.staffSharePct ?? 10;
        const rStaff = Math.floor(rProfit * staffSharePct / 100);
        const rStakeholder = rProfit - rStaff;
        const rCapitalDeployed = rNewTxs.reduce((s, t) => s + (t.cashAdvance || 0), 0);
        const rCapitalReturned = rClosed.reduce((s, t) => s + (t.cashAdvance || 0), 0);
        const expByCategory = rExpenses.reduce((acc, e) => {
          const cat = e.category || 'Other';
          if (!acc[cat]) acc[cat] = 0;
          acc[cat] += (e.amount || 0);
          return acc;
        }, {});
        const rowStyle = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: `1px solid ${COLORS.border}` };
        const rStakeholders = Object.values(capital.reduce((acc, c) => {
          const key = c.name.toLowerCase();
          if (!acc[key]) acc[key] = { name: c.name, total: 0 };
          acc[key].total += (c.amount || 0);
          return acc;
        }, {})).map(s => {
          const pct = totalCapital > 0 ? (s.total / totalCapital * 100) : 0;
          return { ...s, pct, share: Math.floor(rStakeholder * pct / 100) };
        });
        // ── TASK-BASED STAFF SCORING ──
        // Points per task (all tasks weighted equally at 1 point each):
        // 1. Loan Intake      – completing a new cash advance or outright purchase (completedBy)
        // 2. Repayment        – processing a customer repayment (repaidBy)
        // 3. Sale             – recording an item sale (soldBy)
        // 4. Contact Logged   – logging a contact attempt on an overdue/at-risk loan (loggedBy)
        // 5. Sold at Target   – item sold at/above targetSellPct% of estimated value (completedBy of intake)
        // 6. Sold On Time     – item sold on or before the target sale date anchored to intake (completedBy of intake)
        const targetSalePct = settings.targetSellPct || 75;
        const taskDefs = ['loan_intake', 'repayment', 'sale', 'contact', 'sold_at_target', 'sold_on_time'];
        const taskLabels = { loan_intake: 'Loan Intake', repayment: 'Repayment', sale: 'Sale', contact: 'Contact Logged', sold_at_target: 'Sold at Target Price', sold_on_time: 'Sold Within Deadline' };
        const scoreMap = {}; // { staffName: { loan_intake:N, repayment:N, ... } }
        const addScore = (name, type) => {
          if (!name?.trim()) return;
          const k = name.trim();
          if (!scoreMap[k]) scoreMap[k] = Object.fromEntries(taskDefs.map(d => [d, 0]));
          scoreMap[k][type] = (scoreMap[k][type] || 0) + 1;
        };
        // Task 1: New loan intake
        rNewTxs.forEach(tx => { if (tx.completedBy) addScore(tx.completedBy, 'loan_intake'); });
        // Task 2: Repayment processed
        rClosed.forEach(tx => { if (tx.repaidBy) addScore(tx.repaidBy, 'repayment'); });
        // Task 3: Sale completed
        rSold.forEach(tx => { if (tx.soldBy) addScore(tx.soldBy, 'sale'); });
        // Task 4: Contact attempts logged in period — max 1 point per transaction per staff member
        transactions.forEach(tx => {
          if (!Array.isArray(tx.contactLog)) return;
          const seenStaff = new Set();
          tx.contactLog.forEach(log => {
            if (log.loggedBy && inPeriod(log.loggedAt || log.date) && !seenStaff.has(log.loggedBy)) {
              seenStaff.add(log.loggedBy);
              addScore(log.loggedBy, 'contact');
            }
          });
        });
        // Task 5 & 6: Bonus tasks attributed to the person who originally accepted the item
        rSold.forEach(tx => {
          if (!tx.completedBy) return;
          // Task 5: sold at/above target price
          if (tx.estimatedValue && tx.salePrice && (tx.salePrice / tx.estimatedValue) * 100 >= targetSalePct) {
            addScore(tx.completedBy, 'sold_at_target');
          }
          // Task 6: sold on or before the target sale date anchored to intake
          if (tx.dateGiven && tx.saleDate) {
            const targetSaleDate = getTargetSaleDate(tx, settings);
            if (targetSaleDate && tx.saleDate <= targetSaleDate) addScore(tx.completedBy, 'sold_on_time');
          }
        });
        const rStaffScores = Object.entries(scoreMap).map(([name, scores]) => {
          const total = taskDefs.reduce((s, d) => s + scores[d], 0);
          return { name, scores, total };
        }).sort((a, b) => b.total - a.total);
        const totalTaskPoints = rStaffScores.reduce((s, v) => s + v.total, 0);
        const rStaffByTask = rStaffScores.map(s => ({
          ...s,
          pct: totalTaskPoints > 0 ? (s.total / totalTaskPoints * 100) : 0,
          share: totalTaskPoints > 0 ? Math.floor(rStaff * s.total / totalTaskPoints) : 0,
        }));

        const handlePrintReport = () => printMonthReport({
          periodLabel,
          rClosed, rSold, rNewTxs, rExpenses,
          rRepaymentFees, rSalesRevenue, rServiceFees, rRevenue,
          rExpTotal, rProfit, rStaff, rStakeholder,
          rCapitalDeployed, rCapitalReturned,
          serviceFee: settings.serviceFee || 1000,
          rNewLoans,
          stakeholders: rStakeholders,
          rStaffByTask, staffSharePct, totalTaskPoints,
          taskLabels, taskDefs,
          expByCategory,
        });
        const handleExportCSV = () => {
          const csvEscape = (v) => {
            const s = String(v == null ? '' : v);
            return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
          };
          const toCSV = (headers, rows) => [headers, ...rows].map(r => r.map(csvEscape).join(',')).join('\n');
          const sections = [
            `REPORT — ${periodLabel}`,
            '',
            'FINANCIAL SUMMARY',
            `Revenue,${rRevenue}`,
            `Expenses,${rExpTotal}`,
            `Net Profit,${rProfit}`,
            `Staff Share (${staffSharePct}%),${rStaff}`,
            `Stakeholders,${rStakeholder}`,
            '',
            'STAFF PERFORMANCE',
            toCSV(['Staff','Loan Intake','Repayment','Sale','Contact Logged','Sold at Target','Sold On Time','Total Points','Share %','Amount'],
              rStaffByTask.map(s => [s.name, s.scores.loan_intake, s.scores.repayment, s.scores.sale, s.scores.contact, s.scores.sold_at_target, s.scores.sold_on_time, s.total, s.pct.toFixed(1)+'%', s.share])),
            '',
            'REPAYMENTS',
            toCSV(['Ref','Customer','Cash Advanced','Fees Collected','Date Repaid'],
              rClosed.map(t => [t.ref, t.fullName, t.cashAdvance, t.totalFees, t.dateRepaid || t.updated_at])),
            '',
            'SALES',
            toCSV(['Ref','Item','Cash Advanced','Sale Price','Margin','Buyer','Date'],
              rSold.map(t => [t.ref, t.aiBrand || t.description, t.cashAdvance, t.salePrice, (t.salePrice||0)-(t.cashAdvance||0), t.saleBuyer, t.saleDate || t.updated_at])),
            '',
            'NEW LOANS',
            toCSV(['Ref','Customer','Cash Advanced','Service Fee','Loan Term (days)','Date','Status'],
              rNewTxs.map(t => [t.ref, t.fullName, t.cashAdvance, t.type === 'outright' ? 0 : (t.serviceFeeAmount ?? (t.serviceFeeCollected ? (settings.serviceFee || 1000) : 0)), t.loanDays || 30, t.created_at, t.status])),
            '',
            'EXPENSES',
            toCSV(['Date','Category','Description','Amount'],
              rExpenses.map(e => [e.date, e.category, e.description || e.note, e.amount])),
          ];
          const blob = new Blob([sections.join('\n')], { type: 'text/csv' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `report-${periodLabel.replace(/\s/g, '-').replace(/–/g, 'to')}.csv`;
          a.click();
          URL.revokeObjectURL(url);
        };
        return (
          <div>
            <div style={{ marginBottom: '20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginBottom: '12px' }}>
                <h2 style={{ fontSize: '20px', fontWeight: 800, color: COLORS.primaryDark }}>📈 Report — {periodLabel}</h2>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button style={S.btn('outline')} onClick={handleExportCSV}>⬇ CSV</button>
                  <button style={S.btn('primary')} onClick={handlePrintReport}>🖨 Print / PDF</button>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap', background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: '8px', padding: '10px 14px' }}>
                <span style={{ fontSize: '13px', fontWeight: 600, color: COLORS.textMuted }}>From:</span>
                <select value={reportMonth} onChange={e => setReportMonth(Number(e.target.value))} style={{ ...S.input, width: 'auto', padding: '5px 8px', margin: 0 }}>
                  {MONTH_NAMES.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
                </select>
                <select value={reportYear} onChange={e => setReportYear(Number(e.target.value))} style={{ ...S.input, width: 'auto', padding: '5px 8px', margin: 0 }}>
                  {years.map(y => <option key={y} value={y}>{y}</option>)}
                </select>
                <span style={{ fontSize: '13px', fontWeight: 600, color: COLORS.textMuted, marginLeft: '8px' }}>To:</span>
                <select value={reportEndMonth} onChange={e => setReportEndMonth(Number(e.target.value))} style={{ ...S.input, width: 'auto', padding: '5px 8px', margin: 0 }}>
                  {MONTH_NAMES.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
                </select>
                <select value={reportEndYear} onChange={e => setReportEndYear(Number(e.target.value))} style={{ ...S.input, width: 'auto', padding: '5px 8px', margin: 0 }}>
                  {years.map(y => <option key={y} value={y}>{y}</option>)}
                </select>
                {!isSingleMonth && (
                  <button style={{ ...S.btn('outline'), padding: '4px 10px', fontSize: '12px' }}
                    onClick={() => { setReportEndMonth(reportMonth); setReportEndYear(reportYear); }}>
                    Reset to single month
                  </button>
                )}
              </div>
            </div>

            {/* Activity counts */}
            <div style={{ ...S.grid4, marginBottom: '20px' }}>
              <div style={S.stat}><div style={S.statLabel}>New Loans</div><div style={S.statValue}>{rNewTxs.length}</div></div>
              <div style={S.stat}><div style={S.statLabel}>Repayments</div><div style={S.statValue}>{rClosed.length}</div></div>
              <div style={S.stat}><div style={S.statLabel}>Sales</div><div style={S.statValue}>{rSold.length}</div></div>
              <div style={S.stat}><div style={S.statLabel}>Expenses</div><div style={S.statValue}>{rExpenses.length}</div></div>
            </div>

            {/* Financial summary */}
            <div style={S.card}>
              <div style={S.cardTitle}>💰 Financial Summary</div>
              <div style={S.grid3}>
                <div style={S.stat}><div style={{ ...S.statLabel, display: 'flex', alignItems: 'center' }}>Revenue<InfoIcon tip="All the money that came in during this period — from customers repaying, selling items, and service charges." /></div><div style={S.statValue}>{fmtMoney(rRevenue)}</div></div>
                <div style={S.stat}><div style={{ ...S.statLabel, display: 'flex', alignItems: 'center' }}>Expenses<InfoIcon tip="Money spent to keep the business running — things like printing, transport, airtime, and stationery." /></div><div style={{ ...S.statValue, color: COLORS.danger }}>{fmtMoney(rExpTotal)}</div></div>
                <div style={S.stat}><div style={{ ...S.statLabel, display: 'flex', alignItems: 'center' }}>Net Profit<InfoIcon tip="Income minus expenses. This is what the business actually made after paying for everything. Staff and investors split this." /></div><div style={{ ...S.statValue, color: rProfit >= 0 ? COLORS.primary : COLORS.danger }}>{fmtMoney(rProfit)}</div></div>
              </div>
              <div style={{ marginTop: '20px', paddingTop: '16px', borderTop: `1px solid ${COLORS.border}` }}>
                <div style={{ fontSize: '12px', fontWeight: 700, color: COLORS.textMuted, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px' }}>Revenue Breakdown</div>
                <div style={rowStyle}><span>Repayment fees ({rClosed.length} loan{rClosed.length !== 1 ? 's' : ''})<InfoIcon tip="The daily fees we collect when a customer comes back to pay and pick up their item." /></span><strong style={{ color: COLORS.primary }}>{fmtMoney(rRepaymentFees)}</strong></div>
                <div style={rowStyle}><span>Sales proceeds ({rSold.length} item{rSold.length !== 1 ? 's' : ''})<InfoIcon tip="Money from selling items that customers didn't come back to collect before their time ran out." /></span><strong style={{ color: COLORS.primary }}>{fmtMoney(rSalesRevenue)}</strong></div>
                <div style={{ ...rowStyle, borderBottom: 'none' }}><span>Service fees ({rNewLoans.length} new loan{rNewLoans.length !== 1 ? 's' : ''})<InfoIcon tip="Flat fees actually collected on new advance loans during this period, using the fee saved on each transaction when available." /></span><strong style={{ color: COLORS.primary }}>{fmtMoney(rServiceFees)}</strong></div>
              </div>
              <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: `1px solid ${COLORS.border}` }}>
                <div style={{ fontSize: '12px', fontWeight: 700, color: COLORS.textMuted, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px' }}>Capital Flow</div>
                <div style={rowStyle}><span>Capital deployed (new loans)<InfoIcon tip="The total cash handed out as loans this period. This money is with customers and will come back when they repay." /></span><strong style={{ color: COLORS.danger }}>{fmtMoney(rCapitalDeployed)}</strong></div>
                <div style={{ ...rowStyle, borderBottom: 'none' }}><span>Capital returned (repayments)<InfoIcon tip="The total loan amount (not including fees) that customers paid back this period." /></span><strong style={{ color: COLORS.primary }}>{fmtMoney(rCapitalReturned)}</strong></div>
              </div>
            </div>

            {/* Profit distribution */}
            <div style={S.grid2}>
              <div style={S.card}><div style={{ ...S.cardTitle, display: 'flex', alignItems: 'center' }}>Staff Share ({staffSharePct}%)<InfoIcon tip={`The staff's collective share for running the business — ${staffSharePct}% of the net profit, split equally among all active staff members.`} /></div><div style={{ fontSize: '24px', fontWeight: 800, color: COLORS.accent }}>{fmtMoney(rStaff)}</div></div>
              <div style={S.card}><div style={{ ...S.cardTitle, display: 'flex', alignItems: 'center' }}>Stakeholders ({100 - staffSharePct}%)<InfoIcon tip={`The investors' share of the profit — ${100 - staffSharePct}% split among them based on how much each person put in.`} /></div><div style={{ fontSize: '24px', fontWeight: 800, color: COLORS.primary }}>{fmtMoney(rStakeholder)}</div></div>
            </div>
            <div style={S.card}>
              <div style={{ ...S.cardTitle, display: 'flex', alignItems: 'center' }}>👥 Staff Performance & Distribution<InfoIcon tip="Each staff member's profit share is based on task points earned in this period. Points are earned for: new loans, repayments, sales, contact attempts, selling at target price, and selling within the deadline." /></div>
              {rStaffByTask.length > 0 ? (
                <>
                  <div style={{ fontSize: '12px', color: COLORS.textMuted, marginBottom: '12px' }}>Total task points this period: <strong>{totalTaskPoints}</strong></div>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ ...S.table, fontSize: '12px' }}>
                      <thead>
                        <tr>
                          <th style={S.th}>Staff</th>
                          {taskDefs.map(d => <th key={d} style={{ ...S.th, fontSize: '11px', minWidth: '60px' }}>{taskLabels[d]}</th>)}
                          <th style={S.th}>Total Pts</th>
                          <th style={S.th}>Share %</th>
                          <th style={S.th}>Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rStaffByTask.map(s => (
                          <tr key={s.name}>
                            <td style={{ ...S.td, fontWeight: 700 }}>{s.name}</td>
                            {taskDefs.map(d => (
                              <td key={d} style={{ ...S.td, textAlign: 'center', color: s.scores[d] > 0 ? COLORS.primary : COLORS.textMuted }}>
                                {s.scores[d] || '—'}
                              </td>
                            ))}
                            <td style={{ ...S.td, fontWeight: 700, textAlign: 'center' }}>{s.total}</td>
                            <td style={{ ...S.td, textAlign: 'center' }}>{s.pct.toFixed(1)}%</td>
                            <td style={{ ...S.td, fontWeight: 700, color: rStaff >= 0 ? COLORS.accent : COLORS.danger }}>{fmtMoney(s.share)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <p style={{ color: COLORS.textMuted, fontSize: '13px' }}>No staff task data for this period. Tasks are tracked when staff complete loans, repayments, sales, and contact attempts.</p>
              )}
            </div>
            <div style={S.card}>
              <div style={{ ...S.cardTitle, display: 'flex', alignItems: 'center' }}>📊 Stakeholder Distribution<InfoIcon tip="How each investor's profit share is worked out — based on how much they put in compared to everyone else combined." /></div>
              {rStakeholders.map(s => (
                <div key={s.name} style={rowStyle}>
                  <span><strong>{s.name}</strong> — {fmtMoney(s.total)} ({s.pct.toFixed(1)}%)</span>
                  <strong style={{ color: rStakeholder >= 0 ? COLORS.primary : COLORS.danger }}>{fmtMoney(s.share)}</strong>
                </div>
              ))}
              {capital.length === 0 && <p style={{ color: COLORS.textMuted }}>No capital recorded yet.</p>}
            </div>

            {/* Repayments detail */}
            {rClosed.length > 0 && (
              <div style={S.card}>
                <div style={S.cardTitle}>✅ Repayments ({rClosed.length})</div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={S.table}>
                    <thead>
                      <tr>
                        <th style={S.th}>Ref</th>
                        <th style={S.th}>Customer</th>
                        <th style={S.th}>Cash Advanced</th>
                        <th style={S.th}>Fees Collected</th>
                        <th style={S.th}>Date Repaid</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rClosed.map(t => (
                        <tr key={t.ref}>
                          <td style={S.td}><strong>{t.ref}</strong></td>
                          <td style={S.td}>{t.fullName || '—'}</td>
                          <td style={S.td}>{fmtMoney(t.cashAdvance)}</td>
                          <td style={{ ...S.td, color: COLORS.primary, fontWeight: 700 }}>{fmtMoney(t.totalFees)}</td>
                          <td style={S.td}>{fmtDate(t.dateRepaid || t.updated_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Sales detail */}
            {rSold.length > 0 && (
              <div style={S.card}>
                <div style={S.cardTitle}>🏷 Sales ({rSold.length})</div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={S.table}>
                    <thead>
                      <tr>
                        <th style={S.th}>Ref</th>
                        <th style={S.th}>Item</th>
                        <th style={S.th}>Cash Advanced</th>
                        <th style={S.th}>Sale Price</th>
                        <th style={S.th}>Margin</th>
                        <th style={S.th}>Buyer</th>
                        <th style={S.th}>Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rSold.map(t => {
                        const margin = (t.salePrice || 0) - (t.cashAdvance || 0);
                        return (
                          <tr key={t.ref}>
                            <td style={S.td}><strong>{t.ref}</strong></td>
                            <td style={S.td}>{t.aiBrand || t.description || '—'}</td>
                            <td style={S.td}>{fmtMoney(t.cashAdvance)}</td>
                            <td style={{ ...S.td, fontWeight: 700 }}>{fmtMoney(t.salePrice)}</td>
                            <td style={{ ...S.td, color: margin >= 0 ? COLORS.primary : COLORS.danger, fontWeight: 700 }}>{fmtMoney(margin)}</td>
                            <td style={S.td}>{t.saleBuyer || '—'}</td>
                            <td style={S.td}>{fmtDate(t.saleDate || t.updated_at)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* New loans detail */}
            {rNewTxs.length > 0 && (
              <div style={S.card}>
                <div style={S.cardTitle}>📋 New Loans ({rNewTxs.length})</div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={S.table}>
                    <thead>
                      <tr>
                        <th style={S.th}>Ref</th>
                        <th style={S.th}>Customer</th>
                        <th style={S.th}>Cash Advanced</th>
                        <th style={S.th}>Service Fee</th>
                        <th style={S.th}>Loan Term</th>
                        <th style={S.th}>Date</th>
                        <th style={S.th}>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rNewTxs.map(t => (
                        <tr key={t.ref}>
                          <td style={S.td}><strong>{t.ref}</strong></td>
                          <td style={S.td}>{t.fullName || '—'}</td>
                          <td style={{ ...S.td, fontWeight: 700 }}>{fmtMoney(t.cashAdvance)}</td>
                          <td style={{ ...S.td, color: COLORS.primary }}>{fmtMoney(t.type === 'outright' ? 0 : (t.serviceFeeAmount ?? (t.serviceFeeCollected ? (settings.serviceFee || 1000) : 0)))}</td>
                          <td style={S.td}>{t.loanDays || 30} days</td>
                          <td style={S.td}>{fmtDate(t.created_at)}</td>
                          <td style={S.td}><span style={{ fontSize: '12px', fontWeight: 600, color: statusColor(t, settings) }}>{statusLabel(t, settings)}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Expenses detail */}
            {rExpenses.length > 0 && (
              <div style={S.card}>
                <div style={S.cardTitle}>🧾 Expenses ({rExpenses.length}) — {fmtMoney(rExpTotal)}</div>
                {Object.keys(expByCategory).length > 1 && (
                  <div style={{ marginBottom: '16px', paddingBottom: '12px', borderBottom: `1px solid ${COLORS.border}` }}>
                    <div style={{ fontSize: '12px', fontWeight: 700, color: COLORS.textMuted, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px' }}>By Category</div>
                    {Object.entries(expByCategory).sort((a, b) => b[1] - a[1]).map(([cat, amt]) => (
                      <div key={cat} style={rowStyle}>
                        <span>{cat}</span>
                        <strong style={{ color: COLORS.danger }}>{fmtMoney(amt)}</strong>
                      </div>
                    ))}
                  </div>
                )}
                <div style={{ overflowX: 'auto' }}>
                  <table style={S.table}>
                    <thead>
                      <tr>
                        <th style={S.th}>Date</th>
                        <th style={S.th}>Category</th>
                        <th style={S.th}>Description</th>
                        <th style={S.th}>Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rExpenses.sort((a, b) => new Date(b.date) - new Date(a.date)).map((e, i) => (
                        <tr key={i}>
                          <td style={S.td}>{fmtDate(e.date)}</td>
                          <td style={S.td}>{e.category || '—'}</td>
                          <td style={S.td}>{e.description || e.note || '—'}</td>
                          <td style={{ ...S.td, color: COLORS.danger, fontWeight: 700 }}>{fmtMoney(e.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {rClosed.length === 0 && rSold.length === 0 && rNewTxs.length === 0 && rExpenses.length === 0 && (
              <div style={{ ...S.card, textAlign: 'center', color: COLORS.textMuted }}>
                No activity recorded for {periodLabel}.
              </div>
            )}

            {/* Glossary */}
            <details style={{ ...S.card, padding: 0, overflow: 'hidden' }}>
              <summary style={{ padding: '12px 16px', cursor: 'pointer', fontWeight: 700, fontSize: '14px', color: COLORS.primaryDark, userSelect: 'none', listStyle: 'none', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span>📖</span> <span>Terms Explained</span> <span style={{ marginLeft: 'auto', fontSize: '12px', fontWeight: 400, color: COLORS.textMuted }}>tap to expand</span>
              </summary>
              <div style={{ padding: '0 16px 16px 16px', borderTop: `1px solid ${COLORS.border}` }}>
                {[
                  ['Revenue', 'All the money the business received in this period — from loan fees, sales, and service charges combined.'],
                  ['Expenses', 'Money that was spent to run the business, such as stationery, printing, airtime, transport, or other running costs.'],
                  ['Net Profit', 'Revenue minus Expenses. This is what the business actually earned after paying all costs.'],
                  ['Cash Advanced', 'The amount of money given to a customer when they bring in an item. This is the loan amount.'],
                  ['Repayment Fees', 'The daily holding charges that are collected when a customer pays back and collects their item.'],
                  ['Sales Proceeds', 'Money received when an item is sold — for customers who did not come back to redeem within the deadline.'],
                  ['Service Fee', 'A one-time charge collected when a new loan is started, before daily fees begin.'],
                  ['Margin (on sales)', 'The extra money made above the cash advance when an item is sold. E.g. if ₦5,000 was advanced and item sold for ₦7,000, margin is ₦2,000.'],
                  ['Capital Deployed', 'Total advance money given out as new loans this period. This money is out in the field.'],
                  ['Capital Returned', 'Total advance money recovered from customers who paid back their loans this period.'],
                  [`Staff Share (${staffSharePct}%)`, `The staff's collective management share — ${staffSharePct}% of the net profit divided among staff based on their task performance. Each person's portion equals their task points ÷ total team task points.`],
                  [`Stakeholders (${100 - staffSharePct}%)`, `The remaining ${100 - staffSharePct}% of profit is shared among investors, each getting a share based on how much capital they put into the business.`],
                  ['Stakeholder % Share', 'Each stakeholder\'s percentage is calculated from their capital contribution compared to the total capital. More capital = higher share.'],
                ].map(([term, def]) => (
                  <div key={term} style={{ padding: '10px 0', borderBottom: `1px solid ${COLORS.border}` }}>
                    <div style={{ fontWeight: 700, fontSize: '13px', color: COLORS.primaryDark, marginBottom: '3px' }}>{term}</div>
                    <div style={{ fontSize: '13px', color: COLORS.text, lineHeight: 1.5 }}>{def}</div>
                  </div>
                ))}
              </div>
            </details>
          </div>
        );
      }

      case 'capital': {
        const capByName = Object.values(capital.reduce((acc, c) => {
          const key = c.name.toLowerCase();
          if (!acc[key]) {
            const lu = c.user_id ? users.find(u => u.id === c.user_id) : null;
            acc[key] = { name: c.name, total: 0, entries: [], user_id: c.user_id || null, username: lu?.username || null };
          }
          acc[key].total += (c.amount || 0);
          acc[key].entries.push(c);
          return acc;
        }, {}));
        const toggleExpand = (name) => setExpandedCapital(prev => { const n = new Set(prev); n.has(name) ? n.delete(name) : n.add(name); return n; });
        const capRowStyle = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0', borderBottom: `1px solid ${COLORS.border}`, fontSize: '13px' };
        return (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h2 style={{ fontSize: '20px', fontWeight: 800, color: COLORS.primaryDark }}>💎 Capital & Distributions</h2>
              {isAdmin && <button style={S.btn('primary')} onClick={() => { setCapitalTopUpFor(null); setCapForm({ name: '', amount: '', date: localISODate(), method: '', receipt: '', username: '', password: '' }); setCapShowPwd(false); setCapAccountMode('none'); setCapSelectedUserId(''); setShowAddCapital(true); }}>+ Add Stakeholder</button>}
            </div>

            {/* Available for Lending */}
            <div style={{ ...S.card, borderLeft: `4px solid ${availableLendingCapital >= 0 ? COLORS.primary : COLORS.danger}`, marginBottom: '16px' }}>
              <div style={{ ...S.cardTitle, display: 'flex', alignItems: 'center' }}>💰 Available for Lending<InfoIcon tip="The money available right now to give out as new loans. It's the total invested and earned, minus everything that's already out or paid out." /></div>
              <div style={{ fontSize: '28px', fontWeight: 800, color: availableLendingCapital >= 0 ? COLORS.primary : COLORS.danger, marginBottom: '16px' }}>{fmtMoney(availableLendingCapital)}</div>
              <div style={{ fontSize: '11px', fontWeight: 700, color: COLORS.textMuted, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' }}>How this is calculated</div>
              <div style={capRowStyle}><span>Total capital invested<InfoIcon tip="The total amount all investors have put into the business so far." /></span><strong>+ {fmtMoney(totalCapital)}</strong></div>
              <div style={capRowStyle}><span>All-time profit (revenue − expenses)<InfoIcon tip="All the profit the business has made since it started. This goes back into the money we can lend out." /></span><strong style={{ color: netProfit >= 0 ? COLORS.primary : COLORS.danger }}>+ {fmtMoney(netProfit)}</strong></div>
              <div style={capRowStyle}><span>Money out on active loans<InfoIcon tip="Money that's currently with customers who haven't paid back yet. We can't lend it out again until they return it." /></span><strong style={{ color: COLORS.danger }}>− {fmtMoney(totalCapitalOut)}</strong></div>
              <div style={capRowStyle}><span>Capital in for-sale inventory<InfoIcon tip="Money stuck in items we're trying to sell. We get this back once the item is sold." /></span><strong style={{ color: COLORS.danger }}>− {fmtMoney(totalCapitalInForSaleInventory)}</strong></div>
              <div style={{ ...capRowStyle, borderBottom: 'none' }}><span>Profit already distributed to stakeholders<InfoIcon tip="Profit that was already shared out to investors and has left the business." /></span><strong style={{ color: COLORS.danger }}>− {fmtMoney(totalDistributions)}</strong></div>
            </div>

            {/* Capital table */}
            <div style={S.card}>
              <div style={{ ...S.cardTitle, display: 'flex', alignItems: 'center' }}>📥 Stakeholder Capital<InfoIcon tip="How much each investor has put in. The more they put in, the bigger their share of the profit." /></div>
              <table style={S.table}>
                <thead><tr><th style={S.th}>Name</th><th style={S.th}>Total Capital</th><th style={S.th}><div style={{ display: 'flex', alignItems: 'center' }}>Share %<InfoIcon tip="This person's percentage of the total money invested. Their profit is worked out from this number." /></div></th><th style={S.th}>History</th>{isAdmin && <th style={S.th}>Actions</th>}</tr></thead>
                <tbody>
                  {capByName.map((s, i) => {
                    const pct = totalCapital > 0 ? (s.total / totalCapital * 100).toFixed(1) : '0.0';
                    const isExpanded = expandedCapital.has(s.name.toLowerCase());
                    return (
                      <Fragment key={i}>
                        <tr>
                          <td style={S.td}><strong>{s.name}</strong>{s.username && <div style={{ fontSize: '11px', color: COLORS.textMuted, marginTop: '2px' }}>@{s.username}</div>}{!s.username && isAdmin && <div style={{ fontSize: '11px', color: COLORS.warning, marginTop: '2px' }}>No account</div>}</td>
                          <td style={S.td}><strong>{fmtMoney(s.total)}</strong></td>
                          <td style={S.td}><strong>{pct}%</strong></td>
                          <td style={S.td}>
                            <button style={S.btnSm('accent')} onClick={() => toggleExpand(s.name.toLowerCase())}>
                              {isExpanded ? '▲ Hide' : `▼ ${s.entries.length} entry${s.entries.length !== 1 ? 'ies' : 'y'}`}
                            </button>
                          </td>
                          {isAdmin && <td style={S.td}><button style={S.btnSm('primary')} onClick={() => { setCapitalTopUpFor(s.name); setCapForm({ name: s.name, amount: '', date: localISODate(), method: '', receipt: '', username: '', password: '' }); setCapShowPwd(false); setCapAccountMode('none'); setCapSelectedUserId(''); setShowAddCapital(true); }}>+ Top Up</button></td>}
                        </tr>
                        {isExpanded && (
                          <tr>
                            <td colSpan={isAdmin ? 5 : 4} style={{ padding: '4px 0 12px 20px', background: COLORS.bg }}>
                              <table style={{ ...S.table, fontSize: '12px' }}>
                                <thead><tr><th style={S.th}>Date</th><th style={S.th}>Amount</th><th style={S.th}>Method</th><th style={S.th}>Receipt</th>{isAdmin && <th style={S.th}></th>}</tr></thead>
                                <tbody>
                                  {s.entries.map((e, j) => (
                                    <tr key={j}>
                                      <td style={S.td}>{fmtDate(e.date)}</td>
                                      <td style={S.td}>{fmtMoney(e.amount)}</td>
                                      <td style={S.td}>{e.method}</td>
                                      <td style={S.td}>{e.receipt ? <a href={e.receipt} target="_blank" rel="noopener noreferrer" style={{ color: COLORS.primary, fontWeight: 600 }}>View</a> : <span style={{ color: COLORS.textMuted }}>—</span>}</td>
                                      {isAdmin && <td style={S.td}><button style={S.btnSm('danger')} onClick={async () => { if (window.confirm(`Delete ₦${e.amount.toLocaleString()} contribution from ${e.name}?`)) { const ok = await API.del(`capital/${e.id}`); if (ok) setCapital(prev => prev.filter(x => x.id !== e.id)); loadData(); } }}>Del</button></td>}
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                  {capByName.length === 0 && <tr><td style={S.td} colSpan={isAdmin ? 5 : 4}>None yet.</td></tr>}
                </tbody>
              </table>
              <div style={{ marginTop: '12px', padding: '12px', background: COLORS.primaryLight, borderRadius: '8px', fontWeight: 700 }}>Total capital invested: {fmtMoney(totalCapital)}</div>
            </div>

            {/* Profit Distributions */}
            <div style={S.card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <div style={S.cardTitle}>💸 Profit Distributions</div>
                {canRecordDistributions && <button style={S.btn('primary')} onClick={() => { setDistForm({ date: localISODate(), amount: '', method: '', note: '', receipt: '' }); setShowAddDistribution(true); }}>+ Record Distribution</button>}
              </div>
              <p style={{ fontSize: '13px', color: COLORS.textMuted, marginBottom: '14px' }}>
                Every time profit is paid out to stakeholders, Fabian records it here. All stakeholders can see this record.
              </p>
              <table style={S.table}>
                <thead>
                  <tr>
                    <th style={S.th}>Date</th>
                    <th style={S.th}>Amount</th>
                    <th style={S.th}>Method</th>
                    <th style={S.th}>Note</th>
                    <th style={S.th}>Recorded By</th>
                    <th style={S.th}>Receipt</th>
                    {isAdmin && <th style={S.th}></th>}
                  </tr>
                </thead>
                <tbody>
                  {distributions.map((d, i) => (
                    <tr key={i}>
                      <td style={S.td}>{fmtDate(d.date)}</td>
                      <td style={S.td}><strong style={{ color: COLORS.danger }}>{fmtMoney(d.amount)}</strong></td>
                      <td style={S.td}>{d.method}</td>
                      <td style={S.td}>{d.note || <span style={{ color: COLORS.textMuted }}>—</span>}</td>
                      <td style={S.td}><span style={{ fontSize: '12px', color: COLORS.textMuted }}>{d.created_by || '—'}</span></td>
                      <td style={S.td}>{d.receipt ? <a href={d.receipt} target="_blank" rel="noopener noreferrer" style={{ color: COLORS.primary, fontWeight: 600 }}>View</a> : <span style={{ color: COLORS.textMuted }}>—</span>}</td>
                      {isAdmin && <td style={S.td}><button style={S.btnSm('danger')} onClick={async () => { if (window.confirm(`Delete this distribution record of ${fmtMoney(d.amount)}?`)) { const ok = await API.del(`distributions/${d.id}`); if (ok) setDistributions(prev => prev.filter(x => x.id !== d.id)); loadData(); } }}>Del</button></td>}
                    </tr>
                  ))}
                  {distributions.length === 0 && <tr><td style={{ ...S.td, color: COLORS.textMuted }} colSpan={isAdmin ? 7 : 6}>No distributions recorded yet.</td></tr>}
                </tbody>
              </table>
              <div style={{ marginTop: '12px', padding: '12px', background: COLORS.dangerLight, borderRadius: '8px', fontWeight: 700, color: COLORS.danger }}>Total distributed: {fmtMoney(totalDistributions)}</div>
            </div>
          </div>
        );
      }

      case 'expenses': {
        const EXP_CATEGORIES = settings.expenseCategories || DEFAULT_SETTINGS.expenseCategories;
        const expQ = expSearch.trim().toLowerCase();
        const filteredExpenses = expenses
          .filter(e => {
            if (expCategoryFilter !== 'all' && e.category !== expCategoryFilter) return false;
            if (expDateFrom && e.date < expDateFrom) return false;
            if (expDateTo && e.date > expDateTo) return false;
            if (expQ) {
              const haystack = `${e.category} ${e.description || ''} ${e.registered_by || ''}`.toLowerCase();
              if (!haystack.includes(expQ)) return false;
            }
            return true;
          })
          .sort((a, b) => {
            let av, bv;
            if (expSortKey === 'amount') { av = a.amount; bv = b.amount; }
            else if (expSortKey === 'category') { av = a.category; bv = b.category; }
            else { av = a.date; bv = b.date; }
            if (av < bv) return expSortDir === 'asc' ? -1 : 1;
            if (av > bv) return expSortDir === 'asc' ? 1 : -1;
            return 0;
          });
        const filteredTotal = filteredExpenses.reduce((s, e) => s + (e.amount || 0), 0);
        const SortBtn = ({ col, label }) => {
          const active = expSortKey === col;
          return (
            <button
              onClick={() => { if (active) setExpSortDir(d => d === 'asc' ? 'desc' : 'asc'); else { setExpSortKey(col); setExpSortDir('desc'); } }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: '11.5px', textTransform: 'uppercase', letterSpacing: '0.5px', color: active ? COLORS.primary : COLORS.textMuted, padding: 0, display: 'flex', alignItems: 'center', gap: '3px' }}
            >
              {label}{active ? (expSortDir === 'asc' ? ' ▲' : ' ▼') : ''}
            </button>
          );
        };
        const hasFilters = expSearch || expCategoryFilter !== 'all' || expDateFrom || expDateTo;
        return (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h2 style={{ fontSize: '20px', fontWeight: 800, color: COLORS.primaryDark }}>🧾 Expenses</h2>
              {isStaff && <button style={S.btn('primary')} onClick={() => { const cats = settings.expenseCategories || DEFAULT_SETTINGS.expenseCategories; setExpForm({ date: localISODate(), category: cats[0] || 'Miscellaneous', description: '', amount: '' }); setShowAddExpense(true); }}>+ Add</button>}
            </div>

            {/* Search & Filters */}
            <div style={{ background: COLORS.card, borderRadius: '12px', padding: '16px', border: `1px solid ${COLORS.border}`, marginBottom: '16px' }}>
              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <div style={{ flex: '1 1 200px' }}>
                  <div style={S.label}>Search</div>
                  <input
                    style={S.input}
                    placeholder="Description, category, user…"
                    value={expSearch}
                    onChange={e => setExpSearch(e.target.value)}
                  />
                </div>
                <div style={{ flex: '1 1 160px' }}>
                  <div style={S.label}>Category</div>
                  <select style={S.select} value={expCategoryFilter} onChange={e => setExpCategoryFilter(e.target.value)}>
                    <option value="all">All categories</option>
                    {EXP_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div style={{ flex: '1 1 130px' }}>
                  <div style={S.label}>From</div>
                  <input style={S.input} type="date" value={expDateFrom} onClick={e => e.target.showPicker && e.target.showPicker()} onChange={e => setExpDateFrom(e.target.value)} />
                </div>
                <div style={{ flex: '1 1 130px' }}>
                  <div style={S.label}>To</div>
                  <input style={S.input} type="date" value={expDateTo} onClick={e => e.target.showPicker && e.target.showPicker()} onChange={e => setExpDateTo(e.target.value)} />
                </div>
                {hasFilters && (
                  <button style={{ ...S.btnSm('secondary'), alignSelf: 'flex-end', marginBottom: '1px' }} onClick={() => { setExpSearch(''); setExpCategoryFilter('all'); setExpDateFrom(''); setExpDateTo(''); }}>
                    Clear
                  </button>
                )}
              </div>
            </div>

            <div style={S.card}>
              <table style={S.table}>
                <thead>
                  <tr>
                    <th style={S.th}><SortBtn col="date" label="Date" /></th>
                    <th style={S.th}><SortBtn col="category" label="Category" /></th>
                    <th style={S.th}>Description</th>
                    <th style={S.th}>Registered By</th>
                    <th style={S.th}><SortBtn col="amount" label="Amount" /></th>
                    {isAdmin && <th style={S.th}>Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {filteredExpenses.map((e, i) => (
                    <tr key={e.id || i}>
                      <td style={S.td}>{fmtDate(e.date)}</td>
                      <td style={S.td}>
                        <span style={{ background: COLORS.accentLight, color: COLORS.warning, padding: '2px 8px', borderRadius: '12px', fontSize: '12px', fontWeight: 600 }}>
                          {e.category}
                        </span>
                      </td>
                      <td style={S.td}>{e.description || <span style={{ color: COLORS.textMuted }}>—</span>}</td>
                      <td style={S.td}>
                        <span style={{ fontSize: '12px', color: COLORS.textMuted, fontWeight: 500 }}>
                          {e.registered_by || <span style={{ color: COLORS.border }}>—</span>}
                        </span>
                      </td>
                      <td style={S.td}><strong style={{ color: COLORS.danger }}>{fmtMoney(e.amount)}</strong></td>
                      {isAdmin && (
                        <td style={S.td}>
                          <button style={S.btnSm('danger')} onClick={async () => {
                            if (window.confirm('Delete this expense entry?')) {
                              const ok = await API.del(`expenses/${e.id}`);
                              if (ok) setExpenses(prev => prev.filter(x => x.id !== e.id));
                              loadData();
                            }
                          }}>Delete</button>
                        </td>
                      )}
                    </tr>
                  ))}
                  {filteredExpenses.length === 0 && (
                    <tr>
                      <td style={{ ...S.td, color: COLORS.textMuted, textAlign: 'center' }} colSpan={isAdmin ? 6 : 5}>
                        {hasFilters ? 'No expenses match your filters.' : 'No expenses recorded yet.'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              <div style={{ marginTop: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px', background: COLORS.dangerLight, borderRadius: '8px' }}>
                <span style={{ fontSize: '13px', color: COLORS.textMuted }}>
                  {hasFilters ? `${filteredExpenses.length} of ${expenses.length} entries` : `${expenses.length} entries`}
                </span>
                <span style={{ fontWeight: 700, color: COLORS.danger }}>
                  {hasFilters ? 'Filtered total: ' : 'Total: '}{fmtMoney(filteredTotal)}
                </span>
              </div>
            </div>
          </div>
        );
      }

      case 'declined': return (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
            <h2 style={{ fontSize: '20px', fontWeight: 800, color: COLORS.primaryDark }}>🚫 Declined Log</h2>
            {isStaff && <button style={S.btn('primary')} onClick={() => { setDecForm({ date: localISODate(), ref: '', customerName: '', ninBvn: '', item: '', reason: '', notes: '' }); setShowAddDeclined(true); }}>+ Add</button>}
          </div>
          <div style={S.card}>
            <table style={S.table}>
              <thead>
                <tr>
                  <th style={S.th}>Date</th>
                  <th style={S.th}>Ref #</th>
                  <th style={S.th}>Customer</th>
                  <th style={S.th}>Item Brought</th>
                  <th style={S.th}>Reason</th>
                  <th style={S.th}>Notes</th>
                </tr>
              </thead>
              <tbody>
                {declinedLog.map((d, i) => {
                  const linkedTx = d.ref ? transactions.find(t => t.ref === d.ref) : null;
                  return (
                  <tr key={i}>
                    <td style={S.td}>{fmtDate(d.date)}</td>
                    <td style={{ ...S.td, fontSize: '12px' }}>
                      {d.ref
                        ? linkedTx
                          ? (<button style={{ background: 'none', border: 'none', color: COLORS.primary, cursor: 'pointer', padding: 0, fontSize: '12px', textDecoration: 'underline', fontWeight: 600 }} onClick={() => navigate(txDetailPath(linkedTx.ref))}>{d.ref}</button>)
                          : (<span style={{ color: COLORS.textMuted }}>{d.ref}</span>)
                        : '—'}
                    </td>
                    <td style={S.td}>
                      <div>{d.customerName || '—'}</div>
                      {d.ninBvn && <div style={{ fontSize: '11px', color: COLORS.textMuted }}>{d.ninBvn}</div>}
                    </td>
                    <td style={S.td}>{d.item}</td>
                    <td style={S.td}>{d.reason}</td>
                    <td style={{ ...S.td, color: d.notes ? COLORS.textDark : COLORS.textMuted, fontStyle: d.notes ? 'normal' : 'italic' }}>{d.notes || '—'}</td>
                  </tr>
                  );
                })}
                {declinedLog.length === 0 && <tr><td style={S.td} colSpan={6}>None.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      );

      case 'activity': {
        const actColor = (a) => {
          if (a.action === 'delete') return COLORS.danger;
          if (a.action === 'repaid' || a.action === 'sold') return COLORS.primary;
          if (a.action === 'deactivate') return COLORS.danger;
          if (a.action === 'activate') return COLORS.primary;
          if (a.entity_type === 'transaction' && a.action === 'entry') return '#3b82f6';
          if (a.entity_type === 'expense') return COLORS.warning;
          if (a.entity_type === 'capital') return '#8b5cf6';
          if (a.entity_type === 'auth') return COLORS.textMuted;
          return COLORS.textMuted;
        };
        const roleColor = (r) => r === 'admin' ? '#c8a84e' : r === 'staff' ? '#10b981' : '#6b7280';
        const grouped = activityLogs.reduce((acc, a) => { const k = new Intl.DateTimeFormat('en-CA', { timeZone: NIGERIA_TZ }).format(new Date(a.created_at)); if (!acc[k]) acc[k] = []; acc[k].push(a); return acc; }, {});
        const applyFilters = () => loadActivityLogs(activityFilter);
        const setF = (patch) => setActivityFilter(prev => ({ ...prev, ...patch }));
        const todayStr = localISODate();
        return (
          <div>
            <h2 style={{ fontSize: '20px', fontWeight: 800, marginBottom: '4px', color: COLORS.primaryDark }}>🕘 Activity Log</h2>
            <p style={{ fontSize: '13px', color: COLORS.textMuted, marginBottom: '16px' }}>Full audit trail — every action is permanently recorded. Visible to all roles.</p>
            {/* Filter bar */}
            <div style={{ ...S.card, marginBottom: '16px', padding: '14px' }}>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <div style={{ flex: '2 1 200px' }}>
                  <div style={{ fontSize: '11px', fontWeight: 600, color: COLORS.textMuted, marginBottom: '4px' }}>SEARCH</div>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <input style={{ ...S.input, margin: 0 }} value={activityFilter.q} placeholder="Search descriptions, usernames…"
                      onChange={e => setF({ q: e.target.value })}
                      onKeyDown={e => e.key === 'Enter' && applyFilters()} />
                  </div>
                </div>
                <div style={{ flex: '1 1 140px' }}>
                  <div style={{ fontSize: '11px', fontWeight: 600, color: COLORS.textMuted, marginBottom: '4px' }}>CATEGORY</div>
                  <select style={S.select} value={activityFilter.category} onChange={e => setF({ category: e.target.value })}>
                    {ACTIVITY_CATS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                </div>
                <div style={{ flex: '1 1 130px' }}>
                  <div style={{ fontSize: '11px', fontWeight: 600, color: COLORS.textMuted, marginBottom: '4px' }}>FROM DATE</div>
                  <input style={{ ...S.input, margin: 0 }} type="date" value={activityFilter.from} max={activityFilter.to || todayStr} onClick={e => e.target.showPicker && e.target.showPicker()} onChange={e => setF({ from: e.target.value })} />
                </div>
                <div style={{ flex: '1 1 130px' }}>
                  <div style={{ fontSize: '11px', fontWeight: 600, color: COLORS.textMuted, marginBottom: '4px' }}>TO DATE</div>
                  <input style={{ ...S.input, margin: 0 }} type="date" value={activityFilter.to} min={activityFilter.from} max={todayStr} onClick={e => e.target.showPicker && e.target.showPicker()} onChange={e => setF({ to: e.target.value })} />
                </div>
                <div style={{ flex: '1 1 120px' }}>
                  <div style={{ fontSize: '11px', fontWeight: 600, color: COLORS.textMuted, marginBottom: '4px' }}>SORT</div>
                  <select style={S.select} value={activityFilter.sort} onChange={e => setF({ sort: e.target.value })}>
                    <option value="desc">Newest first</option>
                    <option value="asc">Oldest first</option>
                  </select>
                </div>
                <div style={{ display: 'flex', gap: '6px', alignItems: 'flex-end', paddingBottom: '1px' }}>
                  <button style={S.btn('primary')} onClick={applyFilters}>Search</button>
                  <button style={S.btn('outline')} onClick={() => { const reset = { q: '', from: '', to: '', category: '', sort: 'desc' }; setActivityFilter(reset); loadActivityLogs(reset); }}>Clear</button>
                </div>
              </div>
              <div style={{ marginTop: '10px', fontSize: '12px', color: COLORS.textMuted }}>
                {activityLoading ? 'Loading…' : <>{activityLogs.length.toLocaleString()} result{activityLogs.length !== 1 ? 's' : ''} shown · {activityMeta.total.toLocaleString()} total events in database</>}
              </div>
            </div>
            {activityLogs.length === 0 && !activityLoading && <div style={S.card}><p style={{ color: COLORS.textMuted }}>No matching events found.</p></div>}
            {Object.entries(grouped).map(([dateKey, entries]) => {
              const todayNGA = localISODate(); const yesterdayNGA = addDays(todayNGA, -1);
              const label = dateKey === todayNGA ? 'Today' : dateKey === yesterdayNGA ? 'Yesterday' : new Date(dateKey).toLocaleDateString('en-GB', { timeZone: NIGERIA_TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
              return (
                <div key={dateKey} style={{ marginBottom: '24px' }}>
                  <div style={{ fontSize: '12px', fontWeight: 700, color: COLORS.textMuted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px', paddingLeft: '4px' }}>{label}</div>
                  <div style={{ ...S.card, padding: 0, overflow: 'hidden' }}>
                    {entries.map((a, i) => (
                      <div key={a.id} style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', padding: '12px 16px', borderBottom: i < entries.length - 1 ? `1px solid ${COLORS.border}` : 'none', borderLeft: `3px solid ${actColor(a)}` }}>
                        <div style={{ flexShrink: 0, minWidth: '54px' }}>
                          <div style={{ fontSize: '12px', color: COLORS.textMuted, whiteSpace: 'nowrap' }}>{new Date(a.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: NIGERIA_TZ })}</div>
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: '14px', fontWeight: 500, wordBreak: 'break-word' }}>{a.description || `${a.action} ${a.entity_type}`}</div>
                          <div style={{ fontSize: '12px', color: COLORS.textMuted, marginTop: '2px', display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                            <span style={S.badge(roleColor(a.user_role))}>{a.user_role}</span>
                            <span>{a.username}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
            {!activityLoading && activityLogs.length < activityMeta.total && (
              <div style={{ textAlign: 'center', padding: '8px 0 16px' }}>
                <button style={S.btn('outline')} onClick={() => loadActivityLogs(activityFilter, activityLogs.length, true)}>
                  Load More ({(activityMeta.total - activityLogs.length).toLocaleString()} remaining)
                </button>
              </div>
            )}
            {activityLoading && activityLogs.length > 0 && <div style={{ textAlign: 'center', padding: '12px', fontSize: '13px', color: COLORS.textMuted }}>Loading more…</div>}
          </div>
        );
      }

      case 'settings': if (!isAdmin) return <Navigate to="/dashboard" replace />; {
        const es = pendingSettings ?? settings; // effective settings (pending or saved)
        const hasUnsaved = pendingSettings !== null;
        const updateSettings = (s) => setPendingSettings(s);
        const distributableStaff = users.filter(u => u.active !== 0 && u.role === 'staff');
        return (
        <div style={{ paddingBottom: hasUnsaved ? '80px' : 0 }}>
          <h2 style={{ fontSize: '20px', fontWeight: 800, marginBottom: '4px', color: COLORS.primaryDark }}>⚙ Settings</h2>
          <div style={{ fontSize: '13px', color: COLORS.textMuted, marginBottom: '20px' }}>Manage every aspect of your business from one place. Edit settings below and click <strong>Save Changes</strong> when done.</div>

          {/* ── 1. BUSINESS PROFILE ── */}
          <div style={S.card}>
            <div style={S.cardTitle}>🏢 Business Profile</div>
            <div style={{ fontSize: '13px', color: COLORS.textMuted, marginBottom: '14px' }}>Your official business identity. The name and tagline appear on agreements, receipts, and the customer portal.</div>
            <div style={S.grid2}>
              <Field label={<span style={{ display: 'inline-flex', alignItems: 'center' }}>Business Name<InfoIcon tip="The registered name of your business. This appears on printed agreements, customer receipts, and the public landing page." /></span>}>
                <input style={S.input} value={es.businessName || DEFAULT_SETTINGS.businessName} onChange={e => updateSettings({ ...es, businessName: e.target.value })} />
              </Field>
              <Field label={<span style={{ display: 'inline-flex', alignItems: 'center' }}>Business Tagline<InfoIcon tip="A short slogan or motto shown below your business name on the landing page and receipts." /></span>}>
                <input style={S.input} value={es.businessTagline ?? DEFAULT_SETTINGS.businessTagline} onChange={e => updateSettings({ ...es, businessTagline: e.target.value })} placeholder="e.g. Fast Cash, Fair Deals" />
              </Field>
            </div>
            <div style={S.grid2}>
              <Field label={<span style={{ display: 'inline-flex', alignItems: 'center' }}>Location / Area<InfoIcon tip="The general area or town of your business. Shown in the app header and used for search fallbacks." /></span>}>
                <input style={S.input} value={es.location || DEFAULT_SETTINGS.location} onChange={e => updateSettings({ ...es, location: e.target.value })} />
              </Field>
              <Field label={<span style={{ display: 'inline-flex', alignItems: 'center' }}>CAC Registration Number<InfoIcon tip="Your Corporate Affairs Commission (CAC) registration number. This is printed on official agreements for compliance." /></span>}>
                <input style={S.input} value={es.cacRegNumber || ''} onChange={e => updateSettings({ ...es, cacRegNumber: e.target.value })} placeholder="e.g. BN-1234567" />
              </Field>
            </div>
          </div>

          {/* ── 2. BUSINESS CONTACT & HOURS ── */}
          <div style={S.card}>
            <div style={S.cardTitle}>🏪 Business Contact &amp; Hours</div>
            <div style={{ fontSize: '13px', color: COLORS.textMuted, marginBottom: '14px' }}>These values appear on the public landing page and customer portal. Update them here and they change everywhere automatically.</div>
            <Field label="Shop Address"><textarea style={S.textarea} value={es.shopAddress ?? DEFAULT_SETTINGS.shopAddress} onChange={e => updateSettings({ ...es, shopAddress: e.target.value })} /></Field>
            <div style={S.grid2}>
              <Field label="Phone Number 1"><input style={S.input} value={es.shopPhone1 ?? DEFAULT_SETTINGS.shopPhone1} onChange={e => updateSettings({ ...es, shopPhone1: e.target.value })} /></Field>
              <Field label="Phone Number 2"><input style={S.input} value={es.shopPhone2 ?? DEFAULT_SETTINGS.shopPhone2} onChange={e => updateSettings({ ...es, shopPhone2: e.target.value })} /></Field>
            </div>
            <Field label={<span style={{ display: 'inline-flex', alignItems: 'center' }}>WhatsApp Number<InfoIcon tip="Type the number starting with the country code, without the + sign (e.g. 2348165491908). Customers tap this to WhatsApp us from the loan check page." /></span>}>
              <input style={S.input} value={es.shopWhatsApp ?? DEFAULT_SETTINGS.shopWhatsApp} onChange={e => updateSettings({ ...es, shopWhatsApp: e.target.value })} placeholder="2348165491908" />
              <div style={{ fontSize: '12px', color: COLORS.textMuted, marginTop: '4px' }}>Enter in international format without the + sign. Example: 2348165491908</div>
            </Field>
            <Field label="Operating Hours"><input style={S.input} value={es.shopHours ?? DEFAULT_SETTINGS.shopHours} onChange={e => updateSettings({ ...es, shopHours: e.target.value })} placeholder="Monday – Saturday, 8am – 6pm" /></Field>
            <Field label={<span style={{ display: 'inline-flex', alignItems: 'center' }}>Google Maps Link (optional)<InfoIcon tip="Paste a Google Maps link here so customers can find the shop easily. If you leave it empty, it'll use a Google Search link instead." /></span>}>
              <input style={S.input} value={es.shopMapsUrl || ''} onChange={e => updateSettings({ ...es, shopMapsUrl: e.target.value })} placeholder="Paste a Google Maps share link here. If blank, falls back to a Google Search." />
            </Field>
          </div>

          {/* ── 3. LOAN PARAMETERS ── */}
          <div style={S.card}>
            <div style={S.cardTitle}>💰 Loan Parameters</div>
            <div style={{ fontSize: '13px', color: COLORS.textMuted, marginBottom: '14px' }}>Core rules that control how loans are calculated — interest rates, caps, timeframes, and fees.</div>
            <div style={S.grid2}>
              <Field label={<span style={{ display: 'inline-flex', alignItems: 'center' }}>Daily Interest Rate (%)<InfoIcon tip="How much we charge per day as a fee. Example: 1% on ₦10,000 means ₦100 every day the customer hasn't paid back yet." /></span>}>
                <input style={S.input} type="number" step="0.1" min="0" max="10" value={es.interestRate} onChange={e => updateSettings({ ...es, interestRate: Number(e.target.value) })} />
              </Field>
              <Field label={<span style={{ display: 'inline-flex', alignItems: 'center' }}>Service Fee (₦)<InfoIcon tip="A flat charge we collect once at the start of every loan — on the same day we hand over the cash." /></span>}>
                <input style={S.input} type="number" min="0" value={es.serviceFee} onChange={e => updateSettings({ ...es, serviceFee: Number(e.target.value) })} />
              </Field>
              <Field label={<span style={{ display: 'inline-flex', alignItems: 'center' }}>Loan Cap — No Receipt (%)<InfoIcon tip="The most we can give a customer who has no receipt — as a percentage of the item's value. We give less because we can't fully verify they own it." /></span>}>
                <input style={S.input} type="number" min="0" max="100" value={es.loanCapNoReceipt} onChange={e => updateSettings({ ...es, loanCapNoReceipt: Number(e.target.value) })} />
              </Field>
              <Field label={<span style={{ display: 'inline-flex', alignItems: 'center' }}>Loan Cap — With Receipt (%)<InfoIcon tip="The most we can give when a customer shows a receipt — as a percentage of the item's value. We can give more because the receipt proves they bought it." /></span>}>
                <input style={S.input} type="number" min="0" max="100" value={es.loanCapWithReceipt} onChange={e => updateSettings({ ...es, loanCapWithReceipt: Number(e.target.value) })} />
              </Field>
              <Field label={<span style={{ display: 'inline-flex', alignItems: 'center' }}>Max Loan Days<InfoIcon tip="The longest time a customer can take before they must come back to pay. The system won't let you set a loan longer than this." /></span>}>
                <input style={S.input} type="number" min="1" max="365" value={es.maxLoanDays} onChange={e => updateSettings({ ...es, maxLoanDays: Number(e.target.value) })} />
              </Field>
              <Field label={<span style={{ display: 'inline-flex', alignItems: 'center' }}>Grace Days<InfoIcon tip="Extra days we give a customer after they go overdue, before we start selling their item. It's a last chance for them to come back." /></span>}>
                <input style={S.input} type="number" min="0" max="30" value={es.graceDays} onChange={e => updateSettings({ ...es, graceDays: Number(e.target.value) })} />
              </Field>
            </div>
          </div>

          {/* ── 4. SALES CONFIGURATION ── */}
          <div style={S.card}>
            <div style={S.cardTitle}>🏷 Sales Configuration</div>
            <div style={{ fontSize: '13px', color: COLORS.textMuted, marginBottom: '14px' }}>Controls how items are priced when listed for sale after a loan defaults.</div>
            <div style={S.grid2}>
              <Field label={<span style={{ display: 'inline-flex', alignItems: 'center' }}>Target Sell Price (%)<InfoIcon tip="The ideal selling price as a percentage of the item's estimated value. For example, 75% means we aim to sell a ₦100,000 item for ₦75,000." /></span>}>
                <input style={S.input} type="number" min="10" max="100" value={es.targetSellPct ?? DEFAULT_SETTINGS.targetSellPct} onChange={e => updateSettings({ ...es, targetSellPct: Number(e.target.value) })} />
              </Field>
              <Field label={<span style={{ display: 'inline-flex', alignItems: 'center' }}>Minimum Sell Bonus (%)<InfoIcon tip="The minimum profit margin above the loan amount + fees. Ensures we don't sell at a loss even if the target price is low." /></span>}>
                <input style={S.input} type="number" min="0" max="100" value={es.minSellBonus ?? DEFAULT_SETTINGS.minSellBonus} onChange={e => updateSettings({ ...es, minSellBonus: Number(e.target.value) })} />
              </Field>
              <Field label={
                <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                  Outright Purchase Min Markup (%)
                  <InfoIcon tip="The minimum profit margin above what you paid for an outright purchase. Example: you paid ₦50,000 for an item, at 20% markup the minimum sale price is ₦60,000. This protects you from ever selling at a loss." />
                </span>
              }>
                <input
                  style={S.input}
                  type="number"
                  min="0"
                  max="100"
                  value={es.outrightMinMarkupPct ?? DEFAULT_SETTINGS.outrightMinMarkupPct}
                  onChange={e => updateSettings({ ...es, outrightMinMarkupPct: Number(e.target.value) })}
                />
              </Field>
              <Field label={<span style={{ display: 'inline-flex', alignItems: 'center' }}>Max Parts-Only Advance (₦)<InfoIcon tip="The maximum loan amount for items that don't power on (parts/scrap only). These items are worth less, so the cap is lower." /></span>}>
                <input style={S.input} type="number" min="0" value={es.maxPartsOnlyAdvance ?? DEFAULT_SETTINGS.maxPartsOnlyAdvance} onChange={e => updateSettings({ ...es, maxPartsOnlyAdvance: Number(e.target.value) })} />
              </Field>
              <Field label={<span style={{ display: 'inline-flex', alignItems: 'center' }}>Show Sold History in Shop<InfoIcon tip="Whether to display a 'Recently Sold' section on the public shop page, showing past sold items and their prices as social proof." /></span>}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px', cursor: 'pointer' }}>
                  <input type="checkbox" checked={es.shopShowSoldHistory ?? DEFAULT_SETTINGS.shopShowSoldHistory} onChange={e => updateSettings({ ...es, shopShowSoldHistory: e.target.checked })} style={{ width: '18px', height: '18px', cursor: 'pointer' }} />
                  <span style={{ fontSize: '14px', fontWeight: 600 }}>Show recently sold items</span>
                </label>
              </Field>
              <Field label={<span style={{ display: 'inline-flex', alignItems: 'center' }}>Max Sold History Items<InfoIcon tip="How many recently sold items to show in the public shop's 'Recently Sold' section." /></span>}>
                <input style={S.input} type="number" min="0" max="50" value={es.shopMaxSoldHistoryItems ?? DEFAULT_SETTINGS.shopMaxSoldHistoryItems} onChange={e => updateSettings({ ...es, shopMaxSoldHistoryItems: Number(e.target.value) })} />
              </Field>
            </div>
          </div>

          {/* ── 5. OVERDUE & PENALTY RULES ── */}
          <div style={S.card}>
            <div style={S.cardTitle}>⚠ Overdue &amp; Penalty Rules</div>
            <div style={{ fontSize: '13px', color: COLORS.textMuted, marginBottom: '14px' }}>Configure what happens when a customer fails to return on time — penalties, reminders, and auto-forfeiture.</div>
            <div style={S.grid2}>
              <Field label={<span style={{ display: 'inline-flex', alignItems: 'center' }}>Penalty Rate Multiplier<InfoIcon tip="After the grace period expires, the daily fee is multiplied by this number. For example, 1.5x means a ₦100/day fee becomes ₦150/day for overdue loans. Set to 1 for no penalty." /></span>}>
                <input style={S.input} type="number" step="0.1" min="1" max="5" value={es.penaltyRateMultiplier ?? DEFAULT_SETTINGS.penaltyRateMultiplier} onChange={e => updateSettings({ ...es, penaltyRateMultiplier: Number(e.target.value) })} />
              </Field>
              <Field label={<span style={{ display: 'inline-flex', alignItems: 'center' }}>Due-Date Follow-Up Days<InfoIcon tip="Comma-separated day offsets for when the Daily Follow-ups page should show a loan before its customer due date. Example: 3, 1, 0" /></span>}>
                <ReminderDaysInput style={S.input} value={es.dueDateFollowUpDays} fallback={DEFAULT_SETTINGS.dueDateFollowUpDays} onChange={v => updateSettings({ ...es, dueDateFollowUpDays: v })} placeholder="e.g. 3, 1, 0" />
              </Field>
              <Field label={<span style={{ display: 'inline-flex', alignItems: 'center' }}>Ownership Follow-Up Days<InfoIcon tip="Comma-separated day offsets for reminders before the internal last day of ownership. Example: 3, 0 will show three days before ownership and again on the ownership day." /></span>}>
                <ReminderDaysInput style={S.input} value={es.ownershipFollowUpDays} fallback={DEFAULT_SETTINGS.ownershipFollowUpDays} onChange={v => updateSettings({ ...es, ownershipFollowUpDays: v })} placeholder="e.g. 3, 0" />
              </Field>
              <Field label={<span style={{ display: 'inline-flex', alignItems: 'center' }}>Overdue Contact Reminder (days)<InfoIcon tip="How often (in days) the follow-up page should bring back overdue loans for another contact attempt. Set to 0 to disable overdue reminders." /></span>}>
                <input style={S.input} type="number" min="0" max="30" value={es.overdueContactReminderDays ?? DEFAULT_SETTINGS.overdueContactReminderDays} onChange={e => updateSettings({ ...es, overdueContactReminderDays: Number(e.target.value) })} />
              </Field>
              <Field label={<span style={{ display: 'inline-flex', alignItems: 'center' }}>Auto-Forfeit Days<InfoIcon tip="Number of days after the grace period ends before the item is automatically marked as 'Ready to Sell'. Set to 0 to handle this manually (current behaviour)." /></span>}>
                <input style={S.input} type="number" min="0" max="90" value={es.autoForfeitDays ?? DEFAULT_SETTINGS.autoForfeitDays} onChange={e => updateSettings({ ...es, autoForfeitDays: Number(e.target.value) })} />
              </Field>
            </div>
          </div>

          {/* ── 6. ITEM CATEGORIES ── */}
          <div style={S.card}>
            <div style={S.cardTitle}>📦 Item Categories</div>
            <div style={{ fontSize: '13px', color: COLORS.textMuted, marginBottom: '14px' }}>The types of items your business accepts. These appear in reports and filters. <strong>Note:</strong> The transaction wizard uses a separate system list with photo/inspection mappings.</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '12px' }}>
              {(es.itemCategories || DEFAULT_SETTINGS.itemCategories).map((cat, i) => (
                <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '6px 12px', borderRadius: '20px', background: COLORS.primaryLight, color: COLORS.primaryDark, fontSize: '13px', fontWeight: 600, border: `1px solid ${COLORS.border}` }}>
                  {cat}
                  <button onClick={() => { const cats = [...(es.itemCategories || DEFAULT_SETTINGS.itemCategories)]; cats.splice(i, 1); updateSettings({ ...es, itemCategories: cats }); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: COLORS.danger, fontWeight: 700, fontSize: '14px', lineHeight: 1, padding: '0 2px' }} title="Remove category">×</button>
                </span>
              ))}
            </div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <input id="newCatInput" style={{ ...S.input, flex: 1 }} placeholder="Add a new category…" onKeyDown={e => { if (e.key === 'Enter' && e.target.value.trim()) { const cats = [...(es.itemCategories || DEFAULT_SETTINGS.itemCategories), e.target.value.trim()]; updateSettings({ ...es, itemCategories: cats }); e.target.value = ''; } }} />
              <button style={S.btn('primary')} onClick={() => { const inp = document.getElementById('newCatInput'); if (inp && inp.value.trim()) { const cats = [...(es.itemCategories || DEFAULT_SETTINGS.itemCategories), inp.value.trim()]; updateSettings({ ...es, itemCategories: cats }); inp.value = ''; } }}>+ Add</button>
            </div>
          </div>

          {/* ── 7. EXPENSE CATEGORIES ── */}
          <div style={S.card}>
            <div style={S.cardTitle}>🧾 Expense Categories</div>
            <div style={{ fontSize: '13px', color: COLORS.textMuted, marginBottom: '14px' }}>The categories available when logging an expense. Used in the Expenses page filter and the Add Expense form.</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '12px' }}>
              {(es.expenseCategories || DEFAULT_SETTINGS.expenseCategories).map((cat, i) => (
                <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '6px 12px', borderRadius: '20px', background: COLORS.accentLight, color: '#92400e', fontSize: '13px', fontWeight: 600, border: `1px solid ${COLORS.accent}33` }}>
                  {cat}
                  <button onClick={() => { const cats = [...(es.expenseCategories || DEFAULT_SETTINGS.expenseCategories)]; cats.splice(i, 1); updateSettings({ ...es, expenseCategories: cats }); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: COLORS.danger, fontWeight: 700, fontSize: '14px', lineHeight: 1, padding: '0 2px' }} title="Remove category">×</button>
                </span>
              ))}
            </div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <input id="newExpCatInput" style={{ ...S.input, flex: 1 }} placeholder="Add a new expense category…" onKeyDown={e => { if (e.key === 'Enter' && e.target.value.trim()) { const cats = [...(es.expenseCategories || DEFAULT_SETTINGS.expenseCategories), e.target.value.trim()]; updateSettings({ ...es, expenseCategories: cats }); e.target.value = ''; } }} />
              <button style={S.btn('primary')} onClick={() => { const inp = document.getElementById('newExpCatInput'); if (inp && inp.value.trim()) { const cats = [...(es.expenseCategories || DEFAULT_SETTINGS.expenseCategories), inp.value.trim()]; updateSettings({ ...es, expenseCategories: cats }); inp.value = ''; } }}>+ Add</button>
            </div>
          </div>

          {/* ── 9. IDENTITY VERIFICATION ── */}
          <div style={S.card}>
            <div style={S.cardTitle}>🪪 Identity Verification Rules</div>
            <div style={{ fontSize: '13px', color: COLORS.textMuted, marginBottom: '14px' }}>Control how strictly NIN/BVN verification is enforced during the transaction wizard.</div>
            <Field label={<span style={{ display: 'inline-flex', alignItems: 'center' }}>Require API-verified NIN/BVN to proceed<InfoIcon tip="When turned on, staff can only move forward if the NIN or BVN check was fully successful and returned a photo. When turned off, any attempt — even a failed one — is enough to continue. Useful when the service is down." /></span>}>
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', cursor: 'pointer' }}>
                <input type="checkbox" checked={!!es.requireNinVerification} onChange={e => updateSettings({ ...es, requireNinVerification: e.target.checked })} style={{ width: '18px', height: '18px', marginTop: '2px', flexShrink: 0 }} />
                <span style={{ fontSize: '13px' }}>When enabled, staff <strong>cannot</strong> advance past the Identity step unless the NIN or BVN has been successfully verified via the API <em>and</em> a photo has been retrieved. When disabled (default), any verification attempt (including failed ones) is enough to proceed.</span>
              </label>
            </Field>
            <div style={S.grid2}>
              <Field label={<span style={{ display: 'inline-flex', alignItems: 'center' }}>Cost per Verification Credit (₦)<InfoIcon tip="The Naira cost of one NIN/BVN verification credit on checkmyninbvn.com.ng. The system divides your wallet balance by this number to show how many new verifications you can still make. Update this if the provider changes their price." /></span>}>
                <input style={S.input} type="number" min="1" value={es.ninCreditCost ?? DEFAULT_SETTINGS.ninCreditCost} onChange={e => updateSettings({ ...es, ninCreditCost: Math.max(1, Number(e.target.value) || DEFAULT_SETTINGS.ninCreditCost) })} />
                <div style={{ fontSize: '12px', color: COLORS.textMuted, marginTop: '4px' }}>Currently set to <strong>₦{(es.ninCreditCost ?? DEFAULT_SETTINGS.ninCreditCost).toLocaleString()}</strong> per credit as charged by checkmyninbvn.com.ng. Update this if their pricing changes.</div>
              </Field>
              <Field label={<span style={{ display: 'inline-flex', alignItems: 'center' }}>Low Credit Alert Threshold<InfoIcon tip={`Show a warning on the Identity Verification step when the number of remaining NIN/BVN credits falls to or below this number. Each credit covers one new verification lookup (currently ₦${(es.ninCreditCost ?? DEFAULT_SETTINGS.ninCreditCost).toLocaleString()} each).`} /></span>}>
                <input style={S.input} type="number" min="1" max="100" value={es.ninLowCreditThreshold ?? DEFAULT_SETTINGS.ninLowCreditThreshold} onChange={e => updateSettings({ ...es, ninLowCreditThreshold: Number(e.target.value) })} />
                <div style={{ fontSize: '12px', color: COLORS.textMuted, marginTop: '4px' }}>A warning badge appears on the Identity step when credits drop to this number or below.</div>
              </Field>
            </div>
            <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: `1px solid ${COLORS.border}` }}>
              <div style={{ fontSize: '13px', fontWeight: 700, marginBottom: '4px' }}>💳 Recharge Payment Details</div>
              <div style={{ fontSize: '13px', color: COLORS.textMuted, marginBottom: '12px' }}>Staff can view these details by tapping <strong>Recharge</strong> on the Identity Verification step when credits are low. Enter the account where funds should be sent to top up the checkmyninbvn.com.ng wallet.</div>
              <div style={S.grid2}>
                <Field label={<span style={{ display: 'inline-flex', alignItems: 'center' }}>Bank Name<InfoIcon tip="The bank where the NIN/BVN wallet is funded. This is shown to staff when they need to top up verification credits." /></span>}>
                  <input style={S.input} value={es.ninRechargeBank ?? ''} onChange={e => updateSettings({ ...es, ninRechargeBank: e.target.value })} placeholder="e.g. Access Bank" />
                </Field>
                <Field label={<span style={{ display: 'inline-flex', alignItems: 'center' }}>Account Number<InfoIcon tip="The account number for funding the NIN/BVN verification wallet." /></span>}>
                  <input style={S.input} inputMode="numeric" value={es.ninRechargeAccountNumber ?? ''} onChange={e => updateSettings({ ...es, ninRechargeAccountNumber: e.target.value.replace(/\D/g, '') })} placeholder="e.g. 0123456789" />
                </Field>
              </div>
              <Field label={<span style={{ display: 'inline-flex', alignItems: 'center' }}>Account Name<InfoIcon tip="The account name for the NIN/BVN wallet funding account." /></span>}>
                <input style={S.input} value={es.ninRechargeAccountName ?? ''} onChange={e => updateSettings({ ...es, ninRechargeAccountName: e.target.value })} placeholder="e.g. CheckMyNinBvn Technology Ltd" />
              </Field>
            </div>
          </div>

          {/* ── 10. API KEYS ── */}
          <div style={S.card}>
            <div style={S.cardTitle}>🔑 API Keys &amp; Integrations</div>
            <div style={{ fontSize: '13px', color: COLORS.textMuted, marginBottom: '14px' }}>External service credentials. These are stored securely and never shown in full after saving.</div>
            <Field label={<span style={{ display: 'inline-flex', alignItems: 'center' }}>Gemini AI API Key<InfoIcon tip="The key that turns on the AI valuation feature. You can get one for free at aistudio.google.com." /></span>}>
              <input style={S.input} type="password" value={es.geminiApiKey} onChange={e => updateSettings({ ...es, geminiApiKey: e.target.value })} placeholder="From aistudio.google.com" />
            </Field>
            <Field label={<span style={{ display: 'inline-flex', alignItems: 'center' }}>Gemini Model<InfoIcon tip="Which AI model to use for valuations. Leave it as default — the system will switch to a backup automatically if needed." /></span>}>
              <input style={S.input} value={es.geminiModel || DEFAULT_SETTINGS.geminiModel} onChange={e => updateSettings({ ...es, geminiModel: e.target.value })} placeholder={DEFAULT_SETTINGS.geminiModel} />
            </Field>
            <Field label={<span style={{ display: 'inline-flex', alignItems: 'center' }}>Google Cloud Vision API Key<InfoIcon tip="Optional. Used for reverse image search when Gemini cannot clearly identify the item model or specs. Get one from console.cloud.google.com — enable the Cloud Vision API, then create an API key. If not set, only Gemini will be used for identification." /></span>}>
              <input style={S.input} type="password" value={es.cloudVisionApiKey || ''} onChange={e => updateSettings({ ...es, cloudVisionApiKey: e.target.value })} placeholder="From console.cloud.google.com (optional)" />
            </Field>
            <Field label={<span style={{ display: 'inline-flex', alignItems: 'center' }}>NIN/BVN API Key<InfoIcon tip="The key for the NIN/BVN check service. This lets the system look up a customer's identity details automatically." /></span>}>
              <input style={S.input} type="password" value={es.ninApiKey} onChange={e => updateSettings({ ...es, ninApiKey: e.target.value })} placeholder="From checkmyninbvn.com.ng" />
            </Field>
            <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: `1px solid ${COLORS.border}` }}>
              <div style={{ fontSize: '13px', fontWeight: 700, marginBottom: '10px' }}>API Free Tier Limits</div>
              <div style={{ fontSize: '12px', color: COLORS.textMuted, marginBottom: '12px' }}>Set these to match Google's free tier limits. The system will block API calls when limits are reached to prevent billing. Adjust if Google changes their free tier.</div>
              <div style={S.grid3}>
                <Field label={<span style={{ display: 'inline-flex', alignItems: 'center' }}>Gemini Daily Limit<InfoIcon tip="Maximum Gemini API calls per day. Free tier: Pro=100, Flash=250, Flash-Lite=1000. Each AI run uses 1-2 calls, so ~20-50 transactions/day with Pro." /></span>}>
                  <input style={S.input} type="number" min="1" value={es.geminiDailyLimit ?? DEFAULT_SETTINGS.geminiDailyLimit} onChange={e => updateSettings({ ...es, geminiDailyLimit: Number(e.target.value) || DEFAULT_SETTINGS.geminiDailyLimit })} />
                </Field>
                <Field label={<span style={{ display: 'inline-flex', alignItems: 'center' }}>Gemini RPM Limit<InfoIcon tip="Maximum Gemini calls per minute. Free tier: Pro=5, Flash=10, Flash-Lite=15. Prevents rate-limit errors from Google." /></span>}>
                  <input style={S.input} type="number" min="1" value={es.geminiRpmLimit ?? DEFAULT_SETTINGS.geminiRpmLimit} onChange={e => updateSettings({ ...es, geminiRpmLimit: Number(e.target.value) || DEFAULT_SETTINGS.geminiRpmLimit })} />
                </Field>
                <Field label={<span style={{ display: 'inline-flex', alignItems: 'center' }}>Vision Monthly Limit<InfoIcon tip="Maximum Cloud Vision images per month. Free tier: 1,000 images/month. Each transaction uses up to 2 images for Vision analysis." /></span>}>
                  <input style={S.input} type="number" min="1" value={es.visionMonthlyLimit ?? DEFAULT_SETTINGS.visionMonthlyLimit} onChange={e => updateSettings({ ...es, visionMonthlyLimit: Number(e.target.value) || DEFAULT_SETTINGS.visionMonthlyLimit })} />
                </Field>
              </div>
              <div style={{ ...S.card, background: COLORS.bg, padding: '12px', marginTop: '10px' }}>
                <div style={{ fontSize: '12px', fontWeight: 700, marginBottom: '8px' }}>Current Usage</div>
                <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap', fontSize: '12px' }}>
                  <div>Gemini today: <strong>{getGeminiUsageToday()}</strong> / {es.geminiDailyLimit ?? DEFAULT_SETTINGS.geminiDailyLimit}</div>
                  <div>Gemini RPM: <strong>{getGeminiRpm()}</strong> / {es.geminiRpmLimit ?? DEFAULT_SETTINGS.geminiRpmLimit}</div>
                  <div>Vision this month: <strong>{getVisionUsageThisMonth()}</strong> / {es.visionMonthlyLimit ?? DEFAULT_SETTINGS.visionMonthlyLimit}</div>
                </div>
              </div>
            </div>
          </div>

          {/* ── 11. WHATSAPP MESSAGE TEMPLATES ── */}
          <div style={S.card}>
            <div style={S.cardTitle}>💬 WhatsApp Message Templates</div>
            <div style={{ fontSize: '13px', color: COLORS.textMuted, marginBottom: '14px' }}>Pre-written messages for common customer communications. Use placeholders: <code style={{ background: COLORS.bg, padding: '2px 6px', borderRadius: '4px', fontSize: '12px' }}>{'{customerName}'}</code> <code style={{ background: COLORS.bg, padding: '2px 6px', borderRadius: '4px', fontSize: '12px' }}>{'{ref}'}</code> <code style={{ background: COLORS.bg, padding: '2px 6px', borderRadius: '4px', fontSize: '12px' }}>{'{amount}'}</code> <code style={{ background: COLORS.bg, padding: '2px 6px', borderRadius: '4px', fontSize: '12px' }}>{'{daysLeft}'}</code> <code style={{ background: COLORS.bg, padding: '2px 6px', borderRadius: '4px', fontSize: '12px' }}>{'{daysOverdue}'}</code> <code style={{ background: COLORS.bg, padding: '2px 6px', borderRadius: '4px', fontSize: '12px' }}>{'{shopPhone}'}</code> <code style={{ background: COLORS.bg, padding: '2px 6px', borderRadius: '4px', fontSize: '12px' }}>{'{businessName}'}</code></div>
            <Field label={<span style={{ display: 'inline-flex', alignItems: 'center' }}>Loan Reminder<InfoIcon tip="Sent to customers a few days before their loan is due. Helps reduce overdue rates." /></span>}>
              <textarea style={S.textarea} value={es.whatsappLoanReminder ?? DEFAULT_SETTINGS.whatsappLoanReminder} onChange={e => updateSettings({ ...es, whatsappLoanReminder: e.target.value })} />
            </Field>
            <Field label={<span style={{ display: 'inline-flex', alignItems: 'center' }}>Overdue Notice<InfoIcon tip="Sent when a customer's loan is past due. Should be firm but professional." /></span>}>
              <textarea style={S.textarea} value={es.whatsappOverdueNotice ?? DEFAULT_SETTINGS.whatsappOverdueNotice} onChange={e => updateSettings({ ...es, whatsappOverdueNotice: e.target.value })} />
            </Field>
            <Field label={<span style={{ display: 'inline-flex', alignItems: 'center' }}>Pickup Ready<InfoIcon tip="Sent when a customer has paid and their item is ready for collection." /></span>}>
              <textarea style={S.textarea} value={es.whatsappPickupReady ?? DEFAULT_SETTINGS.whatsappPickupReady} onChange={e => updateSettings({ ...es, whatsappPickupReady: e.target.value })} />
            </Field>
          </div>

          {/* ── 12. RECEIPT & AGREEMENT ── */}
          <div style={S.card}>
            <div style={S.cardTitle}>🧾 Receipt &amp; Agreement Customization</div>
            <div style={{ fontSize: '13px', color: COLORS.textMuted, marginBottom: '14px' }}>Customize the text that appears on printed agreements and receipts.</div>
            <Field label={<span style={{ display: 'inline-flex', alignItems: 'center' }}>Additional Agreement Terms<InfoIcon tip="Extra terms or clauses to include at the bottom of the printed loan agreement. Leave blank if you don't need any additions beyond the standard terms." /></span>}>
              <textarea style={{ ...S.textarea, minHeight: '100px' }} value={es.agreementTermsExtra ?? ''} onChange={e => updateSettings({ ...es, agreementTermsExtra: e.target.value })} placeholder="e.g. Items unclaimed after 60 days become property of the business." />
            </Field>
            <Field label={<span style={{ display: 'inline-flex', alignItems: 'center' }}>Receipt Footer Text<InfoIcon tip="A short message printed at the bottom of customer receipts." /></span>}>
              <input style={S.input} value={es.receiptFooter ?? DEFAULT_SETTINGS.receiptFooter} onChange={e => updateSettings({ ...es, receiptFooter: e.target.value })} placeholder="Thank you for your patronage!" />
            </Field>
          </div>

          {/* ── 13. PROFIT SHARING ── */}
          <div style={S.card}>
            <div style={S.cardTitle}>💼 Profit Sharing</div>
            <div style={{ fontSize: '13px', color: COLORS.textMuted, marginBottom: '14px' }}>Configure how net profit is split between staff and investors. The remainder after the staff share goes to stakeholders.</div>
            <div style={S.grid2}>
              <Field label={<span style={{ display: 'inline-flex', alignItems: 'center' }}>Staff Share (%)<InfoIcon tip="The percentage of net profit shared equally among all active staff members. The remaining percentage goes to stakeholders based on their capital contributions. Default is 10%." /></span>}>
                <input style={S.input} type="number" min="0" max="100" step="1" value={es.staffSharePct ?? DEFAULT_SETTINGS.staffSharePct} onChange={e => updateSettings({ ...es, staffSharePct: Math.min(100, Math.max(0, Number(e.target.value))) })} />
                <div style={{ fontSize: '12px', color: COLORS.textMuted, marginTop: '4px' }}>Stakeholders receive the remaining <strong>{100 - (es.staffSharePct ?? DEFAULT_SETTINGS.staffSharePct)}%</strong>.</div>
              </Field>
              <Field label={<span style={{ display: 'inline-flex', alignItems: 'center' }}>Target Sale Deadline (days)<InfoIcon tip="Adds extra days after the max loan and grace window to set each item's target sale date. Staff earn a bonus task point when the item sells on or before that intake-anchored target date. Default: 14 days." /></span>}>
                <input style={S.input} type="number" min="1" max="365" value={es.targetSaleDeadlineDays ?? DEFAULT_SETTINGS.targetSaleDeadlineDays} onChange={e => updateSettings({ ...es, targetSaleDeadlineDays: Number(e.target.value) })} />
              </Field>
            </div>
            <div style={{ fontSize: '13px', color: COLORS.textMuted, marginTop: '12px', padding: '10px 14px', background: COLORS.bg, borderRadius: '8px', border: `1px solid ${COLORS.border}` }}>
              <strong>How staff shares are calculated:</strong> Each period, the staff pool ({es.staffSharePct ?? DEFAULT_SETTINGS.staffSharePct}% of net profit) is divided based on task points. Points are earned for: completing a new loan intake (+1), processing a repayment (+1), completing a sale (+1), logging a contact attempt on an overdue loan (+1), selling at or above the target price (+1 bonus), and selling on or before the intake-anchored target sale date ({es.targetSaleDeadlineDays ?? DEFAULT_SETTINGS.targetSaleDeadlineDays} days after the max loan and grace window) (+1 bonus). Each staff member's share = their points ÷ total points.
            </div>
          </div>

          {/* ── 14. PROFIT DISTRIBUTION ACCESS ── */}
          <div style={S.card}>
            <div style={S.cardTitle}>💸 Profit Distribution Access</div>
            <div style={{ fontSize: '13px', color: COLORS.textMuted, marginBottom: '14px' }}>Admins can always record profit distributions. Select any extra staff members who should also be allowed to record them.</div>
            {distributableStaff.length > 0 ? (
              <div style={{ display: 'grid', gap: '10px' }}>
                {distributableStaff.map(u => {
                  const selected = (es.distributionAuthorizedUserIds || DEFAULT_SETTINGS.distributionAuthorizedUserIds).includes(u.id);
                  return (
                    <label key={u.id} style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', padding: '10px 12px', border: `1px solid ${selected ? COLORS.primary : COLORS.border}`, borderRadius: '8px', background: selected ? COLORS.primaryLight : '#fff', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={e => {
                          const next = new Set(es.distributionAuthorizedUserIds || DEFAULT_SETTINGS.distributionAuthorizedUserIds);
                          if (e.target.checked) next.add(u.id);
                          else next.delete(u.id);
                          updateSettings({ ...es, distributionAuthorizedUserIds: [...next] });
                        }}
                        style={{ width: '18px', height: '18px', marginTop: '2px', flexShrink: 0 }}
                      />
                      <span>
                        <strong>{u.name}</strong> <span style={{ color: COLORS.textMuted }}>@{u.username}</span>
                        <div style={{ fontSize: '12px', color: COLORS.textMuted, marginTop: '2px' }}>Primary role: {u.role}{(u.roles || []).length ? ` · Extra roles: ${(u.roles || []).join(', ')}` : ''}</div>
                      </span>
                    </label>
                  );
                })}
              </div>
            ) : (
              <div style={{ fontSize: '13px', color: COLORS.textMuted }}>No active staff accounts found. Create or enable a staff account first if you want to delegate distribution recording.</div>
            )}
          </div>

          {/* ── 15. SECURITY ── */}
          <div style={S.card}>
            <div style={S.cardTitle}>🔒 Security &amp; Access Control</div>
            <div style={{ fontSize: '13px', color: COLORS.textMuted, marginBottom: '14px' }}>Protect your system with login rules and session policies.</div>
            <div style={S.grid2}>
              <Field label={<span style={{ display: 'inline-flex', alignItems: 'center' }}>Session Timeout (minutes)<InfoIcon tip="How long a user can stay logged in without activity before being automatically logged out. Default is 480 minutes (8 hours)." /></span>}>
                <input style={S.input} type="number" min="5" max="1440" value={es.sessionTimeoutMinutes ?? DEFAULT_SETTINGS.sessionTimeoutMinutes} onChange={e => updateSettings({ ...es, sessionTimeoutMinutes: Number(e.target.value) })} />
              </Field>
              <Field label={<span style={{ display: 'inline-flex', alignItems: 'center' }}>Minimum Password Length<InfoIcon tip="The shortest password allowed when creating or updating user accounts. Longer passwords are more secure." /></span>}>
                <input style={S.input} type="number" min="4" max="32" value={es.minPasswordLength ?? DEFAULT_SETTINGS.minPasswordLength} onChange={e => updateSettings({ ...es, minPasswordLength: Number(e.target.value) })} />
              </Field>
              <Field label={<span style={{ display: 'inline-flex', alignItems: 'center' }}>Max Login Attempts<InfoIcon tip="How many wrong password attempts before the account is temporarily locked. Prevents brute-force attacks." /></span>}>
                <input style={S.input} type="number" min="1" max="20" value={es.maxLoginAttempts ?? DEFAULT_SETTINGS.maxLoginAttempts} onChange={e => updateSettings({ ...es, maxLoginAttempts: Number(e.target.value) })} />
              </Field>
              <Field label={<span style={{ display: 'inline-flex', alignItems: 'center' }}>Login Cooldown (minutes)<InfoIcon tip="How long to lock an account after exceeding the max login attempts." /></span>}>
                <input style={S.input} type="number" min="1" max="60" value={es.loginCooldownMinutes ?? DEFAULT_SETTINGS.loginCooldownMinutes} onChange={e => updateSettings({ ...es, loginCooldownMinutes: Number(e.target.value) })} />
              </Field>
            </div>
          </div>

          {/* ── 16. DATA MANAGEMENT ── */}
          <div style={S.card}>
            <div style={S.cardTitle}>🗄 Data Management</div>
            <div style={{ fontSize: '13px', color: COLORS.textMuted, marginBottom: '14px' }}>Control how long data is retained and manage system maintenance tasks.</div>
            <div style={S.grid2}>
              <Field label={<span style={{ display: 'inline-flex', alignItems: 'center' }}>Activity Log Retention (days)<InfoIcon tip="How many days of activity logs to keep in the database. Older logs are automatically cleaned up to save storage. Set to 0 to keep everything forever." /></span>}>
                <input style={S.input} type="number" min="0" max="365" value={es.activityLogRetentionDays ?? DEFAULT_SETTINGS.activityLogRetentionDays} onChange={e => updateSettings({ ...es, activityLogRetentionDays: Number(e.target.value) })} />
              </Field>
            </div>
          </div>

          {/* ── 17. DANGER ZONE ── */}
          <div style={{ ...S.card, border: `2px solid ${COLORS.danger}`, background: COLORS.dangerLight }}>
            <div style={{ ...S.cardTitle, color: COLORS.danger }}>🚨 Danger Zone</div>
            <div style={{ fontSize: '13px', color: COLORS.text, marginBottom: '14px' }}>Irreversible actions. Proceed with extreme caution.</div>
            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
              <button style={S.btn('danger')} onClick={() => { if (window.confirm('Reset ALL settings to factory defaults? This cannot be undone.') && window.confirm('Are you absolutely sure? This will wipe all your custom settings.')) { updateSettings({ ...DEFAULT_SETTINGS }); } }}>Reset All Settings to Defaults</button>
            </div>
          </div>

          {/* ── STICKY SAVE BAR ── */}
          {hasUnsaved && (
            <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 200, background: COLORS.primaryDark, padding: '14px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', boxShadow: '0 -4px 20px rgba(0,0,0,0.25)' }}>
              <span style={{ color: '#fff', fontSize: '14px', fontWeight: 600 }}>You have unsaved changes.</span>
              <div style={{ display: 'flex', gap: '10px' }}>
                <button style={{ ...S.btn('outline'), color: '#fff', borderColor: 'rgba(255,255,255,0.4)', background: 'transparent' }} onClick={() => setPendingSettings(null)}>Discard</button>
                <button style={{ ...S.btn('primary'), background: '#fff', color: COLORS.primaryDark, fontWeight: 700 }} onClick={() => { setSettingsPwdInput(''); setSettingsPwdError(''); setShowSettingsPwdModal(true); }}>Save Changes</button>
              </div>
            </div>
          )}
        </div>
      );
      }

      case 'users': if (!isAdmin) return <Navigate to="/dashboard" replace />; return (<div><div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}><h2 style={{ fontSize: '20px', fontWeight: 800, color: COLORS.primaryDark }}>👥 Users</h2><button style={S.btn('primary')} onClick={() => { setUsrForm({ name: '', username: '', password: '', role: 'staff' }); setUsrShowPwd(false); setShowAddUser(true); }}>+ Add User</button></div><div style={{ fontSize: '13px', color: COLORS.textMuted, marginBottom: '16px', padding: '10px 14px', background: COLORS.primaryLight, borderRadius: '8px', border: `1px solid ${COLORS.border}` }}>A user can hold multiple roles — for example, a staff member can also be a stakeholder. Use the <strong>Grant/Revoke Stakeholder</strong> button below to manage this without needing two accounts.</div><div style={S.card}><table style={S.table}><thead><tr><th style={S.th}>Name</th><th style={S.th}>Username</th><th style={S.th}>Roles</th><th style={S.th}>Status</th><th style={S.th}>Actions</th></tr></thead><tbody>{users.map(u => { const isActive = u.active !== 0; const extraRoles = u.roles || []; const isAlsoStakeholder = u.role !== 'stakeholder' && extraRoles.includes('stakeholder'); const canToggleStakeholder = u.role !== 'admin' && u.role !== 'stakeholder'; return (<tr key={u.id} style={{ opacity: isActive ? 1 : 0.6 }}><td style={S.td}><strong>{u.name}</strong></td><td style={S.td}>@{u.username}</td><td style={S.td}><div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', alignItems: 'center' }}><span style={S.badge(u.role === 'admin' ? COLORS.primary : u.role === 'staff' ? COLORS.accent : '#6b7280')}>{u.role}</span>{extraRoles.map(r => <span key={r} style={S.badge('#8b5cf6')}>{r}</span>)}</div></td><td style={S.td}><span style={S.badge(isActive ? '#10b981' : COLORS.danger)}>{isActive ? 'Active' : 'Disabled'}</span></td><td style={S.td}><div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>{u.id !== 'admin' && <><button style={S.btnSm('accent')} onClick={() => { setEditUserUsername(u.username || ''); setEditUserPassword(''); setEditUserShowPwd(false); setShowEditUser(u); }}>Edit</button>{canToggleStakeholder && <button style={S.btnSm(isAlsoStakeholder ? 'danger' : 'primary')} onClick={async () => { const newRoles = isAlsoStakeholder ? extraRoles.filter(r => r !== 'stakeholder') : [...extraRoles, 'stakeholder']; setUsers(prev => prev.map(x => x.id === u.id ? { ...x, roles: newRoles } : x)); await API.put(`users/${u.id}`, { roles: newRoles }); loadData(); }}>{isAlsoStakeholder ? '− Revoke Stakeholder' : '+ Grant Stakeholder'}</button>}<button style={S.btnSm(isActive ? 'danger' : 'primary')} onClick={async () => { const newActive = isActive ? 0 : 1; setUsers(prev => prev.map(x => x.id === u.id ? { ...x, active: newActive } : x)); await API.put(`users/${u.id}`, { active: newActive }); loadActivityLogs(); }}>{isActive ? 'Disable' : 'Enable'}</button><button style={S.btnSm('danger')} onClick={async () => { if (window.confirm(`Remove ${u.name}? This cannot be undone.`)) { setUsers(prev => prev.filter(x => x.id !== u.id)); await API.del(`users/${u.id}`); loadData(); } }}>Remove</button></>}</div></td></tr>); })}</tbody></table></div></div>);

      default: return <Navigate to="/dashboard" replace />;
    }
  };

  const navAction = (item) => {
    setSidebarOpen(false);
    if (item.id === 'newTx') {
      setEditingTx('new');
      navigate(PAGE_PATHS.newTransaction);
    } else {
      navigate(item.path);
    }
  };

  return (
    <div style={S.app}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet" />

      {/* Top Bar */}
      <div style={{ ...S.topBar, padding: isMobile ? '0 12px' : '0 24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {isMobile && <button style={S.hamburger} onClick={() => setSidebarOpen(o => !o)} aria-label="Menu">☰</button>}
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="20" height="20" style={{ flexShrink: 0 }}><path d="M38 35 L25 15 Q50 22 75 15 L62 35 Z" fill="#d2b48c" stroke="#8b7355" strokeWidth="2" strokeLinejoin="round"/><path d="M40 35 L60 35 C75 35 85 60 80 80 C75 95 25 95 20 80 C15 60 25 35 40 35 Z" fill="#deb887" stroke="#8b7355" strokeWidth="2" strokeLinejoin="round"/><path d="M35 35 Q50 38 65 35" fill="none" stroke="#5c4033" strokeWidth="3" strokeLinecap="round"/><text x="50" y="72" fontFamily="Arial, sans-serif" fontSize="34" fontWeight="bold" fill="#2c1e16" textAnchor="middle">₦</text></svg>
          <button onClick={() => navigate('/landing')} style={{ background: 'none', border: 'none', color: 'inherit', fontWeight: 800, letterSpacing: '-0.3px', fontSize: isMobile ? '14px' : '16px', cursor: 'pointer', padding: 0 }}>CIF QUICK CASH</button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? '8px' : '16px' }}>
          {!isMobile && <span style={{ fontSize: '13px', opacity: 0.8 }}>👤 {currentUser.name}</span>}
          <span style={S.badge(currentUser.role === 'admin' ? '#c8a84e' : currentUser.role === 'staff' ? '#10b981' : '#6b7280')}>{currentUser.role}{(currentUser.roles || []).length > 0 ? ` + ${(currentUser.roles || []).join(', ')}` : ''}</span>
          <button style={{ ...S.btnSm('danger'), fontSize: '11px' }} onClick={async () => { await API.post('logout', {}); clearAuthCache(); setCurrentUser(null); }}>{isMobile ? '✕' : 'Logout'}</button>
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
              <div key={item.id} style={S.sideItem(location.pathname === item.path)} onClick={() => navAction(item)}>
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
              <div key={item.id} style={S.sideItem(location.pathname === item.path)} onClick={() => navAction(item)}>
                <span>{item.icon}</span> {item.label}
              </div>
            ))}
          </div>
        )}
        <div style={{ ...S.mainContent, padding: isMobile ? '16px' : '24px', maxHeight: isMobile ? 'none' : 'calc(100vh - 56px)', paddingBottom: isMobile ? '80px' : '24px' }}>
          {renderPage()}
          <PhotoViewer />
          <div style={{ marginTop: '40px', paddingTop: '14px', borderTop: `1px solid ${COLORS.border}`, textAlign: 'center' }}>
            <PartnershipFootnote />
          </div>
        </div>
      </div>

      {/* Mobile Bottom Navigation */}
      {isMobile && (
        <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, background: '#fff', borderTop: `2px solid ${COLORS.border}`, display: 'flex', zIndex: 100, boxShadow: '0 -2px 12px rgba(0,0,0,0.1)' }}>
          {navItems.slice(0, 4).map(item => (
            <div key={item.id} onClick={() => navAction(item)}
              style={{ flex: 1, padding: '8px 4px 6px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px', cursor: 'pointer', background: location.pathname === item.path ? COLORS.primaryLight : 'transparent', borderTop: location.pathname === item.path ? `2px solid ${COLORS.primary}` : '2px solid transparent', marginTop: '-2px' }}>
              <span style={{ fontSize: '20px' }}>{item.icon}</span>
              <span style={{ fontSize: '10px', fontWeight: 600, color: location.pathname === item.path ? COLORS.primary : COLORS.textMuted, lineHeight: 1 }}>{item.label.split(' ')[0]}</span>
            </div>
          ))}
          <div onClick={() => setSidebarOpen(o => !o)}
            style={{ flex: 1, padding: '8px 4px 6px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px', cursor: 'pointer' }}>
            <span style={{ fontSize: '20px' }}>⋯</span>
            <span style={{ fontSize: '10px', fontWeight: 600, color: COLORS.textMuted, lineHeight: 1 }}>More</span>
          </div>
        </div>
      )}

      <ExpModal showAddExpense={showAddExpense} setShowAddExpense={setShowAddExpense} expForm={expForm} setExpForm={setExpForm} settings={settings} currentUser={currentUser} setExpenses={setExpenses} loadData={loadData} />
      <CapModal showAddCapital={showAddCapital} setShowAddCapital={setShowAddCapital} capitalTopUpFor={capitalTopUpFor} setCapitalTopUpFor={setCapitalTopUpFor} capital={capital} setCapital={setCapital} capForm={capForm} setCapForm={setCapForm} capShowPwd={capShowPwd} setCapShowPwd={setCapShowPwd} capAccountMode={capAccountMode} setCapAccountMode={setCapAccountMode} capSelectedUserId={capSelectedUserId} setCapSelectedUserId={setCapSelectedUserId} users={users} setUsers={setUsers} loadData={loadData} />
      <DistModal showAddDistribution={showAddDistribution} setShowAddDistribution={setShowAddDistribution} distForm={distForm} setDistForm={setDistForm} setDistributions={setDistributions} currentUser={currentUser} loadData={loadData} />
      <DecModal showAddDeclined={showAddDeclined} setShowAddDeclined={setShowAddDeclined} decForm={decForm} setDecForm={setDecForm} setDeclinedLog={setDeclinedLog} loadData={loadData} />
      <DeclineDraftModal declineDraftModal={declineDraftModal} setDeclineDraftModal={setDeclineDraftModal} declineDraftDec={declineDraftDec} setDeclineDraftDec={setDeclineDraftDec} setDeclinedLog={setDeclinedLog} setDrafts={setDrafts} currentUser={currentUser} loadData={loadData} />
      <UsrModal showAddUser={showAddUser} setShowAddUser={setShowAddUser} usrForm={usrForm} setUsrForm={setUsrForm} usrShowPwd={usrShowPwd} setUsrShowPwd={setUsrShowPwd} setUsers={setUsers} loadData={loadData} />
      <EditUserModal showEditUser={showEditUser} setShowEditUser={setShowEditUser} editUserUsername={editUserUsername} setEditUserUsername={setEditUserUsername} editUserPassword={editUserPassword} setEditUserPassword={setEditUserPassword} editUserShowPwd={editUserShowPwd} setEditUserShowPwd={setEditUserShowPwd} setUsers={setUsers} loadData={loadData} loadActivityLogs={loadActivityLogs} />
      <SettingsPwdModal showSettingsPwdModal={showSettingsPwdModal} setShowSettingsPwdModal={setShowSettingsPwdModal} settingsPwdInput={settingsPwdInput} setSettingsPwdInput={setSettingsPwdInput} settingsPwdError={settingsPwdError} setSettingsPwdError={setSettingsPwdError} settingsPwdLoading={settingsPwdLoading} setSettingsPwdLoading={setSettingsPwdLoading} pendingSettings={pendingSettings} setPendingSettings={setPendingSettings} saveSettings={saveSettings} />
      <Modal open={!!loggingContactTx} onClose={() => setLoggingContactTx(null)} title="Log Contact Attempt">{loggingContactTx && <ContactLogModal tx={loggingContactTx} currentUser={currentUser} onClose={() => setLoggingContactTx(null)} onSave={async (tx) => { await saveTx(tx); setLoggingContactTx(null); }} />}</Modal>
      <Modal open={!!shopListingTx} onClose={() => setShopListingTx(null)} title={shopListingTx?.status === 'for_sale' ? '🏪 Edit Shop Listing' : '🏪 List Item in Shop'} wide>{shopListingTx && <ShopListingModal tx={shopListingTx} settings={settings} onClose={() => setShopListingTx(null)} onSave={async (tx) => { await saveTx(tx); loadData(); setShopListingTx(null); }} />}</Modal>
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
