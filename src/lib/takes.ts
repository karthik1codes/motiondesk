import type { DirectorSession, VideoTurn } from "./types";

/** A saved generate/edit/upload take that can be re-edited or sequenced. */
export type VideoTake = {
  id: string;
  kind: "generate" | "edit" | "upload";
  label: string;
  /** Empty for uploaded local files (Omni edit via Files API upload). */
  interactionId: string;
  createdAt: string;
  latencyMs?: number;
  /** Present when full payload is loaded */
  video?: {
    mimeType: string;
    data: string;
  };
};

export type TakeSummary = Omit<VideoTake, "video"> & {
  hasVideo: boolean;
};

/** Pull video takes from session turns (assistant generate/edit/upload with video). */
export function listTakesFromSession(session: DirectorSession): TakeSummary[] {
  const takes: TakeSummary[] = [];
  for (const turn of session.turns) {
    if (turn.role !== "assistant") continue;
    if (
      turn.kind !== "generate" &&
      turn.kind !== "edit" &&
      turn.kind !== "upload"
    ) {
      continue;
    }
    if (!turn.video) continue;
    // Omni-generated takes need an interaction id; uploads are local files.
    if (turn.kind !== "upload" && !turn.interactionId) continue;
    takes.push({
      id: turn.id,
      kind: turn.kind,
      label: labelForTake(turn, session),
      interactionId: turn.interactionId ?? "",
      createdAt: turn.createdAt,
      latencyMs: turn.latencyMs,
      hasVideo: true,
    });
  }
  return takes;
}

function labelForTake(turn: VideoTurn, session: DirectorSession): string {
  // Prefer the preceding user turn text as the take label.
  const idx = session.turns.findIndex((t) => t.id === turn.id);
  for (let i = idx - 1; i >= 0; i--) {
    const prev = session.turns[i];
    if (
      prev.role === "user" &&
      (prev.kind === "generate" ||
        prev.kind === "edit" ||
        prev.kind === "upload")
    ) {
      const text = prev.text.trim();
      return text.length > 72 ? `${text.slice(0, 72)}…` : text;
    }
  }
  if (turn.kind === "upload") return "Uploaded clip";
  return turn.kind === "generate" ? "Generated take" : "Edited take";
}

export function findTakeVideo(
  session: DirectorSession,
  takeId: string,
): { mimeType: string; data: string } | null {
  const turn = session.turns.find((t) => t.id === takeId);
  return turn?.video ?? null;
}

export const LAST_SESSION_KEY = "motiondesk:lastSessionId";
export const SESSION_HISTORY_KEY = "motiondesk:sessionHistory";
export const SEQUENCE_KEY_PREFIX = "motiondesk:sequence:";

export type SessionHistoryEntry = {
  id: string;
  /** ISO timestamp when this browser last used the session */
  seenAt: string;
};

/**
 * One timeline row. A single take uses one id; a merge groups several takes
 * played back-to-back (Omni cannot stitch videos in one API call).
 */
export type SequenceShot = {
  key: string;
  takeIds: string[];
};

export function sequenceStorageKey(sessionId: string) {
  return `${SEQUENCE_KEY_PREFIX}${sessionId}`;
}

/** Accept legacy string[] or SequenceShot[]. */
export function normalizeSequence(raw: unknown): SequenceShot[] {
  if (!Array.isArray(raw)) return [];
  const out: SequenceShot[] = [];
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];
    if (typeof item === "string" && item) {
      out.push({ key: item, takeIds: [item] });
      continue;
    }
    if (
      item &&
      typeof item === "object" &&
      Array.isArray((item as SequenceShot).takeIds)
    ) {
      const takeIds = (item as SequenceShot).takeIds.filter(
        (id): id is string => typeof id === "string" && id.length > 0,
      );
      if (takeIds.length === 0) continue;
      const key =
        typeof (item as SequenceShot).key === "string" &&
        (item as SequenceShot).key
          ? (item as SequenceShot).key
          : takeIds.length === 1
            ? takeIds[0]
            : `merge-${i}-${takeIds.join("-").slice(0, 24)}`;
      out.push({ key, takeIds });
    }
  }
  return out;
}

export function flattenSequenceTakeIds(sequence: SequenceShot[]): string[] {
  return sequence.flatMap((shot) => shot.takeIds);
}

export function createMergedShot(takeIds: string[]): SequenceShot {
  const ids = [...new Set(takeIds.filter(Boolean))];
  return {
    key: `merge-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    takeIds: ids,
  };
}

export function readSessionHistory(): SessionHistoryEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(SESSION_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SessionHistoryEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Keep newest-first, unique ids (max 12). */
export function rememberSessionInHistory(sessionId: string): SessionHistoryEntry[] {
  const next: SessionHistoryEntry[] = [
    { id: sessionId, seenAt: new Date().toISOString() },
    ...readSessionHistory().filter((e) => e.id !== sessionId),
  ].slice(0, 12);
  window.localStorage.setItem(SESSION_HISTORY_KEY, JSON.stringify(next));
  window.localStorage.setItem(LAST_SESSION_KEY, sessionId);
  return next;
}

export function clearActiveSessionPointer() {
  window.localStorage.removeItem(LAST_SESSION_KEY);
}

/** Drop a dead id from the browser session picker. */
export function forgetSessionFromHistory(sessionId: string): SessionHistoryEntry[] {
  const next = readSessionHistory().filter((e) => e.id !== sessionId);
  window.localStorage.setItem(SESSION_HISTORY_KEY, JSON.stringify(next));
  if (window.localStorage.getItem(LAST_SESSION_KEY) === sessionId) {
    window.localStorage.removeItem(LAST_SESSION_KEY);
  }
  return next;
}
