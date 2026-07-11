import { NextResponse } from "next/server";
import { isAuthError, requireSignedIn } from "@/lib/auth-server";
import { formatApiError, httpStatusFromError } from "@/lib/errors";
import { runSeed } from "@/lib/orchestrator";
import { summarizeSession } from "@/lib/session";
import type { AspectRatio, MediaRef } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 90;

/** POST — NB2 Lite seed still + Gemini 3 Flash motion prompt */
export async function POST(req: Request) {
  const auth = await requireSignedIn(req);
  if (isAuthError(auth)) return auth;

  try {
    const body = (await req.json()) as {
      prompt?: string;
      aspectRatio?: AspectRatio;
      sessionId?: string;
      referenceImage?: MediaRef;
    };

    if (!body.prompt?.trim()) {
      return NextResponse.json(
        { error: "prompt is required" },
        { status: 400 },
      );
    }

    const result = await runSeed({
      prompt: body.prompt.trim(),
      aspectRatio: body.aspectRatio,
      sessionId: body.sessionId,
      referenceImage: body.referenceImage,
    });

    return NextResponse.json({
      session: summarizeSession(result.session),
      sessionId: result.session.id,
      image: result.image,
      motionPrompt: result.motionPrompt,
      plannedEdits: result.plannedEdits,
      latencyMs: result.latencyMs,
      model: result.model,
      promptModel: result.promptModel,
    });
  } catch (err) {
    return NextResponse.json(
      { error: formatApiError(err, "Seed failed") },
      { status: httpStatusFromError(err) },
    );
  }
}
