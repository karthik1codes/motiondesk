import { VIDEO_EXTENSION_USER_HINT } from "./prompt-guard";

/**
 * Turn SDK / Google API errors into a short UI-facing string.
 * Messages often look like: `400 {"error":{"message":"…","code":"…"}}`
 */
export function formatApiError(err: unknown, fallback = "Something went wrong"): string {
  if (err == null) return fallback;

  const raw =
    typeof err === "string"
      ? err
      : err instanceof Error
        ? err.message
        : String(err);

  const fromJson = extractGoogleMessage(raw);
  const cleaned = (fromJson ?? raw.replace(/^\d{3}\s+/, "").trim()) || fallback;
  return withUserHints(cleaned);
}

/** Extra guidance for known Omni / Gemini API limitations. */
function withUserHints(message: string): string {
  const lower = message.toLowerCase();
  if (
    lower.includes("video extension") ||
    (lower.includes("not supported") && lower.includes("extension")) ||
    lower.includes("interpolation")
  ) {
    return `${message} ${VIDEO_EXTENSION_USER_HINT}`;
  }
  if (
    lower.includes("prohibited content") ||
    lower.includes("usage guidelines") ||
    lower.includes("safety")
  ) {
    return `${message} Tip: use object-only prompts (no people/faces), regenerate the seed, then try again.`;
  }
  return message;
}

export function httpStatusFromError(err: unknown, fallback = 500): number {
  if (
    typeof err === "object" &&
    err !== null &&
    "status" in err &&
    typeof (err as { status: unknown }).status === "number"
  ) {
    const status = (err as { status: number }).status;
    if (status >= 400 && status < 600) return status;
  }
  return fallback;
}

function extractGoogleMessage(raw: string): string | null {
  const jsonStart = raw.indexOf("{");
  if (jsonStart === -1) return null;
  try {
    const parsed = JSON.parse(raw.slice(jsonStart)) as {
      error?: { message?: string };
      message?: string;
    };
    return parsed.error?.message ?? parsed.message ?? null;
  } catch {
    return null;
  }
}
