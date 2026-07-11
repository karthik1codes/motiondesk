import { NextResponse } from "next/server";
import { hydrateSessionFromCloud } from "@/lib/cloud-archive";
import { isCloudArchiveEnabled } from "@/lib/firebase-admin";
import { getSession, summarizeSession } from "@/lib/session";
import { listTakesFromSession } from "@/lib/takes";

export const runtime = "nodejs";
/** Cloud hydrate may download several video blobs. */
export const maxDuration = 120;

/** GET — resume a director session (same id used by Sequence editor). */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await ctx.params;
  let session;
  try {
    session = getSession(sessionId);
  } catch {
    return NextResponse.json({ error: "Invalid session id" }, { status: 400 });
  }

  // Local miss → pull from Firebase Storage/Firestore when archive is enabled.
  if (!session && isCloudArchiveEnabled()) {
    try {
      session = await hydrateSessionFromCloud(sessionId);
    } catch (err) {
      console.error("[session] cloud hydrate failed", {
        sessionId,
        err: err instanceof Error ? err.message : err,
      });
      return NextResponse.json(
        {
          error: "Failed to restore session from cloud",
          detail: err instanceof Error ? err.message : String(err),
        },
        { status: 502 },
      );
    }
  }

  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const includeMedia =
    new URL(req.url).searchParams.get("includeMedia") === "1";

  return NextResponse.json({
    session: summarizeSession(session),
    sessionId: session.id,
    latestInteractionId: session.latestInteractionId,
    aspectRatio: session.aspectRatio,
    seedPrompt: session.seedPrompt,
    motionPrompt: session.motionPrompt,
    plannedEdits: session.plannedEdits,
    takeCount: listTakesFromSession(session).length,
    hasSeed: Boolean(session.seedImage),
    hasVideo: Boolean(session.latestVideo),
    ...(includeMedia
      ? {
          seedImage: session.seedImage,
          latestVideo: session.latestVideo,
        }
      : {}),
  });
}
