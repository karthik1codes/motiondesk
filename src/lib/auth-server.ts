import { getAuth } from "firebase-admin/auth";
import { NextResponse } from "next/server";
import { getFirebaseApp } from "@/lib/firebase-admin";

export type VerifiedUser = {
  uid: string;
  email?: string;
  name?: string;
};

/**
 * Verify `Authorization: Bearer <Firebase ID token>`.
 * Returns null when missing/invalid.
 * Never throws — Firebase Admin / jwks-rsa failures must stay JSON 401s,
 * not HTML 500 pages that break `res.json()` on the client.
 */
export async function verifyBearerToken(
  request: Request,
): Promise<VerifiedUser | null> {
  const header = request.headers.get("authorization") || "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) return null;

  try {
    const decoded = await getAuth(getFirebaseApp()).verifyIdToken(match[1]);
    return {
      uid: decoded.uid,
      email: decoded.email,
      name: decoded.name,
    };
  } catch (err) {
    console.error(
      "[auth] verifyIdToken failed:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

export function requireUser(user: VerifiedUser | null): VerifiedUser {
  if (!user) {
    const err = new Error("Sign in required") as Error & { status?: number };
    err.status = 401;
    throw err;
  }
  return user;
}

/** 401 when the request has no valid Firebase ID token. */
export async function requireSignedIn(
  request: Request,
): Promise<VerifiedUser | NextResponse> {
  const user = await verifyBearerToken(request);
  if (!user) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }
  return user;
}

export function isAuthError(
  value: VerifiedUser | NextResponse,
): value is NextResponse {
  return value instanceof NextResponse;
}
