/**
 * Module bridge so non-React code (authFetch) can read the current ID token.
 * AuthProvider registers the getter on mount.
 */

let tokenGetter: (() => Promise<string | null>) | null = null;

export function setAuthTokenGetter(
  getter: (() => Promise<string | null>) | null,
) {
  tokenGetter = getter;
}

export async function getAuthBearerToken(): Promise<string | null> {
  if (!tokenGetter) return null;
  try {
    return await tokenGetter();
  } catch {
    return null;
  }
}

/** fetch() with Firebase ID token for sign-in-required APIs. */
export async function authFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const token = await getAuthBearerToken();
  const headers = new Headers(init.headers);
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  return fetch(input, { ...init, headers });
}

/**
 * Parse an API response as JSON. When the server returns an HTML error page
 * (uncaught serverless crash, 502, etc.), surface a clear message instead of
 * `Unexpected token '<', "<!DOCTYPE "... is not valid JSON`.
 */
export async function readApiJson<T = Record<string, unknown>>(
  res: Response,
): Promise<T> {
  const text = await res.text();
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error(
      res.ok
        ? "Empty response from server"
        : `Request failed (${res.status})`,
    );
  }
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    const looksHtml = trimmed.startsWith("<!") || trimmed.startsWith("<html");
    throw new Error(
      looksHtml
        ? `Server returned an HTML error page instead of JSON (${res.status}). Check Vercel function logs — often auth/credentials misconfiguration.`
        : `Invalid JSON from server (${res.status}): ${trimmed.slice(0, 160)}`,
    );
  }
}
