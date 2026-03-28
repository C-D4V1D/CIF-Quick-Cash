import { useState, useEffect, useMemo } from 'react';
import { COLORS } from '../theme';
import ProfileHeader from './ProfileHeader';
import ContactInfo from './ContactInfo';
import NotificationsPanel from './NotificationsPanel';
import StaffPerformance from './StaffPerformance';
import FinancialSummary from './FinancialSummary';
import ActivityLog from './ActivityLog';

const hasRole = (u, r) => u?.role === r || (u?.roles || []).includes(r);

const READ_KEY = (uid) => `cfc_notifs_read_${uid}`;
function getUnreadCount(uid, logs) {
  try {
    const readIds = new Set(JSON.parse(localStorage.getItem(READ_KEY(uid)) || '[]'));
    return logs.filter(l => l.user_id === uid && !readIds.has(l.id)).length;
  } catch { return 0; }
}

// Skeleton loader for cards
function Skeleton({ height = 120 }) {
  return (
    <div style={{
      background: `linear-gradient(90deg, ${COLORS.bg} 25%, #ede9e0 50%, ${COLORS.bg} 75%)`,
      backgroundSize: '200% 100%',
      animation: 'shimmer 1.4s infinite',
      borderRadius: '12px',
      height,
      marginBottom: '20px',
    }} />
  );
}

export default function ProfilePage({
  currentUser,
  transactions = [],
  capital = [],
  distributions = [],
  activityLogs = [],
  users = [],
  settings = {},
  loadData,
  isMobile,
  onUnreadChange,
}) {
  const [editMode, setEditMode] = useState(false);
  const [dataReady, setDataReady] = useState(false);

  // Brief delay to simulate skeleton state if data hasn't loaded
  useEffect(() => {
    const t = setTimeout(() => setDataReady(true), 300);
    return () => clearTimeout(t);
  }, []);

  const isStaff = hasRole(currentUser, 'staff') || hasRole(currentUser, 'admin');
  const isStakeholder = hasRole(currentUser, 'stakeholder') || hasRole(currentUser, 'admin');

  // Derive last active timestamp from activity logs
  const lastActive = useMemo(() => {
    const myLogs = activityLogs.filter(l => l.user_id === currentUser.id);
    if (myLogs.length === 0) return null;
    const sorted = [...myLogs].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    return sorted[0]?.created_at || null;
  }, [activityLogs, currentUser.id]);

  const handleUnreadChange = (count) => {
    if (onUnreadChange) onUnreadChange(count);
  };

  if (!dataReady) {
    return (
      <div>
        <Skeleton height={180} />
        <Skeleton height={120} />
        <Skeleton height={300} />
      </div>
    );
  }

  return (
    <div style={{ fontFamily: "'DM Sans', 'Nunito', sans-serif", maxWidth: '900px', margin: '0 auto' }}>
      {/* Inject shimmer animation */}
      <style>{`
        @keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }
      `}</style>

      {/* Profile Header */}
      <ProfileHeader
        currentUser={currentUser}
        lastActive={lastActive}
        isMobile={isMobile}
        onEditClick={() => setEditMode(true)}
      />

      {/* Contact & Security */}
      <ContactInfo
        currentUser={currentUser}
        editMode={editMode}
        onEditModeChange={setEditMode}
        onSaved={() => setEditMode(false)}
        isMobile={isMobile}
      />

      {/* Notifications */}
      <NotificationsPanel
        activityLogs={activityLogs}
        currentUser={currentUser}
        onUnreadChange={handleUnreadChange}
        isMobile={isMobile}
      />

      {/* Staff Performance (staff + admin only) */}
      {isStaff && (
        <StaffPerformance
          currentUser={currentUser}
          transactions={transactions}
          users={users}
          settings={settings}
          isMobile={isMobile}
        />
      )}

      {/* Financial Summary (stakeholder + admin only) */}
      {isStakeholder && (
        <FinancialSummary
          currentUser={currentUser}
          capital={capital}
          distributions={distributions}
          isMobile={isMobile}
        />
      )}

      {/* Activity Log (all users) */}
      <ActivityLog
        activityLogs={activityLogs}
        currentUser={currentUser}
        isMobile={isMobile}
      />
    </div>
  );
}

// Export the unread count helper for App.jsx to use in the top bar
export { getUnreadCount };
