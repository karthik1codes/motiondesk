/**
 * Product theme — keep generic for now.
 * Swap this file later for "AI Kitchen" branding without touching orchestration.
 * Starter prompts follow Omni Flash guidance:
 * https://ai.google.dev/gemini-api/docs/omni
 *
 * Shot plan (seed still → motion → conversational edits):
 * 1. Seed: ceramic mug on light oak, morning window light, shallow DoF
 * 2. Motion: continuous push-in + soft steam, calm daylight
 * 3. Edits (fallback only — Gemini 3 Flash regenerates these from the live plan):
 *    material → camera → atmosphere → lighting
 */
export const productTheme = {
  id: "generic",
  name: "MotionDesk",
  tagline: "Direct motion through conversation",
  description:
    "Seed stills with NB2 Lite, animate and edit with Omni Flash — multi-turn, not one-shot.",
  /** Placeholder vertical; replace with kitchen-specific copy later */
  verticalHint: "Generic director workspace (theme later: AI Kitchen)",
  // Object-only stills reduce Omni safety false positives.
  starterSeedPrompt:
    "A ceramic coffee mug on a light oak table, soft morning window light, shallow depth of field, no people, product photography",
  // Fallback only — Gemini 3 Flash usually overwrites this after seed.
  starterMotionPrompt:
    "Single continuous unbroken shot. Gentle camera push-in toward the mug, soft steam rising, calm daylight, no people, no dialogue, no on-screen text.",
  /**
   * Fallback edit chips aligned to the starter seed + motion plan.
   * After Generate seed, the UI prefers Flash-planned edits from that shot.
   */
  exampleEdits: [
    "Swap the oak table for dark walnut",
    "Slow the camera push-in a little",
    "Make the steam thicker and softer",
    "Warm the morning light to golden hour",
    "Swap the mug material using my reference image",
  ],
} as const;

export type ProductTheme = typeof productTheme;
