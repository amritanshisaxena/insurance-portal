const stepLabels = {
  logging_in: 'Logging in',
  awaiting_mfa: 'Awaiting MFA',
  mfa_required: 'MFA Required',
  mfa_submitted: 'MFA Submitted',
  submitting_mfa: 'Submitting MFA',
  fetching_documents: 'Fetching Documents',
  documents_ready: 'Documents Ready',
  completed: 'Complete',
  loading: 'Loading',
};

export default function RunTimeline({ timeline }) {
  if (!timeline || timeline.length === 0) return null;

  const startTime = timeline[0].time;

  return (
    <div style={{
      marginTop: 24, padding: '20px 24px',
      background: 'var(--bg-card)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-md)',
    }}>
      <div style={{
        fontSize: 11, fontWeight: 600, color: 'var(--text-muted)',
        textTransform: 'uppercase', letterSpacing: '1.2px', marginBottom: 16,
      }}>
        Run Timeline
      </div>
      <div style={{ position: 'relative', paddingLeft: 28 }}>
        {timeline.map((entry, i) => {
          const isLast = i === timeline.length - 1;
          const elapsed = ((entry.time - startTime) / 1000).toFixed(1);
          const isComplete = entry.step === 'completed' || entry.step === 'documents_ready';

          return (
            <div key={i} style={{
              display: 'flex', alignItems: 'flex-start',
              paddingBottom: isLast ? 0 : 16,
              position: 'relative',
              animation: 'fadeIn 0.25s ease-out',
            }}>
              {/* Dot */}
              <div style={{
                position: 'absolute', left: -28, top: 2,
                width: 16, height: 16, borderRadius: '50%',
                backgroundColor: isLast && !isComplete ? 'var(--accent)' : 'var(--success)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 9, color: 'white', zIndex: 1,
                boxShadow: isLast && !isComplete
                  ? '0 0 8px var(--accent-glow)'
                  : '0 0 8px var(--success-glow)',
              }}>
                {isLast && !isComplete ? '•' : '✓'}
              </div>
              {/* Connector line */}
              {!isLast && (
                <div style={{
                  position: 'absolute', left: -21, top: 18,
                  width: 2, height: 'calc(100% - 2px)',
                  background: 'var(--border)',
                }} />
              )}
              {/* Content */}
              <div style={{ flex: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
                <div>
                  <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>
                    {stepLabels[entry.step] || entry.step}
                  </span>
                  <span style={{ fontSize: 11, fontFamily: "'JetBrains Mono', monospace", color: 'var(--text-muted)', marginLeft: 10 }}>
                    +{elapsed}s
                  </span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', maxWidth: 280, textAlign: 'right' }}>
                  {entry.message}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
