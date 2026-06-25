const API_BASE = '/api';

async function request(path, options = {}) {
  const token = sessionStorage.getItem('jwt_token');
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export async function getToken() {
  const data = await request('/auth/token', { method: 'POST' });
  sessionStorage.setItem('jwt_token', data.token);
  return data.token;
}

export async function getCarriers() {
  return request('/auth/carriers');
}

export async function startFlow(carrier, email, password) {
  return request('/carrier/start', {
    method: 'POST',
    body: JSON.stringify({ carrier, email, password }),
  });
}

export async function getDocuments(sessionId) {
  return request(`/carrier/documents/${sessionId}`);
}
