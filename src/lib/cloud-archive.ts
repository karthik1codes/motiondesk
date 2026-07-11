import {
  FIREBASE_PROJECT_ID,
  getBucket,
  getDb,
  isCloudArchiveEnabled,
} from "./firebase-admin";
import { saveSession } from "./session";
import type { AspectRatio, DirectorSession, MediaRef, VideoTurn } from "./types";

export type CloudMediaRef = {
  bucket: string;
  path: string;
  gsUri: string;
  publicUrl?: string;
  mimeType: string;
  bytes: number;
};

function extForMime(mimeType: string): string {
  if (mimeType.includes("png")) return "png";
  if (mimeType.includes("jpeg") || mimeType.includes("jpg")) return "jpg";
  if (mimeType.includes("webp")) return "webp";
  if (mimeType.includes("mp4")) return "mp4";
  if (mimeType.includes("webm")) return "webm";
  return "bin";
}

function normalizeBase64(data: string): string {
  const idx = data.indexOf("base64,");
  if (idx !== -1) return data.slice(idx + "base64,".length);
  return data;
}

async function uploadBase64(opts: {
  sessionId: string;
  relativePath: string;
  mimeType: string;
  data: string;
}): Promise<CloudMediaRef> {
  const buffer = Buffer.from(normalizeBase64(opts.data), "base64");
  const path = `sessions/${opts.sessionId}/${opts.relativePath}`;
  const bucket = getBucket();
  const file = bucket.file(path);

  await file.save(buffer, {
    resumable: false,
    contentType: opts.mimeType,
    metadata: {
      cacheControl: "private, max-age=0",
      metadata: {
        sessionId: opts.sessionId,
        projectId: FIREBASE_PROJECT_ID,
      },
    },
  });

  return {
    bucket: bucket.name,
    path,
    gsUri: `gs://${bucket.name}/${path}`,
    mimeType: opts.mimeType,
    bytes: buffer.length,
  };
}

/** Upsert session-level metadata (prompts, plan, latest interaction). */
export async function archiveSessionMeta(
  session: DirectorSession,
): Promise<void> {
  if (!isCloudArchiveEnabled()) return;

  const db = getDb();
  await db
    .collection("sessions")
    .doc(session.id)
    .set(
      {
        id: session.id,
        projectId: FIREBASE_PROJECT_ID,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        aspectRatio: session.aspectRatio,
        latestInteractionId: session.latestInteractionId,
        seedPrompt: session.seedPrompt,
        motionPrompt: session.motionPrompt,
        plannedEdits: session.plannedEdits,
        turnCount: session.turns.length,
      },
      { merge: true },
    );
}

/**
 * Persist one turn: blobs to Storage, prompt/edit text + media paths to Firestore.
 * Never throws to the caller — cloud failures are logged so local flow continues.
 */
export async function archiveTurn(opts: {
  session: DirectorSession;
  turn: VideoTurn;
  /** Extra context for generate/edit audit */
  event?: {
    type: "seed" | "generate" | "edit";
    prompt?: string;
    instruction?: string;
    previousInteractionId?: string;
    model?: string;
    plannedEdits?: string[];
    motionPrompt?: string;
  };
  referenceImages?: MediaRef[];
}): Promise<void> {
  if (!isCloudArchiveEnabled()) return;

  try {
    const { session, turn } = opts;
    const sessionId = session.id;
    const turnId = turn.id;

    let imageCloud: CloudMediaRef | null = null;
    let videoCloud: CloudMediaRef | null = null;
    const refCloud: CloudMediaRef[] = [];

    if (turn.image?.data) {
      imageCloud = await uploadBase64({
        sessionId,
        relativePath: `turns/${turnId}/image.${extForMime(turn.image.mimeType)}`,
        mimeType: turn.image.mimeType,
        data: turn.image.data,
      });
    }

    if (turn.video?.data) {
      videoCloud = await uploadBase64({
        sessionId,
        relativePath: `turns/${turnId}/video.${extForMime(turn.video.mimeType)}`,
        mimeType: turn.video.mimeType,
        data: turn.video.data,
      });
    }

    if (opts.referenceImages?.length) {
      for (let i = 0; i < opts.referenceImages.length; i++) {
        const img = opts.referenceImages[i];
        refCloud.push(
          await uploadBase64({
            sessionId,
            relativePath: `turns/${turnId}/ref-${i}.${extForMime(img.mimeType)}`,
            mimeType: img.mimeType,
            data: img.data,
          }),
        );
      }
    }

    // Also mirror latest seed / video at stable paths for easy browsing.
    if (turn.kind === "seed" && turn.role === "assistant" && imageCloud) {
      await uploadBase64({
        sessionId,
        relativePath: `latest/seed.${extForMime(imageCloud.mimeType)}`,
        mimeType: imageCloud.mimeType,
        data: turn.image!.data,
      });
    }
    if (
      (turn.kind === "generate" ||
        turn.kind === "edit" ||
        turn.kind === "upload") &&
      turn.role === "assistant" &&
      videoCloud &&
      turn.video
    ) {
      await uploadBase64({
        sessionId,
        relativePath: `latest/video.${extForMime(videoCloud.mimeType)}`,
        mimeType: videoCloud.mimeType,
        data: turn.video.data,
      });
    }

    const db = getDb();
    const sessionRef = db.collection("sessions").doc(sessionId);

    await sessionRef.set(
      {
        id: sessionId,
        projectId: FIREBASE_PROJECT_ID,
        updatedAt: session.updatedAt,
        aspectRatio: session.aspectRatio,
        latestInteractionId: session.latestInteractionId,
        seedPrompt: session.seedPrompt,
        motionPrompt: session.motionPrompt,
        plannedEdits: session.plannedEdits,
        turnCount: session.turns.length,
        createdAt: session.createdAt,
      },
      { merge: true },
    );

    await sessionRef.collection("turns").doc(turnId).set({
      id: turnId,
      kind: turn.kind,
      role: turn.role,
      text: turn.text,
      createdAt: turn.createdAt,
      interactionId: turn.interactionId ?? null,
      latencyMs: turn.latencyMs ?? null,
      error: turn.error ?? null,
      image: imageCloud,
      video: videoCloud,
      references: refCloud,
    });

    if (opts.event) {
      const eventId = `${turnId}-${opts.event.type}-${turn.role}`;
      await sessionRef.collection("events").doc(eventId).set({
        id: eventId,
        turnId,
        createdAt: turn.createdAt,
        type: opts.event.type,
        role: turn.role,
        prompt: opts.event.prompt ?? null,
        instruction: opts.event.instruction ?? null,
        previousInteractionId: opts.event.previousInteractionId ?? null,
        model: opts.event.model ?? null,
        plannedEdits: opts.event.plannedEdits ?? null,
        motionPrompt: opts.event.motionPrompt ?? null,
        text: turn.text,
        interactionId: turn.interactionId ?? null,
        imagePath: imageCloud?.path ?? null,
        videoPath: videoCloud?.path ?? null,
        referencePaths: refCloud.map((r) => r.path),
      });
    }
  } catch (err) {
    console.error("[cloud-archive] failed to archive turn", {
      sessionId: opts.session.id,
      turnId: opts.turn.id,
      err: err instanceof Error ? err.message : err,
    });
  }
}

/** Fire-and-forget wrapper so API latency is not blocked by Storage. */
export function archiveTurnBackground(
  opts: Parameters<typeof archiveTurn>[0],
): void {
  void archiveTurn(opts);
}

export function archiveSessionMetaBackground(session: DirectorSession): void {
  void archiveSessionMeta(session).catch((err) => {
    console.error("[cloud-archive] failed to archive session meta", {
      sessionId: session.id,
      err: err instanceof Error ? err.message : err,
    });
  });
}

/**
 * Permanently delete a take’s Storage blobs + Firestore turn/events.
 * Best-effort — local delete should not fail if cloud is down.
 */
export async function deleteTakeFromCloud(opts: {
  sessionId: string;
  takeId: string;
  removedTurnIds?: string[];
}): Promise<void> {
  if (!isCloudArchiveEnabled()) return;

  const { sessionId, takeId } = opts;
  const turnIds = opts.removedTurnIds?.length
    ? opts.removedTurnIds
    : [takeId];

  try {
    const bucket = getBucket();
    // Delete all objects under sessions/{id}/turns/{takeId}/
    const [files] = await bucket.getFiles({
      prefix: `sessions/${sessionId}/turns/${takeId}/`,
    });
    await Promise.all(files.map((f) => f.delete({ ignoreNotFound: true })));

    const db = getDb();
    const sessionRef = db.collection("sessions").doc(sessionId);

    for (const id of turnIds) {
      await sessionRef.collection("turns").doc(id).delete();
      // Events are keyed like `${turnId}-${type}-${role}`
      const events = await sessionRef
        .collection("events")
        .where("turnId", "==", id)
        .get();
      await Promise.all(events.docs.map((d) => d.ref.delete()));
    }

    await sessionRef.set(
      {
        updatedAt: new Date().toISOString(),
        projectId: FIREBASE_PROJECT_ID,
      },
      { merge: true },
    );
  } catch (err) {
    console.error("[cloud-archive] failed to delete take", {
      sessionId,
      takeId,
      err: err instanceof Error ? err.message : err,
    });
    throw err;
  }
}

export type CloudSessionSummary = {
  id: string;
  createdAt: string;
  updatedAt: string;
  turnCount: number;
  aspectRatio: AspectRatio | null;
  seedPrompt: string | null;
  motionPrompt: string | null;
  latestInteractionId: string | null;
  source: "cloud";
};

type CloudMediaDoc = {
  path?: string;
  mimeType?: string;
  gsUri?: string;
};

async function downloadStorageToMedia(
  objectPath: string,
  fallbackMime?: string,
): Promise<{ mimeType: string; data: string } | null> {
  try {
    const file = getBucket().file(objectPath);
    const [exists] = await file.exists();
    if (!exists) return null;
    const [buf] = await file.download();
    const [meta] = await file.getMetadata();
    const mimeType =
      (typeof meta.contentType === "string" && meta.contentType) ||
      fallbackMime ||
      "application/octet-stream";
    return { mimeType, data: buf.toString("base64") };
  } catch (err) {
    console.error("[cloud-archive] download failed", {
      objectPath,
      err: err instanceof Error ? err.message : err,
    });
    return null;
  }
}

/** List archived sessions from Firestore (newest first). */
export async function listCloudSessions(
  limit = 24,
): Promise<CloudSessionSummary[]> {
  if (!isCloudArchiveEnabled()) return [];

  const db = getDb();
  let snap;
  try {
    snap = await db
      .collection("sessions")
      .orderBy("updatedAt", "desc")
      .limit(limit)
      .get();
  } catch {
    // Fallback if updatedAt index/query fails — unsorted scan.
    snap = await db.collection("sessions").limit(limit).get();
  }

  const rows: CloudSessionSummary[] = snap.docs.map((doc) => {
    const d = doc.data() as Record<string, unknown>;
    const aspect =
      d.aspectRatio === "16:9" || d.aspectRatio === "9:16"
        ? (d.aspectRatio as AspectRatio)
        : null;
    return {
      id: String(d.id ?? doc.id),
      createdAt: String(d.createdAt ?? ""),
      updatedAt: String(d.updatedAt ?? d.createdAt ?? ""),
      turnCount: typeof d.turnCount === "number" ? d.turnCount : 0,
      aspectRatio: aspect,
      seedPrompt: typeof d.seedPrompt === "string" ? d.seedPrompt : null,
      motionPrompt: typeof d.motionPrompt === "string" ? d.motionPrompt : null,
      latestInteractionId:
        typeof d.latestInteractionId === "string"
          ? d.latestInteractionId
          : null,
      source: "cloud" as const,
    };
  });

  rows.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  return rows;
}

/**
 * Rebuild a local DirectorSession from Firestore + Storage.
 * Returns null if the cloud doc is missing or archive is disabled.
 */
export async function hydrateSessionFromCloud(
  sessionId: string,
): Promise<DirectorSession | null> {
  if (!isCloudArchiveEnabled()) return null;
  if (!/^[0-9a-f-]{36}$/i.test(sessionId)) return null;

  const db = getDb();
  const sessionRef = db.collection("sessions").doc(sessionId);
  const doc = await sessionRef.get();
  if (!doc.exists) return null;

  const meta = doc.data() as Record<string, unknown>;
  const turnsSnap = await sessionRef
    .collection("turns")
    .orderBy("createdAt", "asc")
    .get();

  const turns: VideoTurn[] = [];
  for (const turnDoc of turnsSnap.docs) {
    const d = turnDoc.data() as Record<string, unknown>;
    const kind = String(d.kind ?? "generate") as VideoTurn["kind"];
    const role = String(d.role ?? "assistant") as VideoTurn["role"];
    const turn: VideoTurn = {
      id: String(d.id ?? turnDoc.id),
      kind,
      role,
      text: String(d.text ?? ""),
      createdAt: String(d.createdAt ?? new Date().toISOString()),
      interactionId:
        typeof d.interactionId === "string" ? d.interactionId : undefined,
      latencyMs: typeof d.latencyMs === "number" ? d.latencyMs : undefined,
      error: typeof d.error === "string" ? d.error : undefined,
    };

    const image = d.image as CloudMediaDoc | null | undefined;
    if (image?.path) {
      const media = await downloadStorageToMedia(image.path, image.mimeType);
      if (media) turn.image = media;
    }

    const video = d.video as CloudMediaDoc | null | undefined;
    if (video?.path) {
      const media = await downloadStorageToMedia(video.path, video.mimeType);
      if (media) turn.video = media;
    }

    turns.push(turn);
  }

  const seedTurn = [...turns]
    .reverse()
    .find((t) => t.role === "assistant" && t.kind === "seed" && t.image);
  const videoTurn = [...turns]
    .reverse()
    .find(
      (t) =>
        t.role === "assistant" &&
        (t.kind === "generate" || t.kind === "edit" || t.kind === "upload") &&
        t.video,
    );

  const aspectRatio: AspectRatio =
    meta.aspectRatio === "9:16" ? "9:16" : "16:9";

  const session: DirectorSession = {
    id: sessionId,
    createdAt: String(meta.createdAt ?? new Date().toISOString()),
    updatedAt: String(meta.updatedAt ?? new Date().toISOString()),
    latestInteractionId:
      typeof meta.latestInteractionId === "string"
        ? meta.latestInteractionId
        : (videoTurn?.interactionId ?? null),
    seedImage: seedTurn?.image ?? null,
    seedPrompt: typeof meta.seedPrompt === "string" ? meta.seedPrompt : null,
    motionPrompt:
      typeof meta.motionPrompt === "string" ? meta.motionPrompt : null,
    plannedEdits: Array.isArray(meta.plannedEdits)
      ? meta.plannedEdits.map((e) => String(e))
      : [],
    latestVideo: videoTurn?.video
      ? { mimeType: videoTurn.video.mimeType, data: videoTurn.video.data }
      : null,
    turns,
    aspectRatio,
  };

  saveSession(session);
  return session;
}

