// Session cookie names — short-lived (session) vs long-lived (remember me)
const SESSION_COOKIE_SHORT = 'cfc_session_short';
const SESSION_COOKIE_LONG = 'cfc_session_long';
const REMEMBER_ME_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

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

// Read user from either cookie (long-lived takes priority)
const getSessionUser = (request) => {
  const cookies = parseCookies(request.headers.get('Cookie') || '');
  const raw = cookies[SESSION_COOKIE_LONG] || cookies[SESSION_COOKIE_SHORT];
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
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
    // PHOTOS: POST /api/photos  (upload to R2, returns { url })
    // ============================================================
    if (path === 'photos' && method === 'POST') {
      const user = getSessionUser(request);
      if (!user) return error('Not authenticated', 401);
      if (!env.PHOTOS) return error('R2 bucket binding missing — add PHOTOS binding in wrangler.toml', 500);
      const { data, mimeType } = await request.json();
      if (!data || !mimeType) return error('Missing data or mimeType');
      const ext = mimeType.split('/')[1]?.replace('jpeg', 'jpg') || 'jpg';
      const key = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
      await env.PHOTOS.put(key, bytes, { httpMetadata: { contentType: mimeType } });
      return json({ url: `/api/photos/${key}` });
    }

    // ============================================================
    // AUTH: POST /api/login
    // ============================================================
    if (path === 'login' && method === 'POST') {
      const { username, password, rememberMe } = await request.json();
      const user = await db
        .prepare('SELECT id, username, role, name FROM users WHERE username = ? AND password = ?')
        .bind(username, password)
        .first();
      if (!user) return error('Invalid username or password', 401);

      const sessionPayload = JSON.stringify({ id: user.id, username: user.username, role: user.role, name: user.name, issuedAt: Date.now() });
      const activeCookie = rememberMe
        ? buildSessionCookie(SESSION_COOKIE_LONG, sessionPayload, REMEMBER_ME_MAX_AGE)
        : buildSessionCookie(SESSION_COOKIE_SHORT, sessionPayload);
      const staleCookie = rememberMe
        ? clearSessionCookie(SESSION_COOKIE_SHORT)
        : clearSessionCookie(SESSION_COOKIE_LONG);

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
      const role = url.searchParams.get('role') || '';

      if (scope === 'secondary') {
        const [expensesRes, capitalRes, declinedRes, usersRes] = await Promise.all([
          db.prepare('SELECT id, date, category, description, amount FROM expenses ORDER BY date DESC').all(),
          db.prepare('SELECT id, name, amount, date, method FROM capital ORDER BY date').all(),
          db.prepare('SELECT id, date, item, reason FROM declined_log ORDER BY date DESC').all(),
          role === 'admin'
            ? db.prepare('SELECT id, username, role, name, created_at FROM users ORDER BY created_at').all()
            : Promise.resolve({ results: [] })
        ]);

        return json({
          expenses: expensesRes.results,
          capital: capitalRes.results,
          declined: declinedRes.results,
          users: usersRes.results
        });
      }

      if (scope === 'transactions') {
        const limit = Math.max(1, Math.min(200, Number.parseInt(url.searchParams.get('limit') || '100', 10) || 100));
        const offset = Math.max(0, Number.parseInt(url.searchParams.get('offset') || '0', 10) || 0);

        const [transactionsRes, draftsRes, txCountRow, draftCountRow] = await Promise.all([
          db.prepare('SELECT ref, data, status, created_at, updated_at FROM transactions ORDER BY created_at DESC LIMIT ? OFFSET ?').bind(limit, offset).all(),
          db.prepare('SELECT ref, data, updated_at FROM drafts ORDER BY updated_at DESC LIMIT ? OFFSET ?').bind(limit, offset).all(),
          db.prepare('SELECT COUNT(*) AS total FROM transactions').first(),
          db.prepare('SELECT COUNT(*) AS total FROM drafts').first()
        ]);

        const totalTransactions = txCountRow?.total || 0;
        const totalDrafts = draftCountRow?.total || 0;
        const hasMore = offset + limit < Math.max(totalTransactions, totalDrafts);

        return json({
          transactions: transactionsRes.results.map((r) => ({ ...JSON.parse(r.data), ref: r.ref, status: r.status })),
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
      const { results } = await db.prepare('SELECT id, username, role, name, created_at FROM users ORDER BY created_at').all();
      return json(results);
    }
    if (path === 'users' && method === 'POST') {
      const { id, username, password, role, name } = await request.json();
      await db
        .prepare('INSERT INTO users (id, username, password, role, name) VALUES (?, ?, ?, ?, ?)')
        .bind(id, username, password, role, name)
        .run();
      return json({ success: true });
    }
    if (path.startsWith('users/') && method === 'DELETE') {
      const id = path.split('/')[1];
      if (id === 'admin') return error('Cannot delete admin user');
      await db.prepare('DELETE FROM users WHERE id = ?').bind(id).run();
      return json({ success: true });
    }

    // ============================================================
    // SETTINGS: GET, PUT /api/settings
    // ============================================================
    if (path === 'settings' && method === 'GET') {
      const row = await db.prepare("SELECT value FROM settings WHERE key = 'config'").first();
      return json(row ? JSON.parse(row.value) : {});
    }
    if (path === 'settings' && method === 'PUT') {
      const data = await request.json();
      await db
        .prepare("INSERT INTO settings (key, value, updated_at) VALUES ('config', ?, datetime('now')) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')")
        .bind(JSON.stringify(data))
        .run();
      return json({ success: true });
    }

    // ============================================================
    // TRANSACTIONS: GET, POST, PUT /api/transactions
    // ============================================================
    if (path === 'transactions' && method === 'GET') {
      const { results } = await db.prepare('SELECT ref, data, status, created_at, updated_at FROM transactions ORDER BY created_at DESC').all();
      return json(results.map((r) => ({ ...JSON.parse(r.data), ref: r.ref, status: r.status })));
    }
    if (path === 'transactions' && method === 'POST') {
      const tx = await request.json();
      await db
        .prepare("INSERT INTO transactions (ref, data, status, updated_at) VALUES (?, ?, ?, datetime('now')) ON CONFLICT (ref) DO UPDATE SET data = excluded.data, status = excluded.status, updated_at = datetime('now')")
        .bind(tx.ref, JSON.stringify(tx), tx.status || 'active')
        .run();
      return json({ success: true });
    }
    if (path.startsWith('transactions/') && method === 'PUT') {
      const ref = decodeURIComponent(path.split('/')[1]);
      const tx = await request.json();
      await db
        .prepare("UPDATE transactions SET data = ?, status = ?, updated_at = datetime('now') WHERE ref = ?")
        .bind(JSON.stringify(tx), tx.status || 'active', ref)
        .run();
      return json({ success: true });
    }

    // ============================================================
    // DRAFTS: GET, POST, DELETE /api/drafts
    // ============================================================
    if (path === 'drafts' && method === 'GET') {
      const { results } = await db.prepare('SELECT ref, data FROM drafts ORDER BY updated_at DESC').all();
      return json(results.map((r) => ({ ...JSON.parse(r.data), ref: r.ref })));
    }
    if (path === 'drafts' && method === 'POST') {
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
      const ref = decodeURIComponent(path.split('/')[1]);
      await db.prepare('DELETE FROM drafts WHERE ref = ?').bind(ref).run();
      return json({ success: true });
    }

    // ============================================================
    // EXPENSES: GET, POST /api/expenses
    // ============================================================
    if (path === 'expenses' && method === 'GET') {
      const { results } = await db.prepare('SELECT id, date, category, description, amount FROM expenses ORDER BY date DESC').all();
      return json(results);
    }
    if (path === 'expenses' && method === 'POST') {
      const { date, category, description, amount } = await request.json();
      await db
        .prepare('INSERT INTO expenses (date, category, description, amount) VALUES (?, ?, ?, ?)')
        .bind(date, category, description, amount)
        .run();
      return json({ success: true });
    }

    // ============================================================
    // CAPITAL: GET, POST /api/capital
    // ============================================================
    if (path === 'capital' && method === 'GET') {
      const { results } = await db.prepare('SELECT id, name, amount, date, method FROM capital ORDER BY date').all();
      return json(results);
    }
    if (path === 'capital' && method === 'POST') {
      const { name, amount, date, method: capitalMethod } = await request.json();
      await db
        .prepare('INSERT INTO capital (name, amount, date, method) VALUES (?, ?, ?, ?)')
        .bind(name, amount, date, capitalMethod)
        .run();
      return json({ success: true });
    }

    // ============================================================
    // DECLINED LOG: GET, POST /api/declined
    // ============================================================
    if (path === 'declined' && method === 'GET') {
      const { results } = await db.prepare('SELECT id, date, item, reason FROM declined_log ORDER BY date DESC').all();
      return json(results);
    }
    if (path === 'declined' && method === 'POST') {
      const { date, item, reason } = await request.json();
      await db
        .prepare('INSERT INTO declined_log (date, item, reason) VALUES (?, ?, ?)')
        .bind(date, item, reason)
        .run();
      return json({ success: true });
    }

    // ============================================================
    // NIN/BVN VERIFICATION PROXY: POST /api/verify-nin, /api/verify-bvn
    // ============================================================
    if (path === 'verify-nin' && method === 'POST') {
      const { nin, apiKey } = await request.json();
      const resp = await fetch('https://checkmyninbvn.com.ng/api/nin-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
        body: JSON.stringify({ nin, consent: true })
      });
      const data = await resp.json();
      return json(data);
    }
    if (path === 'verify-bvn' && method === 'POST') {
      const { bvn, apiKey } = await request.json();
      const resp = await fetch('https://checkmyninbvn.com.ng/api/bvn-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
        body: JSON.stringify({ bvn, consent: true })
      });
      const data = await resp.json();
      return json(data);
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

    return error('Not found', 404);

  } catch (e) {
    console.error('API Error:', e);
    return error(e.message || 'Internal server error', 500);
  }
}
