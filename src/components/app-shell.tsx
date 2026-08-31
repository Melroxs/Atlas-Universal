// ---------------------------------------------------------------------------
// Atlas App Shell — Intelligence-driven presentation layer
//
// Layout:
//   ┌──────────────────────────────────────────────────────────────┐
//   │ ● Atlas          [Home] [Attention] [Talk] ...   [search] 👤│
//   ├──────────────────────────────────────────────────────────────┤
//   │                                                              │
//   │                    EXPERIENCE AREA                           │
//   │                                                              │
//   │                                                              │
//   │                                                              │
//   ├──────────────────────────────────────────────────────────────┤
//   │  ● Listening     │  Ask Atlas about your business...    🎙  │
//   └──────────────────────────────────────────────────────────────┘
// ---------------------------------------------------------------------------

import { useVoiceSession } from "@/components/voice-session";
import { useVoice } from "@/hooks/use-voice";
import { CommandPalette } from "@/components/atlas-experience/CommandPalette";
import { AtlasContextProvider, useAtlasContext } from "@/lib/atlas-experience/context";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";
import { canAccessUserAdmin, canAccessPlatformAdmin } from "@/lib/auth/access-gate";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/atlas-ui";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
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
  Cable,
  ChevronRight,
  Database,
  Eye,
  Globe,
  Home,
  Landmark,
  LogOut,
  MessageSquareText,
  Mic,
  MicOff,
  Radar,
  Search,
  Send,
  Settings2,
  Sparkles,
  Target,
  TrendingUp,
  Users,
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
// Navigation structure — contextual, not module-based
// ---------------------------------------------------------------------------

interface NavItem {
  to: string;
  label: string;
  icon: typeof Radar;
  badgeCount?: number;
}

const PRIMARY_NAV: NavItem[] = [
  { to: "/dashboard", label: "Home", icon: Home },
  { to: "/dashboard/attention", label: "Attention", icon: Eye },
  { to: "/dashboard/talk", label: "Talk", icon: MessageSquareText },
];

const CONTEXTUAL_NAV: NavItem[] = [
  { to: "/dashboard/revenue-recovery", label: "Claims", icon: TrendingUp },
  { to: "/dashboard/recommendations", label: "Recommendations", icon: Target },
  { to: "/dashboard/knowledge", label: "Knowledge", icon: Database },
];

// ---------------------------------------------------------------------------
// VoiceStatePill — compact voice status indicator
// ---------------------------------------------------------------------------

function VoiceStatePill() {
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
      case "listening_for_command": return "Listening…";
      case "thinking": return "Thinking…";
      case "speaking": return "Speaking…";
      case "interrupted": return "Stopped";
      case "error": return "Voice error";
      default: return ambientEnabled ? "Ambient" : "Active";
    }
  })();

  return (
    <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
      <span className={`size-1.5 rounded-full ${dotColor}`} />
      <span className="hidden sm:inline">{label}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Atlas Header
// ---------------------------------------------------------------------------

function AtlasHeader({ openRecs, role }: { openRecs: number; role: string }) {
  const location = useLocation();
  const { user, signOut } = useAuth();
  const { entity, health } = useAtlasContext();
  const navigate = useNavigate();

  const isHealthy = health.documents > 0;
  const hasIssues = health.pipelineActive || openRecs > 3;

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border/40 bg-background/80 px-4 backdrop-blur-md">
      {/* Atlas identity */}
      <NavLink to="/dashboard" className="flex items-center gap-2 transition-opacity hover:opacity-80">
        <div className="flex size-7 items-center justify-center rounded-lg bg-teal-400/15 text-teal-600 ring-1 ring-teal-400/30 dark:text-teal-300">
          <Radar className="size-3.5" />
        </div>
        <span className="text-sm font-semibold tracking-tight text-foreground">Atlas</span>
      </NavLink>

      {/* Health pulse */}
      <div className="flex items-center gap-1.5">
        <span className="relative flex size-1.5">
          <span
            className={cn(
              "absolute inline-flex size-full rounded-full opacity-60",
              isHealthy ? "animate-ping bg-emerald-400" : hasIssues ? "animate-pulse bg-amber-400" : "bg-muted-foreground/40"
            )}
          />
          <span
            className={cn(
              "relative inline-flex size-1.5 rounded-full",
              isHealthy ? "bg-emerald-500" : hasIssues ? "bg-amber-500" : "bg-muted-foreground/40"
            )}
          />
        </span>
      </div>

      {/* Navigation — horizontal, contextual */}
      <nav className="ml-4 hidden items-center gap-1 md:flex">
        {PRIMARY_NAV.map((item) => {
          const Icon = item.icon;
          const isActive = item.to === "/dashboard"
            ? location.pathname === "/dashboard"
            : location.pathname.startsWith(item.to);
          return (
            <NavLink
              key={item.to}
              to={item.to}
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors",
                isActive
                  ? "bg-teal-400/10 text-teal-700 dark:text-teal-200"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
              )}
            >
              <Icon className="size-3.5" />
              {item.label}
            </NavLink>
          );
        })}

        <span className="mx-1 h-4 w-px bg-border/60" />

        {CONTEXTUAL_NAV.map((item) => {
          const Icon = item.icon;
          const isActive = location.pathname.startsWith(item.to);
          return (
            <NavLink
              key={item.to}
              to={item.to}
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors",
                isActive
                  ? "bg-teal-400/10 text-teal-700 dark:text-teal-200"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
              )}
            >
              <Icon className="size-3.5" />
              {item.label}
            </NavLink>
          );
        })}
      </nav>

      {/* Right side */}
      <div className="ml-auto flex items-center gap-2">
        {/* Entity context */}
        {entity && entity.type !== "workspace" && (
          <div className="hidden items-center gap-1.5 rounded-full border border-teal-400/30 bg-teal-400/10 px-2 py-0.5 text-[10px] font-medium text-teal-600 dark:text-teal-300 sm:flex">
            <span className="capitalize">{entity.type}</span>
            {entity.name && (
              <>
                <ChevronRight className="size-2.5" />
                <span className="max-w-[120px] truncate">{entity.name}</span>
              </>
            )}
          </div>
        )}

        {/* Open signals */}
        {openRecs > 0 && (
          <Badge
            variant="outline"
            className="hidden gap-1 border-amber-400/30 bg-amber-400/10 font-mono text-[10px] text-amber-600 dark:text-amber-300 sm:inline-flex"
          >
            <Sparkles className="size-2.5" />
            {openRecs}
          </Badge>
        )}

        <VoiceStatePill />
        <CommandPalette />
        <ThemeToggle />

        {/* User menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-2 rounded-lg px-1.5 py-1 transition-colors hover:bg-muted/50">
              <Avatar className="size-7">
                {user?.image && <AvatarImage src={user.image} alt="" />}
                <AvatarFallback className="rounded-md bg-teal-400/15 text-[10px] text-teal-600 dark:text-teal-300">
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
            <DropdownMenuItem onClick={() => navigate("/dashboard/team")} className="cursor-pointer gap-2">
              <Users className="size-3.5" /> Team
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => navigate("/dashboard/settings")} className="cursor-pointer gap-2">
              <Settings2 className="size-3.5" /> Settings
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => navigate("/dashboard/connections")} className="cursor-pointer gap-2">
              <Cable className="size-3.5" /> Connections
            </DropdownMenuItem>
            {canAccessPlatformAdmin(role as any) && (
              <DropdownMenuItem onClick={() => navigate("/dashboard/users")} className="cursor-pointer gap-2">
                <Globe className="size-3.5" /> Organizations
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
// Atlas Input Bar — persistent Ask Atlas at the bottom
// ---------------------------------------------------------------------------

function AtlasInputBar() {
  const navigate = useNavigate();
  const [input, setInput] = useState("");
  const session = useVoiceSession();
  const { entity } = useAtlasContext();

  const busy = session.busy;
  const status = session.status;

  const voice = useVoice({
    onTranscript: (text) => setInput((prev) => (prev ? `${prev} ${text}` : text)),
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

  const placeholder = (() => {
    if (busy) return "Atlas is thinking…";
    if (entity?.type === "claim") return `Ask Atlas about this claim…`;
    if (entity?.type === "knowledge") return `Ask Atlas about this document…`;
    return `Ask Atlas about your business…`;
  })();

  return (
    <div className="border-t border-border/40 bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-3xl items-end gap-2 px-4 py-2.5">
        {/* Voice toggle */}
        <button
          type="button"
          onClick={() => voice.toggle()}
          title={micActive ? "Stop listening" : "Press to talk"}
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-xl border transition-all",
            micActive
              ? "animate-pulse border-rose-400/40 bg-rose-500 text-white shadow-sm shadow-rose-500/20"
              : "border-border/60 bg-muted/30 text-muted-foreground hover:border-teal-400/40 hover:text-teal-600 dark:hover:text-teal-300"
          )}
        >
          {micActive ? <MicOff className="size-4" /> : <Mic className="size-4" />}
        </button>

        {/* Input */}
        <div className="relative flex-1">
          {voice.interim && micActive && (
            <p className="mb-1 px-1 text-[11px] italic text-muted-foreground">
              "{voice.interim}"
            </p>
          )}
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={busy}
            className="h-10 w-full rounded-xl border border-border/60 bg-card/50 pl-4 pr-12 text-sm text-foreground shadow-sm outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-teal-400/50 focus:ring-2 focus:ring-teal-400/20 disabled:opacity-60"
          />
          <button
            type="button"
            onClick={handleSubmit}
            disabled={busy || !input.trim()}
            className="absolute right-2 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-lg bg-teal-400 text-teal-950 transition-colors hover:bg-teal-300 disabled:opacity-40"
          >
            {busy ? (
              <div className="size-3.5 animate-spin rounded-full border-2 border-teal-950 border-t-transparent" />
            ) : (
              <Send className="size-3.5" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AppShell — the authenticated Atlas layout
// ---------------------------------------------------------------------------

export function AppShell({ children }: { children: ReactNode }) {
  const { user, role } = useAuth();
  const workspace = useQuery(api.tenants.getMyWorkspace);
  const recCounts = useQuery(
    api.recommendations.recommendationCounts,
    workspace ? undefined : "skip",
  );
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

  const openRecs = recCounts?.open ?? 0;

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Atlas Header */}
      <AtlasHeader openRecs={openRecs} role={role} />

      {/* Experience Area */}
      <main className="atlas-scroll flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
          {children}
        </div>
      </main>

      {/* Persistent Atlas Input Bar */}
      <AtlasInputBar />
    </div>
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
