import { useState, useEffect } from 'react';
import { getToken } from '../services/api';

export default function useSession() {
  const [token, setToken] = useState(() => sessionStorage.getItem('jwt_token'));

  useEffect(() => {
    if (token) return;

    let cancelled = false;
    getToken().then((t) => {
      if (!cancelled) setToken(t);
    });

    return () => {
      cancelled = true;
    };
  }, [token]);

  return { token };
}
