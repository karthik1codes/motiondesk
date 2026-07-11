/**
 * Omni Flash does not support video extension / interpolation.
 * https://ai.google.dev/gemini-api/docs/omni#limitations
 *
 * Rewrite user phrasing that the API often classifies as "extend this clip"
 * into same-duration in-clip edits or fresh same-length generation.
 */

const EXTENSION_PATTERNS: RegExp[] = [
  /\bextend(\s+the)?\s+(video|clip|shot|scene)\b/i,
  /\b(make|get)\s+(it|the\s+(video|clip))\s+longer\b/i,
  /\b(add|append)\s+more\s+(seconds?|time|footage)\b/i,
  /\blengthen\b/i,
  /\bcontinue\s+(the\s+)?(video|clip|shot|scene)\b/i,
  /\bkeep\s+(going|signing|moving)\b/i,
  /\bthen\s+continue\b/i,
  /\b(add|append)\s+(another|more)\s+(shot|scene|segment)\s+to\s+(this|the)\b/i,
  /\bvideo\s+extension\b/i,
  /\binterpolat(e|ion)\b/i,
  /\b(from)\s+\d+(\.\d+)?s?\s+to\s+\d+/i,
  /\bmake\s+(it|this)\s+\d+\s*s(ec(ond)?s?)?\s+longer\b/i,
];

/** Phrases that ask for more action after the current clip ends. */
const CONTINUE_ACTION_PATTERNS: RegExp[] = [
  /\b(then|next)\s+(she|he|they|the\s+\w+)\s+(signs?|does|performs?)\b/i,
  /\bcontinue\s+(signing|the\s+signs?)\b/i,
  /\b(add|do)\s+more\s+signs?\b/i,
  /\b(after\s+that|afterwards)\s+(she|he|they)\b/i,
];

export function looksLikeVideoExtension(prompt: string): boolean {
  const text = prompt.trim();
  if (!text) return false;
  return (
    EXTENSION_PATTERNS.some((re) => re.test(text)) ||
    CONTINUE_ACTION_PATTERNS.some((re) => re.test(text))
  );
}

/**
 * Rewrite extension / "continue the clip" language into a same-duration edit.
 * Returns the (possibly rewritten) prompt and whether a rewrite happened.
 */
export function sanitizeOmniPrompt(
  prompt: string,
  kind: "generate" | "edit" = "edit",
): { prompt: string; rewritten: boolean } {
  const trimmed = prompt.trim();
  if (!trimmed) return { prompt: trimmed, rewritten: false };
  if (!looksLikeVideoExtension(trimmed)) {
    return { prompt: trimmed, rewritten: false };
  }

  let next = trimmed;
  next = next
    .replace(/\bextend(\s+the)?\s+(video|clip|shot|scene)\b/gi, "edit within the same clip length")
    .replace(/\b(make|get)\s+(it|the\s+(video|clip))\s+longer\b/gi, "keep the same duration")
    .replace(/\b(add|append)\s+more\s+(seconds?|time|footage)\b/gi, "use the existing duration")
    .replace(/\blengthen\b/gi, "keep the same length")
    .replace(/\bcontinue\s+(the\s+)?(video|clip|shot|scene)\b/gi, "rework this same-length clip")
    .replace(/\bkeep\s+(going|signing|moving)\b/gi, "perform the next action in-frame")
    .replace(/\bthen\s+continue\b/gi, "instead, within this same clip,")
    .replace(/\b(add|append)\s+(another|more)\s+(shot|scene|segment)\s+to\s+(this|the)\b/gi, "replace the action in")
    .replace(/\bvideo\s+extension\b/gi, "in-clip edit")
    .replace(/\binterpolat(e|ion)\b/gi, "in-clip motion")
    .replace(/\bcontinue\s+(signing|the\s+signs?)\b/gi, "perform the next ASL sign in this same clip")
    .replace(/\b(add|do)\s+more\s+signs?\b/gi, "perform the ASL signs inside this same-length clip")
    .replace(
      /\b(then|next)\s+(she|he|they|the\s+\w+)\s+(signs?|does|performs?)\b/gi,
      "within this same clip, $2 $3",
    )
    .replace(/\b(after\s+that|afterwards)\s+(she|he|they)\b/gi, "in this same clip, $2")
    .replace(/\s+/g, " ")
    .trim();

  const guard =
    kind === "edit"
      ? "Do not extend, lengthen, or continue past the current clip. Change only the action inside the existing duration."
      : "Generate one continuous clip at the requested duration only. Do not extend or append extra seconds.";

  if (!/do not extend/i.test(next)) {
    next = `${next} ${guard}`;
  }

  return { prompt: next, rewritten: next !== trimmed };
}

export const VIDEO_EXTENSION_USER_HINT =
  "Omni Flash cannot extend or lengthen a clip. Ask for a same-duration edit (e.g. “Have her sign thank you in this clip”) or generate a new take for the next sign.";
