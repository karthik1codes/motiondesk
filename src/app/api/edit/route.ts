import { NextResponse } from "next/server";
import { isAuthError, requireSignedIn } from "@/lib/auth-server";
import { formatApiError, httpStatusFromError } from "@/lib/errors";
import { runEdit, runEditUploaded } from "@/lib/orchestrator";
import { summarizeSession } from "@/lib/session";
import type { MediaRef } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * POST — Omni Flash edit.
 * - With previousInteractionId: conversational edit of an Omni take.
 * - With video (+ optional sessionId): upload merged/local MP4 via Files API
 *   and start a new Omni edit thread (≤ ~10s input).
 */
export async function POST(req: Request) {
  const auth = await requireSignedIn(req);
  if (isAuthError(auth)) return auth;

  try {
    const body = (await req.json()) as {
      instruction?: string;
      previousInteractionId?: string;
      sessionId?: string;
      images?: MediaRef[];
      /** Base64 merged / local clip for Files API edit */
      video?: MediaRef;
    };

    if (!body.instruction?.trim()) {
      return NextResponse.json(
        { error: "instruction is required" },
        { status: 400 },
      );
    }

    if (body.video?.data) {
      const result = await runEditUploaded({
        instruction: body.instruction.trim(),
        video: {
          mimeType: body.video.mimeType || "video/mp4",
          data: body.video.data,
        },
        sessionId: body.sessionId,
      });

      return NextResponse.json({
        session: summarizeSession(result.session),
        sessionId: result.session.id,
        video: result.video,
        interactionId: result.interactionId,
        latencyMs: result.latencyMs,
        model: result.model,
        mode: "uploaded",
      });
    }

    if (!body.previousInteractionId?.trim()) {
      return NextResponse.json(
        {
          error:
            "previousInteractionId is required (or pass video to edit a merged/uploaded clip)",
        },
        { status: 400 },
      );
    }

    const result = await runEdit({
      instruction: body.instruction.trim(),
      previousInteractionId: body.previousInteractionId.trim(),
      sessionId: body.sessionId,
      images: body.images,
    });

    return NextResponse.json({
      session: summarizeSession(result.session),
      sessionId: result.session.id,
      video: result.video,
      interactionId: result.interactionId,
      latencyMs: result.latencyMs,
      model: result.model,
      mode: "interaction",
    });
  } catch (err) {
    return NextResponse.json(
      { error: formatApiError(err, "Edit failed") },
      { status: httpStatusFromError(err) },
    );
  }
}
