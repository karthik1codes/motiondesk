"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  meta?: string;
};

type Props = {
  messages: ChatMessage[];
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
  placeholder?: string;
  suggestions?: readonly string[];
  footer?: ReactNode;
  className?: string;
};

export function DirectorChat({
  messages,
  value,
  onChange,
  onSubmit,
  disabled,
  placeholder = "Describe an edit…",
  suggestions = [],
  footer,
  className,
}: Props) {
  return (
    <div
      className={cn(
        "flex h-full min-h-0 flex-col gap-3 font-sans",
        className,
      )}
    >
      <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto overscroll-contain pr-1">
        {messages.length === 0 && (
          <p className="m-0 text-sm text-muted-foreground">
            Generate a video first, then keep talking — each message edits the
            same clip.
          </p>
        )}
        {messages.map((m) => (
          <div
            key={m.id}
            className={cn(
              "max-w-[92%] rounded-[14px] px-3 py-2.5 text-sm leading-snug",
              m.role === "user"
                ? "ml-auto rounded-br-sm border border-primary/35 bg-primary/15"
                : "mr-auto rounded-bl-sm border border-white/8 bg-white/4 text-muted-foreground",
            )}
          >
            <div className="whitespace-pre-wrap break-words">{m.text}</div>
            {m.meta ? (
              <div className="mt-1 text-xs text-muted-foreground/70">
                {m.meta}
              </div>
            ) : null}
          </div>
        ))}
      </div>

      {suggestions.length > 0 && (
        <div className="flex shrink-0 flex-wrap gap-1.5">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              disabled={disabled}
              onClick={() => onChange(s)}
              className="cursor-pointer rounded-md border border-border/70 bg-transparent px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground disabled:cursor-not-allowed disabled:opacity-50"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <form
        className="flex shrink-0 items-stretch gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
      >
        <input
          className="min-w-0 flex-1 rounded-lg border border-input bg-black/35 px-3.5 py-3 text-sm leading-snug text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-50"
          value={value}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
        <button
          type="submit"
          disabled={disabled}
          className="min-h-full cursor-pointer self-stretch rounded-lg border-none bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
        >
          Send
        </button>
      </form>
      {footer}
    </div>
  );
}
