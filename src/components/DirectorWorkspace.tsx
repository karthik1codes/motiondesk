"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppSidebar } from "@/components/AppSidebar";
import type { ChatMessage } from "@/components/DirectorChat";
import { DirectorPipelinePanel } from "@/components/DirectorPipelinePanel";
import { VideoStage } from "@/components/VideoStage";
import { Button } from "@/components/ui/button";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { formatApiError } from "@/lib/errors";
import {
  LAST_SESSION_KEY,
  SESSION_HISTORY_KEY,
  clearActiveSessionPointer,
  forgetSessionFromHistory,
  readSessionHistory,
  rememberSessionInHistory,
  type SessionHistoryEntry,
} from "@/lib/takes";
import { productTheme } from "@/lib/theme";
import type { AspectRatio } from "@/lib/types";

function toDataUrl(mimeType: string, data: string) {
  if (data.startsWith("data:")) return data;
  return `data:${mimeType};base64,${data}`;
}

/** Read an image file into MediaRef + object URL for the picker preview. */
function readImageFile(
  file: File,
): Promise<{ mimeType: string; data: string; previewUrl: string }> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) {
      reject(new Error("Please choose an image file (png, jpeg, webp)"));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read image file"));
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const match = /^data:([^;]+);base64,(.+)$/.exec(result);
      if (!match) {
        reject(new Error("Could not decode image"));
        return;
      }
      resolve({
        mimeType: match[1] || file.type || "image/jpeg",
        data: match[2],
        previewUrl: result,
      });
    };
    reader.readAsDataURL(file);
  });
}

type SessionSummary = {
  id: string;
  latestInteractionId: string | null;
  turnCount: number;
};

type SessionTurnSummary = {
  id: string;
  kind: string;
  role: "user" | "assistant" | "system";
  text: string;
  createdAt: string;
  interactionId?: string;
  latencyMs?: number;
  error?: string;
  hasVideo?: boolean;
  hasImage?: boolean;
};

type SessionResumePayload = {
  sessionId: string;
  latestInteractionId: string | null;
  aspectRatio?: AspectRatio;
  seedPrompt?: string | null;
  motionPrompt?: string | null;
  plannedEdits?: string[];
  takeCount?: number;
  hasSeed?: boolean;
  hasVideo?: boolean;
  seedImage?: { mimeType: string; data: string } | null;
  latestVideo?: { mimeType: string; data: string } | null;
  session?: {
    turns?: SessionTurnSummary[];
  };
};

function messagesFromTurns(turns: SessionTurnSummary[] | undefined): ChatMessage[] {
  if (!turns?.length) return [];
  return turns
    .filter((t) => t.role === "user" || t.role === "assistant")
    .filter((t) => Boolean(t.text?.trim()))
    .map((t) => ({
      id: t.id,
      role: t.role,
      text: t.text,
      meta: t.error
        ? "error"
        : t.latencyMs != null
          ? `${t.latencyMs}ms`
          : t.hasVideo
            ? "video"
            : t.hasImage
              ? "seed"
              : undefined,
    }));
}

export function DirectorWorkspace() {
  const router = useRouter();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [interactionId, setInteractionId] = useState<string | null>(null);
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("16:9");
  const [seedPrompt, setSeedPrompt] = useState<string>(
    productTheme.starterSeedPrompt,
  );
  const [motionPrompt, setMotionPrompt] = useState<string>(
    productTheme.starterMotionPrompt,
  );
  const [plannedEdits, setPlannedEdits] = useState<string[]>([
    ...productTheme.exampleEdits,
  ]);
  const [editText, setEditText] = useState("");
  /** Always surface ASL sign chips on Edit; Flash plan chips append if new. */
  const editSuggestions = useMemo(() => {
    const seen = new Set<string>([...productTheme.exampleEdits] as string[]);
    const base: string[] = [...productTheme.exampleEdits];
    for (const chip of plannedEdits) {
      if (!seen.has(chip)) {
        seen.add(chip);
        base.push(chip);
      }
    }
    return base;
  }, [plannedEdits]);
  const [seedUrl, setSeedUrl] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  /** Style still for Omni reference_to_video (Animate tab). */
  const [styleImage, setStyleImage] = useState<{
    mimeType: string;
    data: string;
    previewUrl: string;
  } | null>(null);
  /** Element-swap still for the next conversational edit. */
  const [swapImage, setSwapImage] = useState<{
    mimeType: string;
    data: string;
    previewUrl: string;
  } | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  /** Per-action busy flags so seed / video / edit can run in parallel. */
  const [busyJobs, setBusyJobs] = useState<
    Partial<Record<"seed" | "video" | "edit" | "session", string>>
  >({});
  const [error, setError] = useState<string | null>(null);
  const [lastLatency, setLastLatency] = useState<number | null>(null);
  const [sessionHistory, setSessionHistory] = useState<SessionHistoryEntry[]>(
    [],
  );
  const [pipelineTab, setPipelineTab] = useState("seed");

  const beginBusy = useCallback(
    (key: "seed" | "video" | "edit" | "session", hint: string) => {
      setBusyJobs((prev) => ({ ...prev, [key]: hint }));
    },
    [],
  );
  const endBusy = useCallback((key: "seed" | "video" | "edit" | "session") => {
    setBusyJobs((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);
  const busyHints = useMemo(
    () => Object.values(busyJobs).filter(Boolean) as string[],
    [busyJobs],
  );

  const rememberSession = useCallback((id: string) => {
    setSessionId(id);
    setSessionHistory(rememberSessionInHistory(id));
  }, []);

  /** One shared session id for Tutor + Sequence, mirrored to Firebase. */
  const bindSharedSession = useCallback(
    (id: string) => {
      rememberSession(id);
      void fetch(`/api/session/${id}/cloud`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }).catch(() => {
        /* cloud optional — local shared session still works */
      });
    },
    [rememberSession],
  );

  useEffect(() => {
    setSessionHistory(readSessionHistory());
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/session");
        if (!res.ok) return;
        const data = (await res.json()) as {
          sessions?: Array<{ id: string; updatedAt?: string }>;
          archiveEnabled?: boolean;
        };
        if (cancelled || !Array.isArray(data.sessions)) return;

        // Merge cloud ids into browser history so History lists Firebase sessions.
        let next = readSessionHistory();
        for (const row of data.sessions) {
          if (!row?.id) continue;
          next = [
            {
              id: row.id,
              seenAt: row.updatedAt || new Date().toISOString(),
            },
            ...next.filter((e) => e.id !== row.id),
          ];
        }
        next = next.slice(0, 12);
        window.localStorage.setItem(
          SESSION_HISTORY_KEY,
          JSON.stringify(next),
        );
        if (!cancelled) setSessionHistory(next);
      } catch {
        /* cloud list optional — local history still works */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const resetWorkspaceLocalState = useCallback(() => {
    setInteractionId(null);
    setSeedUrl(null);
    setVideoUrl(null);
    setStyleImage(null);
    setSwapImage(null);
    setMessages([]);
    setEditText("");
    setLastLatency(null);
    setError(null);
    setBusyJobs({});
    setPipelineTab("seed");
    setSeedPrompt(productTheme.starterSeedPrompt);
    setMotionPrompt(productTheme.starterMotionPrompt);
    setPlannedEdits([...productTheme.exampleEdits]);
  }, []);

  const applyResumedSession = useCallback(
    (data: SessionResumePayload, opts?: { syncUrl?: boolean }) => {
      bindSharedSession(data.sessionId);
      if (opts?.syncUrl !== false) {
        const url = new URL(window.location.href);
        url.searchParams.set("session", data.sessionId);
        window.history.replaceState({}, "", url.toString());
      }
      if (data.latestInteractionId) {
        setInteractionId(data.latestInteractionId);
      }
      if (data.aspectRatio === "16:9" || data.aspectRatio === "9:16") {
        setAspectRatio(data.aspectRatio);
      }
      if (typeof data.motionPrompt === "string" && data.motionPrompt.trim()) {
        setMotionPrompt(data.motionPrompt.trim());
      }
      if (Array.isArray(data.plannedEdits) && data.plannedEdits.length > 0) {
        setPlannedEdits(
          data.plannedEdits
            .map((e: unknown) => String(e).trim())
            .filter(Boolean),
        );
      }
      if (typeof data.seedPrompt === "string" && data.seedPrompt.trim()) {
        setSeedPrompt(data.seedPrompt.trim());
      }
      if (data.seedImage?.data) {
        setSeedUrl(toDataUrl(data.seedImage.mimeType, data.seedImage.data));
      }
      if (data.latestVideo?.data) {
        setVideoUrl(toDataUrl(data.latestVideo.mimeType, data.latestVideo.data));
      }
      const restored = messagesFromTurns(data.session?.turns);
      if (restored.length) {
        setMessages(restored);
      } else {
        setMessages([]);
      }
    },
    [bindSharedSession],
  );

  /** Resume the same persisted session after refresh / editor round-trip. */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const fromQuery = params.get("session");
    const saved = fromQuery || window.localStorage.getItem(LAST_SESSION_KEY);
    if (!saved) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/session/${saved}?includeMedia=1`);
        if (!res.ok) {
          setSessionHistory(forgetSessionFromHistory(saved));
          return;
        }
        const data = (await res.json()) as SessionResumePayload;
        if (cancelled) return;
        applyResumedSession(data);
      } catch {
        /* ignore — fresh session on next action */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applyResumedSession]);

  const stageLabel = useMemo(() => {
    if (videoUrl) return "Omni Flash · video";
    if (seedUrl) return "NB2 Lite · seed";
    return undefined;
  }, [seedUrl, videoUrl]);

  const pushMessage = useCallback((msg: Omit<ChatMessage, "id">) => {
    setMessages((prev) => [
      ...prev,
      { ...msg, id: `${Date.now()}-${prev.length}` },
    ]);
  }, []);

  const fail = useCallback(
    (e: unknown, fallback: string) => {
      const msg = formatApiError(e, fallback);
      setError(msg);
      pushMessage({ role: "assistant", text: msg, meta: "error" });
    },
    [pushMessage],
  );

  const startNewSession = useCallback(async () => {
    if (busyJobs.session) return;
    setError(null);
    beginBusy("session", "Starting a new tutor session…");
    try {
      clearActiveSessionPointer();
      resetWorkspaceLocalState();
      setSessionId(null);
      const res = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ aspectRatio }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to create session");
      const id = (data.session as SessionSummary).id;
      bindSharedSession(id);
      const url = new URL(window.location.href);
      url.searchParams.set("session", id);
      window.history.replaceState({}, "", url.toString());
      pushMessage({
        role: "assistant",
        text: `New session started (${id.slice(0, 8)}…). Seed and generate from a clean slate.`,
        meta: "session",
      });
    } catch (e) {
      fail(e, "Could not start a new session");
    } finally {
      endBusy("session");
    }
  }, [
    aspectRatio,
    beginBusy,
    bindSharedSession,
    busyJobs.session,
    endBusy,
    fail,
    pushMessage,
    resetWorkspaceLocalState,
  ]);

  const switchToSession = useCallback(
    async (id: string) => {
      if (id === sessionId || busyJobs.session) return;
      setError(null);
      beginBusy("session", "Switching session (may pull from cloud)…");
      try {
        const res = await fetch(`/api/session/${id}?includeMedia=1`);
        if (!res.ok) {
          setSessionHistory(forgetSessionFromHistory(id));
          setError(
            `Session ${id.slice(0, 8)}… was not found locally or in Firebase cloud.`,
          );
          return;
        }
        const data = (await res.json()) as SessionResumePayload;
        resetWorkspaceLocalState();
        applyResumedSession(data);
        const takeLabel =
          data.takeCount === 1 ? "1 take" : `${data.takeCount ?? 0} takes`;
        const notice = `Resumed session ${data.sessionId.slice(0, 8)}… (${takeLabel}${
          data.hasVideo ? ", latest video restored" : ""
        }).`;
        setMessages((prev) => [
          ...prev,
          {
            id: `resume-${Date.now()}`,
            role: "assistant",
            text: notice,
            meta: "session",
          },
        ]);
      } catch (e) {
        fail(e, "Could not switch session");
      } finally {
        endBusy("session");
      }
    },
    [
      applyResumedSession,
      beginBusy,
      busyJobs.session,
      endBusy,
      fail,
      resetWorkspaceLocalState,
      sessionId,
    ],
  );

  const ensureSession = useCallback(async () => {
    const fromQuery =
      typeof window !== "undefined"
        ? new URLSearchParams(window.location.search).get("session")
        : null;
    const fromStore =
      typeof window !== "undefined"
        ? window.localStorage.getItem(LAST_SESSION_KEY)
        : null;
    // Prefer the in-memory Tutor session so Sequence never forks a second id.
    const candidate = sessionId || fromQuery || fromStore;

    if (candidate) {
      try {
        const check = await fetch(`/api/session/${candidate}`);
        if (check.ok) {
          bindSharedSession(candidate);
          return candidate;
        }
        setSessionHistory(forgetSessionFromHistory(candidate));
      } catch {
        /* fall through and create a fresh session */
      }
    }

    const res = await fetch("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ aspectRatio }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Failed to create session");
    const id = (data.session as SessionSummary).id;
    bindSharedSession(id);
    return id;
  }, [aspectRatio, bindSharedSession, sessionId]);

  const openSequenceEditor = async () => {
    setError(null);
    try {
      const sid = await ensureSession();
      // Same session id as Tutor — Sequence never gets a different workspace.
      router.push(`/editor?session=${encodeURIComponent(sid)}`);
    } catch (e) {
      fail(e, "Could not open sequence editor");
    }
  };

  const deleteSessionFromHistory = useCallback(
    async (id: string) => {
      if (busyJobs.session) return;
      const confirmed = window.confirm(
        `Permanently delete session ${id.slice(0, 8)}… from this browser and Firebase cloud?`,
      );
      if (!confirmed) return;

      beginBusy("session", "Deleting session…");
      setError(null);
      try {
        const res = await fetch(`/api/session/${id}`, { method: "DELETE" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(
            (data as { error?: string }).error ?? "Failed to delete session",
          );
        }
        const next = forgetSessionFromHistory(id);
        setSessionHistory(next);

        if (sessionId === id) {
          resetWorkspaceLocalState();
          setSessionId(null);
          const url = new URL(window.location.href);
          url.searchParams.delete("session");
          window.history.replaceState({}, "", url.toString());
          if (next[0]?.id) {
            await switchToSession(next[0].id);
          }
        }
      } catch (e) {
        fail(e, "Could not delete session");
      } finally {
        endBusy("session");
      }
    },
    [
      beginBusy,
      busyJobs.session,
      endBusy,
      fail,
      resetWorkspaceLocalState,
      sessionId,
      switchToSession,
    ],
  );

  const onSeed = async () => {
    if (busyJobs.seed) return;
    setError(null);
    beginBusy("seed", "NB2 Lite seed + Gemini 3 Flash motion prompt…");
    try {
      const sid = await ensureSession();
      pushMessage({ role: "user", text: `Seed: ${seedPrompt}` });
      const res = await fetch("/api/seed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: seedPrompt,
          aspectRatio,
          sessionId: sid,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Seed failed");
      bindSharedSession(data.sessionId);
      setSeedUrl(toDataUrl(data.image.mimeType, data.image.data));
      if (typeof data.motionPrompt === "string" && data.motionPrompt.trim()) {
        setMotionPrompt(data.motionPrompt.trim());
      }
      if (Array.isArray(data.plannedEdits) && data.plannedEdits.length > 0) {
        setPlannedEdits(
          data.plannedEdits.map((e: unknown) => String(e).trim()).filter(Boolean),
        );
      }
      setLastLatency(data.latencyMs);
      pushMessage({
        role: "assistant",
        text: data.motionPrompt
          ? `Seed still ready. Shot plan for Omni:\n${data.motionPrompt}`
          : "Seed still ready.",
        meta: `${data.model} + ${data.promptModel ?? "gemini-3.5-flash"} · ${data.latencyMs}ms`,
      });
      setPipelineTab("animate");
    } catch (e) {
      fail(e, "Seed failed");
    } finally {
      endBusy("seed");
    }
  };

  const onStyleImagePick = useCallback(
    async (file: File | null) => {
      if (!file) {
        setStyleImage(null);
        return;
      }
      try {
        setStyleImage(await readImageFile(file));
        setError(null);
      } catch (e) {
        fail(e, "Could not load style image");
      }
    },
    [fail],
  );

  const onSwapImagePick = useCallback(
    async (file: File | null) => {
      if (!file) {
        setSwapImage(null);
        return;
      }
      try {
        setSwapImage(await readImageFile(file));
        setError(null);
      } catch (e) {
        fail(e, "Could not load swap image");
      }
    },
    [fail],
  );

  const onGenerate = async () => {
    if (busyJobs.video) return;
    setError(null);
    beginBusy(
      "video",
      styleImage
        ? "Omni Flash style transfer (reference_to_video)…"
        : "Omni Flash generating (~5s clip). This usually takes 20–60s…",
    );
    try {
      const sid = await ensureSession();
      pushMessage({
        role: "user",
        text: styleImage
          ? `[style transfer] ${motionPrompt}`
          : motionPrompt,
      });
      const res = await fetch("/api/video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: motionPrompt,
          aspectRatio,
          sessionId: sid,
          ...(styleImage
            ? {
                styleImage: {
                  mimeType: styleImage.mimeType,
                  data: styleImage.data,
                },
                task: "reference_to_video",
              }
            : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Video generation failed");
      bindSharedSession(data.sessionId);
      setInteractionId(data.interactionId);
      setVideoUrl(toDataUrl(data.video.mimeType, data.video.data));
      setLastLatency(data.latencyMs);
      pushMessage({
        role: "assistant",
        text: styleImage
          ? "Style-transfer video ready. Keep chatting to edit it."
          : "Video ready. Keep chatting to edit it.",
        meta: `${data.model} · ${data.latencyMs}ms · ${data.interactionId.slice(0, 12)}…`,
      });
      setPipelineTab("edit");
    } catch (e) {
      fail(e, "Video generation failed");
    } finally {
      endBusy("video");
    }
  };

  const onEdit = async () => {
    if (!editText.trim() || !interactionId || busyJobs.edit) return;
    setError(null);
    beginBusy(
      "edit",
      swapImage
        ? "Omni Flash element swap with reference still…"
        : "Omni Flash applying edit…",
    );
    const instruction = editText.trim();
    const attachedSwap = swapImage;
    const images = attachedSwap
      ? [{ mimeType: attachedSwap.mimeType, data: attachedSwap.data }]
      : undefined;
    setEditText("");
    try {
      const sid = await ensureSession();
      pushMessage({
        role: "user",
        text: attachedSwap ? `[element swap] ${instruction}` : instruction,
      });
      const res = await fetch("/api/edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instruction,
          previousInteractionId: interactionId,
          sessionId: sid,
          ...(images ? { images } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Edit failed");
      setInteractionId(data.interactionId);
      setVideoUrl(toDataUrl(data.video.mimeType, data.video.data));
      setLastLatency(data.latencyMs);
      setSwapImage(null);
      pushMessage({
        role: "assistant",
        text: attachedSwap ? "Element swap applied." : "Edit applied.",
        meta: `${data.model} · ${data.latencyMs}ms`,
      });
    } catch (e) {
      fail(e, "Edit failed");
    } finally {
      endBusy("edit");
    }
  };

  return (
    <SidebarProvider>
      <AppSidebar
        sessionId={sessionId}
        sessionHistory={sessionHistory}
        onNewSession={startNewSession}
        onSwitchSession={(id) => void switchToSession(id)}
        onDeleteSession={(id) => void deleteSessionFromHistory(id)}
        onOpenEditor={openSequenceEditor}
        disabled={Boolean(busyJobs.session)}
      />
      <SidebarInset className="flex min-h-svh min-w-0 flex-1 flex-col overflow-x-hidden lg:h-svh lg:overflow-hidden">
        <header className="flex min-h-14 shrink-0 items-center gap-2 border-b border-border/60 px-3 py-2 sm:px-4">
          <SidebarTrigger className="-ml-1 shrink-0" />
          <div className="hidden h-4 w-px shrink-0 bg-border sm:block" />
          <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{productTheme.name}</p>
              <p className="truncate text-xs text-muted-foreground">
                {productTheme.tagline}
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5 sm:gap-2">
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground sm:gap-2">
                <span className="sr-only sm:not-sr-only">Aspect</span>
                <select
                  value={aspectRatio}
                  disabled={Boolean(busyJobs.session)}
                  onChange={(e) =>
                    setAspectRatio(e.target.value as AspectRatio)
                  }
                  className="rounded-md border border-input bg-card px-2 py-1.5 text-xs text-foreground"
                  aria-label="Aspect ratio"
                >
                  <option value="16:9">16:9</option>
                  <option value="9:16">9:16</option>
                </select>
              </label>
              {lastLatency != null && (
                <span className="hidden rounded-full border border-primary/35 bg-primary/15 px-2.5 py-1 text-[12px] sm:inline">
                  Last: {lastLatency}ms
                </span>
              )}
              {sessionId && (
                <span
                  className="hidden rounded-full border border-white/12 bg-white/5 px-2.5 py-1 text-[12px] text-muted-foreground sm:inline"
                  title={sessionId}
                >
                  Session {sessionId.slice(0, 8)}
                </span>
              )}
            </div>
          </div>
        </header>

        {error && (
          <div
            className="mx-3 mt-3 flex items-start justify-between gap-3 rounded-xl border border-red-400/45 bg-red-900/30 px-3 py-3 text-red-100 sm:mx-5 sm:mt-4 sm:gap-4 sm:px-3.5"
            role="alert"
          >
            <div className="min-w-0 flex-1">
              <strong className="mb-1 block text-[13px] text-red-200">
                Request failed
              </strong>
              <p className="m-0 break-words text-sm leading-snug">{error}</p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0"
              onClick={() => setError(null)}
            >
              Dismiss
            </Button>
          </div>
        )}

        {busyHints.length > 0 && !error && (
          <div
            className="mx-3 mt-3 flex flex-col gap-1.5 rounded-xl border border-primary/35 bg-primary/10 px-3 py-3 text-sm text-amber-100 sm:mx-5 sm:mt-4 sm:px-3.5"
            role="status"
          >
            {busyHints.map((hint) => (
              <div key={hint} className="flex items-center gap-2.5">
                <span className="size-2.5 shrink-0 animate-pulse rounded-full bg-primary" />
                <p className="m-0 min-w-0 break-words">{hint}</p>
              </div>
            ))}
          </div>
        )}

        <div className="grid min-h-0 min-w-0 flex-1 gap-3 overflow-x-hidden overflow-y-auto p-3 pb-[max(1rem,env(safe-area-inset-bottom))] sm:gap-4 sm:p-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(22rem,28rem)] lg:items-stretch lg:overflow-hidden lg:pb-5">
          <div className="min-h-0 min-w-0 overflow-hidden rounded-2xl border border-border/70 bg-card/80 p-3 sm:p-4 lg:overflow-hidden">
            <VideoStage
              videoUrl={videoUrl}
              seedUrl={seedUrl}
              label={stageLabel}
              aspectRatio={aspectRatio}
            />
          </div>
          <DirectorPipelinePanel
            className="min-h-0 max-lg:h-auto lg:h-full"
            activeTab={pipelineTab}
            onTabChange={setPipelineTab}
            seedPrompt={seedPrompt}
            onSeedPromptChange={setSeedPrompt}
            motionPrompt={motionPrompt}
            onMotionPromptChange={setMotionPrompt}
            editText={editText}
            onEditTextChange={setEditText}
            messages={messages}
            plannedEdits={editSuggestions}
            interactionId={interactionId}
            stylePreviewUrl={styleImage?.previewUrl ?? null}
            onStyleImagePick={(file) => void onStyleImagePick(file)}
            swapPreviewUrl={swapImage?.previewUrl ?? null}
            onSwapImagePick={(file) => void onSwapImagePick(file)}
            busy={{
              seed: Boolean(busyJobs.seed),
              video: Boolean(busyJobs.video),
              edit: Boolean(busyJobs.edit),
            }}
            onSeed={onSeed}
            onGenerate={onGenerate}
            onEdit={onEdit}
          />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
