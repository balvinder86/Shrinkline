import "@fontsource/fraunces/400.css";
import "@fontsource/fraunces/500.css";
import "@fontsource/fraunces/600.css";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { AuthProvider, useAuth } from "@/lib/supabase/auth-context";
import { RestaurantProvider } from "@/lib/restaurant-context";
import { LocationProvider } from "@/lib/location-context";
import { DateRangeProvider } from "@/lib/date-range-context";
import { LanguageProvider } from "@/lib/i18n/language-context";
import { useCurrentMembership, ROUTE_PERMISSION, PERMISSION_LABEL } from "@/lib/permissions";
import { canAccess, tierIsTheBlocker } from "@/lib/billing/tierGate";
import { useSubscription } from "@/lib/billing/queries";
import { ChatWidget } from "@/components/chat/ChatWidget";
import { ShieldOff, Lock } from "lucide-react";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Shrinkline · Owner Dashboard" },
      {
        name: "description",
        content: "Restaurant owner dashboard for sales, inventory, reviews, and operations.",
      },
      { name: "author", content: "Shrinkline" },
      { property: "og:title", content: "Shrinkline · Owner Dashboard" },
      {
        property: "og:description",
        content: "Restaurant owner dashboard for sales, inventory, reviews, and operations.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:title", content: "Shrinkline · Owner Dashboard" },
      {
        name: "twitter:description",
        content: "Restaurant owner dashboard for sales, inventory, reviews, and operations.",
      },
      {
        property: "og:image",
        content:
          "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/853b18c3-7d5c-4438-a3c8-51c47bbf311c/id-preview-adae2796--220ba5c0-f290-490d-9883-fee0eadbbd96.lovable.app-1782439183216.png",
      },
      {
        name: "twitter:image",
        content:
          "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/853b18c3-7d5c-4438-a3c8-51c47bbf311c/id-preview-adae2796--220ba5c0-f290-490d-9883-fee0eadbbd96.lovable.app-1782439183216.png",
      },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RestaurantProvider>
          <LocationProvider>
            <LanguageProvider>
              <DateRangeProvider>
                <AuthGate />
              </DateRangeProvider>
            </LanguageProvider>
          </LocationProvider>
        </RestaurantProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

function AuthGate() {
  const { session, loading } = useAuth();
  const router = useRouter();
  const pathname = router.state.location.pathname;
  const onLoginPage = pathname === "/login";
  // /set-password is reached via an invite/recovery link — the session
  // lands asynchronously as supabase-js parses tokens out of the URL
  // hash, so this route must never bounce to /login while that's in
  // flight, and must never auto-redirect to "/" once it lands either
  // (the user still needs to actually set a password).
  const onSetPasswordPage = pathname === "/set-password";

  useEffect(() => {
    if (loading) return;
    if (!session && !onLoginPage && !onSetPasswordPage) {
      router.navigate({ to: "/login" });
    } else if (session && onLoginPage) {
      router.navigate({ to: "/" });
    }
  }, [loading, session, onLoginPage, onSetPasswordPage]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  if (onLoginPage || onSetPasswordPage) {
    return <Outlet />;
  }

  if (!session) {
    // Redirect is in flight (useEffect above). Keep a SidebarProvider
    // mounted through this transitional render rather than tearing it
    // down here — session goes null (via the Supabase auth listener)
    // a render before router.navigate() actually swaps the route, and
    // dropping SidebarProvider in that gap raced against the still-
    // mounted page's SidebarTrigger reading useSidebar(), throwing.
    return (
      <SidebarProvider>
        <div className="flex min-h-screen w-full items-center justify-center bg-background">
          <p className="text-sm text-muted-foreground">Signing out…</p>
        </div>
      </SidebarProvider>
    );
  }

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full bg-background">
        <AppSidebar />
        <SidebarInset className="min-w-0 flex-1 bg-background">
          {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
          <RouteGuard pathname={pathname} />
        </SidebarInset>
      </div>
      {/* Mounted once here (not per-page) so its conversation state
          survives client-side navigation between pages — only present
          for authenticated users, never on the login page above. */}
      <ChatWidget />
    </SidebarProvider>
  );
}

// Hiding a sidebar link isn't a real access control — someone can
// still type the URL directly, so every gated route is checked here
// too, in the one shared layout every page renders inside of, rather
// than repeating this check in each of the 9 route files.
function RouteGuard({ pathname }: { pathname: string }) {
  const { membershipsLoading } = useAuth();
  const membership = useCurrentMembership();
  const { data: subscription, isLoading: subscriptionLoading } = useSubscription();
  const requiredPermission = ROUTE_PERMISSION[pathname];

  if (!requiredPermission) {
    return <Outlet />;
  }

  if (membershipsLoading || subscriptionLoading) {
    return null;
  }

  // Two independent gates, distinguished so the message actually
  // matches the real reason: hasAccess (permissions.ts) is "did an
  // owner grant you this," tierIsTheBlocker (billing/tierGate.ts) is
  // "does the restaurant's plan include this module" — a page can
  // fail the second without ever failing the first (e.g. the owner
  // themself, viewing a module their own plan doesn't cover).
  if (tierIsTheBlocker(membership, subscription ?? null, requiredPermission)) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="max-w-md text-center">
          <Lock className="mx-auto h-10 w-10 text-muted-foreground" />
          <h1 className="mt-4 text-xl font-semibold text-foreground">Not included in your plan</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {PERMISSION_LABEL[requiredPermission]} is part of Full Suite. Upgrade from Settings →
            Billing & plan to unlock it.
          </p>
        </div>
      </div>
    );
  }

  if (!canAccess(membership, subscription ?? null, requiredPermission)) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="max-w-md text-center">
          <ShieldOff className="mx-auto h-10 w-10 text-muted-foreground" />
          <h1 className="mt-4 text-xl font-semibold text-foreground">You don't have access</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Ask an owner to grant you access to this page from the Admin tab.
          </p>
        </div>
      </div>
    );
  }

  return <Outlet />;
}
