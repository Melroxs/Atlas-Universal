// ---------------------------------------------------------------------------
// Atlas App Shell — Left sidebar navigation + experience area
//
// Layout:
//   ┌──────────┬────────────────────────────────────────────────────[...]
//   │ ● Atlas  │                                                    │
//   │          │                  EXPERIENCE AREA                    │
//   │ Nav      │                                                    │
//   │ Items    │                                                    │
//   │          │                                                    │
//   │ ──────── │                                                    │
//   │ Quick    │                                                    │
//   │ Actions  │                                                    │
//   │ ──────── │                                                    │
//   │ Ask      │                                                    │
//   │ Atlas    ├────────────────────────────────────────────────────┤
//   │ ⌘/      │  Ask Atlas...                              🎤  ➤  │
//   └──────────┴─────────────────────────────────────────────────────[...]
// ---------------------------------------------------------------------------

import { useVoiceSession } from "@/components/voice-session";
import { useVoice } from "@/hooks/use-voice";
import { useVoicePageContext, serializeVoicePageContext } from "@/components/voice-context-provider";
import { CommandPalette } from "@/components/atlas-experience/CommandPalette";
import { AtlasContextProvider, useAtlasContext } from "@/lib/atlas-experience/context";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";
import { canAccessPlatformAdmin } from "@/lib/auth/access-gate";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/atlas-ui";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarSeparator,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAction, useMutation, useQuery } from "@/hooks/use-supabase";
import {
  Activity,
  AlertTriangle,
  BookOpen,
  Cable,
  CheckSquare,
  ChevronRight,
  FileText,
  GitBranch,
  Globe,
  Home,
  Landmark,
  Lightbulb,
  LogOut,
  Mail,
  MessageSquare,
  Mic,
  MicOff,
  Network,
  Package,
  PieChart,
  Plus,
  Radar,
  Send,
  Search,
  SendHorizonal,
  Settings2,
  ShieldCheck,
  Sparkles,
  Users,
  Workflow,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { NavLink, Navigate, useLocation, useNavigate } from "react-router";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Navigation data
// ---------------------------------------------------------------------------

interface NavItem {
  title: string;
  subtitle: string;
  url: string;
  icon: React.ComponentType<{ className?: string }>;
}

const MAIN_NAV: NavItem[] = [
  {
    title: "Atlas Home",
    subtitle: "What matters right now",
    url: "/dashboard",
    icon: Home,
  },
  {
    title: "Revenue Recovery",
    subtitle: "Claims, packages & supplements",
    url: "/dashboard/revenue-recovery",
    icon: DollarIcon,
  },
  {
    title: "Workflows",
    subtitle: "Active workflows and tasks",
    url: "/dashboard/workflows",
    icon: Workflow,
  },
  {
    title: "Recommendations",
    subtitle: "Signals ranked by Atlas",
    url: "/dashboard/recommendations",
    icon: Lightbulb,
  },
  {
    title: "Intelligence Packs",
    subtitle: "Industry & regulatory knowledge",
    url: "/dashboard/intelligence",
    icon: Sparkles,
  },
  {
    title: "Knowledge Base",
    subtitle: "Documents, entities & graph",
    url: "/dashboard/knowledge",
    icon: BookOpen,
  },
  {
    title: "Events",
    subtitle: "System events and triggers",
    url: "/dashboard/events",
    icon: Activity,
  },
  {
    title: "Atlas Mail",
    subtitle: "Outreach and communication",
    url: "/dashboard/talk",
    icon: Mail,
  },
  {
    title: "Connections",
    subtitle: "External integrations",
    url: "/dashboard/connections",
    icon: Cable,
  },
  {
    title: "Team",
    subtitle: "Team members and roles",
    url: "/dashboard/team",
    icon: Users,
  },
  {
    title: "Settings",
    subtitle: "Workspace configuration",
    url: "/dashboard/settings",
    icon: Settings2,
  },
  {
    title: "Activity Log",
    subtitle: "System activity history",
    url: "/dashboard/audit",
    icon: Globe,
  },
];

const QUICK_ACTIONS: NavItem[] = [
  {
    title: "Upload Documents",
    subtitle: "Add documents to the knowledge base",
    url: "/dashboard/knowledge",
    icon: Plus,
  },
  {
    title: "Find Supplement Opportunities",
    subtitle: "Scan claims for potential revenue",
    url: "/dashboard/revenue-recovery",
    icon: Search,
  },
  {
    title: "Find Missing Revenue",
    subtitle: "What are we leaving on the table?",
    url: "/dashboard/recommendations",
    icon: AlertTriangle,
  },
  {
    title: "Build Claim Package",
    subtitle: "Assemble a professional claim package",
    url: "/dashboard/revenue-recovery",
    icon: Package,
  },
  {
    title: "Run Comparison Engine",
    subtitle: "Scan workspace for gaps and risks",
    url: "/dashboard/intelligence",
    icon: GitBranch,
  },
];

// ---------------------------------------------------------------------------
// Dollar icon component (for Revenue Recovery)
// ---------------------------------------------------------------------------

function DollarIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="1" x2="12" y2="23" />
      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// VoiceIndicator — living voice state as a visual pill below the input
// ---------------------------------------------------------------------------

function VoiceIndicator() {
  const session = useVoiceSession();
  const { status, ambientEnabled } = session;

  if (status === "idle" && !ambientEnabled) return null;

  const dotColor = (() => {
    switch (status) {
      case "listening_for_wake_word": return "bg-emerald-400";
      case "wake_detected": return "bg-amber-400 animate-pulse";
      case "listening_for_command":
      case "listening":
      case "transcribing": return "bg-rose-400 animate-pulse";
      case "thinking": return "bg-amber-400 animate-pulse";
      case "speaking": return "bg-teal-400 animate-pulse";
      case "interrupted": return "bg-slate-400";
      case "error": return "bg-rose-500";
      default: return "bg-emerald-400";
    }
  })();

  const label = (() => {
    switch (status) {
      case "listening_for_wake_word": return "Listening";
      case "wake_detected": return "Yes?";
      case "listening_for_command":
      case "listening": return "Listening…";
      case "transcribing": return "Hearing you…";
      case "thinking": return "Looking into that…";
      case "speaking": return "Atlas is speaking";
      case "interrupted": return "Stopped";
      case "error": return "Voice error";
      default: return ambientEnabled ? "Ambient mode" : "Active";
    }
  })();

  return (
    <div className="flex items-center justify-center gap-2 py-1.5 text-[11px] text-muted-foreground">
      <span className={`size-1.5 rounded-full ${dotColor}`} />
      <span>{label}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SidebarHeader — Atlas branding
// ---------------------------------------------------------------------------

function AtlasSidebarHeader() {
  return (
    <SidebarHeader className="p-3">
      <NavLink to="/dashboard" className="flex items-center gap-2.5 transition-opacity hover:opacity-80">
        <div className="flex size-8 items-center justify-center rounded-xl bg-teal-400/15 text-teal-600 ring-1 ring-teal-400/30 dark:text-teal-300">
          <Radar className="size-4" />
        </div>
        <div className="flex flex-col">
          <span className="text-sm font-semibold tracking-tight text-foreground">Atlas</span>
          <span className="text-[10px] text-muted-foreground/60">Intelligence Platform</span>
        </div>
      </NavLink>
    </SidebarHeader>
  );
}

// ---------------------------------------------------------------------------
// Navigation group — renders a list of NavItem with active state
// ---------------------------------------------------------------------------

function NavigationGroup({ items, label }: { items: NavItem[]; label?: string }) {
  const location = useLocation();

  return (
    <SidebarGroup>
      {label && <SidebarGroupLabel>{label}</SidebarGroupLabel>}
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => {
            const isActive = item.url === "/dashboard"
              ? location.pathname === "/dashboard" || location.pathname === "/dashboard/attention"
              : location.pathname.startsWith(item.url);

            return (
              <SidebarMenuItem key={item.url + item.title}>
                <SidebarMenuButton
                  asChild
                  isActive={isActive}
                  tooltip={item.title}
                  className="group"
                >
                  <NavLink to={item.url} className="flex items-center gap-2.5">
                    <item.icon className="size-4 shrink-0" />
                    <div className="flex flex-col min-w-0">
                      <span className="text-sm font-medium leading-tight truncate">{item.title}</span>
                      <span className="text-[10px] text-muted-foreground/60 leading-tight truncate">{item.subtitle}</span>
                    </div>
                  </NavLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

// ---------------------------------------------------------------------------
// Ask Atlas link in sidebar
// ---------------------------------------------------------------------------

function AskAtlasLink() {
  const location = useLocation();
  const isActive = location.pathname === "/dashboard/talk";

  return (
    <SidebarGroup>
      <SidebarGroupContent>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              isActive={isActive}
              tooltip="Ask Atlas anything"
              className="bg-teal-400/8 text-teal-700 hover:bg-teal-400/15 dark:text-teal-300 dark:hover:bg-teal-400/10 border border-teal-400/20"
            >
              <NavLink to="/dashboard/talk" className="flex items-center gap-2.5">
                <MessageSquare className="size-4 shrink-0" />
                <div className="flex flex-col min-w-0">
                  <span className="text-sm font-medium leading-tight">Ask Atlas</span>
                  <span className="text-[10px] text-teal-600/60 dark:text-teal-300/60 leading-tight">Talk or type anything</span>
                </div>
                <kbd className="ml-auto hidden rounded-md border border-teal-400/20 bg-teal-400/10 px-1.5 py-0.5 text-[9px] font-mono text-teal-600/70 dark:text-teal-300/70 group-hover:inline-fle[...]
                  ⌘/
                </kbd>
              </NavLink>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

// ---------------------------------------------------------------------------
// Atlas Sidebar — the complete left navigation
// ---------------------------------------------------------------------------

function AtlasSidebar() {
  return (
    <>
      <AtlasSidebarHeader />
      <SidebarContent className="scrollbar-thin">
        <NavigationGroup items={MAIN_NAV} />
        <SidebarSeparator />
        <NavigationGroup items={QUICK_ACTIONS} label="Quick Actions" />
        <SidebarSeparator />
        <AskAtlasLink />
      </SidebarContent>
    </>
  );
}

// ---------------------------------------------------------------------------
// Atlas Header — minimal top bar
// ---------------------------------------------------------------------------

function AtlasHeader({ role }: { role: string }) {
  const { user, signOut } = useAuth();
  const { health, entity } = useAtlasContext();
  const navigate = useNavigate();
  const { toggleSidebar } = useSidebar();

  const isHealthy = health.documents > 0;

  return (
    <header className="flex h-11 shrink-0 items-center gap-3 border-b border-border/30 bg-background/80 px-4 backdrop-blur-md">
      {/* Sidebar toggle */}
      <button
        type="button"
        onClick={toggleSidebar}
        className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
        title="Toggle sidebar"
      >
        <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
          <line x1="9" x2="9" y1="3" y2="21" />
        </svg>
      </button>

      {/* Status pulse */}
      <div className="flex items-center gap-1.5">
        <span className="relative flex size-1.5">
          <span
            className={cn(
              "absolute inline-flex size-full rounded-full opacity-60",
              isHealthy ? "animate-ping bg-emerald-400" : "bg-muted-foreground/40"
            )}
          />
          <span
            className={cn(
              "relative inline-flex size-1.5 rounded-full",
              isHealthy ? "bg-emerald-500" : "bg-muted-foreground/40"
            )}
          />
        </span>
        <span className="hidden text-[10px] text-muted-foreground/70 sm:inline">
          {isHealthy ? "active" : "initializing"}
        </span>
      </div>

      {/* Entity context */}
      {entity && entity.type !== "workspace" && (
        <div className="hidden items-center gap-1.5 rounded-full border border-teal-400/25 bg-teal-400/8 px-2 py-0.5 text-[10px] font-medium text-teal-600 dark:text-teal-300 sm:flex">
          <Radar className="size-2.5" />
          <span className="capitalize">{entity.type}</span>
          {entity.name && (
            <>
              <ChevronRight className="size-2" />
              <span className="max-w-[120px] truncate">{entity.name}</span>
            </>
          )}
        </div>
      )}

      {/* Right side */}
      <div className="ml-auto flex items-center gap-1.5">
        <CommandPalette />
        <ThemeToggle />

        {/* User menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-2 rounded-lg px-1.5 py-1 transition-colors hover:bg-muted/50">
              <Avatar className="size-6">
                {user?.image && <AvatarImage src={user.image} alt="" />}
                <AvatarFallback className="rounded-md bg-teal-400/15 text-[9px] text-teal-600 dark:text-teal-300">
                  {initials(user?.name, user?.email)}
                </AvatarFallback>
              </Avatar>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52 rounded-xl">
            <DropdownMenuLabel className="font-normal">
              <p className="text-sm font-medium">{user?.name ?? "Atlas user"}</p>
              <p className="text-xs text-muted-foreground">{user?.email ?? ""}</p>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => navigate("/dashboard/control")} className="cursor-pointer gap-2">
              <Radar className="size-3.5" /> Control
            </DropdownMenuItem>
            {canAccessPlatformAdmin(role as any) && (
              <DropdownMenuItem onClick={() => navigate("/dashboard/users")} className="cursor-pointer gap-2">
                <Globe className="size-3.5" /> Platform Admin
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => navigate("/")} className="cursor-pointer gap-2">
              <Landmark className="size-3.5" /> Landing page
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={async () => { await signOut(); navigate("/"); }}
              className="cursor-pointer gap-2 text-destructive focus:text-destructive"
            >
              <LogOut className="size-3.5" /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}

// ---------------------------------------------------------------------------
// Atlas Input Bar — conversational control at the bottom
// ---------------------------------------------------------------------------

function AtlasInputBar() {
  const navigate = useNavigate();
  const [input, setInput] = useState("");
  const session = useVoiceSession();
  const { entity } = useAtlasContext();
  const pageContext = useVoicePageContext();

  const busy = session.busy;
  const status = session.status;

  const voice = useVoice({
    onTranscript: (text) => setInput((prev) => (prev ? `${prev} ${text}` : text)),
    entityContext: entity?.id,
    pageContext: serializeVoicePageContext(pageContext),
  });

  const micActive = status === "listening" || status === "transcribing" || status === "listening_for_command";

  const handleSubmit = () => {
    const q = input.trim();
    if (!q) return;
    navigate(`/dashboard/talk?q=${encodeURIComponent(q)}`);
    setInput("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  // Context-aware placeholder
  const placeholder = (() => {
    if (busy) return "Atlas is thinking…";
    if (entity?.type === "claim") return `Ask about this claim…`;
    if (entity?.type === "knowledge") return `Ask about this document…`;
    return "Ask Atlas anything…";
  })();

  return (
    <div className="border-t border-border/30 bg-background/80 backdrop-blur-md">
      {/* Voice state indicator */}
      <VoiceIndicator />

      <div className="mx-auto flex max-w-2xl items-center gap-2.5 px-4 pb-3 pt-1">
        {/* Voice toggle */}
        <button
          type="button"
          onClick={() => voice.toggle()}
          title={micActive ? "Stop listening" : "Press to talk"}
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-full border transition-all duration-300",
            micActive
              ? "border-rose-400/50 bg-rose-500 text-white shadow-lg shadow-rose-500/25"
              : "border-border/50 bg-muted/20 text-muted-foreground hover:border-teal-400/40 hover:text-teal-600 dark:hover:text-teal-300"
          )}
        >
          {micActive ? <MicOff className="size-3.5" /> : <Mic className="size-3.5" />}
        </button>

        {/* Input */}
        <div className="relative flex-1">
          {voice.interim && micActive && (
            <p className="mb-1 px-1 text-[11px] italic text-muted-foreground">
              "{voice.interim}"
            </p>
          )}
          <div className="relative">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={placeholder}
              disabled={busy}
              className="h-9 w-full rounded-full border border-border/50 bg-card/40 pl-4 pr-10 text-sm text-foreground shadow-sm outline-none transition-all duration-200 placeholder:text-muted-fo[...]
            />
            <button
              type="button"
              onClick={handleSubmit}
              disabled={busy || !input.trim()}
              className="absolute right-1.5 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-full bg-teal-400 text-teal-950 transition-colors hover:bg-teal-300 disabled:op[...]
            >
              {busy ? (
                <div className="size-3 animate-spin rounded-full border-[1.5px] border-teal-950 border-t-transparent" />
              ) : (
                <Send className="size-3" />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AppShell — the authenticated Atlas layout with sidebar
// ---------------------------------------------------------------------------

export function AppShell({ children }: { children: ReactNode }) {
  const { user, role } = useAuth();
  const workspace = useQuery(api.tenants.getMyWorkspace);
  const seedIntelligence = useMutation(api.intelligence.seedIntelligence);
  const claimInvites = useMutation(api.tenants.claimInvites);
  const runDueSyncs = useAction(api.connectionsSync.runDueSyncs);

  const hasClaimedRef = useRef(false);
  const [justClaimed, setJustClaimed] = useState(false);

  useEffect(() => {
    void seedIntelligence();
    void claimInvites().then((result) => {
      const claimed = (result as { claimed?: number })?.claimed ?? 0;
      if (claimed > 0 && !hasClaimedRef.current) {
        hasClaimedRef.current = true;
        setJustClaimed(true);
        setTimeout(() => setJustClaimed(false), 3000);
      }
    });
    void runDueSyncs().catch(() => {});
  }, [seedIntelligence, claimInvites, runDueSyncs]);

  // Loading state
  if (workspace === undefined) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-teal-400/15 text-teal-600 ring-1 ring-teal-400/30 dark:text-teal-300">
            <Radar className="size-6 animate-pulse" />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">Atlas is preparing your workspace</p>
            <p className="mt-1 text-xs text-muted-foreground">Connecting to your intelligence layer…</p>
          </div>
        </div>
      </main>
    );
  }

  // Onboarding gate
  if (!justClaimed) {
    if (workspace === null || workspace.profile === null || workspace.profile.onboardingComplete !== true) {
      return <Navigate to="/setup" replace />;
    }
  }

  return (
    <SidebarProvider defaultOpen={true}>
      <Sidebar side="left" variant="sidebar" collapsible="offcanvas" className="border-r border-border/30">
        <AtlasSidebar />
      </Sidebar>

      <SidebarInset>
        <AtlasHeader role={role} />

        {/* Experience Area */}
        <main className="atlas-scroll flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
            {children}
          </div>
        </main>

        {/* Persistent Atlas Input */}
        <AtlasInputBar />
      </SidebarInset>
    </SidebarProvider>
  );
}

// ---------------------------------------------------------------------------
// AppShellWithProvider — wraps shell with Atlas Experience context
// ---------------------------------------------------------------------------

export function AppShellWithProvider({ children }: { children: ReactNode }) {
  return (
    <AtlasContextProvider>
      <AppShell>{children}</AppShell>
    </AtlasContextProvider>
  );
}
