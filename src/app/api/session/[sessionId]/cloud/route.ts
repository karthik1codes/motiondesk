import { NextResponse } from "next/server";
import { archiveSessionMeta } from "@/lib/cloud-archive";
import {
  FIREBASE_PROJECT_ID,
  getDb,
  isCloudArchiveEnabled,
} from "@/lib/firebase-admin";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";

/**
 * POST — persist sequence order + session prompts/meta to Firebase (deepmind-2a4e2).
 * Media blobs are uploaded during seed/generate/edit; this only syncs timeline order.
 * Body: { sequence?: Array<string | { key: string; takeIds: string[] }> }
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await ctx.params;
  const session = getSession(sessionId);
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  if (!isCloudArchiveEnabled()) {
    return NextResponse.json(
      {
        error:
          "Cloud archive disabled. Set FIREBASE_ARCHIVE_ENABLED=1 and provide GOOGLE_APPLICATION_CREDENTIALS or FIREBASE_SERVICE_ACCOUNT_JSON for project deepmind-2a4e2.",
      },
      { status: 503 },
    );
  }

  try {
    const body = (await req.json().catch(() => ({}))) as {
      sequence?: unknown[];
    };

    await archiveSessionMeta(session);

    if (Array.isArray(body.sequence)) {
      const db = getDb();
      await db
        .collection("sessions")
        .doc(sessionId)
        .set(
          {
            sequence: body.sequence,
            sequenceUpdatedAt: new Date().toISOString(),
            projectId: FIREBASE_PROJECT_ID,
            updatedAt: new Date().toISOString(),
          },
          { merge: true },
        );
    }

    return NextResponse.json({
      ok: true,
      sessionId,
      projectId: FIREBASE_PROJECT_ID,
      turnCount: session.turns.length,
      sequenceLength: body.sequence?.length ?? null,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Cloud archive failed",
      },
      { status: 500 },
    );
  }
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await ctx.params;
  return NextResponse.json({
    sessionId,
    archiveEnabled: isCloudArchiveEnabled(),
    projectId: process.env.FIREBASE_PROJECT_ID ?? "deepmind-2a4e2",
  });
}
