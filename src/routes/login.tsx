import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { Package, Receipt, TrendingUp, UtensilsCrossed } from "lucide-react";

import { useAuth } from "@/lib/supabase/auth-context";
import { supabase } from "@/lib/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [{ title: "Sign in · Shrinkline" }],
  }),
  component: LoginPage,
});

// Same three domains the sidebar's own nav groups things into
// (Stock & Purchasing, Invoices, Performance) — reused here as the
// three-line pitch rather than inventing new marketing copy.
const VALUE_PROPS = [
  { icon: Package, text: "Real-time inventory, par levels, and reorder suggestions" },
  { icon: Receipt, text: "Invoices and vendor spend, tracked automatically" },
  { icon: TrendingUp, text: "Live food cost and P&L, not a month-end guess" },
];

// The exact mark BrandLocationSwitcher uses in the sidebar header
// (rounded terracotta square, white UtensilsCrossed) — reused here
// rather than a new logo, so the first thing an owner sees matches the
// first thing they see once signed in.
function BrandMark({ className = "h-11 w-11" }: { className?: string }) {
  return (
    <div
      className={`grid ${className} shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground shadow-soft`}
    >
      <UtensilsCrossed className="h-1/2 w-1/2" />
    </div>
  );
}

function LoginPage() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "forgot">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const { error } = await signIn(email, password);
    setSubmitting(false);
    if (error) {
      setError(error);
      return;
    }
    navigate({ to: "/" });
  }

  async function handleReset(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setInfo(null);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/set-password`,
    });
    setSubmitting(false);
    if (error) {
      // A failed send (e.g. the email provider rejecting the recipient)
      // surfaces here as a 500 with no usable message field — supabase-js
      // then has nothing to show but "{}". Give a real fallback rather
      // than rendering that literal string.
      setError(
        error.message && error.message !== "{}"
          ? error.message
          : "We couldn't send that email right now. Please try again shortly, or contact support if it keeps happening.",
      );
      return;
    }
    setInfo("Check your email for a password reset link.");
  }

  return (
    <div className="min-h-screen bg-cream lg:grid lg:grid-cols-2">
      {/* Branded panel — desktop only; a compact header replaces this on mobile */}
      <div className="relative hidden flex-col justify-between overflow-hidden bg-ink px-12 py-12 text-cream lg:flex">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_15%,var(--terracotta)_0%,transparent_45%)] opacity-40" />
        <div className="relative flex items-center gap-3">
          <BrandMark />
          <span className="font-display text-2xl">Shrinkline</span>
        </div>
        <div className="relative space-y-7">
          <p className="font-display text-4xl leading-tight">
            Run the back of house
            <br />
            like it's front of mind.
          </p>
          <ul className="space-y-3">
            {VALUE_PROPS.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-start gap-3 text-sm text-cream/85">
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-terracotta-soft" />
                {text}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs uppercase tracking-[0.2em] text-cream/50">Owner Dashboard</p>
      </div>

      {/* Form panel */}
      <div className="flex min-h-screen flex-col items-center justify-center px-4 py-12">
        <div className="mb-8 flex flex-col items-center gap-2 lg:hidden">
          <BrandMark className="h-12 w-12" />
          <span className="font-display text-2xl text-ink">Shrinkline</span>
          <span className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
            Owner Dashboard
          </span>
        </div>

        <Card className="w-full max-w-sm p-8 shadow-card">
          <h1 className="font-display text-2xl text-foreground">
            {mode === "signin" ? "Welcome back" : "Reset password"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {mode === "signin"
              ? "Sign in to your dashboard"
              : "Enter your email and we'll send you a link to set a new password."}
          </p>

          {mode === "signin" ? (
            <form onSubmit={handleSubmit} className="mt-6 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>

              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? "Signing in…" : "Sign in"}
              </Button>

              <button
                type="button"
                className="w-full text-sm text-muted-foreground hover:text-foreground underline underline-offset-4"
                onClick={() => {
                  setMode("forgot");
                  setError(null);
                  setInfo(null);
                }}
              >
                Forgot password?
              </button>
            </form>
          ) : (
            <form onSubmit={handleReset} className="mt-6 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="reset-email">Email</Label>
                <Input
                  id="reset-email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>

              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              {info && (
                <Alert>
                  <AlertDescription>{info}</AlertDescription>
                </Alert>
              )}

              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? "Sending…" : "Send reset link"}
              </Button>

              <button
                type="button"
                className="w-full text-sm text-muted-foreground hover:text-foreground underline underline-offset-4"
                onClick={() => {
                  setMode("signin");
                  setError(null);
                  setInfo(null);
                }}
              >
                Back to sign in
              </button>
            </form>
          )}
        </Card>
      </div>
    </div>
  );
}
