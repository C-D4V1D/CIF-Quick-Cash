import { useState, useEffect, useMemo } from 'react';
import { COLORS } from '../theme';
import ProfileHeader from './ProfileHeader';
import ContactInfo from './ContactInfo';
import NotificationsPanel from './NotificationsPanel';
import StaffPerformance from './StaffPerformance';
import FinancialSummary from './FinancialSummary';
import ActivityLog from './ActivityLog';

const hasRole = (u, r) => u?.role === r || (u?.roles || []).includes(r);

const COUNT_KEY = (uid) => `cfc_unread_notif_count_${uid}`;

// Read the persisted unread count — called by App.jsx for the top-bar badge
export function getUnreadCount(uid) {
  try { return parseInt(localStorage.getItem(COUNT_KEY(uid)) || '0', 10); }
  catch { return 0; }
}

// Skeleton loader
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
  smsCredits = null,
  smsBalance = null,
  loadData,
  isMobile,
  onUnreadChange,
  onContactSaved,
}) {
  const [dataReady, setDataReady] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDataReady(true), 300);
    return () => clearTimeout(t);
  }, []);

  const isStaff = hasRole(currentUser, 'staff') || hasRole(currentUser, 'admin');
  const isStakeholder = hasRole(currentUser, 'stakeholder') || hasRole(currentUser, 'admin');

  // Derive last active from activity logs (parse as UTC)
  const lastActive = useMemo(() => {
    const myLogs = activityLogs.filter(l => l.user_id === currentUser.id);
    if (myLogs.length === 0) return null;
    const parseUTC = (d) => {
      const s = String(d || '').trim().replace(' ', 'T');
      return new Date(s.endsWith('Z') ? s : s + 'Z');
    };
    return [...myLogs].sort((a, b) => parseUTC(b.created_at) - parseUTC(a.created_at))[0]?.created_at || null;
  }, [activityLogs, currentUser.id]);

  if (!dataReady) {
    return (
      <div>
        <Skeleton height={180} />
        <Skeleton height={120} />
        <Skeleton height={300} />
        <style>{`@keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }`}</style>
      </div>
    );
  }

  return (
    <div style={{ fontFamily: "'DM Sans', 'Nunito', sans-serif", maxWidth: '900px', margin: '0 auto' }}>
      <style>{`@keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }`}</style>

      <ProfileHeader
        currentUser={currentUser}
        lastActive={lastActive}
        isMobile={isMobile}
      />

      <ContactInfo
        currentUser={currentUser}
        onSaved={onContactSaved}
        isMobile={isMobile}
      />

      <NotificationsPanel
        activityLogs={activityLogs}
        capital={capital}
        distributions={distributions}
        transactions={transactions}
        smsCredits={smsCredits}
        smsBalance={smsBalance}
        currentUser={currentUser}
        settings={settings}
        onUnreadChange={onUnreadChange}
        isMobile={isMobile}
      />

      {isStaff && (
        <StaffPerformance
          currentUser={currentUser}
          transactions={transactions}
          users={users}
          settings={settings}
          isMobile={isMobile}
        />
      )}

      {isStakeholder && (
        <FinancialSummary
          currentUser={currentUser}
          capital={capital}
          distributions={distributions}
          isMobile={isMobile}
        />
      )}

      <ActivityLog
        activityLogs={activityLogs}
        currentUser={currentUser}
        isMobile={isMobile}
      />
    </div>
  );
}
