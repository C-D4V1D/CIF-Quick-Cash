import { useState } from 'react';
import { COLORS } from '../theme';

function passwordStrength(pw) {
  if (!pw) return { score: 0, label: '', color: COLORS.border };
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  if (score <= 1) return { score, label: 'Too weak', color: COLORS.danger };
  if (score === 2) return { score, label: 'Weak', color: COLORS.warning };
  if (score === 3) return { score, label: 'Fair', color: '#f59e0b' };
  if (score === 4) return { score, label: 'Strong', color: '#10b981' };
  return { score, label: 'Very strong', color: COLORS.primary };
}

const API_post = async (endpoint, data) => {
  const res = await fetch(`/api/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(data),
  });
  return res.json().catch(() => ({}));
};

export default function ChangePasswordModal({ open, onClose, currentUser }) {
  const [current, setCurrent] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  if (!open) return null;

  const strength = passwordStrength(newPw);
  const mismatch = confirm && newPw !== confirm;

  const handleClose = () => {
    setCurrent(''); setNewPw(''); setConfirm('');
    setError(''); setSuccess(false); setLoading(false);
    onClose();
  };

  const handleSubmit = async () => {
    setError('');
    if (!current) { setError('Please enter your current password.'); return; }
    if (newPw.length < 6) { setError('New password must be at least 6 characters.'); return; }
    if (newPw !== confirm) { setError('New passwords do not match.'); return; }
    if (strength.score < 2) { setError('Password is too weak. Add uppercase letters, numbers, or symbols.'); return; }
    setLoading(true);
    try {
      const res = await API_post('change-password', {
        userId: currentUser.id,
        currentPassword: current,
        newPassword: newPw,
      });
      if (res?.error) { setError(res.error); }
      else { setSuccess(true); setTimeout(handleClose, 1800); }
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const inputStyle = {
    width: '100%', padding: '10px 12px', borderRadius: '8px',
    border: `1.5px solid ${COLORS.border}`, fontSize: '14px', outline: 'none',
    boxSizing: 'border-box', background: '#fff', fontFamily: 'inherit',
  };

  const labelStyle = {
    fontSize: '12px', fontWeight: 600, color: COLORS.textMuted, marginBottom: '6px',
    display: 'block', textTransform: 'uppercase', letterSpacing: '0.5px',
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
      zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px',
    }}>
      <div style={{
        background: '#fff', borderRadius: '16px', padding: '28px', width: '100%', maxWidth: '420px',
        boxShadow: '0 24px 60px rgba(0,0,0,0.25)', fontFamily: "'DM Sans', sans-serif",
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 800, color: COLORS.primaryDark }}>🔒 Change Password</h3>
          <button onClick={handleClose} style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', color: COLORS.textMuted, lineHeight: 1 }}>✕</button>
        </div>

        {success ? (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <div style={{ fontSize: '48px', marginBottom: '12px' }}>✅</div>
            <div style={{ fontWeight: 700, color: COLORS.primary, fontSize: '16px' }}>Password changed!</div>
            <div style={{ color: COLORS.textMuted, fontSize: '13px', marginTop: '4px' }}>Closing automatically…</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {/* Current password */}
            <div>
              <label style={labelStyle}>Current Password</label>
              <div style={{ position: 'relative' }}>
                <input type={showCurrent ? 'text' : 'password'} value={current} onChange={e => setCurrent(e.target.value)} style={inputStyle} placeholder="Your current password" />
                <button onClick={() => setShowCurrent(v => !v)} style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: COLORS.textMuted, fontSize: '16px' }}>{showCurrent ? '🙈' : '👁'}</button>
              </div>
            </div>

            {/* New password */}
            <div>
              <label style={labelStyle}>New Password</label>
              <div style={{ position: 'relative' }}>
                <input type={showNew ? 'text' : 'password'} value={newPw} onChange={e => setNewPw(e.target.value)} style={inputStyle} placeholder="Choose a strong password" />
                <button onClick={() => setShowNew(v => !v)} style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: COLORS.textMuted, fontSize: '16px' }}>{showNew ? '🙈' : '👁'}</button>
              </div>
              {/* Strength bar */}
              {newPw && (
                <div style={{ marginTop: '8px' }}>
                  <div style={{ display: 'flex', gap: '4px', marginBottom: '4px' }}>
                    {[1, 2, 3, 4, 5].map(i => (
                      <div key={i} style={{
                        flex: 1, height: '4px', borderRadius: '2px',
                        background: i <= strength.score ? strength.color : COLORS.border,
                        transition: 'background 0.2s',
                      }} />
                    ))}
                  </div>
                  <div style={{ fontSize: '12px', fontWeight: 600, color: strength.color }}>{strength.label}</div>
                </div>
              )}
            </div>

            {/* Confirm password */}
            <div>
              <label style={labelStyle}>Confirm New Password</label>
              <div style={{ position: 'relative' }}>
                <input type={showConfirm ? 'text' : 'password'} value={confirm} onChange={e => setConfirm(e.target.value)}
                  style={{ ...inputStyle, borderColor: mismatch ? COLORS.danger : COLORS.border }}
                  placeholder="Repeat the new password" />
                <button onClick={() => setShowConfirm(v => !v)} style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: COLORS.textMuted, fontSize: '16px' }}>{showConfirm ? '🙈' : '👁'}</button>
              </div>
              {mismatch && <div style={{ fontSize: '12px', color: COLORS.danger, marginTop: '4px' }}>Passwords don't match</div>}
            </div>

            {error && (
              <div style={{ padding: '10px 14px', borderRadius: '8px', background: COLORS.dangerLight, color: COLORS.danger, fontSize: '13px', fontWeight: 500 }}>
                ⚠️ {error}
              </div>
            )}

            <div style={{ display: 'flex', gap: '10px', marginTop: '4px' }}>
              <button onClick={handleClose} style={{ flex: 1, padding: '11px', borderRadius: '8px', border: `2px solid ${COLORS.border}`, background: '#fff', color: COLORS.text, fontWeight: 600, fontSize: '14px', cursor: 'pointer', fontFamily: 'inherit' }}>
                Cancel
              </button>
              <button onClick={handleSubmit} disabled={loading} style={{ flex: 2, padding: '11px', borderRadius: '8px', border: 'none', background: loading ? COLORS.border : COLORS.primary, color: '#fff', fontWeight: 700, fontSize: '14px', cursor: loading ? 'not-allowed' : 'pointer', fontFamily: 'inherit', transition: 'background 0.2s' }}>
                {loading ? 'Saving…' : 'Change Password'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
