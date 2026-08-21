import { api } from "@/lib/api";
import { PageHeader, titleCase } from "@/components/atlas-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useMutation, useQuery } from "@/hooks/use-supabase";
import {
  Building2,
  Check,
  KeyRound,
  Loader2,
  Mail,
  Plus,
  ServerCog,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { getSupabaseClient } from "@/lib/supabase";

const SIZES = ["1–10", "11–50", "51–200", "201–500", "501–2000", "2000+"];
const INDUSTRIES = [
  "Insurance restoration",
  "Construction",
  "Legal services",
  "Healthcare services",
  "Roofing",
  "Mitigation & water damage",
  "Property services",
  "Financial services",
  "Other",
];

export default function Settings() {
  const workspace = useQuery(api.tenants.getMyWorkspace);
  const updateCompanyProfile = useMutation(api.onboarding.updateCompanyProfile);
  const saveCompanySystem = useMutation(api.onboarding.saveCompanySystem);

  const profile = workspace?.profile ?? null;

  const [form, setForm] = useState(() => ({
    companyName: profile?.companyName ?? "",
    industry: profile?.industry ?? "",
    subIndustry: profile?.subIndustry ?? "",
    country: profile?.country ?? "",
    stateProvince: profile?.stateProvince ?? "",
    city: profile?.city ?? "",
    operatingGeography: profile?.operatingGeography ?? "",
    companySize: profile?.companySize ?? "",
    employeeCount: profile?.employeeCount ? String(profile.employeeCount) : "",
    businessModel: profile?.businessModel ?? "",
    servicesProducts: (profile?.servicesProducts ?? []).join(", "),
    website: profile?.website ?? "",
  }));

  const [sysForm, setSysForm] = useState({ name: "", category: "", vendor: "", status: "active" as "active" | "planned" | "none" });
  const [saving, setSaving] = useState(false);

  // Populate the form once the workspace profile arrives (without clobbering edits).
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
      employeeCount: f.employeeCount || String(profile.employeeCount ?? ""),
      businessModel: f.businessModel || profile.businessModel || "",
      servicesProducts: f.servicesProducts || (profile.servicesProducts ?? []).join(", "),
      website: f.website || profile.website || "",
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile]);

  const saveProfile = async () => {
    setSaving(true);
    try {
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
        servicesProducts: String(form.servicesProducts ?? "").split(",").map((s) => s.trim()).filter(Boolean),
        website: form.website || undefined,
      });
      toast.success("Company profile saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save profile");
    } finally {
      setSaving(false);
    }
  };

  const addSystem = async () => {
    if (!sysForm.name.trim()) {
      toast.error("System name is required");
      return;
    }
    try {
      await saveCompanySystem({
        name: sysForm.name.trim(),
        category: sysForm.category || undefined,
        vendor: sysForm.vendor || undefined,
        status: sysForm.status,
      });
      toast.success("System added");
      setSysForm({ name: "", category: "", vendor: "", status: "active" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to add system");
    }
  };

  const set = (key: keyof typeof form, value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  // Stable names + standard autofill tokens (organization, url, addresses)
  // keep browser/extension autofill working without clobbering other fields.
  const AUTOCOMPLETE: Partial<Record<keyof typeof form, string>> = {
    companyName: "organization",
    website: "url",
    city: "address-level2",
    stateProvince: "address-level1",
  };

  const field = (key: keyof typeof form, label: string, placeholder: string, type = "text") => (
    <div className="space-y-1.5">
      <Label htmlFor={`s-${key}`} className="text-xs font-medium text-muted-foreground">
        {label}
      </Label>
      <Input
        id={`s-${key}`}
        name={`s-${key}`}
        type={type}
        value={form[key]}
        placeholder={placeholder}
        autoComplete={AUTOCOMPLETE[key] ?? "off"}
        onChange={(e) => set(key, e.target.value)}
      />
    </div>
  );

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Workspace Settings"
        title="Company profile & environment"
        description="Atlas uses this context to pick intelligence packs and calibrate expectations."
      />

      {/* Company profile */}
      <section className="rounded-xl border border-border/70 bg-card/60 p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Building2 className="size-4 text-teal-600 dark:text-teal-300" />
          Company profile
        </h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {field("companyName", "Company name", "e.g. Northshore Restoration Inc.")}
          <div className="space-y-1.5">
            <Label htmlFor="s-industry" className="text-xs font-medium text-muted-foreground">
              Industry
            </Label>
            <Select value={form.industry} onValueChange={(v) => set("industry", v)}>
              <SelectTrigger id="s-industry" name="s-industry">
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
          {field("subIndustry", "Sub-industry", "e.g. Water & fire restoration")}
          <div className="space-y-1.5">
            <Label htmlFor="s-country" className="text-xs font-medium text-muted-foreground">
              Country
            </Label>
            <Select value={form.country} onValueChange={(v) => set("country", v)}>
              <SelectTrigger id="s-country" name="s-country">
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
          {field("stateProvince", "State / province", "e.g. Texas")}
          {field("city", "City", "e.g. Austin")}
          {field("operatingGeography", "Operating geography", "e.g. Central Texas")}
          <div className="space-y-1.5">
            <Label htmlFor="s-size" className="text-xs font-medium text-muted-foreground">
              Company size
            </Label>
            <Select value={form.companySize} onValueChange={(v) => set("companySize", v)}>
              <SelectTrigger id="s-size" name="s-size">
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
          {field("employeeCount", "Exact headcount", "e.g. 34", "number")}
          {field("businessModel", "Business model", "e.g. B2B services")}
          {field("website", "Website", "https://…")}
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="s-services" className="text-xs font-medium text-muted-foreground">
              Services / products (comma separated)
            </Label>
            <Input
              id="s-services"
              name="s-services"
              value={form.servicesProducts}
              placeholder="Mitigation, reconstruction, roofing"
              autoComplete="off"
              onChange={(e) => set("servicesProducts", e.target.value)}
            />
          </div>
        </div>
        <div className="mt-5 flex justify-end">
          <Button onClick={saveProfile} disabled={saving} className="gap-2">
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
            Save profile
          </Button>
        </div>
      </section>

      {/* Account Security */}
      <AccountSecurity />

      {/* Systems */}
      <section className="rounded-xl border border-border/70 bg-card/60 p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <ServerCog className="size-4 text-cyan-600 dark:text-cyan-300" />
          Operating systems
        </h2>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          The systems your company operates with — these feed the Connection Engine plan.
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(workspace?.systems ?? []).map((s) => (
            <div
              key={s._id}
              className="flex items-center justify-between gap-2 rounded-lg border border-border/60 bg-muted/20 px-3 py-2.5"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{s.name}</p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {s.category ? titleCase(s.category) : "—"}
                  {s.vendor ? ` · ${s.vendor}` : ""}
                </p>
              </div>
              <Badge
                variant="outline"
                className={
                  s.status === "active"
                    ? "border-emerald-400/30 bg-emerald-400/10 font-mono text-[10px] text-emerald-600 dark:text-emerald-300"
                    : "border-amber-400/30 bg-amber-400/10 font-mono text-[10px] text-amber-600 dark:text-amber-300"
                }
              >
                {s.status}
              </Badge>
            </div>
          ))}
          {(workspace?.systems ?? []).length === 0 && (
            <p className="col-span-full text-sm text-muted-foreground">
              No systems mapped yet. Add the ones you use below.
            </p>
          )}
        </div>

        <div className="mt-4 grid gap-3 rounded-lg border border-border/60 bg-muted/20 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1.5">
            <Label htmlFor="sys-name" className="text-xs font-medium text-muted-foreground">
              System name
            </Label>
            <Input
              id="sys-name"
              name="sys-name"
              value={sysForm.name}
              placeholder="e.g. QuickBooks"
              autoComplete="off"
              onChange={(e) => setSysForm((f) => ({ ...f, name: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sys-cat" className="text-xs font-medium text-muted-foreground">
              Category
            </Label>
            <Input
              id="sys-cat"
              name="sys-cat"
              value={sysForm.category}
              placeholder="e.g. accounting"
              autoComplete="off"
              onChange={(e) => setSysForm((f) => ({ ...f, category: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sys-vendor" className="text-xs font-medium text-muted-foreground">
              Vendor
            </Label>
            <Input
              id="sys-vendor"
              name="sys-vendor"
              value={sysForm.vendor}
              placeholder="e.g. Intuit"
              autoComplete="off"
              onChange={(e) => setSysForm((f) => ({ ...f, vendor: e.target.value }))}
            />
          </div>
          <div className="flex items-end gap-2">
            <Select
              value={sysForm.status}
              onValueChange={(v) =>
                setSysForm((f) => ({ ...f, status: v as "active" | "planned" | "none" }))
              }
            >
              <SelectTrigger
                className="h-9"
                name="sys-status"
                aria-label="System status"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">In use</SelectItem>
                <SelectItem value="planned">Planned</SelectItem>
                <SelectItem value="none">None</SelectItem>
              </SelectContent>
            </Select>
            <Button onClick={addSystem} variant="outline" className="gap-1.5">
              <Plus className="size-3.5" />
              Add
            </Button>
          </div>
        </div>
      </section>

      <p className="flex items-center gap-1.5 text-xs text-muted-foreground/60">
        <Trash2 className="size-3" />
        Removing systems is available to workspace owners through the administrative console.
      </p>
    </div>
  );
}

function AccountSecurity() {
  const [passwordForm, setPasswordForm] = useState({
    newPassword: "",
    confirmPassword: "",
  });
  const [emailForm, setEmailForm] = useState({ newEmail: "" });
  const [changingPassword, setChangingPassword] = useState(false);
  const [changingEmail, setChangingEmail] = useState(false);

  const handleChangePassword = async () => {
    if (!passwordForm.newPassword) {
      toast.error("Password is required");
      return;
    }
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }
    if (passwordForm.newPassword.length < 8) {
      toast.error("Password must be at least 8 characters");
      return;
    }
    setChangingPassword(true);
    try {
      const supabase = getSupabaseClient();
      if (!supabase) throw new Error("Supabase not configured");
      const { error } = await supabase.auth.updateUser({
        password: passwordForm.newPassword,
      });
      if (error) throw error;
      toast.success("Password updated");
      setPasswordForm({ newPassword: "", confirmPassword: "" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update password");
    } finally {
      setChangingPassword(false);
    }
  };

  const handleChangeEmail = async () => {
    if (!emailForm.newEmail) {
      toast.error("New email is required");
      return;
    }
    setChangingEmail(true);
    try {
      const supabase = getSupabaseClient();
      if (!supabase) throw new Error("Supabase not configured");
      const { error } = await supabase.auth.updateUser({
        email: emailForm.newEmail,
      });
      if (error) throw error;
      toast.success("Verification email sent. Check your inbox.");
      setEmailForm({ newEmail: "" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update email");
    } finally {
      setChangingEmail(false);
    }
  };

  return (
    <section className="rounded-xl border border-border/70 bg-card/60 p-5">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <ShieldCheck className="size-4 text-teal-600 dark:text-teal-300" />
        Account Security
      </h2>

      {/* Password */}
      <div className="mt-4 space-y-3">
        <h3 className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <KeyRound className="size-3.5" />
          Change Password
        </h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-xs">New Password</Label>
            <Input
              type="password"
              value={passwordForm.newPassword}
              onChange={(e) =>
                setPasswordForm((p) => ({ ...p, newPassword: e.target.value }))
              }
              placeholder="Min 8 characters"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Confirm Password</Label>
            <Input
              type="password"
              value={passwordForm.confirmPassword}
              onChange={(e) =>
                setPasswordForm((p) => ({ ...p, confirmPassword: e.target.value }))
              }
              placeholder="Confirm new password"
            />
          </div>
        </div>
        <div className="flex justify-end">
          <Button
            variant="outline"
            size="sm"
            disabled={changingPassword}
            onClick={handleChangePassword}
          >
            {changingPassword ? (
              <Loader2 className="mr-1 size-3 animate-spin" />
            ) : (
              <KeyRound className="mr-1 size-3" />
            )}
            Update Password
          </Button>
        </div>
      </div>

      {/* Email */}
      <div className="mt-5 space-y-3 border-t border-border/60 pt-5">
        <h3 className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <Mail className="size-3.5" />
          Change Email
        </h3>
        <p className="text-[11px] text-muted-foreground/70">
          A verification email will be sent to confirm the change.
        </p>
        <div className="flex gap-3">
          <Input
            type="email"
            value={emailForm.newEmail}
            onChange={(e) => setEmailForm({ newEmail: e.target.value })}
            placeholder="new-email@example.com"
            className="max-w-sm"
          />
          <Button
            variant="outline"
            size="sm"
            disabled={changingEmail}
            onClick={handleChangeEmail}
          >
            {changingEmail ? (
              <Loader2 className="mr-1 size-3 animate-spin" />
            ) : (
              <Mail className="mr-1 size-3" />
            )}
            Update Email
          </Button>
        </div>
      </div>
    </section>
  );
}
