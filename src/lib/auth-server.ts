import { getAuth } from "firebase-admin/auth";
import { getFirebaseApp, isCloudArchiveEnabled } from "@/lib/firebase-admin";

export type VerifiedUser = {
  uid: string;
  email?: string;
  name?: string;
};

/**
 * Verify `Authorization: Bearer <Firebase ID token>`.
 * Returns null when missing/invalid (caller decides 401 vs anonymous fallback).
 */
export async function verifyBearerToken(
  request: Request,
): Promise<VerifiedUser | null> {
  if (!isCloudArchiveEnabled()) return null;

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
  } catch {
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
