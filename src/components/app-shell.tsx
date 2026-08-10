import { AtlasAssistant } from "@/components/atlas-assistant";
import { api } from "@/convex/_generated/api";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/atlas-ui";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarSeparator,
} from "@/components/ui/sidebar";
import { useAction, useMutation, useQuery } from "convex/react";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  Brain,
  Cable,
  Database,
  Landmark,
  LayoutGrid,
  Layers,
  LogOut,
  MessageSquareText,
  Radar,
  ScrollText,
  Settings2,
  Sparkles,
  Target,
  TrendingUp,
  Users,
  Workflow,
  Zap,
} from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { NavLink, Navigate, useLocation, useNavigate } from "react-router";

const NAV_SECTIONS: Array<{
  label: string;
  items: Array<{
    to: string;
    label: string;
    icon: LucideIcon;
    badge?: "open";
  }>;
}> = [
  {
    label: "Operate",
    items: [
      { to: "/dashboard", label: "Atlas Home", icon: LayoutGrid },
      { to: "/dashboard/ask", label: "Ask Atlas", icon: MessageSquareText },
      { to: "/dashboard/actions", label: "Actions", icon: Zap },
    ],
  },
  {
    label: "Company knowledge",
    items: [
      { to: "/dashboard/knowledge", label: "Knowledge", icon: Database },
      { to: "/dashboard/connections", label: "Connections", icon: Cable },
      { to: "/dashboard/intelligence", label: "Intelligence", icon: Layers },
      { to: "/dashboard/brain", label: "Business Brain", icon: Brain },
    ],
  },
  {
    label: "Industry verticals",
    items: [
      {
        to: "/dashboard/revenue-recovery",
        label: "Revenue Recovery",
        icon: TrendingUp,
      },
    ],
  },
  {
    label: "Signals & audit",
    items: [
      {
        to: "/dashboard/recommendations",
        label: "Recommendations",
        icon: Target,
        badge: "open",
      },
      { to: "/dashboard/events", label: "Events", icon: Activity },
      { to: "/dashboard/audit", label: "Activity / Audit", icon: ScrollText },
    ],
  },
  {
    label: "Automation",
    items: [{ to: "/dashboard/workflows", label: "Workflows", icon: Workflow }],
  },
  {
    label: "Workspace",
    items: [
      { to: "/dashboard/team", label: "Team", icon: Users },
      { to: "/dashboard/settings", label: "Settings", icon: Settings2 },
    ],
  },
];

const PAGE_TITLES: Record<string, string> = {
  "/dashboard": "Atlas Home",
  "/dashboard/ask": "Ask Atlas",
  "/dashboard/knowledge": "Knowledge Base",
  "/dashboard/intelligence": "Intelligence Model",
  "/dashboard/brain": "Business Brain",
  "/dashboard/recommendations": "Recommendation Center",
  "/dashboard/connections": "Connections",
  "/dashboard/actions": "Actions & Tools",
  "/dashboard/events": "Events",
  "/dashboard/workflows": "Workflows",
  "/dashboard/revenue-recovery": "Revenue Recovery",
  "/dashboard/revenue-recovery/:id": "Claim Package",
  "/dashboard/team": "Team",
  "/dashboard/audit": "Activity / Audit",
  "/dashboard/settings": "Workspace Settings",
};

function initials(name?: string | null, email?: string | null): string {
  const src = name ?? email ?? "?";
  return (
    src
      .split(/[\s@.]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase())
      .join("") || "?"
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const workspace = useQuery(api.tenants.getMyWorkspace);
  // recommendationCounts calls requireTenant server-side, which throws for
  // signed-in users who don't have a workspace yet (fresh sign-in before
  // /setup completes). Subscribe only once a workspace actually exists; the
  // loading/null early returns below would otherwise still run this query.
  const recCounts = useQuery(
    api.recommendations.recommendationCounts,
    workspace ? undefined : "skip",
  );
  const seedIntelligence = useMutation(api.intelligence.seedIntelligence);
  const claimInvites = useMutation(api.tenants.claimInvites);
  const runDueSyncs = useAction(api.connectionsSync.runDueSyncs);

  // Idempotent: ensure the pack catalog exists, claim any invites, and let
  // background syncs pick up connected sources that are due for a refresh.
  useEffect(() => {
    void seedIntelligence();
    void claimInvites();
    void runDueSyncs().catch(() => {
      // background sync is best-effort
    });
  }, [seedIntelligence, claimInvites, runDueSyncs]);

  if (workspace === undefined) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex items-center gap-3 text-muted-foreground">
          <Radar className="size-5 animate-pulse text-teal-600 dark:text-teal-300" />
          <span className="text-sm">Loading workspace…</span>
        </div>
      </main>
    );
  }

  if (
    workspace === null ||
    workspace.profile === null ||
    workspace.profile.onboardingComplete !== true
  ) {
    return <Navigate to="/setup" replace />;
  }

  const openRecs = recCounts?.open ?? 0;
  const companyName =
    workspace.profile.companyName || workspace.tenant?.name || "Workspace";
  const memberRole = workspace.membership?.role;

  const handleSignOut = async () => {
    await signOut();
    navigate("/");
  };

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon" className="border-sidebar-border">
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                size="lg"
                asChild
                className="group/data-[slot=sidebar-menu-button]:h-12"
              >
                <NavLink to="/dashboard">
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-teal-400/15 text-teal-600 ring-1 ring-teal-400/30 dark:text-teal-300">
                    <Radar className="size-4" />
                  </div>
                  <div className="grid flex-1 text-left leading-tight">
                    <span className="truncate text-sm font-semibold">{companyName}</span>
                    <span className="truncate text-[11px] text-muted-foreground">
                      {memberRole ? `${memberRole} · Atlas workspace` : "Atlas workspace"}
                    </span>
                  </div>
                </NavLink>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>

        <SidebarContent>
          {NAV_SECTIONS.map((section) => (
            <SidebarGroup key={section.label}>
              <SidebarGroupLabel>{section.label}</SidebarGroupLabel>
              <SidebarMenu>
                {section.items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <SidebarMenuItem key={item.to}>
                      <SidebarMenuButton
                        asChild
                        isActive={
                          item.to === "/dashboard"
                            ? location.pathname === "/dashboard"
                            : location.pathname.startsWith(item.to)
                        }
                        tooltip={item.label}
                      >
                        <NavLink to={item.to}>
                          <Icon className="size-4" />
                          <span>{item.label}</span>
                        </NavLink>
                      </SidebarMenuButton>
                      {item.badge === "open" && openRecs > 0 && (
                        <SidebarMenuBadge className="font-mono text-[11px]">
                          {openRecs}
                        </SidebarMenuBadge>
                      )}
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroup>
          ))}
        </SidebarContent>

        <SidebarFooter>
          <SidebarSeparator className="mx-2" />
          <SidebarMenu>
            <SidebarMenuItem>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <SidebarMenuButton
                    size="lg"
                    className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
                  >
                    <Avatar className="size-8 rounded-lg">
                      {user?.image && <AvatarImage src={user.image} alt="" />}
                      <AvatarFallback className="rounded-lg bg-teal-400/15 text-xs text-teal-600 dark:text-teal-300">
                        {initials(user?.name, user?.email)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="grid flex-1 text-left leading-tight">
                      <span className="truncate text-sm font-medium">
                        {user?.name ?? "Atlas user"}
                      </span>
                      <span className="truncate text-[11px] text-muted-foreground">
                        {user?.email ?? ""}
                      </span>
                    </div>
                  </SidebarMenuButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  side="top"
                  align="end"
                  sideOffset={8}
                  className="w-56 rounded-xl"
                >
                  <DropdownMenuLabel className="font-normal">
                    <p className="text-sm font-medium">{user?.name ?? "Atlas user"}</p>
                    <p className="text-xs text-muted-foreground">{user?.email ?? ""}</p>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => navigate("/")} className="cursor-pointer">
                    <Landmark className="mr-2 size-4" />
                    Landing page
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={handleSignOut}
                    className="cursor-pointer text-destructive focus:text-destructive"
                  >
                    <LogOut className="mr-2 size-4" />
                    Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>

      <SidebarInset>
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border/60 px-4">
          <SidebarTrigger className="-ml-1" />
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-foreground">
              {PAGE_TITLES[location.pathname] ?? "Atlas"}
            </span>
            {openRecs > 0 && (
              <Badge
                variant="outline"
                className="hidden gap-1 border-amber-400/30 bg-amber-400/10 font-mono text-[10px] text-amber-600 dark:text-amber-300 sm:inline-flex"
              >
                <Sparkles className="size-3" />
                {openRecs} open signal{openRecs === 1 ? "" : "s"}
              </Badge>
            )}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
            <Button
              size="sm"
              className="hidden gap-2 md:inline-flex"
              onClick={() => navigate("/dashboard/ask")}
            >
              <MessageSquareText className="size-3.5" />
              Ask Atlas
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="hidden gap-2 md:inline-flex"
              onClick={() => navigate("/dashboard/knowledge")}
            >
              <Database className="size-3.5 text-teal-600 dark:text-teal-300" />
              Upload
            </Button>
          </div>
        </header>
        <main className="atlas-scroll flex-1 overflow-y-auto">
          <div className={cn("mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8")}>
            {children}
          </div>
        </main>
      </SidebarInset>

      {/* Phase 10 — persistent Atlas assistant, available across the app. */}
      <AtlasAssistant pageContext={location.pathname} />
    </SidebarProvider>
  );
}
