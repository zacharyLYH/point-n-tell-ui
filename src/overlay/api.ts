export async function apiRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(typeof body.error === 'string' ? body.error : `Request failed (${response.status})`);
  }
  return body as T;
}
