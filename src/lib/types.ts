/** Core domain types for conversational video orchestration (vertical-agnostic). */

export type AspectRatio = "16:9" | "9:16";

export type MediaRef = {
  mimeType: string;
  /** Raw base64 without data: URL prefix */
  data: string;
};

export type SeedImageRequest = {
  prompt: string;
  aspectRatio?: AspectRatio;
  /** Optional reference image to condition the seed */
  referenceImage?: MediaRef;
};

export type SeedImageResult = {
  image: MediaRef;
  prompt: string;
  latencyMs: number;
  model: string;
};

export type VideoTask =
  | "text_to_video"
  | "image_to_video"
  | "reference_to_video"
  | "edit";

export type GenerateVideoRequest = {
  /** Motion / scene instruction (text) */
  prompt: string;
  aspectRatio?: AspectRatio;
  /** Seed still(s) from NB2 Lite or uploads */
  images?: MediaRef[];
  /**
   * Style / subject reference still for Omni `reference_to_video`.
   * Combined with the seed as FIRST_FRAME + IMAGE_REF when both exist.
   */
  styleImage?: MediaRef;
  task?: VideoTask;
  sessionId?: string;
};

export type EditVideoRequest = {
  /** Natural-language edit instruction */
  instruction: string;
  /** Omni Interactions API id from the last successful video turn */
  previousInteractionId: string;
  sessionId?: string;
  /** Optional extra reference images for element swap */
  images?: MediaRef[];
};

export type VideoTurnKind = "generate" | "edit" | "seed" | "upload";

export type VideoTurn = {
  id: string;
  kind: VideoTurnKind;
  role: "user" | "assistant" | "system";
  text: string;
  createdAt: string;
  interactionId?: string;
  video?: {
    mimeType: string;
    data: string;
  };
  image?: MediaRef;
  latencyMs?: number;
  error?: string;
};

export type DirectorSession = {
  id: string;
  createdAt: string;
  updatedAt: string;
  /** Latest Omni interaction id — required for conversational edits */
  latestInteractionId: string | null;
  seedImage: MediaRef | null;
  /** Last seed still prompt (used to derive Omni motion prompts) */
  seedPrompt: string | null;
  /** Motion prompt written by Gemini 3 Flash from the seed prompt */
  motionPrompt: string | null;
  /** Edit chips planned from the seed + motion shot plan */
  plannedEdits: string[];
  latestVideo: { mimeType: string; data: string } | null;
  turns: VideoTurn[];
  aspectRatio: AspectRatio;
};

export type ApiErrorBody = {
  error: string;
  detail?: string;
};
