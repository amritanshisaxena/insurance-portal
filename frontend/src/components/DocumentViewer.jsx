import { useState, useCallback } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

function formatBytes(base64Str) {
  if (!base64Str) return '--';
  const bytes = Math.ceil((base64Str.length * 3) / 4);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function SummaryBar({ carrier, documentCount, flowStartedAt, mfaSubmittedAt, documentsReadyAt, onReset }) {
  const totalSec = flowStartedAt && documentsReadyAt
    ? ((documentsReadyAt - flowStartedAt) / 1000).toFixed(1)
    : null;
  const postMfaSec = mfaSubmittedAt && documentsReadyAt
    ? ((documentsReadyAt - mfaSubmittedAt) / 1000).toFixed(1)
    : null;

  const stats = [
    { label: 'Carrier', value: carrier || 'Unknown' },
    { label: 'Documents', value: documentCount },
    { label: 'Status', value: 'Success', color: 'var(--success)' },
  ];
  if (totalSec) stats.push({ label: 'Total Time', value: `${totalSec}s` });
  if (postMfaSec) stats.push({ label: 'Post-MFA', value: `${postMfaSec}s` });

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '14px 20px',
      background: 'var(--bg-card)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-md)',
      marginBottom: 16,
      animation: 'fadeIn 0.3s ease-out',
    }}>
      <div style={{ display: 'flex', gap: 28, alignItems: 'center', flexWrap: 'wrap' }}>
        {stats.map((s, i) => (
          <div key={i}>
            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 2 }}>
              {s.label}
            </div>
            <div style={{
              fontSize: 14, fontWeight: 600,
              fontFamily: s.label !== 'Carrier' && s.label !== 'Status' ? "'JetBrains Mono', monospace" : 'inherit',
              color: s.color || 'var(--text-primary)',
            }}>
              {s.value}
            </div>
          </div>
        ))}
      </div>
      <button
        onClick={onReset}
        style={{
          padding: '8px 18px',
          fontSize: 13, fontWeight: 500, fontFamily: 'inherit',
          background: 'var(--bg-secondary)',
          color: 'var(--text-secondary)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-sm)',
          cursor: 'pointer',
          transition: 'var(--transition)',
          flexShrink: 0,
        }}
      >
        Start Over
      </button>
    </div>
  );
}

function RunReport({ timing, carrier, documentCount, flowStartedAt, mfaSubmittedAt, documentsReadyAt }) {
  const totalSec = flowStartedAt && documentsReadyAt
    ? ((documentsReadyAt - flowStartedAt) / 1000).toFixed(1) : null;
  const postMfaSec = mfaSubmittedAt && documentsReadyAt
    ? ((documentsReadyAt - mfaSubmittedAt) / 1000).toFixed(1) : null;
  const marks = timing?.marks || {};

  const items = [
    { label: 'Carrier', value: carrier || 'Unknown' },
    totalSec && { label: 'Total Runtime', value: `${totalSec}s` },
    postMfaSec && { label: 'MFA to Documents', value: `${postMfaSec}s` },
    marks.browser_acquired && { label: 'Browser Acquired', value: `${(marks.browser_acquired / 1000).toFixed(1)}s` },
    marks.documents_fetched && { label: 'Documents Fetched At', value: `${(marks.documents_fetched / 1000).toFixed(1)}s` },
    { label: 'Document Count', value: documentCount },
  ].filter(Boolean);

  return (
    <details style={{
      marginTop: 16,
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-md)',
      overflow: 'hidden',
    }}>
      <summary style={{
        padding: '12px 18px',
        fontSize: 12, fontWeight: 600,
        color: 'var(--text-muted)',
        cursor: 'pointer',
        background: 'var(--bg-card)',
        listStyle: 'none',
        display: 'flex', alignItems: 'center', gap: 8,
        userSelect: 'none',
      }}>
        <span style={{ fontSize: 10, transition: 'transform 0.15s' }}>&#9654;</span>
        Technical Run Report
      </summary>
      <div style={{
        padding: '14px 18px',
        background: 'var(--bg-secondary)',
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
        gap: 14,
      }}>
        {items.map((item, i) => (
          <div key={i}>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 3 }}>
              {item.label}
            </div>
            <div style={{ fontSize: 14, fontWeight: 600, fontFamily: "'JetBrains Mono', monospace", color: 'var(--text-primary)' }}>
              {item.value}
            </div>
          </div>
        ))}
      </div>
    </details>
  );
}

export default function DocumentViewer({ documents, onReset, timing, carrier, flowStartedAt, mfaSubmittedAt, documentsReadyAt }) {
  const [activeDoc, setActiveDoc] = useState(0);
  const [numPages, setNumPages] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [scale, setScale] = useState(1.0);

  const onLoadSuccess = useCallback(({ numPages: n }) => {
    setNumPages(n);
    setCurrentPage(1);
  }, []);

  if (!documents || documents.length === 0) {
    return <p style={{ color: 'var(--text-secondary)' }}>No documents found.</p>;
  }

  const currentDoc = documents[activeDoc];
  const pdfData = `data:${currentDoc.mimeType || 'application/pdf'};base64,${currentDoc.data}`;

  const handleDownload = () => {
    const link = document.createElement('a');
    link.href = pdfData;
    link.download = currentDoc.name || 'document.pdf';
    link.click();
  };

  const switchDoc = (i) => {
    setActiveDoc(i);
    setNumPages(null);
    setCurrentPage(1);
    setScale(1.0);
  };

  const baseWidth = documents.length > 1 ? 680 : 780;

  return (
    <div style={{ animation: 'fadeIn 0.3s ease-out' }}>
      <SummaryBar
        carrier={carrier}
        documentCount={documents.length}
        flowStartedAt={flowStartedAt}
        mfaSubmittedAt={mfaSubmittedAt}
        documentsReadyAt={documentsReadyAt}
        onReset={onReset}
      />

      <div style={{ display: 'flex', gap: 16 }}>
        {/* Sidebar */}
        {documents.length > 1 && (
          <div style={{
            width: 220, flexShrink: 0,
            display: 'flex', flexDirection: 'column', gap: 4,
          }}>
            <div style={{
              fontSize: 10, fontWeight: 600, color: 'var(--text-muted)',
              textTransform: 'uppercase', letterSpacing: '1.2px',
              marginBottom: 8, padding: '0 8px',
            }}>
              Documents
            </div>
            {documents.map((doc, i) => (
              <button
                key={i}
                onClick={() => switchDoc(i)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '10px 12px',
                  width: '100%',
                  background: i === activeDoc ? 'var(--accent-glow)' : 'transparent',
                  border: `1px solid ${i === activeDoc ? 'var(--border-active)' : 'transparent'}`,
                  borderRadius: 'var(--radius-sm)',
                  cursor: 'pointer',
                  transition: 'var(--transition)',
                  textAlign: 'left',
                  fontFamily: 'inherit',
                  color: i === activeDoc ? 'var(--text-primary)' : 'var(--text-secondary)',
                }}
              >
                <div style={{
                  width: 30, height: 30, borderRadius: 6, flexShrink: 0,
                  background: i === activeDoc ? 'var(--accent)' : 'var(--bg-secondary)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 10, fontWeight: 700,
                  color: i === activeDoc ? 'white' : 'var(--text-muted)',
                  fontFamily: "'JetBrains Mono', monospace",
                }}>
                  PDF
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{
                    fontSize: 12, fontWeight: i === activeDoc ? 600 : 400,
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>
                    {doc.name || `Document ${i + 1}`}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 1, fontFamily: "'JetBrains Mono', monospace" }}>
                    {formatBytes(doc.data)}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* Viewer */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          {/* Controls bar */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '8px 14px',
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm) var(--radius-sm) 0 0',
            borderBottom: 'none',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage <= 1}
                style={controlBtn(currentPage <= 1)}>&#8592;</button>
              <span style={{ fontSize: 12, color: 'var(--text-secondary)', fontFamily: "'JetBrains Mono', monospace", minWidth: 70, textAlign: 'center' }}>
                {currentPage} / {numPages || '-'}
              </span>
              <button onClick={() => setCurrentPage(p => Math.min(numPages || p, p + 1))} disabled={currentPage >= (numPages || 1)}
                style={controlBtn(currentPage >= (numPages || 1))}>&#8594;</button>
              <div style={{ width: 1, height: 16, background: 'var(--border)', margin: '0 6px' }} />
              <span style={{
                fontSize: 12, color: 'var(--text-secondary)', fontWeight: 500,
                maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {currentDoc.name || `Document ${activeDoc + 1}`}
              </span>
              <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'JetBrains Mono', monospace" }}>
                {formatBytes(currentDoc.data)}
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <button onClick={() => setScale(s => Math.max(0.5, s - 0.15))} style={controlBtn(false)}>&#8722;</button>
              <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'JetBrains Mono', monospace", minWidth: 40, textAlign: 'center' }}>
                {Math.round(scale * 100)}%
              </span>
              <button onClick={() => setScale(s => Math.min(2.0, s + 0.15))} style={controlBtn(false)}>+</button>
              <div style={{ width: 1, height: 16, background: 'var(--border)', margin: '0 4px' }} />
              <button onClick={handleDownload} style={controlBtn(false)} title="Download">&#x2B73;</button>
            </div>
          </div>

          {/* PDF area */}
          <div style={{
            flex: 1,
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: '0 0 var(--radius-sm) var(--radius-sm)',
            maxHeight: 'calc(100vh - 280px)',
            minHeight: 400,
            overflow: 'auto',
          }}>
            <Document
              file={pdfData}
              onLoadSuccess={onLoadSuccess}
              onLoadError={(err) => console.error('PDF load error:', err)}
              loading={
                <div style={{ padding: 40, textAlign: 'center' }}>
                  <div style={{
                    width: 32, height: 32,
                    border: '2px solid var(--border)', borderTopColor: 'var(--accent)',
                    borderRadius: '50%', animation: 'spin 0.8s linear infinite',
                    margin: '0 auto 12px',
                  }} />
                  <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Loading PDF...</span>
                </div>
              }
            >
              {numPages && (
                <Page
                  pageNumber={currentPage}
                  width={baseWidth * scale}
                  renderTextLayer={true}
                  renderAnnotationLayer={true}
                />
              )}
            </Document>
          </div>
        </div>
      </div>

      <RunReport
        timing={timing}
        carrier={carrier}
        documentCount={documents.length}
        flowStartedAt={flowStartedAt}
        mfaSubmittedAt={mfaSubmittedAt}
        documentsReadyAt={documentsReadyAt}
      />

      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        marginTop: 14, padding: '10px 14px',
        fontSize: 12, color: 'var(--text-muted)',
        background: 'rgba(16,185,129,0.04)',
        border: '1px solid rgba(16,185,129,0.08)',
        borderRadius: 'var(--radius-sm)',
      }}>
        <span style={{ fontSize: 13, flexShrink: 0 }}>&#x1f512;</span>
        Documents are held in browser memory only. Close this tab when done.
      </div>
    </div>
  );
}

function controlBtn(isDisabled) {
  return {
    padding: '4px 8px',
    fontSize: 14,
    fontFamily: 'inherit',
    background: 'transparent',
    color: isDisabled ? 'var(--text-muted)' : 'var(--text-secondary)',
    border: '1px solid var(--border)',
    borderRadius: 4,
    cursor: isDisabled ? 'default' : 'pointer',
    opacity: isDisabled ? 0.4 : 1,
    transition: 'var(--transition)',
    lineHeight: 1,
  };
}
