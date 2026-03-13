import { neon } from '@neondatabase/serverless';

const SESSION_COOKIE = 'cfc_session';
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days

// Helper: JSON response
const json = (data, status = 200, extraHeaders = {}) => {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  Object.entries(extraHeaders).forEach(([key, value]) => {
    if (Array.isArray(value)) value.forEach((v) => headers.append(key, v));
    else headers.set(key, value);
  });
  return new Response(JSON.stringify(data), { status, headers });
};

const error = (msg, status = 400) => json({ error: msg }, status);

const SESSION_COOKIE_SHORT = 'cfc_session_short';
const SESSION_COOKIE_LONG = 'cfc_session_long';
const REMEMBER_ME_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

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

const buildSessionCookie = (token, requestUrl) => {
  const secureFlag = requestUrl.protocol === 'https:' ? '; Secure' : '';
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_MAX_AGE_SECONDS}${secureFlag}`;
};

const clearSessionCookie = (requestUrl) => {
  const secureFlag = requestUrl.protocol === 'https:' ? '; Secure' : '';
  return `${SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${secureFlag}`;
};

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname.replace('/api/', '').replace('/api', '');
  const method = request.method;

  // Ensure the database connection string exists in Cloudflare settings
  if (!env.DATABASE_URL) {
    return error('Database connection string missing in Cloudflare Environment Variables', 500);
  }

  // Connect to Neon Database
  const sql = neon(env.DATABASE_URL);

  const ensureSessionTable = async () => {
    await sql`
      CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
  };

  const getSessionUser = async () => {
    await ensureSessionTable();
    const cookies = parseCookies(request.headers.get('Cookie') || '');
    const token = cookies[SESSION_COOKIE];
    if (!token) return null;

    const rows = await sql`
      SELECT u.id, u.username, u.role, u.name
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.token = ${token} AND s.expires_at > NOW()
      LIMIT 1
    `;
    return rows[0] || null;
  };

  try {
    // ============================================================
    // AUTH: POST /api/login
    // ============================================================
    if (path === 'login' && method === 'POST') {
      const { username, password, rememberMe } = await request.json();
      const rows = await sql`SELECT id, username, role, name FROM users WHERE username = ${username} AND password = ${password}`;
      if (rows.length === 0) return error('Invalid username or password', 401);

      const user = rows[0];
      const sessionPayload = JSON.stringify({ id: user.id, username: user.username, role: user.role, name: user.name, issuedAt: Date.now() });
      const activeCookie = rememberMe
        ? buildSessionCookie(SESSION_COOKIE_LONG, sessionPayload, REMEMBER_ME_MAX_AGE)
        : buildSessionCookie(SESSION_COOKIE_SHORT, sessionPayload);
      const staleCookie = rememberMe
        ? clearSessionCookie(SESSION_COOKIE_SHORT)
        : clearSessionCookie(SESSION_COOKIE_LONG);

      return json(user, 200, { 'Set-Cookie': [activeCookie, staleCookie] });
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
    // BOOTSTRAP: GET /api/bootstrap?scope=critical|secondary&role=admin
    // ============================================================
    if (path === 'bootstrap' && method === 'GET') {
      const scope = url.searchParams.get('scope') || 'critical';
      const role = url.searchParams.get('role') || '';

      if (scope === 'secondary') {
        const [expenses, capital, declined, users] = await Promise.all([
          sql`SELECT id, date, category, description, amount FROM expenses ORDER BY date DESC`,
          sql`SELECT id, name, amount, date, method FROM capital ORDER BY date`,
          sql`SELECT id, date, item, reason FROM declined_log ORDER BY date DESC`,
          role === 'admin'
            ? sql`SELECT id, username, role, name, created_at FROM users ORDER BY created_at`
            : Promise.resolve([])
        ]);

        return json({ expenses, capital, declined, users });
      }

      const [settingsRows, transactionRows, draftRows] = await Promise.all([
        sql`SELECT value FROM settings WHERE key = 'config'`,
        sql`SELECT ref, data, status, created_at, updated_at FROM transactions ORDER BY created_at DESC`,
        sql`SELECT ref, data FROM drafts ORDER BY updated_at DESC`
      ]);

      return json({
        settings: settingsRows.length > 0 ? settingsRows[0].value : {},
        transactions: transactionRows.map((r) => ({ ...r.data, ref: r.ref, status: r.status })),
        drafts: draftRows.map((r) => ({ ...r.data, ref: r.ref }))
      });
    }

    // ============================================================
    // USERS: GET, POST, DELETE /api/users
    // ============================================================
    if (path === 'users' && method === 'GET') {
      const rows = await sql`SELECT id, username, role, name, created_at FROM users ORDER BY created_at`;
      return json(rows);
    }
    if (path === 'users' && method === 'POST') {
      const { id, username, password, role, name } = await request.json();
      await sql`INSERT INTO users (id, username, password, role, name) VALUES (${id}, ${username}, ${password}, ${role}, ${name})`;
      return json({ success: true });
    }
    if (path.startsWith('users/') && method === 'DELETE') {
      const id = path.split('/')[1];
      if (id === 'admin') return error('Cannot delete admin user');
      await sql`DELETE FROM users WHERE id = ${id}`;
      return json({ success: true });
    }

    // ============================================================
    // SETTINGS: GET, PUT /api/settings
    // ============================================================
    if (path === 'settings' && method === 'GET') {
      const rows = await sql`SELECT value FROM settings WHERE key = 'config'`;
      return json(rows.length > 0 ? rows[0].value : {});
    }
    if (path === 'settings' && method === 'PUT') {
      const data = await request.json();
      await sql`INSERT INTO settings (key, value, updated_at) VALUES ('config', ${JSON.stringify(data)}::jsonb, NOW()) ON CONFLICT (key) DO UPDATE SET value = ${JSON.stringify(data)}::jsonb, updated_at = NOW()`;
      return json({ success: true });
    }

    // ============================================================
    // TRANSACTIONS: GET, POST, PUT /api/transactions
    // ============================================================
    if (path === 'transactions' && method === 'GET') {
      const rows = await sql`SELECT ref, data, status, created_at, updated_at FROM transactions ORDER BY created_at DESC`;
      return json(rows.map(r => ({ ...r.data, ref: r.ref, status: r.status })));
    }
    if (path === 'transactions' && method === 'POST') {
      const tx = await request.json();
      await sql`INSERT INTO transactions (ref, data, status, updated_at) VALUES (${tx.ref}, ${JSON.stringify(tx)}::jsonb, ${tx.status || 'active'}, NOW()) ON CONFLICT (ref) DO UPDATE SET data = ${JSON.stringify(tx)}::jsonb, status = ${tx.status || 'active'}, updated_at = NOW()`;
      return json({ success: true });
    }
    if (path.startsWith('transactions/') && method === 'PUT') {
      const ref = decodeURIComponent(path.split('/')[1]);
      const tx = await request.json();
      await sql`UPDATE transactions SET data = ${JSON.stringify(tx)}::jsonb, status = ${tx.status || 'active'}, updated_at = NOW() WHERE ref = ${ref}`;
      return json({ success: true });
    }

    // ============================================================
    // DRAFTS: GET, POST, DELETE /api/drafts
    // ============================================================
    if (path === 'drafts' && method === 'GET') {
      const rows = await sql`SELECT ref, data FROM drafts ORDER BY updated_at DESC`;
      return json(rows.map(r => ({ ...r.data, ref: r.ref })));
    }
    if (path === 'drafts' && method === 'POST') {
      const draft = await request.json();
      await sql`INSERT INTO drafts (ref, data, updated_at) VALUES (${draft.ref}, ${JSON.stringify(draft)}::jsonb, NOW()) ON CONFLICT (ref) DO UPDATE SET data = ${JSON.stringify(draft)}::jsonb, updated_at = NOW()`;
      return json({ success: true });
    }
    if (path.startsWith('drafts/') && method === 'DELETE') {
      const ref = decodeURIComponent(path.split('/')[1]);
      await sql`DELETE FROM drafts WHERE ref = ${ref}`;
      return json({ success: true });
    }

    // ============================================================
    // EXPENSES: GET, POST /api/expenses
    // ============================================================
    if (path === 'expenses' && method === 'GET') {
      const rows = await sql`SELECT id, date, category, description, amount FROM expenses ORDER BY date DESC`;
      return json(rows);
    }
    if (path === 'expenses' && method === 'POST') {
      const { date, category, description, amount } = await request.json();
      await sql`INSERT INTO expenses (date, category, description, amount) VALUES (${date}, ${category}, ${description}, ${amount})`;
      return json({ success: true });
    }

    // ============================================================
    // CAPITAL: GET, POST /api/capital
    // ============================================================
    if (path === 'capital' && method === 'GET') {
      const rows = await sql`SELECT id, name, amount, date, method FROM capital ORDER BY date`;
      return json(rows);
    }
    if (path === 'capital' && method === 'POST') {
      const { name, amount, date, method } = await request.json();
      await sql`INSERT INTO capital (name, amount, date, method) VALUES (${name}, ${amount}, ${date}, ${method})`;
      return json({ success: true });
    }

    // ============================================================
    // DECLINED LOG: GET, POST /api/declined
    // ============================================================
    if (path === 'declined' && method === 'GET') {
      const rows = await sql`SELECT id, date, item, reason FROM declined_log ORDER BY date DESC`;
      return json(rows);
    }
    if (path === 'declined' && method === 'POST') {
      const { date, item, reason } = await request.json();
      await sql`INSERT INTO declined_log (date, item, reason) VALUES (${date}, ${item}, ${reason})`;
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
      await sql`SELECT 1`;
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
