import { randomUUID } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import type { AspectRatio, DirectorSession, VideoTurn } from "./types";

/**
 * Session store: in-memory cache backed by JSON files so sessions survive
 * local restarts. On Vercel/Lambda the app root is read-only — use /tmp.
 * Disk writes are best-effort; memory remains the source of truth per instance.
 */
const sessions = new Map<string, DirectorSession>();

function dataDir(): string {
  const root =
    process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME
      ? path.join(os.tmpdir(), "motiondesk")
      : path.join(process.cwd(), ".data");
  return path.join(root, "sessions");
}

function ensureDataDir() {
  fs.mkdirSync(dataDir(), { recursive: true });
}

function sessionFilePath(id: string) {
  // Guard against path traversal — ids are UUIDs from createSession.
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    throw new Error("Invalid session id");
  }
  return path.join(dataDir(), `${id}.json`);
}

function persistSession(session: DirectorSession) {
  try {
    ensureDataDir();
    fs.writeFileSync(sessionFilePath(session.id), JSON.stringify(session), "utf8");
  } catch (err) {
    console.warn("[session] disk persist skipped:", err);
  }
}

function loadSessionFromDisk(id: string): DirectorSession | undefined {
  try {
    const file = sessionFilePath(id);
    if (!fs.existsSync(file)) return undefined;
    const raw = fs.readFileSync(file, "utf8");
    const parsed = JSON.parse(raw) as DirectorSession;
    if (!parsed?.id || parsed.id !== id) return undefined;
    sessions.set(id, parsed);
    return parsed;
  } catch {
    return undefined;
  }
}

export function createSession(aspectRatio: AspectRatio = "16:9"): DirectorSession {
  const now = new Date().toISOString();
  const session: DirectorSession = {
    id: randomUUID(),
    createdAt: now,
    updatedAt: now,
    latestInteractionId: null,
    seedImage: null,
    seedPrompt: null,
    motionPrompt: null,
    plannedEdits: [],
    latestVideo: null,
    turns: [],
    aspectRatio,
  };
  sessions.set(session.id, session);
  persistSession(session);
  return session;
}

export function getSession(id: string): DirectorSession | undefined {
  const cached = sessions.get(id);
  if (cached) return cached;
  return loadSessionFromDisk(id);
}

/** Remove a session from memory and disk (cloud delete is separate). */
export function deleteSession(id: string): boolean {
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    throw new Error("Invalid session id");
  }
  sessions.delete(id);
  try {
    const file = sessionFilePath(id);
    if (fs.existsSync(file)) fs.unlinkSync(file);
  } catch (err) {
    console.warn("[session] disk delete skipped:", err);
  }
  return true;
}

export function saveSession(session: DirectorSession): DirectorSession {
  session.updatedAt = new Date().toISOString();
  sessions.set(session.id, session);
  persistSession(session);
  return session;
}

export function appendTurn(
  session: DirectorSession,
  turn: Omit<VideoTurn, "id" | "createdAt">,
): DirectorSession {
  const full: VideoTurn = {
    ...turn,
    id: randomUUID(),
    createdAt: new Date().toISOString(),
  };
  session.turns.push(full);
  return saveSession(session);
}

const DELETABLE_TAKE_KINDS = new Set(["generate", "edit", "upload"] as const);

function isDeletableTakeKind(
  kind: string,
): kind is "generate" | "edit" | "upload" {
  return DELETABLE_TAKE_KINDS.has(kind as "generate" | "edit" | "upload");
}

/**
 * Permanently remove a video take (assistant generate/edit/upload with video)
 * and its preceding user instruction turn when present.
 */
export function deleteTakeFromSession(
  session: DirectorSession,
  takeId: string,
): { ok: true; removedTurnIds: string[] } | { ok: false; error: string } {
  const idx = session.turns.findIndex((t) => t.id === takeId);
  if (idx < 0) {
    return { ok: false, error: "Take not found" };
  }
  const turn = session.turns[idx];
  if (
    turn.role !== "assistant" ||
    !isDeletableTakeKind(turn.kind) ||
    !turn.video
  ) {
    return { ok: false, error: "Not a deletable video take" };
  }

  const removedTurnIds: string[] = [takeId];
  // Drop the paired user prompt when it sits immediately before this take.
  if (idx > 0) {
    const prev = session.turns[idx - 1];
    if (prev.role === "user" && isDeletableTakeKind(prev.kind)) {
      removedTurnIds.unshift(prev.id);
      session.turns.splice(idx - 1, 2);
    } else {
      session.turns.splice(idx, 1);
    }
  } else {
    session.turns.splice(idx, 1);
  }

  // Refresh latest pointers if they referenced the deleted take.
  const remainingTakes = session.turns.filter(
    (t) =>
      t.role === "assistant" && isDeletableTakeKind(t.kind) && t.video,
  );
  const last = remainingTakes[remainingTakes.length - 1];
  if (last?.video) {
    session.latestVideo = {
      mimeType: last.video.mimeType,
      data: last.video.data,
    };
    session.latestInteractionId = last.interactionId ?? null;
  } else {
    session.latestVideo = null;
    session.latestInteractionId = null;
  }

  saveSession(session);
  return { ok: true, removedTurnIds };
}

/** Drop heavy base64 from session payloads returned to the client list views. */
export function summarizeSession(session: DirectorSession) {
  return {
    id: session.id,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    latestInteractionId: session.latestInteractionId,
    aspectRatio: session.aspectRatio,
    hasSeed: Boolean(session.seedImage),
    hasVideo: Boolean(session.latestVideo),
    turnCount: session.turns.length,
    turns: session.turns.map((t) => ({
      id: t.id,
      kind: t.kind,
      role: t.role,
      text: t.text,
      createdAt: t.createdAt,
      interactionId: t.interactionId,
      latencyMs: t.latencyMs,
      error: t.error,
      hasVideo: Boolean(t.video),
      hasImage: Boolean(t.image),
    })),
  };
}
