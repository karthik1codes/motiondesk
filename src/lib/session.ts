import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import type { AspectRatio, DirectorSession, VideoTurn } from "./types";

/**
 * Session store: in-memory cache backed by `.data/sessions/*.json`
 * so director sessions (and generated videos) survive server restarts.
 */
const sessions = new Map<string, DirectorSession>();

const DATA_DIR = path.join(process.cwd(), ".data", "sessions");

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function sessionFilePath(id: string) {
  // Guard against path traversal — ids are UUIDs from createSession.
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    throw new Error("Invalid session id");
  }
  return path.join(DATA_DIR, `${id}.json`);
}

function persistSession(session: DirectorSession) {
  ensureDataDir();
  fs.writeFileSync(sessionFilePath(session.id), JSON.stringify(session), "utf8");
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
