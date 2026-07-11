import type { CSSProperties } from "react";
import type { AspectRatio } from "@/lib/types";

const styles: Record<string, CSSProperties> = {
  wrap: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
    alignItems: "center",
  },
  video: {
    width: "100%",
    height: "100%",
    objectFit: "contain",
    background: "#000",
  },
  image: {
    width: "100%",
    height: "100%",
    objectFit: "contain",
  },
  empty: {
    color: "rgba(255,255,255,0.45)",
    fontSize: 14,
    textAlign: "center",
    padding: 24,
    maxWidth: 360,
    lineHeight: 1.5,
  },
  badge: {
    position: "absolute",
    top: 12,
    left: 12,
    fontSize: 11,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    background: "rgba(0,0,0,0.55)",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: 8,
    padding: "4px 8px",
    color: "#e8ecf0",
  },
};

function stageStyle(aspectRatio: AspectRatio): CSSProperties {
  const isPortrait = aspectRatio === "9:16";
  return {
    position: "relative",
    width: isPortrait ? "min(100%, 360px)" : "100%",
    maxHeight: isPortrait ? "min(72vh, 640px)" : undefined,
    aspectRatio: isPortrait ? "9 / 16" : "16 / 9",
    background:
      "radial-gradient(ellipse at 30% 20%, rgba(232,165,75,0.12), transparent 50%), #080c10",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 16,
    overflow: "hidden",
    display: "grid",
    placeItems: "center",
  };
}

type Props = {
  videoUrl: string | null;
  seedUrl: string | null;
  label?: string;
  aspectRatio?: AspectRatio;
};

export function VideoStage({
  videoUrl,
  seedUrl,
  label,
  aspectRatio = "16:9",
}: Props) {
  return (
    <div style={styles.wrap}>
      <div style={stageStyle(aspectRatio)}>
        {label ? <span style={styles.badge}>{label}</span> : null}
        {videoUrl ? (
          <video
            key={videoUrl}
            style={styles.video}
            src={videoUrl}
            controls
            autoPlay
            loop
            playsInline
          />
        ) : seedUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img style={styles.image} src={seedUrl} alt="Seed still" />
        ) : (
          <p style={styles.empty}>
            Seed a still with NB2 Lite, then animate it with Omni Flash. Edits
            stay on the same conversation thread.
          </p>
        )}
      </div>
    </div>
  );
}
