import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { PageHeader, Panel, StatCard, titleCase } from "@/components/atlas-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { useMutation, useQuery } from "convex/react";
import {
  AlertTriangle,
  BookOpen,
  Building2,
  Coins,
  Globe2,
  Landmark,
  Layers,
  MapPin,
  Plus,
  Save,
  Scale,
  ShieldCheck,
  Sparkles,
  Trash2,
  TrendingUp,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

// ---------------------------------------------------------------------------
// Types (server-driven shapes)
// ---------------------------------------------------------------------------

interface OrgContext {
  _id: Id<"organizationContexts">;
  country?: string | null;
  regions?: string[] | null;
  cities?: string[] | null;
  primaryTimezone?: string | null;
  timezoneNote?: string | null;
  locale?: string | null;
  currency?: string | null;
  fiscalYearStart?: string | null;
  businessDays?: number[] | null;
  businessHours?: { start: string; end: string } | null;
  holidays?: string[] | null;
  jurisdictions?: string[] | null;
  industry?: string | null;
  businessModel?: string | null;
  companySize?: string | null;
}

interface LocationRow {
  _id: Id<"operatingLocations">;
  name: string;
  kind: string;
  timezone?: string | null;
  jurisdiction?: string | null;
  country?: string | null;
  region?: string | null;
  city?: string | null;
  primary?: boolean | null;
}

interface Snapshot {
  timezone: string;
  now: number;
  dateKey: string;
  today: string;
  isBusinessDay: boolean;
  isWithinBusinessHours: boolean;
  nextBusinessDay: string;
  nextBusinessDayStart: number;
  endOfBusinessDay: number;
  startOfBusinessDay: number;
  weekStart: string;
  monthStart: string;
  monthEnd: string;
  fiscalQuarter: { quarter: number; label: string };
}

interface CoverageAxis {
  label: string;
  score: number;
  state: string;
  basis: string;
}
interface IndustryCoverage {
  packKey: string;
  name: string;
  implementation: string;
  axes: CoverageAxis[];
  overall: string;
  note: string;
}

interface KnowledgeRow {
  knowledgeId: string;
  title: string;
  statement: string;
  interpretation: string | null;
  knowledgeType: string;
  jurisdiction: string | null;
  industry: string | null;
  version: string | null;
  confidence: number;
  source: {
    sourceId: string;
    name: string;
    organization: string;
    authorityTier: string;
    sourceType: string;
    canonicalUrl: string | null;
  } | null;
  provenanceAnswer: string | null;
  applicability: { applicable: boolean; reason: string; missingFactors: string[] };
}

interface SourceRow {
  sourceId: string;
  name: string;
  organization: string;
  authorityTier: string;
  tierLabel: string;
  tierWeight: number;
  sourceType: string;
  industry: string | null;
  jurisdiction: string | null;
  knowledgeCount: number;
}

interface BusinessBrainData {
  version: string;
  businessTypes: Array<{ key: string; name: string; summary: string; content: Record<string, unknown> }>;
  financialKnowledge: {
    revenue: Array<{ term: string; meaning: string; caution?: string }>;
    expenses: Array<{ term: string; meaning: string }>;
    profitability: Array<{ term: string; meaning: string; formula?: string }>;
    balanceSheet: Array<{ term: string; meaning: string }>;
    incomeStatementFlow: Array<{ stage: string; description: string; sign: string }>;
    accountingIdentity: { statement: string; meaning: string; scope: string };
  };
  orgStructures: Array<{ key: string; name: string; summary: string }>;
  orgRoles: Array<{ key: string; name: string; summary: string }>;
  businessFunctions: Array<{ key: string; name: string; summary: string }>;
  businessObjects: Array<{ key: string; name: string; summary: string }>;
  objectRelationships: Array<{ from: string; to: string; relationship: string; description: string }>;
  lifecycles: Array<{ key: string; name: string; description: string; stages: string[] }>;
  maturity: Array<{ key: string; name: string; summary: string }>;
  maturityKeys: string[];
  disambiguation: { term: string; meanings: string[]; guidance: string } | null;
}

interface RecoveryOpportunity {
  type: string;
  severity: "high" | "medium" | "low";
  title: string;
  evidence: string[];
  confidence: number;
  explanation: string;
  financialRelevance: string;
  recommendedNextStep: string;
}

const DAY_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

const fmtTime = (ms: number) =>
  new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function BusinessBrain() {
  const userTimezone = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone ?? undefined,
    [],
  );
  const orgData = useQuery(api.everest.api.getOrganizationContext, { userTimezone });
  const brain = useQuery(api.everest.api.getBusinessBrain, {});
  const authority = useQuery(api.everest.api.listAuthoritativeKnowledge);
  const coverageData = useQuery(api.everest.api.getIndustryCoverage);
  const insurance = useQuery(api.everest.api.getInsuranceIntelligence);

  const saveContext = useMutation(api.everest.api.updateOrganizationContext);
  const upsertLocation = useMutation(api.everest.api.upsertOperatingLocation);
  const removeLocation = useMutation(api.everest.api.removeOperatingLocation);

  const [tab, setTab] = useState("overview");
  const [dirty, setDirty] = useState(false);

  // Local form state — initialized once from the server.
  const [form, setForm] = useState<{
    country: string;
    regions: string;
    cities: string;
    timezone: string;
    locale: string;
    currency: string;
    fiscalYearStart: string;
    businessDays: number[];
    hoursStart: string;
    hoursEnd: string;
    holidays: string;
  } | null>(null);

  useEffect(() => {
    if (!form && orgData?.context) {
      setForm({
        country: orgData.context.country ?? orgData.profile?.country ?? "",
        regions: (orgData.context.regions ?? []).join(", "),
        cities: (orgData.context.cities ?? []).join(", "),
        timezone: orgData.context.primaryTimezone ?? orgData.organization.timezone,
        locale: orgData.context.locale ?? "",
        currency: orgData.context.currency ?? "",
        fiscalYearStart: orgData.context.fiscalYearStart ?? "",
        businessDays: orgData.context.businessDays ?? [1, 2, 3, 4, 5],
        hoursStart: orgData.context.businessHours?.start ?? "09:00",
        hoursEnd: orgData.context.businessHours?.end ?? "17:00",
        holidays: (orgData.context.holidays ?? []).join(", "),
      });
    }
  }, [orgData, form]);

  const [newLoc, setNewLoc] = useState({ name: "", kind: "branch", city: "", timezone: "" });

  const onSave = async () => {
    if (!form) return;
    await saveContext({
      country: form.country || undefined,
      regions: form.regions.split(",").map((s) => s.trim()).filter(Boolean),
      cities: form.cities.split(",").map((s) => s.trim()).filter(Boolean),
      primaryTimezone: form.timezone || undefined,
      locale: form.locale || undefined,
      currency: form.currency || undefined,
      fiscalYearStart: form.fiscalYearStart || undefined,
      businessDays: form.businessDays,
      businessHours: { start: form.hoursStart, end: form.hoursEnd },
      holidays: form.holidays.split(",").map((s) => s.trim()).filter(Boolean),
    });
    setDirty(false);
    toast.success("Organization context saved");
  };

  const addLocation = async () => {
    if (!newLoc.name) return;
    await upsertLocation({
      name: newLoc.name,
      kind: newLoc.kind,
      city: newLoc.city || undefined,
      timezone: newLoc.timezone || undefined,
    });
    setNewLoc({ name: "", kind: "branch", city: "", timezone: "" });
    toast.success("Location added");
  };

  const snapshot = orgData?.organization.snapshot;
  const contextNote = orgData?.context?.timezoneNote ?? orgData?.timezoneNote ?? null;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Everest Intelligence Foundation"
        title="Business Brain"
        description="The layer where Atlas understands the world your company operates in — universal business knowledge, your operating context, time & calendar, jurisdiction, authoritative sources, and honest industry coverage."
        actions={
          <Button onClick={onSave} disabled={!dirty || !form} className="gap-2">
            <Save className="size-4" /> Save context
          </Button>
        }
      />

      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <TabsList className="w-full justify-start overflow-x-auto">
          <TabsTrigger value="overview">Organization & calendar</TabsTrigger>
          <TabsTrigger value="brain">Universal knowledge</TabsTrigger>
          <TabsTrigger value="authority">Jurisdiction & authority</TabsTrigger>
          <TabsTrigger value="coverage">Industry coverage</TabsTrigger>
          <TabsTrigger value="insurance">Insurance intelligence</TabsTrigger>
        </TabsList>

        {/* ------------------------------------------------ Overview */}
        <TabsContent value="overview" className="mt-6 flex flex-col gap-6">
          <div className="grid gap-6 lg:grid-cols-5">
            <Panel className="lg:col-span-3" title="Organization context">
              {!form ? (
                <p className="text-sm text-muted-foreground">Loading context…</p>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Country">
                    <Input
                      value={form.country}
                      onChange={(e) => {
                        setForm({ ...form, country: e.target.value });
                        setDirty(true);
                      }}
                      placeholder="e.g. United States"
                    />
                  </Field>
                  <Field label="Timezone">
                    <div className="flex gap-2">
                      <Input
                        value={form.timezone}
                        onChange={(e) => {
                          setForm({ ...form, timezone: e.target.value });
                          setDirty(true);
                        }}
                        placeholder="America/New_York"
                      />
                    </div>
                  </Field>
                  <Field label="Regions / states (comma-separated)">
                    <Input
                      value={form.regions}
                      onChange={(e) => {
                        setForm({ ...form, regions: e.target.value });
                        setDirty(true);
                      }}
                      placeholder="Florida, Texas"
                    />
                  </Field>
                  <Field label="Cities (comma-separated)">
                    <Input
                      value={form.cities}
                      onChange={(e) => {
                        setForm({ ...form, cities: e.target.value });
                        setDirty(true);
                      }}
                      placeholder="Miami, Orlando"
                    />
                  </Field>
                  <Field label="Currency">
                    <Input
                      value={form.currency}
                      onChange={(e) => {
                        setForm({ ...form, currency: e.target.value });
                        setDirty(true);
                      }}
                      placeholder="USD"
                    />
                  </Field>
                  <Field label="Locale">
                    <Input
                      value={form.locale}
                      onChange={(e) => {
                        setForm({ ...form, locale: e.target.value });
                        setDirty(true);
                      }}
                      placeholder="en-US"
                    />
                  </Field>
                  <Field label="Fiscal year start (MM-DD)">
                    <Input
                      value={form.fiscalYearStart}
                      onChange={(e) => {
                        setForm({ ...form, fiscalYearStart: e.target.value });
                        setDirty(true);
                      }}
                      placeholder="01-01"
                    />
                  </Field>
                  <Field label="Business hours">
                    <div className="flex items-center gap-2">
                      <Input
                        value={form.hoursStart}
                        onChange={(e) => {
                          setForm({ ...form, hoursStart: e.target.value });
                          setDirty(true);
                        }}
                        className="w-24"
                      />
                      <span className="text-muted-foreground">→</span>
                      <Input
                        value={form.hoursEnd}
                        onChange={(e) => {
                          setForm({ ...form, hoursEnd: e.target.value });
                          setDirty(true);
                        }}
                        className="w-24"
                      />
                    </div>
                  </Field>
                  <Field label="Business days">
                    <div className="flex gap-1">
                      {DAY_LABELS.map((label, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => {
                            const days = form.businessDays.includes(idx)
                              ? form.businessDays.filter((d) => d !== idx)
                              : [...form.businessDays, idx].sort();
                            setForm({ ...form, businessDays: days });
                            setDirty(true);
                          }}
                          className={cn(
                            "size-9 rounded-lg border text-xs font-medium transition-colors",
                            form.businessDays.includes(idx)
                              ? "border-teal-600/60 bg-teal-600/15 text-teal-700 dark:text-teal-300"
                              : "border-border/70 text-muted-foreground hover:border-border",
                          )}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </Field>
                  <Field label="Holidays (YYYY-MM-DD, comma-separated)" className="sm:col-span-2">
                    <Input
                      value={form.holidays}
                      onChange={(e) => {
                        setForm({ ...form, holidays: e.target.value });
                        setDirty(true);
                      }}
                      placeholder="2026-01-01, 2026-07-04"
                    />
                  </Field>
                </div>
              )}
              {contextNote && (
                <p className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
                  <Sparkles className="size-3.5 text-teal-600 dark:text-teal-300" />
                  {contextNote}
                </p>
              )}
            </Panel>

            <div className="flex flex-col gap-6 lg:col-span-2">
              <Panel title="Operating locations">
                <div className="flex flex-col gap-3">
                  {orgData?.locations.length === 0 && (
                    <p className="text-sm text-muted-foreground">No locations configured yet.</p>
                  )}
                  {orgData?.locations.map((loc) => (
                    <div
                      key={loc._id}
                      className="flex items-center justify-between rounded-lg border border-border/70 bg-card/50 px-3 py-2"
                    >
                      <div className="flex items-center gap-3">
                        <div className="flex size-8 items-center justify-center rounded-lg bg-muted/50 text-teal-600 dark:text-teal-300">
                          <MapPin className="size-4" />
                        </div>
                        <div>
                          <p className="text-sm font-medium">
                            {loc.name}
                            {loc.primary && (
                              <span className="ml-2 text-xs text-teal-600 dark:text-teal-300">primary</span>
                            )}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {titleCase(loc.kind)}
                            {loc.city ? ` · ${loc.city}` : ""}
                            {loc.timezone ? ` · ${loc.timezone}` : ""}
                          </p>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 text-muted-foreground hover:text-destructive"
                        onClick={async () => {
                          await removeLocation({ id: loc._id });
                          toast.success("Location removed");
                        }}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  ))}
                  <div className="grid gap-2 border-t border-border/60 pt-3 sm:grid-cols-3">
                    <Input
                      value={newLoc.name}
                      onChange={(e) => setNewLoc({ ...newLoc, name: e.target.value })}
                      placeholder="Location name"
                      className="sm:col-span-1"
                    />
                    <Input
                      value={newLoc.city}
                      onChange={(e) => setNewLoc({ ...newLoc, city: e.target.value })}
                      placeholder="City"
                    />
                    <Button variant="secondary" onClick={addLocation} className="gap-2">
                      <Plus className="size-4" /> Add
                    </Button>
                  </div>
                </div>
              </Panel>

              <Panel title="Temporal intelligence">
                {snapshot ? (
                  <div className="flex flex-col gap-3 text-sm">
                    <Row label="Organization timezone" value={snapshot.timezone} />
                    <Row
                      label="Today"
                      value={
                        <span className="flex items-center gap-2">
                          {snapshot.today}
                          <Badge
                            variant={snapshot.isBusinessDay ? "default" : "secondary"}
                            className={cn(
                              snapshot.isBusinessDay &&
                                "bg-teal-600/15 text-teal-700 dark:text-teal-300",
                            )}
                          >
                            {snapshot.isBusinessDay ? "business day" : "non-business day"}
                          </Badge>
                        </span>
                      }
                    />
                    <Row
                      label="Operating hours"
                      value={
                        snapshot.isWithinBusinessHours ? (
                          <Badge className="bg-teal-600/15 text-teal-700 dark:text-teal-300">open now</Badge>
                        ) : (
                          <Badge variant="secondary">outside hours</Badge>
                        )
                      }
                    />
                    <Row label="Next business day" value={snapshot.nextBusinessDay} />
                    <Row label="End of business day" value={fmtTime(snapshot.endOfBusinessDay)} />
                    <Row label="Fiscal quarter" value={snapshot.fiscalQuarter.label} />
                    <Row label="This week" value={`${snapshot.weekStart} → ${snapshot.today}`} />
                    <Row label="This month" value={`${snapshot.monthStart} → ${snapshot.monthEnd}`} />
                    <Row
                      label="User timezone"
                      value={
                        orgData?.user
                          ? `${orgData.user.timezone} (${fmtTime(orgData.user.snapshot.now)})`
                          : "—"
                      }
                    />
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Loading calendar…</p>
                )}
              </Panel>
            </div>
          </div>
        </TabsContent>

        {/* ------------------------------------------------ Universal knowledge */}
        <TabsContent value="brain" className="mt-6 flex flex-col gap-6">
          {!brain ? (
            <p className="text-sm text-muted-foreground">Loading universal knowledge…</p>
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <StatCard icon={Building2} label="Business types" value={brain.businessTypes.length} hint="B2B · B2C · subscription · project-based…" />
                <StatCard icon={Coins} label="Financial concepts" value={brain.financialKnowledge.revenue.length + brain.financialKnowledge.expenses.length + brain.financialKnowledge.profitability.length} hint="Revenue, expenses, profitability, balance sheet" />
                <StatCard icon={Users} label="Org roles" value={brain.orgRoles.length} hint="Owner → contractor → customer" />
                <StatCard icon={BookOpen} label="Business objects" value={brain.businessObjects.length} hint="Lead → quote → contract → invoice → payment" />
                <StatCard icon={TrendingUp} label="Lifecycles" value={brain.lifecycles.length} hint="Sales, procurement, employee, customer" />
                <StatCard icon={Layers} label="Maturity levels" value={brain.maturity.length} hint="Solo → micro → small → mid-market → enterprise" accent="text-emerald-600 dark:text-emerald-300" />
              </div>

              <Panel title="Business models — independent of industry" className="!py-4">
                <p className="mb-4 text-sm text-muted-foreground">
                  Industry and business model are separate dimensions: a restoration company can be
                  B2C project-based in Florida, another B2B recurring-services in Texas. Atlas never
                  assumes them together.
                </p>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {brain.businessTypes.map((t) => (
                    <div
                      key={t.key}
                      className="rounded-lg border border-border/70 bg-card/50 p-3 transition-colors hover:border-teal-600/40"
                    >
                      <p className="text-sm font-semibold">{t.name}</p>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">{t.summary}</p>
                    </div>
                  ))}
                </div>
              </Panel>

              <div className="grid gap-6 lg:grid-cols-2">
                <Panel title="The income statement — how revenue becomes profit">
                  <div className="flex flex-col gap-1.5">
                    {brain.financialKnowledge.incomeStatementFlow.map((s, i) => (
                      <div
                        key={i}
                        className="flex items-center justify-between rounded-md border border-border/60 bg-card/50 px-3 py-2"
                      >
                        <span className="text-sm font-medium">{s.stage}</span>
                        <span className="text-xs text-muted-foreground">{s.description}</span>
                        <span
                          className={cn(
                            "w-4 text-center text-sm font-semibold",
                            s.sign === "+"
                              ? "text-teal-600 dark:text-teal-300"
                              : s.sign === "="
                                ? "text-foreground"
                                : "text-muted-foreground",
                          )}
                        >
                          {s.sign}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-4 rounded-lg border border-teal-600/30 bg-teal-600/5 p-3">
                    <p className="text-sm font-semibold text-teal-700 dark:text-teal-300">
                      {brain.financialKnowledge.accountingIdentity.statement}
                    </p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      {brain.financialKnowledge.accountingIdentity.meaning}{" "}
                      {brain.financialKnowledge.accountingIdentity.scope}
                    </p>
                  </div>
                </Panel>

                <Panel title="Accounting semantics — 'sales' is not one number">
                  <p className="mb-3 text-sm text-muted-foreground">
                    Business language is ambiguous. Atlas never treats these as equivalent:
                  </p>
                  {[
                    { term: "Sales", meanings: ["Bookings", "Invoiced", "Recognized revenue", "Collected cash"] },
                    { term: "Revenue", meanings: ["Gross", "Net", "Deferred"] },
                    { term: "Profit", meanings: ["Gross profit", "Operating profit", "Net income"] },
                  ].map((row) => (
                    <div key={row.term} className="mb-3 rounded-lg border border-border/70 bg-card/50 p-3">
                      <p className="text-sm font-semibold">{row.term}</p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {row.meanings.map((m) => (
                          <Badge key={m} variant="secondary" className="font-normal">
                            {m}
                          </Badge>
                        ))}
                      </div>
                      <p className="mt-2 text-xs leading-5 text-muted-foreground">
                        {brain.disambiguation?.term.toLowerCase() === row.term.toLowerCase()
                          ? brain.disambiguation.guidance
                          : "When live data lets Atlas tell these apart, it explains which one it means; otherwise it asks."}
                      </p>
                    </div>
                  ))}
                </Panel>
              </div>

              <div className="grid gap-6 lg:grid-cols-3">
                <Panel title="Organizational structures">
                  <div className="flex flex-col gap-2">
                    {brain.orgStructures.map((s) => (
                      <div key={s.key} className="rounded-md border border-border/60 bg-card/50 px-3 py-2">
                        <p className="text-sm font-medium">{s.name}</p>
                        <p className="text-xs text-muted-foreground">{s.summary}</p>
                      </div>
                    ))}
                  </div>
                </Panel>
                <Panel title="Business functions">
                  <div className="flex flex-col gap-2">
                    {brain.businessFunctions.map((f) => (
                      <div key={f.key} className="rounded-md border border-border/60 bg-card/50 px-3 py-2">
                        <p className="text-sm font-medium">{f.name}</p>
                        <p className="text-xs text-muted-foreground">{f.summary}</p>
                      </div>
                    ))}
                  </div>
                </Panel>
                <Panel title="Company maturity">
                  <div className="flex flex-col gap-2">
                    {brain.maturity.map((m) => (
                      <div key={m.key} className="rounded-md border border-border/60 bg-card/50 px-3 py-2">
                        <p className="text-sm font-medium">{m.name}</p>
                        <p className="text-xs text-muted-foreground">{m.summary}</p>
                      </div>
                    ))}
                  </div>
                  <p className="mt-3 text-xs leading-5 text-muted-foreground">
                    Atlas adapts recommendations to actual maturity — it never recommends
                    enterprise governance to a two-person business unless it's relevant.
                  </p>
                </Panel>
              </div>

              <Panel title="Universal business lifecycles">
                <div className="grid gap-4 lg:grid-cols-2">
                  {brain.lifecycles.map((l) => (
                    <div key={l.key} className="rounded-lg border border-border/70 bg-card/50 p-4">
                      <p className="text-sm font-semibold">{l.name}</p>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">{l.description}</p>
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {l.stages.map((s, i) => (
                          <span key={i} className="flex items-center gap-1.5">
                            <Badge variant="outline" className="font-normal">
                              {s}
                            </Badge>
                            {i < l.stages.length - 1 && (
                              <span className="text-xs text-muted-foreground">→</span>
                            )}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </Panel>
            </>
          )}
        </TabsContent>

        {/* ------------------------------------------------ Jurisdiction & authority */}
        <TabsContent value="authority" className="mt-6 flex flex-col gap-6">
          {!authority ? (
            <p className="text-sm text-muted-foreground">Loading authoritative sources…</p>
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
                <StatCard icon={Landmark} label="Sources" value={authority.sources.length} hint={`${authority.sources.filter((s) => s.tierWeight >= 0.9).length} primary / standards-tier`} />
                <StatCard icon={ShieldCheck} label="Active knowledge" value={authority.knowledge.length} hint="Source facts, versioned" />
                <StatCard icon={Scale} label="Jurisdiction" value={authority.jurisdiction.path.join(" > ") || "Unspecified"} hint={`Industry: ${authority.jurisdiction.industry ?? "not set"}`} />
                <StatCard icon={Globe2} label="Applicable now" value={authority.knowledge.filter((k) => k.applicability.applicable).length} hint="To this operating context" accent="text-emerald-600 dark:text-emerald-300" />
                <StatCard icon={AlertTriangle} label="Not applicable" value={authority.knowledge.filter((k) => !k.applicability.applicable).length} hint="Fail-closed — reason shown" accent="text-amber-600 dark:text-amber-300" />
              </div>

              <Panel title="Authority hierarchy">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                  {Object.entries(authority.tiers).map(([tier, t]) => (
                    <div key={tier} className="rounded-lg border border-border/70 bg-card/50 p-3">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-semibold">{t.label}</p>
                        <Badge variant="secondary">{Math.round(t.weight * 100)}%</Badge>
                      </div>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">{t.description}</p>
                    </div>
                  ))}
                </div>
                <p className="mt-3 text-xs leading-5 text-muted-foreground">
                  General web sources provide context but are never treated as regulatory authority.
                </p>
              </Panel>

              <Panel title="Source registry" description="Every authoritative source is explicitly classified.">
                <div className="flex flex-col divide-y divide-border/60">
                  {authority.sources.map((s) => (
                    <div key={s.sourceId} className="flex items-start justify-between gap-3 py-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{s.name}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {s.organization}
                          {s.jurisdiction ? ` · ${s.jurisdiction}` : ""}
                          {s.industry ? ` · ${titleCase(s.industry)}` : ""}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <Badge variant="outline" className="font-normal">
                          {s.tierLabel}
                        </Badge>
                        <Badge variant="secondary" className="font-normal">
                          {s.knowledgeCount} items
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </Panel>

              <Panel title="Authoritative knowledge" description="Source fact is always separate from Atlas interpretation. Applicability is evaluated per operating context and fails closed.">
                <div className="flex flex-col gap-3">
                  {authority.knowledge.map((k) => (
                    <div
                      key={k.knowledgeId}
                      className={cn(
                        "rounded-lg border p-4",
                        k.applicability.applicable
                          ? "border-teal-600/25 bg-teal-600/5"
                          : "border-border/70 bg-card/50",
                      )}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold">{k.title}</p>
                        <Badge
                          variant={k.applicability.applicable ? "default" : "secondary"}
                          className={cn(
                            k.applicability.applicable &&
                              "bg-teal-600/15 text-teal-700 dark:text-teal-300",
                          )}
                        >
                          {k.applicability.applicable ? "applies here" : "not applicable"}
                        </Badge>
                      </div>
                      <div className="mt-3 grid gap-3 lg:grid-cols-2">
                        <div className="rounded-md border border-border/60 bg-card/60 p-3">
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-teal-600 dark:text-teal-300">
                            Source fact
                          </p>
                          <p className="mt-1 text-sm leading-6">{k.statement}</p>
                        </div>
                        {k.interpretation && (
                          <div className="rounded-md border border-border/60 bg-card/60 p-3">
                            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                              Atlas interpretation
                            </p>
                            <p className="mt-1 text-sm leading-6 text-muted-foreground">{k.interpretation}</p>
                          </div>
                        )}
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span className="rounded border border-border/50 bg-muted/40 px-2 py-0.5">
                          {k.knowledgeType}
                        </span>
                        {k.version && <span className="rounded border border-border/50 bg-muted/40 px-2 py-0.5">v{k.version}</span>}
                        <span className="rounded border border-border/50 bg-muted/40 px-2 py-0.5">
                          confidence {Math.round(k.confidence * 100)}%
                        </span>
                        {k.provenanceAnswer && (
                          <span className="ml-auto max-w-md truncate italic">{k.provenanceAnswer}</span>
                        )}
                      </div>
                      {!k.applicability.applicable && (
                        <p className="mt-2 text-xs text-amber-600 dark:text-amber-300">
                          {k.applicability.reason}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </Panel>
            </>
          )}
        </TabsContent>

        {/* ------------------------------------------------ Coverage */}
        <TabsContent value="coverage" className="mt-6 flex flex-col gap-6">
          {!coverageData ? (
            <p className="text-sm text-muted-foreground">Measuring coverage…</p>
          ) : (
            <>
              <Panel title="Industry knowledge coverage" description="Measured from actual registered items, sources and knowledge entries — never fabricated.">
                <div className="grid gap-4 lg:grid-cols-2">
                  {coverageData.coverage.map((c) => (
                    <div key={c.packKey} className="rounded-lg border border-border/70 bg-card/50 p-4">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-semibold">{c.name}</p>
                        <CoverageStateBadge state={c.overall} />
                      </div>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">{c.note}</p>
                      <div className="mt-3 flex flex-col gap-2">
                        {c.axes.map((a) => (
                          <div key={a.label} className="flex items-center gap-3">
                            <span className="w-20 shrink-0 text-xs text-muted-foreground">{a.label}</span>
                            <Progress
                              value={Math.min(100, (a.score / 10) * 100)}
                              className="h-1.5 flex-1"
                            />
                            <span className="w-28 shrink-0 text-right text-xs text-muted-foreground">
                              {a.basis}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </Panel>
              <p className="text-xs text-muted-foreground">
                Coverage states: Foundational → Developing → Deep → Production-ready. Insurance
                restoration is the first deep vertical; other packs are honestly reported at their
                current level.
              </p>
            </>
          )}
        </TabsContent>

        {/* ------------------------------------------------ Insurance intelligence */}
        <TabsContent value="insurance" className="mt-6 flex flex-col gap-6">
          {!insurance ? (
            <p className="text-sm text-muted-foreground">Loading insurance intelligence…</p>
          ) : (
            <>
              <Panel title="Generalized claim lifecycle" description="What a claim generally involves — before any customer uploads a claim. Tenant workflows may specialize it.">
                <div className="flex flex-wrap gap-2">
                  {insurance.lifecycle.map((s, i) => (
                    <span key={s.stage} className="flex items-center gap-2">
                      <div className="rounded-lg border border-border/70 bg-card/50 px-3 py-2">
                        <p className="text-sm font-medium">{s.stage}</p>
                        <p className="text-xs text-muted-foreground">{s.description}</p>
                      </div>
                      {i < insurance.lifecycle.length - 1 && (
                        <span className="text-muted-foreground">→</span>
                      )}
                    </span>
                  ))}
                </div>
              </Panel>

              <Panel title="Claim evidence model">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                  {insurance.evidenceCategories.map((c) => (
                    <div key={c.key} className="rounded-lg border border-border/70 bg-card/50 p-3">
                      <p className="text-sm font-semibold">{c.name}</p>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">{c.description}</p>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {c.examples.map((e) => (
                          <Badge key={e} variant="outline" className="font-normal">
                            {e}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                <p className="mt-3 text-xs text-muted-foreground">
                  Examples are illustrative — never universal requirements. Every evidence rule
                  carries confidence and provenance.
                </p>
              </Panel>

              <RecoveryAnalyzer />
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Recovery analyzer
// ---------------------------------------------------------------------------

function RecoveryAnalyzer() {
  const [facts, setFacts] = useState({
    expectedScope: "",
    actualScope: "",
    evidenceSummary: "",
    estimateAmount: "",
    paymentAmount: "",
    carrierResponse: "",
    currentStage: "",
    stageAgeDays: "",
  });
  const [run, setRun] = useState(false);
  const result = useQuery(
    api.everest.api.analyzeClaimRecovery,
    run
      ? {
          expectedScope: facts.expectedScope.split(",").map((s) => s.trim()).filter(Boolean),
          actualScope: facts.actualScope.split(",").map((s) => s.trim()).filter(Boolean),
          evidenceSummary: facts.evidenceSummary.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
          estimateAmount: facts.estimateAmount ? Number(facts.estimateAmount) : undefined,
          paymentAmount: facts.paymentAmount ? Number(facts.paymentAmount) : undefined,
          carrierResponse: facts.carrierResponse || undefined,
          currentStage: facts.currentStage || undefined,
          stageAgeDays: facts.stageAgeDays ? Number(facts.stageAgeDays) : undefined,
        }
      : "skip",
  );

  const opportunities: RecoveryOpportunity[] | undefined =
    run && result && Array.isArray(result) ? (result as RecoveryOpportunity[]) : undefined;

  return (
    <Panel
      title="Revenue recovery intelligence"
      description="Compare documented scope, actual scope, evidence, estimate, carrier response and payment. Every finding is evidence-labeled and worded as a possibility — never a guarantee."
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Expected / documented scope">
          <Input value={facts.expectedScope} onChange={(e) => setFacts({ ...facts, expectedScope: e.target.value })} placeholder="Demo, drywall, paint (comma-separated)" />
        </Field>
        <Field label="Actual scope">
          <Input value={facts.actualScope} onChange={(e) => setFacts({ ...facts, actualScope: e.target.value })} placeholder="Demo, drywall, paint, flooring" />
        </Field>
        <Field label="Evidence on file">
          <Input value={facts.evidenceSummary} onChange={(e) => setFacts({ ...facts, evidenceSummary: e.target.value })} placeholder="damage, scope, quantity (categories)" />
        </Field>
        <Field label="Estimate ($)">
          <Input value={facts.estimateAmount} onChange={(e) => setFacts({ ...facts, estimateAmount: e.target.value })} placeholder="25000" />
        </Field>
        <Field label="Paid ($)">
          <Input value={facts.paymentAmount} onChange={(e) => setFacts({ ...facts, paymentAmount: e.target.value })} placeholder="18000" />
        </Field>
        <Field label="Carrier response">
          <Input value={facts.carrierResponse} onChange={(e) => setFacts({ ...facts, carrierResponse: e.target.value })} placeholder="partial — 30% cut on drying" />
        </Field>
        <Field label="Current stage">
          <Input value={facts.currentStage} onChange={(e) => setFacts({ ...facts, currentStage: e.target.value })} placeholder="Supplement review" />
        </Field>
        <Field label="Days in stage">
          <Input value={facts.stageAgeDays} onChange={(e) => setFacts({ ...facts, stageAgeDays: e.target.value })} placeholder="23" />
        </Field>
      </div>
      <Button className="mt-4 gap-2" onClick={() => setRun(true)}>
        <Sparkles className="size-4" /> Analyze recovery potential
      </Button>

      {opportunities && (
        <div className="mt-6 flex flex-col gap-3">
          {opportunities.length === 0 && (
            <p className="rounded-lg border border-teal-600/25 bg-teal-600/5 p-3 text-sm">
              No recovery opportunities detected from the current facts — the claim looks
              consistent. Keep the evidence set complete regardless.
            </p>
          )}
          {opportunities.map((o, i) => (
            <div
              key={i}
              className={cn(
                "rounded-lg border p-4",
                o.severity === "high"
                  ? "border-amber-600/30 bg-amber-600/5"
                  : "border-border/70 bg-card/50",
              )}
            >
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-semibold">{o.title}</p>
                <Badge
                  className={cn(
                    o.severity === "high" && "bg-amber-600/15 text-amber-700 dark:text-amber-300",
                  )}
                >
                  {o.severity}
                </Badge>
                <span className="ml-auto text-xs text-muted-foreground">
                  confidence {Math.round(o.confidence * 100)}%
                </span>
              </div>
              <p className="mt-2 text-sm leading-6">{o.explanation}</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                <span className="font-medium text-foreground">Financial relevance:</span>{" "}
                {o.financialRelevance}
              </p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {o.evidence.map((e) => (
                  <Badge key={e} variant="outline" className="font-normal">
                    {e}
                  </Badge>
                ))}
              </div>
              <p className="mt-3 text-xs leading-5 text-teal-700 dark:text-teal-300">
                Next step: {o.recommendedNextStep}
              </p>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Small shared bits
// ---------------------------------------------------------------------------

function CoverageStateBadge({ state }: { state: string }) {
  const tone =
    state === "Production-ready"
      ? "bg-teal-600/15 text-teal-700 dark:text-teal-300"
      : state === "Deep"
        ? "bg-emerald-600/15 text-emerald-700 dark:text-emerald-300"
        : state === "Developing"
          ? "bg-amber-600/15 text-amber-700 dark:text-amber-300"
          : "bg-muted text-muted-foreground";
  return (
    <Badge className={cn("font-normal", tone)}>{state}</Badge>
  );
}

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("flex flex-col gap-1.5", className)}>
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <span className="flex items-center gap-1.5 text-sm">{value}</span>
    </div>
  );
}
