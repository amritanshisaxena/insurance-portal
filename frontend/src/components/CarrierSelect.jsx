import { useState } from 'react';

const CARRIERS = [
  { id: 'lemonade', displayName: 'Lemonade', type: 'Home Insurance', requiresPassword: false },
  { id: 'aaa', displayName: 'AAA Insurance', type: 'Auto Insurance', requiresPassword: true },
];

export default function CarrierSelect({ onSubmit, disabled }) {
  const [carrier, setCarrier] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const selected = CARRIERS.find((c) => c.id === carrier);
  const needsPassword = selected?.requiresPassword ?? false;

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!carrier || !email) return;
    if (needsPassword && !password) return;
    onSubmit(carrier, email, password || undefined);
  };

  const cardStyle = (id) => ({
    padding: '16px 20px',
    background: carrier === id ? 'var(--accent-glow)' : 'var(--bg-secondary)',
    border: `2px solid ${carrier === id ? 'var(--accent)' : 'var(--border)'}`,
    borderRadius: 'var(--radius-md)',
    cursor: 'pointer',
    transition: 'var(--transition)',
    textAlign: 'left',
  });

  const inputStyle = {
    width: '100%',
    padding: '12px 16px',
    fontSize: 14,
    fontFamily: 'inherit',
    background: 'var(--bg-secondary)',
    color: 'var(--text-primary)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-sm)',
    outline: 'none',
    boxSizing: 'border-box',
  };

  return (
    <form onSubmit={handleSubmit} style={{ maxWidth: 460, animation: 'fadeIn 0.3s ease-out' }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 14 }}>
        Select Carrier
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 24 }}>
        {CARRIERS.map((c) => (
          <div key={c.id} style={cardStyle(c.id)} onClick={() => setCarrier(c.id)}>
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 3 }}>
              {c.displayName}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{c.type}</div>
          </div>
        ))}
      </div>

      {carrier && (
        <div style={{ animation: 'fadeIn 0.2s ease-out' }}>
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 8 }}>
              Email Address
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="your@email.com"
              required
              disabled={disabled}
              style={inputStyle}
            />
          </div>

          {needsPassword && (
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 8 }}>
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                required
                disabled={disabled}
                style={inputStyle}
              />
            </div>
          )}

          <button
            type="submit"
            disabled={disabled || !email || (needsPassword && !password)}
            style={{
              width: '100%',
              padding: '12px 24px',
              fontSize: 14,
              fontWeight: 600,
              fontFamily: 'inherit',
              background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
              color: 'white',
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              cursor: disabled ? 'not-allowed' : 'pointer',
              opacity: (disabled || !email || (needsPassword && !password)) ? 0.4 : 1,
              transition: 'var(--transition)',
              letterSpacing: '0.2px',
            }}
          >
            {disabled ? 'Processing...' : 'Log In & Fetch Documents'}
          </button>

          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            marginTop: 16, padding: '10px 14px',
            fontSize: 12, color: 'var(--text-muted)',
            background: 'rgba(16,185,129,0.04)',
            border: '1px solid rgba(16,185,129,0.08)',
            borderRadius: 'var(--radius-sm)',
          }}>
            <span style={{ fontSize: 13, flexShrink: 0 }}>&#x1f512;</span>
            Credentials are used only for this session and never stored.
          </div>
        </div>
      )}
    </form>
  );
}
