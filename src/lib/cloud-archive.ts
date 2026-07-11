import {
  FIREBASE_PROJECT_ID,
  getBucket,
  getDb,
  isCloudArchiveEnabled,
} from "./firebase-admin";
import type { DirectorSession, MediaRef, VideoTurn } from "./types";

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
