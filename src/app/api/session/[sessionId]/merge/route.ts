import { NextResponse } from "next/server";
import { isAuthError, requireSignedIn } from "@/lib/auth-server";
import { mergeSessionTakes } from "@/lib/server-merge";

export const runtime = "nodejs";
export const maxDuration = 120;

/** POST — merge selected takes with local ffmpeg into one MP4. */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ sessionId: string }> },
) {
  const auth = await requireSignedIn(req);
  if (isAuthError(auth)) return auth;

  const { sessionId } = await ctx.params;
  try {
    const body = (await req.json()) as { takeIds?: string[] };
    const takeIds = Array.isArray(body.takeIds) ? body.takeIds : [];
    if (takeIds.length < 2) {
      return NextResponse.json(
        { error: "Provide at least two takeIds to merge" },
        { status: 400 },
      );
    }

    const result = await mergeSessionTakes({ sessionId, takeIds });
    return NextResponse.json({
      sessionId,
      mimeType: result.mimeType,
      data: result.data,
      bytes: result.bytes,
      takeIds: result.takeIds,
      saved: Boolean(result.outputPath),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Merge failed";
    console.error("[merge]", message);
    const status = message.includes("not found")
      ? 404
      : /ffmpeg|Failed to start/i.test(message)
        ? 503
        : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
