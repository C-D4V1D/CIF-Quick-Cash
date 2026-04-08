/**
 * cifcash-cron — Cloudflare Worker that triggers daily SMS auto-send.
 *
 * PROBLEM SOLVED:
 *   The main app calls POST /api/sms/auto-send from the browser once per session.
 *   If no staff member opens the app on a given day, zero scheduled SMS are sent.
 *   This Worker fires on a cron schedule so reminders run reliably every day.
 *
 * HOW TO DEPLOY:
 *   1. Set CRON_SECRET in both places:
 *      a) Cloudflare Pages dashboard → cifcash → Settings → Environment variables → CRON_SECRET
 *      b) This Worker → Settings → Variables → CRON_SECRET  (same value)
 *      Generate a secret: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 *
 *   2. Deploy this Worker (once, from the repo root):
 *      npx wrangler deploy cron-worker.js --name cifcash-cron --compatibility-date 2024-09-23
 *
 *   3. Add the cron trigger in the Cloudflare dashboard:
 *      Workers & Pages → cifcash-cron → Triggers → Cron Triggers → Add
 *      Expression: 0 8 * * *   (fires at 08:00 UTC = 09:00 Nigeria WAT every day)
 *
 *   Alternatively, define the trigger in a wrangler.toml for this Worker:
 *      [triggers]
 *      crons = ["0 8 * * *"]
 *
 * HOW IT WORKS:
 *   The Worker sends POST /api/sms/auto-send with the X-Cron-Secret header.
 *   The Pages Function accepts this header as an alternative to cookie auth.
 *   The auto-send logic already enforces NCC quiet hours (8AM–8PM Nigeria) internally,
 *   so scheduling at 9AM Nigeria time gives a clean first run of the day.
 */

const PAGES_APP_URL = 'https://cifcash.pages.dev';

export default {
  async scheduled(event, env, ctx) {
    const secret = env.CRON_SECRET;
    if (!secret) {
      console.error('[cifcash-cron] CRON_SECRET is not set — aborting to avoid unauthenticated request.');
      return;
    }

    const url = `${PAGES_APP_URL}/api/sms/auto-send`;
    console.log(`[cifcash-cron] Triggering auto-send at ${new Date().toISOString()} → ${url}`);

    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Cron-Secret': secret,
        },
        body: JSON.stringify({}),
      });

      const data = await resp.json().catch(() => ({}));
      if (data?.skipped) {
        console.log(`[cifcash-cron] Skipped: ${data.reason || data.detail || JSON.stringify(data)}`);
      } else {
        console.log(`[cifcash-cron] Done — sent: ${data?.sent?.length ?? 0}, failed: ${data?.failed?.length ?? 0}, skipped: ${data?.skipped?.length ?? 0}`);
      }
    } catch (e) {
      console.error(`[cifcash-cron] Fetch error: ${e.message}`);
    }
  },
};
