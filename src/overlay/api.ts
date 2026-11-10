import { useState } from 'react';

export async function apiRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(typeof body.error === 'string' ? body.error : `Request failed (${response.status})`);
  }
  return body as T;
}

export function sendJson<T>(url: string, body?: unknown, method = 'POST'): Promise<T> {
  return apiRequest<T>(
    url,
    body === undefined
      ? { method }
      : { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
  );
}

export function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const run = async <T,>(action: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    setError(undefined);
    try {
      return await action();
    } catch (reason) {
      setError(errorMessage(reason));
      return undefined;
    } finally {
      setBusy(false);
    }
  };

  return { busy, error, setError, run };
}
