import { spawn } from "child_process";
import { randomUUID } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { findTakeVideo } from "./takes";
import { getSession } from "./session";

function extForMime(mimeType: string): string {
  if (mimeType.includes("webm")) return "webm";
  if (mimeType.includes("quicktime")) return "mov";
  return "mp4";
}

function normalizeBase64(data: string): Buffer {
  const idx = data.indexOf("base64,");
  const b64 = idx !== -1 ? data.slice(idx + "base64,".length) : data;
  return Buffer.from(b64, "base64");
}

/** Prefer cwd path so Next bundling cannot break ffmpeg-static's __dirname. */
function resolveFfmpegPath(): string {
  const candidates: string[] = [];

  if (process.env.FFMPEG_BIN) candidates.push(process.env.FFMPEG_BIN);

  candidates.push(
    path.join(
      process.cwd(),
      "node_modules",
      "ffmpeg-static",
      process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg",
    ),
  );

  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }
  return "ffmpeg";
}

function runFfmpeg(args: string[], cwd: string): Promise<void> {
  const bin = resolveFfmpegPath();
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      cwd,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (err) => {
      reject(
        new Error(
          `Failed to start ffmpeg at "${bin}": ${err.message}. Run: npm i ffmpeg-static`,
        ),
      );
    });
    child.on("close", (code) => {
      if (code === 0) resolve();
      else {
        const tip = stderr.trim().split(/\r?\n/).slice(-15).join("\n");
        reject(new Error(`ffmpeg exited ${code}${tip ? `:\n${tip}` : ""}`));
      }
    });
  });
}

function rmDirSafe(dir: string) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

export type ServerMergeResult = {
  mimeType: "video/mp4";
  data: string;
  bytes: number;
  takeIds: string[];
  outputPath?: string;
};

/**
 * Concatenate session takes with local ffmpeg (ffmpeg-static) → one MP4.
 */
export async function mergeSessionTakes(opts: {
  sessionId: string;
  takeIds: string[];
  persist?: boolean;
}): Promise<ServerMergeResult> {
  const { sessionId, takeIds } = opts;
  const unique = [...new Set(takeIds.filter(Boolean))];
  if (unique.length < 2) {
    throw new Error("Need at least two takes to merge");
  }

  const session = getSession(sessionId);
  if (!session) throw new Error("Session not found");

  const clips: { buffer: Buffer; ext: string; id: string }[] = [];
  for (const id of unique) {
    const video = findTakeVideo(session, id);
    if (!video?.data) {
      throw new Error(`Take ${id.slice(0, 8)}… has no video on the server`);
    }
    clips.push({
      id,
      buffer: normalizeBase64(video.data),
      ext: extForMime(video.mimeType),
    });
  }

  const workDir = path.join(os.tmpdir(), `motiondesk-merge-${randomUUID()}`);
  fs.mkdirSync(workDir, { recursive: true });

  try {
    const listLines: string[] = [];
    for (let i = 0; i < clips.length; i++) {
      const name = `in${i}.${clips[i].ext}`;
      fs.writeFileSync(path.join(workDir, name), clips[i].buffer);
      listLines.push(`file '${name.replace(/'/g, "'\\''")}'`);
    }
    fs.writeFileSync(
      path.join(workDir, "list.txt"),
      listLines.join("\n"),
      "utf8",
    );

    const outName = "merged.mp4";
    const outPath = path.join(workDir, outName);

    // Omni clips are usually video-only; encode without requiring audio.
    await runFfmpeg(
      [
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        "list.txt",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "23",
        "-pix_fmt",
        "yuv420p",
        "-an",
        "-movflags",
        "+faststart",
        outName,
      ],
      workDir,
    );

    if (!fs.existsSync(outPath)) {
      throw new Error("ffmpeg produced no output file");
    }

    const buffer = fs.readFileSync(outPath);
    let persisted: string | undefined;

    if (opts.persist !== false) {
      try {
        const mergeRoot =
          process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME
            ? path.join(os.tmpdir(), "motiondesk", "merges")
            : path.join(process.cwd(), ".data", "merges");
        const mergesDir = path.join(mergeRoot, sessionId);
        fs.mkdirSync(mergesDir, { recursive: true });
        const fileName = `merged-${Date.now()}-${unique.length}clips.mp4`;
        persisted = path.join(mergesDir, fileName);
        fs.copyFileSync(outPath, persisted);
      } catch (err) {
        console.warn("[merge] disk persist skipped:", err);
      }
    }

    return {
      mimeType: "video/mp4",
      data: buffer.toString("base64"),
      bytes: buffer.byteLength,
      takeIds: unique,
      outputPath: persisted,
    };
  } finally {
    rmDirSafe(workDir);
  }
}
