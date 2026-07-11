import { NextResponse } from "next/server";
import { isAuthError, requireSignedIn } from "@/lib/auth-server";
import { deleteTakeFromCloud } from "@/lib/cloud-archive";
import { formatApiError, httpStatusFromError } from "@/lib/errors";
import {
  deleteTakeFromSession,
  getSession,
  summarizeSession,
} from "@/lib/session";
import { findTakeVideo, listTakesFromSession } from "@/lib/takes";

export const runtime = "nodejs";

/** GET — load one take’s video bytes for the editor. */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ sessionId: string; takeId: string }> },
) {
  const auth = await requireSignedIn(req);
  if (isAuthError(auth)) return auth;

  const { sessionId, takeId } = await ctx.params;
  const session = getSession(sessionId);
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const summary = listTakesFromSession(session).find((t) => t.id === takeId);
  const video = findTakeVideo(session, takeId);
  if (!summary || !video) {
    return NextResponse.json({ error: "Take not found" }, { status: 404 });
  }

  return NextResponse.json({
    take: { ...summary, video },
  });
}

/**
 * DELETE — permanently remove a take from local session store + Firebase
 * (Storage blobs under turns/{takeId}/ and Firestore turns/events).
 */
export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ sessionId: string; takeId: string }> },
) {
  try {
    const auth = await requireSignedIn(req);
    if (isAuthError(auth)) return auth;

    const { sessionId, takeId } = await ctx.params;
    const session = getSession(sessionId);
    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const result = deleteTakeFromSession(session, takeId);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 404 });
    }

    let cloudDeleted = false;
    let cloudError: string | null = null;
    try {
      await deleteTakeFromCloud({
        sessionId,
        takeId,
        removedTurnIds: result.removedTurnIds,
      });
      cloudDeleted = true;
    } catch (err) {
      cloudError = err instanceof Error ? err.message : "Cloud delete failed";
      console.error("[delete take] cloud", cloudError);
    }

    return NextResponse.json({
      ok: true,
      sessionId,
      removedTurnIds: result.removedTurnIds,
      cloudDeleted,
      cloudError,
      session: summarizeSession(session),
      takes: listTakesFromSession(session),
    });
  } catch (err) {
    return NextResponse.json(
      { error: formatApiError(err, "Delete failed") },
      { status: httpStatusFromError(err) },
    );
  }
}
