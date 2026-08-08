import { api } from "@/convex/_generated/api";
import { INDUSTRY_BRANCHES } from "@/convex/data/packs";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useMutation, useQuery } from "convex/react";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  CheckCircle2,
  ChevronRight,
  Globe2,
  Layers,
  Loader2,
  Radar,
  Rocket,
  ServerCog,
  Sparkles,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";

const SYSTEM_PRESETS = [
  { name: "CRM", category: "crm", vendor: "e.g. HubSpot, JobNimbus" },
  { name: "Accounting", category: "accounting", vendor: "e.g. QuickBooks, Xero" },
  { name: "Job management", category: "job_management", vendor: "e.g. DASH, ServiceTitan" },
  { name: "Field software", category: "field", vendor: "e.g. CompanyCam, FieldPulse" },
  { name: "Google Drive", category: "document_storage", vendor: "Google" },
  { name: "Microsoft 365", category: "document_storage", vendor: "Microsoft" },
  { name: "Email", category: "email", vendor: "e.g. Outlook, Gmail" },
  { name: "Estimating", category: "estimating", vendor: "e.g. Xactimate, Symbility" },
];

const STEPS = [
  { label: "Workspace", icon: Building2 },
  { label: "Company", icon: Globe2 },
  { label: "Systems", icon: ServerCog },
  { label: "Initialize", icon: Rocket },
];

const SIZES = ["1–10", "11–50", "51–200", "201–500", "501–2000", "2000+"];
const INDUSTRIES = [
  "Insurance restoration",
  "Construction",
  "Roofing",
  "Mitigation & water damage",
  "Property services",
  "Property management",
  "Real estate",
  "Solar & renewables",
  "Manufacturing",
  "Logistics & supply chain",
  "Software / SaaS",
  "Financial services",
  "Professional services",
  "Legal services",
  "Healthcare services",
  "Other",
];

export default function Setup() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const workspace = useQuery(api.tenants.getMyWorkspace);

  const createTenant = useMutation(api.tenants.createTenant);
  const updateCompanyProfile = useMutation(api.onboarding.updateCompanyProfile);
  const saveCompanySystem = useMutation(api.onboarding.saveCompanySystem);
  const completeOnboarding = useMutation(api.onboarding.completeOnboarding);
  const seedIntelligence = useMutation(api.intelligence.seedIntelligence);

  const profile = workspace?.profile ?? null;

  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Workspace name
  const [workspaceName, setWorkspaceName] = useState("");

  // Company profile
  const [form, setForm] = useState({
    companyName: "",
    industry: "",
    subIndustry: "",
    country: "",
    stateProvince: "",
    city: "",
    operatingGeography: "",
    companySize: "",
    employeeCount: "",
    businessModel: "",
    servicesProducts: "",
    website: "",
  });

  // Systems
  const [systems, setSystems] = useState<Record<string, "active" | "planned" | "none">>(
    Object.fromEntries(SYSTEM_PRESETS.map((s) => [s.name, "none"])),
  );

  // Sync form from existing profile once available.
  useEffect(() => {
    if (!profile) return;
    setForm((f) => ({
      ...f,
      companyName: f.companyName || profile.companyName || "",
      industry: f.industry || profile.industry || "",
      subIndustry: f.subIndustry || profile.subIndustry || "",
      country: f.country || profile.country || "",
      stateProvince: f.stateProvince || profile.stateProvince || "",
      city: f.city || profile.city || "",
      operatingGeography: f.operatingGeography || profile.operatingGeography || "",
      companySize: f.companySize || profile.companySize || "",
      employeeCount: f.employeeCount ? f.employeeCount : String(profile.employeeCount ?? ""),
      businessModel: f.businessModel || profile.businessModel || "",
      servicesProducts: f.servicesProducts || (profile.servicesProducts ?? []).join(", "),
      website: f.website || profile.website || "",
    }));
    // Prefill systems that already exist.
    setSystems((s) => {
      const next = { ...s };
      for (const sys of workspace?.systems ?? []) {
        if (sys.name in next) next[sys.name] = sys.status;
      }
      return next;
    });
    if (profile.onboardingComplete) {
      navigate("/dashboard", { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, workspace]);

  const branchQuestions = useMemo(
    () => (form.industry ? INDUSTRY_BRANCHES[form.industry.toLowerCase()] : undefined),
    [form.industry],
  );
  const [branchAnswers, setBranchAnswers] = useState<Record<string, string>>({});

  const loading = workspace === undefined;

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </main>
    );
  }

  const needsWorkspace = workspace === null;

  const saveProfile = async () => {
    await updateCompanyProfile({
      companyName: form.companyName || undefined,
      industry: form.industry || undefined,
      subIndustry: form.subIndustry || undefined,
      country: form.country || undefined,
      stateProvince: form.stateProvince || undefined,
      city: form.city || undefined,
      operatingGeography: form.operatingGeography || undefined,
      companySize: form.companySize || undefined,
      employeeCount: form.employeeCount ? Number(form.employeeCount) : undefined,
      businessModel: form.businessModel || undefined,
      servicesProducts: form.servicesProducts
        ? form.servicesProducts.split(",").map((s) => s.trim()).filter(Boolean)
        : undefined,
      website: form.website || undefined,
      onboardingStep: 2,
    });
  };

  const goNext = async () => {
    setError(null);
    try {
      if (step === 1 && needsWorkspace) {
        if (!workspaceName.trim()) {
          setError("Give your workspace a name to continue.");
          return;
        }
        setBusy("creating");
        await createTenant({ name: workspaceName.trim() });
        setStep(2);
      } else if (step === 2) {
        if (!form.companyName.trim()) {
          setError("Company name is required.");
          return;
        }
        setBusy("saving");
        await saveProfile();
        setStep(3);
      } else if (step === 3) {
        setBusy("saving");
        for (const sys of SYSTEM_PRESETS) {
          const status = systems[sys.name];
          if (status !== "none") {
            await saveCompanySystem({ name: sys.name, category: sys.category, vendor: sys.vendor, status });
          }
        }
        setStep(4);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(null);
    }
  };

  const initialize = async () => {
    setBusy("initializing");
    setError(null);
    try {
      if (branchQuestions && !needsWorkspace) {
        await updateCompanyProfile({
          onboardingStep: 3,
          servicesProducts: Object.values(branchAnswers).filter(Boolean),
        });
      }
      await seedIntelligence();
      await completeOnboarding();
      navigate("/dashboard", { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Initialization failed.");
      setBusy(null);
    }
  };

  const systemCount = Object.values(systems).filter((s) => s !== "none").length;

  const input = (key: keyof typeof form, label: string, placeholder: string, type = "text") => (
    <div className="space-y-1.5">
      <Label htmlFor={key} className="text-xs font-medium text-muted-foreground">
        {label}
      </Label>
      <Input
        id={key}
        type={type}
        value={form[key]}
        placeholder={placeholder}
        onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
      />
    </div>
  );

  return (
    <main className="relative min-h-screen overflow-hidden bg-background">
      <div className="atlas-glow-teal pointer-events-none absolute inset-x-0 top-0 h-96" />
      <div className="atlas-grid pointer-events-none absolute inset-0 opacity-40" />

      <div className="relative mx-auto flex min-h-screen w-full max-w-3xl flex-col px-4 py-10">
        {/* Header */}
        <div className="mb-8 flex items-center justify-between">
          <button
            type="button"
            onClick={() => navigate("/")}
            className="flex items-center gap-2.5 text-foreground transition-opacity hover:opacity-80"
          >
            <div className="flex size-9 items-center justify-center rounded-lg bg-teal-400/15 text-teal-600 dark:text-teal-300 ring-1 ring-teal-400/30">
              <Radar className="size-5" />
            </div>
            <span className="text-lg font-semibold tracking-tight">Atlas</span>
          </button>
          {user?.email && (
            <span className="font-mono text-xs text-muted-foreground">{user.email}</span>
          )}
        </div>

        {/* Stepper */}
        <ol className="mb-8 flex items-center gap-2">
          {STEPS.map((s, i) => {
            const Icon = s.icon;
            const n = i + 1;
            const done = step > n;
            const active = step === n;
            return (
              <li key={s.label} className="flex flex-1 items-center gap-2">
                <div
                  className={cn(
                    "flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                    active && "border-teal-400/40 bg-teal-400/10 text-teal-700 dark:text-teal-200",
                    done && "border-emerald-400/30 bg-emerald-400/10 text-emerald-600 dark:text-emerald-300",
                    !active && !done && "border-border/70 text-muted-foreground",
                  )}
                >
                  {done ? <Check className="size-3.5" /> : <Icon className="size-3.5" />}
                  <span className="hidden sm:inline">{s.label}</span>
                </div>
                {i < STEPS.length - 1 && <ChevronRight className="size-3.5 text-border" />}
              </li>
            );
          })}
        </ol>

        <Card className="border-border/70 bg-card/80 shadow-none backdrop-blur">
          <CardHeader className="pb-4">
            <CardTitle className="text-lg">
              {step === 1 && "Create your workspace"}
              {step === 2 && "Tell Atlas about your company"}
              {step === 3 && "Map your operating environment"}
              {step === 4 && "Initialize your intelligence model"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {step === 1 && (
              <div className="space-y-4">
                <p className="text-sm leading-6 text-muted-foreground">
                  Name the company workspace Atlas will learn about. Atlas reads the systems and
                  files you already use — you'll never have to migrate your business into it.
                </p>
                <div className="space-y-1.5">
                  <Label htmlFor="ws-name" className="text-xs font-medium text-muted-foreground">
                    Workspace / company name
                  </Label>
                  <Input
                    id="ws-name"
                    value={workspaceName}
                    placeholder="e.g. Northshore Restoration Inc."
                    onChange={(e) => setWorkspaceName(e.target.value)}
                    autoFocus
                  />
                </div>
                <div className="flex items-start gap-2 rounded-lg border border-teal-400/20 bg-teal-400/5 p-3 text-xs leading-5 text-teal-800/80 dark:text-teal-800 dark:text-teal-100/80">
                  <Sparkles className="mt-0.5 size-3.5 shrink-0 text-teal-600 dark:text-teal-300" />
                  <span>
                    You become the workspace <strong>owner</strong>. You can invite your team at any
                    time and Atlas will role-lock sensitive actions.
                  </span>
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="grid gap-4 sm:grid-cols-2">
                {input("companyName", "Company name *", "e.g. Northshore Restoration Inc.")}
                <div className="space-y-1.5">
                  <Label htmlFor="industry" className="text-xs font-medium text-muted-foreground">
                    Industry
                  </Label>
                  <Select
                    value={form.industry}
                    onValueChange={(v) => setForm((f) => ({ ...f, industry: v }))}
                  >
                    <SelectTrigger id="industry">
                      <SelectValue placeholder="Select industry" />
                    </SelectTrigger>
                    <SelectContent>
                      {INDUSTRIES.map((i) => (
                        <SelectItem key={i} value={i}>
                          {i}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {input("subIndustry", "Sub-industry", "e.g. Water & fire restoration")}
                <div className="space-y-1.5">
                  <Label htmlFor="country" className="text-xs font-medium text-muted-foreground">
                    Country
                  </Label>
                  <Select
                    value={form.country}
                    onValueChange={(v) => setForm((f) => ({ ...f, country: v }))}
                  >
                    <SelectTrigger id="country">
                      <SelectValue placeholder="Country" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="United States">United States</SelectItem>
                      <SelectItem value="Canada">Canada</SelectItem>
                      <SelectItem value="United Kingdom">United Kingdom</SelectItem>
                      <SelectItem value="Australia">Australia</SelectItem>
                      <SelectItem value="Other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {input("stateProvince", "State / province", "e.g. Texas")}
                {input("city", "City", "e.g. Austin")}
                {input("operatingGeography", "Operating geography", "e.g. Central Texas")}
                <div className="space-y-1.5">
                  <Label htmlFor="companySize" className="text-xs font-medium text-muted-foreground">
                    Company size
                  </Label>
                  <Select
                    value={form.companySize}
                    onValueChange={(v) => setForm((f) => ({ ...f, companySize: v }))}
                  >
                    <SelectTrigger id="companySize">
                      <SelectValue placeholder="Employees" />
                    </SelectTrigger>
                    <SelectContent>
                      {SIZES.map((s) => (
                        <SelectItem key={s} value={s}>
                          {s} employees
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {input("employeeCount", "Exact headcount (optional)", "e.g. 34", "number")}
                {input("businessModel", "Business model", "e.g. B2B services, carrier-paid work")}
                {input("website", "Website", "https://…")}
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="servicesProducts" className="text-xs font-medium text-muted-foreground">
                    Services / products (comma separated)
                  </Label>
                  <Input
                    id="servicesProducts"
                    value={form.servicesProducts}
                    placeholder="Mitigation, reconstruction, roofing"
                    onChange={(e) => setForm((f) => ({ ...f, servicesProducts: e.target.value }))}
                  />
                </div>

                {branchQuestions && (
                  <div className="space-y-4 rounded-lg border border-border/70 bg-muted/30 p-4 sm:col-span-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Branching questions — {form.industry}
                    </p>
                    {branchQuestions.map((bq, i) => (
                      <div key={bq.question} className="space-y-2">
                        <Label className="text-sm font-medium">{bq.question}</Label>
                        <div className="flex flex-wrap gap-2">
                          {bq.options.map((opt) => (
                            <button
                              key={opt}
                              type="button"
                              onClick={() =>
                                setBranchAnswers((a) => ({ ...a, [`q${i}`]: opt }))
                              }
                              className={cn(
                                "rounded-full border px-3 py-1 text-xs transition-colors",
                                branchAnswers[`q${i}`] === opt
                                  ? "border-teal-400/50 bg-teal-400/15 text-teal-700 dark:text-teal-200"
                                  : "border-border/70 text-muted-foreground hover:border-teal-400/30 hover:text-teal-700 dark:hover:text-teal-200",
                              )}
                            >
                              {opt}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {step === 3 && (
              <div className="space-y-4">
                <p className="text-sm leading-6 text-muted-foreground">
                  Which systems does your company actually operate with? Atlas uses this to plan
                  connections and set expectations about your data footprint. Choosing "None" is
                  fine — file uploads work on their own.
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  {SYSTEM_PRESETS.map((sys) => (
                    <div
                      key={sys.name}
                      className={cn(
                        "flex items-center justify-between gap-3 rounded-lg border p-3 transition-colors",
                        systems[sys.name] !== "none"
                          ? "border-teal-400/30 bg-teal-400/5"
                          : "border-border/70",
                      )}
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{sys.name}</p>
                        <p className="truncate text-xs text-muted-foreground">{sys.vendor}</p>
                      </div>
                      <Select
                        value={systems[sys.name]}
                        onValueChange={(v) =>
                          setSystems((s) => ({
                            ...s,
                            [sys.name]: v as "active" | "planned" | "none",
                          }))
                        }
                      >
                        <SelectTrigger className="h-8 w-[104px] text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="active">In use</SelectItem>
                          <SelectItem value="planned">Planned</SelectItem>
                          <SelectItem value="none">None</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {step === 4 && (
              <div className="space-y-4">
                <div className="flex items-start gap-2 rounded-lg border border-teal-400/20 bg-teal-400/5 p-3 text-xs leading-5 text-teal-800/80 dark:text-teal-800 dark:text-teal-100/80">
                  <Layers className="mt-0.5 size-3.5 shrink-0 text-teal-600 dark:text-teal-300" />
                  <span>
                    Atlas will activate the <strong>Atlas Core</strong> and{" "}
                    <strong>General Business</strong> packs, plus{" "}
                    {form.industry ? (
                      <strong>{form.industry}</strong>
                    ) : (
                      "industry"
                    )}{" "}
                    intelligence if available and US guidance if you're in the US. The comparison
                    engine starts monitoring your workspace immediately.
                  </span>
                </div>
                <dl className="space-y-2 rounded-lg border border-border/70 p-4 text-sm">
                  {[
                    ["Company", form.companyName || "—"],
                    ["Industry", form.industry || "—"],
                    ["Geography", [form.city, form.stateProvince, form.country].filter(Boolean).join(", ") || "—"],
                    ["Headcount", form.employeeCount || form.companySize || "—"],
                    ["Systems", `${systemCount} mapped`],
                  ].map(([k, v]) => (
                    <div key={k} className="flex items-center justify-between gap-4">
                      <dt className="text-muted-foreground">{k}</dt>
                      <dd className="truncate font-medium text-foreground">{v}</dd>
                    </div>
                  ))}
                </dl>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <CheckCircle2 className="size-4 text-emerald-400" />
                  Workspace profile ready · no documents required to finish setup
                </div>
              </div>
            )}

            {error && (
              <p className="rounded-lg border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-sm text-rose-600 dark:text-rose-300">
                {error}
              </p>
            )}

            <div className="flex items-center justify-between gap-3 pt-2">
              <div className="flex gap-2">
                {step > 1 && (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setStep((s) => s - 1)}
                    disabled={!!busy}
                  >
                    <ArrowLeft className="mr-2 size-4" />
                    Back
                  </Button>
                )}
              </div>
              {step < 4 ? (
                <Button type="button" onClick={goNext} disabled={!!busy}>
                  {busy && <Loader2 className="mr-2 size-4 animate-spin" />}
                  Continue
                  <ArrowRight className="ml-2 size-4" />
                </Button>
              ) : (
                <Button type="button" onClick={initialize} disabled={!!busy}>
                  {busy ? (
                    <>
                      <Loader2 className="mr-2 size-4 animate-spin" />
                      Initializing…
                    </>
                  ) : (
                    <>
                      Initialize Atlas
                      <Rocket className="ml-2 size-4" />
                    </>
                  )}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        <p className="mt-6 text-center font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground/60">
          Atlas · intelligence layer · read · reason · recommend · execute
        </p>
      </div>
    </main>
  );
}
