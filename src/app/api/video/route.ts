import { NextResponse } from "next/server";
import { isAuthError, requireSignedIn } from "@/lib/auth-server";
import { formatApiError, httpStatusFromError } from "@/lib/errors";
import { runGenerate } from "@/lib/orchestrator";
import { summarizeSession } from "@/lib/session";
import type { AspectRatio, MediaRef, VideoTask } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * POST — Omni Flash text/image → video (first turn).
 * Prompt may be omitted if a seed exists; Gemini 3 Flash will draft one.
 */
export async function POST(req: Request) {
  const auth = await requireSignedIn(req);
  if (isAuthError(auth)) return auth;

  try {
    const body = (await req.json()) as {
      prompt?: string;
      aspectRatio?: AspectRatio;
      sessionId?: string;
      images?: MediaRef[];
      styleImage?: MediaRef;
      task?: VideoTask;
    };

    const result = await runGenerate({
      prompt: body.prompt?.trim() ?? "",
      aspectRatio: body.aspectRatio,
      sessionId: body.sessionId,
      images: body.images,
      styleImage: body.styleImage,
      task: body.task,
    });

    return NextResponse.json({
      session: summarizeSession(result.session),
      sessionId: result.session.id,
      video: result.video,
      interactionId: result.interactionId,
      latencyMs: result.latencyMs,
      model: result.model,
      motionPrompt: result.motionPrompt,
      promptModel: result.promptModel,
      task: body.task ?? (body.styleImage ? "reference_to_video" : undefined),
    });
  } catch (err) {
    return NextResponse.json(
      { error: formatApiError(err, "Video generation failed") },
      { status: httpStatusFromError(err) },
    );
  }
}
