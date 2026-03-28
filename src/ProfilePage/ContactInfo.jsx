import { useState } from 'react';
import { COLORS } from '../theme';
import ChangePasswordModal from './ChangePasswordModal';

const PROFILE_STORE_KEY = (uid) => `cfc_profile_ext_${uid}`;

function readExt(uid) {
  try { return JSON.parse(localStorage.getItem(PROFILE_STORE_KEY(uid)) || '{}'); }
  catch { return {}; }
}

function writeExt(uid, data) {
  localStorage.setItem(PROFILE_STORE_KEY(uid), JSON.stringify(data));
}

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
  const ext = readExt(currentUser.id);
  const [editMode, setEditMode] = useState(false);
  const [phone1, setPhone1] = useState(ext.phone1 || '');
  const [phone2, setPhone2] = useState(ext.phone2 || '');
  const [email, setEmail] = useState(ext.email || '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showPwModal, setShowPwModal] = useState(false);

  // Expose edit trigger from parent (ProfileHeader "Edit Profile" button)
  ContactInfo._openEdit = () => setEditMode(true);

  const handleSave = async () => {
    setSaving(true);
    const update = { phone1, phone2, email };
    writeExt(currentUser.id, update);
    // Optimistically call the API (backend may or may not support these fields)
    try {
      await fetch(`/api/users/${currentUser.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(update),
      });
    } catch { /* backend may not support yet; localStorage saves it client-side */ }
    setSaving(false);
    setSaved(true);
    setEditMode(false);
    setTimeout(() => setSaved(false), 2500);
    if (onSaved) onSaved();
  };

  const handleCancel = () => {
    const ext2 = readExt(currentUser.id);
    setPhone1(ext2.phone1 || '');
    setPhone2(ext2.phone2 || '');
    setEmail(ext2.email || '');
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
      </div>

      <ChangePasswordModal open={showPwModal} onClose={() => setShowPwModal(false)} currentUser={currentUser} />
    </>
  );
}
