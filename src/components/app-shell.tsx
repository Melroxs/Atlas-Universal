// ---------------------------------------------------------------------------
// Atlas App Shell — Intelligence-driven presentation layer
//
// The shell should feel like Atlas IS the interface, not a frame around modules.
//
// Layout:
//   ┌──────────────────────────────────────────────────────────────┐
//   │ ● Atlas ─── active ───────────────────────────────  👤     │
//   ├──────────────────────────────────────────────────────────────┤
//   │                                                              │
//   │                    EXPERIENCE AREA                           │
//   │                                                              │
//   │                                                              │
//   │                                                              │
//   ├──────────────────────────────────────────────────────────────┤
//   │                                                              │
//   │  ┌──────────────────────────────────────────────────┐       │
//   │  │  Ask Atlas...                                    │       │
//   │  └──────────────────────────────────────────────────┘       │
//   │           ◉ Listening...                                    │
//   └──────────────────────────────────────────────────────────────┘
// ---------------------------------------------------------------------------

import { useVoiceSession } from "@/components/voice-session";
import { useVoice } from "@/hooks/use-voice";
import { CommandPalette } from "@/components/atlas-experience/CommandPalette";
import { AtlasContextProvider, useAtlasContext } from "@/lib/atlas-experience/context";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";
import { canAccessPlatformAdmin } from "@/lib/auth/access-gate";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/atlas-ui";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
  Cable,
  ChevronRight,
  Globe,
  Landmark,
  LogOut,
  Mic,
  MicOff,
  Radar,
  Send,
  Settings2,
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
// Atlas Header — minimal. Atlas identity + status. No module navigation.
// ---------------------------------------------------------------------------

function AtlasHeader({ role }: { role: string }) {
  const { user, signOut } = useAuth();
  const { health, entity } = useAtlasContext();
  const navigate = useNavigate();

  const isHealthy = health.documents > 0;

  return (
    <header className="flex h-11 shrink-0 items-center gap-3 border-b border-border/30 bg-background/80 px-4 backdrop-blur-md">
      {/* Atlas identity — the only permanent header element */}
      <NavLink to="/dashboard" className="flex items-center gap-2 transition-opacity hover:opacity-80">
        <div className="flex size-6 items-center justify-center rounded-lg bg-teal-400/15 text-teal-600 ring-1 ring-teal-400/30 dark:text-teal-300">
          <Radar className="size-3" />
        </div>
        <span className="text-sm font-semibold tracking-tight text-foreground">Atlas</span>
      </NavLink>

      {/* Status pulse — communicates Atlas state, not navigation */}
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

      {/* Entity context — shows what Atlas is looking at */}
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

      {/* Right side — minimal */}
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
// Atlas Input Bar — premium conversational control, not a search field
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

  // Context-aware placeholder
  const placeholder = (() => {
    if (busy) return "Atlas is thinking…";
    if (entity?.type === "claim") return `Ask about this claim…`;
    if (entity?.type === "knowledge") return `Ask about this document…`;
    return "Ask Atlas…";
  })();

  return (
    <div className="border-t border-border/30 bg-background/80 backdrop-blur-md">
      {/* Voice state indicator — always visible when active */}
      <VoiceIndicator />

      <div className="mx-auto flex max-w-2xl items-center gap-2.5 px-4 pb-3 pt-1">
        {/* Voice toggle — circular, premium */}
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

        {/* Input — styled as a conversational control */}
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
              className="h-9 w-full rounded-full border border-border/50 bg-card/40 pl-4 pr-10 text-sm text-foreground shadow-sm outline-none transition-all duration-200 placeholder:text-muted-foreground/50 focus:border-teal-400/40 focus:ring-1 focus:ring-teal-400/15 disabled:opacity-50"
            />
            <button
              type="button"
              onClick={handleSubmit}
              disabled={busy || !input.trim()}
              className="absolute right-1.5 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-full bg-teal-400 text-teal-950 transition-colors hover:bg-teal-300 disabled:opacity-30"
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
// AppShell — the authenticated Atlas layout
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
    <div className="flex min-h-screen flex-col bg-background">
      {/* Minimal Atlas Header */}
      <AtlasHeader role={role} />

      {/* Experience Area — full width, no max-width constraint */}
      <main className="atlas-scroll flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
          {children}
        </div>
      </main>

      {/* Persistent Atlas Interaction — the center of the experience */}
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
