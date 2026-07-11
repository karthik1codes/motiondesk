"use client";

import { useState, type ReactNode } from "react";
import { LogInIcon } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { productTheme } from "@/lib/theme";
import { Button } from "@/components/ui/button";

/**
 * Blocks the app until Google sign-in succeeds.
 * Sign-out returns the user here.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const { user, loading, configured, signInWithGoogle } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (loading) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-zinc-950 text-zinc-400">
        <p className="text-sm">Checking sign-in…</p>
      </div>
    );
  }

  if (!configured) {
    return (
      <div className="flex min-h-svh flex-col items-center justify-center gap-3 bg-zinc-950 px-6 text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-50">
          {productTheme.name}
        </h1>
        <p className="max-w-sm text-sm text-zinc-400">
          Firebase Auth is not configured on this build.
        </p>
      </div>
    );
  }

  if (!user) {
    const onSignIn = async () => {
      setError(null);
      setBusy(true);
      try {
        await signInWithGoogle();
      } catch (e) {
        setError(
          e instanceof Error ? e.message : "Could not sign in with Google",
        );
      } finally {
        setBusy(false);
      }
    };

    return (
      <div className="relative flex min-h-svh flex-col items-center justify-center overflow-hidden bg-zinc-950 px-6">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(63,63,70,0.45),_transparent_55%),radial-gradient(ellipse_at_bottom_right,_rgba(24,24,27,0.9),_transparent_50%)]"
        />
        <div className="relative z-10 flex w-full max-w-sm flex-col items-center gap-6 text-center">
          <div className="space-y-2">
            <h1 className="text-4xl font-semibold tracking-tight text-zinc-50 sm:text-5xl">
              {productTheme.name}
            </h1>
            <p className="text-sm text-zinc-400">{productTheme.tagline}</p>
          </div>
          <p className="text-sm text-zinc-500">
            Sign in with Google to open the tutor workspace.
          </p>
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
            <p className="text-xs text-red-400" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
