import { pbkdf2Sync, randomBytes, timingSafeEqual as nodeTimingSafeEqual } from 'node:crypto';

// Session cookie names — short-lived (session) vs long-lived (remember me)
const SESSION_COOKIE_SHORT = 'cfc_session_short';
const SESSION_COOKIE_LONG = 'cfc_session_long';
const REMEMBER_ME_MAX_AGE = 60 * 60 * 24 * 30; // 30 days
const PASSWORD_HASH_PREFIX = 'pbkdf2_sha256';
const PASSWORD_HASH_ITERATIONS = 100000;
const PASSWORD_SALT_BYTES = 16;

const ALLOWED_USER_ROLES = ['admin', 'staff', 'stakeholder'];
const ALLOWED_PHOTO_MIME_TYPES = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
  ['image/heic', 'heic'],
  ['image/heif', 'heif'],
  ['image/avif', 'avif'],
]);
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

// Helper: JSON response — uses Headers so multiple Set-Cookie values work correctly
const json = (data, status = 200, extraHeaders = {}) => {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  Object.entries(extraHeaders).forEach(([key, value]) => {
    if (Array.isArray(value)) value.forEach((v) => headers.append(key, v));
    else headers.set(key, value);
  });
  return new Response(JSON.stringify(data), { status, headers });
};

const error = (msg, status = 400) => json({ error: msg }, status);

const canRecordDistribution = async (request, db) => {
  const auth = requireAuth(request);
  if (auth.error) return auth;
  if (auth.user.role === 'admin') return auth;
  const row = await db.prepare("SELECT value FROM settings WHERE key = 'config'").first().catch(() => null);
  const config = row ? JSON.parse(row.value || '{}') : {};
  const allowed = Array.isArray(config.distributionAuthorizedUserIds) ? config.distributionAuthorizedUserIds : [];
  if (!allowed.includes(auth.user.id)) return { error: error('You are not allowed to record profit distributions', 403) };
  return auth;
};

// Parse the JSON roles column safely — returns an array (never throws)
const parseRoles = (rolesJson) => {
  try { return JSON.parse(rolesJson || '[]'); } catch { return []; }
};

const parseCookies = (cookieHeader = '') => Object.fromEntries(
  cookieHeader
    .split(';')
    .map((cookie) => cookie.trim())
    .filter(Boolean)
    .map((cookie) => {
      const [name, ...rest] = cookie.split('=');
      return [name, decodeURIComponent(rest.join('='))];
    })
);

const buildSessionCookie = (name, value, maxAge) => {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Secure'
  ];
  if (typeof maxAge === 'number') parts.push(`Max-Age=${maxAge}`);
  return parts.join('; ');
};

const clearSessionCookie = (name) => `${name}=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0`;

const textEncoder = new TextEncoder();

const toBase64 = (bytes) => {
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
};

const fromBase64 = (value) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0));

const timingSafeEqual = (a, b) => {
  if (a.length !== b.length) return false;
  try {
    return nodeTimingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    let diff = 0;
    for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
  }
};

const derivePbkdf2Base64 = async (password, salt, iterations) => {
  try {
    return pbkdf2Sync(password, salt, iterations, 32, 'sha256').toString('base64');
  } catch {
    const keyMaterial = await crypto.subtle.importKey('raw', textEncoder.encode(password), { name: 'PBKDF2' }, false, ['deriveBits']);
    const derivedBits = await crypto.subtle.deriveBits({
      name: 'PBKDF2',
      salt,
      iterations,
      hash: 'SHA-256',
    }, keyMaterial, 256);
    return toBase64(new Uint8Array(derivedBits));
  }
};

const hashPassword = async (password) => {
  const salt = randomBytes(PASSWORD_SALT_BYTES);
  const hash = await derivePbkdf2Base64(password, salt, PASSWORD_HASH_ITERATIONS);
  return `${PASSWORD_HASH_PREFIX}$${PASSWORD_HASH_ITERATIONS}$${salt.toString('base64')}$${hash}`;
};

const verifyPassword = async (password, storedPassword) => {
  if (typeof storedPassword !== 'string' || !storedPassword) return { ok: false, needsUpgrade: false };
  if (!storedPassword.startsWith(`${PASSWORD_HASH_PREFIX}$`)) {
    return { ok: timingSafeEqual(password, storedPassword), needsUpgrade: true };
  }

  const [, iterationPart, saltPart, hashPart] = storedPassword.split('$');
  const iterations = Number.parseInt(iterationPart, 10);
  if (!iterations || !saltPart || !hashPart) return { ok: false, needsUpgrade: false };

  const salt = fromBase64(saltPart);
  try {
    const actualHash = await derivePbkdf2Base64(password, salt, iterations);
    return { ok: timingSafeEqual(actualHash, hashPart), needsUpgrade: false };
  } catch {
    return { ok: false, needsUpgrade: false };
  }
};

// Read user from either cookie (long-lived takes priority)
const getSessionUser = (request) => {
  const cookies = parseCookies(request.headers.get('Cookie') || '');
  const raw = cookies[SESSION_COOKIE_LONG] || cookies[SESSION_COOKIE_SHORT];
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
};

const requireAuth = (request) => {
  const user = getSessionUser(request);
  if (!user) return { error: error('Not authenticated', 401) };
  return { user };
};

const requireAdmin = (request) => {
  const auth = requireAuth(request);
  if (auth.error) return auth;
  if (auth.user.role !== 'admin') return { error: error('Admin access required', 403) };
  return auth;
};

// Like requireAuth but also verifies the user is still active in the DB.
// Use this on any endpoint where a disabled account must lose access immediately.
const requireAuthActive = async (request, db) => {
  const auth = requireAuth(request);
  if (auth.error) return auth;
  const row = await db.prepare('SELECT active FROM users WHERE id = ?').bind(auth.user.id).first().catch(() => null);
  if (row && row.active === 0) return { error: error('This account has been disabled. Contact the administrator.', 403) };
  return auth;
};

// ============================================================
// WEB PUSH HELPERS — VAPID (RFC 7519) + RFC 8291 (aes128gcm encryption)
// Keys are provided via Cloudflare environment bindings:
//   env.VAPID_PUBLIC_KEY  — base64url-encoded P-256 raw public key (safe to expose)
//   env.VAPID_PRIVATE_KEY — base64url-encoded P-256 PKCS#8 private key (Pages Secret)
// ============================================================

const b64urlDecode = (str) => {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64.padEnd(b64.length + (4 - (b64.length % 4)) % 4, '=');
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
};

const b64urlEncode = (buf) => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let bin = '';
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
};

const concatBufs = (...bufs) => {
  const total = bufs.reduce((s, b) => s + b.length, 0);
  const r = new Uint8Array(total);
  let offset = 0;
  for (const b of bufs) { r.set(b, offset); offset += b.length; }
  return r;
};

const hmacSha256 = async (key, data) => {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data));
};

// HKDF-SHA256: Extract then Expand
const hkdfSha256 = async (salt, ikm, info, length) => {
  const prk = await hmacSha256(salt, ikm);
  const infoBytes = typeof info === 'string' ? textEncoder.encode(info) : info;
  let t = new Uint8Array(0);
  const okm = new Uint8Array(length);
  let pos = 0;
  for (let i = 1; pos < length; i++) {
    t = await hmacSha256(prk, concatBufs(t, infoBytes, new Uint8Array([i])));
    const toCopy = Math.min(t.length, length - pos);
    okm.set(t.slice(0, toCopy), pos);
    pos += toCopy;
  }
  return okm;
};

// Build a VAPID JWT signed with the P-256 ECDSA private key.
const buildVapidJWT = async (privateKeyB64url, audience, subject) => {
  const header = { typ: 'JWT', alg: 'ES256' };
  const payload = { aud: audience, exp: Math.floor(Date.now() / 1000) + 43200, sub: subject };
  const headerB64 = b64urlEncode(textEncoder.encode(JSON.stringify(header)));
  const payloadB64 = b64urlEncode(textEncoder.encode(JSON.stringify(payload)));
  const signingInput = `${headerB64}.${payloadB64}`;

  // VAPID key generators (e.g. the `web-push` npm package) output a raw 32-byte
  // P-256 private key.  crypto.subtle.importKey() requires PKCS#8 DER format.
  // Auto-detect by length: raw keys are exactly 32 bytes; PKCS#8-wrapped P-256
  // keys are 67+ bytes.  Wrap raw keys in the standard PKCS#8 DER structure so
  // both formats are accepted transparently.
  const rawKeyBytes = b64urlDecode(privateKeyB64url);
  let pkcs8Bytes;
  if (rawKeyBytes.length === 32) {
    // PKCS#8 DER wrapper for a bare P-256 private key (no embedded public key).
    // Structure: SEQUENCE { version INTEGER 0, algorithm AlgorithmIdentifier,
    //   privateKey OCTET STRING { ECPrivateKey { version 1, privateKey <32 bytes> } } }
    const hdr = new Uint8Array([
      0x30, 0x41, 0x02, 0x01, 0x00, 0x30, 0x13, 0x06,
      0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01,
      0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03,
      0x01, 0x07, 0x04, 0x27, 0x30, 0x25, 0x02, 0x01,
      0x01, 0x04, 0x20,
    ]);
    pkcs8Bytes = concatBufs(hdr, rawKeyBytes);
  } else {
    pkcs8Bytes = rawKeyBytes;
  }

  const privateKey = await crypto.subtle.importKey(
    'pkcs8', pkcs8Bytes,
    { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, textEncoder.encode(signingInput)),
  );
  return `${signingInput}.${b64urlEncode(signature)}`;
};

// Encrypt a push notification payload according to RFC 8291 (aes128gcm).
const encryptPushPayload = async (plaintext, p256dhB64url, authB64url) => {
  const uaPublicRaw = b64urlDecode(p256dhB64url);
  const authSecret = b64urlDecode(authB64url);

  // Generate ephemeral ECDH key pair
  const ephemeral = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublicRaw = new Uint8Array(await crypto.subtle.exportKey('raw', ephemeral.publicKey));

  // ECDH shared secret
  const uaKey = await crypto.subtle.importKey('raw', uaPublicRaw, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const sharedSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, ephemeral.privateKey, 256));

  // IKM = HKDF(salt=auth, IKM=sharedSecret, info="WebPush: info\0"+uaPublic+asPublic, len=32)
  const authInfo = concatBufs(textEncoder.encode('WebPush: info\x00'), uaPublicRaw, asPublicRaw);
  const ikm = await hkdfSha256(authSecret, sharedSecret, authInfo, 32);

  // Random salt for content encryption
  const salt = crypto.getRandomValues(new Uint8Array(16));

  // Derive CEK and nonce from ikm
  const cek = await hkdfSha256(salt, ikm, textEncoder.encode('Content-Encoding: aes128gcm\x00'), 16);
  const nonce = await hkdfSha256(salt, ikm, textEncoder.encode('Content-Encoding: nonce\x00'), 12);

  // AES-128-GCM encrypt (append record-type delimiter byte 0x02 for last record)
  const plaintextBytes = typeof plaintext === 'string' ? textEncoder.encode(plaintext) : plaintext;
  const aesKey = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, concatBufs(plaintextBytes, new Uint8Array([2]))),
  );

  // RFC 8291 content header: salt(16) + rs(4 BE) + keyid_len(1) + as_public(65)
  const rsBytes = new Uint8Array(4);
  new DataView(rsBytes.buffer).setUint32(0, 4096, false); // record size = 4096
  return concatBufs(salt, rsBytes, new Uint8Array([asPublicRaw.length]), asPublicRaw, ciphertext);
};

// Send a Web Push notification to a single subscription.
// Returns { sent: true }, { expired: true } (endpoint gone), or { skipped: true } if keys missing.
const sendWebPush = async (env, subscription, notification) => {
  const privateKey = env.VAPID_PRIVATE_KEY;
  const publicKey = env.VAPID_PUBLIC_KEY;
  if (!privateKey || !publicKey) return { skipped: true };

  const { endpoint, p256dh, auth } = subscription;
  const audience = new URL(endpoint).origin;
  const subject = 'mailto:admin@cifcash.com';

  const jwt = await buildVapidJWT(privateKey, audience, subject);
  const payload = JSON.stringify({
    title: notification.title || 'CIF Quick Cash',
    body: notification.body || '',
    icon: '/pwa-icon-192.png',
    badge: '/pwa-icon-192.png',
    tag: notification.tag || 'cif-notification',
    url: notification.url || '/',
  });
  const body = await encryptPushPayload(payload, p256dh, auth);

  const resp = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `vapid t=${jwt},k=${publicKey}`,
      'Content-Type': 'application/octet-stream',
      'Content-Encoding': 'aes128gcm',
      TTL: '86400',
    },
    body,
  });

  if (resp.status === 410 || resp.status === 404) return { expired: true };
  return { sent: resp.ok };
};

// Deliver a push notification to every registered device of a given user.
// Silently cleans up expired subscriptions.
const pushNotifyUser = async (env, db, userId, notification) => {
  if (!userId) return;
  try {
    const { results: subs } = await db
      .prepare('SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?')
      .bind(userId).all();
    const results = await Promise.all(subs.map((sub) => sendWebPush(env, sub, notification).catch(() => null)));
    const expired = subs.filter((_, i) => results[i]?.expired);
    for (const sub of expired) {
      await db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind(sub.endpoint).run().catch(() => {});
    }
  } catch (_) { /* push is non-critical — never let it fail the primary response */ }
};

// Deliver a push notification to every subscribed user (broadcast).
const pushNotifyAll = async (env, db, notification) => {
  try {
    const { results: subs } = await db.prepare('SELECT endpoint, p256dh, auth FROM push_subscriptions').all();
    const results = await Promise.all(subs.map((sub) => sendWebPush(env, sub, notification).catch(() => null)));
    const expired = subs.filter((_, i) => results[i]?.expired);
    for (const sub of expired) {
      await db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind(sub.endpoint).run().catch(() => {});
    }
  } catch (_) { /* non-critical */ }
};

// ============================================================
// LOAN TIMELINE HELPERS
// Rules (using admin-configured maxLoanDays and graceDays):
//   internal_deadline  = dateGiven + maxLoanDays          (business takes ownership)
//   grace_end_date     = dateGiven + maxLoanDays + graceDays
//   sale_allowed_date  = dateGiven + maxLoanDays + graceDays + 1 (first day of sale eligibility)
//   customer_due_date  = deadlineDate, or dateGiven + loanDays
//
// Status transitions (advance loans only):
//   ACTIVE            — before customer_due_date
//   OVERDUE           — after customer_due_date, before maxLoanDays
//   OWNED_BY_BUSINESS — on day maxLoanDays exactly
//   GRACE_PERIOD      — days maxLoanDays+1 through maxLoanDays+graceDays
//   ELIGIBLE_FOR_SALE — day maxLoanDays+graceDays+1 onwards
//
// Defaults: maxLoanDays=30, graceDays=3  (matches DEFAULT_SETTINGS)
// ============================================================

// Returns today's date as a YYYY-MM-DD string in Nigeria time (WAT = UTC+1).
// Cloudflare Workers run in UTC, so we must derive the Nigeria calendar date
// explicitly to avoid misclassifying loans during the midnight–01:00 WAT window.
const todayNigeria = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos' }).format(new Date());

// Add N calendar days to a YYYY-MM-DD or ISO date string; returns YYYY-MM-DD.
const addDaysToDate = (dateStr, n) => {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().split('T')[0];
};

// Return the number of whole calendar days elapsed since a date string (Nigeria time).
// Returns 0 if the date is today or in the future.
const elapsedDaysSince = (dateStr) => {
  if (!dateStr) return 0;
  const given = new Date(dateStr);
  if (Number.isNaN(given.getTime())) return 0;
  // Compare against Nigeria calendar date so status transitions happen at
  // Nigeria midnight (WAT = UTC+1), not UTC midnight.
  const nowNigeria = new Date(todayNigeria());
  const givenMidnight = Date.UTC(given.getUTCFullYear(), given.getUTCMonth(), given.getUTCDate());
  const nowMidnight   = Date.UTC(nowNigeria.getUTCFullYear(), nowNigeria.getUTCMonth(), nowNigeria.getUTCDate());
  return Math.max(0, Math.floor((nowMidnight - givenMidnight) / 86400000));
};

// Returns the number of chargeable days for fee calculation.
// Freezes at (maxLoanDays + graceDays) once the grace period has ended so that
// the amount due stops growing after the business takes undisputed ownership.
// For voluntary surrenders (ready_to_sell) it freezes at the surrender date.
const effectiveElapsedDaysSince = (txData, { maxLoanDays = 30, graceDays = 3 } = {}) => {
  const anchor = txData?.cycleStart || txData?.dateGiven;
  if (!anchor) return 0;
  const graceCap = maxLoanDays + graceDays;
  const raw = elapsedDaysSince(anchor);
  if ((txData.status === 'ready_to_sell' || txData.status === 'for_sale') && txData.surrenderDate) {
    return Math.max(0, raw - elapsedDaysSince(txData.surrenderDate));
  }
  return Math.min(raw, graceCap);
};

// Load loan-duration + fee settings from D1.
// Returns { maxLoanDays, graceDays, interestRate } with safe defaults.
const loadLoanConfig = async (db) => {
  const row = await db.prepare("SELECT value FROM settings WHERE key = 'config'").first();
  const cfg = row ? JSON.parse(row.value) : {};
  return {
    maxLoanDays:  Math.max(1, Number(cfg.maxLoanDays)  || 30),
    graceDays:    Math.max(0, Number(cfg.graceDays)    || 3),
    interestRate: Math.max(0, Number(cfg.interestRate) || 1),
  };
};

// Compute the loan timeline for an advance transaction.
// txData   — parsed JSON data from the transactions table
// loanCfg  — { maxLoanDays, graceDays } from admin settings
// Returns an object with computed dates and the derived loanStatus string.
const computeLoanTimeline = (txData, { maxLoanDays = 30, graceDays = 3 } = {}) => {
  // cycleStart anchors the timeline instead of dateGiven once a payment has rolled the
  // loan over into a fresh term — dateGiven itself never changes (it stays the true
  // origination date used by historical/monthly reporting).
  const baseDate = txData.cycleStart || txData.dateGiven || null;
  if (!baseDate) return null;

  // Rule 1: Fixed internal milestones measured from dateGiven
  const internal_deadline  = addDaysToDate(baseDate, maxLoanDays);                   // business ownership begins
  const grace_end_date     = addDaysToDate(baseDate, maxLoanDays + graceDays);        // grace period ends
  const sale_allowed_date  = addDaysToDate(baseDate, maxLoanDays + graceDays + 1);   // earliest allowed sale date

  // Rule 2: Customer due date = dateGiven + agreed loan duration (loanDays).
  // Use the stored deadlineDate if available (already computed at entry time),
  // otherwise derive it from loanDays.
  const loanDays = Number(txData.loanDays) || maxLoanDays;
  const customer_due_date = txData.deadlineDate || addDaysToDate(baseDate, loanDays);

  // Elapsed calendar days since the loan was given
  const elapsedDays = elapsedDaysSince(baseDate);

  // Rule 3: Status transitions
  let loanStatus;
  if (elapsedDays >= maxLoanDays + graceDays + 1) {
    loanStatus = 'ELIGIBLE_FOR_SALE';   // past grace end — ready for sale
  } else if (elapsedDays >= maxLoanDays + 1) {
    loanStatus = 'GRACE_PERIOD';        // within grace window
  } else if (elapsedDays >= maxLoanDays) {
    loanStatus = 'OWNED_BY_BUSINESS';   // ownership day
  } else {
    // Before ownership: check whether the customer's agreed due date has passed
    const today = todayNigeria();
    if (customer_due_date && today > customer_due_date) {
      loanStatus = 'OVERDUE';           // past customer deadline, not yet owned
    } else {
      loanStatus = 'ACTIVE';            // within customer's agreed term
    }
  }

  return {
    elapsedDays,
    customer_due_date,
    internal_deadline,
    grace_end_date,
    sale_allowed_date,
    loanStatus,
  };
};

// Attach loan timeline fields to a transaction record (advance loans only).
// Returns the original record unchanged for outright purchases and closed/sold loans.
const withLoanTimeline = (r, loanCfg = {}) => {
  // Only compute for advance loans that are still active
  if (!r || r.type === 'outright' || r.status === 'closed' || r.status === 'sold') return r;
  const timeline = computeLoanTimeline(r, loanCfg);
  if (!timeline) return r;
  return { ...r, ...timeline };
};

// ============================================================
// PARTIAL LOAN PAYMENT — calculation engine
//
// Business rule (applies to a single item/principal balance):
//   1. If the payment covers everything currently owed (principal + interest
//      accrued to date), it's a full payoff — not a partial payment.
//   2. Otherwise, which bucket gets paid first depends on WHEN the payment
//      lands within the loan's own agreed term (loanDays), counting from the
//      start of the current cycle:
//        - day 1 .. loanDays-1 ("on time")   → PRINCIPAL first, interest gets any leftover.
//        - day loanDays onward ("due/overdue") → INTEREST first, principal gets any leftover.
//   3. If the interest-first bucket fully clears the interest owed, the loan
//      "rolls over": a fresh cycle starts today, extending the deadline by a
//      full loanDays term, and carriedInterestOwed resets to 0. On-time
//      (principal-first) payments never trigger a rollover — the existing
//      deadline is untouched since the term hasn't elapsed yet.
//   4. Reducing principal automatically lowers tomorrow's daily interest,
//      since dailyFee is always recomputed live from the current principal.
//
// Interest accrual across a principal change (important):
//   cycleStart anchors the TERM (day-of-cycle bucket decision + rollover),
//   but interest must be charged at whatever principal was ACTUALLY
//   outstanding on each day — it must not be silently rewritten once the
//   principal drops. So every payment "checkpoints" accrual: whatever
//   interest had accrued up to that payment (at the OLD principal) is
//   folded into carriedInterestOwed, and principalSince resets to the
//   payment date so future accrual only ever applies the CURRENT principal
//   to days that elapse AFTER that checkpoint.
// ============================================================

const daysBetweenDates = (a, b) => {
  if (!a || !b) return 0;
  return Math.max(0, Math.floor((new Date(b) - new Date(a)) / 86400000));
};

// The wizard's buildCurrentItem() (used to snapshot a single-item loan's tx.items[0]
// at completion) only copies ITEM_FIELDS, which has never included cashAdvance/
// itemCashAdvance — so the stored item.itemCashAdvance is undefined for the vast
// majority of real single-item loans. This never surfaced before because the
// pre-existing repayment flow always read tx.cashAdvance directly and never touched
// items[] for a single-item loan. The payment feature is the first thing that reads
// item.itemCashAdvance as the source of truth, so it must fall back sensibly instead
// of silently treating a real loan as if ₦0 were owed.
const getItemCashAdvance = (tx, item) => {
  if (item?.itemCashAdvance !== undefined && item?.itemCashAdvance !== null) {
    return Number(item.itemCashAdvance) || 0;
  }
  const items = Array.isArray(tx?.items) ? tx.items : [];
  const total = Number(tx?.cashAdvance) || 0;
  if (items.length <= 1) return total;
  // Genuine multi-item loans always set this at creation (proportional to estimated
  // value) — an even split here is only a defensive last resort, not the normal path.
  return Math.round(total / items.length);
};

// Cheap current-outstanding-principal aggregate — see the frontend mirror in App.jsx
// for the full rationale. tx.cashAdvance never changes after a partial payment (it
// stays the original historical total), so "capital currently deployed" style sums
// (used here for surplus/shortfall detection) must sum unredeemed items instead.
const getCurrentOutstandingPrincipal = (tx) => {
  if (!tx || tx.type !== 'advance') return 0;
  if (Array.isArray(tx.items) && tx.items.length > 0) {
    return tx.items.reduce((s, it) => s + (it.redeemed ? 0 : getItemCashAdvance(tx, it)), 0);
  }
  return Number(tx.cashAdvance) || 0;
};

const getLoanPaymentEntries = (tx) => {
  if (!tx || tx.type !== 'advance') return [];
  if (Array.isArray(tx.items) && tx.items.length > 0) {
    return tx.items.flatMap(it => it?.payments || []);
  }
  return tx.payments || [];
};

const getRecognizedInterest = (tx, options = {}) => {
  if (!tx || tx.type !== 'advance') return 0;
  const { paymentDateFilter, legacyClosedDateFilter } = options;
  const payments = getLoanPaymentEntries(tx);
  if (payments.length > 0) {
    return payments.reduce((sum, p) => {
      const paymentDate = p?.date || p?.recordedAt || null;
      if (paymentDateFilter && !paymentDateFilter(paymentDate, p)) return sum;
      return sum + (Number(p?.interestApplied) || 0);
    }, 0);
  }
  if (tx.status === 'closed') {
    const closedDate = tx.dateRepaid || tx.updated_at || tx.created_at || null;
    if (legacyClosedDateFilter && !legacyClosedDateFilter(closedDate, tx)) return 0;
    return Math.max(0, Number(tx.totalFees) || 0);
  }
  return 0;
};

// Pure function — no I/O. Given the current state of a principal balance and a
// proposed payment, returns exactly what should change. Never trusts a client
// to supply cashAdvance/interestOwed/etc — callers must pass values read from
// the stored record.
//
// balance: { cashAdvance, appliedInterestRate, cycleStart, principalSince,
//            dateGiven, loanDays, carriedInterestOwed }
//   loanDays here is the COMPANY's max loan tenure policy (settings.maxLoanDays),
//   not the customer's own agreed return date (item.loanDays/tx.loanDays) — that
//   softer, customer-facing target only drives overdue reminders elsewhere in the
//   app and has no bearing on which balance a payment pays down first.
// payment: { amount, date }
// graceDays: from admin settings, used only for the fee-accrual freeze cap.
function computeLoanPayment(balance, payment, graceDays = 3, options = {}) {
  const cashAdvance = Math.max(0, Number(balance.cashAdvance) || 0);
  const rate = Number(balance.appliedInterestRate) || 0;
  const loanDays = Math.max(1, Number(balance.loanDays) || 30);
  const cycleStart = balance.cycleStart || balance.dateGiven;
  const principalSince = balance.principalSince || cycleStart;
  const carriedInterestOwed = Math.max(0, Number(balance.carriedInterestOwed) || 0);
  const amount = Math.max(0, Number(payment.amount) || 0);
  const date = payment.date;

  const dailyFee = Math.floor(cashAdvance * rate / 100);
  // dayOfCycle uses the exact same convention as effectiveElapsedDays/daysBetween
  // elsewhere in the app: the number of full calendar days since cycleStart (0 if
  // paid same-day as cycleStart). "Day 30" here means what the rest of the app
  // already displays as "30 days" in the repayment screens.
  const dayOfCycle = daysBetweenDates(cycleStart, date);
  // Interest accrues for every day the item remains unredeemed and unsold — it does
  // NOT freeze at the grace-period boundary. An item can sit unsold well past grace
  // (e.g. 73 days), and if the customer eventually comes back to pay, what they owe
  // must reflect the full outstanding period, not just the first loanDays+graceDays
  // of it — otherwise the displayed day count and the interest total disagree.
  const daysSinceCheckpoint = daysBetweenDates(principalSince, date);
  const newAccrual = daysSinceCheckpoint * dailyFee;
  const interestOwed = carriedInterestOwed + newAccrual;
  const totalOwed = cashAdvance + interestOwed;

  if (amount <= 0) {
    return { error: 'Payment amount must be greater than zero.' };
  }
  if (totalOwed <= 0) {
    return { error: 'Nothing is currently owed on this loan.' };
  }

  if (amount >= totalOwed) {
    return {
      outcome: 'full_payoff',
      principalApplied: cashAdvance,
      interestApplied: interestOwed,
      overpayment: Math.round((amount - totalOwed) * 100) / 100,
      dayOfCycle,
      interestOwedBefore: interestOwed,
      dailyFee,
    };
  }

  // Day 1..loanDays-1 of the cycle ("on time") → principal first.
  // Day loanDays onward ("due/overdue") → interest first (may trigger a rollover below).
  // options.forceBucket lets a caller override this — used by the combined multi-item
  // payment, which decides "is this loan overdue" once for the whole basket (so an
  // item that individually rolled over recently doesn't skip the interest queue just
  // because ITS OWN post-rollover cycle looks fresh).
  const bucket = options.forceBucket || (dayOfCycle < loanDays ? 'principal_first' : 'interest_first');
  let principalApplied = 0;
  let interestApplied = 0;
  if (bucket === 'principal_first') {
    principalApplied = Math.min(amount, cashAdvance);
    interestApplied = Math.min(amount - principalApplied, interestOwed);
  } else {
    interestApplied = Math.min(amount, interestOwed);
    principalApplied = Math.min(amount - interestApplied, cashAdvance);
  }

  const newCashAdvance = Math.round((cashAdvance - principalApplied) * 100) / 100;
  const newInterestOwed = Math.max(0, Math.round((interestOwed - interestApplied) * 100) / 100);
  const rolledOver = bucket === 'interest_first' && interestOwed > 0 && newInterestOwed <= 0;

  // Past the max tenure, an interest payment buys days, not just a binary "renewed or
  // not". Fully clearing the owed interest buys the full loanDays term (a normal
  // renewal); a partial interest-first payment still buys a proportional number of
  // days (amount ÷ current daily rate), rounded down. Either way the extension is
  // measured from the CURRENT deadline — not the payment date — so paying late
  // doesn't earn extra slack, and paying exactly on time doesn't lose any.
  let newDeadlineDate = null;
  if (bucket === 'interest_first' && interestApplied > 0 && dailyFee > 0) {
    const currentDeadline = balance.deadlineDate || addDaysToDate(cycleStart, loanDays);
    const daysBought = rolledOver ? loanDays : Math.floor(interestApplied / dailyFee);
    if (daysBought > 0) newDeadlineDate = addDaysToDate(currentDeadline, daysBought);
  }

  return {
    outcome: 'partial',
    bucket,
    dayOfCycle,
    loanDays,
    dailyFee,
    interestOwedBefore: interestOwed,
    interestAccrued: newAccrual,
    principalApplied,
    interestApplied,
    newCashAdvance,
    newInterestOwed,
    rolledOver,
    newCycleStart: rolledOver ? date : cycleStart,
    // Every payment checkpoints accrual at the payment date, regardless of outcome —
    // whatever's left unpaid carries forward, future accrual starts fresh from here.
    newPrincipalSince: date,
    newCarriedInterestOwed: newInterestOwed,
    newDeadlineDate,
  };
}

// ── Auto schema initialisation ───────────────────────────────────────────────
// Runs at most once per Worker isolate. On a brand-new database (cifcash-prod-db)
// all tables are created automatically so no manual migration step is needed.
let _schemaReady = false;

async function ensureStaffPointsTable(db) {
  try {
    await db.batch([
      db.prepare(`CREATE TABLE IF NOT EXISTS staff_points (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, entity_ref TEXT NOT NULL, step_key TEXT NOT NULL, weight REAL NOT NULL, awarded_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(user_id, entity_ref, step_key))`),
      db.prepare(`CREATE INDEX IF NOT EXISTS idx_staff_points_user_time ON staff_points (user_id, awarded_at DESC)`),
      db.prepare(`CREATE INDEX IF NOT EXISTS idx_staff_points_entity ON staff_points (entity_ref)`),
      db.prepare(`CREATE INDEX IF NOT EXISTS idx_staff_points_awarded_at ON staff_points (awarded_at DESC)`),
    ]);
  } catch (e) {
    console.error('[ensureStaffPointsTable] failed:', e?.message ?? e);
  }
}

async function ensureCapitalTypeColumn(db) {
  try {
    await db.prepare(`ALTER TABLE capital ADD COLUMN type TEXT NOT NULL DEFAULT 'contribution'`).run();
  } catch (e) {
    // Column already exists — ignore.
  }
}

async function ensureSchema(db) {
  if (_schemaReady) return;
  try {
    const row = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").first();
    if (row) {
      // Fast-path migrations for tables added after the initial schema was deployed.
      await ensureStaffPointsTable(db);
      await ensureCapitalTypeColumn(db);
      _schemaReady = true;
      return;
    }

    // db.batch() is the reliable D1 API for multiple DDL + DML statements.
    await db.batch([
      db.prepare(`CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, password TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'user', roles TEXT NOT NULL DEFAULT '[]', name TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, phone1 TEXT DEFAULT NULL, phone2 TEXT DEFAULT NULL, email TEXT DEFAULT NULL, signature TEXT DEFAULT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')))`),
      db.prepare(`INSERT OR IGNORE INTO users (id, username, password, role, name) VALUES ('admin', 'cifadmin', 'pbkdf2_sha256$100000$u7LD0M2xIoi2gVt1cujVBw==$MhniNOx1JQYo18UYqwk+6AS6SPW5j8zTyqXQG9Lv900=', 'admin', 'Administrator')`),
      db.prepare(`CREATE TABLE IF NOT EXISTS transactions (ref TEXT PRIMARY KEY, data TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))`),
      db.prepare(`CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions (status)`),
      db.prepare(`CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON transactions (created_at DESC)`),
      db.prepare(`CREATE TABLE IF NOT EXISTS drafts (ref TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT (datetime('now')), created_by TEXT)`),
      db.prepare(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT (datetime('now')))`),
      db.prepare(`CREATE TABLE IF NOT EXISTS expenses (id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL, category TEXT NOT NULL, description TEXT, amount REAL NOT NULL, registered_by TEXT)`),
      db.prepare(`CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses (date DESC)`),
      db.prepare(`CREATE TABLE IF NOT EXISTS capital (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, amount REAL NOT NULL, date TEXT NOT NULL, method TEXT NOT NULL, receipt TEXT, user_id TEXT REFERENCES users(id), type TEXT NOT NULL DEFAULT 'contribution')`),
      db.prepare(`CREATE TABLE IF NOT EXISTS declined_log (id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL, ref TEXT, customer_name TEXT, nin_bvn TEXT, item TEXT NOT NULL, reason TEXT NOT NULL, notes TEXT)`),
      db.prepare(`CREATE INDEX IF NOT EXISTS idx_declined_log_date ON declined_log (date DESC)`),
      db.prepare(`CREATE TABLE IF NOT EXISTS profit_distributions (id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL, amount REAL NOT NULL, method TEXT NOT NULL, note TEXT, receipt TEXT, created_by TEXT, decision_ids TEXT, stakeholder_name TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))`),
      db.prepare(`CREATE INDEX IF NOT EXISTS idx_profit_distributions_date ON profit_distributions (date DESC)`),
      db.prepare(`CREATE TABLE IF NOT EXISTS activity_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL DEFAULT (datetime('now')), user_id TEXT NOT NULL, username TEXT NOT NULL, user_role TEXT NOT NULL, action TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT, description TEXT)`),
      db.prepare(`CREATE INDEX IF NOT EXISTS idx_activity_logs_created_at ON activity_logs (created_at DESC)`),
      db.prepare(`CREATE TABLE IF NOT EXISTS nin_bvn_cache (id INTEGER PRIMARY KEY AUTOINCREMENT, id_type TEXT NOT NULL, id_number TEXT NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')))`),
      db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_nin_bvn_cache_type_number ON nin_bvn_cache (id_type, id_number)`),
      db.prepare(`CREATE TABLE IF NOT EXISTS sms_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, transaction_ref TEXT NOT NULL, sent_at TEXT NOT NULL DEFAULT (datetime('now')), trigger_type TEXT NOT NULL, message TEXT NOT NULL, recipient TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', termii_response TEXT, message_id TEXT, delivery_status TEXT)`),
      db.prepare(`CREATE INDEX IF NOT EXISTS idx_sms_logs_transaction_ref ON sms_logs (transaction_ref)`),
      db.prepare(`CREATE INDEX IF NOT EXISTS idx_sms_logs_sent_at ON sms_logs (sent_at DESC)`),
      db.prepare(`CREATE TABLE IF NOT EXISTS login_attempts (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL, attempted_at TEXT NOT NULL DEFAULT (datetime('now')), success INTEGER NOT NULL DEFAULT 0)`),
      db.prepare(`CREATE INDEX IF NOT EXISTS idx_login_attempts_username ON login_attempts (username, attempted_at DESC)`),
      db.prepare(`CREATE TABLE IF NOT EXISTS distribution_decisions (id INTEGER PRIMARY KEY AUTOINCREMENT, period TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(id), stakeholder_name TEXT NOT NULL, profit_amount REAL NOT NULL, capital_days REAL NOT NULL, total_capital_days REAL NOT NULL, reinvest_amount REAL NOT NULL DEFAULT 0, distribute_amount REAL NOT NULL DEFAULT 0, decision TEXT NOT NULL DEFAULT 'pending', decided_at TEXT, auto_decided INTEGER NOT NULL DEFAULT 0, capital_surplus INTEGER NOT NULL DEFAULT 0, system_note TEXT, deadline TEXT NOT NULL, paid_at TEXT, paid_by TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))`),
      db.prepare(`CREATE INDEX IF NOT EXISTS idx_distribution_decisions_period ON distribution_decisions (period)`),
      db.prepare(`CREATE INDEX IF NOT EXISTS idx_distribution_decisions_user ON distribution_decisions (user_id)`),
      db.prepare(`CREATE TABLE IF NOT EXISTS public_valuation_requests (id INTEGER PRIMARY KEY AUTOINCREMENT, ip TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')))`),
      db.prepare(`CREATE INDEX IF NOT EXISTS idx_pvr_ip ON public_valuation_requests (ip, created_at DESC)`),
      db.prepare(`CREATE TABLE IF NOT EXISTS push_subscriptions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, endpoint TEXT NOT NULL UNIQUE, p256dh TEXT NOT NULL, auth TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')))`),
      db.prepare(`CREATE INDEX IF NOT EXISTS idx_push_subs_user_id ON push_subscriptions (user_id)`),
      db.prepare(`CREATE INDEX IF NOT EXISTS idx_users_name_role ON users (name, role)`),
      db.prepare(`CREATE TABLE IF NOT EXISTS staff_points (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, entity_ref TEXT NOT NULL, step_key TEXT NOT NULL, weight REAL NOT NULL, awarded_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(user_id, entity_ref, step_key))`),
      db.prepare(`CREATE INDEX IF NOT EXISTS idx_staff_points_user_time ON staff_points (user_id, awarded_at DESC)`),
      db.prepare(`CREATE INDEX IF NOT EXISTS idx_staff_points_entity ON staff_points (entity_ref)`),
      db.prepare(`CREATE INDEX IF NOT EXISTS idx_staff_points_awarded_at ON staff_points (awarded_at DESC)`),
    ]);

    _schemaReady = true;
  } catch (e) {
    // Log but do not rethrow — the request continues and individual queries
    // will surface their own errors if something is genuinely missing.
    console.error('[ensureSchema] init failed:', e?.message ?? e);
  }
}
// ── End auto schema initialisation ───────────────────────────────────────────

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname.replace('/api/', '').replace('/api', '');
  const method = request.method;

  if (!env.DB) {
    return error('D1 database binding missing — ensure DB is bound in wrangler.toml', 500);
  }

  const db = env.DB;

  await ensureSchema(db);

  const logActivity = async ({ user, action, entityType, entityId, description = '' }) => {
    if (!user) return;
    await db
      .prepare('INSERT INTO activity_logs (user_id, username, user_role, action, entity_type, entity_id, description) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(user.id, user.username, user.role, action, entityType, entityId || null, description)
      .run();
  };

  // ── Staff points helpers ─────────────────────────────────────────────
  // Default weights for transaction-lifecycle steps. Admin can override the
  // entire map per stakeholder via config.stepWeights. Weights for steps
  // that don't apply to a given transaction are simply never awarded.
  const DEFAULT_STEP_WEIGHTS = {
    customer_intake: 0.08,
    id_verification: 0.15,
    item_photo: 0.10,
    item_appraisal: 0.10,
    agreement_print: 0.05,
    cash_disbursement: 0.27,
    repayment_collection: 0.20,
    default_handling_listing: 0.03,
    sale_completion: 0.02,
  };
  // Default weights for non-transaction operational tasks (staff-eligible only;
  // admin-only governance actions are intentionally absent and award zero).
  const DEFAULT_TASK_WEIGHTS = {
    expense_entry: 0.05,
    sms_send: 0.01,
    agreement_reprint: 0.01,
    customer_followup_log: 0.02,
    inventory_update: 0.02,
  };

  const loadPointsConfig = async () => {
    const row = await db.prepare("SELECT value FROM settings WHERE key = 'config'").first().catch(() => null);
    const cfg = row ? JSON.parse(row.value || '{}') : {};
    return {
      stepWeights: { ...DEFAULT_STEP_WEIGHTS, ...(cfg.stepWeights || {}) },
      taskWeights: { ...DEFAULT_TASK_WEIGHTS, ...(cfg.taskWeights || {}) },
    };
  };

  // Award fractional points for one (user, entity_ref, step_key). Idempotent:
  // the UNIQUE constraint means re-saving a draft / re-doing the same step by
  // the same user does NOT double-credit.
  const awardPoints = async ({ userId, entityRef, stepKey, weight }) => {
    if (!userId || !entityRef || !stepKey || !Number.isFinite(weight) || weight <= 0) return;
    try {
      await db
        .prepare('INSERT OR IGNORE INTO staff_points (user_id, entity_ref, step_key, weight) VALUES (?, ?, ?, ?)')
        .bind(userId, entityRef, stepKey, weight)
        .run();
    } catch (e) {
      console.error('[awardPoints] failed:', e?.message ?? e);
    }
  };

  // Fan out points for a list of (userId, stepKey) pairs against one entity_ref
  // using the configured stepWeights. Pairs with no user_id are skipped.
  const awardStepPoints = async (entityRef, pairs) => {
    if (!entityRef || !Array.isArray(pairs) || pairs.length === 0) return;
    const { stepWeights } = await loadPointsConfig();
    for (const { userId, stepKey } of pairs) {
      const weight = stepWeights[stepKey];
      if (!weight) continue;
      await awardPoints({ userId, entityRef, stepKey, weight });
    }
  };

  // Award task points for a single non-transaction action (expense, sms, etc.).
  const awardTaskPoints = async ({ user, taskKey, entityRef }) => {
    if (!user || !taskKey || !entityRef) return;
    const { taskWeights } = await loadPointsConfig();
    const weight = taskWeights[taskKey];
    if (!weight) return;
    await awardPoints({ userId: user.id, entityRef, stepKey: taskKey, weight });
  };

  // Helper: Normalize Termii delivery status to standard format
  const normalizeDeliveryStatus = (rawStatus) => {
    if (!rawStatus) return null;
    const status = String(rawStatus).toLowerCase().trim();

    // Map various Termii status formats to standardized internal statuses
    // NOTE: 'undeliver' must be checked BEFORE 'deliver' because 'undeliverable'
    // contains the substring 'deliver' and would otherwise match the wrong branch.
    if (status.includes('undeliver')) return 'Undeliverable';
    if (status.includes('deliver')) return 'DeliveredToTerminal';
    if (status.includes('success')) return 'DeliveredToTerminal';
    if (status.includes('expired') || status.includes('expire')) return 'Expired';
    if (status.includes('dnd')) return 'DND';
    if (status.includes('fail') || status.includes('failed')) return 'Failed';
    if (status.includes('reject') || status.includes('rejected')) return 'Rejected';
    if (status.includes('invalid')) return 'InvalidNumber';
    if (status.includes('pending')) return 'Pending';
    if (status === '404' || status.includes('not found')) return 'NotFound';

    // Return the original status if we can't normalize it
    return String(rawStatus);
  };


  // Extract R2 keys from all photo fields in a draft/transaction data object.
  const extractPhotoKeys = (data) => {
    const keys = [];
    const collect = (url) => {
      if (typeof url === 'string' && url.startsWith('/api/photos/'))
        keys.push(url.slice('/api/photos/'.length));
    };
    collect(data.ninPhoto);
    collect(data.photoCustomerHolding);
    collect(data.photoCustomerID);
    collect(data.photoSigning);
    collect(data.photoSealedPkg);
    collect(data.customerSignatureImage);
    collect(data.imeiPhoto);
    collect(data.serialNumberPhoto);
    collect(data.receiptPhoto);
    if (data.itemPhotos) {
      ['front', 'back', 'left', 'right', 'powerOn', 'aboutPage'].forEach(k => collect(data.itemPhotos[k]));
      (data.itemPhotos.corners || []).forEach(collect);
    }
    (data.salePhotos || []).forEach(collect);
    return keys;
  };

  try {
    // ============================================================
    // PHOTOS: GET /api/photos/:key  (serve from R2 — no auth needed,
    //         keys are random/unguessable)
    // ============================================================
    if (path.startsWith('photos/') && method === 'GET') {
      if (!env.PHOTOS) return error('R2 bucket binding missing — add PHOTOS binding in wrangler.toml', 500);
      const key = decodeURIComponent(path.slice('photos/'.length));
      const object = await env.PHOTOS.get(key);
      if (!object) return error('Photo not found', 404);
      const headers = new Headers();
      headers.set('Content-Type', object.httpMetadata?.contentType || 'image/jpeg');
      headers.set('Cache-Control', 'public, max-age=31536000, immutable');
      return new Response(object.body, { headers });
    }

    // ============================================================
    // PHOTOS: DELETE /api/photos/:key  (remove from R2)
    // ============================================================
    if (path.startsWith('photos/') && method === 'DELETE') {
      const user = getSessionUser(request);
      if (!user) return error('Not authenticated', 401);
      if (!env.PHOTOS) return error('R2 bucket binding missing', 500);
      const key = decodeURIComponent(path.slice('photos/'.length));
      await env.PHOTOS.delete(key);
      return json({ success: true });
    }

    // ============================================================
    // PHOTOS: POST /api/photos  (upload to R2, returns { url })
    // ============================================================
    if (path === 'photos' && method === 'POST') {
      const user = getSessionUser(request);
      if (!user) return error('Not authenticated', 401);
      if (!env.PHOTOS) return error('R2 bucket binding missing — add PHOTOS binding in wrangler.toml', 500);
      const { data, mimeType } = await request.json();
      if (!data || !mimeType) return error('Missing data or mimeType');
      const normalizedMime = String(mimeType).toLowerCase().trim();
      const ext = ALLOWED_PHOTO_MIME_TYPES.get(normalizedMime);
      if (!ext) return error('Unsupported photo type. Upload a JPG, PNG, WebP, HEIC, HEIF, or AVIF image.', 415);
      let bytes;
      try {
        bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
      } catch {
        return error('Invalid photo data', 400);
      }
      if (!bytes.length) return error('Photo upload is empty', 400);
      if (bytes.length > MAX_PHOTO_BYTES) return error(`Photo is too large. Maximum size is ${Math.floor(MAX_PHOTO_BYTES / (1024 * 1024))}MB.`, 413);
      const key = `${Date.now()}-${randomBytes(16).toString('hex')}.${ext}`;
      await env.PHOTOS.put(key, bytes, { httpMetadata: { contentType: normalizedMime } });
      return json({ url: `/api/photos/${key}` });
    }

    // ============================================================
    // AUTH: POST /api/login
    // ============================================================
    if (path === 'login' && method === 'POST') {
      const { username, password, rememberMe } = await request.json();

      // ── Brute-force protection ──
      // Read configured limits (fall back to safe defaults if settings not yet populated).
      const loginCfgRow = await db.prepare("SELECT value FROM settings WHERE key = 'config'").first().catch(() => null);
      const loginCfg = loginCfgRow ? JSON.parse(loginCfgRow.value || '{}') : {};
      const maxAttempts = Math.max(1, Number(loginCfg.maxLoginAttempts) || 5);
      const cooldownMinutes = Math.max(1, Number(loginCfg.loginCooldownMinutes) || 15);

      const recentFailures = await db
        .prepare("SELECT COUNT(*) AS n FROM login_attempts WHERE username = ? AND success = 0 AND attempted_at > datetime('now', ?)")
        .bind(username, `-${cooldownMinutes} minutes`)
        .first()
        .catch(() => null); // graceful degradation if table not yet migrated

      if ((recentFailures?.n || 0) >= maxAttempts) {
        return error(`Too many failed login attempts. Please wait ${cooldownMinutes} minute(s) before trying again.`, 429);
      }

      let user = await db
        .prepare('SELECT id, username, password, role, roles, name, active, phone1, phone2, email, signature, created_at FROM users WHERE username = ?')
        .bind(username)
        .first()
        .catch(() =>
          // Fallback 1: `signature` column not migrated yet — select everything else
          db.prepare('SELECT id, username, password, role, roles, name, active, phone1, phone2, email, created_at FROM users WHERE username = ?')
            .bind(username).first().then(u => u ? { ...u, signature: null } : null)
            .catch(() =>
              // Fallback 2: `active`/`roles` migration also not run — minimal schema
              db.prepare('SELECT id, username, password, role, name FROM users WHERE username = ?')
                .bind(username).first().then(u => u ? { ...u, active: 1, roles: '[]', signature: null } : null)
            )
        );
      if (!user) {
        await db.prepare('INSERT INTO login_attempts (username, success) VALUES (?, 0)').bind(username).run().catch(() => {});
        return error('Invalid username or password', 401);
      }
      const passwordCheck = await verifyPassword(password, user.password);
      if (!passwordCheck.ok) {
        await db.prepare('INSERT INTO login_attempts (username, success) VALUES (?, 0)').bind(username).run().catch(() => {});
        return error('Invalid username or password', 401);
      }
      if (user.active === 0) return error('This account has been disabled. Contact the administrator.', 403);
      // Clear failed attempts on successful login to reset the counter
      await db.prepare('DELETE FROM login_attempts WHERE username = ?').bind(username).run().catch(() => {});
      if (passwordCheck.needsUpgrade) {
        const upgradedHash = await hashPassword(password);
        await db.prepare('UPDATE users SET password = ? WHERE id = ?').bind(upgradedHash, user.id).run();
        user = { ...user, password: upgradedHash };
      }

      const parsedRoles = parseRoles(user.roles);
      const sessionPayload = JSON.stringify({ id: user.id, username: user.username, role: user.role, roles: parsedRoles, name: user.name, phone1: user.phone1 || null, phone2: user.phone2 || null, email: user.email || null, signature: user.signature || null, created_at: user.created_at || null, issuedAt: Date.now() });
      const activeCookie = rememberMe
        ? buildSessionCookie(SESSION_COOKIE_LONG, sessionPayload, REMEMBER_ME_MAX_AGE)
        : buildSessionCookie(SESSION_COOKIE_SHORT, sessionPayload);
      const staleCookie = rememberMe
        ? clearSessionCookie(SESSION_COOKIE_SHORT)
        : clearSessionCookie(SESSION_COOKIE_LONG);

      await logActivity({ user, action: 'login', entityType: 'auth', entityId: user.id, description: `🔐 ${user.name} (${user.role}) logged in` });
      return json({ user }, 200, { 'Set-Cookie': [activeCookie, staleCookie] });
    }

    // ============================================================
    // AUTH: GET /api/me
    // ============================================================
    if (path === 'me' && method === 'GET') {
      const user = getSessionUser(request);
      if (!user) return error('Not authenticated', 401);
      // Always query fresh so contact info (phone1/phone2/email/signature) reflects latest updates
      const fresh = await db
        .prepare('SELECT id, username, role, roles, name, active, phone1, phone2, email, signature, created_at FROM users WHERE id = ?')
        .bind(user.id).first()
        .catch(() =>
          // Fallback if `signature` column has not been migrated yet
          db.prepare('SELECT id, username, role, roles, name, active, phone1, phone2, email, created_at FROM users WHERE id = ?')
            .bind(user.id).first().then(u => u ? { ...u, signature: null } : null)
            .catch(() => null)
        );
      if (!fresh) return json(user); // fallback to session data if DB unreachable
      return json({ ...user, phone1: fresh.phone1 || null, phone2: fresh.phone2 || null, email: fresh.email || null, signature: fresh.signature || null, created_at: fresh.created_at || null, roles: parseRoles(fresh.roles), active: fresh.active });
    }

    // ============================================================
    // AUTH: POST /api/verify-password
    // ============================================================
    if (path === 'verify-password' && method === 'POST') {
      const auth = requireAuth(request);
      if (auth.error) return auth.error;
      const { password } = await request.json();
      const user = await db.prepare('SELECT id, password FROM users WHERE id = ?').bind(auth.user.id).first();
      const passwordCheck = await verifyPassword(password, user?.password);
      if (!passwordCheck.ok) return error('Incorrect password', 401);
      if (passwordCheck.needsUpgrade) {
        const upgradedHash = await hashPassword(password);
        await db.prepare('UPDATE users SET password = ? WHERE id = ?').bind(upgradedHash, auth.user.id).run();
      }
      return json({ ok: true });
    }

    // ============================================================
    // AUTH: POST /api/change-password
    // ============================================================
    if (path === 'change-password' && method === 'POST') {
      const auth = requireAuth(request);
      if (auth.error) return auth.error;
      const { currentPassword, newPassword } = await request.json();
      if (!newPassword || newPassword.length < 6) return error('New password must be at least 6 characters');
      const user = await db.prepare('SELECT id, password, name, username FROM users WHERE id = ?').bind(auth.user.id).first();
      const check = await verifyPassword(currentPassword, user?.password);
      if (!check.ok) return error('Current password is incorrect', 401);
      const hashed = await hashPassword(newPassword);
      await db.prepare('UPDATE users SET password = ? WHERE id = ?').bind(hashed, auth.user.id).run();
      await logActivity({ user: auth.user, action: 'change_password', entityType: 'user', entityId: auth.user.id, description: `🔒 ${user.name} changed their password` });
      await pushNotifyUser(env, db, auth.user.id, {
        title: '🔒 Password Changed',
        body: 'Your CIF Quick Cash password was just changed. If this wasn\'t you, contact admin immediately.',
        url: '/profile',
        tag: 'security-alert',
      });
      return json({ success: true });
    }

    // ============================================================
    // AUTH: POST /api/logout
    // ============================================================
    if (path === 'logout' && method === 'POST') {
      return json(
        { success: true },
        200,
        { 'Set-Cookie': [clearSessionCookie(SESSION_COOKIE_SHORT), clearSessionCookie(SESSION_COOKIE_LONG)] }
      );
    }

    // ============================================================
    // BOOTSTRAP: GET /api/bootstrap?scope=critical|transactions|secondary&role=admin
    // ============================================================
    if (path === 'bootstrap' && method === 'GET') {
      const scope = url.searchParams.get('scope') || 'critical';
      // Use the active-checking variant so a disabled account is kicked out
      // on the next page load rather than waiting for the cookie to expire.
      const auth = await requireAuthActive(request, db);
      if (auth.error) return auth.error;
      const isAdmin = auth?.user?.role === 'admin';

      if (scope === 'secondary') {
        const [expensesRes, capitalRes, declinedRes, usersRes] = await Promise.all([
          db.prepare('SELECT id, date, category, description, amount, registered_by FROM expenses ORDER BY date DESC').all(),
          db.prepare('SELECT id, name, amount, date, method, receipt, user_id, type FROM capital ORDER BY date').all(),
          db.prepare('SELECT id, date, ref, customer_name AS customerName, nin_bvn AS ninBvn, item, reason, notes FROM declined_log ORDER BY date DESC').all(),
          isAdmin
            ? db.prepare('SELECT id, username, role, roles, name, active, phone1, phone2, email, created_at FROM users ORDER BY created_at').all()
            : Promise.resolve({ results: [] }),
        ]);

        // Query distributions separately — table may not exist on older deployments
        let distributionsResults = [];
        try {
          const distributionsRes = await db.prepare('SELECT id, date, amount, method, note, receipt, created_by, created_at, stakeholder_name, decision_ids FROM profit_distributions ORDER BY date DESC, created_at DESC').all();
          distributionsResults = distributionsRes.results;
        } catch (_) { /* table not yet migrated — return empty */ }

        // Auto-load current month's profit decisions
        let decisionsResults = [];
        try {
          const now = new Date();
          const curPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
          let decSql = 'SELECT * FROM distribution_decisions WHERE period = ?';
          const decParams = [curPeriod];
          if (!isAdmin) { decSql += ' AND user_id = ?'; decParams.push(auth.user.id); }
          decSql += ' ORDER BY stakeholder_name';
          const decRes = await db.prepare(decSql).bind(...decParams).all();
          decisionsResults = decRes.results;
        } catch (_) { /* table not yet created */ }

        return json({
          expenses: expensesRes.results,
          capital: capitalRes.results,
          declined: declinedRes.results,
      users: usersRes.results.map(u => ({ ...u, roles: parseRoles(u.roles) })),
      distributions: distributionsResults,
      decisions: decisionsResults,
        });
      }

      if (scope === 'transactions') {
        const limit = Math.max(1, Math.min(200, Number.parseInt(url.searchParams.get('limit') || '100', 10) || 100));
        const offset = Math.max(0, Number.parseInt(url.searchParams.get('offset') || '0', 10) || 0);

        // All authenticated users see all drafts — staff collaborate on any customer's draft.
        // Exclude drafts already saved as completed transactions (stale-draft guard).
        const draftUserFilter = { sql: 'NOT EXISTS (SELECT 1 FROM transactions WHERE ref = d.ref)', params: [] };

        // Fetch transactions and settings unconditionally — these must never fail for staff.
        // Drafts queries are run separately so that a schema error (e.g. missing created_by
        // column on un-migrated databases) degrades gracefully to an empty drafts list
        // rather than crashing the entire response and blanking the dashboard.
        const [transactionsRes, txCountRow, settingsRow] = await Promise.all([
          db.prepare('SELECT ref, data, status, created_at, updated_at FROM transactions ORDER BY created_at DESC LIMIT ? OFFSET ?').bind(limit, offset).all(),
          db.prepare('SELECT COUNT(*) AS total FROM transactions').first(),
          db.prepare("SELECT value FROM settings WHERE key = 'config'").first()
        ]);

        let draftsResults = [];
        let totalDrafts = 0;
        try {
          const [draftsRes, draftCountRow] = await Promise.all([
            db.prepare(`SELECT d.ref, d.data, d.updated_at FROM drafts d WHERE ${draftUserFilter.sql} ORDER BY d.updated_at DESC LIMIT ? OFFSET ?`).bind(...draftUserFilter.params, limit, offset).all(),
            db.prepare(`SELECT COUNT(*) AS total FROM drafts d WHERE ${draftUserFilter.sql}`).bind(...draftUserFilter.params).first(),
          ]);
          draftsResults = draftsRes.results;
          totalDrafts = draftCountRow?.total || 0;
        } catch (err) { console.warn('[bootstrap] drafts query failed (migration pending?):', err?.message); }

        const loanCfg = (() => {
          const cfg = settingsRow ? JSON.parse(settingsRow.value) : {};
          return { maxLoanDays: Math.max(1, Number(cfg.maxLoanDays) || 30), graceDays: Math.max(0, Number(cfg.graceDays) || 3) };
        })();

        const totalTransactions = txCountRow?.total || 0;
        const hasMore = offset + limit < Math.max(totalTransactions, totalDrafts);

        return json({
          transactions: transactionsRes.results.map((r) => withLoanTimeline({ ...JSON.parse(r.data), ref: r.ref, status: r.status, created_at: r.created_at, updated_at: r.updated_at }, loanCfg)),
          drafts: draftsResults.map((r) => ({ ...JSON.parse(r.data), ref: r.ref })),
          pagination: {
            limit,
            offset,
            nextOffset: hasMore ? offset + limit : null,
            hasMore,
            totalTransactions,
            totalDrafts
          }
        });
      }

      // scope === 'critical'
      const [settingsRow, summaryRow] = await Promise.all([
        db.prepare("SELECT value FROM settings WHERE key = 'config'").first(),
        db.prepare(`
          SELECT
            COUNT(*) AS total,
            SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active,
            SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END) AS closed,
            SUM(CASE WHEN status = 'sold' THEN 1 ELSE 0 END) AS sold,
            SUM(CASE WHEN status = 'for_sale' THEN 1 ELSE 0 END) AS for_sale
          FROM transactions
        `).first()
      ]);

      return json({
        settings: settingsRow ? JSON.parse(settingsRow.value) : {},
        summary: summaryRow || { total: 0, active: 0, closed: 0, sold: 0, for_sale: 0 }
      });
    }

    // ============================================================
    // USERS: GET, POST, DELETE /api/users
    // ============================================================
    if (path === 'users' && method === 'GET') {
      const auth = requireAdmin(request);
      if (auth.error) return auth.error;
      const { results } = await db.prepare('SELECT id, username, role, roles, name, active, phone1, phone2, email, created_at FROM users ORDER BY created_at').all();
      return json(results.map(u => ({ ...u, roles: parseRoles(u.roles) })));
    }
    if (path === 'users' && method === 'POST') {
      const auth = requireAdmin(request);
      if (auth.error) return auth.error;
      const { id, username, password, role, name, roles } = await request.json();
      const normalizedUsername = String(username || '').trim().toLowerCase();
      const normalizedName = String(name || '').trim();
      const normalizedPassword = String(password || '').trim();
      const normalizedRole = String(role || '').trim();
      if (!normalizedName) return error('Name is required');
      if (!normalizedUsername) return error('Username is required');
      if (!normalizedPassword) return error('Password is required');
      if (!ALLOWED_USER_ROLES.includes(normalizedRole)) return error('Invalid role');
      const existingUser = await db.prepare('SELECT id FROM users WHERE lower(username) = ?').bind(normalizedUsername).first();
      if (existingUser) return error('Username already exists', 409);
      const safeRoles = Array.isArray(roles) ? roles.filter(r => typeof r === 'string' && ALLOWED_USER_ROLES.includes(r) && r !== normalizedRole) : [];
      const rolesJson = JSON.stringify([...new Set(safeRoles)]);
      const passwordHash = await hashPassword(normalizedPassword);
      const userId = id || `u-${Date.now()}`;
      await db
        .prepare('INSERT INTO users (id, username, password, role, roles, name) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(userId, normalizedUsername, passwordHash, normalizedRole, rolesJson, normalizedName)
        .run();
      await logActivity({ user: auth.user, action: 'entry', entityType: 'user', entityId: userId, description: `👤 New ${normalizedRole} account created: ${normalizedName} (@${normalizedUsername})` });
      return json({ success: true, id: userId });
    }
    if (path.startsWith('users/') && method === 'DELETE') {
      const auth = requireAdmin(request);
      if (auth.error) return auth.error;
      const id = path.split('/')[1];
      if (id === 'admin') return error('Cannot delete admin user');
      const targetUser = await db.prepare('SELECT username, name, role FROM users WHERE id = ?').bind(id).first();
      await db.prepare('DELETE FROM users WHERE id = ?').bind(id).run();
      await logActivity({ user: auth.user, action: 'delete', entityType: 'user', entityId: id, description: `👤 User account removed: ${targetUser?.name || ''} (@${targetUser?.username || id}) — was ${targetUser?.role || ''}` });
      return json({ success: true });
    }
    if (path.startsWith('users/') && method === 'PUT') {
      const id = path.split('/')[1];
      if (id === 'admin') return error('Cannot modify the admin account');
      // Allow any authenticated user to update their own contact info (phone1/phone2/email).
      // All other fields (username, password, active, roles) are admin-only.
      const sessionAuth = requireAuth(request);
      if (sessionAuth.error) return sessionAuth.error;
      const isSelf = sessionAuth.user.id === id;
      const isAdmin = sessionAuth.user.role === 'admin';
      const body = await request.json();
      const { username, password, active, roles, phone1, phone2, email, signature } = body;
      // Non-admin trying to modify privileged fields
      if (!isAdmin && (username !== undefined || password !== undefined || active !== undefined || roles !== undefined)) {
        return error('Admin access required', 403);
      }
      // Non-admin can only edit their own contact info
      if (!isAdmin && !isSelf) return error('Forbidden', 403);
      const cur = await db.prepare('SELECT username, name, role, roles, active, phone1, phone2, email, signature FROM users WHERE id = ?').bind(id).first()
        .catch(() =>
          // Fallback if `signature` column has not been migrated yet
          db.prepare('SELECT username, name, role, roles, active, phone1, phone2, email FROM users WHERE id = ?').bind(id).first()
            .then(u => u ? { ...u, signature: null } : null)
        );
      if (!cur) return error('User not found', 404);
      const setClauses = []; const setParams = [];
      if (isAdmin) {
        if (username !== undefined && username.trim() && username.trim() !== cur.username) { setClauses.push('username = ?'); setParams.push(username.trim()); }
        if (password !== undefined && password.trim()) { setClauses.push('password = ?'); setParams.push(await hashPassword(password.trim())); }
        if (active !== undefined && Number(active) !== Number(cur.active ?? 1)) { setClauses.push('active = ?'); setParams.push(active ? 1 : 0); }
        if (roles !== undefined && Array.isArray(roles)) { setClauses.push('roles = ?'); setParams.push(JSON.stringify(roles)); }
      }
      if (phone1 !== undefined) { setClauses.push('phone1 = ?'); setParams.push(phone1 || null); }
      if (phone2 !== undefined) { setClauses.push('phone2 = ?'); setParams.push(phone2 || null); }
      if (email  !== undefined) { setClauses.push('email = ?');  setParams.push(email  || null); }
      if (signature !== undefined) { setClauses.push('signature = ?'); setParams.push(signature || null); }
      if (setClauses.length) await db.prepare(`UPDATE users SET ${setClauses.join(', ')} WHERE id = ?`).bind(...setParams, id).run();
      if (isAdmin) {
        if (username !== undefined && username.trim() && username.trim() !== cur.username)
          await logActivity({ user: sessionAuth.user, action: 'update', entityType: 'user', entityId: id, description: `👤 Username changed: ${cur.name} — @${cur.username} → @${username.trim()}` });
        if (password !== undefined && password.trim())
          await logActivity({ user: sessionAuth.user, action: 'update', entityType: 'user', entityId: id, description: `🔑 Password changed for ${cur.name} (@${cur.username})` });
        if (active !== undefined && Number(active) !== Number(cur.active ?? 1))
          await logActivity({ user: sessionAuth.user, action: active ? 'activate' : 'deactivate', entityType: 'user', entityId: id, description: `${active ? '✅' : '🔒'} User account ${active ? 'activated' : 'deactivated'}: ${cur.name} (@${cur.username})` });
        if (roles !== undefined && Array.isArray(roles)) {
          const curRoles = parseRoles(cur.roles);
          const added = roles.filter(r => !curRoles.includes(r));
          const removed = curRoles.filter(r => !roles.includes(r));
          if (added.length || removed.length)
            await logActivity({ user: sessionAuth.user, action: 'update', entityType: 'user', entityId: id, description: `🎭 Roles updated for ${cur.name} (@${cur.username})${added.length ? ` — granted: ${added.join(', ')}` : ''}${removed.length ? ` — revoked: ${removed.join(', ')}` : ''}` });
        }
      }
      if (phone1 !== undefined || phone2 !== undefined || email !== undefined)
        await logActivity({ user: sessionAuth.user, action: 'update', entityType: 'profile', entityId: id, description: `📋 Contact details updated for ${cur.name}` });
      return json({ success: true });
    }

    // ============================================================
    // SETTINGS: GET, PUT /api/settings
    // ============================================================
    if (path === 'settings' && method === 'GET') {
      const auth = requireAuth(request);
      if (auth.error) return auth.error;
      const row = await db.prepare("SELECT value FROM settings WHERE key = 'config'").first();
      return json(row ? JSON.parse(row.value) : {});
    }
    if (path === 'settings' && method === 'PUT') {
      const auth = await requireAuthActive(request, db);
      if (auth.error) return auth.error;
      if (auth.user.role !== 'admin') return error('Admin access required', 403);
      const data = await request.json();
      await db
        .prepare("INSERT INTO settings (key, value, updated_at) VALUES ('config', ?, datetime('now')) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')")
        .bind(JSON.stringify(data))
        .run();
      await logActivity({ user: auth.user, action: 'update', entityType: 'settings', entityId: 'config', description: `⚙️ System settings updated by ${auth.user.name}` });
      return json({ success: true });
    }

    // ============================================================
    // USER PREFS: GET, PUT /api/user-prefs
    // Persists per-user preferences (e.g. notification read IDs) in D1.
    // ============================================================
    if (path === 'user-prefs' && method === 'GET') {
      const auth = requireAuth(request);
      if (auth.error) return auth.error;
      const key = `user_prefs_${auth.user.id}`;
      const row = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first().catch(() => null);
      return json(row ? JSON.parse(row.value) : {});
    }
    if (path === 'user-prefs' && method === 'PUT') {
      const auth = requireAuth(request);
      if (auth.error) return auth.error;
      const data = await request.json();
      const key = `user_prefs_${auth.user.id}`;
      await db
        .prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')")
        .bind(key, JSON.stringify(data))
        .run();
      return json({ success: true });
    }

    // ============================================================
    // TRANSACTIONS: GET, POST, PUT /api/transactions
    // ============================================================
    if (path === 'transactions' && method === 'GET') {
      const auth = requireAuth(request);
      if (auth.error) return auth.error;
      const [resultsRes, loanCfg] = await Promise.all([
        db.prepare('SELECT ref, data, status, created_at, updated_at FROM transactions ORDER BY created_at DESC').all(),
        loadLoanConfig(db)
      ]);
      return json(resultsRes.results.map((r) => withLoanTimeline({ ...JSON.parse(r.data), ref: r.ref, status: r.status }, loanCfg)));
    }
    // ── SMS helpers — must be defined before transaction POST/PUT handlers that use them ──

    // Helper: load SMS config from settings
    const loadSmsConfig = async () => {
      const row = await db.prepare("SELECT value FROM settings WHERE key = 'config'").first();
      const cfg = row ? JSON.parse(row.value) : {};
      return {
        apiKey:           cfg.termiiApiKey || '',
        baseUrl:          (cfg.termiiBaseUrl || 'https://v3.api.termii.com').replace(/\/$/, ''),
        senderId:         (cfg.termiiSenderId || 'N-Alert').trim(),
        channel:          cfg.termiiChannel || 'generic',
        enabled:          cfg.smsEnabled === true,
        nairaPerCredit:   Math.max(1, Number(cfg.smsNairaPerCredit) || 5),
        dueDateDays:      Array.isArray(cfg.smsDueDateReminderDays)    ? cfg.smsDueDateReminderDays.map(Number)    : [2, 1, 0],
        ownershipDays:    Array.isArray(cfg.smsOwnershipReminderDays)  ? cfg.smsOwnershipReminderDays.map(Number)  : [3, 0],
        tmplDueReminder:  cfg.smsDueDateReminder  || 'Hello {customerName}, your loan (Ref: {ref}) of {amount} is due in {daysLeft} day(s). Please visit {businessName} to make payment.',
        tmplDueToday:     cfg.smsDueTodayReminder || 'Hello {customerName}, your loan (Ref: {ref}) of {amount} is due TODAY. Please visit {businessName} immediately to avoid penalties.',
        tmplOwnReminder:  cfg.smsOwnershipReminder || 'Dear {customerName}, your item (Ref: {ref}) becomes property of {businessName} in {daysLeft} day(s) if unpaid. Please come in urgently.',
        tmplOwnToday:     cfg.smsOwnershipLastDay  || 'Dear {customerName}, TODAY is the last day to reclaim your item (Ref: {ref}). Visit {businessName} now or the item becomes ours. Call: {shopPhone}',
        tmplOwnTransferred: cfg.smsOwnershipTransferred || 'Dear {customerName}, your item (Ref: {ref}) has been successfully acquired by {businessName} at {amount} per your signed cash advance agreement. It will now be listed for public sale. Thank you.',
        ownTransferredEnabled: cfg.smsOwnershipTransferredEnabled !== false,
        tmplOutrightConfirmation: cfg.smsOutrightConfirmation || 'Dear {customerName}, thank you for selling your item to {businessName}. We have received and paid you {amount} for Ref: {ref}. The item will be listed for public sale. Thank you for choosing {businessName}.',
        outrightConfirmationEnabled: cfg.smsOutrightConfirmationEnabled !== false,
        // ── New: Advance loan confirmation ──
        advanceConfirmationEnabled: cfg.smsAdvanceConfirmationEnabled !== false,
        tmplAdvanceConfirmation: cfg.smsAdvanceConfirmation || 'Dear {customerName}, your cash advance of {amount} (Ref: {ref}) has been processed. Your return date is {dueDate}. Repay on time to avoid penalties. {businessName}. Call: {shopPhone}',
        // ── New: Overdue reminders (post-due-date, pre-internal-deadline) ──
        overdueReminderDays: Array.isArray(cfg.smsOverdueReminderDays) ? cfg.smsOverdueReminderDays.map(Number).filter(d => Number.isFinite(d) && d >= 1) : [1, 3, 5],
        tmplOverdueReminder: cfg.smsOverdueReminder || 'Dear {customerName}, your loan (Ref: {ref}) is {daysOverdue} day(s) overdue. Balance if repaid today: {balanceToday}. Visit {businessName} now to avoid losing your item. Call: {shopPhone}',
        // ── New: Redemption/repayment confirmation ──
        redemptionConfirmationEnabled: cfg.smsRedemptionConfirmationEnabled !== false,
        tmplRedemptionConfirmation: cfg.smsRedemptionConfirmation || 'Dear {customerName}, your loan (Ref: {ref}) has been fully repaid. You paid {amount} and your item has been returned. Thank you for choosing {businessName}!',
        // ── New: Mid-loan balance reminder ──
        midLoanReminderEnabled: cfg.smsMidLoanReminderEnabled !== false,
        tmplMidLoanReminder: cfg.smsMidLoanReminder || 'Hello {customerName}, your loan (Ref: {ref}) is at its midpoint. Your balance if repaid today is {balanceToday}. Early repayment is always welcome at {businessName}. Call: {shopPhone}',
        // ── New: Item listed for sale (advance → for_sale transition) ──
        listedForSaleEnabled: cfg.smsListedForSaleEnabled !== false,
        tmplListedForSale: cfg.smsListedForSale || 'Dear {customerName}, your item (Ref: {ref}) has been listed for public sale by {businessName} as per your signed agreement. Call {shopPhone} with any questions.',
        // ── New: Sale confirmation (receipt sent to the new buyer) ──
        saleConfirmationEnabled: cfg.smsSaleConfirmationEnabled !== false,
        tmplSaleConfirmation: cfg.smsSaleConfirmation || 'Dear {buyerName}, thank you for your purchase! You bought a {itemDesc} for {amount} (Shop Ref: {shopRef}) from {businessName}. Call {shopPhone} for any queries.',
        // ── New: Partial loan payment receipt ──
        loanPaymentConfirmationEnabled: cfg.smsLoanPaymentConfirmationEnabled !== false,
        tmplLoanPayment: cfg.smsLoanPaymentConfirmation || 'Dear {customerName}, we received your payment of {amount} on {ref}. {breakdown} — {businessName}. Call {shopPhone} with any questions.',
        smsRetryEnabled: cfg.smsRetryEnabled !== false,
        smsRetryDays:    Math.max(1, Math.min(7, Number(cfg.smsRetryDays) || 3)),
        businessName:     cfg.businessName || 'CIF Quick Cash',
        shopPhone:        cfg.shopPhone1 || '',
        maxLoanDays:      Math.max(1, Number(cfg.maxLoanDays) || 30),
        graceDays:        Math.max(0, Number(cfg.graceDays) || 3),
        interestRate:     Math.max(0, Number(cfg.interestRate) || 1),
      };
    };

    // Helper: normalise a Nigerian phone number to international format (234XXXXXXXXXX)
    const toIntlPhone = (raw = '') => {
      const digits = raw.replace(/\D/g, '');
      if (digits.startsWith('234') && digits.length === 13) return digits;
      if (digits.startsWith('0') && digits.length === 11) return '234' + digits.slice(1);
      return digits; // best-effort for non-standard formats
    };

    // Helper: fill template variables
    const fillSmsTemplate = (template, vars = {}) =>
      template
        .replace(/\{customerName\}/g,  vars.customerName || '')
        .replace(/\{ref\}/g,           vars.ref || '')
        .replace(/\{amount\}/g,         vars.amount || '')
        .replace(/\{daysLeft\}/g,       String(vars.daysLeft ?? ''))
        .replace(/\{daysOverdue\}/g,    String(vars.daysOverdue ?? ''))
        .replace(/\{dueDate\}/g,        vars.dueDate || '')
        .replace(/\{balanceToday\}/g,   vars.balanceToday || '')
        .replace(/\{buyerName\}/g,      vars.buyerName || '')
        .replace(/\{itemDesc\}/g,       vars.itemDesc || '')
        .replace(/\{shopRef\}/g,        vars.shopRef || '')
        .replace(/\{businessName\}/g,   vars.businessName || '')
        .replace(/\{shopPhone\}/g,      vars.shopPhone || '')
        .replace(/\{breakdown\}/g,      vars.breakdown || '');

    // Helper: send one SMS via Termii, returns { ok, messageId, response, usedFallback }
    const termiiSend = async (smsCfg, phone, message) => {
      const doSend = async (from, channel) => {
        try {
          const resp = await fetch(`${smsCfg.baseUrl}/api/sms/send`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              to: phone,
              from,
              sms: message,
              type: 'plain',
              channel,
              api_key: smsCfg.apiKey,
            }),
          });
          const data = await resp.json().catch(() => ({}));
          const ok = (data?.code === 'ok' || data?.message === 'Successfully Sent' || resp.ok) && data?.status !== 'error';
          const messageId = data?.message_id ? String(data.message_id) : null;
          return { ok, messageId, response: data };
        } catch (err) {
          return {
            ok: false,
            messageId: null,
            response: { error: 'fetch_failed', message: err?.message || String(err) },
          };
        }
      };

      // Primary attempt with configured sender ID
      const primary = await doSend(smsCfg.senderId, smsCfg.channel || 'generic');
      if (primary.ok) return { ...primary, usedFallback: false };

      // If Termii rejected the sender ID, fall back to N-Alert (pre-approved on every account)
      const termiiMsg = primary.response?.message || '';
      const senderIdRejected = termiiMsg.includes('ApplicationSenderId not found') ||
                               termiiMsg.toLowerCase().includes('sender') && termiiMsg.toLowerCase().includes('not found');
      if (senderIdRejected && smsCfg.senderId !== 'N-Alert') {
        const fallback = await doSend('N-Alert', 'generic');
        return { ...fallback, usedFallback: true, primaryResponse: primary.response };
      }

      return { ...primary, usedFallback: false };
    };

    // Helper: insert an SMS log row with backward compatibility for older
    // databases, while keeping per-request DB subqueries minimal.
    // null  => unknown
    // true  => message_id column works
    // false => message_id column not available
    let smsLogSchemaSupportsMessageId = null;
    const insertSmsLog = async ({ transactionRef, triggerType, message, recipient, status, termiiResponse, messageId = null }) => {
      const runWithMessageId = () => db.prepare(
          'INSERT INTO sms_logs (transaction_ref, trigger_type, message, recipient, status, termii_response, message_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
        ).bind(transactionRef, triggerType, message, recipient, status, termiiResponse, messageId).run();
      const runWithoutMessageId = () => db.prepare(
        'INSERT INTO sms_logs (transaction_ref, trigger_type, message, recipient, status, termii_response) VALUES (?, ?, ?, ?, ?, ?)'
      ).bind(transactionRef, triggerType, message, recipient, status, termiiResponse).run();

      const ensureSmsLogsTable = async () => {
        await db.prepare(`
          CREATE TABLE IF NOT EXISTS sms_logs (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            transaction_ref TEXT    NOT NULL,
            sent_at         TEXT    NOT NULL DEFAULT (datetime('now')),
            trigger_type    TEXT    NOT NULL,
            message         TEXT    NOT NULL,
            recipient       TEXT    NOT NULL,
            status          TEXT    NOT NULL DEFAULT 'pending',
            termii_response TEXT,
            message_id      TEXT,
            delivery_status TEXT
          )
        `).run();
        await db.prepare('CREATE INDEX IF NOT EXISTS idx_sms_logs_transaction_ref ON sms_logs (transaction_ref)').run();
        await db.prepare('CREATE INDEX IF NOT EXISTS idx_sms_logs_sent_at ON sms_logs (sent_at DESC)').run();
        await db.prepare('CREATE INDEX IF NOT EXISTS idx_sms_logs_message_id ON sms_logs (message_id)').run();
      };

      if (smsLogSchemaSupportsMessageId !== false) {
        try {
          const res = await runWithMessageId();
          smsLogSchemaSupportsMessageId = true;
          return res;
        } catch (err) {
          const msg = String(err?.message || err || '');
          if (msg.includes('no such table: sms_logs')) {
            await ensureSmsLogsTable();
            smsLogSchemaSupportsMessageId = true;
            return runWithMessageId();
          }
          if (msg.includes('no column named message_id')) {
            smsLogSchemaSupportsMessageId = false;
            return runWithoutMessageId();
          }
          throw err;
        }
      }

      try {
        return await runWithoutMessageId();
      } catch (err) {
        const msg = String(err?.message || err || '');
        if (msg.includes('no such table: sms_logs')) {
          await ensureSmsLogsTable();
          smsLogSchemaSupportsMessageId = true;
          return runWithMessageId();
        }
        throw err;
      }
    };

    // Helper: record unexpected SMS runtime errors without blocking transaction flows.
    const logSmsRuntimeError = async ({ user, transactionRef, triggerType, err }) => {
      const errMsg = err?.message || String(err || 'unknown_error');
      await insertSmsLog({
        transactionRef,
        triggerType: `${triggerType}_runtime_error`,
        message: '',
        recipient: 'unknown',
        status: 'failed',
        termiiResponse: JSON.stringify({ error: 'runtime_exception', message: errMsg }),
        messageId: null,
      }).catch(() => {});
      await logActivity({
        user,
        action: 'sms',
        entityType: 'transaction',
        entityId: transactionRef,
        description: `⚠️ SMS runtime error (${triggerType}) for ${transactionRef}: ${errMsg}`,
      }).catch(() => {});
    };

    if (path === 'transactions' && method === 'POST') {
      const auth = requireAuth(request);
      if (auth.error) return auth.error;
      const tx = await request.json();
      const [existing, loanCfg] = await Promise.all([
        db.prepare('SELECT ref, status, data FROM transactions WHERE ref = ?').bind(tx.ref).first(),
        loadLoanConfig(db)
      ]);
      const existingData = existing?.data ? JSON.parse(existing.data) : null;
      if (tx.status === 'for_sale' && !tx.listedForSaleDate) {
        tx.listedForSaleDate = existingData?.listedForSaleDate
          || (existing?.status === 'for_sale' ? new Date().toISOString() : null)
          || new Date().toISOString();
      }

      // Prevent marking an advance loan for sale before sale_allowed_date.
      // sale_allowed_date = dateGiven + maxLoanDays + graceDays + 1
      // This single check covers both the "no sale before day maxLoanDays+graceDays+1"
      // and "no inventory before day maxLoanDays" constraints.
      // Exception: voluntarily surrendered items (surrenderDate recorded in the data)
      // can be listed at any time since the customer explicitly gave up the item.
      if (tx.status === 'for_sale' && tx.type !== 'outright') {
        const isVoluntarySurrender = !!(tx.surrenderDate || existingData?.surrenderDate);
        if (!isVoluntarySurrender) {
          const timeline = computeLoanTimeline(tx, loanCfg);
          if (timeline && timeline.sale_allowed_date) {
            const today = todayNigeria();
            if (today < timeline.sale_allowed_date) {
              return error(`Cannot list for sale before ${timeline.sale_allowed_date} (sale allowed from day ${loanCfg.maxLoanDays + loanCfg.graceDays + 1} onwards; business ownership begins at day ${loanCfg.maxLoanDays})`, 422);
            }
          }
        }
      }

      if (existing) {
        return error('Transaction already exists; use PUT /transactions/{ref} to update it.', 409);
      }
      // Auto-assign a shop item ref (shopId) when an outright purchase is first created so
      // it is available immediately in the public shop and SMS templates without waiting for
      // the first PUT (which is when advance loans get their shopId).
      if ((tx.status === 'for_sale' || tx.type === 'outright') && !tx.shopId) {
        tx.shopId = 'SHP-' + 'ABCDEFGHJKLMNPQRSTUVWXYZ'[Math.floor(Math.random() * 24)] + String(Math.floor(Math.random() * 10000)).padStart(4, '0');
      }
      await db
        .prepare("INSERT INTO transactions (ref, data, status, updated_at) VALUES (?, ?, ?, datetime('now'))")
        .bind(tx.ref, JSON.stringify(tx), tx.status || 'active')
        .run();
      let txAction, txDesc;
      const fmtN = (n) => Number(n || 0).toLocaleString('en-NG');
      if (!existing) {
        if (tx.type === 'outright' || tx.status === 'for_sale') {
          txAction = 'entry'; txDesc = `🏷 Outright purchase — ${tx.ref}: ${tx.fullName} brought in ${[tx.aiBrand, tx.aiModel].filter(Boolean).join(' ')} — paid ₦${fmtN(tx.cashAdvance)}`;
        } else {
          txAction = 'entry'; txDesc = `📋 New loan — ${tx.ref}: ${tx.fullName} — ${[tx.aiBrand, tx.aiModel].filter(Boolean).join(' ')} — ₦${fmtN(tx.cashAdvance)} advance given`;
        }
      } else if (tx.status === 'closed') {
        txAction = 'repaid'; txDesc = `✅ Loan repaid — ${tx.ref}: ${tx.fullName} — ₦${fmtN(tx.totalFees)} interest collected over ${tx.daysCharged || 0} days`;
      } else if (tx.status === 'sold') {
        const profit = (tx.salePrice || 0) - (tx.cashAdvance || 0);
        txAction = 'sold'; txDesc = `💰 Item sold — ${tx.ref}: ${[tx.aiBrand, tx.aiModel].filter(Boolean).join(' ')} — sold for ₦${fmtN(tx.salePrice)} (profit ₦${fmtN(profit)})`;
      } else if (tx.status === 'for_sale') {
        txAction = 'update'; txDesc = `🏷 Marked for sale — ${tx.ref}: ${[tx.aiBrand, tx.aiModel].filter(Boolean).join(' ')}`;
      } else {
        txAction = 'update'; txDesc = `🔄 Transaction updated — ${tx.ref}`;
      }
      await logActivity({ user: auth.user, action: txAction, entityType: 'transaction', entityId: tx.ref, description: txDesc });

      // ── Award staff points for transaction creation ──
      // stepActors is a map { step_key: { userId } } populated by the wizard as
      // each step is saved (see drafts POST). The user who performed the final
      // cash_disbursement (POST /transactions) is whoever is authenticated now.
      // Idempotency on (user_id, entity_ref, step_key) makes re-saves safe.
      try {
        const entityRef = 'tx:' + tx.ref;
        const stepActors = tx.stepActors || {};
        const pairs = Object.entries(stepActors)
          .map(([stepKey, info]) => ({ stepKey, userId: info && info.userId }))
          .filter(p => p.userId);
        if (tx.type === 'outright' || tx.status === 'for_sale') {
          // Outright purchases skip the loan/cash_disbursement step — credit
          // sale_completion to the finalizer instead.
          pairs.push({ userId: auth.user.id, stepKey: 'sale_completion' });
        } else {
          pairs.push({ userId: auth.user.id, stepKey: 'cash_disbursement' });
        }
        await awardStepPoints(entityRef, pairs);
      } catch (e) {
        console.error('[staff_points POST transactions] failed:', e?.message ?? e);
      }

      // ── Immediate outright-purchase confirmation SMS ──
      // Sent right when the transaction is created, not via the nightly cron.
      if (tx.type === 'outright') {
        try {
          const smsCfg = await loadSmsConfig();
          if (smsCfg.enabled && smsCfg.outrightConfirmationEnabled) {
            const rawPhone = (tx.phoneNumbers && tx.phoneNumbers[0]) || tx.phone || '';
            const phone = toIntlPhone(rawPhone);
            const rawPhone2 = tx.phoneNumbers?.[1] || '';
            const phone2 = rawPhone2 && rawPhone2 !== rawPhone ? toIntlPhone(rawPhone2) : null;
            if (!phone) {
              // Log a skipped entry so the transaction's SMS Log shows why no SMS was sent.
              await db.prepare(
                "INSERT INTO sms_logs (transaction_ref, trigger_type, message, recipient, status, termii_response) VALUES (?, 'outright_confirmation', '', '', 'skipped', ?)"
              ).bind(tx.ref, JSON.stringify({ reason: 'no_phone_number' })).run().catch(() => {});
            } else if (phone) {
              const triggerType = 'outright_confirmation';
              const today = todayNigeria();
              const alreadySent = await db.prepare(
                "SELECT id FROM sms_logs WHERE transaction_ref = ? AND trigger_type = ? AND date(sent_at, '+1 hour') = ?"
              ).bind(tx.ref, triggerType, today).first();
              if (!alreadySent) {
                const message = fillSmsTemplate(smsCfg.tmplOutrightConfirmation, {
                  customerName: tx.fullName,
                  ref: tx.ref,
                  amount: fmtN(tx.cashAdvance),
                  businessName: smsCfg.businessName,
                  shopPhone: smsCfg.shopPhone,
                });
                const { ok, messageId, response } = await termiiSend(smsCfg, phone, message);
                await insertSmsLog({
                  transactionRef: tx.ref,
                  triggerType,
                  message,
                  recipient: phone,
                  status: ok ? 'sent' : 'failed',
                  termiiResponse: JSON.stringify(response),
                  messageId,
                });
                if (phone2) {
                  const { ok: ok2, messageId: messageId2, response: response2 } = await termiiSend(smsCfg, phone2, message);
                  await insertSmsLog({
                    transactionRef: tx.ref,
                    triggerType: triggerType + '_phone2',
                    message,
                    recipient: phone2,
                    status: ok2 ? 'sent' : 'failed',
                    termiiResponse: JSON.stringify(response2),
                    messageId: messageId2,
                  });
                }
              }
            }
          }
        } catch (_smsErr) {
          // SMS failure must never block the transaction save
          await logSmsRuntimeError({ user: auth.user, transactionRef: tx.ref, triggerType: 'outright_confirmation', err: _smsErr });
        }
      }

      // ── Immediate cash advance confirmation SMS ──
      // Sent right when the advance transaction is created — gives the customer
      // a reference number, amount, and return date they can keep on their phone.
      if (tx.type === 'advance') {
        try {
          const smsCfg = await loadSmsConfig();
          if (smsCfg.enabled && smsCfg.advanceConfirmationEnabled) {
            const rawPhone = (tx.phoneNumbers && tx.phoneNumbers[0]) || tx.phone || '';
            const phone = toIntlPhone(rawPhone);
            const rawPhone2 = tx.phoneNumbers?.[1] || '';
            const phone2 = rawPhone2 && rawPhone2 !== rawPhone ? toIntlPhone(rawPhone2) : null;
            if (!phone) {
              // Log a skipped entry so the transaction's SMS Log shows why no SMS was sent.
              await db.prepare(
                "INSERT INTO sms_logs (transaction_ref, trigger_type, message, recipient, status, termii_response) VALUES (?, 'advance_confirmation', '', '', 'skipped', ?)"
              ).bind(tx.ref, JSON.stringify({ reason: 'no_phone_number' })).run().catch(() => {});
            } else {
              const triggerType = 'advance_confirmation';
              const today = todayNigeria();
              const alreadySent = await db.prepare(
                "SELECT id FROM sms_logs WHERE transaction_ref = ? AND trigger_type = ? AND date(sent_at, '+1 hour') = ?"
              ).bind(tx.ref, triggerType, today).first();
              if (!alreadySent) {
                const fmtSms = (n) => '₦' + Number(n || 0).toLocaleString('en-NG');
                const message = fillSmsTemplate(smsCfg.tmplAdvanceConfirmation, {
                  customerName: tx.fullName,
                  ref: tx.ref,
                  amount: fmtSms(tx.cashAdvance),
                  dueDate: tx.deadlineDate || '',
                  businessName: smsCfg.businessName,
                  shopPhone: smsCfg.shopPhone,
                });
                const { ok, messageId, response } = await termiiSend(smsCfg, phone, message);
                await insertSmsLog({
                  transactionRef: tx.ref,
                  triggerType,
                  message,
                  recipient: phone,
                  status: ok ? 'sent' : 'failed',
                  termiiResponse: JSON.stringify(response),
                  messageId,
                });
                if (phone2) {
                  const { ok: ok2, messageId: messageId2, response: response2 } = await termiiSend(smsCfg, phone2, message);
                  await insertSmsLog({
                    transactionRef: tx.ref,
                    triggerType: triggerType + '_phone2',
                    message,
                    recipient: phone2,
                    status: ok2 ? 'sent' : 'failed',
                    termiiResponse: JSON.stringify(response2),
                    messageId: messageId2,
                  });
                }
              }
            }
          }
        } catch (_smsErr) {
          // SMS failure must never block the transaction save
          await logSmsRuntimeError({ user: auth.user, transactionRef: tx.ref, triggerType: 'advance_confirmation', err: _smsErr });
        }
      }

      // ── Push notifications for new transactions ──
      // Keep this after transactional SMS so free-plan subrequest limits
      // don't starve customer-facing SMS sends when many devices are subscribed.
      if (tx.type === 'outright' || tx.status === 'for_sale') {
        await pushNotifyAll(env, db, {
          title: '🏷️ Outright Purchase',
          body: `${tx.ref}: ${tx.fullName} — ${[tx.aiBrand, tx.aiModel].filter(Boolean).join(' ')} — ₦${fmtN(tx.cashAdvance)}`,
          url: '/transactions',
          tag: 'new-transaction',
        });
      } else {
        await pushNotifyAll(env, db, {
          title: '📋 New Loan',
          body: `${tx.ref}: ${tx.fullName} — ₦${fmtN(tx.cashAdvance)} advance`,
          url: '/transactions',
          tag: 'new-transaction',
        });
      }

      return json({ success: true });
    }
    if (path.startsWith('transactions/') && method === 'PUT') {
      const auth = requireAuth(request);
      if (auth.error) return auth.error;
      const ref = decodeURIComponent(path.split('/')[1]);
      const tx = await request.json();
      const [existing, loanCfg] = await Promise.all([
        db.prepare('SELECT status, data FROM transactions WHERE ref = ?').bind(ref).first(),
        loadLoanConfig(db)
      ]);
      const existingData = existing?.data ? JSON.parse(existing.data) : null;

      // Only an admin may confirm a sale flagged as below the minimum price —
      // the frontend already gates this, but a direct API call must not bypass it.
      if (tx.status === 'sold' && tx.belowMinimumOverride && auth.user.role !== 'admin') {
        return error('Only an admin can confirm a sale below the minimum price.', 403);
      }

      if (tx.status === 'for_sale' && !tx.listedForSaleDate) {
        tx.listedForSaleDate = existingData?.listedForSaleDate
          || (existing?.status === 'for_sale' ? new Date().toISOString() : null)
          || new Date().toISOString();
      }

      // Prevent marking an advance loan for sale before sale_allowed_date.
      // Exception: voluntarily surrendered items can be listed at any time.
      // Surrender is confirmed only when surrenderDate is recorded in the stored data
      // or in the incoming payload — not merely by current status, which could be set
      // directly via the API without going through the surrender flow.
      if (tx.status === 'for_sale' && tx.type !== 'outright') {
        const isVoluntarySurrender = !!(tx.surrenderDate || existingData?.surrenderDate);
        if (!isVoluntarySurrender) {
          const timeline = computeLoanTimeline(tx, loanCfg);
          if (timeline && timeline.sale_allowed_date) {
            const today = todayNigeria();
            if (today < timeline.sale_allowed_date) {
              return error(`Cannot list for sale before ${timeline.sale_allowed_date} (sale allowed from day ${loanCfg.maxLoanDays + loanCfg.graceDays + 1} onwards; business ownership begins at day ${loanCfg.maxLoanDays})`, 422);
            }
          }
        }
      }

      // Validate repayment fees — recompute server-side to prevent tampered submissions.
      // cashAdvance is read from the stored record, not the incoming payload, so it
      // cannot be downward-manipulated to reduce the expected fee.
      // appliedInterestRate is locked in at loan creation; fall back to current config for old records.
      //
      // Expected fees are computed via computeLoanPayment (forcing a full-payoff outcome
      // with an unlimited payment amount) rather than a flat daysCharged*dailyFee formula,
      // so an item that already had partial interest payments recorded through the payment
      // endpoint gets proper credit instead of being double-charged at redemption.
      if (tx.type === 'advance' && (tx.status === 'closed' || tx.status === 'active')) {
        const appliedRate = Number(existingData?.appliedInterestRate || loanCfg.interestRate);

        if (Array.isArray(tx.items) && tx.items.length > 0) {
          // Multi-item: validate each newly-redeemed item's fees independently.
          const existingItems = Array.isArray(existingData?.items) ? existingData.items : [];
          for (let i = 0; i < tx.items.length; i++) {
            const item = tx.items[i];
            const prevItem = existingItems[i];
            // Only validate items that are newly redeemed in this update
            if (!item.redeemed || prevItem?.redeemed) continue;
            const itemAdvance = getItemCashAdvance(existingData || tx, prevItem ?? item);
            const redeemDate = item.dateRedeemed || todayNigeria();
            const itemBalance = {
              cashAdvance: itemAdvance,
              appliedInterestRate: appliedRate,
              cycleStart: prevItem?.cycleStart || existingData?.dateGiven || tx.dateGiven,
              principalSince: prevItem?.principalSince || prevItem?.cycleStart || existingData?.dateGiven || tx.dateGiven,
              // The company's max loan tenure policy — NOT the customer's own agreed
              // return date (item.loanDays/tx.loanDays), which is a softer,
              // customer-facing target used only for overdue reminders elsewhere.
              loanDays: loanCfg.maxLoanDays,
              carriedInterestOwed: Number(prevItem?.carriedInterestOwed) || 0,
            };
            const check = computeLoanPayment(itemBalance, { amount: Number.MAX_SAFE_INTEGER, date: redeemDate }, loanCfg.graceDays);
            const expectedItemFees = check.error ? 0 : Math.round(check.interestApplied);
            if (Number(item.feesCharged) !== expectedItemFees) {
              const label = item.aiItemType || item.captureItemType || `Item ${i + 1}`;
              return error(
                `Fee mismatch for "${label}": submitted ₦${item.feesCharged} but expected ₦${expectedItemFees}` +
                ` (₦${itemAdvance} advance at ${appliedRate}%/day, redeemed ${redeemDate})`,
                422
              );
            }
          }
          // For full closure, also validate the aggregate totalFees on the transaction
          if (tx.status === 'closed') {
            const expectedAggregateFees = tx.items.reduce((s, item) => s + (Number(item.feesCharged) || 0), 0);
            if (Number(tx.totalFees) !== expectedAggregateFees) {
              return error(
                `Aggregate fee mismatch: submitted ₦${tx.totalFees} but sum of item fees is ₦${expectedAggregateFees}`,
                422
              );
            }
          }
        } else if (tx.status === 'closed') {
          // Legacy single-item path (no items[] on the stored record)
          const cashAdvance = Number(existingData?.cashAdvance || 0);
          const redeemDate = tx.dateRepaid || todayNigeria();
          const legacyBalance = {
            cashAdvance,
            appliedInterestRate: appliedRate,
            cycleStart: existingData?.cycleStart || existingData?.dateGiven || tx.dateGiven,
            principalSince: existingData?.principalSince || existingData?.cycleStart || existingData?.dateGiven || tx.dateGiven,
            // Company max loan tenure policy, not the customer's own agreed return date.
            loanDays: loanCfg.maxLoanDays,
            carriedInterestOwed: Number(existingData?.carriedInterestOwed) || 0,
          };
          const check = computeLoanPayment(legacyBalance, { amount: Number.MAX_SAFE_INTEGER, date: redeemDate }, loanCfg.graceDays);
          const expectedTotalFees = check.error ? 0 : Math.round(check.interestApplied);
          if (Number(tx.totalFees) !== expectedTotalFees) {
            return error(
              `Fee mismatch: submitted ₦${tx.totalFees} but expected ₦${expectedTotalFees}` +
              ` (₦${cashAdvance} advance at ${appliedRate}%/day, redeemed ${redeemDate})`,
              422
            );
          }
        }
      }

      // Auto-assign a shop item ref (shopId) when an item first becomes ready to sell,
      // is listed for sale, or is sold directly while eligible — so {shopRef} is always
      // available in SMS templates regardless of which path was taken.
      if ((tx.status === 'ready_to_sell' || tx.status === 'for_sale' || tx.status === 'sold') && !tx.shopId) {
        tx.shopId = 'SHP-' + 'ABCDEFGHJKLMNPQRSTUVWXYZ'[Math.floor(Math.random() * 24)] + String(Math.floor(Math.random() * 10000)).padStart(4, '0');
      }

      await db
        .prepare("UPDATE transactions SET data = ?, status = ?, updated_at = datetime('now') WHERE ref = ?")
        .bind(JSON.stringify(tx), tx.status || 'active', ref)
        .run();
      const fmtNP = (n) => Number(n || 0).toLocaleString('en-NG');
      let putAction, putDesc;
      if (tx.status === 'closed') {
        const itemCount = Array.isArray(tx.items) ? tx.items.length : 1;
        putAction = 'repaid'; putDesc = `✅ Loan repaid — ${ref}: ${tx.fullName} (${itemCount} item${itemCount !== 1 ? 's' : ''}) — ₦${fmtNP(tx.totalFees)} interest collected over ${tx.daysCharged || 0} days`;
      } else if (tx.status === 'sold') {
        const profit = (tx.salePrice || 0) - (tx.cashAdvance || 0);
        putAction = 'sold'; putDesc = `💰 Item sold — ${ref}: ${[tx.aiBrand, tx.aiModel].filter(Boolean).join(' ')} — sold for ₦${fmtNP(tx.salePrice)} (profit ₦${fmtNP(profit)})${tx.saleCondition ? ` — Condition: ${tx.saleCondition}` : ''}` +
          (tx.belowMinimumOverride ? ` ⚠ BELOW MINIMUM PRICE — approved by ${tx.belowMinimumApprovedBy || 'admin'}: "${tx.belowMinimumReason || ''}"` : '');
      } else if (tx.status === 'for_sale') {
        putAction = 'update'; putDesc = `🏷 Marked for sale — ${ref}: ${[tx.aiBrand, tx.aiModel].filter(Boolean).join(' ')}`;
      } else if (tx.status === 'active' && tx.type === 'advance' && Array.isArray(tx.items)) {
        // Check if this update includes a partial redemption
        const existingItems = Array.isArray(existingData?.items) ? existingData.items : [];
        const newlyRedeemed = tx.items.filter((item, i) => item.redeemed && !existingItems[i]?.redeemed);
        if (newlyRedeemed.length > 0) {
          const remaining = tx.items.filter(i => !i.redeemed).length;
          putAction = 'partial_redemption';
          putDesc = `🔄 Partial redemption — ${ref}: ${tx.fullName} — ${newlyRedeemed.length} item${newlyRedeemed.length !== 1 ? 's' : ''} redeemed, ${remaining} remaining`;
        } else {
          putAction = 'update'; putDesc = `🔄 Transaction updated — ${ref}`;
        }
      } else {
        putAction = 'update'; putDesc = `🔄 Transaction updated — ${ref}`;
      }
      await logActivity({ user: auth.user, action: putAction, entityType: 'transaction', entityId: ref, description: putDesc });

      // ── Award staff points for transaction PUT actions ──
      try {
        const entityRef = 'tx:' + ref;
        const putStepKey = putAction === 'repaid' || putAction === 'partial_redemption'
          ? 'repayment_collection'
          : putAction === 'sold'
            ? 'sale_completion'
            : (tx.status === 'for_sale' || tx.status === 'ready_to_sell')
              ? 'default_handling_listing'
              : null;
        if (putStepKey) {
          await awardStepPoints(entityRef, [{ userId: auth.user.id, stepKey: putStepKey }]);
        }
      } catch (e) {
        console.error('[staff_points PUT transactions] failed:', e?.message ?? e);
      }

      // ── Redemption/full repayment confirmation SMS ──
      // Sent immediately when a customer repays in full and collects their item.
      // Transition guard: only fire on the active→closed transition so that re-saving
      // an already-closed transaction on a different day does not resend the SMS.
      if (tx.status === 'closed' && tx.type === 'advance' && existing?.status !== 'closed') {
        try {
          const smsCfg = await loadSmsConfig();
          if (smsCfg.enabled && smsCfg.redemptionConfirmationEnabled) {
            const rawPhone = (tx.phoneNumbers && tx.phoneNumbers[0]) || tx.phone || '';
            const phone = toIntlPhone(rawPhone);
            const rawPhone2 = tx.phoneNumbers?.[1] || '';
            const phone2 = rawPhone2 && rawPhone2 !== rawPhone ? toIntlPhone(rawPhone2) : null;
            if (!phone) {
              await db.prepare(
                "INSERT INTO sms_logs (transaction_ref, trigger_type, message, recipient, status, termii_response) VALUES (?, 'redemption_confirmation', '', '', 'skipped', ?)"
              ).bind(ref, JSON.stringify({ reason: 'no_phone_number' })).run().catch(() => {});
            } else {
              const triggerType = 'redemption_confirmation';
              const todayClosed = todayNigeria();
              const alreadySent = await db.prepare(
                "SELECT id FROM sms_logs WHERE transaction_ref = ? AND trigger_type = ? AND date(sent_at, '+1 hour') = ?"
              ).bind(ref, triggerType, todayClosed).first();
              if (!alreadySent) {
                const fmtSms = (n) => '₦' + Number(n || 0).toLocaleString('en-NG');
                const message = fillSmsTemplate(smsCfg.tmplRedemptionConfirmation, {
                  customerName: tx.fullName,
                  ref,
                  amount: fmtSms(tx.amountRepaid || tx.cashAdvance),
                  dueDate: tx.deadlineDate || '',
                  businessName: smsCfg.businessName,
                  shopPhone: smsCfg.shopPhone,
                });
                const { ok, messageId, response } = await termiiSend(smsCfg, phone, message);
                await insertSmsLog({
                  transactionRef: ref,
                  triggerType,
                  message,
                  recipient: phone,
                  status: ok ? 'sent' : 'failed',
                  termiiResponse: JSON.stringify(response),
                  messageId,
                });
                if (phone2) {
                  const { ok: ok2, messageId: messageId2, response: response2 } = await termiiSend(smsCfg, phone2, message);
                  await insertSmsLog({
                    transactionRef: ref,
                    triggerType: triggerType + '_phone2',
                    message,
                    recipient: phone2,
                    status: ok2 ? 'sent' : 'failed',
                    termiiResponse: JSON.stringify(response2),
                    messageId: messageId2,
                  });
                }
              }
            }
          }
        } catch (_smsErr) {
          // SMS failure must never block the transaction save
          await logSmsRuntimeError({ user: auth.user, transactionRef: ref, triggerType: 'redemption_confirmation', err: _smsErr });
        }
      }

      // ── Item listed for sale SMS ──
      // Sent when an advance loan item is listed for public sale for the first time.
      // Not sent for outright transactions (they already get outright_confirmation).
      if (tx.status === 'for_sale' && tx.type === 'advance' && existing?.status !== 'for_sale') {
        try {
          const smsCfg = await loadSmsConfig();
          if (smsCfg.enabled && smsCfg.listedForSaleEnabled) {
            const rawPhone = (tx.phoneNumbers && tx.phoneNumbers[0]) || tx.phone || '';
            const phone = toIntlPhone(rawPhone);
            const rawPhone2 = tx.phoneNumbers?.[1] || '';
            const phone2 = rawPhone2 && rawPhone2 !== rawPhone ? toIntlPhone(rawPhone2) : null;
            if (!phone) {
              await db.prepare(
                "INSERT INTO sms_logs (transaction_ref, trigger_type, message, recipient, status, termii_response) VALUES (?, 'listed_for_sale', '', '', 'skipped', ?)"
              ).bind(ref, JSON.stringify({ reason: 'no_phone_number' })).run().catch(() => {});
            } else {
              const triggerType = 'listed_for_sale';
              const todayListed = todayNigeria();
              const alreadySent = await db.prepare(
                "SELECT id FROM sms_logs WHERE transaction_ref = ? AND trigger_type = ? AND date(sent_at, '+1 hour') = ?"
              ).bind(ref, triggerType, todayListed).first();
              if (!alreadySent) {
                const fmtSms = (n) => '₦' + Number(n || 0).toLocaleString('en-NG');
                const message = fillSmsTemplate(smsCfg.tmplListedForSale, {
                  customerName: tx.fullName,
                  ref,
                  amount: fmtSms(tx.cashAdvance),
                  dueDate: tx.deadlineDate || '',
                  businessName: smsCfg.businessName,
                  shopPhone: smsCfg.shopPhone,
                });
                const { ok, messageId, response } = await termiiSend(smsCfg, phone, message);
                await insertSmsLog({
                  transactionRef: ref,
                  triggerType,
                  message,
                  recipient: phone,
                  status: ok ? 'sent' : 'failed',
                  termiiResponse: JSON.stringify(response),
                  messageId,
                });
                if (phone2) {
                  const { ok: ok2, messageId: messageId2, response: response2 } = await termiiSend(smsCfg, phone2, message);
                  await insertSmsLog({
                    transactionRef: ref,
                    triggerType: triggerType + '_phone2',
                    message,
                    recipient: phone2,
                    status: ok2 ? 'sent' : 'failed',
                    termiiResponse: JSON.stringify(response2),
                    messageId: messageId2,
                  });
                }
              }
            }
          }
        } catch (_smsErr) {
          // SMS failure must never block the transaction save
          await logSmsRuntimeError({ user: auth.user, transactionRef: ref, triggerType: 'listed_for_sale', err: _smsErr });
        }
      }

      // ── Sale confirmation SMS (receipt to the buyer) ──
      // Sent immediately when an item is marked as sold — goes to the new buyer's
      // phone (saleBuyerPhone) as a purchase receipt, not the original customer.
      // Transition guard: only fire on the active/for_sale→sold transition so that
      // re-saving an already-sold transaction does not resend the buyer receipt.
      if (tx.status === 'sold' && existing?.status !== 'sold') {
        try {
          const smsCfg = await loadSmsConfig();
          if (smsCfg.enabled && smsCfg.saleConfirmationEnabled) {
            const rawPhone = tx.saleBuyerPhone || '';
            const phone = toIntlPhone(rawPhone);
            if (!phone) {
              await db.prepare(
                "INSERT INTO sms_logs (transaction_ref, trigger_type, message, recipient, status, termii_response) VALUES (?, 'sale_confirmation', '', '', 'skipped', ?)"
              ).bind(ref, JSON.stringify({ reason: 'no_buyer_phone' })).run().catch(() => {});
            } else {
              const triggerType = 'sale_confirmation';
              const todaySold = todayNigeria();
              const alreadySent = await db.prepare(
                "SELECT id FROM sms_logs WHERE transaction_ref = ? AND trigger_type = ? AND date(sent_at, '+1 hour') = ?"
              ).bind(ref, triggerType, todaySold).first();
              if (!alreadySent) {
                const fmtSms = (n) => '₦' + Number(n || 0).toLocaleString('en-NG');
                const itemDesc = [tx.aiBrand, tx.aiModel].filter(Boolean).join(' ') || tx.aiItemType || 'item';
                // shopId is always set before 'sold' because items pass through for_sale/ready_to_sell first;
                // the ref fallback is purely defensive for legacy records without a shopId.
                const message = fillSmsTemplate(smsCfg.tmplSaleConfirmation, {
                  buyerName: tx.saleBuyer || '',
                  ref,
                  shopRef: tx.shopId || ref,
                  amount: fmtSms(tx.salePrice),
                  itemDesc,
                  businessName: smsCfg.businessName,
                  shopPhone: smsCfg.shopPhone,
                });
                const { ok, messageId, response } = await termiiSend(smsCfg, phone, message);
                await insertSmsLog({
                  transactionRef: ref,
                  triggerType,
                  message,
                  recipient: phone,
                  status: ok ? 'sent' : 'failed',
                  termiiResponse: JSON.stringify(response),
                  messageId,
                });
              }
            }
          }
        } catch (_smsErr) {
          // SMS failure must never block the transaction save
          await logSmsRuntimeError({ user: auth.user, transactionRef: ref, triggerType: 'sale_confirmation', err: _smsErr });
        }
      }

      // ── Push notifications for significant status changes ──
      // Keep this after transactional SMS so free-plan subrequest limits
      // don't starve customer-facing SMS sends when many devices are subscribed.
      if (tx.status === 'closed' && existing?.status !== 'closed') {
        await pushNotifyAll(env, db, {
          title: '✅ Loan Redeemed',
          body: `${ref}: ${tx.fullName} — ₦${fmtNP(tx.totalFees)} over ${tx.daysCharged || 0} days`,
          url: '/transactions',
          tag: 'loan-redeemed',
        });
      } else if (tx.status === 'sold' && existing?.status !== 'sold') {
        await pushNotifyAll(env, db, {
          title: '💰 Item Sold',
          body: `${ref}: ${[tx.aiBrand, tx.aiModel].filter(Boolean).join(' ')} — ₦${fmtNP(tx.salePrice)}`,
          url: '/transactions',
          tag: 'item-sold',
        });
      }

      return json({ success: true });
    }
    // ============================================================
    // POST /api/transactions/:ref/payment — record a flexible partial (or full)
    // loan payment. Authoritative: the client sends only { amount, date, method,
    // note, itemIndex? } — every financial field is recomputed here from the
    // stored record so nothing can be tampered with client-side.
    // ============================================================
    if (/^transactions\/[^/]+\/payment$/.test(path) && method === 'POST') {
      const auth = requireAuth(request);
      if (auth.error) return auth.error;
      const ref = decodeURIComponent(path.split('/')[1]);
      const body = await request.json();
      const amountNum = Number(body.amount);
      const date = body.date;
      const paymentMethod = (body.method || '').trim();
      const note = (body.note || '').trim();
      const itemIndex = Number.isInteger(body.itemIndex) ? body.itemIndex : null;
      const combined = body.itemIndex === 'combined';

      if (!(amountNum > 0)) return error('Payment amount must be greater than zero.', 400);
      if (!date) return error('Payment date is required.', 400);
      const today = todayNigeria();
      if (date > today) return error('Payment date cannot be in the future.', 400);

      const existing = await db.prepare('SELECT status, data FROM transactions WHERE ref = ?').bind(ref).first();
      if (!existing) return error('Transaction not found.', 404);
      const tx = existing.data ? JSON.parse(existing.data) : null;
      if (!tx) return error('Transaction data is corrupt.', 500);
      if (tx.type !== 'advance') return error('Only cash-advance loans support payments.', 400);
      if (!['active', 'for_sale', 'ready_to_sell'].includes(tx.status)) {
        return error(`Cannot record a payment on a loan with status "${tx.status}".`, 400);
      }

      const loanCfg = await loadLoanConfig(db);
      const appliedRate = Number(tx.appliedInterestRate || loanCfg.interestRate);
      const hasItems = Array.isArray(tx.items) && tx.items.length > 0;
      const fmtNP = (n) => Number(n || 0).toLocaleString('en-NG');

      // ============================================================
      // COMBINED PAYMENT — staff can choose to treat every unredeemed item on a
      // multi-item loan as a single loan and apply one payment across all of them.
      // Amount waterfalls in soonest-deadline-first order (same default order the
      // single-item picker uses): each item is offered the remaining amount via
      // the normal computeLoanPayment engine; a full payoff on an item carries its
      // overpayment forward to the next item, a partial payment exhausts the
      // remaining amount and stops. Each touched item gets its own payment ledger
      // entry (with its own sub-amount/principal/interest split) so per-item
      // history and getItemCashAdvance stay accurate — only how the incoming cash
      // gets allocated differs from a single-item payment.
      // ============================================================
      if (combined && hasItems) {
        const unredeemed = tx.items
          .map((it, i) => ({ it, i }))
          .filter(({ it }) => !it.redeemed)
          .sort((a, b) => (a.it.deadlineDate || tx.deadlineDate || '').localeCompare(b.it.deadlineDate || tx.deadlineDate || ''));
        if (unredeemed.length === 0) return error('All items on this loan are already redeemed.', 400);

        for (const { it } of unredeemed) {
          const principalSince = it.principalSince || it.cycleStart || tx.dateGiven;
          if (date < principalSince) {
            const label = it.aiItemType ? `${it.aiItemType}${it.aiBrand ? ' — ' + it.aiBrand : ''}` : (it.captureItemType || 'an item');
            return error(`Payment date cannot be before ${principalSince} (the start of the current cycle or the last recorded payment for ${label}).`, 400);
          }
        }

        const labelOf = (it, i) => it.aiItemType ? `${it.aiItemType}${it.aiBrand ? ' — ' + it.aiBrand : ''}` : (it.captureItemType || `Item ${i + 1}`);
        const mkBalance = (it) => ({
          cashAdvance: getItemCashAdvance(tx, it),
          appliedInterestRate: appliedRate,
          cycleStart: it.cycleStart || tx.dateGiven,
          principalSince: it.principalSince || it.cycleStart || tx.dateGiven,
          loanDays: loanCfg.maxLoanDays,
          carriedInterestOwed: Number(it.carriedInterestOwed) || 0,
          deadlineDate: it.deadlineDate || tx.deadlineDate,
        });

        // Past the company's max tenure, the payment engine settles interest before
        // principal on a SINGLE loan (see computeLoanPayment's bucket logic). Combining
        // several items into one payment must honor the same policy across the whole
        // basket — not just within whichever item happens to be processed first.
        //
        // Whether the BASKET is overdue is decided ONCE, from the earliest-deadline
        // unredeemed item's cycleStart (tx.cycleStart, kept in sync by
        // mirrorTopLevelFromItems — the same anchor getLoanTimeline/effectiveElapsedDays
        // use elsewhere). It is NOT decided per item: an item can look "fresh" on its
        // own (it rolled over recently after an earlier interest-only payment cleared
        // its own small balance) while the loan as a whole is still badly overdue on
        // its other items — that item must not jump the queue for principal just
        // because its own post-rollover clock resets to day 0. So when the basket is
        // overdue, pass 1 force-clears interest on EVERY item that owes any (via
        // forceBucket, bypassing what would otherwise be that item's own fresh-cycle
        // "principal first" bucket) before pass 2 lets anything reach principal.
        let remaining = amountNum;
        const updatedItems = [...tx.items];
        let totalPrincipalApplied = 0, totalInterestApplied = 0;
        const interestNotes = [], principalNotes = [];

        const overallAnchor = tx.cycleStart || tx.dateGiven;
        const overallOverdue = daysBetweenDates(overallAnchor, date) >= loanCfg.maxLoanDays;

        const states = unredeemed.map(({ it, i }) => {
          const balance = mkBalance(it);
          const full = computeLoanPayment(balance, { amount: Number.MAX_SAFE_INTEGER, date }, loanCfg.graceDays);
          const interestOwed = full.error ? 0 : full.interestOwedBefore;
          return { it, i, balance, interestOwed, owesAnything: !full.error, interestCleared: interestOwed <= 0 };
        }).filter(s => s.owesAnything);

        // Pass 1 — clear interest on every item, in order, before any principal moves.
        for (const s of states) {
          if (!overallOverdue || remaining <= 0 || s.interestOwed <= 0) continue;
          const pay = Math.min(remaining, s.interestOwed);
          const r = computeLoanPayment(s.balance, { amount: pay, date }, loanCfg.graceDays, { forceBucket: 'interest_first' });
          if (r.error) continue;
          // A zero-principal item (fully paid down previously, only interest left
          // outstanding) can hit full_payoff here since pay may equal its entire
          // remaining balance — that response shape has no newCarriedInterestOwed/etc.,
          // so redeem it directly instead of falling through to the partial-shaped update.
          if (r.outcome === 'full_payoff') {
            const it = updatedItems[s.i];
            const entry = {
              date, amount: r.principalApplied + r.interestApplied, method: paymentMethod,
              note: note ? `${note} (combined payment across ${unredeemed.length} items)` : `Part of a combined payment of ₦${fmtNP(amountNum)} across ${unredeemed.length} items`,
              principalApplied: r.principalApplied, interestApplied: r.interestApplied, outcome: 'full_payoff',
              rolledOver: false, recordedBy: auth.user.name || auth.user.username, recordedAt: new Date().toISOString(),
            };
            updatedItems[s.i] = { ...it, redeemed: true, dateRedeemed: date, repaidBy: auth.user.name, amountPaid: (it.payments || []).reduce((sum, p) => sum + (p.principalApplied || 0) + (p.interestApplied || 0), 0) + r.principalApplied + r.interestApplied, daysCharged: r.dayOfCycle, feesCharged: (it.payments || []).reduce((sum, p) => sum + (p.interestApplied || 0), 0) + r.interestApplied, payments: [...(it.payments || []), entry] };
            totalInterestApplied += r.interestApplied;
            totalPrincipalApplied += r.principalApplied;
            remaining = r.overpayment || 0;
            interestNotes.push(`${labelOf(s.it, s.i)} fully redeemed (₦${fmtNP(r.principalApplied)} principal + ₦${fmtNP(r.interestApplied)} interest)`);
            continue;
          }
          s.balance = { ...s.balance, carriedInterestOwed: r.newCarriedInterestOwed, principalSince: r.newPrincipalSince, cycleStart: r.newCycleStart, deadlineDate: r.newDeadlineDate || s.balance.deadlineDate };
          s.interestCleared = r.newCarriedInterestOwed <= 0;
          const entry = {
            date, amount: r.interestApplied, method: paymentMethod,
            note: note ? `${note} (interest portion of a combined payment across ${unredeemed.length} items)` : `Interest portion of a combined payment of ₦${fmtNP(amountNum)} across ${unredeemed.length} items`,
            principalApplied: 0, interestApplied: r.interestApplied, outcome: 'partial',
            rolledOver: !!r.rolledOver, recordedBy: auth.user.name || auth.user.username, recordedAt: new Date().toISOString(),
          };
          updatedItems[s.i] = { ...updatedItems[s.i], carriedInterestOwed: r.newCarriedInterestOwed, principalSince: r.newPrincipalSince, cycleStart: r.newCycleStart, deadlineDate: r.newDeadlineDate || updatedItems[s.i].deadlineDate || tx.deadlineDate, payments: [...(updatedItems[s.i].payments || []), entry] };
          totalInterestApplied += r.interestApplied;
          remaining -= r.interestApplied;
          interestNotes.push(`${labelOf(s.it, s.i)}: ₦${fmtNP(r.interestApplied)} interest cleared${r.rolledOver ? ` — renewed, new deadline ${r.newDeadlineDate}` : r.newDeadlineDate ? ` — deadline extended to ${r.newDeadlineDate} (₦${fmtNP(s.interestOwed - r.interestApplied)} interest still owed beyond that)` : ` (₦${fmtNP(s.interestOwed - r.interestApplied)} interest still owed)`}`);
        }

        // Pass 2 — apply whatever remains to principal, in order. If the basket is
        // overdue, items whose interest wasn't fully cleared above are skipped (still
        // waiting on interest); if the basket isn't overdue, every item goes through
        // its own normal principal-then-interest single-call flow, unaffected by pass 1
        // (which never ran).
        for (const s of states) {
          if (remaining <= 0) break;
          if (updatedItems[s.i].redeemed) continue;
          if (overallOverdue && !s.interestCleared) continue;
          const r = computeLoanPayment(s.balance, { amount: remaining, date }, loanCfg.graceDays);
          if (r.error) continue;
          const subAmount = r.outcome === 'full_payoff' ? (r.principalApplied + r.interestApplied) : remaining;
          const entry = {
            date, amount: subAmount, method: paymentMethod,
            note: note ? `${note} (principal portion of a combined payment across ${unredeemed.length} items)` : `Principal portion of a combined payment of ₦${fmtNP(amountNum)} across ${unredeemed.length} items`,
            principalApplied: r.principalApplied, interestApplied: r.interestApplied, outcome: r.outcome,
            rolledOver: !!r.rolledOver, recordedBy: auth.user.name || auth.user.username, recordedAt: new Date().toISOString(),
          };
          if (r.outcome === 'full_payoff') {
            const it = updatedItems[s.i];
            updatedItems[s.i] = { ...it, redeemed: true, dateRedeemed: date, repaidBy: auth.user.name, amountPaid: (it.payments || []).reduce((sum, p) => sum + (p.principalApplied || 0) + (p.interestApplied || 0), 0) + r.principalApplied + r.interestApplied, daysCharged: r.dayOfCycle, feesCharged: (it.payments || []).reduce((sum, p) => sum + (p.interestApplied || 0), 0) + r.interestApplied, payments: [...(it.payments || []), entry] };
            remaining = r.overpayment || 0;
            principalNotes.push(`${labelOf(s.it, s.i)} fully redeemed (₦${fmtNP(r.principalApplied)} principal + ₦${fmtNP(r.interestApplied)} interest)`);
          } else {
            updatedItems[s.i] = { ...updatedItems[s.i], itemCashAdvance: r.newCashAdvance, carriedInterestOwed: r.newCarriedInterestOwed, principalSince: r.newPrincipalSince, cycleStart: r.newCycleStart, deadlineDate: r.newDeadlineDate || updatedItems[s.i].deadlineDate || tx.deadlineDate, payments: [...(updatedItems[s.i].payments || []), entry] };
            remaining = 0;
            principalNotes.push(`${labelOf(s.it, s.i)}: ₦${fmtNP(r.principalApplied)} to principal${r.rolledOver ? ' — renewed' : ''}`);
          }
          totalPrincipalApplied += r.principalApplied;
          totalInterestApplied += r.interestApplied;
        }

        const perItemNotes = [...interestNotes, ...principalNotes];
        const totalOverpayment = remaining > 0 ? remaining : 0;
        tx.items = updatedItems;
        const allRedeemed = updatedItems.every(it => it.redeemed);
        const wasRescued = tx.status === 'for_sale' || tx.status === 'ready_to_sell';
        if (allRedeemed) {
          tx.status = 'closed';
          tx.amountRepaid = updatedItems.reduce((s, it) => s + (it.amountPaid || 0), 0);
          tx.dateRepaid = date;
          tx.daysCharged = Math.max(...updatedItems.map(it => it.daysCharged || 0));
          tx.totalFees = updatedItems.reduce((s, it) => s + (it.feesCharged || 0), 0);
          tx.itemReturned = true;
          tx.repaidBy = auth.user.name;
        } else {
          const unredeemedNow = updatedItems.filter(it => !it.redeemed);
          const earliest = unredeemedNow.reduce((best, it) => {
            const dl = it.deadlineDate || tx.deadlineDate || '';
            const bestDl = best ? (best.deadlineDate || tx.deadlineDate || '') : null;
            return (!best || dl < bestDl) ? it : best;
          }, null);
          if (earliest) {
            tx.cycleStart = earliest.cycleStart || tx.dateGiven;
            tx.principalSince = earliest.principalSince || earliest.cycleStart || tx.dateGiven;
            tx.deadlineDate = earliest.deadlineDate || tx.deadlineDate;
          }
          if (wasRescued) tx.status = 'active';
        }

        const breakdown = `Combined payment of ₦${fmtNP(amountNum)} applied across ${unredeemed.length} item(s): ${perItemNotes.join('; ')}.` +
          (allRedeemed ? ' All items now redeemed — loan closed.' : '') +
          (totalOverpayment > 0 ? ` ⚠ Overpayment of ₦${fmtNP(totalOverpayment)} — confirm with the customer.` : '');
        const result = { outcome: allRedeemed ? 'full_payoff' : 'partial', principalApplied: totalPrincipalApplied, interestApplied: totalInterestApplied, overpayment: totalOverpayment };

        await db
          .prepare("UPDATE transactions SET data = ?, status = ?, updated_at = datetime('now') WHERE ref = ?")
          .bind(JSON.stringify(tx), tx.status || 'active', ref)
          .run();

        const actionLabel = result.outcome === 'full_payoff' ? 'repaid' : 'loan_payment';
        await logActivity({
          user: auth.user, action: actionLabel, entityType: 'transaction', entityId: ref,
          description: `💵 Combined payment recorded — ${ref}: ${tx.fullName} paid ₦${fmtNP(amountNum)} on ${date}. ${breakdown}`,
        });

        try {
          await awardStepPoints('tx:' + ref, [{ userId: auth.user.id, stepKey: 'repayment_collection' }]);
        } catch (e) {
          console.error('[staff_points payment] failed:', e?.message ?? e);
        }

        try {
          const smsCfg = await loadSmsConfig();
          if (smsCfg.enabled) {
            const rawPhone = (tx.phoneNumbers && tx.phoneNumbers[0]) || tx.phone || '';
            const phone = toIntlPhone(rawPhone);
            if (phone) {
              const fmtSms = (n) => '₦' + Number(n || 0).toLocaleString('en-NG');
              if (result.outcome === 'full_payoff' && smsCfg.redemptionConfirmationEnabled) {
                const message = fillSmsTemplate(smsCfg.tmplRedemptionConfirmation, {
                  customerName: tx.fullName, ref, amount: fmtSms(amountNum), dueDate: tx.deadlineDate || '',
                  businessName: smsCfg.businessName, shopPhone: smsCfg.shopPhone,
                });
                const { ok, messageId, response } = await termiiSend(smsCfg, phone, message);
                await insertSmsLog({ transactionRef: ref, triggerType: 'redemption_confirmation', message, recipient: phone, status: ok ? 'sent' : 'failed', termiiResponse: JSON.stringify(response), messageId });
              } else if (result.outcome !== 'full_payoff' && smsCfg.loanPaymentConfirmationEnabled) {
                const message = fillSmsTemplate(smsCfg.tmplLoanPayment, {
                  customerName: tx.fullName, ref, amount: fmtSms(amountNum), breakdown,
                  businessName: smsCfg.businessName, shopPhone: smsCfg.shopPhone,
                });
                const { ok, messageId, response } = await termiiSend(smsCfg, phone, message);
                await insertSmsLog({ transactionRef: ref, triggerType: 'loan_payment', message, recipient: phone, status: ok ? 'sent' : 'failed', termiiResponse: JSON.stringify(response), messageId });
              }
            }
          }
        } catch (_smsErr) {
          await logSmsRuntimeError({ user: auth.user, transactionRef: ref, triggerType: 'loan_payment', err: _smsErr });
        }

        await pushNotifyAll(env, db, {
          title: result.outcome === 'full_payoff' ? '✅ Loan Redeemed' : '💵 Loan Payment Recorded',
          body: `${ref}: ${tx.fullName} paid ₦${fmtNP(amountNum)}`,
          url: '/transactions',
          tag: 'loan-payment',
        });

        return json({ success: true, outcome: result.outcome, breakdown, combined: true, perItemBreakdown: perItemNotes, result });
      }

      let targetIdx = -1, targetItem = null;
      if (hasItems) {
        if (itemIndex !== null && tx.items[itemIndex] && !tx.items[itemIndex].redeemed) {
          targetIdx = itemIndex;
        } else {
          // Default selection: the unredeemed item whose current deadline is soonest.
          let best = null;
          tx.items.forEach((it, i) => {
            if (it.redeemed) return;
            const dl = it.deadlineDate || tx.deadlineDate || '';
            if (!best || dl < best.dl) best = { i, dl };
          });
          if (!best) return error('All items on this loan are already redeemed.', 400);
          targetIdx = best.i;
        }
        targetItem = tx.items[targetIdx];
      }

      const balance = hasItems
        ? {
            cashAdvance: getItemCashAdvance(tx, targetItem),
            appliedInterestRate: appliedRate,
            cycleStart: targetItem.cycleStart || tx.dateGiven,
            principalSince: targetItem.principalSince || targetItem.cycleStart || tx.dateGiven,
            // Company max loan tenure policy, not the customer's own agreed return date.
            loanDays: loanCfg.maxLoanDays,
            carriedInterestOwed: Number(targetItem.carriedInterestOwed) || 0,
            deadlineDate: targetItem.deadlineDate || tx.deadlineDate,
          }
        : {
            cashAdvance: Number(tx.cashAdvance) || 0,
            appliedInterestRate: appliedRate,
            cycleStart: tx.cycleStart || tx.dateGiven,
            principalSince: tx.principalSince || tx.cycleStart || tx.dateGiven,
            loanDays: loanCfg.maxLoanDays,
            carriedInterestOwed: Number(tx.carriedInterestOwed) || 0,
            deadlineDate: tx.deadlineDate,
          };

      // No backdating before the last accrual checkpoint — principalSince already
      // equals the most recent payment's date (or cycleStart/dateGiven if no
      // payment has been made yet), so this alone is the correct lower bound.
      if (date < balance.principalSince) {
        return error(`Payment date cannot be before ${balance.principalSince} (the start of the current cycle or the last recorded payment).`, 400);
      }

      const result = computeLoanPayment(balance, { amount: amountNum, date }, loanCfg.graceDays);
      if (result.error) return error(result.error, 400);

      const paymentEntry = {
        date, amount: amountNum, method: paymentMethod, note: note || null,
        principalApplied: result.principalApplied,
        interestApplied: result.interestApplied,
        outcome: result.outcome,
        rolledOver: !!result.rolledOver,
        recordedBy: auth.user.name || auth.user.username,
        recordedAt: new Date().toISOString(),
      };

      // The wizard always populates tx.items (even for a single-item loan), so the
      // hasItems branch below is the common path — not just true multi-item loans.
      // Everything ELSE in the app (timeline/eligibility, dashboards, RepaymentModal)
      // still reads the TOP-LEVEL tx.cycleStart/deadlineDate/principalSince, so after
      // touching items[] we always mirror those fields back from whichever unredeemed
      // item is most urgent (soonest deadline) — this keeps a single-item loan's
      // rollover visible everywhere, and keeps a multi-item loan's overall timeline
      // driven by its most-at-risk item.
      const mirrorTopLevelFromItems = (items) => {
        const unredeemed = items.filter(it => !it.redeemed);
        if (unredeemed.length === 0) return;
        const earliest = unredeemed.reduce((best, it) => {
          const dl = it.deadlineDate || tx.deadlineDate || '';
          const bestDl = best ? (best.deadlineDate || tx.deadlineDate || '') : null;
          return (!best || dl < bestDl) ? it : best;
        }, null);
        tx.cycleStart = earliest.cycleStart || tx.dateGiven;
        tx.principalSince = earliest.principalSince || earliest.cycleStart || tx.dateGiven;
        tx.deadlineDate = earliest.deadlineDate || tx.deadlineDate;
      };

      let breakdown;
      let wasRescued = tx.status === 'for_sale' || tx.status === 'ready_to_sell';

      if (result.outcome === 'full_payoff') {
        if (hasItems) {
          const updatedItems = tx.items.map((it, i) => i === targetIdx
            ? { ...it, redeemed: true, dateRedeemed: date, repaidBy: auth.user.name, amountPaid: result.principalApplied + result.interestApplied, daysCharged: result.dayOfCycle, feesCharged: result.interestApplied, payments: [...(it.payments || []), paymentEntry] }
            : it);
          tx.items = updatedItems;
          const allRedeemed = updatedItems.every(it => it.redeemed);
          // tx.cashAdvance is left untouched here — for items-based loans it has always
          // been the original total given (set once at creation), never reduced as items
          // are redeemed (see RedeemItemModal, which never writes it either). Monthly/
          // historical reporting keyed by dateGiven relies on it staying immutable;
          // "currently outstanding" is item.itemCashAdvance summed over unredeemed items.
          if (allRedeemed) {
            tx.status = 'closed';
            tx.amountRepaid = updatedItems.reduce((s, it) => s + (it.amountPaid || 0), 0);
            tx.dateRepaid = date;
            tx.daysCharged = result.dayOfCycle;
            tx.totalFees = updatedItems.reduce((s, it) => s + (it.feesCharged || 0), 0);
            tx.itemReturned = true;
            tx.repaidBy = auth.user.name;
          } else {
            mirrorTopLevelFromItems(updatedItems);
          }
          breakdown = `Item fully redeemed — ₦${fmtNP(result.principalApplied)} principal + ₦${fmtNP(result.interestApplied)} interest = ₦${fmtNP(result.principalApplied + result.interestApplied)}.` + (allRedeemed ? ' All items now redeemed — loan closed.' : ` ${updatedItems.filter(it => !it.redeemed).length} item(s) remain.`);
        } else {
          tx.status = 'closed';
          tx.amountRepaid = result.principalApplied + result.interestApplied;
          tx.dateRepaid = date;
          tx.daysCharged = result.dayOfCycle;
          tx.totalFees = result.interestApplied;
          tx.itemReturned = true;
          tx.repaidBy = auth.user.name;
          tx.payments = [...(tx.payments || []), paymentEntry];
          breakdown = `Loan fully repaid — ₦${fmtNP(result.principalApplied)} principal + ₦${fmtNP(result.interestApplied)} interest = ₦${fmtNP(result.principalApplied + result.interestApplied)}. Item returned.`;
        }
      } else {
        const bucketLabel = result.bucket === 'principal_first' ? 'within the company max tenure' : 'at or past the company max tenure (interest is settled first)';
        if (hasItems) {
          const updatedItems = tx.items.map((it, i) => i === targetIdx
            ? {
                ...it,
                itemCashAdvance: result.newCashAdvance,
                carriedInterestOwed: result.newCarriedInterestOwed,
                principalSince: result.newPrincipalSince,
                cycleStart: result.newCycleStart,
                deadlineDate: result.newDeadlineDate || it.deadlineDate || tx.deadlineDate,
                payments: [...(it.payments || []), paymentEntry],
              }
            : it);
          tx.items = updatedItems;
          // tx.cashAdvance intentionally left untouched — see note above.
          mirrorTopLevelFromItems(updatedItems);
        } else {
          tx.cashAdvance = result.newCashAdvance;
          tx.carriedInterestOwed = result.newCarriedInterestOwed;
          tx.principalSince = result.newPrincipalSince;
          tx.cycleStart = result.newCycleStart;
          tx.deadlineDate = result.newDeadlineDate || tx.deadlineDate;
          tx.payments = [...(tx.payments || []), paymentEntry];
        }
        if (wasRescued) tx.status = 'active';
        breakdown = `Payment received ${bucketLabel}: ₦${fmtNP(result.principalApplied)} applied to principal, ₦${fmtNP(result.interestApplied)} applied to interest.` +
          (result.rolledOver
            ? ` Interest fully cleared — loan renewed, new deadline ${result.newDeadlineDate}.`
            : result.newDeadlineDate
              ? ` Interest payment bought extra time — deadline extended to ${result.newDeadlineDate}. Remaining interest owed beyond that: ₦${fmtNP(result.newInterestOwed)}.`
              : ` Remaining interest owed this cycle: ₦${fmtNP(result.newInterestOwed)}.`) +
          (wasRescued ? ' Item pulled back from the sale pipeline.' : '');
      }

      await db
        .prepare("UPDATE transactions SET data = ?, status = ?, updated_at = datetime('now') WHERE ref = ?")
        .bind(JSON.stringify(tx), tx.status || 'active', ref)
        .run();

      const actionLabel = result.outcome === 'full_payoff' ? 'repaid' : 'loan_payment';
      await logActivity({
        user: auth.user, action: actionLabel, entityType: 'transaction', entityId: ref,
        description: `💵 Payment recorded — ${ref}: ${tx.fullName} paid ₦${fmtNP(amountNum)} on ${date}. ${breakdown}`,
      });

      try {
        await awardStepPoints('tx:' + ref, [{ userId: auth.user.id, stepKey: 'repayment_collection' }]);
      } catch (e) {
        console.error('[staff_points payment] failed:', e?.message ?? e);
      }

      try {
        const smsCfg = await loadSmsConfig();
        if (smsCfg.enabled) {
          const rawPhone = (tx.phoneNumbers && tx.phoneNumbers[0]) || tx.phone || '';
          const phone = toIntlPhone(rawPhone);
          if (phone) {
            const fmtSms = (n) => '₦' + Number(n || 0).toLocaleString('en-NG');
            if (result.outcome === 'full_payoff' && smsCfg.redemptionConfirmationEnabled) {
              const message = fillSmsTemplate(smsCfg.tmplRedemptionConfirmation, {
                customerName: tx.fullName, ref, amount: fmtSms(amountNum), dueDate: tx.deadlineDate || '',
                businessName: smsCfg.businessName, shopPhone: smsCfg.shopPhone,
              });
              const { ok, messageId, response } = await termiiSend(smsCfg, phone, message);
              await insertSmsLog({ transactionRef: ref, triggerType: 'redemption_confirmation', message, recipient: phone, status: ok ? 'sent' : 'failed', termiiResponse: JSON.stringify(response), messageId });
            } else if (result.outcome !== 'full_payoff' && smsCfg.loanPaymentConfirmationEnabled) {
              const message = fillSmsTemplate(smsCfg.tmplLoanPayment, {
                customerName: tx.fullName, ref, amount: fmtSms(amountNum), breakdown,
                businessName: smsCfg.businessName, shopPhone: smsCfg.shopPhone,
              });
              const { ok, messageId, response } = await termiiSend(smsCfg, phone, message);
              await insertSmsLog({ transactionRef: ref, triggerType: 'loan_payment', message, recipient: phone, status: ok ? 'sent' : 'failed', termiiResponse: JSON.stringify(response), messageId });
            }
          }
        }
      } catch (_smsErr) {
        await logSmsRuntimeError({ user: auth.user, transactionRef: ref, triggerType: 'loan_payment', err: _smsErr });
      }

      await pushNotifyAll(env, db, {
        title: result.outcome === 'full_payoff' ? '✅ Loan Redeemed' : '💵 Loan Payment Recorded',
        body: `${ref}: ${tx.fullName} paid ₦${fmtNP(amountNum)}`,
        url: '/transactions',
        tag: 'loan-payment',
      });

      return json({ success: true, outcome: result.outcome, breakdown, result });
    }
    if (path.startsWith('transactions/') && method === 'DELETE') {
      const auth = requireAdmin(request);
      if (auth.error) return auth.error;
      const ref = decodeURIComponent(path.split('/')[1]);
      // Delete photos from R2 before removing the transaction record
      if (env.PHOTOS) {
        const row = await db.prepare('SELECT data FROM transactions WHERE ref = ?').bind(ref).first();
        if (row) {
          const keys = extractPhotoKeys(JSON.parse(row.data));
          if (keys.length > 0) await Promise.all(keys.map(k => env.PHOTOS.delete(k)));
        }
      }
      await db.prepare('DELETE FROM transactions WHERE ref = ?').bind(ref).run();
      await logActivity({ user: auth.user, action: 'delete', entityType: 'transaction', entityId: ref, description: `🗑 Transaction deleted — ${ref}` });
      return json({ success: true });
    }

    // ============================================================
    // DRAFTS: GET, POST, DELETE /api/drafts
    // ============================================================
    if (path === 'drafts' && method === 'GET') {
      const auth = requireAuth(request);
      if (auth.error) return auth.error;
      // All authenticated users see all drafts — staff collaborate on any customer's draft.
      const { results } = await db.prepare('SELECT ref, data FROM drafts ORDER BY updated_at DESC').all();
      return json(results.map((r) => ({ ...JSON.parse(r.data), ref: r.ref })));
    }
    if (path === 'drafts' && method === 'POST') {
      const auth = requireAuth(request);
      if (auth.error) return auth.error;
      const draft = await request.json();
      const hasPassedIdentityStep = Number(draft?.wizardStep ?? 0) > 1 || Boolean(draft?.ninVerified) || Boolean(draft?.ninVerificationAttempted);
      if (!hasPassedIdentityStep) {
        await db.prepare('DELETE FROM drafts WHERE ref = ?').bind(draft.ref).run();
        return json({ success: false, skipped: true, reason: 'Drafts before identity verification are not persisted.' });
      }
      // Record the acting user as the actor for whichever step keys the wizard
      // reports have just been completed. The client sends `completedStepKeys`
      // as a hint (an array of step_key strings). For backward-compat we also
      // infer from `wizardStep` / verification flags if `completedStepKeys` is
      // missing. The stored draft.stepActors keeps a per-step actor map; the
      // ORIGINAL actor of a step is preserved on re-save by another user
      // (idempotent + first-writer-wins on each step_key).
      const incomingStepActors = (draft && typeof draft.stepActors === 'object' && draft.stepActors) || {};
      const claimed = Array.isArray(draft?.completedStepKeys) ? draft.completedStepKeys : [];
      // Implicit signals that cover the legacy wizard until the client is updated
      const implicit = [];
      if (Number(draft?.wizardStep ?? 0) >= 1 && (draft?.ninVerified || draft?.ninVerificationAttempted)) implicit.push('id_verification');
      if (Number(draft?.wizardStep ?? 0) >= 2 && draft?.fullName) implicit.push('customer_intake');
      if (Array.isArray(draft?.itemPhotos) && draft.itemPhotos.length > 0) implicit.push('item_photo');
      if (Number(draft?.aiEstimatedValue) > 0 || Number(draft?.estimatedValue) > 0) implicit.push('item_appraisal');
      const mergedSteps = Array.from(new Set([...claimed, ...implicit]));
      const stepActors = { ...incomingStepActors };
      for (const stepKey of mergedSteps) {
        if (!stepActors[stepKey]) {
          stepActors[stepKey] = { userId: auth.user.id, at: new Date().toISOString() };
        }
      }
      // Strip the transient hint and re-attach the consolidated actor map.
      const persistDraft = { ...draft, stepActors };
      delete persistDraft.completedStepKeys;
      await db
        // created_by is set on first insert and intentionally not changed on updates
        // so the original creator retains ownership even if another user resumes the draft.
        .prepare("INSERT INTO drafts (ref, data, updated_at, created_by) VALUES (?, ?, datetime('now'), ?) ON CONFLICT (ref) DO UPDATE SET data = excluded.data, updated_at = datetime('now')")
        .bind(draft.ref, JSON.stringify(persistDraft), auth.user.id)
        .run();
      return json({ success: true });
    }
    if (path.startsWith('drafts/') && method === 'DELETE') {
      const auth = requireAuth(request);
      if (auth.error) return auth.error;
      const ref = decodeURIComponent(path.split('/')[1]);
      // Delete photos from R2 before removing the draft record — but ONLY if no
      // completed transaction with this ref exists.  When a draft is converted to
      // a transaction the transaction is saved first, then this endpoint is called;
      // deleting the photos at that point would make them unavailable in the
      // transaction detail view.
      if (env.PHOTOS) {
        const txExists = await db.prepare('SELECT 1 FROM transactions WHERE ref = ?').bind(ref).first();
        if (!txExists) {
          const row = await db.prepare('SELECT data FROM drafts WHERE ref = ?').bind(ref).first();
          if (row) {
            const keys = extractPhotoKeys(JSON.parse(row.data));
            if (keys.length > 0) await Promise.all(keys.map(k => env.PHOTOS.delete(k)));
          }
        }
      }
      await db.prepare('DELETE FROM drafts WHERE ref = ?').bind(ref).run();
      await logActivity({ user: auth.user, action: 'delete', entityType: 'draft', entityId: ref, description: `Deleted draft ${ref}` });
      return json({ success: true });
    }

    // ============================================================
    // EXPENSES: GET, POST /api/expenses
    // ============================================================
    if (path === 'expenses' && method === 'GET') {
      const auth = requireAuth(request);
      if (auth.error) return auth.error;
      const { results } = await db.prepare('SELECT id, date, category, description, amount, registered_by FROM expenses ORDER BY date DESC').all();
      return json(results);
    }
    if (path === 'expenses' && method === 'POST') {
      const auth = requireAuth(request);
      if (auth.error) return auth.error;
      const { date, category, description, amount } = await request.json();
      const registeredBy = auth.user?.username || auth.user?.name || null;
      const inserted = await db
        .prepare('INSERT INTO expenses (date, category, description, amount, registered_by) VALUES (?, ?, ?, ?, ?)')
        .bind(date, category, description, amount, registeredBy)
        .run();
      await logActivity({ user: auth.user, action: 'entry', entityType: 'expense', entityId: String(inserted.meta.last_row_id), description: `🧾 Expense recorded — ${category}${description ? ': ' + description : ''} — ₦${Number(amount).toLocaleString('en-NG')}` });
      await awardTaskPoints({ user: auth.user, taskKey: 'expense_entry', entityRef: 'expense:' + String(inserted.meta.last_row_id) });
      return json({ success: true });
    }
    if (path.startsWith('expenses/') && method === 'DELETE') {
      const auth = requireAdmin(request);
      if (auth.error) return auth.error;
      const id = Number(path.split('/')[1]);
      const expRow = await db.prepare('SELECT category, description AS expDesc, amount FROM expenses WHERE id = ?').bind(id).first();
      await db.prepare('DELETE FROM expenses WHERE id = ?').bind(id).run();
      await logActivity({ user: auth.user, action: 'delete', entityType: 'expense', entityId: String(id), description: `🗑 Expense deleted — ${expRow?.category || ''}${expRow?.expDesc ? ': ' + expRow.expDesc : ''} — ₦${Number(expRow?.amount || 0).toLocaleString('en-NG')}` });
      return json({ success: true });
    }

    // ============================================================
    // CAPITAL: GET, POST /api/capital
    // ============================================================
    if (path === 'capital' && method === 'GET') {
      const auth = requireAuth(request);
      if (auth.error) return auth.error;
      const { results } = await db.prepare('SELECT id, name, amount, date, method, receipt, user_id, type FROM capital ORDER BY date').all();
      return json(results);
    }
    if (path === 'capital' && method === 'POST') {
      const auth = requireAuth(request);
      if (auth.error) return auth.error;
      const { name, amount, date, method: capitalMethod, receipt, user_id, type } = await request.json();
      const entryType = type === 'withdrawal' ? 'withdrawal' : 'contribution';
      const amountNum = Number(amount);
      if (!name || !(amountNum > 0) || !date || !capitalMethod) {
        return json({ error: 'name, amount, date, and method are required' }, 400);
      }
      if (entryType === 'withdrawal') {
        // Withdrawals reduce another stakeholder's capital on record — admin only,
        // matching the admin-only withdrawal UI and admin-only capital deletion.
        if (auth.user.role !== 'admin') return json({ error: 'Admin access required to record a withdrawal' }, 403);
        // Validate the stakeholder's running balance stays non-negative at every point
        // in time (not just today) — otherwise a backdated withdrawal could use capital
        // that, as of its own date, hadn't been contributed yet.
        const { results: existing } = await db
          .prepare(`SELECT amount, type, date FROM capital WHERE lower(name) = lower(?)`)
          .bind(name)
          .all();
        const timeline = [...(existing || []), { amount: amountNum, type: 'withdrawal', date }]
          .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
        let running = 0;
        for (const c of timeline) {
          running += c.type === 'withdrawal' ? -(c.amount || 0) : (c.amount || 0);
          if (running < -0.005) {
            const currentNet = (existing || []).reduce((s, c2) => s + (c2.type === 'withdrawal' ? -(c2.amount || 0) : (c2.amount || 0)), 0);
            return json({ error: `Cannot withdraw ₦${amountNum.toLocaleString('en-NG')} on ${date} — this would make ${name}'s capital balance negative on that date given their other dated entries (current net balance: ₦${currentNet.toLocaleString('en-NG')}).` }, 400);
          }
        }
      }
      const inserted = await db
        .prepare('INSERT INTO capital (name, amount, date, method, receipt, user_id, type) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(name, amountNum, date, capitalMethod, receipt || null, user_id || null, entryType)
        .run();
      const verb = entryType === 'withdrawal' ? 'withdrew' : 'contributed';
      await logActivity({ user: auth.user, action: 'entry', entityType: 'capital', entityId: String(inserted.meta.last_row_id), description: `${entryType === 'withdrawal' ? '💸' : '💎'} Capital ${entryType === 'withdrawal' ? 'withdrawn' : 'deposited'} — ${name} ${verb} ₦${amountNum.toLocaleString('en-NG')} via ${capitalMethod}` });
      // Broadcast to all subscribed devices — covers admins, staff and the stakeholder themselves.
      await pushNotifyAll(env, db, {
        title: entryType === 'withdrawal' ? '💸 Capital Withdrawal Recorded' : '💰 Capital Entry Recorded',
        body: `${name} ${verb} ₦${amountNum.toLocaleString('en-NG')} via ${capitalMethod}.`,
        url: '/capital',
        tag: 'capital-entry',
      });
      return json({ success: true });
    }
    if (path.startsWith('capital/') && method === 'DELETE') {
      const auth = requireAdmin(request);
      if (auth.error) return auth.error;
      const id = Number(path.split('/')[1]);
      const capRow = await db.prepare('SELECT name, amount, method FROM capital WHERE id = ?').bind(id).first();
      await db.prepare('DELETE FROM capital WHERE id = ?').bind(id).run();
      await logActivity({ user: auth.user, action: 'delete', entityType: 'capital', entityId: String(id), description: `🗑 Capital entry removed — ${capRow?.name || ''} ₦${Number(capRow?.amount || 0).toLocaleString('en-NG')} (${capRow?.method || ''})` });
      return json({ success: true });
    }

    // ============================================================
    // PROFIT DISTRIBUTIONS: GET, POST /api/distributions
    // ============================================================
    if (path === 'distributions' && method === 'GET') {
      const auth = requireAuth(request);
      if (auth.error) return auth.error;
      try {
        const { results } = await db.prepare('SELECT id, date, amount, method, note, receipt, created_by, created_at, stakeholder_name, decision_ids FROM profit_distributions ORDER BY date DESC, created_at DESC').all();
        return json(results);
      } catch (_) { return json([]); }
    }
    if (path === 'distributions' && method === 'POST') {
      // canRecordDistribution calls requireAuth internally; add active check separately
      const activeCheck = await requireAuthActive(request, db);
      if (activeCheck.error) return activeCheck.error;
      const auth = await canRecordDistribution(request, db);
      if (auth.error) return auth.error;
      const { date, amount, method: distMethod, note, receipt, stakeholder_name, decision_ids } = await request.json();
      const inserted = await db
        .prepare('INSERT INTO profit_distributions (date, amount, method, note, receipt, created_by, stakeholder_name, decision_ids) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(date, amount, distMethod, note || null, receipt || null, auth.user.name || auth.user.username, stakeholder_name || null, decision_ids || null)
        .run();
      // Mark linked decisions as paid
      if (decision_ids) {
        try {
          const ids = JSON.parse(decision_ids);
          if (Array.isArray(ids) && ids.length > 0) {
            const now = new Date().toISOString();
            const paidBy = auth.user.name || auth.user.username;
            for (const decId of ids) {
              await db.prepare('UPDATE distribution_decisions SET paid_at = ?, paid_by = ? WHERE id = ? AND paid_at IS NULL')
                .bind(now, paidBy, decId).run();
            }
          }
        } catch (_) { /* ignore parse errors */ }
      }
      await logActivity({ user: auth.user, action: 'entry', entityType: 'distribution', entityId: String(inserted.meta.last_row_id), description: `💸 Profit paid out — ₦${Number(amount).toLocaleString('en-NG')} to ${stakeholder_name || 'stakeholders'} via ${distMethod}${note ? ' (' + note + ')' : ''}` });
      // Notify the stakeholder named in the distribution (look up by name → user id)
      if (stakeholder_name) {
        const stakeholder = await db
          .prepare("SELECT id FROM users WHERE name = ? AND role = 'stakeholder' LIMIT 1")
          .bind(stakeholder_name).first().catch(() => null);
        if (stakeholder?.id) {
          await pushNotifyUser(env, db, stakeholder.id, {
            title: '💎 Profit Distribution Received',
            body: `₦${Number(amount).toLocaleString('en-NG')} has been paid to you via ${distMethod}.`,
            url: '/capital',
            tag: 'distribution',
          });
        }
      }
      return json({ success: true, id: inserted.meta.last_row_id });
    }
    if (path.startsWith('distributions/') && method === 'DELETE') {
      const auth = requireAdmin(request);
      if (auth.error) return auth.error;
      const id = Number(path.split('/')[1]);
      const row = await db.prepare('SELECT amount, method FROM profit_distributions WHERE id = ?').bind(id).first();
      if (row?.receipt && env.PHOTOS) {
        const key = row.receipt.replace('/api/photos/', '');
        if (key && !key.startsWith('http')) await env.PHOTOS.delete(key).catch(() => {});
      }
      await db.prepare('DELETE FROM profit_distributions WHERE id = ?').bind(id).run();
      await logActivity({ user: auth.user, action: 'delete', entityType: 'distribution', entityId: String(id), description: `🗑 Distribution record removed — ₦${Number(row?.amount || 0).toLocaleString('en-NG')} via ${row?.method || ''}` });
      return json({ success: true });
    }

    // ============================================================
    // DECLINED LOG: GET, POST /api/declined
    // ============================================================
    if (path === 'declined' && method === 'GET') {
      const auth = requireAuth(request);
      if (auth.error) return auth.error;
      const { results } = await db.prepare('SELECT id, date, ref, customer_name AS customerName, nin_bvn AS ninBvn, item, reason, notes FROM declined_log ORDER BY date DESC').all();
      return json(results);
    }
    if (path === 'declined' && method === 'POST') {
      const auth = requireAuth(request);
      if (auth.error) return auth.error;
      const { date, ref, customerName, ninBvn, item, reason, notes } = await request.json();
      const inserted = await db
        .prepare('INSERT INTO declined_log (date, ref, customer_name, nin_bvn, item, reason, notes) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(date, ref || null, customerName || null, ninBvn || null, item, reason, notes || null)
        .run();
      await logActivity({ user: auth.user, action: 'entry', entityType: 'declined', entityId: String(inserted.meta.last_row_id), description: `🚫 Item declined — ${item}: ${reason}` });
      return json({ success: true });
    }

    // ============================================================
    // ACTIVITIES: GET /api/activity-logs
    // ============================================================
    if (path === 'activity-logs' && method === 'GET') {
      const auth = requireAuth(request);
      if (auth.error) return auth.error;
      const limit = Math.max(1, Math.min(500, Number.parseInt(url.searchParams.get('limit') || '200') || 200));
      const offset = Math.max(0, Number.parseInt(url.searchParams.get('offset') || '0') || 0);
      const q = (url.searchParams.get('q') || '').trim();
      const from = url.searchParams.get('from') || '';
      const to = url.searchParams.get('to') || '';
      const type = url.searchParams.get('type') || '';
      const action = url.searchParams.get('action') || '';
      const sort = url.searchParams.get('sort') === 'asc' ? 'ASC' : 'DESC';

      // SMS logs category — query sms_logs table and return compatible shape
      if (type === 'sms') {
        const smsConds = []; const smsParams = [];
        if (q) { smsConds.push('(message LIKE ? OR recipient LIKE ? OR transaction_ref LIKE ?)'); smsParams.push(`%${q}%`, `%${q}%`, `%${q}%`); }
        if (from) { smsConds.push("date(sent_at) >= date(?)"); smsParams.push(from); }
        if (to) { smsConds.push("date(sent_at) <= date(?)"); smsParams.push(to); }
        const smsWhere = smsConds.length ? 'WHERE ' + smsConds.join(' AND ') : '';
        const [smsCount, { results: smsRows }] = await Promise.all([
          db.prepare(`SELECT COUNT(*) AS total FROM sms_logs ${smsWhere}`).bind(...smsParams).first(),
          db.prepare(`SELECT id, sent_at, transaction_ref, trigger_type, message, recipient, status, delivery_status FROM sms_logs ${smsWhere} ORDER BY sent_at ${sort}, id ${sort} LIMIT ? OFFSET ?`).bind(...smsParams, limit, offset).all(),
        ]);
        const logs = smsRows.map(r => ({
          id: `sms-${r.id}`,
          created_at: r.sent_at,
          user_id: 'system',
          username: r.trigger_type === 'manual' ? 'staff' : 'system',
          user_role: r.trigger_type === 'manual' ? 'staff' : 'system',
          action: 'sms',
          entity_type: 'sms',
          entity_id: r.transaction_ref,
          description: `📱 SMS (${r.trigger_type}) → ${r.recipient}${r.transaction_ref ? ` · ${r.transaction_ref}` : ''}`,
          _sms: { trigger_type: r.trigger_type, recipient: r.recipient, status: r.status, delivery_status: r.delivery_status, message: r.message },
        }));
        return json({ logs, total: smsCount?.total ?? 0, limit, offset });
      }

      const conds = []; const params = [];
      if (q) { conds.push('(description LIKE ? OR username LIKE ?)'); params.push(`%${q}%`, `%${q}%`); }
      if (from) { conds.push("date(created_at) >= date(?)"); params.push(from); }
      if (to) { conds.push("date(created_at) <= date(?)"); params.push(to); }
      if (type) { conds.push('entity_type = ?'); params.push(type); }
      if (action) { conds.push('action = ?'); params.push(action); }
      const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
      const [countRow, { results }] = await Promise.all([
        db.prepare(`SELECT COUNT(*) AS total FROM activity_logs ${where}`).bind(...params).first(),
        db.prepare(`SELECT id, created_at, user_id, username, user_role, action, entity_type, entity_id, description FROM activity_logs ${where} ORDER BY created_at ${sort}, id ${sort} LIMIT ? OFFSET ?`).bind(...params, limit, offset).all(),
      ]);
      return json({ logs: results, total: countRow?.total ?? 0, limit, offset });
    }

    // ============================================================
    // NIN/BVN VERIFICATION PROXY: POST /api/verify-nin, /api/verify-bvn
    // Checks local cache first — only calls paid API on cache miss.
    // ============================================================
    if (path === 'verify-nin' && method === 'POST') {
      const { nin, apiKey } = await request.json();

      // Check cache first
      const cached = await db.prepare(
        'SELECT data FROM nin_bvn_cache WHERE id_type = ? AND id_number = ? LIMIT 1'
      ).bind('nin', nin).first();
      if (cached) {
        const cachedData = JSON.parse(cached.data);
        return json({ ...cachedData, _source: 'cache' });
      }

      // Cache miss — call the paid API
      const resp = await fetch('https://checkmyninbvn.com.ng/api/nin-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
        body: JSON.stringify({ nin, consent: true })
      });
      const data = await resp.json();

      // Store successful results in cache
      const isSuccess = data?.status === 'success' || data?.status === true || data?.status === 'true' || data?.code === 200;
      if (isSuccess && (data?.data || data?.response)) {
        await db.prepare(
          'INSERT OR REPLACE INTO nin_bvn_cache (id_type, id_number, data, created_at) VALUES (?, ?, ?, datetime(\'now\'))'
        ).bind('nin', nin, JSON.stringify(data)).run();
      }

      return json(data);
    }
    if (path === 'verify-bvn' && method === 'POST') {
      const { bvn, apiKey } = await request.json();

      // Check cache first
      const cached = await db.prepare(
        'SELECT data FROM nin_bvn_cache WHERE id_type = ? AND id_number = ? LIMIT 1'
      ).bind('bvn', bvn).first();
      if (cached) {
        const cachedData = JSON.parse(cached.data);
        return json({ ...cachedData, _source: 'cache' });
      }

      // Cache miss — call the paid API
      const resp = await fetch('https://checkmyninbvn.com.ng/api/bvn-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
        body: JSON.stringify({ bvn, consent: true })
      });
      const data = await resp.json();

      // Store successful results in cache
      const isSuccess = data?.status === 'success' || data?.status === true || data?.status === 'true' || data?.code === 200;
      if (isSuccess && (data?.data || data?.response)) {
        await db.prepare(
          'INSERT OR REPLACE INTO nin_bvn_cache (id_type, id_number, data, created_at) VALUES (?, ?, ?, datetime(\'now\'))'
        ).bind('bvn', bvn, JSON.stringify(data)).run();
      }

      return json(data);
    }

    // ============================================================
    // NIN/BVN WALLET BALANCE: GET /api/nin-balance
    // Fetches the current wallet balance from checkmyninbvn.com.ng
    // and returns the number of verification credits (balance ÷ ninCreditCost).
    // ============================================================
    if (path === 'nin-balance' && method === 'GET') {
      const auth = requireAuth(request);
      if (auth.error) return auth.error;
      const settingsRow = await db.prepare("SELECT value FROM settings WHERE key = 'config'").first();
      const config = settingsRow ? JSON.parse(settingsRow.value) : {};
      const apiKey = config.ninApiKey || '';
      if (!apiKey) return json({ balance: null, credits: null, error: 'NIN/BVN API key not configured.' });
      const creditCost = Math.max(1, Number(config.ninCreditCost) || 150);
      try {
        const resp = await fetch('https://checkmyninbvn.com.ng/api/balance', {
          method: 'GET',
          headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
        });
        const data = await resp.json();
        // API returns { status, balance } where balance is in Naira.
        // Cost per credit is configurable (default 150 Naira = 1 NIN/BVN verification).
        const rawBalance = data?.balance ?? data?.data?.balance ?? data?.wallet_balance ?? null;
        const balanceNum = rawBalance !== null ? Number(rawBalance) : null;
        const credits = balanceNum !== null ? Math.floor(balanceNum / creditCost) : null;
        return json({ balance: balanceNum, credits, creditCost, raw: data });
      } catch (e) {
        return json({ balance: null, credits: null, error: 'Failed to fetch balance from checkmyninbvn.com.ng' });
      }
    }

    // ============================================================
    // NIN/BVN AUTOCOMPLETE SUGGESTIONS: GET /api/nin-suggestions?prefix=XX&type=nin
    // Returns a list of cached ID numbers whose prefix matches what the user is typing.
    // Requires authentication — ID numbers are sensitive data.
    // ============================================================
    if (path === 'nin-suggestions' && method === 'GET') {
      const auth = requireAuth(request);
      if (auth.error) return auth.error;
      const prefix = (url.searchParams.get('prefix') || '').replace(/\D/g, '');
      const idType = url.searchParams.get('type') === 'bvn' ? 'bvn' : 'nin';
      if (!prefix) return json({ suggestions: [] });
      const rows = await db.prepare(
        'SELECT id_number, data FROM nin_bvn_cache WHERE id_type = ? AND id_number LIKE ? ORDER BY created_at DESC LIMIT 8 /* up to 8 suggestions keeps the dropdown concise */'
      ).bind(idType, `${prefix}%`).all();
      const suggestions = (rows?.results || []).map(r => {
        let name = '';
        try {
          const parsed = JSON.parse(r.data);
          // Mirror the name-extraction logic used on the frontend (verify-nin/bvn result unpacking)
          const d = (parsed?.data?.firstname || parsed?.data?.firstName) ? parsed.data : (parsed?.data?.data || parsed?.data || parsed?.response || {});
          const first = d.firstname || d.firstName || '';
          const middle = d.middlename || d.middleName || '';
          const last = d.surname || d.lastname || d.lastName || '';
          name = [first, middle, last].filter(Boolean).join(' ');
        } catch (_) { /* ignore malformed cache entries */ }
        return { number: r.id_number, name };
      });
      return json({ suggestions });
    }

    // ============================================================
    // PUBLIC LOAN STATUS CHECK: GET /api/check-loan?ref=CIF-DDMMYY-NNN
    // No authentication required — returns only non-sensitive fields.
    // ============================================================
    if (path === 'check-loan' && method === 'GET') {
      const ref = (url.searchParams.get('ref') || '').trim().toUpperCase();
      if (!ref) return error('ref query parameter is required', 400);

      const [row, loanCfg] = await Promise.all([
        db.prepare('SELECT data, status FROM transactions WHERE UPPER(ref) = ?').bind(ref).first(),
        loadLoanConfig(db),
      ]);

      if (!row) return json({ found: false });

      const txData = JSON.parse(row.data);
      const withTimeline = withLoanTimeline({ ...txData, status: row.status }, loanCfg);

      // Return only the fields needed by the customer portal — no NIN, BVN, photos, etc.
      const {
        ref: txRef, type, status,
        fullName,
        aiItemType, aiBrand, aiModel,
        cashAdvance, dailyFee,
        dateGiven, deadlineDate, loanDays,
        // loan timeline fields
        elapsedDays, customer_due_date, internal_deadline,
        grace_end_date, sale_allowed_date, loanStatus,
        // for_sale / sold fields
        salePrice, saleDate, listedForSaleDate,
        // closed (repaid) fields
        amountRepaid, dateRepaid, daysCharged, totalFees,
      } = withTimeline;

      return json({
        found: true,
        ref: txRef,
        type,
        status,
        fullName,
        aiItemType,
        aiBrand,
        aiModel,
        cashAdvance,
        dailyFee,
        dateGiven,
        deadlineDate,
        loanDays,
        elapsedDays,
        customer_due_date,
        internal_deadline,
        grace_end_date,
        sale_allowed_date,
        loanStatus,
        // for_sale / sold
        salePrice,
        saleDate,
        listedForSaleDate,
        // closed (repaid)
        amountRepaid,
        dateRepaid,
        daysCharged,
        totalFees,
      });
    }

    // ============================================================
    // PUBLIC SHOP: GET /api/shop-items
    // No authentication required — returns items listed for sale
    // with only non-sensitive fields (no customer data).
    // ============================================================
    if (path === 'shop-items' && method === 'GET') {
      const settingsRow = await db.prepare("SELECT value FROM settings WHERE key = 'config'").first();
      const cfg = settingsRow ? JSON.parse(settingsRow.value) : {};
      const maxSoldHistory = cfg.shopMaxSoldHistoryItems == null ? 8 : Math.max(0, Number(cfg.shopMaxSoldHistoryItems) || 0);

      const [rows, soldRows] = await Promise.all([
        db.prepare("SELECT ref, data, created_at, updated_at FROM transactions WHERE status = 'for_sale' ORDER BY updated_at DESC").all(),
        db.prepare("SELECT ref, data, created_at, updated_at FROM transactions WHERE status = 'sold' ORDER BY updated_at DESC LIMIT ?").bind(maxSoldHistory).all(),
      ]);

      // Extract visible item photos, respecting hiddenPhotoIndexes set by staff
      const extractPhotos = (d) => {
        const raw = Array.isArray(d.itemPhotos)
          ? d.itemPhotos
          : (d.itemPhotos && typeof d.itemPhotos === 'object'
              ? [d.itemPhotos.front, d.itemPhotos.back, d.itemPhotos.left, d.itemPhotos.right, d.itemPhotos.powerOn, d.itemPhotos.aboutPage, ...(d.itemPhotos.corners || [])]
              : []);
        const hidden = Array.isArray(d.hiddenPhotoIndexes) ? d.hiddenPhotoIndexes : [];
        return raw.filter((p, i) => p && !hidden.includes(i));
      };

      const items = (rows.results || []).map(row => {
        const d = JSON.parse(row.data);
        const photos = extractPhotos(d);
        return {
          ref: row.ref,
          shopId: d.shopId || null,
          itemType: d.aiItemType || d.captureItemType || 'Item',
          brand: d.aiBrand || '',
          model: d.aiModel || '',
          colour: d.aiColour || '',
          condition: d.shopCondition || d.aiCondition || d.conditionDescription || '',
          salePrice: d.salePrice || 0,
          // itemNewPrice: explicitly set by staff during listing.
          // Falls back to aiNewMarketPrice from AI Run 3 valuation if not set.
          itemNewPrice: d.itemNewPrice > 0 ? d.itemNewPrice : (Number(d.aiNewMarketPrice) > 0 ? Number(d.aiNewMarketPrice) : null),
          estimatedValue: d.estimatedValue || d.aiEstimatedValue || 0,
          photos,
          photoFront: photos[0] || null,
          // For legacy transactions with object-format itemPhotos, expose powerOn photo as fallback thumbnail
          photoPowerOn: (!Array.isArray(d.itemPhotos) && d.itemPhotos?.powerOn) ? d.itemPhotos.powerOn : null,
          listedDate: d.listedForSaleDate || row.updated_at || row.created_at || null,
          shopNote: d.shopListingNote || '',
          inspectionNotes: d.inspectionNotes || '',
          // Device identifiers — shown publicly to help buyers verify authenticity
          imei: d.imei || null,
          serialNumber: d.serialNumber || null,
          keySpecs: d.aiKeySpecs || '',
        };
      });

      const soldItems = cfg.shopShowSoldHistory !== false
        ? (soldRows.results || []).map(row => {
            const d = JSON.parse(row.data);
            const photos = extractPhotos(d);
            return {
              ref: row.ref,
              itemType: d.aiItemType || d.captureItemType || 'Item',
              brand: d.aiBrand || '',
              model: d.aiModel || '',
              salePrice: d.salePrice || 0,
              saleDate: d.saleDate || null,
              saleCondition: d.saleCondition || null,
              photoFront: photos[0] || null,
            };
          })
        : [];

      return json({ items, soldItems }, 200, { 'Cache-Control': 'public, max-age=60' });
    }

    // ============================================================
    // HEALTH CHECK: GET /api/health
    // ============================================================
    if (path === 'health' || path === '') {
      await db.prepare('SELECT 1').run();
      return json(
        { status: 'ok', database: 'connected' },
        200,
        { 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' }
      );
    }

    // ============================================================
    // SMS (Termii) — /api/sms/*
    // ============================================================

    // ── GET /api/sms/balance — Termii wallet balance + credit count ──
    if (path === 'sms/balance' && method === 'GET') {
      const auth = requireAuth(request);
      if (auth.error) return auth.error;
      const smsCfg = await loadSmsConfig();
      if (!smsCfg.apiKey) return json({ balance: null, credits: null, error: 'Termii API key not configured.' });
      try {
        const resp = await fetch(`${smsCfg.baseUrl}/api/get-balance?api_key=${encodeURIComponent(smsCfg.apiKey)}`);
        const data = await resp.json().catch(() => ({}));
        const rawBalance = data?.balance ?? data?.data?.balance ?? null;
        const balanceNum = rawBalance !== null ? Number(rawBalance) : null;
        const credits = balanceNum !== null ? Math.floor(balanceNum / smsCfg.nairaPerCredit) : null;
        return json({ balance: balanceNum, credits, nairaPerCredit: smsCfg.nairaPerCredit, raw: data });
      } catch {
        return json({ balance: null, credits: null, error: 'Failed to reach Termii API.' });
      }
    }

    // ── GET /api/sms/sender-ids — fetch approved sender IDs from Termii ──
    if (path === 'sms/sender-ids' && method === 'GET') {
      const auth = requireAuth(request);
      if (auth.error) return auth.error;
      const smsCfg = await loadSmsConfig();
      if (!smsCfg.apiKey) return json({ senderIds: [], error: 'Termii API key not configured.' });
      try {
        const resp = await fetch(`${smsCfg.baseUrl}/api/sender-id?api_key=${encodeURIComponent(smsCfg.apiKey)}`);
        const data = await resp.json().catch(() => ({}));
        // Termii returns { data: [...] } or { content: [...] } depending on API version
        const list = Array.isArray(data?.data) ? data.data : (Array.isArray(data?.content) ? data.content : []);
        const senderIds = list
          .filter(s => (s.status || '').toLowerCase() === 'active' || (s.status || '').toLowerCase() === 'unblock')
          .map(s => ({ name: s.sender_id, status: s.status, country: s.country }));
        return json({ senderIds, raw: data });
      } catch {
        return json({ senderIds: [], error: 'Failed to reach Termii API.' });
      }
    }

    // ── GET /api/sms/logs — all SMS logs (optionally filtered by ?ref=) ──
    if (path === 'sms/logs' && method === 'GET') {
      const auth = requireAuth(request);
      if (auth.error) return auth.error;
      const refFilter = (url.searchParams.get('ref') || '').trim();
      let query = 'SELECT id, transaction_ref, sent_at, trigger_type, message, recipient, status, termii_response, message_id, delivery_status FROM sms_logs';
      const params = [];
      if (refFilter) { query += ' WHERE transaction_ref = ?'; params.push(refFilter); }
      query += ' ORDER BY sent_at DESC LIMIT 500';
      const { results } = await db.prepare(query).bind(...params).all();
      return json(results);
    }

    // ── GET /api/sms/webhook-stats — check webhook activity ──
    if (path === 'sms/webhook-stats' && method === 'GET') {
      const auth = requireAuth(request);
      if (auth.error) return auth.error;

      // Count SMS with and without delivery_status
      const stats = await db.prepare(`
        SELECT
          COUNT(*) as total_sms,
          SUM(CASE WHEN delivery_status IS NOT NULL THEN 1 ELSE 0 END) as received_webhooks,
          SUM(CASE WHEN delivery_status IS NULL THEN 1 ELSE 0 END) as pending_webhooks
        FROM sms_logs
        WHERE sent_at > datetime('now', '-7 days')
      `).first();

      // Get recent SMS still waiting for webhook (last 10)
      const { results: pending } = await db.prepare(`
        SELECT id, message_id, recipient, sent_at, status, delivery_status
        FROM sms_logs
        WHERE delivery_status IS NULL AND sent_at > datetime('now', '-7 days')
        ORDER BY sent_at DESC
        LIMIT 10
      `).all();

      // Get recent webhooks received (last 10)
      const { results: recent } = await db.prepare(`
        SELECT id, message_id, recipient, sent_at, delivery_status
        FROM sms_logs
        WHERE delivery_status IS NOT NULL AND sent_at > datetime('now', '-7 days')
        ORDER BY sent_at DESC
        LIMIT 10
      `).all();

      return json({
        stats,
        pending_webhooks: pending,
        recent_webhooks: recent,
        webhook_url: 'https://cifcash.pages.dev/api/sms/webhook',
        status: Number(stats?.pending_webhooks || 0) === 0 ? 'webhook_working' : (Number(stats?.pending_webhooks || 0) > 5 ? 'webhook_may_not_be_working' : 'webhook_working_but_slow')
      });
    }

    // ── GET /api/sms/status/:messageId — manually check SMS status from Termii ──
    if (path.match(/^sms\/status\/[a-zA-Z0-9_.\-]+$/) && method === 'GET') {
      const auth = requireAuth(request);
      if (auth.error) return auth.error;

      const messageId = url.pathname.split('/').pop();
      if (!messageId) return error('message_id required', 400);

      try {
        const smsCfg = await loadSmsConfig();
        if (!smsCfg.apiKey) return json({ error: 'Termii API key not configured' }, 400);

        // Find the SMS log entry
        const smsLog = await db.prepare(
          'SELECT id, message_id, delivery_status FROM sms_logs WHERE message_id = ? LIMIT 1'
        ).bind(messageId).first();

        if (!smsLog) {
          return json({ error: 'SMS not found in logs', message_id: messageId }, 404);
        }

        // Query Termii for delivery status - try multiple endpoints
        const timestamp = new Date().toISOString();
        const endpoints = [
          `${smsCfg.baseUrl}/api/sms/message/${messageId}?api_key=${encodeURIComponent(smsCfg.apiKey)}`,
          `${smsCfg.baseUrl}/api/sms/message?message_id=${messageId}&api_key=${encodeURIComponent(smsCfg.apiKey)}`,
          `${smsCfg.baseUrl}/api/message-status?message_id=${messageId}&api_key=${encodeURIComponent(smsCfg.apiKey)}`
        ];

        let termiiStatus = null;
        let termiiResponse = null;
        let successfulUrl = null;

        for (const url of endpoints) {
          const cleanUrl = url.replace(smsCfg.apiKey, '***');
          console.log(`[SMS STATUS CHECK] ${timestamp} - Trying endpoint: ${cleanUrl}`);

          try {
            const resp = await fetch(url);
            const data = await resp.json().catch(() => ({}));

            console.log(`[SMS STATUS CHECK] ${timestamp} - Response (${resp.status}): ${JSON.stringify(data)}`);

            // Parse various response formats from Termii
            if (data?.delivery_status) {
              termiiStatus = String(data.delivery_status);
              termiiResponse = data;
              successfulUrl = cleanUrl;
              break;
            } else if (data?.status && data.status !== '404' && !data.status?.includes('not found')) {
              termiiStatus = String(data.status);
              termiiResponse = data;
              successfulUrl = cleanUrl;
              break;
            } else if (data?.message_status) {
              termiiStatus = String(data.message_status);
              termiiResponse = data;
              successfulUrl = cleanUrl;
              break;
            }
          } catch (e) {
            console.warn(`[SMS STATUS CHECK] ${timestamp} - Endpoint error: ${e.message}`);
          }
        }

        if (termiiStatus) {
          // Normalize the status before storing
          const normalizedStatus = normalizeDeliveryStatus(termiiStatus);

          // Update our database with the normalized status from Termii
          await db.prepare(
            'UPDATE sms_logs SET delivery_status = ? WHERE message_id = ?'
          ).bind(normalizedStatus, messageId).run();

          console.log(`[SMS STATUS CHECK] ${timestamp} - Updated delivery_status to: ${normalizedStatus} (raw: ${termiiStatus})`);

          return json({
            ok: true,
            message_id: messageId,
            termii_status: normalizedStatus,
            local_status: smsLog.delivery_status,
            updated: true,
            message: `Status updated from Termii: ${normalizedStatus}`,
            source: successfulUrl
          });
        } else {
          // Termii didn't return a clear status
          console.warn(`[SMS STATUS CHECK] ${timestamp} - Could not get status from any Termii endpoint`);

          return json({
            ok: false,
            message_id: messageId,
            local_status: smsLog.delivery_status,
            updated: false,
            message: 'Could not retrieve delivery status from Termii API. The message_id may not exist in Termii\'s system, or the API endpoint format may have changed.',
            termii_response: termiiResponse,
            endpoints_tried: endpoints.length,
            hint: 'This could mean: (1) Termii has no record of this message, (2) Termii API endpoint has changed, or (3) The message was never actually sent to Termii'
          });
        }
      } catch (e) {
        console.error(`[SMS STATUS CHECK] ${new Date().toISOString()} - ERROR: ${e.message}`, e);
        return json({
          ok: false,
          error: e.message,
          message: 'Failed to query Termii for status'
        }, 500);
      }
    }

    // ── POST /api/sms/send — send a manual SMS to a transaction's phone ──
    if (path === 'sms/send' && method === 'POST') {
      const auth = requireAuth(request);
      if (auth.error) return auth.error;
      const { ref: txRef, message: customMsg, phone: customPhone } = await request.json();
      if (!txRef) return error('ref is required', 400);

      const smsCfg = await loadSmsConfig();
      if (!smsCfg.apiKey) return error('Termii API key not configured in Settings.', 400);
      if (!smsCfg.enabled) return error('SMS is disabled. Enable it in Settings → SMS.', 400);

      const txRow = await db.prepare('SELECT data FROM transactions WHERE ref = ?').bind(txRef).first();
      if (!txRow) return error('Transaction not found', 404);
      const txData = JSON.parse(txRow.data);

      const rawPhone = customPhone || txData.phoneNumbers?.[0] || '';
      if (!rawPhone) return error('No phone number for this transaction.', 400);
      const phone = toIntlPhone(rawPhone);

      const fmtN = (n) => '₦' + Number(n || 0).toLocaleString('en-NG');
      const message = customMsg || fillSmsTemplate(smsCfg.tmplDueReminder, {
        customerName: txData.fullName,
        ref: txRef,
        amount: fmtN(txData.cashAdvance),
        dueDate: txData.deadlineDate || '',
        businessName: smsCfg.businessName,
        shopPhone: smsCfg.shopPhone,
      });

      const { ok, messageId, response, usedFallback, primaryResponse } = await termiiSend(smsCfg, phone, message);
      const inserted = await insertSmsLog({
        transactionRef: txRef,
        triggerType: 'manual',
        message,
        recipient: phone,
        status: ok ? 'sent' : 'failed',
        termiiResponse: JSON.stringify(response),
        messageId,
      });

      await logActivity({
        user: auth.user, action: 'sms', entityType: 'transaction', entityId: txRef,
        description: `📱 Manual SMS ${ok ? 'sent' : 'failed'}${usedFallback ? ' (via N-Alert fallback)' : ''} to ${phone} for ${txRef}`,
      });
      return json({ ok, logId: inserted.meta.last_row_id, response, usedFallback, primaryResponse });
    }

    // ── POST /api/sms/test-send — diagnostic: send a test SMS and return full Termii response ──
    if (path === 'sms/test-send' && method === 'POST') {
      const auth = requireAuth(request);
      if (auth.error) return auth.error;
      const { phone: rawPhone } = await request.json();
      if (!rawPhone) return error('phone is required', 400);

      const smsCfg = await loadSmsConfig();
      if (!smsCfg.apiKey) return error('Termii API key not configured in Settings.', 400);

      const phone = toIntlPhone(rawPhone);
      const message = `${smsCfg.businessName}: This is a test SMS from your CIF Cash app. If you received this, your Termii configuration is working!`;
      const { ok, messageId, response, usedFallback, primaryResponse } = await termiiSend(smsCfg, phone, message);

      // Log the test SMS to sms_logs so it can be tracked
      const inserted = await insertSmsLog({
        transactionRef: 'TEST-SMS',
        triggerType: 'test_send',
        message,
        recipient: phone,
        status: ok ? 'sent' : 'failed',
        termiiResponse: JSON.stringify(response),
        messageId,
      });

      return json({
        ok,
        messageId,
        logId: inserted.meta.last_row_id,
        response,
        usedFallback,
        primaryResponse,
        debug: {
          to: phone,
          from: smsCfg.senderId,
          channel: smsCfg.channel,
          baseUrl: smsCfg.baseUrl,
          apiKeyPrefix: smsCfg.apiKey.slice(0, 8) + '…',
        },
      });
    }


    // ── POST /api/sms/notify-stakeholder — send a capital alert SMS to a stakeholder (no txRef required) ──
    if (path === 'sms/notify-stakeholder' && method === 'POST') {
      const auth = requireAuth(request);
      if (auth.error) return auth.error;
      const { phone: rawPhone, message, stakeholderName } = await request.json();
      if (!rawPhone) return error('phone is required', 400);
      if (!message) return error('message is required', 400);

      const smsCfg = await loadSmsConfig();
      if (!smsCfg.apiKey) return error('Termii API key not configured in Settings.', 400);
      if (!smsCfg.enabled) return error('SMS is disabled. Enable it in Settings → SMS.', 400);

      const phone = toIntlPhone(rawPhone);
      if (!phone) return error('Invalid phone number format.', 400);

      const { ok, messageId, response, usedFallback, primaryResponse } = await termiiSend(smsCfg, phone, message);

      await insertSmsLog({
        transactionRef: 'CAPITAL-ALERT',
        triggerType: 'capital_alert',
        message,
        recipient: phone,
        status: ok ? 'sent' : 'failed',
        termiiResponse: JSON.stringify(response),
        messageId,
      });

      await logActivity({
        user: auth.user, action: 'sms', entityType: 'capital', entityId: 'CAPITAL-ALERT',
        description: `📱 Capital alert SMS ${ok ? 'sent' : 'failed'} to ${stakeholderName || phone} (${phone})`,
      });

      return json({ ok, messageId, response, usedFallback, primaryResponse });
    }

    if (path === 'sms/auto-send' && method === 'POST') {
      // Accept either a valid session cookie (staff/admin UI call) OR the X-Cron-Secret
      // header (Cloudflare Cron Worker call). This lets a companion scheduled Worker
      // trigger auto-send daily without needing a browser session.
      const cronSecret = env.CRON_SECRET;
      const incomingSecret = request.headers.get('X-Cron-Secret');
      const isCronCall = !!(cronSecret && incomingSecret && cronSecret === incomingSecret);
      let authUser = null;
      if (!isCronCall) {
        const auth = requireAuth(request);
        if (auth.error) return auth.error;
        authUser = auth.user;
      }

      const smsCfg = await loadSmsConfig();
      if (!smsCfg.apiKey) return json({ skipped: true, reason: 'Termii API key not configured.' });
      if (!smsCfg.enabled) return json({ skipped: true, reason: 'Automated SMS is disabled.' });

      // NCC policy: operators block delivery of SMS between 8:00 PM and 8:00 AM Nigeria time.
      // Skip auto-send outside that window to avoid failed/rejected messages.
      const nigeriaHour = Number(new Intl.DateTimeFormat('en-NG', { timeZone: 'Africa/Lagos', hour: 'numeric', hour12: false }).format(new Date()));
      if (nigeriaHour < 8 || nigeriaHour >= 20) {
        return json({ skipped: true, reason: 'quiet_hours', detail: 'NCC policy restricts SMS delivery between 8 PM and 8 AM Nigeria time.' });
      }

      const today = todayNigeria();
      const { results: activeTxs } = await db.prepare(
        "SELECT ref, data FROM transactions WHERE status IN ('active', 'overdue')"
      ).all();

      const fmtN = (n) => '₦' + Number(n || 0).toLocaleString('en-NG');
      const sent = [], failed = [], skipped = [];

      for (const row of activeTxs) {
        const txData = JSON.parse(row.data);
        if (txData.type !== 'advance') { skipped.push({ ref: row.ref, reason: 'not_advance' }); continue; }

        const rawPhone = txData.phoneNumbers?.[0] || '';
        if (!rawPhone) { skipped.push({ ref: row.ref, reason: 'no_phone' }); continue; }
        const phone = toIntlPhone(rawPhone);
        const rawPhone2 = txData.phoneNumbers?.[1] || '';
        const phone2 = rawPhone2 && rawPhone2 !== rawPhone ? toIntlPhone(rawPhone2) : null;

        const internalDeadline = addDaysToDate(txData.dateGiven, smsCfg.maxLoanDays);
        const customerDueDate  = txData.deadlineDate || addDaysToDate(txData.dateGiven, Number(txData.loanDays) || smsCfg.maxLoanDays);

        // Build the list of (triggerType, template, daysLeft) tuples for today
        const triggers = [];

        // Due-date reminders
        for (const daysBefore of smsCfg.dueDateDays) {
          const triggerDate = addDaysToDate(customerDueDate, -daysBefore);
          if (triggerDate === today) {
            const triggerType = daysBefore === 0 ? 'due_today' : `due_${daysBefore}d`;
            triggers.push({
              triggerType,
              message: fillSmsTemplate(daysBefore === 0 ? smsCfg.tmplDueToday : smsCfg.tmplDueReminder, {
                customerName: txData.fullName,
                ref: row.ref,
                amount: fmtN(txData.cashAdvance),
                daysLeft: daysBefore,
                dueDate: customerDueDate,
                businessName: smsCfg.businessName,
                shopPhone: smsCfg.shopPhone,
              }),
            });
          }
        }

        // Ownership reminders
        for (const daysBefore of smsCfg.ownershipDays) {
          const triggerDate = addDaysToDate(internalDeadline, -daysBefore);
          if (triggerDate === today) {
            const triggerType = daysBefore === 0 ? 'ownership_today' : `ownership_${daysBefore}d`;
            // Avoid double-firing if due-date and ownership reminders land on the same day with the same ref
            if (!triggers.find(t => t.triggerType === triggerType)) {
              triggers.push({
                triggerType,
                message: fillSmsTemplate(daysBefore === 0 ? smsCfg.tmplOwnToday : smsCfg.tmplOwnReminder, {
                  customerName: txData.fullName,
                  ref: row.ref,
                  amount: fmtN(txData.cashAdvance),
                  daysLeft: daysBefore,
                  dueDate: customerDueDate,
                  businessName: smsCfg.businessName,
                  shopPhone: smsCfg.shopPhone,
                }),
              });
            }
          }
        }

        // Ownership-transferred receipt: fires the day AFTER the internal deadline (ownership day + 1)
        const dayAfterDeadline = addDaysToDate(internalDeadline, 1);
        if (dayAfterDeadline === today && smsCfg.ownTransferredEnabled) {
          const dailyFee = Math.floor((txData.cashAdvance || 0) * smsCfg.interestRate / 100);
          const settlementAmount = (txData.cashAdvance || 0) + smsCfg.maxLoanDays * dailyFee;
          triggers.push({
            triggerType: 'ownership_transferred',
            message: fillSmsTemplate(smsCfg.tmplOwnTransferred, {
              customerName: txData.fullName,
              ref: row.ref,
              amount: fmtN(settlementAmount),
              dueDate: customerDueDate,
              businessName: smsCfg.businessName,
              shopPhone: smsCfg.shopPhone,
            }),
          });
        }

        // Shared balance calculation for overdue and mid-loan triggers.
        // Computed once per transaction to avoid duplication.
        const dailyFeeAmt = Math.floor((txData.cashAdvance || 0) * smsCfg.interestRate / 100);
        const elapsedDays = effectiveElapsedDaysSince(txData, { maxLoanDays: smsCfg.maxLoanDays, graceDays: smsCfg.graceDays });
        const currentBalance = (txData.cashAdvance || 0) + elapsedDays * dailyFeeAmt;

        // Overdue reminders: fired N days AFTER the customer due date while still
        // within the internal deadline. Gives daysOverdue and the current balance.
        for (const daysAfter of smsCfg.overdueReminderDays) {
          if (daysAfter < 1) continue; // guard: overdue reminders must be after due date
          const triggerDate = addDaysToDate(customerDueDate, daysAfter);
          // Only fire if still within the internal deadline window
          if (triggerDate === today && today <= internalDeadline) {
            triggers.push({
              triggerType: `overdue_${daysAfter}d`,
              message: fillSmsTemplate(smsCfg.tmplOverdueReminder, {
                customerName: txData.fullName,
                ref: row.ref,
                amount: fmtN(txData.cashAdvance),
                daysOverdue: daysAfter,
                dueDate: customerDueDate,
                balanceToday: fmtN(currentBalance),
                businessName: smsCfg.businessName,
                shopPhone: smsCfg.shopPhone,
              }),
            });
          }
        }

        // Mid-loan balance reminder: fired at the midpoint of the loan duration,
        // only if still before the customer's due date (no point sending mid-loan
        // after they're already overdue).
        // Uses Math.floor so the reminder fires slightly before the exact midpoint,
        // giving the customer as much advance notice as possible.
        if (smsCfg.midLoanReminderEnabled) {
          const effectiveLoanDays = Number(txData.loanDays) || smsCfg.maxLoanDays;
          const midpointDay = Math.floor(effectiveLoanDays / 2);
          if (midpointDay >= 1) {
            const midpointDate = addDaysToDate(txData.dateGiven, midpointDay);
            if (midpointDate === today && today < customerDueDate) {
              triggers.push({
                triggerType: 'mid_loan',
                message: fillSmsTemplate(smsCfg.tmplMidLoanReminder, {
                  customerName: txData.fullName,
                  ref: row.ref,
                  amount: fmtN(txData.cashAdvance),
                  dueDate: customerDueDate,
                  balanceToday: fmtN(currentBalance),
                  businessName: smsCfg.businessName,
                  shopPhone: smsCfg.shopPhone,
                }),
              });
            }
          }
        }

        for (const { triggerType, message } of triggers) {
          // Idempotency: skip if already sent today (Nigeria date) for this trigger
          const alreadySent = await db.prepare(
            "SELECT id FROM sms_logs WHERE transaction_ref = ? AND trigger_type = ? AND date(sent_at, '+1 hour') = ?"
          ).bind(row.ref, triggerType, today).first();
          if (alreadySent) { skipped.push({ ref: row.ref, triggerType, reason: 'already_sent_today' }); continue; }

          const { ok, messageId, response, usedFallback } = await termiiSend(smsCfg, phone, message);
          await insertSmsLog({
            transactionRef: row.ref,
            triggerType,
            message,
            recipient: phone,
            status: ok ? 'sent' : 'failed',
            termiiResponse: JSON.stringify(response),
            messageId,
          });

          (ok ? sent : failed).push({ ref: row.ref, triggerType, phone, usedFallback });

          // Also send to phone 2 if provided and different from phone 1
          if (phone2) {
            const { ok: ok2, messageId: messageId2, response: response2, usedFallback: usedFallback2 } = await termiiSend(smsCfg, phone2, message);
            await insertSmsLog({
              transactionRef: row.ref,
              triggerType: triggerType + '_phone2',
              message,
              recipient: phone2,
              status: ok2 ? 'sent' : 'failed',
              termiiResponse: JSON.stringify(response2),
              messageId: messageId2,
            });

            (ok2 ? sent : failed).push({ ref: row.ref, triggerType: triggerType + '_phone2', phone: phone2, usedFallback: usedFallback2 });
          }
        }
      }

      if (sent.length > 0) {
        await logActivity({
          user: authUser || { id: 'system', role: 'system', name: 'System' }, action: 'sms', entityType: 'settings', entityId: 'auto',
          description: `📱 Auto-SMS run: ${sent.length} sent, ${failed.length} failed, ${skipped.length} skipped`,
        });
      }

      // ── Retry failed SMS from previous days ──
      // Any SMS that failed (not a _retry or _phone2 attempt) within the past
      // smsRetryDays days is re-attempted once, using a separate trigger_type
      // suffix so it is logged and idempotency is preserved.
      if (smsCfg.smsRetryEnabled) {
        const retryAfterDate = addDaysToDate(today, -smsCfg.smsRetryDays);
        const { results: failedLogs } = await db.prepare(
          "SELECT id, transaction_ref, trigger_type, recipient, message FROM sms_logs WHERE status = 'failed' AND trigger_type NOT LIKE '%_retry' AND trigger_type NOT LIKE '%_phone2' AND date(sent_at, '+1 hour') >= ? AND date(sent_at, '+1 hour') < ?"
        ).bind(retryAfterDate, today).all();

        // Deduplicate: only retry each (ref, trigger_type) pair once per run
        const seen = new Set();
        for (const log of (failedLogs || [])) {
          const key = `${log.transaction_ref}:${log.trigger_type}`;
          if (seen.has(key)) continue;
          seen.add(key);

          // Skip if a successful send for this ref+trigger_type already exists
          const succeeded = await db.prepare(
            "SELECT id FROM sms_logs WHERE transaction_ref = ? AND trigger_type = ? AND status = 'sent'"
          ).bind(log.transaction_ref, log.trigger_type).first();
          if (succeeded) continue;

          // Skip if a retry was already attempted today
          const retryType = log.trigger_type + '_retry';
          const alreadyRetried = await db.prepare(
            "SELECT id FROM sms_logs WHERE transaction_ref = ? AND trigger_type = ? AND date(sent_at, '+1 hour') = ?"
          ).bind(log.transaction_ref, retryType, today).first();
          if (alreadyRetried) continue;

          const { ok: retryOk, messageId: retryMsgId, response: retryResp } = await termiiSend(smsCfg, log.recipient, log.message);
          await insertSmsLog({
            transactionRef: log.transaction_ref,
            triggerType: retryType,
            message: log.message,
            recipient: log.recipient,
            status: retryOk ? 'sent' : 'failed',
            termiiResponse: JSON.stringify(retryResp),
            messageId: retryMsgId,
          });

          (retryOk ? sent : failed).push({ ref: log.transaction_ref, triggerType: retryType, phone: log.recipient, isRetry: true });
        }
      }

      return json({ ok: true, sent, failed, skipped });
    }

    // ── POST /api/sms/webhook — Termii delivery receipt (DLR) callback ──
    // No authentication required — Termii calls this URL directly.
    // Configure this URL in your Termii dashboard: <your-app-domain>/api/sms/webhook
    if (path === 'sms/webhook' && method === 'POST') {
      try {
        const payload = await request.json().catch(() => ({}));
        // Termii DLR payload: { message_id, status, time, ... }
        const messageId = payload?.message_id ? String(payload.message_id) : null;
        const deliveryStatus = payload?.status ? String(payload.status) : null;
        const timestamp = new Date().toISOString();

        // Log webhook received
        console.log(`[SMS WEBHOOK] ${timestamp} - Received DLR: message_id=${messageId}, raw_status=${deliveryStatus}, full_payload=${JSON.stringify(payload)}`);

        if (!messageId || !deliveryStatus) {
          console.error(`[SMS WEBHOOK] ${timestamp} - ERROR: Missing required fields. message_id=${messageId}, status=${deliveryStatus}`);
          return json({ ok: false, error: 'Missing message_id or status' }, 400);
        }

        // Normalize the delivery status to a standard format
        const normalizedStatus = normalizeDeliveryStatus(deliveryStatus);

        // Update database with normalized delivery status
        const result = await db.prepare(
          "UPDATE sms_logs SET delivery_status = ? WHERE message_id = ?"
        ).bind(normalizedStatus, messageId).run();

        // Log the result
        if (result.success) {
          console.log(`[SMS WEBHOOK] ${timestamp} - SUCCESS: Updated message_id=${messageId} to status=${normalizedStatus} (raw: ${deliveryStatus})`);
        } else {
          console.warn(`[SMS WEBHOOK] ${timestamp} - WARNING: Database update may have failed. message_id=${messageId}, result=${JSON.stringify(result)}`);
        }

        // Verify the update worked by querying the record
        const updated = await db.prepare(
          "SELECT id, delivery_status FROM sms_logs WHERE message_id = ? LIMIT 1"
        ).bind(messageId).first();

        if (updated?.delivery_status === normalizedStatus) {
          console.log(`[SMS WEBHOOK] ${timestamp} - VERIFIED: Database record confirmed. message_id=${messageId} now has delivery_status=${normalizedStatus}`);
          return json({ ok: true, verified: true });
        } else {
          console.error(`[SMS WEBHOOK] ${timestamp} - ERROR: Database update not verified. message_id=${messageId}, expected=${normalizedStatus}, found=${updated?.delivery_status}`);
          return json({ ok: true, warning: 'Database update may not have succeeded' });
        }
      } catch (e) {
        console.error(`[SMS WEBHOOK] ${new Date().toISOString()} - EXCEPTION: ${e.message}`, e);
        return json({ ok: false, error: e.message }, 500);
      }
    }

    // ============================================================
    // API USAGE TRACKING: GET /api/usage, POST /api/usage/track
    // Persists Gemini and SerpApi usage counts in D1 so they
    // survive app re-deployments and work across devices/browsers.
    // RPM timestamps are ephemeral and intentionally not persisted.
    // ============================================================
    if (path === 'usage' && method === 'GET') {
      const auth = requireAuth(request);
      if (auth.error) return auth.error;
      const row = await db.prepare("SELECT value FROM settings WHERE key = 'api_usage'").first();
      return json(row ? JSON.parse(row.value) : {});
    }

    if (path === 'usage/track' && method === 'POST') {
      const auth = requireAuth(request);
      if (auth.error) return auth.error;
      const { service, date, month, count = 1 } = await request.json();
      if (!service) return error('Missing service');
      if (service === 'gemini' && !date) return error('Missing date for gemini');
      if (service === 'serpapi' && !month) return error('Missing month for serpapi');
      if (service === 'serpApiAi' && !month) return error('Missing month for serpApiAi');

      const row = await db.prepare("SELECT value FROM settings WHERE key = 'api_usage'").first();
      const usage = row ? JSON.parse(row.value) : {};

      if (service === 'gemini') {
        if (!usage.gemini) usage.gemini = {};
        usage.gemini[date] = (usage.gemini[date] || 0) + 1;
        // Keep last 7 days only
        const keys = Object.keys(usage.gemini).sort();
        if (keys.length > 7) { for (const k of keys.slice(0, -7)) delete usage.gemini[k]; }
      } else if (service === 'serpapi') {
        if (!usage.serpapi) usage.serpapi = {};
        usage.serpapi[month] = (usage.serpapi[month] || 0) + Number(count);
        // Keep last 3 months only
        const keys = Object.keys(usage.serpapi).sort();
        if (keys.length > 3) { for (const k of keys.slice(0, -3)) delete usage.serpapi[k]; }
      } else if (service === 'serpApiAi') {
        if (!usage.serpApiAi) usage.serpApiAi = {};
        usage.serpApiAi[month] = (usage.serpApiAi[month] || 0) + Number(count);
        // Keep last 3 months only
        const keys = Object.keys(usage.serpApiAi).sort();
        if (keys.length > 3) { for (const k of keys.slice(0, -3)) delete usage.serpApiAi[k]; }
      } else {
        return error('Unknown service');
      }

      await db
        .prepare("INSERT INTO settings (key, value, updated_at) VALUES ('api_usage', ?, datetime('now')) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')")
        .bind(JSON.stringify(usage))
        .run();
      return json({ success: true });
    }

    // ============================================================
    // SERPAPI ACCOUNT INFO: GET /api/serpapi-account
    // Proxies to serpapi.com/account.json using the stored key.
    // Returns live usage and plan limits. Does not consume quota.
    // ============================================================
    if (path === 'serpapi-account' && method === 'GET') {
      const auth = requireAuth(request);
      if (auth.error) return auth.error;
      const row = await db.prepare("SELECT value FROM settings WHERE key = 'config'").first();
      const cfg = row ? JSON.parse(row.value) : {};
      const apiKey = cfg.serpApiKey;
      if (!apiKey) return error('No SerpApi key configured', 400);
      const resp = await fetch(`https://serpapi.com/account.json?api_key=${encodeURIComponent(apiKey)}`);
      const data = await resp.json().catch(() => null);
      if (!resp.ok) return error(data?.error || `SerpApi account request failed with status ${resp.status}`, resp.status);
      return json({
        this_month_usage: data.this_month_usage ?? 0,
        searches_per_month: data.searches_per_month ?? 0,
        plan_searches_left: data.plan_searches_left ?? 0,
        total_searches_left: data.total_searches_left ?? 0,
        plan_name: data.plan_name ?? '',
      });
    }

    // ============================================================
    // SERPAPI AI ACCOUNT INFO: GET /api/serpapi-ai-account
    // Proxies to serpapi.com/account.json using the stored AI key.
    // Returns live usage and plan limits. Does not consume quota.
    // ============================================================
    if (path === 'serpapi-ai-account' && method === 'GET') {
      const auth = requireAuth(request);
      if (auth.error) return auth.error;
      const row = await db.prepare("SELECT value FROM settings WHERE key = 'config'").first();
      const cfg = row ? JSON.parse(row.value) : {};
      const apiKey = cfg.serpApiAiKey;
      if (!apiKey) return error('No SerpApi AI key configured', 400);
      const resp = await fetch(`https://serpapi.com/account.json?api_key=${encodeURIComponent(apiKey)}`);
      const data = await resp.json().catch(() => null);
      if (!resp.ok) return error(data?.error || `SerpApi AI account request failed with status ${resp.status}`, resp.status);
      return json({
        this_month_usage: data.this_month_usage ?? 0,
        searches_per_month: data.searches_per_month ?? 0,
        plan_searches_left: data.plan_searches_left ?? 0,
        total_searches_left: data.total_searches_left ?? 0,
        plan_name: data.plan_name ?? '',
      });
    }

    // ============================================================
    // SERPAPI GOOGLE LENS PROXY: POST /api/serpapi-lens
    // Accepts { imageUrl, apiKey } and proxies to SerpApi to keep
    // the key server-side. Requires a valid authenticated session.
    // ============================================================
    if (path === 'serpapi-lens' && method === 'POST') {
      const auth = requireAuth(request);
      if (auth.error) return auth.error;
      const { imageUrl, apiKey } = await request.json();
      if (!apiKey) return error('No SerpApi key provided');
      if (!imageUrl || !imageUrl.startsWith('https://')) return error('A valid HTTPS image URL is required');
      const serpUrl = new URL('https://serpapi.com/search.json');
      serpUrl.searchParams.set('engine', 'google_lens');
      serpUrl.searchParams.set('url', imageUrl);
      serpUrl.searchParams.set('api_key', apiKey);
      const resp = await fetch(serpUrl.toString());
      const data = await resp.json().catch(() => null);
      if (!resp.ok) return error(data?.error || data?.message || `SerpApi request failed with status ${resp.status}`, resp.status);
      return json({
        visual_matches: data.visual_matches || [],
        text_results: data.text_results || [],
        knowledge_graph: data.knowledge_graph || null,
      });
    }

    // ============================================================
    // SERPAPI GOOGLE AI MODE PROXY: POST /api/serpapi-ai
    // Accepts { query, apiKey } and proxies to SerpApi using the
    // google_ai_mode engine (Google's AI Mode / conversational AI).
    // Returns text_blocks (AI answer) and references for analysis.
    // ============================================================
    if (path === 'serpapi-ai' && method === 'POST') {
      const auth = requireAuth(request);
      if (auth.error) return auth.error;
      const { query, apiKey } = await request.json();
      if (!apiKey) return error('No SerpApi AI key provided');
      if (!query) return error('No query provided');
      const serpUrl = new URL('https://serpapi.com/search.json');
      serpUrl.searchParams.set('engine', 'google_ai_mode');
      serpUrl.searchParams.set('q', query);
      serpUrl.searchParams.set('gl', 'ng');
      serpUrl.searchParams.set('hl', 'en');
      serpUrl.searchParams.set('no_cache', 'true');
      serpUrl.searchParams.set('api_key', apiKey);
      const resp2 = await fetch(serpUrl.toString());
      const data2 = await resp2.json().catch(() => null);
      if (!resp2.ok) return error(data2?.error || data2?.message || `SerpApi request failed with status ${resp2.status}`, resp2.status);
      return json({
        text_blocks: data2.text_blocks || [],
        references: (data2.references || []).slice(0, 5).map(r => ({ title: r.title || '', link: r.link || '' })),
      });
    }

    // ── GET /api/distribution-decisions — list decisions with optional filters ──
    if (path === 'distribution-decisions' && method === 'GET') {
      try {
        const auth = requireAuth(request);
        if (auth.error) return auth.error;
        const period = url.searchParams.get('period');
        const stakeholder = url.searchParams.get('stakeholder');
        const unpaid = url.searchParams.get('unpaid') === 'true';
        const decisionFilter = url.searchParams.get('decision'); // e.g. 'distribute_all,reinvest_and_distribute'
        const isAdmin = auth.user.role === 'admin';
        let isStakeholder = false;
        try { isStakeholder = (JSON.parse(auth.user.roles || '[]')).includes('stakeholder'); } catch (_) {}
        isStakeholder = isStakeholder || auth.user.role === 'stakeholder';
        if (!isAdmin && !isStakeholder) return error('Not authorized', 403);

        let sql = 'SELECT * FROM distribution_decisions WHERE 1=1';
        const params = [];
        if (period) { sql += ' AND period = ?'; params.push(period); }
        if (stakeholder) { sql += ' AND stakeholder_name = ?'; params.push(stakeholder); }
        if (unpaid) { sql += ' AND paid_at IS NULL'; }
        if (decisionFilter) {
          const vals = decisionFilter.split(',').map(v => v.trim()).filter(Boolean);
          if (vals.length > 0) { sql += ` AND decision IN (${vals.map(() => '?').join(',')})`; params.push(...vals); }
        }
        if (!isAdmin) { sql += ' AND user_id = ?'; params.push(auth.user.id); }
        sql += ' ORDER BY period DESC, stakeholder_name';

        const stmt = db.prepare(sql);
        const rows = (await (params.length > 0 ? stmt.bind(...params) : stmt).all()).results;
        return json({ decisions: rows || [] });
      } catch (e) {
        return error('distribution-decisions GET failed: ' + (e?.message || String(e)), 500);
      }
    }

    // ── POST /api/distribution-decisions/generate — generate decisions for a period (admin only) ──
    if (path === 'distribution-decisions/generate' && method === 'POST') {
      const auth = requireAuth(request);
      if (auth.error) return auth.error;
      if (auth.user.role !== 'admin') return error('Admin only', 403);

      const { period, stakeholders: stakeData, sendSms, capitalSurplus } = await request.json();
      // stakeData: [{ user_id, name, profitAmount, capitalDays, totalCapitalDays, reinvestAmount, distributeAmount, systemNote }]
      if (!period || !Array.isArray(stakeData) || stakeData.length === 0) return error('period and stakeholders[] required', 400);

      const existing = (await db.prepare('SELECT COUNT(*) as cnt FROM distribution_decisions WHERE period = ?').bind(period).first());
      if (existing.cnt > 0) return error(`Decisions already exist for ${period}. Delete them first to regenerate.`, 400);

      const row = await db.prepare("SELECT value FROM settings WHERE key = 'config'").first();
      const cfg = row ? JSON.parse(row.value) : {};
      const deadlineDays = Math.max(1, Number(cfg.distributionDeadlineDays) || 3);
      const today = todayNigeria();
      const deadline = addDaysToDate(today, deadlineDays);

      const insertStmt = db.prepare(
        'INSERT INTO distribution_decisions (period, user_id, stakeholder_name, profit_amount, capital_days, total_capital_days, reinvest_amount, distribute_amount, capital_surplus, system_note, deadline) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      );
      const batch = [];
      for (const s of stakeData) {
        batch.push(insertStmt.bind(
          period, s.user_id, s.name, s.profitAmount, s.capitalDays, s.totalCapitalDays,
          s.reinvestAmount || 0, s.distributeAmount || s.profitAmount,
          s.capitalSurplus ? 1 : 0, s.systemNote || null, deadline
        ));
      }
      await db.batch(batch);

      // Send SMS to each stakeholder
      const smsResults = [];
      if (sendSms) {
        const smsCfg = await loadSmsConfig();
        if (smsCfg.apiKey && smsCfg.enabled && cfg.smsMonthlyProfitEnabled !== false) {
          const tmpl = cfg.smsMonthlyProfitTemplate || '{businessName} — Your profit for {period} is {profitAmount}. Log in to the app to see your options. If no response by {deadline}, your expected contribution will be reinvested automatically. Questions? Call {adminPhone}';
          const soConfig = cfg.stakeholderOwnership || {};
          for (const s of stakeData) {
            const stakeConfig = soConfig[s.name] || {};
            const phone = stakeConfig.phone;
            if (!phone) { smsResults.push({ name: s.name, status: 'skipped', reason: 'no_phone' }); continue; }
            const fmtN = (n) => '₦' + Number(n || 0).toLocaleString('en-NG');
            const msg = tmpl
              .replace(/\{businessName\}/g, cfg.businessName || 'CIF Quick Cash')
              .replace(/\{period\}/g, period)
              .replace(/\{profitAmount\}/g, fmtN(s.profitAmount))
              .replace(/\{deadline\}/g, deadline)
              .replace(/\{adminPhone\}/g, cfg.adminPhone || cfg.shopPhone1 || '')
              .replace(/\{stakeholderName\}/g, s.name);
            const intlPhone = toIntlPhone(phone);
            if (!intlPhone) { smsResults.push({ name: s.name, status: 'skipped', reason: 'invalid_phone' }); continue; }
            const { ok, messageId, response } = await termiiSend(smsCfg, intlPhone, msg);
            await insertSmsLog({
              transactionRef: `PROFIT-${period}`,
              triggerType: 'profit_distribution',
              message: msg,
              recipient: intlPhone,
              status: ok ? 'sent' : 'failed',
              termiiResponse: JSON.stringify(response),
              messageId,
            });
            smsResults.push({ name: s.name, status: ok ? 'sent' : 'failed', messageId });
          }
        }
      }

      await logActivity({
        user: auth.user, action: 'create', entityType: 'distribution_decisions', entityId: period,
        description: `Generated distribution decisions for ${period} — ${stakeData.length} stakeholder(s)${capitalSurplus ? ' (capital surplus)' : ''}${sendSms ? ', SMS sent' : ''}`,
      });

      return json({ ok: true, period, deadline, count: stakeData.length, smsResults });
    }

    // ── POST /api/distribution-decisions/auto-generate — server-side auto-generation for previous month ──
    if (path === 'distribution-decisions/auto-generate' && method === 'POST') {
      try {
        const auth = requireAuth(request);
        if (auth.error) return auth.error;
        if (auth.user.role !== 'admin') return error('Admin only', 403);

        // Determine previous month
        const now = new Date();
        const prevMonth = now.getMonth() === 0 ? 12 : now.getMonth(); // 1-12
        const prevYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
        const period = `${prevYear}-${String(prevMonth).padStart(2, '0')}`;

        // Check if decisions already exist
        const existing = await db.prepare('SELECT COUNT(*) as cnt FROM distribution_decisions WHERE period = ?').bind(period).first();
        if (existing.cnt > 0) return json({ ok: true, skipped: true, reason: `Decisions already exist for ${period}` });

        // Load settings
        const settingsRow = await db.prepare("SELECT value FROM settings WHERE key = 'config'").first();
        const cfg = settingsRow ? JSON.parse(settingsRow.value) : {};

        // Check if auto-generate is enabled (default: true)
        if (cfg.autoGenerateDecisions === false) return json({ ok: true, skipped: true, reason: 'Auto-generate is disabled in settings' });

        // Get capital entries (contributions and withdrawals — withdrawals net out as negative amounts below)
        const capitalRes = await db.prepare('SELECT id, name, amount, date, user_id, type FROM capital ORDER BY date').all();
        const capitalEntries = capitalRes.results || [];
        if (capitalEntries.length === 0) return json({ ok: true, skipped: true, reason: 'No capital entries found' });
        const capSigned = (c) => c.type === 'withdrawal' ? -(c.amount || 0) : (c.amount || 0);

        // Compute capital-days for the period. A withdrawal is just a negative-amount entry
        // dated on its withdrawal date, so it naturally reduces capital-days from that date
        // forward using the same date-weighted formula as a contribution — no special-casing needed.
        const pStart = new Date(Date.UTC(prevYear, prevMonth - 1, 1));
        const pEnd = new Date(Date.UTC(prevYear, prevMonth, 0)); // last day of month
        const byStake = {};
        for (const c of capitalEntries) {
          const key = c.name.toLowerCase();
          if (!byStake[key]) byStake[key] = { name: c.name, user_id: c.user_id, capitalDays: 0, total: 0 };
          const signedAmount = capSigned(c);
          byStake[key].total += signedAmount;
          const entryDate = new Date(c.date);
          if (isNaN(entryDate.getTime())) continue;
          const entryUTC = new Date(Date.UTC(entryDate.getFullYear(), entryDate.getMonth(), entryDate.getDate()));
          if (entryUTC > pEnd) continue;
          const effectiveStart = entryUTC > pStart ? entryUTC : pStart;
          const days = Math.round((pEnd - effectiveStart) / 86400000) + 1;
          byStake[key].capitalDays += signedAmount * days;
        }
        const arr = Object.values(byStake).filter(s => s.user_id);
        const totalCD = arr.reduce((s, x) => s + x.capitalDays, 0);
        if (totalCD <= 0) return json({ ok: true, skipped: true, reason: `No net capital-days for ${period} (contributions and withdrawals may have netted to zero)` });

        // Calculate profit for the period
        const txRes = await db.prepare('SELECT data, status, created_at FROM transactions').all();
        const allTx = (txRes.results || []).map(r => {
          try { const d = JSON.parse(r.data); return { ...d, status: r.status, created_at: r.created_at }; }
          catch { return { status: r.status, created_at: r.created_at }; }
        });
        const inPeriod = (ds) => {
          if (!ds) return false;
          const d = new Date(ds.replace(' ', 'T'));
          return d.getFullYear() === prevYear && d.getMonth() + 1 === prevMonth;
        };
        const periodSold = allTx.filter(t => t.status === 'sold' && inPeriod(t.saleDate || t.updated_at));
        const periodNewLoans = allTx.filter(t => t.type !== 'outright' && t.status !== 'declined' && inPeriod(t.created_at));
        const serviceFee = Number(cfg.serviceFee) || 1000;

        // Revenue = interest fees + sale margins (not full sale price) + service fees.
        // Using sale margin (salePrice − cashAdvance) keeps consistency with loan accounting
        // where only interest is counted, not the principal return.
        const rev = allTx.reduce((s, t) => s + getRecognizedInterest(t, {
          paymentDateFilter: (paymentDate) => inPeriod(paymentDate),
          legacyClosedDateFilter: (closedDate) => inPeriod(closedDate),
        }), 0)
          + periodSold.reduce((s, t) => s + Math.max(0, (t.salePrice || 0) - (t.cashAdvance || 0)), 0)
          + periodNewLoans.reduce((s, t) => s + (t.serviceFeeAmount ?? (t.serviceFeeCollected ? serviceFee : 0)), 0);

        const expRes = await db.prepare('SELECT amount, date FROM expenses').all();
        const periodExp = (expRes.results || []).filter(e => inPeriod(e.date));
        const expT = periodExp.reduce((s, e) => s + (e.amount || 0), 0);

        const profit = rev - expT;
        // Per-stakeholder TOTAL cut % (combined staff + possessor + platform).
        // Setting 0% on any stakeholder fully exempts them. The aggregated cut
        // pool is then split globally by cfg.cutSplit into Staff / Possessor /
        // Platform pools (see below).
        const defaultTotalCutPct = Number(cfg.defaultTotalCutPct ?? 15);
        const cutSplitCfg = cfg.cutSplit || { staffPct: 50, possessorPct: 15, platformPct: 35 };
        const sStaff = Number(cutSplitCfg.staffPct ?? 50);
        const sPoss = Number(cutSplitCfg.possessorPct ?? 15);
        const sPlat = Number(cutSplitCfg.platformPct ?? 35);
        const sTotal = sStaff + sPoss + sPlat || 1;
        if (profit <= 0) return json({ ok: true, skipped: true, reason: `No profit for ${period} (profit: ${profit})` });

        // Determine capital surplus — simplified: available lending capital > total capital needed
        const totalCapital = capitalEntries.reduce((s, c) => s + capSigned(c), 0);
        const activeTx = allTx.filter(t => t.status === 'active');
        const forSaleTx = allTx.filter(t => t.status === 'for_sale' || t.status === 'ready_to_sell');
        const totalOut = activeTx.reduce((s, t) => s + getCurrentOutstandingPrincipal(t), 0);
        const totalInForSale = forSaleTx.reduce((s, t) => s + getCurrentOutstandingPrincipal(t), 0);
        const totalRevAll = allTx.reduce((s, t) => s + getRecognizedInterest(t), 0)
          + allTx.filter(t => t.status === 'sold').reduce((s, t) => s + Math.max(0, (t.salePrice || 0) - (t.cashAdvance || 0)), 0)
          + allTx.filter(t => t.type !== 'outright' && t.status !== 'declined').reduce((s, t) => s + (t.serviceFeeAmount ?? (t.serviceFeeCollected ? serviceFee : 0)), 0);
        const totalExpAll = (expRes.results || []).reduce((s, e) => s + (e.amount || 0), 0);
        const distRes = await db.prepare('SELECT amount FROM profit_distributions').all();
        const totalDistAll = (distRes.results || []).reduce((s, d) => s + (d.amount || 0), 0);
        const availableCapital = totalCapital + totalRevAll - totalExpAll - totalOut - totalInForSale - totalDistAll;
        const isSurplus = availableCapital > totalCapital * 0.5 && availableCapital > 0;

        // Compute expected contributions (simplified three-phase)
        const ownershipCfg = cfg.stakeholderOwnership || {};
        const shortfallAmount = Math.max(0, totalOut + totalInForSale - availableCapital);
        const capBN = arr.map(s => ({ name: s.name, total: s.total }));
        const tcap = capBN.reduce((s, x) => s + x.total, 0);

        // Simplified contribution calculation matching the three-phase logic
        const expectedByName = {};
        if (!isSurplus && shortfallAmount > 0 && tcap > 0) {
          const totalAfter = tcap + shortfallAmount;
          const pool = capBN.map(s => {
            const tgt = ownershipCfg[s.name] || {};
            const targetPct = tgt.targetPercent != null ? tgt.targetPercent : (s.total / tcap * 100);
            const maxPct = tgt.maxPercent ?? 100;
            const targetAmountAfter = totalAfter * targetPct / 100;
            const neededToReachTarget = Math.max(0, targetAmountAfter - s.total);
            const maxCapacity = Math.max(0, totalAfter * maxPct / 100 - s.total);
            return { name: s.name, allowedNeed: Math.min(neededToReachTarget, maxCapacity) };
          });
          const totalNeed = pool.reduce((s, x) => s + x.allowedNeed, 0);
          for (const p of pool) {
            expectedByName[p.name] = totalNeed > 0
              ? Math.round(shortfallAmount * p.allowedNeed / totalNeed)
              : 0;
          }
        }

        // Build stakeholder data — per-stakeholder TOTAL cut % applied to each
        // gross profit allocation, then the aggregated cut pool is split by
        // cutSplit into Staff / Possessor / Platform pools.
        const fmtN = (n) => '₦' + Number(n || 0).toLocaleString('en-NG');
        const platformRecipientUserId = (cfg.platformRecipientUserId || 'admin');
        let totalCutPoolAmount = 0;
        const preStake = arr.map(s => {
          const own = ownershipCfg[s.name] || {};
          let totalCutPct;
          if (own.totalCutPct != null) totalCutPct = Number(own.totalCutPct);
          else if (own.staffCutPct != null || own.platformCutPct != null) totalCutPct = Number(own.staffCutPct || 0) + Number(own.platformCutPct || 0);
          else totalCutPct = defaultTotalCutPct;
          totalCutPct = Math.max(0, Math.min(100, totalCutPct));
          const grossProfit = Math.floor(profit * (s.capitalDays / totalCD));
          const totalCut = Math.max(0, Math.floor(grossProfit * totalCutPct / 100));
          const netProfit = Math.max(0, grossProfit - totalCut);
          totalCutPoolAmount += totalCut;
          return { ...s, grossProfit, totalCut, netProfit, totalCutPct };
        });
        const staffPoolAmount = Math.floor(totalCutPoolAmount * sStaff / sTotal);
        const platformPoolAmount = Math.floor(totalCutPoolAmount * sPlat / sTotal);
        const possessorPoolAmount = Math.max(0, totalCutPoolAmount - staffPoolAmount - platformPoolAmount);

        // Platform fee is folded into the configured recipient's stakeholder line.
        const stakeData = preStake.map(s => {
          const profitAmount = s.netProfit + (s.user_id === platformRecipientUserId ? platformPoolAmount : 0);
          const platformComponent = s.user_id === platformRecipientUserId ? platformPoolAmount : 0;
          const expectedContrib = expectedByName[s.name] || 0;
          const reinvestAmount = isSurplus ? 0 : Math.min(profitAmount, expectedContrib);
          const distributeAmount = profitAmount - reinvestAmount;
          const cutLine = s.totalCut > 0
            ? ` Gross ${fmtN(s.grossProfit)} − total cut ${fmtN(s.totalCut)} (${s.totalCutPct}%) = ${fmtN(s.netProfit)}.`
            : '';
          const platformLine = platformComponent > 0
            ? ` ${cfg.platformCutLabel || 'Platform / License Fee'} pool of ${fmtN(platformComponent)} is added to your line as recipient.`
            : '';
          const baseNote = isSurplus
            ? 'Capital is in surplus — you collect your full profit.'
            : reinvestAmount > 0
              ? `Business needs capital. ${fmtN(reinvestAmount)} will be reinvested (your expected contribution), you collect ${fmtN(distributeAmount)}.`
              : 'No capital shortfall for your share — you collect your full profit.';
          return {
            user_id: s.user_id, name: s.name, capitalDays: s.capitalDays, totalCapitalDays: totalCD,
            profitAmount, reinvestAmount, distributeAmount,
            capitalSurplus: isSurplus ? 1 : 0, systemNote: baseNote + cutLine + platformLine,
          };
        }).filter(s => s.profitAmount > 0);

        if (stakeData.length === 0 && totalCutPoolAmount <= 0) {
          return json({ ok: true, skipped: true, reason: 'No stakeholders with positive profit and no cut pool' });
        }

        // Insert decisions
        const deadlineDays = Math.max(1, Number(cfg.distributionDeadlineDays) || 3);
        const today = todayNigeria();
        const deadline = addDaysToDate(today, deadlineDays);

        const insertStmt = db.prepare(
          'INSERT INTO distribution_decisions (period, user_id, stakeholder_name, profit_amount, capital_days, total_capital_days, reinvest_amount, distribute_amount, capital_surplus, system_note, deadline) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        );
        const batch = [];
        for (const s of stakeData) {
          batch.push(insertStmt.bind(
            period, s.user_id, s.name, s.profitAmount, s.capitalDays, s.totalCapitalDays,
            s.reinvestAmount, s.distributeAmount, s.capitalSurplus, s.systemNote, deadline
          ));
        }
        await db.batch(batch);

        // Send SMS if enabled
        const smsResults = [];
        const smsCfg = await loadSmsConfig();
        if (smsCfg.apiKey && smsCfg.enabled && cfg.smsMonthlyProfitEnabled !== false) {
          const tmpl = cfg.smsMonthlyProfitTemplate || '{businessName} — Your profit for {period} is {profitAmount}. Log in to choose: Collect or Reinvest. If no response by {deadline}, it will be auto-resolved. Questions? Call {adminPhone}';
          const soConfig = cfg.stakeholderOwnership || {};
          for (const s of stakeData) {
            const stakeConfig = soConfig[s.name] || {};
            const phone = stakeConfig.phone;
            if (!phone) { smsResults.push({ name: s.name, status: 'skipped', reason: 'no_phone' }); continue; }
            const msg = tmpl
              .replace(/\{businessName\}/g, cfg.businessName || 'CIF Quick Cash')
              .replace(/\{period\}/g, period)
              .replace(/\{profitAmount\}/g, fmtN(s.profitAmount))
              .replace(/\{deadline\}/g, deadline)
              .replace(/\{adminPhone\}/g, cfg.adminPhone || cfg.shopPhone1 || '')
              .replace(/\{stakeholderName\}/g, s.name);
            const intlPhone = toIntlPhone(phone);
            if (!intlPhone) { smsResults.push({ name: s.name, status: 'skipped', reason: 'invalid_phone' }); continue; }
            const { ok, messageId, response } = await termiiSend(smsCfg, intlPhone, msg);
            await insertSmsLog({
              transactionRef: `PROFIT-${period}`,
              triggerType: 'profit_distribution',
              message: msg,
              recipient: intlPhone,
              status: ok ? 'sent' : 'failed',
              termiiResponse: JSON.stringify(response),
              messageId,
            });
            smsResults.push({ name: s.name, status: ok ? 'sent' : 'failed', messageId });
          }
        }

        const netStakeholderTotal = stakeData.reduce((s, x) => s + x.profitAmount, 0);
        await logActivity({
          user: auth.user, action: 'create', entityType: 'distribution_decisions', entityId: period,
          description: `Auto-generated profit decisions for ${period} — ${stakeData.length} stakeholder(s), net ${fmtN(netStakeholderTotal)}, staff pool ${fmtN(staffPoolAmount)}, ${cfg.platformCutLabel || 'platform'} ${fmtN(platformPoolAmount)}${isSurplus ? ' (surplus)' : ''}`,
        });

        return json({
          ok: true, period, deadline,
          count: stakeData.length,
          profit, staffPoolAmount, platformPoolAmount, netStakeholderTotal,
          smsResults, autoGenerated: true,
        });
      } catch (e) {
        return error('auto-generate failed: ' + (e?.message || String(e)), 500);
      }
    }

    // ── PUT /api/distribution-decisions/:id — update decision (stakeholder or admin) ──
    if (path.startsWith('distribution-decisions/') && !path.includes('generate') && !path.includes('auto-resolve') && method === 'PUT') {
      const auth = requireAuth(request);
      if (auth.error) return auth.error;
      const id = path.split('/')[1];
      const { decision } = await request.json();
      if (!['reinvest_and_distribute', 'distribute_all'].includes(decision)) return error('decision must be "reinvest_and_distribute" or "distribute_all"', 400);

      const row = await db.prepare('SELECT * FROM distribution_decisions WHERE id = ?').bind(id).first();
      if (!row) return error('Decision not found', 404);

      const isAdmin = auth.user.role === 'admin';
      const isOwner = row.user_id === auth.user.id;
      if (!isAdmin && !isOwner) return error('Not authorized', 403);
      if (row.decision !== 'pending' && !isAdmin) return error('Decision already made', 400);

      // Block reinvest if capital is in surplus
      let finalDecision = decision;
      let note = null;
      if (decision === 'reinvest_and_distribute' && row.capital_surplus) {
        finalDecision = 'distribute_all';
        note = 'Capital is healthy — no reinvestment needed. Your full profit will be distributed.';
      }
      // Block reinvest if reinvest_amount is 0
      if (decision === 'reinvest_and_distribute' && (!row.reinvest_amount || row.reinvest_amount <= 0)) {
        finalDecision = 'distribute_all';
        note = note || 'No reinvestment amount calculated for this period. Full profit will be distributed.';
      }

      const now = new Date().toISOString();
      await db.prepare('UPDATE distribution_decisions SET decision = ?, decided_at = ?, auto_decided = 0, system_note = COALESCE(?, system_note) WHERE id = ?')
        .bind(finalDecision, now, note, id).run();

      // If reinvest_and_distribute, create capital entry for reinvest_amount only
      if (finalDecision === 'reinvest_and_distribute' && row.reinvest_amount > 0) {
        const [pYear, pMonth] = row.period.split('-').map(Number);
        const reinvestDate = pMonth === 12 ? `${pYear + 1}-01-01` : `${pYear}-${String(pMonth + 1).padStart(2, '0')}-01`;
        await db.prepare('INSERT INTO capital (name, amount, date, method, user_id) VALUES (?, ?, ?, ?, ?)')
          .bind(row.stakeholder_name, row.reinvest_amount, reinvestDate, 'reinvestment', row.user_id).run();
        await logActivity({
          user: auth.user, action: 'create', entityType: 'capital', entityId: null,
          description: `Reinvested ₦${Number(row.reinvest_amount).toLocaleString()} of ${row.stakeholder_name}'s profit from ${row.period} as new capital (${reinvestDate}). ₦${Number(row.distribute_amount).toLocaleString()} for distribution.`,
        });
      }

      const fmtN = (n) => '₦' + Number(n || 0).toLocaleString('en-NG');
      const desc = finalDecision === 'reinvest_and_distribute'
        ? `${row.stakeholder_name}: reinvest ${fmtN(row.reinvest_amount)} + distribute ${fmtN(row.distribute_amount)} from ${row.period}`
        : `${row.stakeholder_name}: distribute all ${fmtN(row.profit_amount)} from ${row.period}`;
      await logActivity({ user: auth.user, action: 'update', entityType: 'distribution_decisions', entityId: String(id), description: desc });

      return json({ ok: true, decision: finalDecision, id, redirected: finalDecision !== decision, message: note });
    }

    // ── POST /api/distribution-decisions/auto-resolve — process expired pending decisions ──
    if (path === 'distribution-decisions/auto-resolve' && method === 'POST') {
      const auth = requireAuth(request);
      if (auth.error) return auth.error;

      const today = todayNigeria();
      const pending = (await db.prepare("SELECT * FROM distribution_decisions WHERE decision = 'pending' AND deadline < ?").bind(today).all()).results;
      if (pending.length === 0) return json({ ok: true, processed: 0 });

      const now = new Date().toISOString();
      let reinvested = 0, distributed = 0;
      for (const row of pending) {
        // If surplus or no reinvest amount → auto-distribute
        if (row.capital_surplus || !row.reinvest_amount || row.reinvest_amount <= 0) {
          const note = row.capital_surplus
            ? 'Capital is healthy — auto-distributed. No reinvestment needed.'
            : 'No reinvestment needed for this period — auto-distributed.';
          await db.prepare('UPDATE distribution_decisions SET decision = ?, decided_at = ?, auto_decided = 1, system_note = ? WHERE id = ?')
            .bind('distribute_all', now, note, row.id).run();
          distributed++;
        } else {
          // Auto-reinvest the expected contribution, distribute the balance
          const note = `Auto-resolved: ₦${Number(row.reinvest_amount).toLocaleString()} reinvested (expected contribution), ₦${Number(row.distribute_amount).toLocaleString()} for distribution.`;
          await db.prepare('UPDATE distribution_decisions SET decision = ?, decided_at = ?, auto_decided = 1, system_note = ? WHERE id = ?')
            .bind('reinvest_and_distribute', now, note, row.id).run();
          const [pYear, pMonth] = row.period.split('-').map(Number);
          const reinvestDate = pMonth === 12 ? `${pYear + 1}-01-01` : `${pYear}-${String(pMonth + 1).padStart(2, '0')}-01`;
          await db.prepare('INSERT INTO capital (name, amount, date, method, user_id) VALUES (?, ?, ?, ?, ?)')
            .bind(row.stakeholder_name, row.reinvest_amount, reinvestDate, 'reinvestment', row.user_id).run();
          reinvested++;
        }
      }

      await logActivity({
        user: auth.user, action: 'update', entityType: 'distribution_decisions', entityId: null,
        description: `Auto-resolved ${pending.length} expired decision(s): ${reinvested} reinvested (partial), ${distributed} distributed`,
      });

      return json({ ok: true, processed: pending.length, reinvested, distributed });
    }

    // ============================================================
    // PUSH SUBSCRIPTIONS: GET /api/push/vapid-public-key
    //                     POST /api/push/subscribe
    //                     DELETE /api/push/unsubscribe
    // ============================================================
    if (path === 'push/vapid-public-key' && method === 'GET') {
      return json({ publicKey: env.VAPID_PUBLIC_KEY || '' });
    }

    if (path === 'push/subscribe' && method === 'POST') {
      const auth = requireAuth(request);
      if (auth.error) return auth.error;
      const body = await request.json();
      const endpoint = body?.endpoint;
      const p256dh = body?.keys?.p256dh;
      const subAuth = body?.keys?.auth;
      if (!endpoint || !p256dh || !subAuth) return error('Missing subscription fields (endpoint, keys.p256dh, keys.auth)');
      await db
        .prepare(
          'INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?) ' +
          'ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, created_at = datetime(\'now\')',
        )
        .bind(auth.user.id, endpoint, p256dh, subAuth)
        .run();
      return json({ success: true });
    }

    if (path === 'push/unsubscribe' && method === 'DELETE') {
      const auth = requireAuth(request);
      if (auth.error) return auth.error;
      const body = await request.json();
      const endpoint = body?.endpoint;
      if (!endpoint) return error('Missing endpoint');
      await db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?').bind(endpoint, auth.user.id).run();
      return json({ success: true });
    }

    if (path === 'push/test' && method === 'POST') {
      const auth = requireAuth(request);
      if (auth.error) return auth.error;
      const { results: subs } = await db
        .prepare('SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?')
        .bind(auth.user.id).all();
      if (!subs.length) return json({ success: false, reason: 'no_subscription' });
      const results = await Promise.all(subs.map((sub) =>
        sendWebPush(env, sub, {
          title: '🔔 Test Notification',
          body: 'Push notifications are working correctly on this device.',
          url: '/profile',
          tag: 'push-test',
        }).catch((e) => ({ error: true, message: e?.message })),
      ));
      const allSkipped = results.every(r => r.skipped);
      if (allSkipped) return json({ success: false, reason: 'vapid_not_configured' });
      const allErrored = results.every(r => r.error);
      if (allErrored) return json({ success: false, reason: 'vapid_error' });
      const expired = subs.filter((_, i) => results[i]?.expired);
      for (const sub of expired) {
        await db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind(sub.endpoint).run().catch(() => {});
      }
      const sent = results.filter(r => r.sent).length;
      if (sent === 0) return json({ success: false, reason: 'push_rejected', sent, total: subs.length });
      return json({ success: true, sent, total: subs.length });
    }

    // ============================================================
    // PUBLIC ITEM VALUATION: POST /api/public-valuation
    // No auth required. Rate-limited by IP address.
    // Calls Gemini with Google Search server-side (API key never
    // exposed to the public browser).
    // ============================================================
    if (path === 'public-valuation' && method === 'POST') {
      try {
        // Load settings
        const cfgRow = await db.prepare("SELECT value FROM settings WHERE key = 'config'").first().catch(() => null);
        const cfg = cfgRow ? JSON.parse(cfgRow.value || '{}') : {};

        // Feature toggle
        const enabled = cfg.publicValuationEnabled !== false; // default true
        if (!enabled) {
          return json({ error: 'This feature is currently unavailable. Please call us directly.' }, 503);
        }

        // Gemini API key required
        const apiKey = cfg.geminiApiKey || '';
        if (!apiKey) {
          return json({ error: 'Price checking is not available right now. Please call us directly.' }, 503);
        }

        // IP rate limiting
        const ip = request.headers.get('CF-Connecting-IP')
          || request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim()
          || 'unknown';
        const dailyLimit = Math.max(1, Number(cfg.publicValuationDailyLimitPerIp) || 3);
        const usedToday = await db
          .prepare("SELECT COUNT(*) AS n FROM public_valuation_requests WHERE ip = ? AND created_at > datetime('now', '-1 day')")
          .bind(ip)
          .first()
          .catch(() => ({ n: 0 }));
        if ((usedToday?.n || 0) >= dailyLimit) {
          return json({
            error: `You have already checked ${dailyLimit} time${dailyLimit !== 1 ? 's' : ''} today. Please come back tomorrow, or call us directly to speak with someone.`,
            rateLimited: true,
          }, 429);
        }

        // Parse and validate request body
        const body = await request.json().catch(() => null);
        if (!body) return json({ error: 'Invalid request.' }, 400);

        const { itemType, description, photos } = body;
        if (!itemType || typeof itemType !== 'string' || itemType.trim().length === 0 || itemType.length > 50) {
          return json({ error: 'Please select an item type.' }, 400);
        }
        if (!description || typeof description !== 'string' || description.trim().length < 5 || description.length > 600) {
          return json({ error: 'Please describe your item (at least 5 characters).' }, 400);
        }
        if (photos !== undefined && !Array.isArray(photos)) {
          return json({ error: 'Invalid photos format.' }, 400);
        }
        const photoList = Array.isArray(photos) ? photos.slice(0, 3) : [];
        // Validate each photo is a string and not too large (~5MB base64 ≈ 6.7MB string)
        for (const p of photoList) {
          if (typeof p !== 'string' || p.length > 7 * 1024 * 1024) {
            return json({ error: 'One or more photos are too large. Please use smaller photos.' }, 400);
          }
        }

        // Build Gemini prompt — mirrors handleAIRun3 in TransactionWizard as closely as possible
        const prompt = `You are a pricing expert helping a second-hand item shop in Aguleri, Anambra State, Nigeria. We need to know the fair resale price of this item so we can sell it within 14 days.

CRITICAL: All prices MUST be in Nigerian Naira (NGN). Do not use dollars, pounds, or any other currency. If you find prices in other currencies, convert them to Naira at the current exchange rate.

Item details:
* Type: ${itemType.trim()}
* Customer description: ${description.trim()}

Instructions:
1. Identify the exact brand, model, and colour from the description and photos. If unrecognisable, use your best estimate.

2. Search for the BRAND NEW retail price of this exact model in Nigeria TODAY.
   - Include the colour in your search if known (e.g. search "black JBL Charge 5 price Nigeria 2024")
   - Check at least 3 Nigerian stores: Jumia.com.ng, Konga.com, Slot.ng, and others
   - Pick the MOST COMMON price across listings (modal price — the price that comes up most often)
   - Do NOT average the prices — use the price that appears most frequently across stores
   - If the colour affects price (e.g. some iPhone colours cost more), use the price for that specific colour
   - Only use current listed prices — do NOT use old or outdated prices
   - If this is a generic/unbranded Chinese item, search for equivalent items with similar specs

3. Search the internet for the current selling price of this exact item (used/second-hand) on Jiji.ng, Facebook Marketplace Nigeria, and any similar Nigerian resale platforms. Include listings from Anambra, Onitsha, Awka, Lagos, and other Nigerian cities. Search with the specific colour mentioned to find the most accurate used price.

CRITICAL ANTI-SCAM RULE for Jiji.ng prices:
- Sort all listings for this item by price from lowest to highest
- Throw away the cheapest 20% of listings — these are usually scam bait
- From the remaining 80%, find the MEDIAN price (the middle value, not the average)
- Use this median as your base for the used price

4. Use those prices as your base. Then adjust for:
   - The item condition based on the customer's description and photos
   - Current supply/demand — if this item is very common in resale markets, price competitively; if rare, price slightly higher
   - Age of the model — older models lose value faster

IMPORTANT PRICING CONTEXT:
- Prices in Aguleri/Anambra State are comparable to Onitsha and Lagos — do NOT discount for location. Aguleri is a trading town near Onitsha Main Market.
- We need to sell this item within 14 days, so price it to move — but do NOT undervalue it. We want the best realistic price a buyer will pay within 2 weeks, not a desperate clearance price.
- Second-hand items in good working condition typically sell for 50-75% of brand new price. Items in fair condition sell for 35-55% of brand new price.
- Do NOT lowball. If the brand new price is ₦50,000 and the item is in good condition, the used price should be around ₦25,000-₦37,500 — not ₦10,000.

5. Give me the realistic price we can sell this item for in Aguleri within 14 days. This should be a fair market price — not inflated, not deflated.

6. Use simple everyday English. No big words.

Reply in this exact format only (no numbered prefixes, no markdown, no extra text):
ITEM_SUMMARY: [item name — include colour (if mentioned), brand, model, and key features, aim for 10-12 words, NO full sentences, do NOT start with "This is" or "This item"]
ITEM_COLOR_MODEL: [colour (if mentioned in description) + brand + model only, max 5 words, e.g. "black JBL Charge 5" or "Samsung Galaxy A54" if no colour mentioned]
CONDITION_NOTES: [1-2 sentences on the item's condition based on the description and photos]
ESTIMATED_RESALE_VALUE: [number only — no naira sign, no comma]
PRICE_BASIS: [2 to 3 short sentences explaining what brand new prices and used prices you found, and how you calculated your estimate]
NEW_MARKET_PRICE: [number only — the brand new price in Nigeria, or 0 if not found]
PRICE_RANGE: [lowest realistic price — highest realistic price, e.g. 45000-60000]
VALUATION_CONFIDENCE: [your confidence as a percentage, e.g. 85% — higher if you found real price data, lower if you had to estimate]`;

        // Build Gemini request parts (prompt + photos)
        const parts = [{ text: prompt }];
        for (const photo of photoList) {
          // Photos arrive as data URIs or raw base64
          let mimeType = 'image/jpeg';
          let base64Data = photo;
          if (photo.startsWith('data:')) {
            const semiIdx = photo.indexOf(';');
            const commaIdx = photo.indexOf(',');
            if (semiIdx > 5 && commaIdx > semiIdx) {
              mimeType = photo.slice(5, semiIdx);
              base64Data = photo.slice(commaIdx + 1);
            }
          }
          if (base64Data) parts.push({ inline_data: { mime_type: mimeType, data: base64Data } });
        }

        // Helper: extract text from Gemini response (skip thinking parts)
        const extractText = (data) => {
          const ps = data?.candidates?.[0]?.content?.parts;
          if (!Array.isArray(ps)) return null;
          for (const p of ps) { if (p.text && !p.thought) return p.text; }
          for (let i = ps.length - 1; i >= 0; i--) { if (ps[i].text) return ps[i].text; }
          return null;
        };

        // Helper: parse a named field from AI response
        const parseField = (text, field) => {
          const re = new RegExp(`^${field}:\\s*(.+)$`, 'mi');
          return (text.match(re)?.[1] || '').trim();
        };

        // Call Gemini with Google Search grounding, with model fallback
        const primaryModel = (cfg.geminiModel || 'gemini-2.5-flash').trim();
        const modelCandidates = [primaryModel, 'gemini-2.5-flash', 'gemini-2.5-flash-lite']
          .filter(Boolean)
          .filter((m, i, a) => a.indexOf(m) === i);

        let responseText = null;
        let geminiError = null;
        for (const modelName of modelCandidates) {
          const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
          const geminiBody = { contents: [{ parts }], tools: [{ google_search: {} }] };
          let resp = await fetch(geminiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(geminiBody),
          });
          // Retry once on transient errors
          if (!resp.ok && [429, 500, 502, 503].includes(resp.status)) {
            await new Promise(r => setTimeout(r, 2000));
            resp = await fetch(geminiUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(geminiBody),
            });
          }
          const data = await resp.json().catch(() => null);
          const text = extractText(data);
          if (text) { responseText = text; break; }
          const errMsg = (data?.error?.message || '').toLowerCase();
          const canFallback = [429, 500, 502, 503].includes(resp.status)
            || errMsg.includes('not found') || errMsg.includes('no longer available') || errMsg.includes('unsupported');
          if (!canFallback || modelName === modelCandidates[modelCandidates.length - 1]) {
            geminiError = data?.error?.message || `Gemini request failed (${resp.status})`;
            break;
          }
        }

        if (!responseText) {
          console.error('Public valuation Gemini error:', geminiError);
          return json({ error: 'We could not check prices right now. Please try again later or call us directly.' }, 503);
        }

        // Parse AI response
        const itemSummary = parseField(responseText, 'ITEM_SUMMARY');
        const itemColorModel = parseField(responseText, 'ITEM_COLOR_MODEL');
        const conditionNotes = parseField(responseText, 'CONDITION_NOTES');
        const estimatedValueStr = parseField(responseText, 'ESTIMATED_RESALE_VALUE').replace(/[^0-9]/g, '');
        const newMarketPriceStr = parseField(responseText, 'NEW_MARKET_PRICE').replace(/[^0-9]/g, '');
        const priceBasis = parseField(responseText, 'PRICE_BASIS');
        const confidence = parseField(responseText, 'VALUATION_CONFIDENCE');
        const rangeRaw = parseField(responseText, 'PRICE_RANGE').replace(/[₦NGN,\s]/gi, '');
        const rangeMatch = rangeRaw.match(/(\d+)\s*(?:[-–—]|to)\s*(\d+)/i);

        const estimatedValue = Number(estimatedValueStr) || 0;
        const newMarketPrice = Number(newMarketPriceStr) || 0;
        const priceLow = rangeMatch ? Math.min(Number(rangeMatch[1]), Number(rangeMatch[2])) : Math.round(estimatedValue * 0.85);
        const priceHigh = rangeMatch ? Math.max(Number(rangeMatch[1]), Number(rangeMatch[2])) : Math.round(estimatedValue * 1.15);

        // Calculate cash advance range using lending capacity percentage
        const capPct = Number(cfg.lendingCapacityPercentage) || Number(cfg.loanCapNoReceipt) || 40;
        const advanceLow = Math.floor(priceLow * capPct / 100);
        const advanceHigh = Math.floor(priceHigh * capPct / 100);

        // Log the request for rate limiting
        await db.prepare('INSERT INTO public_valuation_requests (ip) VALUES (?)').bind(ip).run().catch(() => {});

        return json({
          estimatedValue,
          priceLow,
          priceHigh,
          advanceLow,
          advanceHigh,
          newMarketPrice,
          confidence,
          priceBasis,
          itemSummary,
          itemColorModel,
          conditionNotes,
        });
      } catch (e) {
        console.error('Public valuation error:', e);
        return json({ error: 'Something went wrong. Please try again later or call us directly.' }, 500);
      }
    }

    // ── GET /api/staff-points — aggregated fractional points ─────────────
    // Optional filters:
    //   ?from=YYYY-MM-DD&to=YYYY-MM-DD  (date range, inclusive)
    //   ?period=YYYY-MM                 (single month, server local time)
    //   ?user_id=...                    (limit to one user)
    //   ?detail=1                       (return per-step breakdown rows)
    if (path === 'staff-points' && method === 'GET') {
      const auth = requireAuth(request);
      if (auth.error) return auth.error;
      const qs = url.searchParams;
      const userIdFilter = qs.get('user_id');
      const detail = qs.get('detail') === '1';
      let from = qs.get('from');
      let to = qs.get('to');
      const period = qs.get('period');
      if (period && /^\d{4}-\d{2}$/.test(period)) {
        const [yy, mm] = period.split('-').map(Number);
        from = `${period}-01`;
        const last = new Date(Date.UTC(yy, mm, 0)).getUTCDate();
        to = `${period}-${String(last).padStart(2, '0')}`;
      }
      const conds = [];
      const binds = [];
      if (from) { conds.push("date(awarded_at) >= date(?)"); binds.push(from); }
      if (to)   { conds.push("date(awarded_at) <= date(?)"); binds.push(to); }
      if (userIdFilter) { conds.push('user_id = ?'); binds.push(userIdFilter); }
      const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
      if (detail) {
        const rows = await db.prepare(`SELECT user_id, step_key, SUM(weight) AS points, COUNT(*) AS events FROM staff_points ${where} GROUP BY user_id, step_key ORDER BY user_id, step_key`).bind(...binds).all();
        return json(rows.results || []);
      }
      const rows = await db.prepare(`SELECT user_id, SUM(weight) AS points, COUNT(*) AS events FROM staff_points ${where} GROUP BY user_id ORDER BY points DESC`).bind(...binds).all();
      return json(rows.results || []);
    }

    // ── POST /api/staff-points/backfill — credit historical data ──────────
    // Admin-only. One-time migration. Idempotent: re-running adds no rows
    // thanks to the UNIQUE constraint on (user_id, entity_ref, step_key).
    // Maps existing transaction createdBy/completedBy/repaidBy/soldBy and
    // activity_logs entries to fractional points using configured weights.
    if (path === 'staff-points/backfill' && method === 'POST') {
      const auth = requireAuth(request);
      if (auth.error) return auth.error;
      if (auth.user.role !== 'admin') return error('Admin only', 403);
      const { stepWeights, taskWeights } = await loadPointsConfig();

      // Build a name → user_id map so we can resolve the legacy "by" fields
      // (which store names rather than IDs).
      const usersRes = await db.prepare('SELECT id, name, username FROM users').all();
      const nameToId = new Map();
      for (const u of (usersRes.results || [])) {
        if (u.name) nameToId.set(String(u.name).trim().toLowerCase(), u.id);
        if (u.username) nameToId.set(String(u.username).trim().toLowerCase(), u.id);
      }
      const resolve = (nameOrId) => {
        if (!nameOrId) return null;
        const key = String(nameOrId).trim().toLowerCase();
        return nameToId.get(key) || null;
      };

      let credited = 0;
      let skipped = 0;

      // Transactions
      const txRes = await db.prepare('SELECT ref, data, status FROM transactions').all();
      for (const r of (txRes.results || [])) {
        let d;
        try { d = JSON.parse(r.data); } catch { skipped++; continue; }
        const entityRef = 'tx:' + r.ref;
        const creatorId = resolve(d.createdBy);
        const completerId = resolve(d.completedBy);
        const repaidId = resolve(d.repaidBy);
        const soldId = resolve(d.soldBy);

        // Pre-completion bundle — credited to the original creator (drafted)
        // when no granular stepActors are present.
        const actors = (d.stepActors && typeof d.stepActors === 'object') ? d.stepActors : {};
        const preSteps = ['customer_intake','id_verification','item_photo','item_appraisal','agreement_print'];
        for (const stepKey of preSteps) {
          const uid = (actors[stepKey] && actors[stepKey].userId) || creatorId;
          if (!uid) continue;
          await awardPoints({ userId: uid, entityRef, stepKey, weight: stepWeights[stepKey] });
          credited++;
        }
        // Cash disbursement / sale_completion based on type
        if (d.type === 'outright' || r.status === 'for_sale' || r.status === 'sold') {
          if (completerId || soldId) {
            await awardPoints({ userId: soldId || completerId, entityRef, stepKey: 'sale_completion', weight: stepWeights.sale_completion });
            credited++;
          }
        } else if (completerId) {
          await awardPoints({ userId: completerId, entityRef, stepKey: 'cash_disbursement', weight: stepWeights.cash_disbursement });
          credited++;
        }
        // Repayment
        if (r.status === 'closed' && (repaidId || completerId)) {
          await awardPoints({ userId: repaidId || completerId, entityRef, stepKey: 'repayment_collection', weight: stepWeights.repayment_collection });
          credited++;
        }
        // Listing for sale (only if currently for_sale; we don't have a separate timestamp)
        if ((r.status === 'for_sale' || r.status === 'ready_to_sell' || r.status === 'sold') && d.type === 'advance') {
          const listerId = completerId || resolve(d.listedBy) || null;
          if (listerId) {
            await awardPoints({ userId: listerId, entityRef, stepKey: 'default_handling_listing', weight: stepWeights.default_handling_listing });
            credited++;
          }
        }
      }

      // Expenses (task_entry)
      const expRes = await db.prepare('SELECT id, registered_by FROM expenses').all();
      for (const e of (expRes.results || [])) {
        const uid = resolve(e.registered_by);
        if (!uid) { skipped++; continue; }
        await awardPoints({ userId: uid, entityRef: 'expense:' + e.id, stepKey: 'expense_entry', weight: taskWeights.expense_entry });
        credited++;
      }

      await logActivity({ user: auth.user, action: 'create', entityType: 'staff_points', entityId: 'backfill', description: `Backfilled staff points — ${credited} credit(s), ${skipped} skipped` });
      return json({ ok: true, credited, skipped });
    }

    return error('Not found', 404);

  } catch (e) {
    console.error('API Error:', e);
    return error(e.message || 'Internal server error', 500);
  }
}
