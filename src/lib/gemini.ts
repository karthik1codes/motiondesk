import { GoogleGenAI } from "@google/genai";
import { sanitizeOmniPrompt } from "./prompt-guard";
import { productTheme } from "./theme";
import type { AspectRatio, MediaRef } from "./types";

export const NB2_LITE =
  process.env.NB2_LITE_MODEL ?? "gemini-3.1-flash-lite-image";

/** Gemini 3 Flash — writes Omni motion prompts from the seed still brief. */
export const GEMINI_FLASH =
  process.env.GEMINI_FLASH_MODEL ?? "gemini-3.5-flash";

export const OMNI_FLASH =
  process.env.OMNI_FLASH_MODEL ?? "gemini-omni-flash-preview";

/** Shorter clips generate faster (Omni docs: longer videos take more time). */
export const OMNI_DURATION = process.env.OMNI_VIDEO_DURATION ?? "5s";

function requireApiKey(): string {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    throw new Error("GEMINI_API_KEY is not set");
  }
  return key;
}

export function getAiClient() {
  return new GoogleGenAI({ apiKey: requireApiKey() });
}

/** Strip data-URL prefix if the client sent one. */
export function normalizeBase64(data: string): string {
  const idx = data.indexOf("base64,");
  if (idx !== -1) return data.slice(idx + "base64,".length);
  return data;
}

/**
 * Omni edit prompts work best when short; append consistency cue from the docs.
 * Also rewrite extension / "continue the clip" phrasing Omni rejects.
 */
export function normalizeEditInstruction(instruction: string): string {
  const { prompt } = sanitizeOmniPrompt(instruction.trim(), "edit");
  if (/keep everything else the same/i.test(prompt)) return prompt;
  return `${prompt} Keep everything else the same.`;
}

/** Motion / generate prompts — strip extension language Omni classifies as unsupported. */
export function normalizeGeneratePrompt(prompt: string): string {
  return sanitizeOmniPrompt(prompt.trim(), "generate").prompt;
}

type InlinePart = { text: string } | { inlineData: { mimeType: string; data: string } };

/**
 * NB2 Lite — ultra-fast seed / keyframe stills.
 */
export async function generateSeedImage(opts: {
  prompt: string;
  aspectRatio?: AspectRatio;
  referenceImages?: MediaRef[];
}): Promise<{ data: string; mimeType: string; latencyMs: number }> {
  const ai = getAiClient();
  const parts: InlinePart[] = [];

  for (const img of opts.referenceImages ?? []) {
    parts.push({
      inlineData: {
        mimeType: img.mimeType,
        data: normalizeBase64(img.data),
      },
    });
  }
  parts.push({ text: opts.prompt });

  const started = Date.now();
  const response = await ai.models.generateContent({
    model: NB2_LITE,
    contents: [{ role: "user", parts }],
    config: {
      responseModalities: ["TEXT", "IMAGE"],
      imageConfig: {
        aspectRatio: opts.aspectRatio === "9:16" ? "9:16" : "16:9",
        imageSize: "1K",
      },
    },
  });

  const imagePart = response.candidates?.[0]?.content?.parts?.find(
    (p) => p.inlineData?.data,
  );
  if (!imagePart?.inlineData?.data) {
    throw new Error("NB2 Lite returned no image");
  }

  return {
    data: imagePart.inlineData.data,
    mimeType: imagePart.inlineData.mimeType ?? "image/png",
    latencyMs: Date.now() - started,
  };
}

/**
 * Gemini 3 Flash — turn a seed still prompt into:
 * 1) an Omni Flash motion prompt
 * 2) four planned conversational edits that only touch elements
 *    already present in the seed + motion plan
 * Follows https://ai.google.dev/gemini-api/docs/omni prompt guidance.
 */
export async function generateMotionPromptFromSeed(opts: {
  seedPrompt: string;
}): Promise<{
  prompt: string;
  plannedEdits: string[];
  latencyMs: number;
  model: string;
}> {
  const ai = getAiClient();
  const started = Date.now();

  const response = await ai.models.generateContent({
    model: GEMINI_FLASH,
    contents: [
      {
        role: "user",
        parts: [
          {
            text: [
              "You are a tutor planning an Omni Flash image-to-video ASL lesson shot.",
              "From the seed still prompt, produce a JSON object only (no markdown):",
              '{',
              '  "motionPrompt": "string",',
              '  "plannedEdits": ["string", "string", "string", "string", "string", "string"]',
              "}",
              "",
              "motionPrompt rules (Omni Flash):",
              "- 2–4 sentences for image-to-video.",
              "- Single continuous unbroken shot (no scene cuts).",
              "- Specific camera move, subject motion, lighting, mood.",
              "- Preserve subject/materials/setting from the seed.",
              "- No new people/faces if the seed has none.",
              "- Negatives when useful: No people. No dialogue. No on-screen text.",
              `- Target about ${OMNI_DURATION} of motion.`,
              "- NEVER ask to extend, lengthen, continue, or append to a video (Omni does not support extension).",
              "",
              "plannedEdits rules (exactly 6 short Omni conversational-edit chips):",
              "- This product is an ASL tutor: prefer same-clip sign swaps and clarity polish.",
              "- Include at least 4 ASL sign swaps like: Have her sign ASL \"X\" in this same clip",
              "- Include 1–2 polish chips (handshape clarity, slower signing, smile, framing).",
              "- Each edit must change ONE thing already in the seed or motionPrompt.",
              "- Keep each chip under 18 words. Simple Omni style (no long scene rewrites).",
              "- Do not invent props, people, or locations that are not in the plan.",
              "- Never suggest extending/lengthening the clip.",
              `Seed still prompt:\n${opts.seedPrompt.trim()}`,
            ].join("\n"),
          },
        ],
      },
    ],
    config: {
      responseMimeType: "application/json",
    },
  });

  const parsed = parseMotionPlan(response.text ?? "");
  if (!parsed.prompt) {
    throw new Error("Gemini 3 Flash returned an empty motion prompt");
  }

  const motion = normalizeGeneratePrompt(parsed.prompt);
  const plannedEdits = parsed.plannedEdits.map(
    (chip) => sanitizeOmniPrompt(chip, "edit").prompt,
  );

  return {
    prompt: motion,
    plannedEdits,
    latencyMs: Date.now() - started,
    model: GEMINI_FLASH,
  };
}

/** Used only if Flash returns a malformed plan. */
const productThemeFallbackEdits = [...productTheme.exampleEdits].slice(0, 8);

function parseMotionPlan(raw: string): {
  prompt: string;
  plannedEdits: string[];
} {
  const fallbackEdits = [...productThemeFallbackEdits];
  const cleaned = raw.trim().replace(/^```json\s*|\s*```$/g, "");
  try {
    const jsonStart = cleaned.indexOf("{");
    const jsonEnd = cleaned.lastIndexOf("}");
    if (jsonStart === -1 || jsonEnd === -1) {
      return { prompt: cleaned.replace(/^["']|["']$/g, ""), plannedEdits: fallbackEdits };
    }
    const data = JSON.parse(cleaned.slice(jsonStart, jsonEnd + 1)) as {
      motionPrompt?: string;
      plannedEdits?: unknown;
    };
    const prompt = String(data.motionPrompt ?? "").trim();
    const edits = Array.isArray(data.plannedEdits)
      ? data.plannedEdits
          .map((e) => String(e).trim())
          .filter(Boolean)
          .slice(0, 8)
      : [];
    return {
      prompt,
      plannedEdits: edits.length >= 4 ? edits : fallbackEdits,
    };
  } catch {
    return {
      prompt: cleaned.replace(/^["']|["']$/g, ""),
      plannedEdits: fallbackEdits,
    };
  }
}

type OmniInputItem =
  | string
  | { type: "text"; text: string }
  | { type: "image"; data: string; mime_type: string }
  | { type: "video"; uri: string; mime_type?: string }
  | { type: "document"; uri: string; mime_type?: string };

/** How uploaded stills bind into Omni prompts (docs image-role tags). */
export type OmniImageRole = "first_frame" | "reference" | "mixed";

/**
 * Bind stills with Omni tags:
 * https://ai.google.dev/gemini-api/docs/omni#using-tags-in-prompts-to-set-image-roles
 * - first_frame: seed as starting frame (image_to_video)
 * - reference: style/subject refs only (reference_to_video / element swap)
 * - mixed: image[0]=FIRST_FRAME, image[1+]=IMAGE_REF_n
 */
function buildOmniInput(
  prompt: string,
  images?: MediaRef[],
  role: OmniImageRole = "first_frame",
): string | OmniInputItem[] {
  if (!images?.length) return prompt;

  const alreadyTagged =
    prompt.includes("<FIRST_FRAME>") ||
    prompt.includes("<IMAGE_REF_") ||
    /starting frame/i.test(prompt) ||
    /as references for video/i.test(prompt);

  let tagged = prompt;
  if (!alreadyTagged) {
    if (role === "reference") {
      const refs = images.map((_, i) => `<IMAGE_REF_${i}>`).join(" ");
      tagged = `${refs} ${prompt} Use the given image(s) as references for video generation. The images should not be used as literal initial frames.`;
    } else if (role === "mixed" && images.length >= 2) {
      const refs = images
        .slice(1)
        .map((_, i) => `<IMAGE_REF_${i}>`)
        .join(" ");
      tagged = `<FIRST_FRAME> ${refs} ${prompt} Use the first image as the starting frame. Use the following image(s) as style/subject references, not as literal frames. Single continuous unbroken shot.`;
    } else {
      tagged = `<FIRST_FRAME> ${prompt} Use this image as the starting frame. Single continuous unbroken shot.`;
    }
  }

  return [
    ...images.map(
      (img): OmniInputItem => ({
        type: "image",
        data: normalizeBase64(img.data),
        mime_type: img.mimeType,
      }),
    ),
    { type: "text", text: tagged },
  ];
}

function imageRoleForTask(
  task: string,
  imageCount: number,
): OmniImageRole {
  if (task === "reference_to_video") {
    return imageCount >= 2 ? "mixed" : "reference";
  }
  if (task === "edit") return "reference";
  return "first_frame";
}

type InteractionVideoResult = {
  output_video?: {
    data?: string;
    mimeType?: string;
    mime_type?: string;
    uri?: string;
  } | null;
  steps?: Array<{
    type?: string;
    content?: Array<{
      type?: string;
      data?: string;
      uri?: string;
      mime_type?: string;
      mimeType?: string;
    }>;
  }>;
  id?: string;
  status?: string;
};

function extractVideoFromInteraction(interaction: InteractionVideoResult): {
  data?: string;
  uri?: string;
  mimeType: string;
  interactionId: string;
} {
  const id = interaction.id;
  if (!id) throw new Error("Omni interaction missing id");

  if (interaction.output_video?.data || interaction.output_video?.uri) {
    return {
      data: interaction.output_video.data,
      uri: interaction.output_video.uri,
      mimeType:
        interaction.output_video.mimeType ??
        interaction.output_video.mime_type ??
        "video/mp4",
      interactionId: id,
    };
  }

  for (const step of interaction.steps ?? []) {
    if (step?.type !== "model_output") continue;
    for (const content of step.content ?? []) {
      if (content?.type === "video" && (content?.data || content?.uri)) {
        return {
          data: content.data,
          uri: content.uri,
          mimeType: content.mime_type ?? content.mimeType ?? "video/mp4",
          interactionId: id,
        };
      }
    }
  }

  throw new Error("Omni Flash returned no video in the interaction");
}

/**
 * Docs: use delivery=uri for large videos; poll Files API until ACTIVE, then download.
 */
async function resolveVideoBytes(opts: {
  data?: string;
  uri?: string;
  mimeType: string;
}): Promise<{ data: string; mimeType: string }> {
  if (opts.data) {
    return { data: opts.data, mimeType: opts.mimeType };
  }
  if (!opts.uri) {
    throw new Error("Omni Flash returned neither video data nor uri");
  }

  const ai = getAiClient();
  const match = opts.uri.match(/files\/([a-zA-Z0-9_-]+)/);
  const name = match ? `files/${match[1]}` : opts.uri;

  for (let i = 0; i < 60; i++) {
    const info = await ai.files.get({ name });
    const state =
      typeof info.state === "string"
        ? info.state
        : (info.state as { name?: string } | undefined)?.name;
    if (state === "ACTIVE") break;
    if (state === "FAILED") {
      throw new Error("Omni Flash file processing failed");
    }
    await new Promise((r) => setTimeout(r, 2000));
  }

  const apiKey = requireApiKey();
  const downloadUrl = opts.uri.includes("alt=media")
    ? opts.uri
    : `https://generativelanguage.googleapis.com/v1beta/${name}:download?alt=media&key=${apiKey}`;

  const res = await fetch(downloadUrl, {
    headers: downloadUrl.includes("key=")
      ? undefined
      : { "x-goog-api-key": apiKey },
  });
  if (!res.ok) {
    throw new Error(`Failed to download Omni video (${res.status})`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  return {
    data: buf.toString("base64"),
    mimeType: res.headers.get("content-type") ?? opts.mimeType,
  };
}

type OmniCreateParams = {
  model: string;
  input: string | OmniInputItem[];
  previous_interaction_id?: string;
  response_format?: {
    type: string;
    aspect_ratio?: string;
    duration?: string;
    delivery?: "inline" | "uri";
  };
  generation_config?: { video_config?: { task?: string } };
  /** Docs: background=false, stream=false for faster unary generation. */
  background?: boolean;
  stream?: boolean;
  /** store=true required for previous_interaction_id edits. */
  store?: boolean;
};

async function createOmniInteraction(params: OmniCreateParams) {
  const ai = getAiClient();
  const interaction = (await ai.interactions.create(
    params as never,
  )) as InteractionVideoResult;
  return interaction;
}

/**
 * Omni Flash — text/image → video (first turn).
 * Performance knobs from https://ai.google.dev/gemini-api/docs/omni#best-practices
 * - background=false, stream=false for faster sync unary calls
 * - store=true so conversational edits can use previous_interaction_id
 * - shorter duration for faster generation
 * - delivery=uri avoids huge inline payloads
 */
export async function generateVideo(opts: {
  prompt: string;
  images?: MediaRef[];
  aspectRatio?: AspectRatio;
  task?: "text_to_video" | "image_to_video" | "reference_to_video" | "edit";
}): Promise<{
  data: string;
  mimeType: string;
  interactionId: string;
  latencyMs: number;
}> {
  const hasImages = Boolean(opts.images?.length);
  const imageCount = opts.images?.length ?? 0;
  const task =
    opts.task ?? (hasImages ? "image_to_video" : "text_to_video");
  const imageRole = imageRoleForTask(task, imageCount);
  const prompt = normalizeGeneratePrompt(opts.prompt);

  const started = Date.now();
  const interaction = await createOmniInteraction({
    model: OMNI_FLASH,
    input: buildOmniInput(prompt, opts.images, imageRole),
    background: false,
    stream: false,
    store: true,
    response_format: {
      type: "video",
      aspect_ratio: opts.aspectRatio ?? "16:9",
      duration: OMNI_DURATION,
      delivery: "uri",
    },
    generation_config: {
      video_config: {
        task,
      },
    },
  });

  const extracted = extractVideoFromInteraction(interaction);
  const video = await resolveVideoBytes(extracted);
  return {
    ...video,
    interactionId: extracted.interactionId,
    latencyMs: Date.now() - started,
  };
}

/**
 * Omni Flash — conversational edit over the previous interaction.
 * Do not set video_config.task with previous_interaction_id (API rejects it).
 */
export async function editVideo(opts: {
  instruction: string;
  previousInteractionId: string;
  images?: MediaRef[];
  aspectRatio?: AspectRatio;
}): Promise<{
  data: string;
  mimeType: string;
  interactionId: string;
  latencyMs: number;
}> {
  const started = Date.now();
  let instruction = normalizeEditInstruction(opts.instruction);
  if (
    opts.images?.length &&
    !/reference image/i.test(instruction) &&
    !instruction.includes("<IMAGE_REF_")
  ) {
    instruction = `${instruction} Use the attached reference image for the requested swap or style change.`;
  }

  const interaction = await createOmniInteraction({
    model: OMNI_FLASH,
    previous_interaction_id: opts.previousInteractionId,
    // Edits with stills are element/style swaps — never re-bind as FIRST_FRAME.
    input: buildOmniInput(instruction, opts.images, "reference"),
    background: false,
    stream: false,
    store: true,
    response_format: {
      type: "video",
      aspect_ratio: opts.aspectRatio ?? "16:9",
      delivery: "uri",
    },
  });

  const extracted = extractVideoFromInteraction(interaction);
  const video = await resolveVideoBytes(extracted);
  return {
    ...video,
    interactionId: extracted.interactionId,
    latencyMs: Date.now() - started,
  };
}

async function uploadVideoForOmni(opts: {
  data: string;
  mimeType: string;
}): Promise<{ uri: string; mimeType: string; name: string }> {
  const fs = await import("fs");
  const os = await import("os");
  const path = await import("path");
  const { randomUUID } = await import("crypto");

  const ai = getAiClient();
  const buffer = Buffer.from(normalizeBase64(opts.data), "base64");
  const ext = opts.mimeType.includes("webm") ? "webm" : "mp4";
  const tmp = path.join(os.tmpdir(), `omni-edit-${randomUUID()}.${ext}`);
  fs.writeFileSync(tmp, buffer);

  try {
    let file = await ai.files.upload({
      file: tmp,
      config: { mimeType: opts.mimeType || "video/mp4" },
    });

    const name = file.name;
    if (!name) throw new Error("Files API upload returned no file name");

    for (let i = 0; i < 60; i++) {
      const state =
        typeof file.state === "string"
          ? file.state
          : (file.state as { name?: string } | undefined)?.name;
      if (state === "ACTIVE") break;
      if (state === "FAILED") {
        throw new Error("Uploaded video failed Files API processing");
      }
      await new Promise((r) => setTimeout(r, 2000));
      file = await ai.files.get({ name });
    }

    const uri = file.uri;
    if (!uri) throw new Error("Uploaded video has no URI");
    return {
      uri,
      mimeType: file.mimeType || opts.mimeType || "video/mp4",
      name,
    };
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
  }
}

/**
 * Omni Flash — edit an arbitrary uploaded clip (e.g. ffmpeg-merged MP4).
 * Upload via Files API, then pass document URI to interactions.create.
 * Input should be ≤ ~10s (Omni limit). Returns a new interaction_id for
 * further conversational edits on that result.
 */
export async function editUploadedVideo(opts: {
  instruction: string;
  video: MediaRef;
  aspectRatio?: AspectRatio;
}): Promise<{
  data: string;
  mimeType: string;
  interactionId: string;
  latencyMs: number;
}> {
  const started = Date.now();
  const uploaded = await uploadVideoForOmni({
    data: opts.video.data,
    mimeType: opts.video.mimeType,
  });
  const instruction = normalizeEditInstruction(opts.instruction);

  const interaction = await createOmniInteraction({
    model: OMNI_FLASH,
    input: [
      {
        type: "document",
        uri: uploaded.uri,
        mime_type: uploaded.mimeType,
      },
      { type: "text", text: instruction },
    ],
    background: false,
    stream: false,
    store: true,
    response_format: {
      type: "video",
      aspect_ratio: opts.aspectRatio ?? "16:9",
      duration: OMNI_DURATION,
      delivery: "uri",
    },
  });

  const extracted = extractVideoFromInteraction(interaction);
  const video = await resolveVideoBytes(extracted);
  return {
    ...video,
    interactionId: extracted.interactionId,
    latencyMs: Date.now() - started,
  };
}
