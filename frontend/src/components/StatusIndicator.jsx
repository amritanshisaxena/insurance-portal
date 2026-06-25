export default function StatusIndicator({ message, step }) {
  return (
    <div style={{
      textAlign: 'center', padding: '48px 24px',
      animation: 'fadeIn 0.3s ease-out',
    }}>
      <div style={{
        width: 44, height: 44,
        border: '3px solid var(--border)',
        borderTopColor: 'var(--accent)',
        borderRadius: '50%',
        animation: 'spin 0.8s linear infinite',
        margin: '0 auto 20px',
      }} />
      <p style={{ fontSize: 15, color: 'var(--text-secondary)', fontWeight: 500 }}>
        {message || 'Processing...'}
      </p>
      {step && (
        <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6, fontFamily: "'JetBrains Mono', monospace" }}>
          {step}
        </p>
      )}
    </div>
  );
}
