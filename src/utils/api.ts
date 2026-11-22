const FALLBACK_SESSION_KEY = 'ganesha_iframe_session';
let inMemoryFallbackToken: string | null = null;

export function getSessionFallbackToken(): string | null {
  if (inMemoryFallbackToken) return inMemoryFallbackToken;
  if (typeof window === 'undefined') return null;
  try {
    const stored = window.sessionStorage.getItem(FALLBACK_SESSION_KEY);
    if (stored) inMemoryFallbackToken = stored;
    return stored;
  } catch {
    return null;
  }
}

export function setSessionFallbackToken(token: string | null): void {
  inMemoryFallbackToken = token || null;
  if (typeof window === 'undefined') return;
  try {
    if (token) {
      window.sessionStorage.setItem(FALLBACK_SESSION_KEY, token);
    } else {
      window.sessionStorage.removeItem(FALLBACK_SESSION_KEY);
    }
  } catch {
    // ignore storage errors in restricted iframes; inMemoryFallbackToken remains active
  }
}

export function getAuthHeaders(): Record<string, string> {
  const token = getSessionFallbackToken();
  return token ? { 'X-Ganesha-Session': token } : {};
}

export async function parseJsonResponse<T>(res: Response, fallbackError = 'Permintaan gagal'): Promise<T> {
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  if (!res.ok) {
    if (res.status === 413) {
      throw new Error('Ukuran file melebihi batas upload server (maksimal 30 MB per upload).');
    }
    if (res.status === 502 || res.status === 503 || res.status === 504) {
      throw new Error(`Server sedang memulai ulang atau timeout (${res.status}). Silakan coba lagi.`);
    }
    const errMsg =
      data && typeof data === 'object' && 'error' in data
        ? String((data as { error: unknown }).error)
        : `${fallbackError} (${res.status}).`;
    if (res.status === 401 && typeof window !== 'undefined') {
      setSessionFallbackToken(null);
      window.dispatchEvent(new CustomEvent('ganesha:unauthorized', { detail: { message: errMsg } }));
    }
    throw new Error(errMsg);
  }

  if (data === null && text.trim().startsWith('<')) {
    throw new Error('Server mengembalikan halaman HTML alih-alih data JSON. Pastikan ukuran file tidak melebihi 30 MB dan coba muat ulang.');
  }

  return data as T;
}

export async function apiFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const method = (options?.method || 'GET').toUpperCase();
  const maxAttempts = method === 'GET' ? 3 : 1;

  let res: Response | null = null;
  let lastNetworkErr: unknown = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      res = await fetch(url, {
        credentials: 'include',
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
          ...(options?.headers || {}),
        },
      });
      lastNetworkErr = null;
      break;
    } catch (err) {
      lastNetworkErr = err;
      if (attempt < maxAttempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
      }
    }
  }

  if (!res) {
    throw new Error(
      lastNetworkErr instanceof Error && lastNetworkErr.message !== 'Failed to fetch'
        ? lastNetworkErr.message
        : 'Koneksi ke server terputus sementara. Silakan coba lagi.'
    );
  }

  return parseJsonResponse<T>(res, 'Permintaan gagal');
}
