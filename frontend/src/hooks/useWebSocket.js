import { useEffect, useRef, useCallback } from 'react';

export default function useWebSocket(token, dispatch) {
  const wsRef = useRef(null);

  useEffect(() => {
    if (!token) return;

    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${protocol}://${window.location.host}/ws?token=${token}`);

    ws.onopen = () => {
      dispatch({ type: 'WS_CONNECTED' });
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      switch (msg.type) {
        case 'status':
          dispatch({ type: 'STATUS_UPDATE', step: msg.step, message: msg.message });
          break;
        case 'mfa_required':
          dispatch({ type: 'MFA_REQUIRED', mfaType: msg.mfaType, message: msg.message });
          break;
        case 'documents_ready':
          dispatch({ type: 'DOCUMENTS_READY', documentCount: msg.documentCount, sessionId: msg.sessionId, timing: msg.timing, carrier: msg.carrier });
          break;
        case 'error':
          dispatch({ type: 'ERROR', message: msg.message, code: msg.code, screenshot: msg.screenshot });
          break;
        default:
          break;
      }
    };

    ws.onclose = () => {
      dispatch({ type: 'WS_DISCONNECTED' });
    };

    wsRef.current = ws;
    return () => ws.close();
  }, [token, dispatch]);

  const send = useCallback((msg) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  return { send };
}
