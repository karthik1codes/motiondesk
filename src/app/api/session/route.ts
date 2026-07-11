import { NextResponse } from "next/server";
import { isAuthError, requireSignedIn } from "@/lib/auth-server";
import { listCloudSessions } from "@/lib/cloud-archive";
import {
  FIREBASE_PROJECT_ID,
  isCloudArchiveEnabled,
} from "@/lib/firebase-admin";
import { createSession, summarizeSession } from "@/lib/session";
import type { AspectRatio } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

/** GET — list sessions archived in Firebase (for History sidebar). */
export async function GET(req: Request) {
  const auth = await requireSignedIn(req);
  if (isAuthError(auth)) return auth;

  try {
    const archiveEnabled = isCloudArchiveEnabled();
    const sessions = archiveEnabled ? await listCloudSessions(24) : [];
    return NextResponse.json({
      sessions,
      archiveEnabled,
      projectId: FIREBASE_PROJECT_ID,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** POST — create a new director session */
export async function POST(req: Request) {
  const auth = await requireSignedIn(req);
  if (isAuthError(auth)) return auth;

  try {
    const body = (await req.json().catch(() => ({}))) as {
      aspectRatio?: AspectRatio;
    };
    const session = createSession(body.aspectRatio ?? "16:9");
    return NextResponse.json({ session: summarizeSession(session) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
