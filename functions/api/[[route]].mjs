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

// Load loan-duration settings from D1.
// Returns { maxLoanDays, graceDays } with safe defaults.
const loadLoanConfig = async (db) => {
  const row = await db.prepare("SELECT value FROM settings WHERE key = 'config'").first();
  const cfg = row ? JSON.parse(row.value) : {};
  return {
    maxLoanDays: Math.max(1, Number(cfg.maxLoanDays) || 30),
    graceDays:   Math.max(0, Number(cfg.graceDays)   || 3),
  };
};

// Compute the loan timeline for an advance transaction.
// txData   — parsed JSON data from the transactions table
// loanCfg  — { maxLoanDays, graceDays } from admin settings
// Returns an object with computed dates and the derived loanStatus string.
const computeLoanTimeline = (txData, { maxLoanDays = 30, graceDays = 3 } = {}) => {
  const baseDate = txData.dateGiven || null;
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

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname.replace('/api/', '').replace('/api', '');
  const method = request.method;

  if (!env.DB) {
    return error('D1 database binding missing — ensure DB is bound in wrangler.toml', 500);
  }

  const db = env.DB;

  const logActivity = async ({ user, action, entityType, entityId, description = '' }) => {
    if (!user) return;
    await db
      .prepare('INSERT INTO activity_logs (user_id, username, user_role, action, entity_type, entity_id, description) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(user.id, user.username, user.role, action, entityType, entityId || null, description)
      .run();
  };

  // Helper: Normalize Termii delivery status to standard format
  const normalizeDeliveryStatus = (rawStatus) => {
    if (!rawStatus) return null;
    const status = String(rawStatus).toLowerCase().trim();

    // Map various Termii status formats to standardized internal statuses
    if (status.includes('deliver')) return 'DeliveredToTerminal';
    if (status.includes('success')) return 'DeliveredToTerminal';
    if (status.includes('expired') || status.includes('expire')) return 'Expired';
    if (status.includes('dnd')) return 'DND';
    if (status.includes('undeliver')) return 'Undeliverable';
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
        .prepare('SELECT id, username, password, role, roles, name, active FROM users WHERE username = ?')
        .bind(username)
        .first()
        .catch(() =>
          // Fallback for databases where the `active`/`roles` migration hasn't run yet
          db.prepare('SELECT id, username, password, role, name FROM users WHERE username = ?')
            .bind(username).first().then(u => u ? { ...u, active: 1, roles: '[]' } : null)
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
      const sessionPayload = JSON.stringify({ id: user.id, username: user.username, role: user.role, roles: parsedRoles, name: user.name, issuedAt: Date.now() });
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
      return json(user);
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
          db.prepare('SELECT id, name, amount, date, method, receipt, user_id FROM capital ORDER BY date').all(),
          db.prepare('SELECT id, date, ref, customer_name AS customerName, nin_bvn AS ninBvn, item, reason, notes FROM declined_log ORDER BY date DESC').all(),
          isAdmin
            ? db.prepare('SELECT id, username, role, roles, name, active, created_at FROM users ORDER BY created_at').all()
            : Promise.resolve({ results: [] }),
        ]);

        // Query distributions separately — table may not exist on older deployments
        let distributionsResults = [];
        try {
          const distributionsRes = await db.prepare('SELECT id, date, amount, method, note, receipt, created_by, created_at FROM profit_distributions ORDER BY date DESC, created_at DESC').all();
          distributionsResults = distributionsRes.results;
        } catch (_) { /* table not yet migrated — return empty */ }

        return json({
          expenses: expensesRes.results,
          capital: capitalRes.results,
          declined: declinedRes.results,
      users: usersRes.results.map(u => ({ ...u, roles: parseRoles(u.roles) })),
      distributions: distributionsResults,
        });
      }

      if (scope === 'transactions') {
        const limit = Math.max(1, Math.min(200, Number.parseInt(url.searchParams.get('limit') || '100', 10) || 100));
        const offset = Math.max(0, Number.parseInt(url.searchParams.get('offset') || '0', 10) || 0);

        const [transactionsRes, draftsRes, txCountRow, draftCountRow, settingsRow] = await Promise.all([
          db.prepare('SELECT ref, data, status, created_at, updated_at FROM transactions ORDER BY created_at DESC LIMIT ? OFFSET ?').bind(limit, offset).all(),
          // Exclude drafts whose ref already exists as a completed transaction.
          // This silently cleans up the case where the transaction saved but the
          // subsequent draft-delete failed (network error), preventing stale drafts
          // from appearing as resumable in the UI.
          db.prepare('SELECT d.ref, d.data, d.updated_at FROM drafts d WHERE NOT EXISTS (SELECT 1 FROM transactions WHERE ref = d.ref) ORDER BY d.updated_at DESC LIMIT ? OFFSET ?').bind(limit, offset).all(),
          db.prepare('SELECT COUNT(*) AS total FROM transactions').first(),
          db.prepare('SELECT COUNT(*) AS total FROM drafts d WHERE NOT EXISTS (SELECT 1 FROM transactions WHERE ref = d.ref)').first(),
          db.prepare("SELECT value FROM settings WHERE key = 'config'").first()
        ]);

        const loanCfg = (() => {
          const cfg = settingsRow ? JSON.parse(settingsRow.value) : {};
          return { maxLoanDays: Math.max(1, Number(cfg.maxLoanDays) || 30), graceDays: Math.max(0, Number(cfg.graceDays) || 3) };
        })();

        const totalTransactions = txCountRow?.total || 0;
        const totalDrafts = draftCountRow?.total || 0;
        const hasMore = offset + limit < Math.max(totalTransactions, totalDrafts);

        return json({
          transactions: transactionsRes.results.map((r) => withLoanTimeline({ ...JSON.parse(r.data), ref: r.ref, status: r.status, created_at: r.created_at, updated_at: r.updated_at }, loanCfg)),
          drafts: draftsRes.results.map((r) => ({ ...JSON.parse(r.data), ref: r.ref })),
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
      const { results } = await db.prepare('SELECT id, username, role, roles, name, active, created_at FROM users ORDER BY created_at').all();
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
      const auth = requireAdmin(request);
      if (auth.error) return auth.error;
      const id = path.split('/')[1];
      if (id === 'admin') return error('Cannot modify the admin account');
      const { username, password, active, roles } = await request.json();
      const cur = await db.prepare('SELECT username, name, role, roles, active FROM users WHERE id = ?').bind(id).first();
      if (!cur) return error('User not found', 404);
      const setClauses = []; const setParams = [];
      if (username !== undefined && username.trim() && username.trim() !== cur.username) { setClauses.push('username = ?'); setParams.push(username.trim()); }
      if (password !== undefined && password.trim()) { setClauses.push('password = ?'); setParams.push(await hashPassword(password.trim())); }
      if (active !== undefined && Number(active) !== Number(cur.active ?? 1)) { setClauses.push('active = ?'); setParams.push(active ? 1 : 0); }
      if (roles !== undefined && Array.isArray(roles)) { setClauses.push('roles = ?'); setParams.push(JSON.stringify(roles)); }
      if (setClauses.length) await db.prepare(`UPDATE users SET ${setClauses.join(', ')} WHERE id = ?`).bind(...setParams, id).run();
      if (username !== undefined && username.trim() && username.trim() !== cur.username)
        await logActivity({ user: auth.user, action: 'update', entityType: 'user', entityId: id, description: `👤 Username changed: ${cur.name} — @${cur.username} → @${username.trim()}` });
      if (password !== undefined && password.trim())
        await logActivity({ user: auth.user, action: 'update', entityType: 'user', entityId: id, description: `🔑 Password changed for ${cur.name} (@${cur.username})` });
      if (active !== undefined && Number(active) !== Number(cur.active ?? 1))
        await logActivity({ user: auth.user, action: active ? 'activate' : 'deactivate', entityType: 'user', entityId: id, description: `${active ? '✅' : '🔒'} User account ${active ? 'activated' : 'deactivated'}: ${cur.name} (@${cur.username})` });
      if (roles !== undefined && Array.isArray(roles)) {
        const curRoles = parseRoles(cur.roles);
        const added = roles.filter(r => !curRoles.includes(r));
        const removed = curRoles.filter(r => !roles.includes(r));
        if (added.length || removed.length)
          await logActivity({ user: auth.user, action: 'update', entityType: 'user', entityId: id, description: `🎭 Roles updated for ${cur.name} (@${cur.username})${added.length ? ` — granted: ${added.join(', ')}` : ''}${removed.length ? ` — revoked: ${removed.join(', ')}` : ''}` });
      }
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
      // Exception: voluntarily surrendered items (surrenderDate set or previously ready_to_sell)
      // can be listed at any time since the customer explicitly gave up the item.
      if (tx.status === 'for_sale' && tx.type !== 'outright') {
        const isVoluntarySurrender = !!(tx.surrenderDate || existingData?.surrenderDate || existing?.status === 'ready_to_sell');
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

      // ── Immediate outright-purchase confirmation SMS ──
      // Sent right when the transaction is created, not via the nightly cron.
      if (tx.type === 'outright') {
        try {
          const smsCfg = await loadSmsConfig();
          if (smsCfg.enabled && smsCfg.outrightConfirmationEnabled) {
            const rawPhone = (tx.phoneNumbers && tx.phoneNumbers[0]) || tx.phone || '';
            const phone = toIntlPhone(rawPhone);
            if (phone) {
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
                await db.prepare(
                  'INSERT INTO sms_logs (transaction_ref, trigger_type, message, recipient, status, termii_response, message_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
                ).bind(tx.ref, triggerType, message, phone, ok ? 'sent' : 'failed', JSON.stringify(response), messageId).run();
              }
            }
          }
        } catch (_smsErr) {
          // SMS failure must never block the transaction save
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
            if (phone) {
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
                await db.prepare(
                  'INSERT INTO sms_logs (transaction_ref, trigger_type, message, recipient, status, termii_response, message_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
                ).bind(tx.ref, triggerType, message, phone, ok ? 'sent' : 'failed', JSON.stringify(response), messageId).run();
              }
            }
          }
        } catch (_smsErr) {
          // SMS failure must never block the transaction save
        }
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
      if (tx.status === 'for_sale' && !tx.listedForSaleDate) {
        tx.listedForSaleDate = existingData?.listedForSaleDate
          || (existing?.status === 'for_sale' ? new Date().toISOString() : null)
          || new Date().toISOString();
      }

      // Prevent marking an advance loan for sale before sale_allowed_date.
      // Exception: voluntarily surrendered items can be listed at any time.
      if (tx.status === 'for_sale' && tx.type !== 'outright') {
        const isVoluntarySurrender = !!(tx.surrenderDate || existingData?.surrenderDate || existing?.status === 'ready_to_sell');
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
        putAction = 'repaid'; putDesc = `✅ Loan repaid — ${ref}: ${tx.fullName} — ₦${fmtNP(tx.totalFees)} interest collected over ${tx.daysCharged || 0} days`;
      } else if (tx.status === 'sold') {
        const profit = (tx.salePrice || 0) - (tx.cashAdvance || 0);
        putAction = 'sold'; putDesc = `💰 Item sold — ${ref}: ${[tx.aiBrand, tx.aiModel].filter(Boolean).join(' ')} — sold for ₦${fmtNP(tx.salePrice)} (profit ₦${fmtNP(profit)})${tx.saleCondition ? ` — Condition: ${tx.saleCondition}` : ''}`;
      } else if (tx.status === 'for_sale') {
        putAction = 'update'; putDesc = `🏷 Marked for sale — ${ref}: ${[tx.aiBrand, tx.aiModel].filter(Boolean).join(' ')}`;
      } else {
        putAction = 'update'; putDesc = `🔄 Transaction updated — ${ref}`;
      }
      await logActivity({ user: auth.user, action: putAction, entityType: 'transaction', entityId: ref, description: putDesc });

      // ── Redemption/full repayment confirmation SMS ──
      // Sent immediately when a customer repays in full and collects their item.
      if (tx.status === 'closed' && tx.type === 'advance') {
        try {
          const smsCfg = await loadSmsConfig();
          if (smsCfg.enabled && smsCfg.redemptionConfirmationEnabled) {
            const rawPhone = (tx.phoneNumbers && tx.phoneNumbers[0]) || tx.phone || '';
            const phone = toIntlPhone(rawPhone);
            if (phone) {
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
                  businessName: smsCfg.businessName,
                  shopPhone: smsCfg.shopPhone,
                });
                const { ok, messageId, response } = await termiiSend(smsCfg, phone, message);
                await db.prepare(
                  'INSERT INTO sms_logs (transaction_ref, trigger_type, message, recipient, status, termii_response, message_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
                ).bind(ref, triggerType, message, phone, ok ? 'sent' : 'failed', JSON.stringify(response), messageId).run();
              }
            }
          }
        } catch (_smsErr) {
          // SMS failure must never block the transaction save
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
            if (phone) {
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
                  businessName: smsCfg.businessName,
                  shopPhone: smsCfg.shopPhone,
                });
                const { ok, messageId, response } = await termiiSend(smsCfg, phone, message);
                await db.prepare(
                  'INSERT INTO sms_logs (transaction_ref, trigger_type, message, recipient, status, termii_response, message_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
                ).bind(ref, triggerType, message, phone, ok ? 'sent' : 'failed', JSON.stringify(response), messageId).run();
              }
            }
          }
        } catch (_smsErr) {
          // SMS failure must never block the transaction save
        }
      }

      // ── Sale confirmation SMS (receipt to the buyer) ──
      // Sent immediately when an item is marked as sold — goes to the new buyer's
      // phone (saleBuyerPhone) as a purchase receipt, not the original customer.
      if (tx.status === 'sold') {
        try {
          const smsCfg = await loadSmsConfig();
          if (smsCfg.enabled && smsCfg.saleConfirmationEnabled) {
            const rawPhone = tx.saleBuyerPhone || '';
            const phone = toIntlPhone(rawPhone);
            if (phone) {
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
                await db.prepare(
                  'INSERT INTO sms_logs (transaction_ref, trigger_type, message, recipient, status, termii_response, message_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
                ).bind(ref, triggerType, message, phone, ok ? 'sent' : 'failed', JSON.stringify(response), messageId).run();
              }
            }
          }
        } catch (_smsErr) {
          // SMS failure must never block the transaction save
        }
      }

      return json({ success: true });
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
      await db
        .prepare("INSERT INTO drafts (ref, data, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT (ref) DO UPDATE SET data = excluded.data, updated_at = datetime('now')")
        .bind(draft.ref, JSON.stringify(draft))
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
      const { results } = await db.prepare('SELECT id, name, amount, date, method, receipt, user_id FROM capital ORDER BY date').all();
      return json(results);
    }
    if (path === 'capital' && method === 'POST') {
      const auth = requireAuth(request);
      if (auth.error) return auth.error;
      const { name, amount, date, method: capitalMethod, receipt, user_id } = await request.json();
      const inserted = await db
        .prepare('INSERT INTO capital (name, amount, date, method, receipt, user_id) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(name, amount, date, capitalMethod, receipt || null, user_id || null)
        .run();
      await logActivity({ user: auth.user, action: 'entry', entityType: 'capital', entityId: String(inserted.meta.last_row_id), description: `💎 Capital deposited — ${name} contributed ₦${Number(amount).toLocaleString('en-NG')} via ${capitalMethod}` });
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
        const { results } = await db.prepare('SELECT id, date, amount, method, note, receipt, created_by, created_at FROM profit_distributions ORDER BY date DESC, created_at DESC').all();
        return json(results);
      } catch (_) { return json([]); }
    }
    if (path === 'distributions' && method === 'POST') {
      // canRecordDistribution calls requireAuth internally; add active check separately
      const activeCheck = await requireAuthActive(request, db);
      if (activeCheck.error) return activeCheck.error;
      const auth = await canRecordDistribution(request, db);
      if (auth.error) return auth.error;
      const { date, amount, method: distMethod, note, receipt } = await request.json();
      const inserted = await db
        .prepare('INSERT INTO profit_distributions (date, amount, method, note, receipt, created_by) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(date, amount, distMethod, note || null, receipt || null, auth.user.name || auth.user.username)
        .run();
      await logActivity({ user: auth.user, action: 'entry', entityType: 'distribution', entityId: String(inserted.meta.last_row_id), description: `💸 Profit distributed — ₦${Number(amount).toLocaleString('en-NG')} via ${distMethod}${note ? ' (' + note + ')' : ''}` });
      return json({ success: true });
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
        .replace(/\{shopPhone\}/g,      vars.shopPhone || '');

    // Helper: send one SMS via Termii, returns { ok, messageId, response, usedFallback }
    const termiiSend = async (smsCfg, phone, message) => {
      const doSend = async (from, channel) => {
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
        status: pending.length === 0 ? 'webhook_working' : (pending.length > 5 ? 'webhook_may_not_be_working' : 'webhook_working_but_slow')
      });
    }

    // ── GET /api/sms/status/:messageId — manually check SMS status from Termii ──
    if (path.match(/^sms\/status\/[a-zA-Z0-9]+$/) && method === 'GET') {
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
        businessName: smsCfg.businessName,
        shopPhone: smsCfg.shopPhone,
      });

      const { ok, messageId, response, usedFallback, primaryResponse } = await termiiSend(smsCfg, phone, message);
      const inserted = await db.prepare(
        "INSERT INTO sms_logs (transaction_ref, trigger_type, message, recipient, status, termii_response, message_id) VALUES (?, 'manual', ?, ?, ?, ?, ?)"
      ).bind(txRef, message, phone, ok ? 'sent' : 'failed', JSON.stringify(response), messageId).run();

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
      const inserted = await db.prepare(
        "INSERT INTO sms_logs (transaction_ref, trigger_type, message, recipient, status, termii_response, message_id) VALUES (?, 'test_send', ?, ?, ?, ?, ?)"
      ).bind('TEST-SMS', message, phone, ok ? 'sent' : 'failed', JSON.stringify(response), messageId).run();

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

      await db.prepare(
        "INSERT INTO sms_logs (transaction_ref, trigger_type, message, recipient, status, termii_response, message_id) VALUES (?, 'capital_alert', ?, ?, ?, ?, ?)"
      ).bind('CAPITAL-ALERT', message, phone, ok ? 'sent' : 'failed', JSON.stringify(response), messageId).run();

      await logActivity({
        user: auth.user, action: 'sms', entityType: 'capital', entityId: 'CAPITAL-ALERT',
        description: `📱 Capital alert SMS ${ok ? 'sent' : 'failed'} to ${stakeholderName || phone} (${phone})`,
      });

      return json({ ok, messageId, response, usedFallback, primaryResponse });
    }

    if (path === 'sms/auto-send' && method === 'POST') {
      const auth = requireAuth(request);
      if (auth.error) return auth.error;

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
        "SELECT ref, data FROM transactions WHERE status = 'active'"
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
              businessName: smsCfg.businessName,
              shopPhone: smsCfg.shopPhone,
            }),
          });
        }

        // Shared balance calculation for overdue and mid-loan triggers.
        // Computed once per transaction to avoid duplication.
        const dailyFeeAmt = Math.floor((txData.cashAdvance || 0) * smsCfg.interestRate / 100);
        const elapsedDays = elapsedDaysSince(txData.dateGiven);
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
          await db.prepare(
            'INSERT INTO sms_logs (transaction_ref, trigger_type, message, recipient, status, termii_response, message_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
          ).bind(row.ref, triggerType, message, phone, ok ? 'sent' : 'failed', JSON.stringify(response), messageId).run();

          (ok ? sent : failed).push({ ref: row.ref, triggerType, phone, usedFallback });

          // Also send to phone 2 if provided and different from phone 1
          if (phone2) {
            const { ok: ok2, messageId: messageId2, response: response2, usedFallback: usedFallback2 } = await termiiSend(smsCfg, phone2, message);
            await db.prepare(
              'INSERT INTO sms_logs (transaction_ref, trigger_type, message, recipient, status, termii_response, message_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
            ).bind(row.ref, triggerType + '_phone2', message, phone2, ok2 ? 'sent' : 'failed', JSON.stringify(response2), messageId2).run();

            (ok2 ? sent : failed).push({ ref: row.ref, triggerType: triggerType + '_phone2', phone: phone2, usedFallback: usedFallback2 });
          }
        }
      }

      if (sent.length > 0) {
        await logActivity({
          user: auth.user, action: 'sms', entityType: 'settings', entityId: 'auto',
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
          await db.prepare(
            'INSERT INTO sms_logs (transaction_ref, trigger_type, message, recipient, status, termii_response, message_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
          ).bind(log.transaction_ref, retryType, log.message, log.recipient, retryOk ? 'sent' : 'failed', JSON.stringify(retryResp), retryMsgId).run();

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

    return error('Not found', 404);

  } catch (e) {
    console.error('API Error:', e);
    return error(e.message || 'Internal server error', 500);
  }
}
