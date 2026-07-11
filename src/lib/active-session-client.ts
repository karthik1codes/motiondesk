"use client";

/** Auth-aware helpers for the server-side active session pointer. */

export async function fetchServerActiveSession(
  getIdToken: () => Promise<string | null>,
): Promise<string | null> {
  const token = await getIdToken();
  if (!token) return null;
  try {
    const res = await fetch("/api/me/active-session", {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (res.status === 401) return null;
    if (!res.ok) return null;
    const data = (await res.json()) as { activeSessionId?: string | null };
    const id = data.activeSessionId;
    return typeof id === "string" && id ? id : null;
  } catch {
    return null;
  }
}

export async function pushServerActiveSession(
  sessionId: string,
  getIdToken: () => Promise<string | null>,
): Promise<void> {
  const token = await getIdToken();
  if (!token) return;
  try {
    await fetch("/api/me/active-session", {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ activeSessionId: sessionId }),
    });
  } catch {
    /* optional — local bind still works */
  }
}

export async function clearServerActiveSession(
  getIdToken: () => Promise<string | null>,
): Promise<void> {
  const token = await getIdToken();
  if (!token) return;
  try {
    await fetch("/api/me/active-session", {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    /* optional */
  }
}
