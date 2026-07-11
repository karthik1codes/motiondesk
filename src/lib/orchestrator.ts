import {
  archiveSessionMetaBackground,
  archiveTurnBackground,
} from "./cloud-archive";
import {
  editUploadedVideo,
  editVideo,
  generateMotionPromptFromSeed,
  generateSeedImage,
  generateVideo,
  GEMINI_FLASH,
  NB2_LITE,
  OMNI_FLASH,
} from "./gemini";
import {
  appendTurn,
  createSession,
  getSession,
  saveSession,
} from "./session";
import type {
  AspectRatio,
  DirectorSession,
  EditVideoRequest,
  GenerateVideoRequest,
  MediaRef,
  SeedImageRequest,
  VideoTurn,
} from "./types";

function lastTurn(session: DirectorSession): VideoTurn {
  const turn = session.turns[session.turns.length - 1];
  if (!turn) throw new Error("Expected a session turn");
  return turn;
}

/**
 * Prompt orchestrator for conversational video.
 * Owns the pipeline: seed (NB2 Lite) → motion prompt (Gemini 3 Flash) →
 * animate (Omni) → edit (Omni, same model).
 * Vertical-agnostic — theme copy lives in lib/theme.ts.
 */
export async function ensureSession(
  sessionId?: string,
  aspectRatio: AspectRatio = "16:9",
): Promise<DirectorSession> {
  if (sessionId) {
    const existing = getSession(sessionId);
    if (existing) return existing;
  }
  return createSession(aspectRatio);
}

export async function runSeed(
  req: SeedImageRequest & { sessionId?: string },
): Promise<{
  session: DirectorSession;
  image: MediaRef;
  motionPrompt: string;
  plannedEdits: string[];
  latencyMs: number;
  model: string;
  promptModel: string;
}> {
  const session = await ensureSession(req.sessionId, req.aspectRatio);
  appendTurn(session, {
    kind: "seed",
    role: "user",
    text: req.prompt,
  });
  const userTurn = lastTurn(session);
  archiveTurnBackground({
    session,
    turn: userTurn,
    event: { type: "seed", prompt: req.prompt },
    referenceImages: req.referenceImage ? [req.referenceImage] : undefined,
  });

  // Seed image + motion/edit plan only need the seed text — run in parallel.
  const [result, motion] = await Promise.all([
    generateSeedImage({
      prompt: req.prompt,
      aspectRatio: req.aspectRatio ?? session.aspectRatio,
      referenceImages: req.referenceImage ? [req.referenceImage] : undefined,
    }),
    generateMotionPromptFromSeed({
      seedPrompt: req.prompt,
    }),
  ]);

  const image: MediaRef = {
    data: result.data,
    mimeType: result.mimeType,
  };
  session.seedImage = image;
  session.seedPrompt = req.prompt;
  session.motionPrompt = motion.prompt;
  session.plannedEdits = motion.plannedEdits;
  if (req.aspectRatio) session.aspectRatio = req.aspectRatio;

  const latencyMs = Math.max(result.latencyMs, motion.latencyMs);

  appendTurn(session, {
    kind: "seed",
    role: "assistant",
    text: `Seed still ready (${NB2_LITE}). Motion + edit plan drafted (${GEMINI_FLASH}).`,
    image,
    latencyMs,
  });
  saveSession(session);
  const assistantTurn = lastTurn(session);
  archiveTurnBackground({
    session,
    turn: assistantTurn,
    event: {
      type: "seed",
      prompt: req.prompt,
      model: NB2_LITE,
      motionPrompt: motion.prompt,
      plannedEdits: motion.plannedEdits,
    },
  });
  archiveSessionMetaBackground(session);

  return {
    session,
    image,
    motionPrompt: motion.prompt,
    plannedEdits: motion.plannedEdits,
    latencyMs,
    model: NB2_LITE,
    promptModel: GEMINI_FLASH,
  };
}

export async function runGenerate(
  req: GenerateVideoRequest,
): Promise<{
  session: DirectorSession;
  video: { mimeType: string; data: string };
  interactionId: string;
  latencyMs: number;
  model: string;
  motionPrompt: string;
  promptModel?: string;
}> {
  const session = await ensureSession(req.sessionId, req.aspectRatio);
  const seedStill =
    req.images?.[0] ?? (session.seedImage ? session.seedImage : undefined);
  const styleStill = req.styleImage;

  let images: MediaRef[] | undefined;
  let task = req.task;
  if (styleStill && seedStill) {
    images = [seedStill, styleStill];
    task = task ?? "reference_to_video";
  } else if (styleStill) {
    images = [styleStill];
    task = task ?? "reference_to_video";
  } else if (req.images?.length) {
    images = req.images;
  } else if (seedStill) {
    images = [seedStill];
  }

  let motionPrompt = req.prompt?.trim() ?? "";
  let promptModel: string | undefined;
  let promptLatency = 0;

  // Prefer client prompt; if empty, derive from stored seed via Gemini 3 Flash.
  if (!motionPrompt) {
    const seedBrief = session.seedPrompt;
    if (!seedBrief) {
      throw new Error(
        "prompt is required (or generate a seed first so Gemini 3 Flash can draft one)",
      );
    }
    const motion = await generateMotionPromptFromSeed({
      seedPrompt: seedBrief,
    });
    motionPrompt = motion.prompt;
    promptModel = motion.model;
    promptLatency = motion.latencyMs;
  }

  if (styleStill && !/style of|reference|IMAGE_REF/i.test(motionPrompt)) {
    motionPrompt = `${motionPrompt} Apply the look, materials, and lighting cues from the style reference image while keeping the seed composition.`;
  }

  session.motionPrompt = motionPrompt;

  appendTurn(session, {
    kind: "generate",
    role: "user",
    text: styleStill
      ? `[style transfer] ${motionPrompt}`
      : motionPrompt,
  });
  archiveTurnBackground({
    session,
    turn: lastTurn(session),
    event: {
      type: "generate",
      prompt: motionPrompt,
      model: promptModel,
    },
    referenceImages: images,
  });

  const result = await generateVideo({
    prompt: motionPrompt,
    images,
    aspectRatio: req.aspectRatio ?? session.aspectRatio,
    task,
  });

  const video = { mimeType: result.mimeType, data: result.data };
  session.latestVideo = video;
  session.latestInteractionId = result.interactionId;
  if (req.aspectRatio) session.aspectRatio = req.aspectRatio;

  appendTurn(session, {
    kind: "generate",
    role: "assistant",
    text: `Video generated (${OMNI_FLASH})`,
    interactionId: result.interactionId,
    video,
    latencyMs: result.latencyMs + promptLatency,
  });
  saveSession(session);
  archiveTurnBackground({
    session,
    turn: lastTurn(session),
    event: {
      type: "generate",
      prompt: motionPrompt,
      model: OMNI_FLASH,
      motionPrompt,
    },
  });
  archiveSessionMetaBackground(session);

  return {
    session,
    video,
    interactionId: result.interactionId,
    latencyMs: result.latencyMs + promptLatency,
    model: OMNI_FLASH,
    motionPrompt,
    promptModel,
  };
}

export async function runEdit(
  req: EditVideoRequest,
): Promise<{
  session: DirectorSession;
  video: { mimeType: string; data: string };
  interactionId: string;
  latencyMs: number;
  model: string;
}> {
  const session = await ensureSession(req.sessionId);
  const previous =
    req.previousInteractionId || session.latestInteractionId;
  if (!previous) {
    throw new Error(
      "No previousInteractionId — generate a video before editing",
    );
  }

  appendTurn(session, {
    kind: "edit",
    role: "user",
    text: req.instruction,
  });
  archiveTurnBackground({
    session,
    turn: lastTurn(session),
    event: {
      type: "edit",
      instruction: req.instruction,
      previousInteractionId: previous,
    },
    referenceImages: req.images,
  });

  const result = await editVideo({
    instruction: req.instruction,
    previousInteractionId: previous,
    images: req.images,
    aspectRatio: session.aspectRatio,
  });

  const video = { mimeType: result.mimeType, data: result.data };
  session.latestVideo = video;
  session.latestInteractionId = result.interactionId;

  appendTurn(session, {
    kind: "edit",
    role: "assistant",
    text: `Edit applied (${OMNI_FLASH})`,
    interactionId: result.interactionId,
    video,
    latencyMs: result.latencyMs,
  });
  saveSession(session);
  archiveTurnBackground({
    session,
    turn: lastTurn(session),
    event: {
      type: "edit",
      instruction: req.instruction,
      previousInteractionId: previous,
      model: OMNI_FLASH,
    },
  });
  archiveSessionMetaBackground(session);

  return {
    session,
    video,
    interactionId: result.interactionId,
    latencyMs: result.latencyMs,
    model: OMNI_FLASH,
  };
}

/**
 * Edit a locally stitched / uploaded MP4 by uploading to Files API, then Omni.
 * Creates a new Omni interaction thread from that footage.
 */
export async function runEditUploaded(opts: {
  sessionId?: string;
  instruction: string;
  video: MediaRef;
}): Promise<{
  session: DirectorSession;
  video: { mimeType: string; data: string };
  interactionId: string;
  latencyMs: number;
  model: string;
}> {
  const session = await ensureSession(opts.sessionId);

  appendTurn(session, {
    kind: "edit",
    role: "user",
    text: `[merged/upload] ${opts.instruction}`,
  });
  archiveTurnBackground({
    session,
    turn: lastTurn(session),
    event: {
      type: "edit",
      instruction: opts.instruction,
    },
  });

  const result = await editUploadedVideo({
    instruction: opts.instruction,
    video: opts.video,
    aspectRatio: session.aspectRatio,
  });

  const video = { mimeType: result.mimeType, data: result.data };
  session.latestVideo = video;
  session.latestInteractionId = result.interactionId;

  appendTurn(session, {
    kind: "edit",
    role: "assistant",
    text: `Uploaded-clip edit applied (${OMNI_FLASH})`,
    interactionId: result.interactionId,
    video,
    latencyMs: result.latencyMs,
  });
  saveSession(session);
  archiveTurnBackground({
    session,
    turn: lastTurn(session),
    event: {
      type: "edit",
      instruction: opts.instruction,
      model: OMNI_FLASH,
    },
  });
  archiveSessionMetaBackground(session);

  return {
    session,
    video,
    interactionId: result.interactionId,
    latencyMs: result.latencyMs,
    model: OMNI_FLASH,
  };
}

/** Attach a user-uploaded MP4/WebM as a session take (for merge / Omni Files edit). */
export async function runUploadTake(opts: {
  sessionId: string;
  video: MediaRef;
  label?: string;
}): Promise<{
  session: DirectorSession;
  takeId: string;
  video: { mimeType: string; data: string };
}> {
  const session = getSession(opts.sessionId);
  if (!session) throw new Error("Session not found");

  const label = (opts.label?.trim() || "Uploaded clip").slice(0, 120);
  const video = {
    mimeType: opts.video.mimeType || "video/mp4",
    data: opts.video.data,
  };

  appendTurn(session, {
    kind: "upload",
    role: "user",
    text: label,
  });
  appendTurn(session, {
    kind: "upload",
    role: "assistant",
    text: label,
    video,
  });
  session.latestVideo = video;
  saveSession(session);

  const takeId = lastTurn(session).id;
  archiveTurnBackground({
    session,
    turn: lastTurn(session),
    event: {
      type: "edit",
      instruction: `upload:${label}`,
    },
  });
  archiveSessionMetaBackground(session);

  return { session, takeId, video };
}
