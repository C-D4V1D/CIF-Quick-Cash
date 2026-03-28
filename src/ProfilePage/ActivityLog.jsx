import { useState, useMemo } from 'react';
import { COLORS } from '../theme';

const ACTION_META = {
  login:  { icon: '🔑', label: 'Signed in' },
  logout: { icon: '👋', label: 'Signed out' },
  create: { icon: '➕', label: 'Created' },
  update: { icon: '✏️', label: 'Updated' },
  delete: { icon: '🗑️', label: 'Deleted' },
  approve: { icon: '✅', label: 'Approved' },
  download: { icon: '⬇️', label: 'Downloaded' },
  change_password: { icon: '🔒', label: 'Changed password' },
  view: { icon: '👁️', label: 'Viewed' },
};

const ENTITY_LABELS = {
  transaction: 'transaction',
  repayment: 'repayment',
  sale: 'sale',
  expense: 'expense',
  capital: 'capital entry',
  distribution: 'profit distribution',
  report: 'report',
  user: 'user',
  profile: 'profile',
  password: 'password',
  settings: 'settings',
  draft: 'draft',
  declined: 'declined log',
};

function formatEntry(log) {
  const meta = ACTION_META[log.action] || { icon: '🔔', label: log.action };
  const entityLabel = ENTITY_LABELS[log.entity_type] || log.entity_type || '';
  const desc = log.description || `${meta.label}${entityLabel ? ` a ${entityLabel}` : ''}`;
  return { icon: meta.icon, desc };
}

// SQLite stores UTC without 'Z' — force UTC parsing
function parseUTC(d) {
  if (!d) return null;
  const s = String(d).trim().replace(' ', 'T');
  return new Date(s.endsWith('Z') ? s : s + 'Z');
}

function timeStr(d) {
  const dt = parseUTC(d);
  if (!dt || isNaN(dt)) return '';
  return dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Lagos' })
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
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return timeStr(d);
}

const PAGE_SIZE = 7;

export default function ActivityLog({ activityLogs, currentUser, isMobile }) {
  const [page, setPage] = useState(1);

  // Filter to current user's own logs
  const myLogs = useMemo(() =>
    activityLogs.filter(l => l.user_id === currentUser.id),
    [activityLogs, currentUser.id]
  );

  const totalPages = Math.max(1, Math.ceil(myLogs.length / PAGE_SIZE));
  const pageLogs = myLogs.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div style={{ background: '#fff', borderRadius: '12px', border: `1px solid ${COLORS.border}`, marginBottom: '20px', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: isMobile ? '16px' : '20px 24px', borderBottom: `1px solid ${COLORS.border}` }}>
        <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 800, color: COLORS.primaryDark, display: 'flex', alignItems: 'center', gap: '8px' }}>
          🕘 Your Activity Log
          {myLogs.length > 0 && (
            <span style={{ fontSize: '12px', fontWeight: 600, color: COLORS.textMuted, background: COLORS.bg, padding: '2px 10px', borderRadius: '20px', border: `1px solid ${COLORS.border}` }}>
              {myLogs.length}
            </span>
          )}
        </h3>
        <div style={{ fontSize: '13px', color: COLORS.textMuted, marginTop: '4px' }}>A record of everything you've done in the app</div>
      </div>

      {myLogs.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px 20px', color: COLORS.textMuted }}>
          <div style={{ fontSize: '40px', marginBottom: '12px' }}>🕘</div>
          <div style={{ fontWeight: 700, fontSize: '15px', marginBottom: '4px', color: COLORS.text }}>No activity yet</div>
          <div style={{ fontSize: '13px' }}>Actions you take in the app will appear here.</div>
        </div>
      ) : (
        <>
          {/* Timeline */}
          <div style={{ padding: isMobile ? '8px 16px' : '8px 24px' }}>
            {pageLogs.map((log, idx) => {
              const { icon, desc } = formatEntry(log);
              const isLast = idx === pageLogs.length - 1;
              return (
                <div key={log.id} style={{ display: 'flex', gap: '14px', padding: '12px 0', borderBottom: isLast ? 'none' : `1px solid ${COLORS.border}`, alignItems: 'flex-start' }}>
                  {/* Icon + line */}
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
                    <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: COLORS.primaryLight, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px', border: `2px solid ${COLORS.border}` }}>
                      {icon}
                    </div>
                    {!isLast && <div style={{ width: '2px', flex: 1, minHeight: '20px', background: COLORS.border, marginTop: '4px' }} />}
                  </div>

                  {/* Content */}
                  <div style={{ flex: 1, minWidth: 0, paddingTop: '6px' }}>
                    <div style={{ fontSize: '14px', fontWeight: 600, color: COLORS.text, lineHeight: 1.4 }}>
                      {desc}
                    </div>
                    {log.entity_id && (
                      <div style={{ fontSize: '12px', color: COLORS.textMuted, marginTop: '2px' }}>
                        ID: {log.entity_id}
                      </div>
                    )}
                    <div style={{ fontSize: '12px', color: COLORS.textMuted, marginTop: '4px' }} title={timeStr(log.created_at)}>
                      {timeAgo(log.created_at)}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '12px', padding: '16px', borderTop: `1px solid ${COLORS.border}` }}>
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                style={{ padding: '7px 16px', borderRadius: '8px', border: `1.5px solid ${COLORS.border}`, background: page === 1 ? COLORS.bg : '#fff', color: page === 1 ? COLORS.textMuted : COLORS.text, fontWeight: 600, fontSize: '13px', cursor: page === 1 ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}
              >
                ← Prev
              </button>
              <span style={{ fontSize: '13px', color: COLORS.textMuted, fontWeight: 600 }}>
                Page {page} of {totalPages}
              </span>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                style={{ padding: '7px 16px', borderRadius: '8px', border: `1.5px solid ${COLORS.border}`, background: page === totalPages ? COLORS.bg : '#fff', color: page === totalPages ? COLORS.textMuted : COLORS.text, fontWeight: 600, fontSize: '13px', cursor: page === totalPages ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}
              >
                Next →
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
