"use client";

import { useState, type ReactNode } from "react";
import { LogInIcon } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { productTheme } from "@/lib/theme";
import { Button } from "@/components/ui/button";

/**
 * Blocks the app until Google sign-in succeeds.
 * Sign-out returns the user here — editor stays visible (blurred) under glass.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const { user, loading, configured, signInWithGoogle } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const showGate = loading || !configured || !user;

  return (
    <div className="relative min-h-svh">
      <div
        className={
          showGate
            ? "pointer-events-none select-none"
            : undefined
        }
        aria-hidden={showGate || undefined}
      >
        {children}
      </div>

      {loading ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-2xl">
          <p className="text-sm text-zinc-300">Checking sign-in…</p>
        </div>
      ) : null}

      {!loading && !configured ? (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-black/50 px-6 text-center backdrop-blur-2xl">
          <h1 className="text-2xl font-semibold tracking-tight text-white">
            {productTheme.name}
          </h1>
          <p className="max-w-sm text-sm text-white/70">
            Firebase Auth is not configured on this build.
          </p>
        </div>
      ) : null}

      {!loading && configured && !user ? (
        <LoginGlassOverlay
          busy={busy}
          error={error}
          onSignIn={async () => {
            setError(null);
            setBusy(true);
            try {
              await signInWithGoogle();
            } catch (e) {
              setError(
                e instanceof Error
                  ? e.message
                  : "Could not sign in with Google",
              );
            } finally {
              setBusy(false);
            }
          }}
        />
      ) : null}
    </div>
  );
}

function LoginGlassOverlay({
  busy,
  error,
  onSignIn,
}: {
  busy: boolean;
  error: string | null;
  onSignIn: () => void | Promise<void>;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-hidden px-6">
      {/* Frosted glass that blurs the live editor underneath */}
      <div
        aria-hidden
        className="absolute inset-0 bg-white/10 backdrop-blur-2xl supports-backdrop-filter:bg-white/[0.12]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_30%_20%,_rgba(255,255,255,0.18),_transparent_50%),radial-gradient(ellipse_at_70%_85%,_rgba(255,255,255,0.08),_transparent_45%)]"
      />

      <div className="relative z-10 w-full max-w-sm overflow-hidden rounded-2xl border border-white/45 bg-white/20 px-8 py-10 shadow-[0_8px_40px_rgba(0,0,0,0.35)] backdrop-blur-xl supports-backdrop-filter:bg-white/25">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/80 to-transparent"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-gradient-to-br from-white/30 via-transparent to-white/5"
        />
        <div className="relative flex flex-col items-center gap-6 text-center">
          <div className="space-y-2">
            <h1 className="login-brand text-5xl sm:text-6xl">
              {productTheme.name}
            </h1>
            <p className="login-brand-tagline text-base sm:text-lg">
              {productTheme.tagline}
            </p>
          </div>
          <Button
            size="lg"
            disabled={busy}
            onClick={() => void onSignIn()}
            className="w-full gap-2"
          >
            <LogInIcon className="size-4" />
            {busy ? "Signing in…" : "Sign in with Google"}
          </Button>
          {error ? (
            <p className="text-xs text-red-200" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
