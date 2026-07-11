import { NextResponse } from "next/server";
import { requireUser, verifyBearerToken } from "@/lib/auth-server";
import { isCloudArchiveEnabled } from "@/lib/firebase-admin";
import {
  getUserActiveSessionId,
  isValidSessionId,
  setUserActiveSessionId,
} from "@/lib/user-active-session";

export const runtime = "nodejs";

function unauthorized() {
  return NextResponse.json({ error: "Sign in required" }, { status: 401 });
}

function cloudDisabled() {
  return NextResponse.json(
    { error: "Cloud archive / Auth is not configured on the server" },
    { status: 503 },
  );
}

/** GET — current user's server-side active session id. */
export async function GET(request: Request) {
  try {
    if (!isCloudArchiveEnabled()) return cloudDisabled();
    const user = await verifyBearerToken(request);
    if (!user) return unauthorized();

    const activeSessionId = await getUserActiveSessionId(user.uid);
    return NextResponse.json({
      uid: user.uid,
      activeSessionId,
    });
  } catch (e) {
    return NextResponse.json(
      {
        error:
          e instanceof Error ? e.message : "Failed to read active session",
      },
      { status: 500 },
    );
  }
}

/** PUT — set active session for this user (cross-device resume pointer). */
export async function PUT(request: Request) {
  if (!isCloudArchiveEnabled()) return cloudDisabled();
  try {
    const user = requireUser(await verifyBearerToken(request));
    const body = (await request.json()) as { activeSessionId?: unknown };
    const id =
      typeof body.activeSessionId === "string"
        ? body.activeSessionId.trim()
        : "";
    if (!isValidSessionId(id)) {
      return NextResponse.json(
        { error: "activeSessionId must be a UUID" },
        { status: 400 },
      );
    }
    await setUserActiveSessionId(user.uid, id);
    return NextResponse.json({ uid: user.uid, activeSessionId: id });
  } catch (e) {
    const status = (e as { status?: number }).status;
    if (status === 401) return unauthorized();
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to set active session" },
      { status: 500 },
    );
  }
}

/** DELETE — clear active session pointer (does not delete the session). */
export async function DELETE(request: Request) {
  if (!isCloudArchiveEnabled()) return cloudDisabled();
  try {
    const user = requireUser(await verifyBearerToken(request));
    await setUserActiveSessionId(user.uid, null);
    return NextResponse.json({ uid: user.uid, activeSessionId: null });
  } catch (e) {
    const status = (e as { status?: number }).status;
    if (status === 401) return unauthorized();
    return NextResponse.json(
      {
        error:
          e instanceof Error ? e.message : "Failed to clear active session",
      },
      { status: 500 },
    );
  }
}
