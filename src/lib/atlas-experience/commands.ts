// ---------------------------------------------------------------------------
// Atlas Command Palette — Universal Action Surface
//
// Foundation for a Cmd+K / Ctrl+K command surface that lets users navigate,
// trigger actions, and interact with Atlas from a single entry point.
//
// This module provides:
//   - Command registration system
//   - Action categories and icons
//   - Search/filter logic
//   - Extensible hook for future commands
// ---------------------------------------------------------------------------

import type { LucideIcon } from "lucide-react";
import {
  Activity,
  Brain,
  Cable,
  ClipboardCheck,
  Database,
  FileSearch,
  FileUp,
  Landmark,
  Mail,
  MessageSquareText,
  Network,
  Radar,
  ScrollText,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingUp,
  Users,
  Workflow,
  Zap,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CommandCategory =
  | "navigation"
  | "action"
  | "ask_atlas"
  | "navigation"
  | "system";

export interface AtlasCommand {
  id: string;
  label: string;
  description?: string;
  category: CommandCategory;
  icon: LucideIcon;
  /** Keyboard shortcut hint */
  shortcut?: string;
  /** Where this command navigates (if navigation command) */
  href?: string;
  /** Or an action function */
  action?: () => void;
  /** Keywords for search matching */
  keywords: string[];
  /** Required role/permission (if any) */
  requiredRole?: string[];
}

// ---------------------------------------------------------------------------
// Built-in commands — organized by category
// ---------------------------------------------------------------------------

export const BUILTIN_COMMANDS: AtlasCommand[] = [
  // Navigation — Home
  {
    id: "nav:home",
    label: "Atlas Home",
    description: "What matters right now",
    category: "navigation",
    icon: Radar,
    href: "/dashboard",
    keywords: ["home", "dashboard", "overview", "status"],
  },

  // Navigation — Work
  {
    id: "nav:claims",
    label: "Revenue Recovery",
    description: "Claims, packages & supplements",
    category: "navigation",
    icon: TrendingUp,
    href: "/dashboard/revenue-recovery",
    keywords: ["claims", "revenue", "recovery", "supplements"],
  },
  {
    id: "nav:workflows",
    label: "Workflows",
    description: "Active workflows and tasks",
    category: "navigation",
    icon: Workflow,
    href: "/dashboard/workflows",
    keywords: ["workflows", "tasks", "process"],
  },
  {
    id: "nav:recommendations",
    label: "Recommendations",
    description: "Signals ranked by Atlas",
    category: "navigation",
    icon: Target,
    href: "/dashboard/recommendations",
    keywords: ["recommendations", "signals", "priority", "approve"],
  },

  // Navigation — Intelligence
  {
    id: "nav:intelligence",
    label: "Intelligence Packs",
    description: "Industry & regulatory knowledge",
    category: "navigation",
    icon: Brain,
    href: "/dashboard/intelligence",
    keywords: ["intelligence", "packs", "industry", "regulatory"],
  },
  {
    id: "nav:knowledge",
    label: "Knowledge Base",
    description: "Documents, entities & graph",
    category: "navigation",
    icon: Database,
    href: "/dashboard/knowledge",
    keywords: ["knowledge", "documents", "entities", "graph"],
  },
  {
    id: "nav:events",
    label: "Events",
    description: "System events and triggers",
    category: "navigation",
    icon: Activity,
    href: "/dashboard/events",
    keywords: ["events", "activity", "triggers"],
  },

  // Navigation — Communication
  {
    id: "nav:mail",
    label: "Atlas Mail",
    description: "Outreach and communication",
    category: "navigation",
    icon: Mail,
    href: "/dashboard/mail",
    keywords: ["mail", "email", "outreach", "communication"],
  },

  // Navigation — System
  {
    id: "nav:connections",
    label: "Connections",
    description: "External integrations",
    category: "navigation",
    icon: Cable,
    href: "/dashboard/connections",
    keywords: ["connections", "integrations", "sync"],
  },
  {
    id: "nav:team",
    label: "Team",
    description: "Team members and roles",
    category: "navigation",
    icon: Users,
    href: "/dashboard/team",
    keywords: ["team", "members", "roles"],
  },
  {
    id: "nav:settings",
    label: "Settings",
    description: "Workspace configuration",
    category: "navigation",
    icon: Settings2,
    href: "/dashboard/settings",
    keywords: ["settings", "config", "workspace"],
  },
  {
    id: "nav:audit",
    label: "Activity / Audit Log",
    description: "System activity history",
    category: "navigation",
    icon: ScrollText,
    href: "/dashboard/audit",
    keywords: ["audit", "activity", "history", "log"],
  },

  // Actions
  {
    id: "action:upload",
    label: "Upload Documents",
    description: "Add documents to the knowledge base",
    category: "action",
    icon: FileUp,
    href: "/dashboard/knowledge",
    keywords: ["upload", "documents", "add"],
  },
  {
    id: "action:find-supplements",
    label: "Find Supplement Opportunities",
    description: "Scan claims for potential revenue",
    category: "action",
    icon: FileSearch,
    href: "/dashboard/ask?q=Find%20potential%20supplements",
    keywords: ["supplements", "find", "scan", "revenue"],
  },
  {
    id: "action:find-revenue",
    label: "Find Missing Revenue",
    description: "What are we leaving on the table?",
    category: "action",
    icon: Landmark,
    href: "/dashboard/ask?q=What%20money%20are%20we%20leaving%20on%20the%20table",
    keywords: ["revenue", "missing", "money", "leave"],
  },
  {
    id: "action:build-package",
    label: "Build Claim Package",
    description: "Assemble a professional claim package",
    category: "action",
    icon: ClipboardCheck,
    href: "/dashboard/ask?q=Build%20the%20claim%20package",
    keywords: ["package", "claim", "build", "assemble"],
  },
  {
    id: "action:run-comparison",
    label: "Run Comparison Engine",
    description: "Scan workspace for gaps and risks",
    category: "action",
    icon: ShieldCheck,
    href: "/dashboard/recommendations",
    keywords: ["compare", "scan", "gaps", "risks", "detector"],
  },

  // Ask Atlas
  {
    id: "ask:atlas",
    label: "Ask Atlas",
    description: "Talk or type anything",
    category: "ask_atlas",
    icon: MessageSquareText,
    href: "/dashboard/ask",
    shortcut: "⌘/",
    keywords: ["ask", "question", "chat", "assistant"],
  },
  {
    id: "ask:evidence",
    label: "Ask about Evidence",
    description: "What evidence supports this claim?",
    category: "ask_atlas",
    icon: Search,
    href: "/dashboard/ask?q=What%20evidence%20supports%20this%20claim",
    keywords: ["evidence", "support", "proof"],
  },
  {
    id: "ask:missing",
    label: "Ask what's Missing",
    description: "What information is missing?",
    category: "ask_atlas",
    icon: Search,
    href: "/dashboard/ask?q=What%20evidence%20is%20missing",
    keywords: ["missing", "gap", "incomplete"],
  },

];

// ---------------------------------------------------------------------------
// Search / filter
// ---------------------------------------------------------------------------

/**
 * Search commands by query string. Matches against label, description, and
 * keywords. Returns results sorted by relevance.
 */
export function searchCommands(
  commands: AtlasCommand[],
  query: string,
): AtlasCommand[] {
  if (!query.trim()) return commands;

  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);

  return commands
    .map((cmd) => {
      let score = 0;
      const label = cmd.label.toLowerCase();
      const desc = (cmd.description ?? "").toLowerCase();
      const keywords = cmd.keywords.join(" ").toLowerCase();

      for (const term of terms) {
        if (label.includes(term)) score += 10;
        if (desc.includes(term)) score += 5;
        if (keywords.includes(term)) score += 3;
      }

      return { cmd, score };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .map(({ cmd }) => cmd);
}

/**
 * Group commands by category for display.
 */
export function groupCommands(
  commands: AtlasCommand[],
): Array<{ category: CommandCategory; label: string; commands: AtlasCommand[] }> {
  const CATEGORY_LABELS: Record<CommandCategory, string> = {
    navigation: "Navigate",
    action: "Quick Actions",
    ask_atlas: "Ask Atlas",
    system: "System",
  };

  const groups = new Map<CommandCategory, AtlasCommand[]>();
  for (const cmd of commands) {
    const existing = groups.get(cmd.category) ?? [];
    existing.push(cmd);
    groups.set(cmd.category, existing);
  }

  return Array.from(groups.entries()).map(([category, cmds]) => ({
    category,
    label: CATEGORY_LABELS[category],
    commands: cmds,
  }));
}
