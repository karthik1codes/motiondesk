"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ArrowLeftIcon,
  CombineIcon,
  ListPlusIcon,
  Trash2Icon,
  UploadIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { formatApiError } from "@/lib/errors";
import {
  fetchServerActiveSession,
  pushServerActiveSession,
} from "@/lib/active-session-client";
import { useAuth } from "@/lib/auth-context";
import { authFetch } from "@/lib/auth-fetch";
import {
  LAST_SESSION_KEY,
  createMergedShot,
  flattenSequenceTakeIds,
  normalizeSequence,
  readSessionHistory,
  rememberSessionInHistory,
  sequenceStorageKey,
  type SequenceShot,
  type TakeSummary,
  type VideoTake,
} from "@/lib/takes";
import { productTheme } from "@/lib/theme";
import type { AspectRatio } from "@/lib/types";

function toDataUrl(mimeType: string, data: string) {
  if (data.startsWith("data:")) return data;
  return `data:${mimeType};base64,${data}`;
}

type LoadedTake = TakeSummary & {
  videoUrl: string;
};

/**
 * Multi-shot editor: review recent Omni takes, continue conversational edits,
 * and sequence clips into a timeline.
 *
 * Omni Flash cannot merge/reason across multiple videos in one API call
 * (see docs limitations). Merge here = a timeline group that plays selected
 * takes back-to-back (right-click to select, then Merge).
 */
export function SequenceEditor() {
  const searchParams = useSearchParams();
  const sessionFromUrl = searchParams.get("session");
  const { user, loading: authLoading, getIdToken } = useAuth();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [recentSessions, setRecentSessions] = useState<
    ReturnType<typeof readSessionHistory>
  >([]);
  /** False until the first session bootstrap attempt finishes. */
  const [bootstrapped, setBootstrapped] = useState(false);
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("16:9");
  const loadGenRef = useRef(0);
  const [takes, setTakes] = useState<TakeSummary[]>([]);
  const [loaded, setLoaded] = useState<Record<string, LoadedTake>>({});
  const loadedRef = useRef<Record<string, LoadedTake>>({});
  const [sequence, setSequence] = useState<SequenceShot[]>([]);
  const [mergeSelection, setMergeSelection] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** Timeline row currently highlighted / driving playback. */
  const [activeShotKey, setActiveShotKey] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  /** True when preview is an ffmpeg-stitched export (editable via Files API upload). */
  const [previewIsMergedExport, setPreviewIsMergedExport] = useState(false);
  const [editText, setEditText] = useState("");
  /** Per-action busy so load / edit / play / merge / download can overlap. */
  const [busyJobs, setBusyJobs] = useState<
    Partial<
      Record<
        | "load"
        | "edit"
        | "play"
        | "merge"
        | "download"
        | "export"
        | "delete"
        | "upload",
        string
      >
    >
  >({});
  const [error, setError] = useState<string | null>(null);
  /** When set, clips play in order until finished or the user picks another item. */
  const [playQueue, setPlayQueue] = useState<string[] | null>(null);
  const [playIndex, setPlayIndex] = useState(0);
  /** Only true for intentional timeline / merge playback — not Recent takes select. */
  const [shouldAutoplay, setShouldAutoplay] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const playQueueRef = useRef<string[] | null>(null);
  const playIndexRef = useRef(0);
  const sequenceRef = useRef(sequence);
  sequenceRef.current = sequence;

  const beginBusy = useCallback(
    (
      key:
        | "load"
        | "edit"
        | "play"
        | "merge"
        | "download"
        | "export"
        | "delete"
        | "upload",
      hint: string,
    ) => {
      setBusyJobs((prev) => ({ ...prev, [key]: hint }));
    },
    [],
  );
  const endBusy = useCallback(
    (
      key:
        | "load"
        | "edit"
        | "play"
        | "merge"
        | "download"
        | "export"
        | "delete"
        | "upload",
    ) => {
      setBusyJobs((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    },
    [],
  );
  const busyHints = useMemo(
    () => Object.values(busyJobs).filter(Boolean) as string[],
    [busyJobs],
  );
  const selected = selectedId ? loaded[selectedId] : null;
  const playFlatIds = useMemo(
    () => flattenSequenceTakeIds(sequence),
    [sequence],
  );
  const activeMergedShot = useMemo(() => {
    if (!activeShotKey) return null;
    const shot = sequence.find((s) => s.key === activeShotKey);
    return shot && shot.takeIds.length > 1 ? shot : null;
  }, [activeShotKey, sequence]);

  const shotKeyForTake = useCallback(
    (takeId: string) => {
      const exact = sequence.find(
        (s) => s.takeIds.length === 1 && s.takeIds[0] === takeId,
      );
      if (exact) return exact.key;
      const containing = sequence.find((s) => s.takeIds.includes(takeId));
      return containing?.key ?? null;
    },
    [sequence],
  );

  const refreshTakes = useCallback(async (sid: string) => {
    const res = await authFetch(`/api/session/${sid}/takes`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Failed to load takes");
    if (data.aspectRatio === "16:9" || data.aspectRatio === "9:16") {
      setAspectRatio(data.aspectRatio);
    }
    setTakes(data.takes as TakeSummary[]);
    return data.takes as TakeSummary[];
  }, []);

  const ensureLoaded = useCallback(
    async (sid: string, takeId: string, opts?: { quiet?: boolean }) => {
      const cached = loadedRef.current[takeId];
      if (cached) return cached;

      if (!opts?.quiet) beginBusy("load", "Loading take…");
      try {
        const res = await authFetch(`/api/session/${sid}/takes/${takeId}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Failed to load take");
        const take = data.take as VideoTake;
        if (!take.video) throw new Error("Take has no video");
        const entry: LoadedTake = {
          id: take.id,
          kind: take.kind,
          label: take.label,
          interactionId: take.interactionId,
          createdAt: take.createdAt,
          latencyMs: take.latencyMs,
          hasVideo: true,
          videoUrl: toDataUrl(take.video.mimeType, take.video.data),
        };
        loadedRef.current = { ...loadedRef.current, [takeId]: entry };
        setLoaded(loadedRef.current);
        return entry;
      } finally {
        if (!opts?.quiet) endBusy("load");
      }
    },
    [beginBusy, endBusy],
  );

  const startPlayback = useCallback(
    async (
      takeIds: string[],
      opts?: { shotKey?: string | null; label?: string },
    ) => {
      if (!sessionId || takeIds.length === 0 || busyJobs.play) return;
      setError(null);
      const unique = [...new Set(takeIds)];
      try {
        beginBusy(
          "play",
          unique.length > 1
            ? `Loading merged sequence (${unique.length} clips)…`
            : "Loading take…",
        );
        for (const id of unique) {
          await ensureLoaded(sessionId, id, { quiet: true });
        }
        const first = await ensureLoaded(sessionId, takeIds[0], {
          quiet: true,
        });
        playQueueRef.current = takeIds;
        playIndexRef.current = 0;
        setPlayQueue(takeIds);
        setPlayIndex(0);
        setSelectedId(first.id);
        setPreviewUrl(first.videoUrl);
        setShouldAutoplay(true);
        setPreviewIsMergedExport(false);
        setActiveShotKey(
          opts?.shotKey !== undefined
            ? opts.shotKey
            : shotKeyForTake(first.id),
        );
      } catch (e) {
        setError(formatApiError(e, opts?.label ?? "Could not play take"));
        playQueueRef.current = null;
        setPlayQueue(null);
        setShouldAutoplay(false);
      } finally {
        endBusy("play");
      }
    },
    [sessionId, ensureLoaded, shotKeyForTake, beginBusy, endBusy, busyJobs.play],
  );

  /** Recent takes: select + load preview only — no autoplay, no queue. */
  const selectTakePreview = useCallback(
    async (takeId: string) => {
      if (!sessionId) return;
      setError(null);
      try {
        playQueueRef.current = null;
        playIndexRef.current = 0;
        setPlayQueue(null);
        setPlayIndex(0);
        setShouldAutoplay(false);
        setActiveShotKey(null);
        setPreviewIsMergedExport(false);
        const take = await ensureLoaded(sessionId, takeId);
        setSelectedId(take.id);
        setPreviewUrl(take.videoUrl);
        const el = videoRef.current;
        if (el) {
          el.pause();
          el.currentTime = 0;
        }
      } catch (e) {
        setError(formatApiError(e, "Could not open take"));
      }
    },
    [sessionId, ensureLoaded],
  );

  useEffect(() => {
    if (authLoading) return;

    const fromQuery =
      sessionFromUrl ||
      (typeof window !== "undefined"
        ? new URLSearchParams(window.location.search).get("session")
        : null);
    const fromStore =
      typeof window !== "undefined"
        ? window.localStorage.getItem(LAST_SESSION_KEY)
        : null;
    const fromHistory =
      typeof window !== "undefined"
        ? readSessionHistory()[0]?.id ?? null
        : null;

    const gen = ++loadGenRef.current;
    let cancelled = false;
    (async () => {
      const fromServer = user
        ? await fetchServerActiveSession(getIdToken)
        : null;
      // Prefer URL → server active (cross-device) → localStorage → history.
      const sid = fromQuery || fromServer || fromStore || fromHistory;
      if (!sid) {
        setSessionId(null);
        setRecentSessions(readSessionHistory());
        setBootstrapped(true);
        return;
      }

      beginBusy("load", "Opening session…");
      try {
        const res = await authFetch(`/api/session/${sid}`);
        const data = await res.json();
        if (cancelled || gen !== loadGenRef.current) return;
        if (!res.ok) {
          window.localStorage.removeItem(LAST_SESSION_KEY);
          setSessionId(null);
          setTakes([]);
          setRecentSessions(readSessionHistory());
          setError(
            "This tutor session was not found. Go back to Tutor, pick a saved session (or generate again), then reopen Sequence editor.",
          );
          return;
        }
        setError(null);
        setSessionId(data.sessionId);
        if (data.aspectRatio === "16:9" || data.aspectRatio === "9:16") {
          setAspectRatio(data.aspectRatio);
        }
        rememberSessionInHistory(data.sessionId);
        void authFetch(`/api/session/${data.sessionId}/cloud`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        }).catch(() => {
          /* cloud optional */
        });
        void pushServerActiveSession(data.sessionId, getIdToken);
        // Keep the URL pinned to this session for share/reload.
        const url = new URL(window.location.href);
        url.searchParams.set("session", data.sessionId);
        window.history.replaceState({}, "", url.toString());

        const saved = window.localStorage.getItem(
          sequenceStorageKey(data.sessionId),
        );
        if (saved) {
          try {
            setSequence(normalizeSequence(JSON.parse(saved)));
          } catch {
            /* ignore */
          }
        }
        await refreshTakes(data.sessionId);
      } catch (e) {
        if (!cancelled && gen === loadGenRef.current) {
          setError(formatApiError(e, "Failed to resume session"));
        }
      } finally {
        if (!cancelled && gen === loadGenRef.current) {
          endBusy("load");
          setBootstrapped(true);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    sessionFromUrl,
    refreshTakes,
    beginBusy,
    endBusy,
    authLoading,
    user,
    getIdToken,
  ]);

  useEffect(() => {
    if (!sessionId) return;
    window.localStorage.setItem(
      sequenceStorageKey(sessionId),
      JSON.stringify(sequence),
    );
    // Mirror sequence order to Firebase (deepmind-2a4e2) when archive is enabled.
    const t = window.setTimeout(() => {
      void authFetch(`/api/session/${sessionId}/cloud`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sequence }),
      }).catch(() => {
        /* cloud optional — local sequence still works */
      });
    }, 800);
    return () => window.clearTimeout(t);
  }, [sequence, sessionId]);

  const onSelectTake = async (takeId: string) => {
    await selectTakePreview(takeId);
  };

  const onSelectTimelineShot = async (shot: SequenceShot) => {
    // Timeline drives playback: merged groups play in order; singles play that take.
    // Full-timeline back-to-back ("Play sequence") is intentionally not used.
    await startPlayback(shot.takeIds, { shotKey: shot.key });
  };

  const addToSequence = (takeId: string) => {
    setSequence((prev) => {
      if (prev.some((s) => s.takeIds.length === 1 && s.takeIds[0] === takeId)) {
        return prev;
      }
      return [...prev, { key: takeId, takeIds: [takeId] }];
    });
  };

  const removeFromSequence = (key: string) => {
    setSequence((prev) => prev.filter((s) => s.key !== key));
    if (activeShotKey === key) setActiveShotKey(null);
  };

  const moveInSequence = (key: string, dir: -1 | 1) => {
    setSequence((prev) => {
      const i = prev.findIndex((s) => s.key === key);
      if (i < 0) return prev;
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  };

  const toggleMergeSelect = (takeId: string) => {
    setMergeSelection((prev) =>
      prev.includes(takeId)
        ? prev.filter((id) => id !== takeId)
        : [...prev, takeId],
    );
  };

  const mergeSelectedShots = async () => {
    if (mergeSelection.length < 2 || !sessionId || busyJobs.merge) return;
    const ids = [...mergeSelection];
    const shot = createMergedShot(ids);
    beginBusy("merge", "Merging on server with ffmpeg…");
    setError(null);
    try {
      setSequence((prev) => [...prev, shot]);
      setMergeSelection([]);
      setActiveShotKey(shot.key);

      const res = await authFetch(`/api/session/${sessionId}/merge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ takeIds: ids }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Server merge failed");

      const mimeType = (data.mimeType as string) || "video/mp4";
      const dataUrl = `data:${mimeType};base64,${data.data as string}`;

      playQueueRef.current = null;
      setPlayQueue(null);
      setPlayIndex(0);
      setShouldAutoplay(true);
      setPreviewUrl(dataUrl);
      setPreviewIsMergedExport(true);

      // Keep last source take loaded for fallback; merged export uses Files API edit.
      const lastId = ids[ids.length - 1];
      try {
        const last = await ensureLoaded(sessionId, lastId, { quiet: true });
        setSelectedId(last.id);
      } catch {
        setSelectedId(lastId);
      }

      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = `merged-${ids.length}clips-${Date.now().toString(36)}.mp4`;
      a.click();
    } catch (e) {
      setError(formatApiError(e, "Server ffmpeg merge failed"));
      // Still allow back-to-back preview if stitch failed.
      await startPlayback(shot.takeIds, {
        shotKey: shot.key,
        label: "Could not play merged sequence",
      });
    } finally {
      endBusy("merge");
    }
  };

  const mergeTakeWithSelection = async (takeId: string) => {
    const ids = mergeSelection.includes(takeId)
      ? [...mergeSelection]
      : [...mergeSelection, takeId];
    if (ids.length < 2) {
      setMergeSelection(ids);
      setError(
        "Queued for merge. Right-click another take → Queue for merge, then Merge.",
      );
      return;
    }
    setMergeSelection(ids);
    // Reuse mergeSelectedShots path by setting selection then calling.
    if (busyJobs.merge || !sessionId) return;
    const shot = createMergedShot(ids);
    beginBusy("merge", "Merging on server with ffmpeg…");
    setError(null);
    try {
      setSequence((prev) => [...prev, shot]);
      setMergeSelection([]);
      setActiveShotKey(shot.key);

      const res = await authFetch(`/api/session/${sessionId}/merge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ takeIds: ids }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Server merge failed");

      const mimeType = (data.mimeType as string) || "video/mp4";
      const dataUrl = `data:${mimeType};base64,${data.data as string}`;

      playQueueRef.current = null;
      setPlayQueue(null);
      setPlayIndex(0);
      setShouldAutoplay(true);
      setPreviewUrl(dataUrl);
      setPreviewIsMergedExport(true);

      const lastId = ids[ids.length - 1];
      try {
        const last = await ensureLoaded(sessionId, lastId, { quiet: true });
        setSelectedId(last.id);
      } catch {
        setSelectedId(lastId);
      }

      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = `merged-${ids.length}clips-${Date.now().toString(36)}.mp4`;
      a.click();
    } catch (e) {
      setError(formatApiError(e, "Server ffmpeg merge failed"));
      await startPlayback(shot.takeIds, {
        shotKey: shot.key,
        label: "Could not play merged sequence",
      });
    } finally {
      endBusy("merge");
    }
  };

  /** Permanent delete: local session + Firebase Storage/Firestore + UI. */
  const deleteTakesPermanently = async (takeIds: string[]) => {
    if (!sessionId || takeIds.length === 0 || busyJobs.delete) return;
    const unique = [...new Set(takeIds)];
    const confirmed = window.confirm(
      unique.length === 1
        ? "Permanently delete this take from the server session and Firebase cloud?"
        : `Permanently delete ${unique.length} takes from the server session and Firebase cloud?`,
    );
    if (!confirmed) return;

    beginBusy("delete", `Deleting ${unique.length} take(s)…`);
    setError(null);
    try {
      for (const takeId of unique) {
        const res = await authFetch(`/api/session/${sessionId}/takes/${takeId}`, {
          method: "DELETE",
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Delete failed");
      }

      const list = await refreshTakes(sessionId);
      setTakes(list);

      const removed = new Set(unique);
      loadedRef.current = Object.fromEntries(
        Object.entries(loadedRef.current).filter(([id]) => !removed.has(id)),
      );
      setLoaded({ ...loadedRef.current });

      setMergeSelection((prev) => prev.filter((id) => !removed.has(id)));
      setSequence((prev) =>
        prev
          .map((shot) => ({
            ...shot,
            takeIds: shot.takeIds.filter((id) => !removed.has(id)),
          }))
          .filter((shot) => shot.takeIds.length > 0),
      );

      if (selectedId && removed.has(selectedId)) {
        setSelectedId(null);
        setPreviewUrl(null);
        setShouldAutoplay(false);
        playQueueRef.current = null;
        setPlayQueue(null);
      }
    } catch (e) {
      setError(formatApiError(e, "Delete failed"));
    } finally {
      endBusy("delete");
    }
  };

  const deleteTimelineShotPermanently = async (shot: SequenceShot) => {
    await deleteTakesPermanently(shot.takeIds);
  };

  const playMergedOnly = async () => {
    const merges = sequence.filter((s) => s.takeIds.length > 1);
    if (merges.length === 0) {
      setError(
        "No merged shots on the timeline yet. Right-click takes in Recent takes, then Merge.",
      );
      return;
    }
    const target =
      (activeShotKey && merges.find((s) => s.key === activeShotKey)) ||
      merges[merges.length - 1];
    await startPlayback(target.takeIds, {
      shotKey: target.key,
      label: "Could not play merged video",
    });
  };

  /** Server ffmpeg concat → one MP4 download + preview. */
  const exportMergedMp4 = async (takeIds?: string[]) => {
    if (!sessionId || busyJobs.export) return;
    const ids =
      takeIds ??
      (() => {
        const merges = sequence.filter((s) => s.takeIds.length > 1);
        const target =
          (activeShotKey && merges.find((s) => s.key === activeShotKey)) ||
          merges[merges.length - 1];
        return target?.takeIds;
      })();
    if (!ids || ids.length < 2) {
      setError(
        "Select or create a merged group (2+ takes) before saving an MP4.",
      );
      return;
    }

    setError(null);
    beginBusy("export", "Merging on server with ffmpeg…");
    try {
      const res = await authFetch(`/api/session/${sessionId}/merge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ takeIds: ids }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Server merge failed");

      const mimeType = (data.mimeType as string) || "video/mp4";
      const dataUrl = `data:${mimeType};base64,${data.data as string}`;

      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = `merged-${ids.length}clips-${Date.now().toString(36)}.mp4`;
      a.click();

      playQueueRef.current = null;
      setPlayQueue(null);
      setShouldAutoplay(false);
      setPreviewUrl(dataUrl);
      setPreviewIsMergedExport(true);
      beginBusy("export", "Merged MP4 ready");
    } catch (e) {
      setError(formatApiError(e, "Server ffmpeg merge failed"));
    } finally {
      endBusy("export");
    }
  };

  useEffect(() => {
    if (!previewUrl || !shouldAutoplay) return;
    const el = videoRef.current;
    if (!el) return;
    const tryPlay = () => {
      void el.play().catch(() => undefined);
    };
    // Fresh src may need a tick before play() succeeds.
    if (el.readyState >= 2) {
      tryPlay();
    } else {
      el.addEventListener("loadeddata", tryPlay, { once: true });
      return () => el.removeEventListener("loadeddata", tryPlay);
    }
  }, [previewUrl, playIndex, shouldAutoplay]);

  /** Advance merge/queue playback without awaiting — keeps autoplay allowed. */
  const onClipEnded = () => {
    if (!sessionId) return;
    const queue = playQueueRef.current;
    if (!queue || queue.length === 0) return;
    const next = playIndexRef.current + 1;
    if (next >= queue.length) {
      playQueueRef.current = null;
      playIndexRef.current = 0;
      setPlayQueue(null);
      setPlayIndex(0);
      setShouldAutoplay(false);
      return;
    }

    const takeId = queue[next];
    const cached = loadedRef.current[takeId];
    if (!cached) {
      // Should already be preloaded in startPlayback; fall back async.
      void (async () => {
        try {
          const take = await ensureLoaded(sessionId, takeId, { quiet: true });
          playIndexRef.current = next;
          setPlayIndex(next);
          setSelectedId(take.id);
          setPreviewUrl(take.videoUrl);
          setShouldAutoplay(true);
        } catch (e) {
          setError(formatApiError(e, "Playback failed on next clip"));
          playQueueRef.current = null;
          setPlayQueue(null);
          setShouldAutoplay(false);
        }
      })();
      return;
    }

    playIndexRef.current = next;
    setPlayIndex(next);
    setSelectedId(cached.id);
    setPreviewUrl(cached.videoUrl);
    setShouldAutoplay(true);
    setActiveShotKey((prev) => {
      if (
        prev &&
        sequenceRef.current.some(
          (s) => s.key === prev && s.takeIds.includes(takeId),
        )
      ) {
        return prev;
      }
      return shotKeyForTake(takeId);
    });

    // Swap src on the same element synchronously so the browser allows play().
    const el = videoRef.current;
    if (el) {
      el.src = cached.videoUrl;
      el.load();
      void el.play().catch(() => undefined);
    }
  };

  const onContinueEdit = async () => {
    if (!sessionId || !editText.trim() || busyJobs.edit) return;

    // Merged ffmpeg export: upload to Files API and Omni-edit that footage.
    if (previewIsMergedExport && previewUrl) {
      beginBusy("edit", "Uploading merged clip to Omni…");
      setError(null);
      try {
        const bytes = new Uint8Array(
          await (await fetch(previewUrl)).arrayBuffer(),
        );
        let binary = "";
        const chunk = 0x8000;
        for (let i = 0; i < bytes.length; i += chunk) {
          binary += String.fromCharCode(
            ...bytes.subarray(i, Math.min(i + chunk, bytes.length)),
          );
        }
        const b64 = btoa(binary);
        const mimeMatch = /^data:([^;]+)/.exec(previewUrl);
        const mimeType = mimeMatch?.[1] ?? "video/mp4";

        const res = await authFetch("/api/edit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            instruction: editText.trim(),
            sessionId,
            video: { mimeType, data: b64 },
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Merged edit failed");
        setEditText("");
        setPreviewIsMergedExport(false);
        const list = await refreshTakes(sessionId);
        const newest = list[list.length - 1];
        if (newest) {
          addToSequence(newest.id);
          await selectTakePreview(newest.id);
        }
      } catch (e) {
        setError(formatApiError(e, "Merged Omni edit failed"));
      } finally {
        endBusy("edit");
      }
      return;
    }

    if (!selected) return;

    // Uploaded local takes have no Omni interaction id — edit via Files API.
    if (!selected.interactionId) {
      const take = await ensureLoaded(sessionId, selected.id, { quiet: true });
      beginBusy("edit", "Uploading clip to Omni…");
      setError(null);
      try {
        const bytes = new Uint8Array(
          await (await fetch(take.videoUrl)).arrayBuffer(),
        );
        let binary = "";
        const chunk = 0x8000;
        for (let i = 0; i < bytes.length; i += chunk) {
          binary += String.fromCharCode(
            ...bytes.subarray(i, Math.min(i + chunk, bytes.length)),
          );
        }
        const b64 = btoa(binary);
        const mimeMatch = /^data:([^;]+)/.exec(take.videoUrl);
        const mimeType = mimeMatch?.[1] ?? "video/mp4";

        const res = await authFetch("/api/edit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            instruction: editText.trim(),
            sessionId,
            video: { mimeType, data: b64 },
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Upload edit failed");
        setEditText("");
        const list = await refreshTakes(sessionId);
        const newest = list[list.length - 1];
        if (newest) {
          addToSequence(newest.id);
          await selectTakePreview(newest.id);
        }
      } catch (e) {
        setError(formatApiError(e, "Omni upload edit failed"));
      } finally {
        endBusy("edit");
      }
      return;
    }

    beginBusy("edit", "Omni Flash editing selected take…");
    setError(null);
    try {
      const res = await authFetch("/api/edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instruction: editText.trim(),
          previousInteractionId: selected.interactionId,
          sessionId,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Edit failed");
      setEditText("");
      const list = await refreshTakes(sessionId);
      const newest = list[list.length - 1];
      if (newest) {
        addToSequence(newest.id);
        await selectTakePreview(newest.id);
      }
    } catch (e) {
      setError(formatApiError(e, "Edit failed"));
    } finally {
      endBusy("edit");
    }
  };

  const onUploadFiles = async (fileList: FileList | null) => {
    if (!sessionId || !fileList?.length || busyJobs.upload) return;
    const files = [...fileList].filter((f) => f.type.startsWith("video/"));
    if (files.length === 0) {
      setError("Choose one or more video files (mp4, webm, …).");
      return;
    }

    setError(null);
    beginBusy("upload", `Uploading ${files.length} file(s)…`);
    try {
      let lastTakeId: string | null = null;
      for (const file of files) {
        beginBusy("upload", `Uploading ${file.name}…`);
        const buf = new Uint8Array(await file.arrayBuffer());
        let binary = "";
        const chunk = 0x8000;
        for (let i = 0; i < buf.length; i += chunk) {
          binary += String.fromCharCode(
            ...buf.subarray(i, Math.min(i + chunk, buf.length)),
          );
        }
        const res = await authFetch(`/api/session/${sessionId}/takes`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            label: file.name,
            video: {
              mimeType: file.type || "video/mp4",
              data: btoa(binary),
            },
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error ?? `Upload failed: ${file.name}`);
        }
        lastTakeId = data.takeId as string;
        if (Array.isArray(data.takes)) {
          setTakes(data.takes as TakeSummary[]);
        }
      }
      await refreshTakes(sessionId);
      if (lastTakeId) {
        addToSequence(lastTakeId);
        await selectTakePreview(lastTakeId);
      }
    } catch (e) {
      setError(formatApiError(e, "Upload failed"));
    } finally {
      endBusy("upload");
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const downloadActive = () => {
    if (!previewUrl || !selected) return;
    const a = document.createElement("a");
    a.href = previewUrl;
    a.download = `take-${selected.kind}-${selected.id.slice(0, 8)}.mp4`;
    a.click();
  };

  const downloadSequenceClips = async () => {
    if (!sessionId || playFlatIds.length === 0 || busyJobs.download) return;
    beginBusy("download", "Preparing sequence downloads…");
    try {
      for (let i = 0; i < playFlatIds.length; i++) {
        const take = await ensureLoaded(sessionId, playFlatIds[i], {
          quiet: true,
        });
        const a = document.createElement("a");
        a.href = take.videoUrl;
        a.download = `shot-${String(i + 1).padStart(2, "0")}-${take.id.slice(0, 8)}.mp4`;
        a.click();
        await new Promise((r) => setTimeout(r, 350));
      }
    } catch (e) {
      setError(formatApiError(e, "Download failed"));
    } finally {
      endBusy("download");
    }
  };

  const sequenceRows = useMemo(() => {
    return sequence.map((shot) => {
      const members = shot.takeIds
        .map((id) => takes.find((t) => t.id === id) || loaded[id])
        .filter(Boolean) as TakeSummary[];
      const isMerge = shot.takeIds.length > 1;
      const label = isMerge
        ? `Merged (${shot.takeIds.length}) · ${members.map((m) => m.label).join(" → ")}`
        : (members[0]?.label ?? "Shot");
      return { shot, members, isMerge, label };
    });
  }, [sequence, takes, loaded]);

  return (
    <div className="editor">
      <header className="top">
        <div className="brand">
          <p className="title">Sequence Desk</p>
          <p className="tagline">
            {productTheme.name} · Multi-Shot Editor
          </p>
        </div>
        <nav className="nav">
          <Button asChild variant="outline" size="sm" className="back-btn">
            <Link
              href={
                sessionId ? `/?session=${encodeURIComponent(sessionId)}` : "/"
              }
              title={
                sessionId
                  ? "Return to Tutor with this session"
                  : "Return to Tutor"
              }
            >
              <ArrowLeftIcon data-icon="inline-start" />
              Back to Tutor
            </Link>
          </Button>
          {sessionId && (
            <span className="pill">Session {sessionId.slice(0, 8)}</span>
          )}
        </nav>
      </header>

      {!sessionId && !error && bootstrapped && !busyJobs.load && (
        <div className="empty">
          No active tutor session. Open the{" "}
          <Link href="/">Tutor</Link>, generate a video, then click{" "}
          <strong>Sequence</strong> in the sidebar so this page starts in that
          same session.
          {recentSessions.length > 0 && (
            <div className="row" style={{ marginTop: 12 }}>
              {recentSessions.slice(0, 4).map((entry) => (
                <Link
                  key={entry.id}
                  href={`/editor?session=${encodeURIComponent(entry.id)}`}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    textDecoration: "none",
                    background: "transparent",
                    color: "#cfd8e0",
                    border: "1px solid rgba(255, 255, 255, 0.14)",
                    borderRadius: 10,
                    padding: "10px 14px",
                    fontWeight: 600,
                    fontSize: 13,
                  }}
                >
                  Resume {entry.id.slice(0, 8)}…
                </Link>
              ))}
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="banner error" role="alert">
          {error}
          <button type="button" onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      )}
      {busyHints.length > 0 && (
        <div className="banner status" role="status">
          <div className="busy-stack">
            {busyHints.map((hint) => (
              <span key={hint}>{hint}</span>
            ))}
          </div>
        </div>
      )}

      {sessionId && (
        <div className="grid">
          <section className="panel">
            <h2>Preview</h2>
            <div
              className={`stage ${aspectRatio === "9:16" ? "portrait" : "landscape"}`}
            >
              {previewUrl ? (
                <video
                  ref={videoRef}
                  src={previewUrl}
                  controls
                  playsInline
                  onEnded={onClipEnded}
                />
              ) : (
                <p className="muted">Select a take to preview</p>
              )}
            </div>
            {playQueue && playQueue.length > 1 && (
              <p className="muted play-status">
                {activeMergedShot
                  ? `Merged playback · clip ${playIndex + 1} of ${playQueue.length}`
                  : `Sequence playback · clip ${playIndex + 1} of ${playQueue.length}`}
              </p>
            )}
            <div className="row">
              <button
                type="button"
                disabled={!previewUrl}
                onClick={downloadActive}
              >
                Download take
              </button>
              <button
                type="button"
                className="secondary"
                disabled={
                  Boolean(busyJobs.play) ||
                  !sequence.some((s) => s.takeIds.length > 1)
                }
                onClick={() => void playMergedOnly()}
                title="Load and play the active (or latest) merged group"
              >
                Play merged
              </button>
              <button
                type="button"
                disabled={
                  Boolean(busyJobs.export) ||
                  !sequence.some((s) => s.takeIds.length > 1)
                }
                onClick={() => void exportMergedMp4()}
                title="Concatenate merged clips into one MP4 on the server (ffmpeg)"
              >
                {busyJobs.export ? "Merging MP4…" : "Save merged MP4"}
              </button>
            </div>

            <h2 className="mt">
              {previewIsMergedExport
                ? "Omni-edit merged export"
                : "Continue edit on selected take"}
            </h2>
            <p className="muted">
              {previewIsMergedExport ? (
                <>
                  Merged preview is uploaded to Omni via the Files API (keep
                  total length ≤ ~10s). After this edit, further prompts use the
                  new interaction id.
                </>
              ) : (
                <>
                  Swap the ASL sign in this same clip (Omni cannot extend). Or
                  merge first — then edit the stitched export from this panel.
                </>
              )}
            </p>
            <textarea
              value={editText}
              disabled={
                (!previewIsMergedExport && !selected) || Boolean(busyJobs.edit)
              }
              onChange={(e) => setEditText(e.target.value)}
              placeholder={
                previewIsMergedExport
                  ? 'e.g. Have her sign ASL "hello" in this same clip.'
                  : selected
                    ? 'e.g. Have her sign ASL "I love you" in this same clip.'
                    : "Select a take, or merge clips first"
              }
              rows={3}
            />
            <button
              type="button"
              disabled={
                Boolean(busyJobs.edit) ||
                !editText.trim() ||
                (!previewIsMergedExport && !selected)
              }
              onClick={onContinueEdit}
              title={
                previewIsMergedExport
                  ? "Upload merged MP4 to Omni and apply edit"
                  : selected
                    ? `Edit take ${selected.id.slice(0, 8)}… via Omni`
                    : "Select a take or merge first"
              }
            >
              {previewIsMergedExport
                ? "Apply Omni edit to merge"
                : "Apply Omni edit"}
            </button>
            {previewIsMergedExport ? (
              <p className="muted" style={{ marginTop: 8 }}>
                Editing the stitched merge (not a single source take).
              </p>
            ) : selected ? (
              <p className="muted" style={{ marginTop: 8 }}>
                Editing take {selected.id.slice(0, 8)}… ({selected.kind})
              </p>
            ) : null}
          </section>

          <aside className="panel side">
            <h2>Recent takes</h2>
            <p className="muted">
              Click to select (preview, no autoplay). Right-click for merge /
              permanent delete
              {mergeSelection.length > 0
                ? ` · ${mergeSelection.length} queued`
                : ""}
              .
            </p>
            <div className="upload-bar">
              <input
                ref={fileInputRef}
                type="file"
                accept="video/mp4,video/webm,video/quicktime,video/*"
                multiple
                hidden
                onChange={(e) => void onUploadFiles(e.target.files)}
              />
              <button
                type="button"
                className="upload-btn"
                disabled={!sessionId || Boolean(busyJobs.upload)}
                onClick={() => fileInputRef.current?.click()}
                title="Upload local video files into this session"
              >
                <UploadIcon size={16} aria-hidden />
                {busyJobs.upload ? "Uploading…" : "Upload files"}
              </button>
            </div>
            {takes.length === 0 ? (
              <p className="muted">No videos yet — generate or upload files.</p>
            ) : (
              <ul className="takes">
                {takes.map((t, i) => {
                  const mergeIdx = mergeSelection.indexOf(t.id);
                  const forMerge = mergeIdx >= 0;
                  const isSelected = selectedId === t.id;
                  return (
                    <ContextMenu key={t.id}>
                      <ContextMenuTrigger asChild>
                        <li
                          className={[
                            isSelected ? "active" : "",
                            forMerge && !isSelected ? "for-merge" : "",
                          ]
                            .filter(Boolean)
                            .join(" ") || undefined}
                        >
                          <button
                            type="button"
                            className="take-main"
                            onClick={() => onSelectTake(t.id)}
                          >
                            <span className="idx">
                              {t.kind === "generate"
                                ? "Gen"
                                : t.kind === "upload"
                                  ? "Upload"
                                  : "Edit"}{" "}
                              {i + 1}
                              {forMerge ? ` · merge ${mergeIdx + 1}` : ""}
                            </span>
                            <span className="label">{t.label}</span>
                          </button>
                          <button
                            type="button"
                            className="ghost"
                            onClick={() => addToSequence(t.id)}
                          >
                            + Timeline
                          </button>
                        </li>
                      </ContextMenuTrigger>
                      <ContextMenuContent className="w-56">
                        <ContextMenuLabel>Take actions</ContextMenuLabel>
                        <ContextMenuSeparator />
                        <ContextMenuItem
                          onSelect={() => toggleMergeSelect(t.id)}
                        >
                          <ListPlusIcon />
                          {forMerge ? "Remove from merge queue" : "Queue for merge"}
                        </ContextMenuItem>
                        <ContextMenuItem
                          disabled={Boolean(busyJobs.merge)}
                          onSelect={() => void mergeTakeWithSelection(t.id)}
                        >
                          <CombineIcon />
                          Merge &amp; play
                          {mergeSelection.length + (forMerge ? 0 : 1) >= 2
                            ? ` (${Math.max(mergeSelection.length + (forMerge ? 0 : 1), 2)}+)`
                            : ""}
                        </ContextMenuItem>
                        <ContextMenuItem
                          onSelect={() => addToSequence(t.id)}
                        >
                          <ListPlusIcon />
                          Add to timeline
                        </ContextMenuItem>
                        <ContextMenuSeparator />
                        <ContextMenuItem
                          variant="destructive"
                          disabled={Boolean(busyJobs.delete)}
                          onSelect={() => void deleteTakesPermanently([t.id])}
                        >
                          <Trash2Icon />
                          Delete permanently
                        </ContextMenuItem>
                      </ContextMenuContent>
                    </ContextMenu>
                  );
                })}
              </ul>
            )}
            {mergeSelection.length > 0 && (
              <div className="row">
                <button
                  type="button"
                  disabled={
                    mergeSelection.length < 2 || Boolean(busyJobs.merge)
                  }
                  onClick={() => void mergeSelectedShots()}
                >
                  Merge {mergeSelection.length} & play
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setMergeSelection([])}
                >
                  Clear selection
                </button>
              </div>
            )}

            <h2 className="mt">Multi-shot timeline</h2>
            <p className="muted">
              Right-click a row to merge or permanently delete.{" "}
              <strong>Save merged MP4</strong> stitches clips on the server with
              ffmpeg.
            </p>
            {sequenceRows.length === 0 ? (
              <p className="muted">
                Add takes with “+ Timeline”, or right-click takes → Merge.
              </p>
            ) : (
              <ol className="timeline">
                {sequenceRows.map((row, i) => {
                  const isActive =
                    activeShotKey === row.shot.key ||
                    (!activeShotKey &&
                      selectedId != null &&
                      row.shot.takeIds.includes(selectedId));
                  const clipInMerge =
                    isActive &&
                    row.isMerge &&
                    playQueue &&
                    selectedId &&
                    row.shot.takeIds.includes(selectedId)
                      ? row.shot.takeIds.indexOf(selectedId) + 1
                      : null;
                  return (
                    <ContextMenu key={row.shot.key}>
                      <ContextMenuTrigger asChild>
                        <li
                          className={[
                            isActive ? "active" : "",
                            row.isMerge ? "merged" : "",
                          ]
                            .filter(Boolean)
                            .join(" ") || undefined}
                        >
                          <button
                            type="button"
                            className="shot-main"
                            onClick={() => void onSelectTimelineShot(row.shot)}
                            title={
                              row.isMerge
                                ? "Play merged clips back-to-back"
                                : "Play this take"
                            }
                          >
                            <span className="play-glyph" aria-hidden>
                              ▶
                            </span>{" "}
                            {i + 1}. {row.label}
                            {clipInMerge != null
                              ? ` · playing ${clipInMerge}/${row.shot.takeIds.length}`
                              : ""}
                          </button>
                          <span className="ops">
                            {row.isMerge && (
                              <button
                                type="button"
                                title="Save this group as one MP4"
                                disabled={Boolean(busyJobs.export)}
                                onClick={() =>
                                  void exportMergedMp4(row.shot.takeIds)
                                }
                              >
                                MP4
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => moveInSequence(row.shot.key, -1)}
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              onClick={() => moveInSequence(row.shot.key, 1)}
                            >
                              ↓
                            </button>
                            <button
                              type="button"
                              onClick={() => removeFromSequence(row.shot.key)}
                              title="Remove from timeline only"
                            >
                              ✕
                            </button>
                          </span>
                        </li>
                      </ContextMenuTrigger>
                      <ContextMenuContent className="w-56">
                        <ContextMenuLabel>
                          {row.isMerge ? "Merged shot" : "Timeline shot"}
                        </ContextMenuLabel>
                        <ContextMenuSeparator />
                        {row.isMerge ? (
                          <ContextMenuItem
                            disabled={Boolean(busyJobs.export)}
                            onSelect={() =>
                              void exportMergedMp4(row.shot.takeIds)
                            }
                          >
                            <CombineIcon />
                            Merge / save MP4
                          </ContextMenuItem>
                        ) : (
                          <ContextMenuItem
                            onSelect={() => {
                              const id = row.shot.takeIds[0];
                              if (id) toggleMergeSelect(id);
                            }}
                          >
                            <ListPlusIcon />
                            Queue take for merge
                          </ContextMenuItem>
                        )}
                        <ContextMenuItem
                          onSelect={() => removeFromSequence(row.shot.key)}
                        >
                          Remove from timeline
                        </ContextMenuItem>
                        <ContextMenuSeparator />
                        <ContextMenuItem
                          variant="destructive"
                          disabled={Boolean(busyJobs.delete)}
                          onSelect={() =>
                            void deleteTimelineShotPermanently(row.shot)
                          }
                        >
                          <Trash2Icon />
                          Delete permanently
                        </ContextMenuItem>
                      </ContextMenuContent>
                    </ContextMenu>
                  );
                })}
              </ol>
            )}
            <div className="row">
              <button
                type="button"
                className="secondary"
                disabled={!sessionId || Boolean(busyJobs.upload)}
                onClick={() => fileInputRef.current?.click()}
                title="Upload local video files"
              >
                Upload files
              </button>
              <button
                type="button"
                className="secondary"
                disabled={
                  !sequence.some((s) => s.takeIds.length > 1) ||
                  Boolean(busyJobs.play)
                }
                onClick={() => void playMergedOnly()}
              >
                Play merged
              </button>
              <button
                type="button"
                disabled={
                  !sequence.some((s) => s.takeIds.length > 1) ||
                  Boolean(busyJobs.export)
                }
                onClick={() => void exportMergedMp4()}
                title="Stitch active/latest merged group into one MP4"
              >
                {busyJobs.export ? "Merging MP4…" : "Save merged MP4"}
              </button>
              <button
                type="button"
                className="secondary"
                disabled={
                  mergeSelection.length < 2 || Boolean(busyJobs.merge)
                }
                onClick={() => void mergeSelectedShots()}
                title="Right-click takes above to select, then merge & play"
              >
                Merge & play
              </button>
              <button
                type="button"
                className="secondary"
                disabled={
                  playFlatIds.length === 0 || Boolean(busyJobs.download)
                }
                onClick={downloadSequenceClips}
              >
                Export shots
              </button>
            </div>
          </aside>
        </div>
      )}

      <style jsx>{`
        .editor {
          max-width: 1200px;
          margin: 0 auto;
          padding: 20px 14px 40px;
          padding-bottom: max(40px, env(safe-area-inset-bottom));
          display: flex;
          flex-direction: column;
          gap: 16px;
          width: 100%;
          min-width: 0;
          overflow-x: hidden;
          box-sizing: border-box;
        }
        .top {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          flex-wrap: wrap;
          align-items: flex-start;
        }
        .brand {
          min-width: 0;
          flex: 1 1 12rem;
        }
        /* Match Tutor header: Source Sans 3 · text-sm font-medium + text-xs muted */
        .title {
          margin: 0;
          font-family: var(--font-sans);
          font-size: 0.875rem; /* text-sm */
          line-height: 1.25rem;
          font-weight: 500; /* font-medium */
          color: var(--foreground);
        }
        .tagline {
          margin: 0;
          font-family: var(--font-sans);
          font-size: 0.75rem; /* text-xs */
          line-height: 1rem;
          font-weight: 400;
          color: var(--muted-foreground);
        }
        .sub {
          margin: 8px 0 0;
          color: #cfd8e0;
          max-width: 62ch;
          font-size: 14px;
          line-height: 1.45;
        }
        .nav {
          display: flex;
          gap: 8px;
          align-items: center;
          flex-wrap: wrap;
          max-width: 100%;
        }
        .back-btn {
          border-color: rgba(232, 165, 75, 0.45);
          background: rgba(232, 165, 75, 0.1);
          color: #f0c27a;
        }
        .back-btn:hover {
          background: rgba(232, 165, 75, 0.18);
          color: #ffd9a0;
        }
        .pill {
          font-size: 12px;
          padding: 6px 10px;
          border-radius: 999px;
          border: 1px solid rgba(255, 255, 255, 0.12);
          color: #cfd8e0;
          max-width: 100%;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .empty,
        .banner {
          padding: 12px 14px;
          border-radius: 12px;
          border: 1px solid rgba(255, 255, 255, 0.1);
          background: rgba(15, 21, 26, 0.85);
          min-width: 0;
          overflow-wrap: anywhere;
        }
        .banner {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          align-items: flex-start;
          flex-wrap: wrap;
        }
        .busy-stack {
          display: flex;
          flex-direction: column;
          gap: 4px;
          min-width: 0;
        }
        .banner.error {
          background: rgba(180, 40, 40, 0.22);
          border-color: rgba(255, 120, 120, 0.45);
          color: #ffd0d0;
        }
        .banner.status {
          background: rgba(232, 165, 75, 0.12);
          border-color: rgba(232, 165, 75, 0.35);
          color: #f3e0c2;
        }
        .grid {
          display: grid;
          grid-template-columns: 1.2fr 0.9fr;
          gap: 18px;
          min-width: 0;
        }
        .panel {
          background: rgba(15, 21, 26, 0.85);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 18px;
          padding: 16px;
          min-width: 0;
          overflow: hidden;
        }
        h2 {
          margin: 0 0 10px;
          font-size: 15px;
        }
        .mt {
          margin-top: 22px;
        }
        .stage {
          background: #000;
          border-radius: 12px;
          overflow: hidden;
          display: grid;
          place-items: center;
          margin-bottom: 10px;
          margin-inline: auto;
          max-width: 100%;
        }
        .stage.landscape {
          width: 100%;
          aspect-ratio: 16 / 9;
          max-height: min(46svh, 420px);
        }
        .stage.portrait {
          width: min(100%, 360px);
          max-height: min(62svh, 560px);
          aspect-ratio: 9 / 16;
        }
        .stage video {
          width: 100%;
          height: 100%;
          object-fit: contain;
        }
        .muted {
          color: rgba(207, 216, 224, 0.7);
          font-size: 13px;
          margin: 0 0 10px;
          overflow-wrap: anywhere;
        }
        textarea {
          width: 100%;
          max-width: 100%;
          resize: vertical;
          background: rgba(0, 0, 0, 0.35);
          border: 1px solid rgba(255, 255, 255, 0.12);
          border-radius: 10px;
          padding: 10px 12px;
          color: #f4f6f8;
          font-size: 13px;
          margin-bottom: 8px;
          box-sizing: border-box;
        }
        button {
          background: #e8a54b;
          color: #0f151a;
          border: none;
          border-radius: 10px;
          padding: 10px 14px;
          font-weight: 600;
          cursor: pointer;
        }
        button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        button.secondary,
        button.ghost {
          background: transparent;
          color: #cfd8e0;
          border: 1px solid rgba(255, 255, 255, 0.14);
        }
        .row {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-top: 8px;
        }
        .row > button {
          flex: 1 1 auto;
          min-width: min(100%, 9.5rem);
        }
        .upload-bar {
          display: flex;
          width: 100%;
          margin: 4px 0 12px;
        }
        .upload-bar .upload-btn {
          flex: 1;
          width: 100%;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          min-height: 42px;
        }
        .takes,
        .timeline {
          list-style: none;
          margin: 0;
          padding: 0;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .takes li,
        .timeline li {
          display: flex;
          gap: 8px;
          align-items: stretch;
          justify-content: space-between;
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 12px;
          padding: 8px;
          background: rgba(0, 0, 0, 0.2);
          min-width: 0;
        }
        .takes li.active {
          border-color: rgba(232, 165, 75, 0.75);
          box-shadow: inset 0 0 0 1px rgba(232, 165, 75, 0.35);
          background: rgba(232, 165, 75, 0.1);
        }
        .takes li.for-merge {
          border-style: dashed;
          border-color: rgba(120, 200, 255, 0.4);
        }
        .timeline li.active {
          border-color: rgba(232, 165, 75, 0.75);
          box-shadow: inset 0 0 0 1px rgba(232, 165, 75, 0.35);
          background: rgba(232, 165, 75, 0.1);
        }
        .timeline li.merged:not(.active) {
          border-color: rgba(120, 200, 255, 0.35);
          background: rgba(80, 140, 180, 0.12);
        }
        .take-main,
        .shot-main {
          flex: 1;
          min-width: 0;
          text-align: left;
          background: transparent;
          color: #f4f6f8;
          display: flex;
          flex-direction: column;
          gap: 4px;
          padding: 6px;
        }
        .shot-main {
          font-size: 13px;
          color: #cfd8e0;
          font-weight: 500;
          flex-direction: row;
          align-items: flex-start;
          gap: 8px;
        }
        .play-glyph {
          color: #e8a54b;
          flex-shrink: 0;
          line-height: 1.35;
        }
        .play-status {
          margin-top: 8px;
          color: #e8a54b;
        }
        .idx {
          font-size: 11px;
          color: #e8a54b;
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }
        .label {
          font-size: 13px;
          line-height: 1.35;
          overflow-wrap: anywhere;
          word-break: break-word;
        }
        .ops {
          display: flex;
          flex-wrap: wrap;
          gap: 4px;
          flex-shrink: 0;
          align-content: flex-start;
        }
        .ops button {
          padding: 6px 8px;
          background: transparent;
          color: #cfd8e0;
          border: 1px solid rgba(255, 255, 255, 0.12);
        }
        @media (max-width: 900px) {
          .grid {
            grid-template-columns: 1fr;
          }
          .editor {
            padding: 16px 12px 36px;
            padding-bottom: max(36px, env(safe-area-inset-bottom));
          }
          .panel {
            padding: 12px;
            border-radius: 14px;
          }
          .takes li,
          .timeline li {
            flex-wrap: wrap;
          }
          .takes li > .ghost,
          .timeline li > .ops {
            width: 100%;
            justify-content: flex-end;
          }
          .row > button {
            min-width: calc(50% - 4px);
          }
        }
        @media (max-width: 420px) {
          .row > button {
            min-width: 100%;
          }
          .nav :global(.back-btn) {
            font-size: 12px;
          }
        }
      `}</style>
    </div>
  );
}
