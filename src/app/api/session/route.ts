import { NextResponse } from "next/server";
import { createSession, summarizeSession } from "@/lib/session";
import type { AspectRatio } from "@/lib/types";

export const runtime = "nodejs";

/** POST — create a new director session */
export async function POST(req: Request) {
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
