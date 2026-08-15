import { Link, useRouterState } from "@tanstack/react-router";
import { ChevronRight, LogOut, UtensilsCrossed } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { hasAccess, useCurrentMembership, type PermissionKey } from "@/lib/permissions";
import {
  NAV_OVERVIEW,
  NAV_GROWTH,
  NAV_OPERATIONS,
  NAV_UNGATED,
  type NavItem,
} from "@/lib/nav-items";
import { useAuth } from "@/lib/supabase/auth-context";
import { useCurrentRestaurant } from "@/lib/restaurant-context";
import { useLanguage } from "@/lib/i18n/language-context";
import { LANGUAGES, type Language } from "@/lib/i18n/translations";

function visibleFor<T extends { permission: PermissionKey }>(
  items: T[],
  membership: ReturnType<typeof useCurrentMembership>,
): T[] {
  return items.filter((item) => hasAccess(membership, item.permission));
}

export function AppSidebar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isActive = (url: string) => (url === "/" ? pathname === "/" : pathname.startsWith(url));
  const membership = useCurrentMembership();
  const { setOpenMobile } = useSidebar();
  const { signOut } = useAuth();
  const { language, setLanguage, t } = useLanguage();
  const { restaurants, currentRestaurantId, currentRestaurant, setCurrentRestaurantId } =
    useCurrentRestaurant();

  const visibleOverview = visibleFor(NAV_OVERVIEW, membership);
  const visibleGrowth = visibleFor(NAV_GROWTH, membership);
  const visibleOperations = visibleFor(NAV_OPERATIONS, membership);

  const renderGroup = (label: string, items: (NavItem | (typeof NAV_UNGATED)[number])[]) => {
    if (items.length === 0) return null;
    return (
      <SidebarGroup>
        <SidebarGroupLabel className="px-3 text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground/70">
          {label}
        </SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            {items.map((item) => {
              const children =
                "children" in item ? visibleFor(item.children ?? [], membership) : [];
              if (children.length > 0) {
                const groupOpen = isActive(item.url) || children.some((c) => isActive(c.url));
                return (
                  <Collapsible key={item.url} defaultOpen={groupOpen} className="group/collapsible">
                    <SidebarMenuItem>
                      <CollapsibleTrigger asChild>
                        <SidebarMenuButton className="h-10 rounded-lg">
                          <item.icon className="h-[18px] w-[18px]" />
                          <span className="text-sm">{t.nav[item.titleKey]}</span>
                          <ChevronRight className="ml-auto h-4 w-4 shrink-0 transition-transform group-data-[state=open]/collapsible:rotate-90" />
                        </SidebarMenuButton>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <SidebarMenuSub>
                          {children.map((child) => (
                            <SidebarMenuSubItem key={child.url}>
                              <SidebarMenuSubButton asChild isActive={isActive(child.url)}>
                                <Link to={child.url} onClick={() => setOpenMobile(false)}>
                                  <child.icon className="h-4 w-4" />
                                  <span>{t.nav[child.titleKey]}</span>
                                </Link>
                              </SidebarMenuSubButton>
                            </SidebarMenuSubItem>
                          ))}
                        </SidebarMenuSub>
                      </CollapsibleContent>
                    </SidebarMenuItem>
                  </Collapsible>
                );
              }
              return (
                <SidebarMenuItem key={item.url}>
                  <SidebarMenuButton
                    asChild
                    isActive={isActive(item.url)}
                    className="h-10 rounded-lg data-[active=true]:bg-primary/10 data-[active=true]:text-primary data-[active=true]:font-medium"
                  >
                    <Link
                      to={item.url}
                      onClick={() => setOpenMobile(false)}
                      className="flex items-center gap-3"
                    >
                      <item.icon className="h-[18px] w-[18px]" />
                      <span className="text-sm">{t.nav[item.titleKey]}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    );
  };

  return (
    <Sidebar collapsible="icon" className="border-r border-sidebar-border">
      <SidebarHeader className="border-b border-sidebar-border px-4 py-5">
        <Link to="/" onClick={() => setOpenMobile(false)} className="flex items-center gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground shadow-soft">
            <UtensilsCrossed className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="truncate font-display text-base leading-tight">
              {currentRestaurant?.name ?? "Thrasher's Pub"}
            </div>
            <div className="truncate text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
              {t.sidebar.tagline}
            </div>
          </div>
        </Link>
      </SidebarHeader>
      <SidebarContent className="px-2 py-3">
        {renderGroup(t.navSection.overview, visibleOverview)}
        {renderGroup(t.navSection.growth, visibleGrowth)}
        {renderGroup(t.navSection.operations, [...visibleOperations, ...NAV_UNGATED])}
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border p-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-sidebar-accent"
            >
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-accent font-display text-sm text-accent-foreground">
                BS
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">Bali Singh</div>
                <div className="truncate text-[11px] capitalize text-muted-foreground">
                  {membership?.role ?? "…"} · {currentRestaurant?.name ?? "…"}
                </div>
              </div>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="top" className="w-56">
            {restaurants.length > 1 && (
              <>
                <DropdownMenuLabel className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                  {t.profile.restaurant}
                </DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={currentRestaurantId ?? ""}
                  onValueChange={(v) => setCurrentRestaurantId(v)}
                >
                  {restaurants.map((r) => (
                    <DropdownMenuRadioItem key={r.id} value={r.id}>
                      {r.name}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuLabel className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
              {t.profile.language}
            </DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={language}
              onValueChange={(v) => setLanguage(v as Language)}
            >
              {LANGUAGES.map((l) => (
                <DropdownMenuRadioItem key={l.code} value={l.code}>
                  {l.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => signOut()}
              className="gap-2 text-destructive focus:text-destructive"
            >
              <LogOut className="h-4 w-4" />
              {t.profile.logout}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
