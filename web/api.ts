import { useCallback, useEffect, useState } from 'react';

export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export async function api<T>(path: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { method, credentials: 'same-origin', signal, headers: body === undefined ? undefined : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    throw new Error('暫時無法連線，請確認網路後再試。');
  }
  let data: { error?: string };
  try { data = await response.json() as { error?: string }; }
  catch { throw new ApiError('伺服器回應無法讀取，請重新整理後再試。', response.status); }
  if (!response.ok) {
    if (response.status === 401 && !path.endsWith('/login') && !path.endsWith('/me')) {
      // A wrong current password is also a 401; only invalidate the UI when the session is gone.
      if (path.endsWith('/change-password')) {
        const session = await fetch('/api/auth/me', { credentials: 'same-origin', signal }).catch(() => null);
        if (session?.status === 401) window.dispatchEvent(new Event('session-expired'));
      } else window.dispatchEvent(new Event('session-expired'));
    }
    throw new ApiError(data.error || '操作未能完成，請稍後再試。', response.status);
  }
  return data as T;
}

export function useResource<T>(path: string | null) {
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{ data: T | null; error: string; loading: boolean }>({ data: null, error: '', loading: !!path });
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    setState(previous => ({ data: previous.data, error: '', loading: true }));
    api<T>(path, 'GET', undefined, controller.signal).then(data => {
      if (!controller.signal.aborted) setState({ data, error: '', loading: false });
    }).catch((error: Error) => {
      if (!controller.signal.aborted) setState({ data: null, error: error.message, loading: false });
    });
    return () => controller.abort();
  }, [path, revision]);
  return { ...state, refresh };
}

export const errorMessage = (error: unknown) => error instanceof Error ? error.message : '操作未能完成，請重試。';
export const query = (cycleId = '', extra: Record<string, string> = {}) => {
  const params = new URLSearchParams(extra);
  if (cycleId) params.set('cycleId', cycleId);
  return params.size ? `?${params}` : '';
};
export const textField = (data: FormData, name: string) => String(data.get(name) ?? '').trim();
export const pointsFromField = (data: FormData, name: string) => {
  const raw = textField(data, name);
  if (!/^-?\d+(\.\d{1,2})?$/.test(raw)) throw new Error('積分請輸入數字，最多兩位小數。');
  const value = Math.round(Number(raw) * 100);
  if (!Number.isSafeInteger(value)) throw new Error('積分數值過大。');
  return value;
};
export const toTimestamp = (value: string) => {
  if (!value) return null;
  const timestamp = Date.parse(`${value}:00+08:00`);
  if (!Number.isFinite(timestamp)) throw new Error('請輸入有效日期與時間。');
  return timestamp;
};
export const toDateInput = (value: number | null | undefined) => value ? new Date(value + 8 * 3600_000).toISOString().slice(0, 16) : '';
export const formatTime = (value: number | null | undefined, onlyTime = false) => value ? new Intl.DateTimeFormat('zh-Hant', { timeZone: 'Asia/Shanghai', ...(onlyTime ? {} : { year: 'numeric', month: '2-digit', day: '2-digit' }), hour: '2-digit', minute: '2-digit', hour12: false }).format(value) : '尚未設定';
export const score = (value: number) => new Intl.NumberFormat('zh-Hant', { maximumFractionDigits: 2 }).format(value / 100);
