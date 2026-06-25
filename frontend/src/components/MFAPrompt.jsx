import { useState } from 'react';

export default function MFAPrompt({ mfaType, message, onSubmit }) {
  const [code, setCode] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!code.trim()) return;
    onSubmit(code.trim());
  };

  return (
    <div style={{
      maxWidth: 420,
      padding: 28,
      background: 'var(--bg-card)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-md)',
      animation: 'fadeIn 0.3s ease-out',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16,
      }}>
        <div style={{
          width: 36, height: 36, borderRadius: 8,
          background: 'var(--accent-glow)', border: '1px solid var(--border-active)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 16,
        }}>&#x1f510;</div>
        <div>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>Verification Required</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {mfaType === 'sms' ? 'Check your phone' : 'Check your email'}
          </div>
        </div>
      </div>

      <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 20, lineHeight: 1.6 }}>
        {message || `Enter the verification code sent to your ${mfaType === 'sms' ? 'phone' : 'email'}.`}
      </p>

      <form onSubmit={handleSubmit}>
        <input
          type="text"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="000000"
          autoFocus
          maxLength={8}
          style={{
            width: '100%',
            padding: 16,
            fontSize: 28,
            fontFamily: "'JetBrains Mono', monospace",
            textAlign: 'center',
            letterSpacing: 12,
            background: 'var(--bg-secondary)',
            color: 'var(--text-primary)',
            border: '2px solid var(--border)',
            borderRadius: 'var(--radius-md)',
            outline: 'none',
            boxSizing: 'border-box',
            marginBottom: 14,
          }}
        />
        <button
          type="submit"
          disabled={!code.trim()}
          style={{
            width: '100%',
            padding: 12,
            fontSize: 14,
            fontWeight: 600,
            fontFamily: 'inherit',
            background: 'linear-gradient(135deg, #10b981, #059669)',
            color: 'white',
            border: 'none',
            borderRadius: 'var(--radius-sm)',
            cursor: code.trim() ? 'pointer' : 'not-allowed',
            opacity: code.trim() ? 1 : 0.4,
            transition: 'var(--transition)',
          }}
        >
          Submit Code
        </button>
      </form>
    </div>
  );
}
