import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";

import { supabase } from "./client";

type Membership = {
  restaurant_id: string;
  role: "owner" | "manager" | "staff";
  permissions: Record<string, boolean>;
};

type AuthState = {
  session: Session | null;
  user: User | null;
  memberships: Membership[];
  loading: boolean;
  // memberships load in a second round-trip after session resolves —
  // loading goes false as soon as the session itself is known, so a
  // permission check right after that would see an empty memberships
  // array and wrongly conclude "no access" for a beat. Route guards
  // need this to tell "still loading" apart from "genuinely none."
  membershipsLoading: boolean;
  // Memberships only ever refetched automatically on session change —
  // creating a brand-new restaurant (useCreateRestaurant) adds a
  // membership row without a new session, so callers that do that need
  // a way to pull it in immediately rather than waiting for a reload.
  refetchMemberships: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [loading, setLoading] = useState(true);
  const [membershipsLoading, setMembershipsLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  const loadMemberships = async (userId: string) => {
    setMembershipsLoading(true);
    // tenant_read's RLS policy scopes this to restaurants the caller
    // belongs to, not to the caller's own row — deliberately, since
    // the Admin tab's roster needs every teammate's row. That means
    // this query returns every member's row for a shared restaurant,
    // not just this user's own, so it must filter to their own user_id
    // explicitly — without this, whichever row happened to load first
    // for a shared restaurant_id (e.g. the owner's) would silently
    // stand in for this user's real role and permissions.
    const { data, error } = await supabase
      .from("memberships")
      .select("restaurant_id, role, permissions")
      .eq("user_id", userId);
    if (error) {
      console.error("failed to load memberships", error);
      setMembershipsLoading(false);
      return;
    }
    setMemberships(data ?? []);
    setMembershipsLoading(false);
  };

  useEffect(() => {
    if (!session) {
      setMemberships([]);
      setMembershipsLoading(false);
      return;
    }
    void loadMemberships(session.user.id);
  }, [session]);

  const refetchMemberships = async () => {
    if (!session) return;
    await loadMemberships(session.user.id);
  };

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error?.message ?? null };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider
      value={{
        session,
        user: session?.user ?? null,
        memberships,
        loading,
        membershipsLoading,
        refetchMemberships,
        signIn,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
