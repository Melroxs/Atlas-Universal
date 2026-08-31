import { AtlasAssistant } from "@/components/atlas-assistant";
import { useVoiceSession } from "@/components/voice-session";
import { CommandPalette } from "@/components/atlas-experience/CommandPalette";
import { AtlasContextProvider, useAtlasContext, type AtlasBreadcrumb } from "@/lib/atlas-experience/context";
import { useOnboarding } from "@/lib/atlas-experience/useOnboarding";
import type { AtlasReadinessState } from "@/lib/atlas-experience/onboarding";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";
import { canAccessMail, canAccessUserAdmin, isInternalRole } from "@/lib/auth/access-gate";
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
import { useAction, useMutation, useQuery } from "@/hooks/use-supabase";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  Brain,
  Building2,
  Cable,
  Calendar,
  ChevronRight,
  Database,
  Landmark,
  LayoutGrid,
  Layers,
  Lightbulb,
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
  Mail,
  FileText,
  Send,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { NavLink, Navigate, useLocation, useNavigate } from "react-router";

/**
 * Global ambient voice indicator — a small pill in the bottom-left corner
 * that shows the current voice session state. Visible even when the
 * floating assistant panel is closed.
 */
function GlobalVoiceIndicator() {
  const session = useVoiceSession();
  const isActive =
    session.ambientEnabled &&
    session.status !== "idle" &&
    session.status !== "unavailable" &&
    session.status !== "permission_required";

  if (!isActive) return null;

  const dotColor = (() => {
    switch (session.status) {
      case "listening_for_wake_word":
        return "bg-emerald-400";
      case "wake_detected":
        return "bg-amber-400 animate-pulse";
      case "listening_for_command":
        return "bg-rose-400 animate-pulse";
      case "thinking":
        return "bg-amber-400 animate-pulse";
      case "speaking":
        return "bg-teal-400 animate-pulse";
      case "interrupted":
        return "bg-slate-400";
      case "paused":
        return "bg-slate-400";
      case "error":
        return "bg-rose-500";
      default:
        return "bg-emerald-400";
    }
  })();

  const label = (() => {
    switch (session.status) {
      case "listening_for_wake_word":
        return "Listening";
      case "wake_detected":
        return "Yes?";
      case "listening_for_command":
        return "Listening…";
      case "thinking":
        return "Thinking…";
      case "speaking":
        return "Speaking…";
      case "interrupted":
        return "Stopped";
      case "paused":
        return "Paused";
      case "error":
        return "Error";
      default:
        return "Active";
    }
  })();

  return (
    <div className="fixed bottom-5 left-5 z-40">
      <div className="flex items-center gap-2 rounded-full border border-border/70 bg-background/90 px-3 py-1.5 text-[11px] font-medium text-muted-foreground shadow-sm backdrop-blur-sm">
        <span className={`size-1.5 rounded-full ${dotColor}`} />
        <span className="text-foreground">Atlas</span>
        <span className="text-muted-foreground">{label}</span>
      </div>
    </div>
  );
}

/**
 * Atlas Experience Navigation — organized around user work, not internal modules.
 *
 * Structure: Home / Work / Intelligence / Communication / Administration
 * Each section represents a dimension of the user's work, not a code module.
 */
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
    label: "Home",
    items: [
      { to: "/dashboard", label: "Atlas Home", icon: LayoutGrid },
    ],
  },
  {
    label: "Work",
    items: [
      {
        to: "/dashboard/revenue-recovery",
        label: "Revenue Recovery",
        icon: TrendingUp,
      },
      { to: "/dashboard/workflows", label: "Workflows", icon: Workflow },
      {
        to: "/dashboard/recommendations",
        label: "Recommendations",
        icon: Target,
        badge: "open",
      },
      { to: "/dashboard/actions", label: "Actions", icon: Zap },
    ],
  },
  {
    label: "Intelligence",
    items: [
      { to: "/dashboard/ask", label: "Ask Atlas", icon: MessageSquareText },
      { to: "/dashboard/intelligence", label: "Packs", icon: Layers },
      { to: "/dashboard/knowledge", label: "Knowledge", icon: Database },
      { to: "/dashboard/brain", label: "Business Brain", icon: Brain },
      { to: "/dashboard/events", label: "Events", icon: Activity },
    ],
  },
  {
    label: "Communication",
    items: [
      { to: "/dashboard/mail", label: "Atlas Mail", icon: Mail },
    ],
  },
  {
    label: "Administration",
    items: [
      { to: "/dashboard/connections", label: "Connections", icon: Cable },
      { to: "/dashboard/team", label: "Team", icon: Users },
      { to: "/dashboard/settings", label: "Settings", icon: Settings2 },
      { to: "/dashboard/audit", label: "Activity Log", icon: ScrollText },
      { to: "/dashboard/users", label: "Users & Access", icon: Users },
    ],
  },
];

/** Role gate per section — only Admin, Mail require special access. */
function isSectionVisible(label: string, role: string): boolean {
  const atlasRole = role as import("@/lib/auth/access-gate").AtlasRole;
  if (label === "Admin") return canAccessUserAdmin(atlasRole);
  if (label === "Communication") return canAccessMail(atlasRole);
  return true;
}

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
  "/dashboard/mail": "Atlas Mail",
  "/dashboard/mail/settings": "Mail Settings",
  "/dashboard/users": "Users & Access",
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

/**
 * Compute a time-aware greeting for Atlas Home.
 */
function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 5) return "Burning the midnight oil";
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  if (h < 21) return "Good evening";
  return "Working late";
}

/**
 * Atlas Header — a restrained, premium header containing workspace identity,
 * system health, navigation context, and quick access.
 */
function AtlasHeader({
  openRecs,
  companyName,
  role,
  isEntityFocused,
  entity,
  health,
}: {
  openRecs: number;
  companyName: string;
  role: string;
  isEntityFocused: boolean;
  entity: { type: string; name?: string } | null;
  health: { documents: number; entities: number; openSignals: number; pipelineActive: boolean };
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const pageTitle = PAGE_TITLES[location.pathname] ?? "Atlas";

  // Determine system health status
  const hasIssues = (health.pipelineActive) || openRecs > 3;
  const isHealthy = health.documents > 0 && !hasIssues;

  // Onboarding-aware system health label
  const readinessState = useOnboarding();
  const readinessLabel: Record<AtlasReadinessState, string> = {
    empty: "Needs data",
    processing: "Learning",
    ready_no_opportunities: "Online",
    opportunity_detected: "Opportunity found",
    investigating: "Monitoring",
    activated: "Online",
  };
  const systemLabel = readinessLabel[readinessState.state] ?? (isHealthy ? "Online" : hasIssues ? "Attention" : "Starting");

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border/60 px-4">
      <SidebarTrigger className="-ml-1" />

      {/* System health pulse — a subtle indicator showing Atlas is active */}
      <div className="flex items-center gap-2">
        <div
          className={`relative flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide transition-colors ${
            readinessState.state === "empty"
              ? "text-muted-foreground"
              : readinessState.state === "processing"
                ? "text-amber-600 dark:text-amber-400"
                : readinessState.state === "opportunity_detected"
                  ? "text-emerald-600 dark:text-emerald-400"
                  : isHealthy
                    ? "text-emerald-600 dark:text-emerald-400"
                    : hasIssues
                      ? "text-amber-600 dark:text-amber-400"
                      : "text-muted-foreground"
          }`}
        >
          <span className="relative flex size-1.5">
            <span
              className={`absolute inline-flex size-full rounded-full opacity-60 ${
                readinessState.state === "empty"
                  ? "bg-muted-foreground/40"
                  : readinessState.state === "processing"
                    ? "animate-pulse bg-amber-400"
                    : readinessState.state === "opportunity_detected"
                      ? "animate-ping bg-emerald-400"
                      : isHealthy
                        ? "animate-ping bg-emerald-400"
                        : hasIssues
                          ? "animate-pulse bg-amber-400"
                          : "bg-muted-foreground/40"
              }`}
            />
            <span
              className={`relative inline-flex size-1.5 rounded-full ${
                readinessState.state === "empty"
                  ? "bg-muted-foreground/40"
                  : readinessState.state === "processing"
                    ? "bg-amber-500"
                    : readinessState.state === "opportunity_detected"
                      ? "bg-emerald-500"
                      : isHealthy
                        ? "bg-emerald-500"
                        : hasIssues
                          ? "bg-amber-500"
                          : "bg-muted-foreground/40"
              }`}
            />
          </span>
          {systemLabel}
        </div>
      </div>

      {/* Breadcrumb trail — workspace → section → entity context */}
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <NavLink
          to="/dashboard"
          className="flex items-center gap-1 transition-colors hover:text-teal-600 dark:hover:text-teal-300"
        >
          <Radar className="size-3" />
          <span className="hidden sm:inline">{companyName}</span>
        </NavLink>
        {pageTitle !== "Atlas Home" && pageTitle !== "Atlas" && (
          <>
            <ChevronRight className="size-3 text-muted-foreground/40" />
            <span className="font-medium text-foreground/80">{pageTitle}</span>
          </>
        )}
        {entity?.name && (
          <>
            <ChevronRight className="size-3 text-muted-foreground/40" />
            <span className="max-w-[200px] truncate font-medium text-teal-600 dark:text-teal-300">
              {entity.name}
            </span>
          </>
        )}
      </div>

      {/* Attention indicator + quick actions */}
      <div className="ml-auto flex items-center gap-2">
        {openRecs > 0 && (
          <Badge
            variant="outline"
            className="hidden gap-1 border-amber-400/30 bg-amber-400/10 font-mono text-[10px] text-amber-600 dark:text-amber-300 sm:inline-flex"
          >
            <Sparkles className="size-3" />
            {openRecs} open signal{openRecs === 1 ? "" : "s"}
          </Badge>
        )}
        {/* Atlas Experience: Command Palette trigger */}
        <CommandPalette />
        <ThemeToggle />
        <Button
          size="sm"
          className="hidden gap-2 md:inline-flex"
          onClick={() => navigate("/dashboard/ask")}
        >
          <MessageSquareText className="size-3.5" />
          Ask Atlas
        </Button>
      </div>
    </header>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { user, signOut, role } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { entity, isEntityFocused, health, setHealth } = useAtlasContext();
  const workspace = useQuery(api.tenants.getMyWorkspace);
  // recommendationCounts calls requireTenant server-side, which throws for
  // signed-in users who don't have a workspace yet (fresh sign-in before
  // /setup completes). Subscribe only once a workspace actually exists; the
  // loading/null early returns below would otherwise still run this query.
  const recCounts = useQuery(
    api.recommendations.recommendationCounts,
    workspace ? undefined : "skip",
  );
  const docStats = useQuery(
    api.documents.documentStats,
    workspace ? undefined : "skip",
  );
  const entityStats = useQuery(
    api.knowledge.entityStats,
    workspace ? undefined : "skip",
  );
  const seedIntelligence = useMutation(api.intelligence.seedIntelligence);
  const claimInvites = useMutation(api.tenants.claimInvites);
  const runDueSyncs = useAction(api.connectionsSync.runDueSyncs);

  // Track whether we just claimed invites so invited users aren't redirected
  // to /setup before their workspace data loads.
  const [justClaimedInvites, setJustClaimedInvites] = useState(false);
  const hasClaimed = useRef(false);

  // Idempotent: ensure the pack catalog exists, claim any invites, and let
  // background syncs pick up connected sources that are due for a refresh.
  // Connections sync is optional infrastructure — a failure (edge function
  // not deployed, CORS, timeout) is logged once for diagnostics and NEVER
  // blocks the app.
  useEffect(() => {
    void seedIntelligence();
    void claimInvites().then((result) => {
      const claimed = (result as { claimed?: number })?.claimed ?? 0;
      if (claimed > 0 && !hasClaimed.current) {
        hasClaimed.current = true;
        setJustClaimedInvites(true);
        // Clear the flag after a short delay to allow workspace data to reload
        setTimeout(() => setJustClaimedInvites(false), 3000);
      }
    });
    void runDueSyncs().catch((e) => {
      console.warn(
        "[atlas] background connections sync unavailable (non-blocking):",
        e instanceof Error ? e.message : String(e),
      );
    });
  }, [seedIntelligence, claimInvites, runDueSyncs]);

  // Feed workspace health data into the Atlas Experience context so any
  // downstream component can access it without its own query subscriptions.
  useEffect(() => {
    setHealth({
      documents: docStats?.total ?? 0,
      entities: entityStats?.entities ?? 0,
      openSignals: recCounts?.open ?? 0,
      pipelineActive: (docStats?.processing ?? 0) > 0,
    });
  }, [docStats, entityStats, recCounts, setHealth]);

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

  // For invited users who just claimed their invite, allow a brief grace
  // period before enforcing the onboarding check (workspace data may not
  // have reloaded yet).
  if (!justClaimedInvites) {
    if (
      workspace === null ||
      workspace.profile === null ||
      workspace.profile.onboardingComplete !== true
    ) {
      return <Navigate to="/setup" replace />;
    }
  }

  const openRecs = recCounts?.open ?? 0;
  const companyName =
    (workspace?.profile?.companyName) || workspace?.tenant?.name || "Workspace";
  const memberRole = workspace?.membership?.role;

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
          {NAV_SECTIONS.filter((section) => isSectionVisible(section.label, role)).map((section) => (
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
        <AtlasHeader
          openRecs={openRecs}
          companyName={companyName}
          role={role}
          isEntityFocused={isEntityFocused}
          entity={entity}
          health={health}
        />
        <main className="atlas-scroll flex-1 overflow-y-auto">
          <div className={cn("mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8")}>
            {children}
          </div>
        </main>
      </SidebarInset>

      {/* Global ambient voice indicator — visible when ambient listening is
          active, even when the floating panel is closed. */}
      <GlobalVoiceIndicator />

      {/* Phase 10 — persistent Atlas assistant, available across the app. */}
      <AtlasAssistant pageContext={location.pathname} />
    </SidebarProvider>
  );
}

/**
 * AppShellWithProvider — wraps the authenticated shell with Atlas Experience
 * context so downstream components can access entity awareness.
 */
export function AppShellWithProvider({ children }: { children: ReactNode }) {
  return (
    <AtlasContextProvider>
      <AppShell>{children}</AppShell>
    </AtlasContextProvider>
  );
}
