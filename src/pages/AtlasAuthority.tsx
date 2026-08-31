// ---------------------------------------------------------------------------
// Atlas Authority — What Atlas is allowed to do
//
// This is NOT a permissions editor.
// This is an informational/governance surface that makes Atlas's operating
// boundaries visible and understandable.
//
// CRITICAL: This is purely informational UI. It does NOT grant authority.
// Actual authorization is server-side, role-aware, and tenant-aware.
// ---------------------------------------------------------------------------

import { api } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";
import { useQuery } from "@/hooks/use-supabase";
import {
  normalizeRole,
  canAccessPlatformAdmin,
  type AtlasRole,
} from "@/lib/auth/access-gate";
import { Loader2, Radar, ShieldCheck, Eye, FileCheck, Send } from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Permission display data — informational only
// Maps to the EXISTING PERMISSION_MATRIX in execution.ts
// This is a READ-ONLY DISPLAY of the server-enforced model.
// ---------------------------------------------------------------------------

interface PermissionEntry {
  capability: string;
  category: "see" | "prepare" | "execute";
  description: string;
  roles: AtlasRole[];
  requiresApproval: boolean;
}

const PERMISSION_ENTRIES: PermissionEntry[] = [
  // CAN SEE
  {
    capability: "Search and navigate entities",
    category: "see",
    description: "Find and view claims, documents, and other entities",
    roles: ["super_admin", "atlas_admin", "customer_admin", "customer_user"],
    requiresApproval: false,
  },
  {
    capability: "View claim details",
    category: "see",
    description: "Access claim information and metadata",
    roles: ["super_admin", "atlas_admin", "customer_admin", "customer_user"],
    requiresApproval: false,
  },
  {
    capability: "View evidence",
    category: "see",
    description: "Display supporting evidence and documents",
    roles: ["super_admin", "atlas_admin", "customer_admin", "customer_user"],
    requiresApproval: false,
  },
  {
    capability: "View recommendations",
    category: "see",
    description: "Display Atlas analysis and recommendations",
    roles: ["super_admin", "atlas_admin", "customer_admin", "customer_user"],
    requiresApproval: false,
  },

  // CAN PREPARE
  {
    capability: "Prepare supplement drafts",
    category: "prepare",
    description: "Assemble line items, evidence, and supporting documents",
    roles: ["super_admin", "atlas_admin", "customer_admin"],
    requiresApproval: false,
  },
  {
    capability: "Prepare emails",
    category: "prepare",
    description: "Draft outreach communications",
    roles: ["super_admin", "atlas_admin", "customer_admin"],
    requiresApproval: false,
  },
  {
    capability: "Prepare recommendations",
    category: "prepare",
    description: "Generate actionable recommendations",
    roles: ["super_admin", "atlas_admin", "customer_admin"],
    requiresApproval: false,
  },

  // CAN EXECUTE
  {
    capability: "Submit supplements",
    category: "execute",
    description: "Send prepared supplements through the configured destination",
    roles: ["super_admin", "atlas_admin", "customer_admin"],
    requiresApproval: true,
  },
  {
    capability: "Send emails",
    category: "execute",
    description: "Deliver prepared communications",
    roles: ["super_admin", "atlas_admin", "customer_admin"],
    requiresApproval: true,
  },
  {
    capability: "Approve recommendations",
    category: "execute",
    description: "Execute approved Atlas recommendations",
    roles: ["super_admin", "atlas_admin", "customer_admin"],
    requiresApproval: true,
  },
  {
    capability: "Execute workflows",
    category: "execute",
    description: "Run automated workflows",
    roles: ["super_admin", "atlas_admin", "customer_admin"],
    requiresApproval: true,
  },
];

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function AtlasAuthority() {
  const { role } = useAuth();
  const normalizedRole = normalizeRole(role);

  const seeItems = PERMISSION_ENTRIES.filter((e) => e.category === "see");
  const prepareItems = PERMISSION_ENTRIES.filter((e) => e.category === "prepare");
  const executeItems = PERMISSION_ENTRIES.filter((e) => e.category === "execute");

  return (
    <div className="flex flex-col gap-8">
      {/* ── Header ── */}
      <div>
        <p className="text-xs font-medium uppercase tracking-widest text-teal-600 dark:text-teal-300">
          Atlas Authority
        </p>
        <h1 className="mt-1 text-xl font-semibold tracking-tight text-foreground">
          What Atlas is allowed to do
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Atlas operates within these boundaries. Your role determines what Atlas
          can do on your behalf.
        </p>
      </div>

      {/* ── Current role indicator ── */}
      <div className="flex items-center gap-3 rounded-xl border border-border/70 bg-card/60 p-4">
        <div className="flex size-8 items-center justify-center rounded-lg bg-teal-400/15 text-teal-600 dark:text-teal-300">
          <ShieldCheck className="size-4" />
        </div>
        <div>
          <p className="text-sm font-medium text-foreground">
            Your role: {normalizedRole.replace(/_/g, " ")}
          </p>
          <p className="text-xs text-muted-foreground">
            {normalizedRole === "super_admin"
              ? "Full platform access including organization management"
              : normalizedRole === "atlas_admin"
                ? "Atlas product access including user management"
                : normalizedRole === "customer_admin"
                  ? "Atlas product access including team management"
                  : normalizedRole === "customer_user"
                    ? "Atlas product access according to your permissions"
                    : "Atlas product access according to your permissions"}
          </p>
        </div>
      </div>

      {/* ── CAN SEE ── */}
      <AuthoritySection
        icon={<Eye className="size-4" />}
        title="What Atlas can see"
        subtitle="Atlas has read access to these information sources"
        accent="text-sky-600 dark:text-sky-300"
        items={seeItems}
        currentRole={normalizedRole}
        allAllowed={true}
      />

      {/* ── CAN PREPARE ── */}
      <AuthoritySection
        icon={<FileCheck className="size-4" />}
        title="What Atlas can prepare"
        subtitle="Atlas assembles these for your review"
        accent="text-violet-600 dark:text-violet-300"
        items={prepareItems}
        currentRole={normalizedRole}
        allAllowed={
          normalizedRole === "super_admin" ||
          normalizedRole === "atlas_admin" ||
          normalizedRole === "customer_admin"
        }
      />

      {/* ── CAN EXECUTE ── */}
      <AuthoritySection
        icon={<Send className="size-4" />}
        title="What Atlas can execute"
        subtitle="Every execution requires your explicit approval"
        accent="text-amber-600 dark:text-amber-300"
        items={executeItems}
        currentRole={normalizedRole}
        allAllowed={
          normalizedRole === "super_admin" ||
          normalizedRole === "atlas_admin" ||
          normalizedRole === "customer_admin"
        }
      />

      {/* ── Safety boundary ── */}
      <section className="rounded-xl border border-emerald-400/25 bg-emerald-400/5 p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-emerald-700 dark:text-emerald-200">
          <ShieldCheck className="size-4" />
          Safety boundary
        </h2>
        <div className="mt-2 space-y-1.5 text-xs leading-5 text-emerald-700/80 dark:text-emerald-200/80">
          <p>
            <strong>Atlas never executes without explicit approval.</strong> Every
            consequential action requires your review and authorization.
          </p>
          <p>
            Authorization is enforced server-side. This display reflects the
            permission model — it does not grant or modify authority.
          </p>
        </div>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section component
// ---------------------------------------------------------------------------

function AuthoritySection({
  icon,
  title,
  subtitle,
  accent,
  items,
  currentRole,
  allAllowed,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  accent: string;
  items: PermissionEntry[];
  currentRole: AtlasRole;
  allAllowed: boolean;
}) {
  return (
    <section className="rounded-xl border border-border/70 bg-card/60 p-5">
      <h2 className={cn("flex items-center gap-2 text-sm font-semibold", accent)}>
        {icon}
        {title}
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>

      <div className="mt-4 space-y-2">
        {items.map((item) => {
          const allowed = item.roles.includes(currentRole);
          return (
            <div
              key={item.capability}
              className={cn(
                "flex items-start gap-2.5 rounded-lg border px-3 py-2.5",
                allowed
                  ? "border-border/60 bg-muted/20"
                  : "border-border/40 bg-muted/10 opacity-60",
              )}
            >
              <span
                className={cn(
                  "mt-0.5 size-3.5 shrink-0",
                  allowed
                    ? "text-emerald-600 dark:text-emerald-300"
                    : "text-muted-foreground/40",
                )}
              >
                {allowed ? "✓" : "○"}
              </span>
              <div className="min-w-0 flex-1">
                <p
                  className={cn(
                    "text-sm font-medium",
                    allowed ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {item.capability}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {item.description}
                </p>
              </div>
              {item.requiresApproval && allowed && (
                <span className="shrink-0 rounded-full border border-amber-400/25 bg-amber-400/10 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-200">
                  Requires approval
                </span>
              )}
              {!allowed && (
                <span className="shrink-0 text-[10px] text-muted-foreground/50">
                  Requires elevated role
                </span>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
