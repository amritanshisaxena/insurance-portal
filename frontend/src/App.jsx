import { useReducer, useCallback, useEffect, useRef } from 'react';
import useSession from './hooks/useSession';
import useWebSocket from './hooks/useWebSocket';
import CarrierSelect from './components/CarrierSelect';
import MFAPrompt from './components/MFAPrompt';
import StatusIndicator from './components/StatusIndicator';
import RunTimeline from './components/RunTimeline';
import DocumentViewer from './components/DocumentViewer';
import ErrorDisplay from './components/ErrorDisplay';
import { startFlow, getDocuments } from './services/api';

const initialState = {
  step: 'idle',
  sessionId: null,
  documents: [],
  error: null,
  errorScreenshot: null,
  statusMessage: '',
  mfaType: 'code',
  mfaMessage: '',
  wsConnected: false,
  timeline: [],
  timing: null,
  carrier: null,
  flowStartedAt: null,
  mfaSubmittedAt: null,
  documentsReadyAt: null,
};

function reducer(state, action) {
  switch (action.type) {
    case 'WS_CONNECTED':
      return { ...state, wsConnected: true };
    case 'WS_DISCONNECTED':
      return { ...state, wsConnected: false };
    case 'FLOW_STARTED':
      return { ...state, step: 'authenticating', sessionId: action.sessionId, error: null, flowStartedAt: Date.now() };
    case 'STATUS_UPDATE':
      if (action.step === 'completed') return state;
      return {
        ...state,
        step: action.step === 'awaiting_mfa' ? 'mfa_required' : 'authenticating',
        statusMessage: action.message,
        timeline: [...state.timeline, { step: action.step, message: action.message, time: Date.now() }],
      };
    case 'MFA_REQUIRED':
      return {
        ...state,
        step: 'mfa_required',
        mfaType: action.mfaType,
        mfaMessage: action.message,
        timeline: [...state.timeline, { step: 'mfa_required', message: action.message, time: Date.now() }],
      };
    case 'MFA_SUBMITTED':
      return {
        ...state,
        step: 'authenticating',
        statusMessage: 'Submitting verification code...',
        mfaSubmittedAt: Date.now(),
        timeline: [...state.timeline, { step: 'mfa_submitted', message: 'Verification code submitted', time: Date.now() }],
      };
    case 'DOCUMENTS_READY':
      return {
        ...state,
        step: 'loading_documents',
        sessionId: action.sessionId || state.sessionId,
        timing: action.timing || null,
        carrier: action.carrier || null,
        documentsReadyAt: Date.now(),
        timeline: [...state.timeline, { step: 'documents_ready', message: `${action.documentCount} document(s) ready`, time: Date.now() }],
      };
    case 'DOCUMENTS_LOADED':
      return {
        ...state,
        step: 'completed',
        documents: action.documents,
        timeline: [...state.timeline, { step: 'completed', message: 'Documents rendered', time: Date.now() }],
      };
    case 'ERROR':
      return { ...state, step: 'error', error: action.message, errorScreenshot: action.screenshot || null };
    case 'RESET':
      return { ...initialState, wsConnected: state.wsConnected };
    default:
      return state;
  }
}

export default function App() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const { token } = useSession();
  const ws = useWebSocket(token, dispatch);
  const loadingRef = useRef(false);

  const handleStart = useCallback(async (carrier, email, password, rememberSession) => {
    try {
      const res = await startFlow(carrier, email, password, rememberSession);
      dispatch({ type: 'FLOW_STARTED', sessionId: res.sessionId });
    } catch (err) {
      dispatch({ type: 'ERROR', message: err.message });
    }
  }, []);

  const handleMFASubmit = useCallback((code) => {
    ws.send({ type: 'mfa_submit', sessionId: state.sessionId, code });
    dispatch({ type: 'MFA_SUBMITTED' });
  }, [ws, state.sessionId]);

  useEffect(() => {
    if (state.step !== 'loading_documents' || loadingRef.current) return;
    loadingRef.current = true;
    getDocuments(state.sessionId)
      .then((res) => dispatch({ type: 'DOCUMENTS_LOADED', documents: res.documents }))
      .catch((err) => dispatch({ type: 'ERROR', message: err.message }))
      .finally(() => { loadingRef.current = false; });
  }, [state.step, state.sessionId]);

  const handleReset = useCallback(() => dispatch({ type: 'RESET' }), []);

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 28px', fontFamily: "'Inter', system-ui, sans-serif" }}>
      <header style={{
        display: 'flex', alignItems: 'center', gap: 14,
        paddingBottom: 20, marginBottom: 28,
        borderBottom: '1px solid var(--border)',
      }}>
        <div style={{
          width: 36, height: 36,
          background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
          borderRadius: 8,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 16, fontWeight: 700, color: 'white',
        }}>IP</div>
        <div>
          <div style={{ fontSize: 17, fontWeight: 600, color: 'var(--text-primary)', letterSpacing: '-0.3px' }}>
            Insurance Document Portal
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Automated carrier document retrieval</div>
        </div>
      </header>

      {!state.wsConnected && state.step === 'idle' && (
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          fontSize: 12, color: 'var(--warning)',
          padding: '6px 14px',
          background: 'rgba(245,158,11,0.08)',
          border: '1px solid rgba(245,158,11,0.15)',
          borderRadius: 20, marginBottom: 16,
        }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor', animation: 'pulse-dot 1.5s infinite' }} />
          Connecting to server...
        </div>
      )}

      {state.step === 'idle' && (
        <CarrierSelect onSubmit={handleStart} disabled={!state.wsConnected || !token} />
      )}

      {state.step === 'authenticating' && (
        <>
          <StatusIndicator message={state.statusMessage} step={state.step} />
          <RunTimeline timeline={state.timeline} />
        </>
      )}

      {state.step === 'mfa_required' && (
        <>
          <MFAPrompt mfaType={state.mfaType} message={state.mfaMessage} onSubmit={handleMFASubmit} />
          <RunTimeline timeline={state.timeline} />
        </>
      )}

      {state.step === 'loading_documents' && (
        <>
          <StatusIndicator message="Loading documents..." step="loading" />
          <RunTimeline timeline={state.timeline} />
        </>
      )}

      {state.step === 'completed' && (
        <DocumentViewer
          documents={state.documents}
          onReset={handleReset}
          timing={state.timing}
          carrier={state.carrier}
          flowStartedAt={state.flowStartedAt}
          mfaSubmittedAt={state.mfaSubmittedAt}
          documentsReadyAt={state.documentsReadyAt}
        />
      )}

      {state.step === 'error' && (
        <ErrorDisplay message={state.error} onRetry={handleReset} screenshot={state.errorScreenshot} />
      )}
    </div>
  );
}
