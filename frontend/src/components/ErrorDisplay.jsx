export default function ErrorDisplay({ message, onRetry, screenshot }) {
  return (
    <div style={{
      maxWidth: 600, textAlign: 'center',
      padding: '48px 24px', margin: '0 auto',
      animation: 'fadeIn 0.3s ease-out',
    }}>
      <div style={{
        width: 56, height: 56, borderRadius: '50%',
        background: 'var(--error-glow)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        margin: '0 auto 20px',
        fontSize: 24, color: 'var(--error)',
        border: '2px solid rgba(239,68,68,0.15)',
      }}>!</div>

      <h3 style={{ fontSize: 18, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>
        Something went wrong
      </h3>
      <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 24 }}>
        {message || 'An unexpected error occurred.'}
      </p>

      {screenshot && (
        <div style={{ marginBottom: 24, textAlign: 'left' }}>
          <details style={{
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)',
            overflow: 'hidden',
          }}>
            <summary style={{
              padding: '10px 14px', fontSize: 12,
              color: 'var(--text-muted)', cursor: 'pointer',
              background: 'var(--bg-card)',
            }}>
              Browser screenshot at failure
            </summary>
            <img
              src={`data:image/png;base64,${screenshot}`}
              alt="Browser state at failure"
              style={{ width: '100%', display: 'block' }}
            />
          </details>
        </div>
      )}

      <button
        onClick={onRetry}
        style={{
          padding: '12px 32px',
          fontSize: 14, fontWeight: 600, fontFamily: 'inherit',
          background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
          color: 'white', border: 'none',
          borderRadius: 'var(--radius-sm)',
          cursor: 'pointer',
          transition: 'var(--transition)',
        }}
      >
        Try Again
      </button>
    </div>
  );
}
