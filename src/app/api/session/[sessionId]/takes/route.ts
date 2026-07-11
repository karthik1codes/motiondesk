import { NextResponse } from "next/server";
import { formatApiError, httpStatusFromError } from "@/lib/errors";
import { runUploadTake } from "@/lib/orchestrator";
import { getSession } from "@/lib/session";
import { listTakesFromSession } from "@/lib/takes";
import { normalizeBase64 } from "@/lib/gemini";

export const runtime = "nodejs";
export const maxDuration = 120;

/** GET — list video takes for a director session (no base64 payloads). */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await ctx.params;
  const session = getSession(sessionId);
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  return NextResponse.json({
    sessionId: session.id,
    latestInteractionId: session.latestInteractionId,
    aspectRatio: session.aspectRatio,
    takes: listTakesFromSession(session),
  });
}

/**
 * POST — upload a local video file into the session as a take.
 * Body: { video: { mimeType, data }, label? }
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await ctx.params;
  try {
    const body = (await req.json()) as {
      video?: { mimeType?: string; data?: string };
      label?: string;
    };
    if (!body.video?.data?.trim()) {
      return NextResponse.json(
        { error: "video.data (base64) is required" },
        { status: 400 },
      );
    }

    const mimeType = body.video.mimeType || "video/mp4";
    if (!mimeType.startsWith("video/")) {
      return NextResponse.json(
        { error: "Only video/* uploads are supported" },
        { status: 400 },
      );
    }

    const result = await runUploadTake({
      sessionId,
      label: body.label,
      video: {
        mimeType,
        data: normalizeBase64(body.video.data),
      },
    });

    return NextResponse.json({
      sessionId: result.session.id,
      takeId: result.takeId,
      takes: listTakesFromSession(result.session),
      hasVideo: true,
    });
  } catch (err) {
    return NextResponse.json(
      { error: formatApiError(err, "Upload failed") },
      { status: httpStatusFromError(err) },
    );
  }
}
