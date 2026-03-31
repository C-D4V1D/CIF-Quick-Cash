import { useState } from 'react';
import { COLORS } from '../theme';
import ChangePasswordModal from './ChangePasswordModal';

const API_BASE = '/api';
const apiFetch = (path, opts = {}) =>
  fetch(`${API_BASE}/${path}`, { credentials: 'include', ...opts });

const inputStyle = {
  width: '100%', padding: '10px 12px', borderRadius: '8px',
  border: `1.5px solid ${COLORS.border}`, fontSize: '14px', outline: 'none',
  boxSizing: 'border-box', background: '#fff', fontFamily: 'inherit',
  transition: 'border-color 0.2s',
};

const labelStyle = {
  fontSize: '12px', fontWeight: 600, color: COLORS.textMuted, marginBottom: '5px',
  display: 'block', textTransform: 'uppercase', letterSpacing: '0.5px',
};

const valueStyle = {
  fontSize: '15px', fontWeight: 600, color: COLORS.text, padding: '9px 0',
  borderBottom: `1px dashed ${COLORS.border}`,
};

function Row({ label, value, editMode, inputProps }) {
  return (
    <div style={{ marginBottom: '18px' }}>
      <label style={labelStyle}>{label}</label>
      {editMode
        ? <input style={inputStyle} {...inputProps} />
        : <div style={valueStyle}>{value || <span style={{ color: COLORS.textMuted, fontStyle: 'italic', fontWeight: 400 }}>Not set</span>}</div>
      }
    </div>
  );
}

export default function ContactInfo({ currentUser, onSaved, isMobile }) {
  const [editMode, setEditMode] = useState(false);
  const [phone1, setPhone1] = useState(currentUser.phone1 || '');
  const [phone2, setPhone2] = useState(currentUser.phone2 || '');
  const [email, setEmail] = useState(currentUser.email || '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [showPwModal, setShowPwModal] = useState(false);
  const [testNotifState, setTestNotifState] = useState('idle'); // idle | sending | ok | error | no_sub | no_vapid | vapid_error | push_rejected

  const sendTestNotification = async () => {
    setTestNotifState('sending');
    try {
      // Ensure the browser is subscribed first
      if ('serviceWorker' in navigator && 'PushManager' in window) {
        const reg = await navigator.serviceWorker.ready;
        const existing = await reg.pushManager.getSubscription();
        if (!existing) {
          // Try to subscribe
          const keyRes = await apiFetch('push/vapid-public-key');
          const keyData = keyRes.ok ? await keyRes.json() : null;
          if (keyData?.publicKey) {
            const padding = '='.repeat((4 - (keyData.publicKey.length % 4)) % 4);
            const b64 = (keyData.publicKey + padding).replace(/-/g, '+').replace(/_/g, '/');
            const applicationServerKey = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
            if (Notification.permission !== 'granted') {
              const perm = await Notification.requestPermission();
              if (perm !== 'granted') { setTestNotifState('error'); return; }
            }
            const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
            await apiFetch('push/subscribe', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(sub.toJSON()),
            });
          }
        }
      }
      const res = await apiFetch('push/test', { method: 'POST' });
      const data = await res.json().catch(() => null);
      if (data?.success) {
        setTestNotifState('ok');
      } else if (data?.reason === 'no_subscription') {
        setTestNotifState('no_sub');
      } else if (data?.reason === 'vapid_not_configured') {
        setTestNotifState('no_vapid');
      } else if (data?.reason === 'vapid_error') {
        setTestNotifState('vapid_error');
      } else if (data?.reason === 'push_rejected') {
        setTestNotifState('push_rejected');
      } else {
        setTestNotifState('error');
      }
    } catch {
      setTestNotifState('error');
    }
    setTimeout(() => setTestNotifState('idle'), 6000);
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveError('');
    try {
      const res = await fetch(`/api/users/${currentUser.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ phone1: phone1.trim(), phone2: phone2.trim(), email: email.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setSaveError(body.error || 'Failed to save. Please try again.');
        setSaving(false);
        return;
      }
      setSaved(true);
      setEditMode(false);
      setTimeout(() => setSaved(false), 2500);
      if (onSaved) onSaved({ phone1: phone1.trim(), phone2: phone2.trim(), email: email.trim() });
    } catch {
      setSaveError('Network error. Please try again.');
    }
    setSaving(false);
  };

  const handleCancel = () => {
    setPhone1(currentUser.phone1 || '');
    setPhone2(currentUser.phone2 || '');
    setEmail(currentUser.email || '');
    setSaveError('');
    setEditMode(false);
  };

  return (
    <>
      <div style={{ background: '#fff', borderRadius: '12px', padding: isMobile ? '20px' : '24px', border: `1px solid ${COLORS.border}`, marginBottom: '20px' }}>
        {/* Header row */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 800, color: COLORS.primaryDark, display: 'flex', alignItems: 'center', gap: '8px' }}>
            📋 Contact & Security
          </h3>
          {!editMode && (
            <button
              onClick={() => setEditMode(true)}
              style={{ padding: '7px 16px', borderRadius: '8px', border: `1.5px solid ${COLORS.primary}`, background: 'transparent', color: COLORS.primary, fontWeight: 700, fontSize: '13px', cursor: 'pointer', fontFamily: 'inherit' }}
            >
              ✏️ Edit
            </button>
          )}
          {saved && <span style={{ fontSize: '13px', color: COLORS.primary, fontWeight: 600 }}>✅ Saved!</span>}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '0 32px' }}>
          {/* Non-editable */}
          <div style={{ marginBottom: '18px' }}>
            <label style={labelStyle}>Full Name</label>
            <div style={{ ...valueStyle, display: 'flex', alignItems: 'center', gap: '8px' }}>
              {currentUser.name}
              <span style={{ fontSize: '11px', background: COLORS.bg, border: `1px solid ${COLORS.border}`, borderRadius: '6px', padding: '2px 8px', color: COLORS.textMuted, fontWeight: 600 }}>Read-only</span>
            </div>
          </div>

          <div style={{ marginBottom: '18px' }}>
            <label style={labelStyle}>Username</label>
            <div style={{ ...valueStyle, display: 'flex', alignItems: 'center', gap: '8px' }}>
              @{currentUser.username}
              <span style={{ fontSize: '11px', background: COLORS.bg, border: `1px solid ${COLORS.border}`, borderRadius: '6px', padding: '2px 8px', color: COLORS.textMuted, fontWeight: 600 }}>Read-only</span>
            </div>
          </div>

          {/* Editable */}
          <Row label="Phone Number 1" value={phone1} editMode={editMode}
            inputProps={{ value: phone1, onChange: e => setPhone1(e.target.value), placeholder: '+234 800 000 0000', type: 'tel' }} />

          <Row label="Phone Number 2" value={phone2} editMode={editMode}
            inputProps={{ value: phone2, onChange: e => setPhone2(e.target.value), placeholder: '+234 800 000 0001', type: 'tel' }} />

          <div style={{ gridColumn: isMobile ? undefined : '1 / -1' }}>
            <Row label="Email Address" value={email} editMode={editMode}
              inputProps={{ value: email, onChange: e => setEmail(e.target.value), placeholder: 'yourname@email.com', type: 'email' }} />
          </div>
        </div>

        {saveError && (
          <div style={{ padding: '10px 14px', background: COLORS.dangerLight, borderRadius: '8px', color: COLORS.danger, fontSize: '13px', fontWeight: 600, marginBottom: '10px' }}>
            {saveError}
          </div>
        )}

        {/* Save / Cancel */}
        {editMode && (
          <div style={{ display: 'flex', gap: '10px', marginTop: '8px' }}>
            <button onClick={handleCancel} style={{ padding: '10px 20px', borderRadius: '8px', border: `1.5px solid ${COLORS.border}`, background: '#fff', color: COLORS.text, fontWeight: 600, fontSize: '13.5px', cursor: 'pointer', fontFamily: 'inherit' }}>
              Cancel
            </button>
            <button onClick={handleSave} disabled={saving} style={{ padding: '10px 24px', borderRadius: '8px', border: 'none', background: saving ? COLORS.border : COLORS.primary, color: '#fff', fontWeight: 700, fontSize: '13.5px', cursor: saving ? 'not-allowed' : 'pointer', fontFamily: 'inherit', transition: 'background 0.2s' }}>
              {saving ? 'Saving…' : '💾 Save Changes'}
            </button>
          </div>
        )}

        {/* Change password */}
        <div style={{ marginTop: '20px', paddingTop: '20px', borderTop: `1px solid ${COLORS.border}` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: '14px', color: COLORS.text }}>🔒 Password</div>
              <div style={{ fontSize: '12px', color: COLORS.textMuted, marginTop: '2px' }}>Keep your account safe — change your password regularly</div>
            </div>
            <button
              onClick={() => setShowPwModal(true)}
              style={{ padding: '9px 18px', borderRadius: '8px', border: 'none', background: COLORS.dangerLight, color: COLORS.danger, fontWeight: 700, fontSize: '13px', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}
            >
              Change Password
            </button>
          </div>
        </div>

        {/* Push notifications test */}
        <div style={{ marginTop: '20px', paddingTop: '20px', borderTop: `1px solid ${COLORS.border}` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: '14px', color: COLORS.text }}>🔔 Push Notifications</div>
              <div style={{ fontSize: '12px', color: COLORS.textMuted, marginTop: '2px' }}>Receive alerts for password changes, capital entries and profit payouts</div>
            </div>
            <button
              onClick={sendTestNotification}
              disabled={testNotifState === 'sending'}
              style={{ padding: '9px 18px', borderRadius: '8px', border: 'none', background: testNotifState === 'sending' ? COLORS.border : COLORS.primary, color: '#fff', fontWeight: 700, fontSize: '13px', cursor: testNotifState === 'sending' ? 'not-allowed' : 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap', transition: 'background 0.2s' }}
            >
              {testNotifState === 'sending' ? '⏳ Sending…' : '🧪 Send Test Notification'}
            </button>
          </div>
          {testNotifState === 'ok' && (
            <div style={{ marginTop: '10px', padding: '10px 14px', background: '#f0fdf4', borderRadius: '8px', color: '#15803d', fontSize: '13px', fontWeight: 600 }}>
              ✅ Test notification sent! You should see it appear on your device shortly.
            </div>
          )}
          {testNotifState === 'no_sub' && (
            <div style={{ marginTop: '10px', padding: '10px 14px', background: '#fffbeb', borderRadius: '8px', color: '#92400e', fontSize: '13px', fontWeight: 600 }}>
              ⚠️ This device is not subscribed to push notifications. Make sure you have granted notification permission in your browser settings, then reload the page and try again.
            </div>
          )}
          {testNotifState === 'no_vapid' && (
            <div style={{ marginTop: '10px', padding: '10px 14px', background: '#fffbeb', borderRadius: '8px', color: '#92400e', fontSize: '13px', fontWeight: 600 }}>
              ⚠️ Push notifications are not configured on the server. Set the VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY environment variables in Cloudflare Pages.
            </div>
          )}
          {testNotifState === 'vapid_error' && (
            <div style={{ marginTop: '10px', padding: '10px 14px', background: '#fffbeb', borderRadius: '8px', color: '#92400e', fontSize: '13px', fontWeight: 600 }}>
              ⚠️ VAPID key error — the server could not sign the push request. Check that VAPID_PRIVATE_KEY is set correctly in Cloudflare Pages (it should be a base64url-encoded P-256 private key generated with the Node.js command in wrangler.toml).
            </div>
          )}
          {testNotifState === 'push_rejected' && (
            <div style={{ marginTop: '10px', padding: '10px 14px', background: '#fffbeb', borderRadius: '8px', color: '#92400e', fontSize: '13px', fontWeight: 600 }}>
              ⚠️ The push service rejected the notification. Your subscription may be stale — reload the page and try again. If the problem persists, the VAPID key pair may have changed since you last subscribed.
            </div>
          )}
          {testNotifState === 'error' && (
            <div style={{ marginTop: '10px', padding: '10px 14px', background: COLORS.dangerLight, borderRadius: '8px', color: COLORS.danger, fontSize: '13px', fontWeight: 600 }}>
              ❌ Could not reach the notification service. Check your internet connection and that notification permission is granted, then try again.
            </div>
          )}
        </div>
      </div>

      <ChangePasswordModal open={showPwModal} onClose={() => setShowPwModal(false)} currentUser={currentUser} />
    </>
  );
}
