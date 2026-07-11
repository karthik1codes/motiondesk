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
