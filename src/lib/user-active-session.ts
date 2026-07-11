import { FieldValue } from "firebase-admin/firestore";
import { getDb, isCloudArchiveEnabled } from "@/lib/firebase-admin";

const SESSION_ID_RE = /^[0-9a-f-]{36}$/i;

export function isValidSessionId(id: string): boolean {
  return SESSION_ID_RE.test(id);
}

export async function getUserActiveSessionId(
  uid: string,
): Promise<string | null> {
  if (!isCloudArchiveEnabled()) return null;
  const snap = await getDb().collection("users").doc(uid).get();
  if (!snap.exists) return null;
  const raw = snap.data()?.activeSessionId;
  if (typeof raw !== "string" || !isValidSessionId(raw)) return null;
  return raw;
}

export async function setUserActiveSessionId(
  uid: string,
  activeSessionId: string | null,
): Promise<void> {
  if (!isCloudArchiveEnabled()) return;
  const ref = getDb().collection("users").doc(uid);
  if (!activeSessionId) {
    await ref.set(
      {
        activeSessionId: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    return;
  }
  if (!isValidSessionId(activeSessionId)) {
    throw new Error("Invalid session id");
  }
  await ref.set(
    {
      activeSessionId,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}
