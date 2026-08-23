import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import type { EmailOtpType } from "@supabase/supabase-js";
import { UtensilsCrossed } from "lucide-react";

import { supabase } from "@/lib/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";

export const Route = createFileRoute("/set-password")({
  head: () => ({
    meta: [{ title: "Set your password · Shrinkline" }],
  }),
  component: SetPasswordPage,
});

// Same mark BrandLocationSwitcher uses in the sidebar header — kept
// consistent with the login page's own BrandMark rather than a second
// slightly-different copy, since these two pages are the only ones a
// signed-out visitor ever sees.
function BrandMark({ className = "h-12 w-12" }: { className?: string }) {
  return (
    <div
      className={`grid ${className} shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground shadow-soft`}
    >
      <UtensilsCrossed className="h-1/2 w-1/2" />
    </div>
  );
}

function SetPasswordPage() {
  const navigate = useNavigate();
  const params = new URLSearchParams(window.location.search);
  const tokenHash = params.get("token_hash");
  const otpType = params.get("type") as EmailOtpType | null;

  // Three stages: "confirm" (token_hash present, needs an explicit click
  // before we ever call verifyOtp — email security scanners prefetch
  // links, which would silently burn a one-time token on page load if we
  // verified automatically), "checking" (no token_hash, e.g. a direct
  // /set-password visit — fall back to checking for an existing session),
  // "ready" (session established, show the password form).
  const [stage, setStage] = useState<"confirm" | "checking" | "ready">(
    tokenHash && otpType ? "confirm" : "checking",
  );
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (stage !== "checking") return;
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        setStage("ready");
      } else {
        const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
          if (session) setStage("ready");
        });
        return () => listener.subscription.unsubscribe();
      }
    });
  }, [stage]);

  async function handleConfirm() {
    if (!tokenHash || !otpType) return;
    setConfirming(true);
    setConfirmError(null);
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: otpType });
    setConfirming(false);
    if (error) {
      setConfirmError(error.message);
      return;
    }
    setStage("ready");
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setSubmitting(true);
    const { error } = await supabase.auth.updateUser({ password });
    setSubmitting(false);
    if (error) {
      setError(error.message);
      return;
    }
    navigate({ to: "/" });
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-cream px-4 py-12">
      <div className="mb-8 flex flex-col items-center gap-2">
        <BrandMark />
        <span className="font-display text-2xl text-ink">Shrinkline</span>
        <span className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
          Owner Dashboard
        </span>
      </div>

      <Card className="w-full max-w-sm p-8 shadow-card">
        <h1 className="font-display text-2xl text-foreground">Set your password</h1>
        <p className="mt-1 text-sm text-muted-foreground">One more step before you're in.</p>

        {stage === "confirm" && (
          <div className="mt-6 space-y-4">
            <p className="text-sm text-muted-foreground">
              Click below to confirm it's you before setting a password.
            </p>
            {confirmError && (
              <Alert variant="destructive">
                <AlertDescription>{confirmError}</AlertDescription>
              </Alert>
            )}
            <Button className="w-full" disabled={confirming} onClick={handleConfirm}>
              {confirming ? "Confirming…" : "Confirm and continue"}
            </Button>
          </div>
        )}

        {stage === "checking" && (
          <p className="mt-6 text-sm text-muted-foreground">Verifying your link…</p>
        )}

        {stage === "ready" && (
          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="password">New password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="new-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm">Confirm password</Label>
              <Input
                id="confirm"
                type="password"
                autoComplete="new-password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </div>

            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? "Saving…" : "Set password & continue"}
            </Button>
          </form>
        )}
      </Card>
    </div>
  );
}
