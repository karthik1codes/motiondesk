import { NextResponse } from "next/server";
import { getSession, summarizeSession } from "@/lib/session";
import { listTakesFromSession } from "@/lib/takes";

export const runtime = "nodejs";

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
