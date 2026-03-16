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
      let user = await db
        .prepare('SELECT id, username, role, name, active FROM users WHERE username = ? AND password = ?')
        .bind(username, password)
        .first()
        .catch(() =>
          // Fallback for databases where the `active` migration hasn't run yet
          db.prepare('SELECT id, username, role, name FROM users WHERE username = ? AND password = ?')
            .bind(username, password).first().then(u => u ? { ...u, active: 1 } : null)
        );
      if (!user) return error('Invalid username or password', 401);
      if (user.active === 0) return error('This account has been disabled. Contact the administrator.', 403);

      const sessionPayload = JSON.stringify({ id: user.id, username: user.username, role: user.role, name: user.name, issuedAt: Date.now() });
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
      if (scope !== 'critical') {
        const auth = requireAuth(request);
        if (auth.error) return auth.error;
      }
      const role = url.searchParams.get('role') || '';

      if (scope === 'secondary') {
        const [expensesRes, capitalRes, declinedRes, usersRes] = await Promise.all([
          db.prepare('SELECT id, date, category, description, amount FROM expenses ORDER BY date DESC').all(),
          db.prepare('SELECT id, name, amount, date, method, receipt, user_id FROM capital ORDER BY date').all(),
          db.prepare('SELECT id, date, item, reason FROM declined_log ORDER BY date DESC').all(),
          role === 'admin'
            ? db.prepare('SELECT id, username, role, name, active, created_at FROM users ORDER BY created_at').all()
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
      const auth = requireAdmin(request);
      if (auth.error) return auth.error;
      const { results } = await db.prepare('SELECT id, username, role, name, active, created_at FROM users ORDER BY created_at').all();
      return json(results);
    }
    if (path === 'users' && method === 'POST') {
      const auth = requireAdmin(request);
      if (auth.error) return auth.error;
      const { id, username, password, role, name } = await request.json();
      await db
        .prepare('INSERT INTO users (id, username, password, role, name) VALUES (?, ?, ?, ?, ?)')
        .bind(id, username, password, role, name)
        .run();
      await logActivity({ user: auth.user, action: 'entry', entityType: 'user', entityId: id, description: `👤 New ${role} account created: ${name} (@${username})` });
      return json({ success: true });
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
      const { username, password, active } = await request.json();
      const cur = await db.prepare('SELECT username, name, role, active FROM users WHERE id = ?').bind(id).first();
      if (!cur) return error('User not found', 404);
      const setClauses = []; const setParams = [];
      if (username !== undefined && username.trim() && username.trim() !== cur.username) { setClauses.push('username = ?'); setParams.push(username.trim()); }
      if (password !== undefined && password.trim()) { setClauses.push('password = ?'); setParams.push(password.trim()); }
      if (active !== undefined && Number(active) !== Number(cur.active ?? 1)) { setClauses.push('active = ?'); setParams.push(active ? 1 : 0); }
      if (setClauses.length) await db.prepare(`UPDATE users SET ${setClauses.join(', ')} WHERE id = ?`).bind(...setParams, id).run();
      if (username !== undefined && username.trim() && username.trim() !== cur.username)
        await logActivity({ user: auth.user, action: 'update', entityType: 'user', entityId: id, description: `👤 Username changed: ${cur.name} — @${cur.username} → @${username.trim()}` });
      if (password !== undefined && password.trim())
        await logActivity({ user: auth.user, action: 'update', entityType: 'user', entityId: id, description: `🔑 Password changed for ${cur.name} (@${cur.username})` });
      if (active !== undefined && Number(active) !== Number(cur.active ?? 1))
        await logActivity({ user: auth.user, action: active ? 'activate' : 'deactivate', entityType: 'user', entityId: id, description: `${active ? '✅' : '🔒'} User account ${active ? 'activated' : 'deactivated'}: ${cur.name} (@${cur.username})` });
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
      const auth = requireAdmin(request);
      if (auth.error) return auth.error;
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
      const { results } = await db.prepare('SELECT ref, data, status, created_at, updated_at FROM transactions ORDER BY created_at DESC').all();
      return json(results.map((r) => ({ ...JSON.parse(r.data), ref: r.ref, status: r.status })));
    }
    if (path === 'transactions' && method === 'POST') {
      const auth = requireAuth(request);
      if (auth.error) return auth.error;
      const tx = await request.json();
      const existing = await db.prepare('SELECT ref FROM transactions WHERE ref = ?').bind(tx.ref).first();
      await db
        .prepare("INSERT INTO transactions (ref, data, status, updated_at) VALUES (?, ?, ?, datetime('now')) ON CONFLICT (ref) DO UPDATE SET data = excluded.data, status = excluded.status, updated_at = datetime('now')")
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
      return json({ success: true });
    }
    if (path.startsWith('transactions/') && method === 'PUT') {
      const auth = requireAuth(request);
      if (auth.error) return auth.error;
      const ref = decodeURIComponent(path.split('/')[1]);
      const tx = await request.json();
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
        putAction = 'sold'; putDesc = `💰 Item sold — ${ref}: ${[tx.aiBrand, tx.aiModel].filter(Boolean).join(' ')} — sold for ₦${fmtNP(tx.salePrice)} (profit ₦${fmtNP(profit)})`;
      } else if (tx.status === 'for_sale') {
        putAction = 'update'; putDesc = `🏷 Marked for sale — ${ref}: ${[tx.aiBrand, tx.aiModel].filter(Boolean).join(' ')}`;
      } else {
        putAction = 'update'; putDesc = `🔄 Transaction updated — ${ref}`;
      }
      await logActivity({ user: auth.user, action: putAction, entityType: 'transaction', entityId: ref, description: putDesc });
      return json({ success: true });
    }
    if (path.startsWith('transactions/') && method === 'DELETE') {
      const auth = requireAdmin(request);
      if (auth.error) return auth.error;
      const ref = decodeURIComponent(path.split('/')[1]);
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
      // Delete photos from R2 before removing the draft record
      if (env.PHOTOS) {
        const row = await db.prepare('SELECT data FROM drafts WHERE ref = ?').bind(ref).first();
        if (row) {
          const keys = extractPhotoKeys(JSON.parse(row.data));
          if (keys.length > 0) await Promise.all(keys.map(k => env.PHOTOS.delete(k)));
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
      const { results } = await db.prepare('SELECT id, date, category, description, amount FROM expenses ORDER BY date DESC').all();
      return json(results);
    }
    if (path === 'expenses' && method === 'POST') {
      const auth = requireAuth(request);
      if (auth.error) return auth.error;
      const { date, category, description, amount } = await request.json();
      const inserted = await db
        .prepare('INSERT INTO expenses (date, category, description, amount) VALUES (?, ?, ?, ?)')
        .bind(date, category, description, amount)
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
    // DECLINED LOG: GET, POST /api/declined
    // ============================================================
    if (path === 'declined' && method === 'GET') {
      const auth = requireAuth(request);
      if (auth.error) return auth.error;
      const { results } = await db.prepare('SELECT id, date, item, reason FROM declined_log ORDER BY date DESC').all();
      return json(results);
    }
    if (path === 'declined' && method === 'POST') {
      const auth = requireAuth(request);
      if (auth.error) return auth.error;
      const { date, item, reason } = await request.json();
      const inserted = await db
        .prepare('INSERT INTO declined_log (date, item, reason) VALUES (?, ?, ?)')
        .bind(date, item, reason)
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
