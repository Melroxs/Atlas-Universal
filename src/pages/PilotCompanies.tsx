import { api } from "@/lib/api";
import type { PilotCompanyRow } from "@/lib/api";
import { PageHeader, EmptyPanel } from "@/components/atlas-ui";
import { useMutation, useQuery } from "@/hooks/use-supabase";
import { invalidateQueries } from "@/hooks/use-supabase";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Building2, Loader2, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

const COMPANY_TYPES = [
  "Roofing",
  "Restoration",
  "General Contractor",
  "Home Improvement",
  "Water Damage",
  "Fire Damage",
  "Other",
];

const COMPANY_SIZES = ["1-5", "6-20", "21-50", "50+"];
const CLAIMS_VOLUMES = ["Low", "Medium", "High"];
const STATUSES = ["prospect", "active", "churned", "archived"] as const;

const STATUS_COLORS: Record<string, string> = {
  prospect: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  active: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",
  churned: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
  archived: "bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-300",
};

function formatDate(d?: string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

interface CompanyForm {
  name: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  website: string;
  companyType: string;
  companySize: string;
  claimsVolume: string;
  notes: string;
}

const EMPTY_FORM: CompanyForm = {
  name: "",
  contactName: "",
  contactEmail: "",
  contactPhone: "",
  website: "",
  companyType: "",
  companySize: "",
  claimsVolume: "",
  notes: "",
};

export default function PilotCompanies() {
  const companies = useQuery(api.pilotIntelligence.listCompanies);
  const createCompany = useMutation(api.pilotIntelligence.createCompany);
  const deleteCompany = useMutation(api.pilotIntelligence.deleteCompany);

  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState<CompanyForm>(EMPTY_FORM);
  const [busy, setBusy] = useState(false);

  const isLoading = companies === undefined;

  const handleCreate = async () => {
    if (!form.name.trim()) {
      toast.error("Company name is required");
      return;
    }
    setBusy(true);
    try {
      await createCompany({
        name: form.name.trim(),
        contactName: form.contactName.trim() || undefined,
        contactEmail: form.contactEmail.trim() || undefined,
        contactPhone: form.contactPhone.trim() || undefined,
        website: form.website.trim() || undefined,
        companyType: form.companyType || undefined,
        companySize: form.companySize || undefined,
        claimsVolume: form.claimsVolume || undefined,
        notes: form.notes.trim() || undefined,
      });
      invalidateQueries();
      toast.success("Company added");
      setAddOpen(false);
      setForm(EMPTY_FORM);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to add company");
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Remove "${name}"?`)) return;
    try {
      await deleteCompany({ id });
      invalidateQueries();
      toast.success(`${name} removed`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to remove");
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-pulse text-muted-foreground">Loading companies…</div>
      </div>
    );
  }

  const list = companies ?? [];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Pilot Intelligence"
        title="Pilot Companies"
        description="Manage the companies participating in the Atlas pilot program."
        actions={
          <Button onClick={() => setAddOpen(true)}>
            <Plus className="mr-2 size-4" />
            Add Company
          </Button>
        }
      />

      {list.length === 0 ? (
        <EmptyPanel icon={Building2}
          title="No pilot companies yet"
          description="Add your first pilot company to start tracking their journey."
          action={
            <Button onClick={() => setAddOpen(true)}>
              <Plus className="mr-2 size-4" />
              Add Company
            </Button>
          }
        />
      ) : (
        <div className="rounded-xl border border-border/60 bg-card">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/50 text-left text-xs text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Company</th>
                  <th className="px-4 py-3 font-medium">Type</th>
                  <th className="px-4 py-3 font-medium">Size</th>
                  <th className="px-4 py-3 font-medium">Claims</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Contact</th>
                  <th className="px-4 py-3 font-medium">Added</th>
                  <th className="px-4 py-3 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {list.map((co) => (
                  <tr key={co.id} className="border-b border-border/30 hover:bg-muted/20">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="rounded-md bg-blue-100 p-1.5 dark:bg-blue-900/30">
                          <Building2 className="size-3.5 text-blue-600 dark:text-blue-300" />
                        </div>
                        <div>
                          <p className="font-medium">{co.name}</p>
                          {co.website && (
                            <p className="text-[11px] text-muted-foreground">{co.website}</p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{co.company_type ?? "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground">{co.company_size ?? "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground">{co.claims_volume ?? "—"}</td>
                    <td className="px-4 py-3">
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-[10px]",
                          STATUS_COLORS[co.status ?? "prospect"],
                        )}
                      >
                        {co.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {co.contact_name || co.contact_email || "—"}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{formatDate(co.created_at)}</td>
                    <td className="px-4 py-3">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDelete(co.id, co.name)}
                        className="text-destructive/70 hover:text-destructive"
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Add Company Dialog */}
      <Dialog open={addOpen} onOpenChange={(o) => !o && setAddOpen(false)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add Pilot Company</DialogTitle>
            <DialogDescription>
              Add a company to the Atlas pilot program for tracking and intelligence gathering.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label htmlFor="co-name">Company Name *</Label>
              <Input
                id="co-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="ABC Roofing"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="co-contact">Contact Name</Label>
                <Input
                  id="co-contact"
                  value={form.contactName}
                  onChange={(e) => setForm({ ...form, contactName: e.target.value })}
                  placeholder="John Smith"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="co-email">Contact Email</Label>
                <Input
                  id="co-email"
                  type="email"
                  value={form.contactEmail}
                  onChange={(e) => setForm({ ...form, contactEmail: e.target.value })}
                  placeholder="john@abc.com"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="co-phone">Phone</Label>
                <Input
                  id="co-phone"
                  value={form.contactPhone}
                  onChange={(e) => setForm({ ...form, contactPhone: e.target.value })}
                  placeholder="(555) 123-4567"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="co-website">Website</Label>
                <Input
                  id="co-website"
                  value={form.website}
                  onChange={(e) => setForm({ ...form, website: e.target.value })}
                  placeholder="https://abcroofing.com"
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="grid gap-2">
                <Label>Contractor Type</Label>
                <Select
                  value={form.companyType}
                  onValueChange={(v) => setForm({ ...form, companyType: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    {COMPANY_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Company Size</Label>
                <Select
                  value={form.companySize}
                  onValueChange={(v) => setForm({ ...form, companySize: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    {COMPANY_SIZES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Claims Volume</Label>
                <Select
                  value={form.claimsVolume}
                  onValueChange={(v) => setForm({ ...form, claimsVolume: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    {CLAIMS_VOLUMES.map((v) => (
                      <SelectItem key={v} value={v}>
                        {v}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="co-notes">Notes</Label>
              <Input
                id="co-notes"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="Any notes about this pilot company"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={busy || !form.name.trim()}>
              {busy && <Loader2 className="mr-2 size-4 animate-spin" />}
              Add Company
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
