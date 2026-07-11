/**
 * Product theme — SignDesk ASL tutor.
 * Starter prompts follow Omni Flash guidance:
 * https://ai.google.dev/gemini-api/docs/omni
 *
 * Shot plan (seed still → motion → conversational ASL edits):
 * 1. Seed: anonymous woman ready to sign
 * 2. Motion: one clear ASL sign in a same-length clip
 * 3. Edits: swap the sign / clarity / framing in-clip (Omni cannot extend)
 */
export const productTheme = {
  id: "generic",
  name: "SignDesk",
  tagline: "Tutor signs through conversation",
  description:
    "Seed stills with NB2 Lite, animate and edit with Omni Flash — multi-turn, not one-shot.",
  /** Placeholder vertical; replace with kitchen-specific copy later */
  verticalHint: "Generic tutor workspace (theme later: AI Kitchen)",
  starterSeedPrompt:
    "A young woman from the chest up, navy shirt, soft studio light, plain light-gray background, friendly neutral expression, hands raised ready to sign in ASL, no logos, no on-screen text",
  // Fallback only — Gemini 3 Flash usually overwrites this after seed.
  starterMotionPrompt:
    'Single continuous unbroken shot. She clearly performs the ASL sign for "hello," holds briefly, then smiles softly. Keep face and hands readable. Soft studio light stays consistent. No captions, no on-screen text.',
  /**
   * Edit chips on Tutor + Sequence editor — same-clip ASL edits.
   * Omni cannot extend the video; each chip replaces action / polish in-frame.
   */
  exampleEdits: [
    // Core greetings / identity
    'Have her sign ASL "hello" in this same clip',
    'Have her sign ASL "goodbye" in this same clip',
    'Have her sign ASL "thank you" in this same clip',
    'Have her sign ASL "please" in this same clip',
    'Have her sign ASL "yes" in this same clip',
    'Have her sign ASL "no" in this same clip',
    'Have her sign ASL "I love you" in this same clip',
    'Have her sign ASL "my name is" in this same clip',
    'Have her sign ASL "what is your name" in this same clip',
    // Everyday questions
    'Have her sign ASL "what is the time" in this same clip',
    'Have her sign ASL "how are you" in this same clip',
    'Have her sign ASL "where" in this same clip',
    'Have her sign ASL "when" in this same clip',
    'Have her sign ASL "why" in this same clip',
    'Have her sign ASL "help" in this same clip',
    'Have her sign ASL "sorry" in this same clip',
    // Useful learner phrases
    'Have her sign ASL "good morning" in this same clip',
    'Have her sign ASL "good night" in this same clip',
    'Have her sign ASL "friend" in this same clip',
    'Have her sign ASL "family" in this same clip',
    'Have her sign ASL "learn" in this same clip',
    'Have her sign ASL "understand" in this same clip',
    'Have her sign ASL "again" in this same clip',
    'Have her sign ASL "slow" in this same clip',
    // In-clip clarity / presentation (not extension)
    "Make the handshapes larger and easier to read. Keep everything else the same.",
    "Slow her signing slightly so beginners can follow. Keep everything else the same.",
    "Hold the final handshape a beat longer. Keep everything else the same.",
    "Add a warmer smile after the sign. Keep everything else the same.",
    "Keep eyes on camera and face fully readable. Keep everything else the same.",
    "Soften the studio light a little. Keep everything else the same.",
    "Push in slightly so hands fill more of the frame. Keep everything else the same.",
  ],
} as const;

export type ProductTheme = typeof productTheme;
