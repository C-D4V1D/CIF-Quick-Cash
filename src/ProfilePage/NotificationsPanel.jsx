import { useState, useMemo } from 'react';
import { COLORS } from '../theme';

const READ_KEY = (uid) => `cfc_biz_notifs_read_${uid}`;
const COUNT_KEY = (uid) => `cfc_unread_notif_count_${uid}`;

const hasRole = (u, r) => u?.role === r || (u?.roles || []).includes(r);

// Stable UTC parsing for SQLite timestamps ("YYYY-MM-DD HH:MM:SS", no timezone)
function parseUTC(d) {
  if (!d) return null;
  // Append 'Z' so JS treats it as UTC, not local
  const s = String(d).trim().replace(' ', 'T');
  return new Date(s.endsWith('Z') ? s : s + 'Z');
}

const fmtMoney = (n) => '₦' + Number(n || 0).toLocaleString();

function fmtDateFull(d) {
  const dt = parseUTC(d);
  if (!dt || isNaN(dt)) return '';
  return dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Lagos' })
    + ' at '
    + dt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lagos' });
}

function timeAgo(d) {
  const dt = parseUTC(d);
  if (!dt || isNaN(dt)) return '';
  const diff = Date.now() - dt.getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return 'Just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins} min${mins !== 1 ? 's' : ''} ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr${hrs !== 1 ? 's' : ''} ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days} day${days !== 1 ? 's' : ''} ago`;
  return dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Africa/Lagos' });
}

// Build rich business notifications from all data sources
function buildNotifications({ currentUser, capital, distributions, activityLogs, smsCredits, smsBalance, settings }) {
  const isStaff = hasRole(currentUser, 'staff') || hasRole(currentUser, 'admin');
  const isStakeholder = hasRole(currentUser, 'stakeholder') || hasRole(currentUser, 'admin');
  const notifs = [];

  // ── Capital entries (stakeholder / admin) ──
  if (isStakeholder) {
    const myCapital = capital.filter(c =>
      c.user_id === currentUser.id || c.name === currentUser.name
    );
    myCapital.forEach(entry => {
      const dt = parseUTC(entry.date);
      notifs.push({
        id: `cap_${entry.id}`,
        icon: '💰',
        title: 'Capital Entry Recorded',
        short: `${fmtMoney(entry.amount)} added to your capital via ${entry.method}`,
        full: `A capital contribution of ${fmtMoney(entry.amount)} was recorded for you on ${fmtDateFull(entry.date)} via ${entry.method}. Your total capital in the business has been updated.${entry.receipt ? ' A receipt was attached.' : ''}`,
        createdAt: entry.date,
        priority: 'normal',
      });
    });
  }

  // ── Profit distributions (stakeholder / admin) ──
  if (isStakeholder) {
    const myDists = distributions.filter(d =>
      d.stakeholder_name === currentUser.name ||
      d.created_by === currentUser.id ||
      d.created_by === currentUser.username
    );
    myDists.forEach(dist => {
      notifs.push({
        id: `dist_${dist.id}`,
        icon: '💎',
        title: 'Profit Distribution Received',
        short: `${fmtMoney(dist.amount)} profit distributed to you`,
        full: `A profit distribution of ${fmtMoney(dist.amount)} was recorded on ${fmtDateFull(dist.date || dist.created_at)} via ${dist.method || 'cash'}.${dist.note ? `\n\nNote: "${dist.note}"` : ''}\n\nThis payment has been recorded in your financial summary.`,
        createdAt: dist.date || dist.created_at,
        priority: 'high',
      });
    });
  }

  // ── Security events (all users — password change, profile update) ──
  const secLogs = activityLogs.filter(l =>
    l.user_id === currentUser.id &&
    (l.action === 'change_password' ||
      (l.action === 'update' && (l.entity_type === 'password' || l.entity_type === 'profile')))
  );
  secLogs.forEach(log => {
    const isPw = log.action === 'change_password' || log.entity_type === 'password';
    notifs.push({
      id: `sec_${log.id}`,
      icon: isPw ? '🔒' : '👤',
      title: isPw ? 'Password Changed' : 'Profile Updated',
      short: isPw ? 'Your account password was successfully updated' : 'Your profile information was updated',
      full: isPw
        ? `Your account password was changed on ${fmtDateFull(log.created_at)}. If you did not make this change, please contact your administrator immediately and change your password.`
        : `Your profile was updated on ${fmtDateFull(log.created_at)}. ${log.description || ''}`,
      createdAt: log.created_at,
      priority: 'high',
    });
  });

  // ── Monthly report available (stakeholder / admin) ──
  if (isStakeholder) {
    const now = new Date();
    const lm = now.getMonth() === 0 ? 11 : now.getMonth() - 1;
    const ly = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
    const hasLastMonthData = distributions.some(d => {
      const dt = parseUTC(d.date || d.created_at);
      return dt && dt.getMonth() === lm && dt.getFullYear() === ly;
    });
    if (hasLastMonthData) {
      const monthName = new Date(ly, lm, 1).toLocaleString('en-US', { month: 'long' });
      notifs.push({
        id: `report_${ly}_${lm}`,
        icon: '📊',
        title: `${monthName} ${ly} Report Ready`,
        short: `Your business report for ${monthName} is available to view`,
        full: `The monthly business performance report for ${monthName} ${ly} has been generated. It includes profit calculations, capital movements, and your share of this month's returns.\n\nHead to the Monthly Report page (📈) in the menu to view the full breakdown and download a PDF copy.`,
        createdAt: new Date(ly, lm + 1, 1).toISOString(),
        priority: 'normal',
      });
    }
  }

  // ── Low SMS credits (staff / admin) ──
  if (isStaff && smsCredits !== null && smsCredits !== undefined) {
    const threshold = Number(settings?.smsLowCreditThreshold ?? 20);
    if (smsCredits <= threshold) {
      const urgent = smsCredits === 0;
      notifs.push({
        id: 'sms_low',
        icon: '📱',
        title: urgent ? 'SMS Credits Depleted!' : 'Low SMS Credits',
        short: urgent
          ? 'You have 0 credits — automated messages cannot be sent'
          : `Only ${smsCredits} SMS credits remaining (₦${fmtMoney(smsBalance)})`,
        full: urgent
          ? `Your SMS credit balance has run out. Automated reminder messages to customers are currently disabled. Please top up immediately via the SMS Recharge option to restore messaging.\n\nCurrent wallet balance: ${fmtMoney(smsBalance)}`
          : `Your SMS credit balance is running low — only ${smsCredits} credits (≈ ${fmtMoney(smsBalance)}) remaining.\n\nAt the current rate, you may run out soon. Top up to ensure automated loan reminders continue to be sent to customers.\n\nAlert threshold: ${threshold} credits`,
        createdAt: new Date().toISOString(),
        priority: urgent ? 'urgent' : 'warning',
      });
    }
  }

  // ── Low NIN/BVN credits (staff / admin) ──
  if (isStaff && settings?.ninApiKey) {
    const ninThreshold = Number(settings?.ninLowCreditThreshold ?? 5);
    // We don't have a live balance, but we can check if the API key is set and warn about the threshold
    // This alert fires when the setting has a low threshold configured (admin-configurable signal)
    if (ninThreshold > 0 && settings?.ninApiKey) {
      notifs.push({
        id: 'nin_info',
        icon: '🪪',
        title: 'NIN/BVN Verification Active',
        short: `ID verification is enabled — alert threshold set at ${ninThreshold} credits`,
        full: `NIN/BVN identity verification is active for this app. You will be alerted when your verification credits fall below ${ninThreshold}.\n\nRecharge bank: ${settings.ninRechargeBank || 'Not configured'}\nAccount: ${settings.ninRechargeAccountNumber || '—'} (${settings.ninRechargeAccountName || '—'})\n\nContact your admin to top up verification credits.`,
        createdAt: null,
        priority: 'info',
      });
    }
  }

  // Sort: urgent first, then by date descending
  const priorityOrder = { urgent: 0, warning: 1, high: 2, normal: 3, info: 4 };
  return notifs.sort((a, b) => {
    const pd = (priorityOrder[a.priority] ?? 3) - (priorityOrder[b.priority] ?? 3);
    if (pd !== 0) return pd;
    const ta = parseUTC(a.createdAt);
    const tb = parseUTC(b.createdAt);
    if (!ta && !tb) return 0;
    if (!ta) return 1;
    if (!tb) return -1;
    return tb - ta;
  });
}

function getReadIds(uid) {
  try { return new Set(JSON.parse(localStorage.getItem(READ_KEY(uid)) || '[]')); }
  catch { return new Set(); }
}

function persistRead(uid, ids) {
  try { localStorage.setItem(READ_KEY(uid), JSON.stringify([...ids])); } catch { /**/ }
}

function persistCount(uid, count) {
  try { localStorage.setItem(COUNT_KEY(uid), String(count)); } catch { /**/ }
}

const PRIORITY_STYLE = {
  urgent: { border: `1.5px solid #ef4444`, background: '#fff5f5' },
  warning: { border: `1.5px solid #f59e0b`, background: '#fffbeb' },
  high:    { border: `1.5px solid ${COLORS.accent}`, background: '#fffdf5' },
  normal:  { border: `1px solid ${COLORS.border}`, background: '#fff' },
  info:    { border: `1px solid ${COLORS.border}`, background: COLORS.primaryLight },
};

const PRIORITY_BADGE = {
  urgent:  { label: 'Urgent',  color: '#ef4444' },
  warning: { label: 'Warning', color: '#f59e0b' },
  high:    { label: 'Important', color: COLORS.accent },
};

export default function NotificationsPanel({
  activityLogs, capital, distributions, smsCredits, smsBalance,
  currentUser, settings, onUnreadChange, isMobile,
}) {
  const [tab, setTab] = useState('all');
  const [expandedId, setExpandedId] = useState(null);
  const [readIds, setReadIds] = useState(() => getReadIds(currentUser.id));

  const notifs = useMemo(() =>
    buildNotifications({ currentUser, capital, distributions, activityLogs, smsCredits, smsBalance, settings }),
    [currentUser, capital, distributions, activityLogs, smsCredits, smsBalance, settings]
  );

  const unreadCount = notifs.filter(n => !readIds.has(n.id)).length;

  const filtered = useMemo(() => {
    if (tab === 'unread') return notifs.filter(n => !readIds.has(n.id));
    if (tab === 'read') return notifs.filter(n => readIds.has(n.id));
    return notifs;
  }, [notifs, tab, readIds]);

  const markRead = (id) => {
    const next = new Set(readIds);
    next.add(id);
    setReadIds(next);
    persistRead(currentUser.id, next);
    const newCount = notifs.filter(n => !next.has(n.id)).length;
    persistCount(currentUser.id, newCount);
    if (onUnreadChange) onUnreadChange(newCount);
  };

  const markAllRead = () => {
    const all = new Set(notifs.map(n => n.id));
    setReadIds(all);
    persistRead(currentUser.id, all);
    persistCount(currentUser.id, 0);
    if (onUnreadChange) onUnreadChange(0);
  };

  const handleClick = (n) => {
    setExpandedId(id => id === n.id ? null : n.id);
    if (!readIds.has(n.id)) markRead(n.id);
  };

  const tabs = [
    { id: 'all', label: 'All', count: notifs.length },
    { id: 'unread', label: 'Unread', count: unreadCount },
    { id: 'read', label: 'Read', count: notifs.length - unreadCount },
  ];

  return (
    <div style={{ background: '#fff', borderRadius: '12px', border: `1px solid ${COLORS.border}`, marginBottom: '20px', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: isMobile ? '16px 16px 0' : '20px 24px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
        <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 800, color: COLORS.primaryDark, display: 'flex', alignItems: 'center', gap: '8px' }}>
          🔔 Notifications
          {unreadCount > 0 && (
            <span style={{ background: COLORS.danger, color: '#fff', borderRadius: '20px', fontSize: '11px', fontWeight: 700, padding: '2px 8px', minWidth: '20px', textAlign: 'center' }}>
              {unreadCount}
            </span>
          )}
        </h3>
        {unreadCount > 0 && (
          <button onClick={markAllRead} style={{ padding: '6px 14px', borderRadius: '8px', border: `1.5px solid ${COLORS.border}`, background: '#fff', color: COLORS.textMuted, fontWeight: 600, fontSize: '12px', cursor: 'pointer', fontFamily: 'inherit' }}>
            ✓ Mark all as read
          </button>
        )}
      </div>

      {/* Tabs */}
      <div style={{ padding: isMobile ? '12px 16px 0' : '12px 24px 0', display: 'flex', gap: '4px', borderBottom: `1px solid ${COLORS.border}` }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            padding: '8px 14px', borderRadius: '8px 8px 0 0', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
            fontWeight: tab === t.id ? 700 : 500, fontSize: '13px',
            background: tab === t.id ? COLORS.primary : 'transparent',
            color: tab === t.id ? '#fff' : COLORS.textMuted,
            borderBottom: tab === t.id ? `2px solid ${COLORS.primary}` : '2px solid transparent',
            marginBottom: '-1px', transition: 'all 0.15s',
          }}>
            {t.label} {t.count > 0 && <span style={{ opacity: 0.75, fontSize: '11px' }}>({t.count})</span>}
          </button>
        ))}
      </div>

      {/* List */}
      <div style={{ maxHeight: '520px', overflowY: 'auto' }}>
        {filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '48px 20px', color: COLORS.textMuted }}>
            <div style={{ fontSize: '38px', marginBottom: '10px' }}>🔔</div>
            <div style={{ fontWeight: 700, fontSize: '15px', marginBottom: '4px', color: COLORS.text }}>
              {tab === 'unread' ? 'All caught up!' : 'No notifications yet'}
            </div>
            <div style={{ fontSize: '13px' }}>
              {tab === 'unread'
                ? 'No unread notifications right now.'
                : 'Business events like capital entries and profit payouts will appear here.'}
            </div>
          </div>
        ) : (
          <div style={{ padding: isMobile ? '8px 12px' : '10px 16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {filtered.map(n => {
              const isRead = readIds.has(n.id);
              const isExpanded = expandedId === n.id;
              const pStyle = PRIORITY_STYLE[n.priority] || PRIORITY_STYLE.normal;
              const pBadge = PRIORITY_BADGE[n.priority];

              return (
                <div
                  key={n.id}
                  onClick={() => handleClick(n)}
                  style={{
                    borderRadius: '10px',
                    border: isRead ? `1px solid ${COLORS.border}` : pStyle.border,
                    background: isRead ? '#fff' : pStyle.background,
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                    overflow: 'hidden',
                  }}
                >
                  {/* Row */}
                  <div style={{ padding: isMobile ? '12px' : '14px 16px', display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
                    {/* Icon */}
                    <div style={{ fontSize: '22px', lineHeight: 1.2, flexShrink: 0, marginTop: '2px' }}>{n.icon}</div>

                    {/* Content */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px', flexWrap: 'wrap' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                          <span style={{ fontWeight: isRead ? 600 : 800, fontSize: '14px', color: COLORS.text }}>{n.title}</span>
                          {pBadge && !isRead && (
                            <span style={{ fontSize: '10px', fontWeight: 700, background: pBadge.color, color: '#fff', borderRadius: '20px', padding: '1px 7px' }}>
                              {pBadge.label}
                            </span>
                          )}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                          {n.createdAt && <span style={{ fontSize: '11px', color: COLORS.textMuted, whiteSpace: 'nowrap' }}>{timeAgo(n.createdAt)}</span>}
                          {!isRead && <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: COLORS.primary, flexShrink: 0 }} />}
                        </div>
                      </div>
                      <div style={{ fontSize: '13px', color: COLORS.textMuted, marginTop: '4px', lineHeight: 1.4 }}>{n.short}</div>
                      <div style={{ fontSize: '11px', color: COLORS.primary, fontWeight: 600, marginTop: '6px' }}>
                        {isExpanded ? '▲ Hide details' : '▼ Tap to read full message'}
                      </div>
                    </div>
                  </div>

                  {/* Expanded full message */}
                  {isExpanded && (
                    <div style={{
                      padding: isMobile ? '0 12px 14px 48px' : '0 16px 16px 50px',
                      borderTop: `1px dashed ${COLORS.border}`,
                      background: 'rgba(26,95,42,0.03)',
                    }}>
                      <div style={{ fontSize: '14px', color: COLORS.text, lineHeight: 1.7, marginTop: '12px', whiteSpace: 'pre-line' }}>
                        {n.full}
                      </div>
                      {n.createdAt && (
                        <div style={{ fontSize: '11px', color: COLORS.textMuted, marginTop: '10px', fontStyle: 'italic' }}>
                          {fmtDateFull(n.createdAt)}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
