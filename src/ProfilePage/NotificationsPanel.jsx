import { useState, useMemo } from 'react';
import { COLORS } from '../theme';

const READ_KEY = (uid) => `cfc_notifs_read_${uid}`;

function getReadIds(uid) {
  try { return new Set(JSON.parse(localStorage.getItem(READ_KEY(uid)) || '[]')); }
  catch { return new Set(); }
}

function markRead(uid, ids) {
  try {
    const current = getReadIds(uid);
    ids.forEach(id => current.add(id));
    localStorage.setItem(READ_KEY(uid), JSON.stringify([...current]));
  } catch { /* ignore */ }
}

function markAllRead(uid, ids) {
  try {
    localStorage.setItem(READ_KEY(uid), JSON.stringify(ids));
  } catch { /* ignore */ }
}

// Map an activity log entry to a notification card
function logToNotif(log) {
  const action = log.action || '';
  const entity = log.entity_type || '';
  const desc = log.description || '';

  let icon = '🔔';
  let title = 'Activity';
  let body = desc;

  if (action === 'login') { icon = '🔑'; title = 'You signed in'; }
  else if (action === 'logout') { icon = '👋'; title = 'You signed out'; }
  else if (action === 'create' && entity === 'transaction') { icon = '📄'; title = 'Transaction created'; }
  else if (action === 'update' && entity === 'transaction') { icon = '✏️'; title = 'Transaction updated'; }
  else if (action === 'approve' && entity === 'transaction') { icon = '✅'; title = 'Transaction approved'; }
  else if (action === 'create' && entity === 'repayment') { icon = '💸'; title = 'Repayment recorded'; }
  else if (action === 'create' && entity === 'sale') { icon = '🏷️'; title = 'Item sold'; }
  else if (action === 'change_password' || (action === 'update' && entity === 'password')) { icon = '🔒'; title = 'Password changed'; }
  else if (action === 'update' && entity === 'profile') { icon = '👤'; title = 'Profile updated'; }
  else if (action === 'create' && entity === 'capital') { icon = '💰'; title = 'Capital entry added'; }
  else if (action === 'create' && entity === 'distribution') { icon = '💎'; title = 'Profit distribution recorded'; }
  else if (action === 'create' && entity === 'expense') { icon = '🧾'; title = 'Expense added'; }
  else if (action === 'download' || entity === 'report') { icon = '📊'; title = 'Report generated'; }
  else if (action === 'create' && entity === 'user') { icon = '👥'; title = 'New user added'; }
  else if (desc) { title = desc.length > 60 ? desc.slice(0, 57) + '…' : desc; body = ''; }

  return { id: log.id, icon, title, body: body || '', createdAt: log.created_at };
}

function timeAgo(d) {
  if (!d) return '';
  const diff = Date.now() - new Date(d).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 2) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export default function NotificationsPanel({ activityLogs, currentUser, onUnreadChange, isMobile }) {
  const [tab, setTab] = useState('all');
  const [readIds, setReadIds] = useState(() => getReadIds(currentUser.id));

  // Build notification list from this user's activity logs
  const notifs = useMemo(() => {
    return activityLogs
      .filter(l => l.user_id === currentUser.id)
      .slice(0, 60) // cap at 60 most recent
      .map(logToNotif);
  }, [activityLogs, currentUser.id]);

  const filtered = useMemo(() => {
    if (tab === 'unread') return notifs.filter(n => !readIds.has(n.id));
    if (tab === 'read') return notifs.filter(n => readIds.has(n.id));
    return notifs;
  }, [notifs, tab, readIds]);

  const unreadCount = notifs.filter(n => !readIds.has(n.id)).length;

  const handleMarkRead = (id) => {
    markRead(currentUser.id, [id]);
    const next = new Set(readIds);
    next.add(id);
    setReadIds(next);
    if (onUnreadChange) onUnreadChange(Math.max(0, unreadCount - 1));
  };

  const handleMarkAllRead = () => {
    const allIds = notifs.map(n => n.id);
    markAllRead(currentUser.id, allIds);
    setReadIds(new Set(allIds));
    if (onUnreadChange) onUnreadChange(0);
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
          <button onClick={handleMarkAllRead} style={{ padding: '6px 14px', borderRadius: '8px', border: `1.5px solid ${COLORS.border}`, background: '#fff', color: COLORS.textMuted, fontWeight: 600, fontSize: '12px', cursor: 'pointer', fontFamily: 'inherit' }}>
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
            marginBottom: '-1px',
            transition: 'all 0.15s',
          }}>
            {t.label} {t.count > 0 && <span style={{ opacity: 0.75, fontSize: '11px' }}>({t.count})</span>}
          </button>
        ))}
      </div>

      {/* List */}
      <div style={{ maxHeight: '400px', overflowY: 'auto', padding: isMobile ? '8px 0' : '8px 0' }}>
        {filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 20px', color: COLORS.textMuted }}>
            <div style={{ fontSize: '36px', marginBottom: '10px' }}>🔔</div>
            <div style={{ fontWeight: 700, fontSize: '15px', marginBottom: '4px', color: COLORS.text }}>
              {tab === 'unread' ? 'All caught up!' : 'No notifications yet'}
            </div>
            <div style={{ fontSize: '13px' }}>
              {tab === 'unread' ? 'You have no unread notifications.' : 'Your activity will appear here.'}
            </div>
          </div>
        ) : (
          filtered.map(n => {
            const isRead = readIds.has(n.id);
            return (
              <div
                key={n.id}
                onClick={() => !isRead && handleMarkRead(n.id)}
                style={{
                  padding: isMobile ? '12px 16px' : '14px 24px',
                  borderBottom: `1px solid ${COLORS.border}`,
                  cursor: isRead ? 'default' : 'pointer',
                  background: isRead ? '#fff' : COLORS.primaryLight,
                  transition: 'background 0.15s',
                  display: 'flex',
                  gap: '14px',
                  alignItems: 'flex-start',
                }}
                onMouseEnter={e => { if (!isRead) e.currentTarget.style.background = '#daf0e2'; }}
                onMouseLeave={e => { if (!isRead) e.currentTarget.style.background = COLORS.primaryLight; }}
              >
                {/* Icon */}
                <div style={{ fontSize: '22px', lineHeight: 1.2, flexShrink: 0, marginTop: '1px' }}>{n.icon}</div>

                {/* Content */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                    <div style={{ fontWeight: isRead ? 500 : 700, fontSize: '14px', color: COLORS.text, lineHeight: 1.3 }}>{n.title}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                      <span style={{ fontSize: '11px', color: COLORS.textMuted, whiteSpace: 'nowrap' }}>{timeAgo(n.createdAt)}</span>
                      {!isRead && (
                        <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: COLORS.primary, flexShrink: 0 }} />
                      )}
                    </div>
                  </div>
                  {n.body && (
                    <div style={{ fontSize: '13px', color: COLORS.textMuted, marginTop: '3px', lineHeight: 1.4 }}>{n.body}</div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
