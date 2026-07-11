"use client";

import {
  ClapperboardIcon,
  ImageIcon,
  MessageSquareIcon,
  XIcon,
} from "lucide-react";
import type { ChatMessage } from "@/components/DirectorChat";
import { DirectorChat } from "@/components/DirectorChat";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type BusyFlags = {
  seed?: boolean;
  video?: boolean;
  edit?: boolean;
};

type Props = {
  activeTab: string;
  onTabChange: (tab: string) => void;
  seedPrompt: string;
  onSeedPromptChange: (v: string) => void;
  motionPrompt: string;
  onMotionPromptChange: (v: string) => void;
  editText: string;
  onEditTextChange: (v: string) => void;
  messages: ChatMessage[];
  plannedEdits: string[];
  interactionId: string | null;
  /** Style / subject still for Omni reference_to_video */
  stylePreviewUrl: string | null;
  onStyleImagePick: (file: File | null) => void;
  /** Element-swap still attached to the next edit */
  swapPreviewUrl: string | null;
  onSwapImagePick: (file: File | null) => void;
  /** Per-action busy — other actions stay available in parallel. */
  busy: BusyFlags;
  onSeed: () => void;
  onGenerate: () => void;
  onEdit: () => void;
  className?: string;
};

function StillPicker(props: {
  label: string;
  hint: string;
  previewUrl: string | null;
  inputId: string;
  disabled?: boolean;
  onPick: (file: File | null) => void;
}) {
  return (
    <div className="rounded-xl border border-border/60 bg-black/25 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-medium text-foreground">{props.label}</p>
          <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
            {props.hint}
          </p>
        </div>
        {props.previewUrl && (
          <button
            type="button"
            disabled={props.disabled}
            onClick={() => props.onPick(null)}
            className="inline-flex size-7 shrink-0 items-center justify-center rounded-md border border-border/70 text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground disabled:opacity-50"
            title="Clear image"
          >
            <XIcon className="size-3.5" />
          </button>
        )}
      </div>
      <div className="mt-2 flex items-center gap-3">
        {props.previewUrl ? (
  // eslint-disable-next-line @next/next/no-img-element -- local data URL preview
          <img
            src={props.previewUrl}
            alt=""
            className="size-14 rounded-lg border border-border/50 object-cover"
          />
        ) : (
          <div className="flex size-14 items-center justify-center rounded-lg border border-dashed border-border/60 text-[10px] text-muted-foreground">
            No image
          </div>
        )}
        <label
          htmlFor={props.inputId}
          className={cn(
            "cursor-pointer rounded-md border border-border/70 bg-transparent px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
            props.disabled && "pointer-events-none opacity-50",
          )}
        >
          {props.previewUrl ? "Replace…" : "Upload…"}
        </label>
        <input
          id={props.inputId}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/*"
          className="sr-only"
          disabled={props.disabled}
          onChange={(e) => {
            const file = e.target.files?.[0] ?? null;
            props.onPick(file);
            e.target.value = "";
          }}
        />
      </div>
    </div>
  );
}

/** Seed / Animate / Edit controls — right-hand pipeline panel. */
export function DirectorPipelinePanel({
  activeTab,
  onTabChange,
  seedPrompt,
  onSeedPromptChange,
  motionPrompt,
  onMotionPromptChange,
  editText,
  onEditTextChange,
  messages,
  plannedEdits,
  interactionId,
  stylePreviewUrl,
  onStyleImagePick,
  swapPreviewUrl,
  onSwapImagePick,
  busy,
  onSeed,
  onGenerate,
  onEdit,
  className,
}: Props) {
  const hasStyle = Boolean(stylePreviewUrl);
  const hasSwap = Boolean(swapPreviewUrl);

  return (
    <section
      className={cn(
        "flex min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl border border-border/70 bg-card/80 font-sans max-lg:h-auto max-lg:overflow-visible lg:h-full",
        className,
      )}
    >
      <div className="shrink-0 space-y-0.5 border-b border-border/60 px-3 py-3 sm:px-4 sm:py-4">
        <p className="text-xs font-medium text-primary">Pipeline</p>
        <h2 className="text-sm font-semibold leading-tight text-foreground">
          Tutor the sign
        </h2>
        <p className="text-xs leading-snug text-muted-foreground">
          Seed → motion → style transfer &amp; element swaps · actions run in
          parallel
        </p>
      </div>

      <Tabs
        value={activeTab}
        onValueChange={onTabChange}
        className="flex min-h-0 min-w-0 flex-1 flex-col gap-0 overflow-hidden max-lg:overflow-visible"
      >
        <div className="shrink-0 border-b border-border/60 px-2 py-2.5 sm:px-3 sm:py-3">
          <TabsList className="grid h-auto w-full grid-cols-3 gap-1 bg-muted/60 p-1">
            <TabsTrigger
              value="seed"
              className="gap-1 px-1.5 py-2 text-xs font-medium sm:gap-1.5 sm:px-2 sm:py-2.5 sm:text-sm"
            >
              <ImageIcon className="size-3.5 shrink-0 sm:size-4" />
              Seed
            </TabsTrigger>
            <TabsTrigger
              value="animate"
              className="gap-1 px-1.5 py-2 text-xs font-medium sm:gap-1.5 sm:px-2 sm:py-2.5 sm:text-sm"
            >
              <ClapperboardIcon className="size-3.5 shrink-0 sm:size-4" />
              Animate
            </TabsTrigger>
            <TabsTrigger
              value="edit"
              className="gap-1 px-1.5 py-2 text-xs font-medium sm:gap-1.5 sm:px-2 sm:py-2.5 sm:text-sm"
            >
              <MessageSquareIcon className="size-3.5 shrink-0 sm:size-4" />
              Edit
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent
          value="seed"
          className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden data-[state=inactive]:hidden max-lg:overflow-visible"
        >
          <ScrollArea className="h-full min-h-0 flex-1 max-lg:h-auto max-lg:overflow-visible [&_[data-slot=scroll-area-viewport]]:max-lg:max-h-none">
            <div className="flex min-h-full flex-col space-y-3 p-3 pb-6 sm:p-4">
              <div>
                <h3 className="text-sm font-semibold leading-tight">
                  1 · Seed still
                </h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  NB2 Lite (`gemini-3.1-flash-lite-image`)
                </p>
              </div>
              <Textarea
                value={seedPrompt}
                onChange={(e) => onSeedPromptChange(e.target.value)}
                rows={6}
                className="min-h-[140px] flex-1 resize-y bg-black/35 text-sm leading-snug sm:min-h-[180px]"
              />
              <Button
                className="w-full text-sm font-medium"
                disabled={Boolean(busy.seed)}
                onClick={onSeed}
              >
                {busy.seed ? "Seeding…" : "Generate seed"}
              </Button>
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent
          value="animate"
          className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden data-[state=inactive]:hidden max-lg:overflow-visible"
        >
          <ScrollArea className="h-full min-h-0 flex-1 max-lg:h-auto max-lg:overflow-visible [&_[data-slot=scroll-area-viewport]]:max-lg:max-h-none">
            <div className="flex min-h-full flex-col space-y-3 p-3 pb-6 sm:p-4">
              <div>
                <h3 className="text-sm font-semibold leading-tight">
                  2 · Animate
                </h3>
                <p className="mt-1 text-xs leading-snug text-muted-foreground">
                  Motion prompt → Omni Flash. Optional style still enables{" "}
                  <code className="break-all text-[11px]">reference_to_video</code>.
                </p>
              </div>
              <Textarea
                value={motionPrompt}
                onChange={(e) => onMotionPromptChange(e.target.value)}
                rows={6}
                className="min-h-[140px] flex-1 resize-y bg-black/35 text-sm leading-snug sm:min-h-[180px]"
              />
              <StillPicker
                label="Style / subject reference"
                hint="Omni keeps the seed as the first frame and borrows look or materials from this still."
                previewUrl={stylePreviewUrl}
                inputId="style-ref-upload"
                disabled={Boolean(busy.video)}
                onPick={onStyleImagePick}
              />
              <Button
                className="w-full text-sm font-medium"
                disabled={Boolean(busy.video)}
                onClick={onGenerate}
              >
                {busy.video
                  ? "Generating…"
                  : hasStyle
                    ? "Generate with style transfer"
                    : "Generate video"}
              </Button>
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent
          value="edit"
          className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden data-[state=inactive]:hidden max-lg:overflow-visible"
        >
          <div className="shrink-0 space-y-1 border-b border-border/40 px-3 pt-3 pb-3 sm:px-4 sm:pt-4">
            <h3 className="text-sm font-semibold leading-tight">
              3 · Conversational edit
            </h3>
            <p className="text-xs leading-snug text-muted-foreground">
              Same Omni model · ASL sign chips swap the action in this clip
              (same duration — no extension) ·{" "}
              {interactionId ? "thread linked" : "generate a video first"}
            </p>
            <p className="hidden text-xs text-muted-foreground sm:block">
              Tap a chip to change the sign, or attach a still for an element
              swap. Keep lighting and camera consistent.
            </p>
          </div>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden p-3 pt-3 sm:p-4 max-lg:overflow-visible">
            <DirectorChat
              messages={messages}
              value={editText}
              onChange={onEditTextChange}
              onSubmit={onEdit}
              disabled={!interactionId || Boolean(busy.edit)}
              suggestions={plannedEdits}
              placeholder={
                interactionId
                  ? hasSwap
                    ? "e.g. Swap the shirt color to match this reference…"
                    : 'e.g. Have her sign ASL "thank you" in this same clip…'
                  : "Generate a video to unlock edits"
              }
              footer={
                <StillPicker
                  label="Element swap still"
                  hint="Optional. Sent with your next edit as an Omni image reference."
                  previewUrl={swapPreviewUrl}
                  inputId="swap-ref-upload"
                  disabled={!interactionId || Boolean(busy.edit)}
                  onPick={onSwapImagePick}
                />
              }
            />
          </div>
        </TabsContent>
      </Tabs>
    </section>
  );
}
