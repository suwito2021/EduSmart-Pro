const TOKEN_KEY = 'lentera_auth_token';
const CBT_DEVICE_KEY = 'lentera_cbt_device_id';

export function getStoredToken(): string {
  return localStorage.getItem(TOKEN_KEY) || '';
}

export function setStoredToken(token: string): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export function getCbtDeviceId(): string {
  let id = sessionStorage.getItem(CBT_DEVICE_KEY) || '';
  if (!id) {
    id = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `dev-${Math.random().toString(36).slice(2, 12)}-${Date.now()}`;
    sessionStorage.setItem(CBT_DEVICE_KEY, id);
  }
  return id;
}

export async function apiFetch<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getStoredToken();
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string> | undefined),
  };
  if (options.body && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  if (token && !headers['Authorization']) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const resp = await fetch(path, {
    ...options,
    credentials: 'include',
    headers,
  });

  if (!resp.ok) {
    let errMsg = `Permintaan gagal (${resp.status})`;
    try {
      const data = await resp.json();
      if (data?.error) errMsg = data.error;
    } catch {
      /* ignore */
    }
    const error = new Error(errMsg) as Error & { status?: number };
    error.status = resp.status;
    throw error;
  }

  return resp.json() as Promise<T>;
}

export async function downloadAuthorizedFile(path: string, filename: string): Promise<void> {
  const token = getStoredToken();
  const resp = await fetch(path, {
    credentials: 'include',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!resp.ok) {
    let msg = 'Gagal mengunduh berkas.';
    try {
      const d = await resp.json();
      if (d?.error) msg = d.error;
    } catch { /* ignore */ }
    throw new Error(msg);
  }
  const blob = await resp.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function uploadFileToServer(file: File): Promise<{
  id: string;
  url: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
}> {
  if (file.size > 6 * 1024 * 1024) {
    throw new Error('Ukuran berkas melebihi batas maksimal 6 MB.');
  }
  const dataBase64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Gagal membaca berkas dari perangkat.'));
    reader.readAsDataURL(file);
  });
  return apiFetch('/api/uploads', {
    method: 'POST',
    body: JSON.stringify({
      filename: file.name,
      mimeType: file.type || 'application/octet-stream',
      dataBase64,
    }),
  });
}
