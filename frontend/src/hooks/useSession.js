import { useState, useEffect } from 'react';
import { getToken } from '../services/api';

export default function useSession() {
  const [token, setToken] = useState(null);

  useEffect(() => {
    let cancelled = false;
    getToken().then((t) => {
      if (!cancelled) setToken(t);
    });
    return () => { cancelled = true; };
  }, []);

  return { token };
}
