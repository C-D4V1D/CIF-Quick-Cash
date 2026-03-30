import { COLORS } from '../theme';

const ROLE_COLORS = {
  admin: '#7c3aed',
  staff: '#2563eb',
  stakeholder: '#059669',
};

function nameToColor(name = '') {
  // Deterministic pastel-ish hue from name
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 55%, 38%)`;
}

function getInitials(name = '') {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map(w => w[0].toUpperCase())
    .join('');
}

function fmtDateLong(d) {
  if (!d) return '—';
  // Parse as UTC (SQLite datetime('now') returns UTC without 'Z')
  const s = String(d).trim().replace(' ', 'T');
  const dt = new Date(s.endsWith('Z') ? s : s + 'Z');
  return isNaN(dt) ? '—' : dt.toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Lagos',
  });
}

function parseUTC(d) {
  if (!d) return null;
  const s = String(d).trim().replace(' ', 'T');
  return new Date(s.endsWith('Z') ? s : s + 'Z');
}

function timeAgo(d) {
  if (!d) return '—';
  const dt = parseUTC(d);
  if (!dt || isNaN(dt)) return '—';
  const diff = Date.now() - dt.getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return 'Just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins} minute${mins !== 1 ? 's' : ''} ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs !== 1 ? 's' : ''} ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days} day${days !== 1 ? 's' : ''} ago`;
  return fmtDateLong(d);
}

export default function ProfileHeader({ currentUser, lastActive, isMobile }) {
  const initials = getInitials(currentUser.name);
  const avatarColor = nameToColor(currentUser.name);
  const allRoles = [currentUser.role, ...(currentUser.roles || [])].filter(Boolean);
  const memberSince = currentUser.created_at;

  return (
    <div style={{
      background: `linear-gradient(135deg, ${COLORS.primaryDark} 0%, ${COLORS.primary} 100%)`,
      borderRadius: '16px',
      padding: isMobile ? '24px 20px' : '32px 36px',
      marginBottom: '24px',
      color: '#fff',
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* Decorative circles */}
      <div style={{ position: 'absolute', top: -40, right: -40, width: 160, height: 160, borderRadius: '50%', background: 'rgba(255,255,255,0.05)', pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', bottom: -30, left: '30%', width: 100, height: 100, borderRadius: '50%', background: 'rgba(255,255,255,0.04)', pointerEvents: 'none' }} />

      <div style={{ display: 'flex', alignItems: isMobile ? 'flex-start' : 'center', gap: '24px', flexDirection: isMobile ? 'column' : 'row', position: 'relative' }}>
        {/* Avatar */}
        <div style={{
          width: isMobile ? 72 : 88,
          height: isMobile ? 72 : 88,
          borderRadius: '50%',
          background: avatarColor,
          border: '3px solid rgba(255,255,255,0.4)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: isMobile ? '26px' : '32px',
          fontWeight: 800,
          color: '#fff',
          flexShrink: 0,
          boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
          letterSpacing: '-1px',
        }}>
          {initials || '?'}
        </div>

        {/* Info */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: isMobile ? '22px' : '28px', fontWeight: 800, letterSpacing: '-0.5px', marginBottom: '6px', wordBreak: 'break-word' }}>
            {currentUser.name}
          </div>
          <div style={{ fontSize: '14px', opacity: 0.8, marginBottom: '10px' }}>
            @{currentUser.username}
          </div>

          {/* Role badges */}
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '14px' }}>
            {allRoles.map(r => (
              <span key={r} style={{
                display: 'inline-block',
                padding: '4px 12px',
                borderRadius: '20px',
                fontSize: '12px',
                fontWeight: 700,
                background: r === 'admin' ? 'rgba(124,58,237,0.7)' : r === 'staff' ? 'rgba(37,99,235,0.7)' : 'rgba(5,150,105,0.7)',
                border: '1px solid rgba(255,255,255,0.25)',
                textTransform: 'capitalize',
                letterSpacing: '0.3px',
              }}>
                {r === 'admin' ? '⚡ Admin' : r === 'staff' ? '💼 Staff' : '💰 Stakeholder'}
              </span>
            ))}
          </div>

          {/* Meta info */}
          <div style={{ display: 'flex', gap: isMobile ? '12px' : '24px', flexWrap: 'wrap', fontSize: '13px', opacity: 0.85 }}>
            {memberSince && (
              <div>
                <span style={{ opacity: 0.7, fontSize: '11px', display: 'block', marginBottom: '1px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Member Since</span>
                <strong>{fmtDateLong(memberSince)}</strong>
              </div>
            )}
            {lastActive && (
              <div>
                <span style={{ opacity: 0.7, fontSize: '11px', display: 'block', marginBottom: '1px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Last Active</span>
                <strong>{timeAgo(lastActive)}</strong>
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
