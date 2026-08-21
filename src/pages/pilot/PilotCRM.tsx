import { api } from "@/lib/api";
import { useMutation, useQuery } from "@/hooks/use-supabase";
import { invalidateQueries } from "@/hooks/use-supabase";
import { PageHeader } from "@/components/atlas-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ArrowRight,
  Building2,
  Calendar,
  Check,
  ExternalLink,
  FileText,
  Loader2,
  Mail,
  MessageSquare,
  MoreHorizontal,
  Phone,
  Plus,
  Search,
  Send,
  Star,
  Tag,
  Trash2,
  Upload,
  User,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { CSVImportDialog } from "@/components/CSVImportDialog";
import { type MappedLead } from "@/lib/crm/csv-import";

const STAGES = [
  { key: "new", label: "New", color: "bg-blue-500" },
  { key: "contacted", label: "Contacted", color: "bg-yellow-500" },
  { key: "replied", label: "Replied", color: "bg-orange-500" },
  { key: "qualified", label: "Qualified", color: "bg-purple-500" },
  { key: "demo_scheduled", label: "Demo", color: "bg-indigo-500" },
  { key: "pilot_invited", label: "Invited", color: "bg-teal-500" },
  { key: "pilot_active", label: "Active", color: "bg-green-500" },
  { key: "won", label: "Won", color: "bg-emerald-600" },
];

const STAGE_COLORS: Record<string, string> = {
  new: "border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400",
  contacted:
    "border-yellow-500/30 bg-yellow-500/10 text-yellow-600 dark:text-yellow-400",
  replied:
    "border-orange-500/30 bg-orange-500/10 text-orange-600 dark:text-orange-400",
  qualified:
    "border-purple-500/30 bg-purple-500/10 text-purple-600 dark:text-purple-400",
  demo_scheduled:
    "border-indigo-500/30 bg-indigo-500/10 text-indigo-600 dark:text-indigo-400",
  pilot_invited:
    "border-teal-500/30 bg-teal-500/10 text-teal-600 dark:text-teal-400",
  pilot_active:
    "border-green-500/30 bg-green-500/10 text-green-600 dark:text-green-400",
  won: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  lost: "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400",
};

export default function PilotCRM() {
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"kanban" | "list">("kanban");
  const [showNewLead, setShowNewLead] = useState(false);
  const [selectedLead, setSelectedLead] = useState<any>(null);
  const [showDetail, setShowDetail] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const leads = useQuery(api.crm.listLeads);
  const tasks = useQuery(api.crm.listTasks);
  const createLead = useMutation(api.crm.createLead);
  const updateLead = useMutation(api.crm.updateLead);
  const deleteLead = useMutation(api.crm.deleteLead);
  const addActivity = useMutation(api.crm.addActivity);
  const createTask = useMutation(api.crm.createTask);

  const filteredLeads = (leads ?? []).filter((l: any) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      (l.company_name ?? "").toLowerCase().includes(s) ||
      (l.contact_name ?? "").toLowerCase().includes(s) ||
      (l.contact_email ?? "").toLowerCase().includes(s)
    );
  });

  const [newLead, setNewLead] = useState({
    companyName: "",
    contactName: "",
    contactEmail: "",
    contactPhone: "",
    website: "",
    source: "",
    notes: "",
  });

  const handleCreateLead = async () => {
    if (!newLead.companyName.trim()) {
      toast.error("Company name is required");
      return;
    }
    try {
      await createLead({
        companyName: newLead.companyName,
        contactName: newLead.contactName || undefined,
        contactEmail: newLead.contactEmail || undefined,
        contactPhone: newLead.contactPhone || undefined,
        website: newLead.website || undefined,
        source: newLead.source || undefined,
        notes: newLead.notes || undefined,
      });
      toast.success("Lead created");
      setShowNewLead(false);
      setNewLead({
        companyName: "",
        contactName: "",
        contactEmail: "",
        contactPhone: "",
        website: "",
        source: "",
        notes: "",
      });
      invalidateQueries();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create lead");
    }
  };

  const handleStageChange = async (leadId: string, newStage: string) => {
    try {
      await updateLead({ leadId, pipelineStage: newStage });
      invalidateQueries();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update");
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredLeads.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredLeads.map((l: any) => l.id)));
    }
  };

  const handleBulkStageChange = async (stage: string) => {
    for (const id of selectedIds) {
      try {
        await updateLead({ leadId: id, pipelineStage: stage });
      } catch {
        // continue
      }
    }
    setSelectedIds(new Set());
    invalidateQueries();
    toast.success(`Updated ${selectedIds.size} leads to ${stage}`);
  };

  const handleImportComplete = async (leads: MappedLead[], _batchId: string) => {
    for (const lead of leads) {
      try {
        await createLead({
          companyName: lead.companyName,
          contactName: lead.fullName || undefined,
          contactEmail: lead.email || undefined,
          contactPhone: lead.phone || undefined,
          website: lead.website || undefined,
          source: lead.source || undefined,
          notes: lead.notes || undefined,
        });
      } catch {
        // continue — individual failures shouldn't stop the batch
      }
    }
    invalidateQueries();
  };

  const openDetail = (lead: any) => {
    setSelectedLead(lead);
    setShowDetail(true);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="CRM"
        description={`${leads?.length ?? 0} leads in pipeline`}
        actions={        <div className="flex items-center gap-2">
          {selectedIds.size > 0 && (
            <div className="flex items-center gap-2 mr-2">
              <span className="text-xs text-muted-foreground">
                {selectedIds.size} selected
              </span>
              <select
                className="h-8 rounded-md border border-border bg-background px-2 text-xs"
                defaultValue=""
                onChange={(e) => {
                  if (e.target.value) {
                    handleBulkStageChange(e.target.value);
                    e.target.value = "";
                  }
                }}
              >
                <option value="" disabled>
                  Move to...
                </option>
                {STAGES.map((s) => (
                  <option key={s.key} value={s.key}>
                    → {s.label}
                  </option>
                ))}
              </select>
            </div>
          )}
          <Button
            variant={view === "kanban" ? "default" : "outline"}
            size="sm"
            onClick={() => setView("kanban")}
          >
            Pipeline
          </Button>
          <Button
            variant={view === "list" ? "default" : "outline"}
            size="sm"
            onClick={() => setView("list")}
          >
            List
          </Button>
          <Button size="sm" variant="outline" onClick={() => setShowImport(true)}>
            <Upload className="mr-1 size-3" />
            Import CSV
          </Button>
          <Button size="sm" onClick={() => setShowNewLead(true)}>
            <Plus className="mr-1 size-3" />
            Add Lead
          </Button>
        </div>}
      />

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search leads..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Pipeline View */}
      {view === "kanban" ? (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {STAGES.map((stage) => {
            const stageLeads = filteredLeads.filter(
              (l: any) => l.pipeline_stage === stage.key,
            );
            return (
              <div
                key={stage.key}
                className="min-w-[220px] flex-1"
              >
                <div className="mb-2 flex items-center gap-2">
                  <div className={`size-2 rounded-full ${stage.color}`} />
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    {stage.label}
                  </span>
                  <span className="font-mono text-[10px] text-muted-foreground/60">
                    {stageLeads.length}
                  </span>
                </div>
                <div className="space-y-2">
                  {stageLeads.map((lead: any) => (
                    <LeadCard
                      key={lead.id}
                      lead={lead}
                      onOpen={() => openDetail(lead)}
                      onMoveNext={
                        lead.pipeline_stage !== "won"
                          ? () => {
                              const nextIdx =
                                STAGES.findIndex(
                                  (s) => s.key === lead.pipeline_stage,
                                ) + 1;
                              if (nextIdx < STAGES.length) {
                                handleStageChange(
                                  lead.id,
                                  STAGES[nextIdx].key,
                                );
                              }
                            }
                          : undefined
                      }
                    />
                  ))}
                  {stageLeads.length === 0 && (
                    <div className="rounded-lg border border-dashed border-border/40 p-3 text-center">
                      <p className="text-[11px] text-muted-foreground/50">
                        No leads
                      </p>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* List View */
        <div className="space-y-2">
          {filteredLeads.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <p className="text-sm text-muted-foreground">
                  {search ? "No leads match." : "No leads yet."}
                </p>
              </CardContent>
            </Card>
          ) : (
            filteredLeads.map((lead: any) => (
              <div
                key={lead.id}
                className="flex items-center gap-4 rounded-xl border border-border/60 bg-card p-4 cursor-pointer hover:border-teal-400/30 transition-colors"
                onClick={() => openDetail(lead)}
              >
                <input
                  type="checkbox"
                  checked={selectedIds.has(lead.id)}
                  onChange={() => toggleSelect(lead.id)}
                  onClick={(e) => e.stopPropagation()}
                  className="size-3.5 shrink-0 accent-teal-600"
                />
                <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted/50 text-sm font-semibold">
                  {(lead.company_name ?? "?")[0]?.toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground truncate">
                    {lead.company_name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {lead.contact_name || "No contact"} ·{" "}
                    {lead.contact_email || "No email"}
                  </p>
                </div>
                <Badge
                  variant="outline"
                  className={`shrink-0 text-[10px] ${STAGE_COLORS[lead.pipeline_stage] ?? ""}`}
                >
                  {STAGES.find((s) => s.key === lead.pipeline_stage)?.label ??
                    lead.pipeline_stage}
                </Badge>
                {lead.next_follow_up_at && (
                  <span className="hidden text-[11px] text-muted-foreground sm:block">
                    Follow up{" "}
                    {new Date(lead.next_follow_up_at).toLocaleDateString()}
                  </span>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* CSV Import Dialog */}
      <CSVImportDialog
        open={showImport}
        onClose={() => setShowImport(false)}
        onImportComplete={handleImportComplete}
        existingLeads={(leads ?? []).map((l: any) => ({
          id: l.id,
          contact_email: l.contact_email,
          company_name: l.company_name,
        }))}
      />

      {/* New Lead Dialog */}
      <Dialog open={showNewLead} onOpenChange={setShowNewLead}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add Lead</DialogTitle>
            <DialogDescription>Create a new CRM lead.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <FormField
              label="Company Name"
              required
              value={newLead.companyName}
              onChange={(v) => setNewLead((p) => ({ ...p, companyName: v }))}
              placeholder="ABC Roofing & Restoration"
            />
            <div className="grid grid-cols-2 gap-4">
              <FormField
                label="Contact Name"
                value={newLead.contactName}
                onChange={(v) => setNewLead((p) => ({ ...p, contactName: v }))}
                placeholder="John Smith"
              />
              <FormField
                label="Contact Email"
                type="email"
                value={newLead.contactEmail}
                onChange={(v) =>
                  setNewLead((p) => ({ ...p, contactEmail: v }))
                }
                placeholder="john@abc.com"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <FormField
                label="Phone"
                value={newLead.contactPhone}
                onChange={(v) =>
                  setNewLead((p) => ({ ...p, contactPhone: v }))
                }
                placeholder="(555) 123-4567"
              />
              <FormField
                label="Website"
                value={newLead.website}
                onChange={(v) => setNewLead((p) => ({ ...p, website: v }))}
                placeholder="https://abc.com"
              />
            </div>
            <FormField
              label="Source"
              value={newLead.source}
              onChange={(v) => setNewLead((p) => ({ ...p, source: v }))}
              placeholder="Referral, website, outreach..."
            />
            <div className="space-y-1.5">
              <Label className="text-xs">Notes</Label>
              <Textarea
                value={newLead.notes}
                onChange={(e) =>
                  setNewLead((p) => ({ ...p, notes: e.target.value }))
                }
                placeholder="Internal notes..."
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNewLead(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateLead}>Create Lead</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Lead Detail Dialog */}
      <Dialog open={showDetail} onOpenChange={setShowDetail}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          {selectedLead && (
            <LeadDetail
              lead={selectedLead}
              tasks={(tasks ?? []).filter(
                (t: any) => t.lead_id === selectedLead.id,
              )}
              onClose={() => {
                setShowDetail(false);
                setSelectedLead(null);
              }}
              onStageChange={handleStageChange}
              onAddActivity={addActivity}
              onCreateTask={createTask}
              onDelete={deleteLead}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function LeadCard({
  lead,
  onOpen,
  onMoveNext,
}: {
  lead: any;
  onOpen: () => void;
  onMoveNext?: () => void;
}) {
  return (
    <div
      className="rounded-lg border border-border/60 bg-card p-3 transition-colors hover:border-teal-400/30 cursor-pointer"
      onClick={onOpen}
    >
      <p className="text-sm font-medium text-foreground truncate">
        {lead.company_name}
      </p>
      <p className="mt-0.5 text-xs text-muted-foreground truncate">
        {lead.contact_name || "No contact"}
      </p>
      <div className="mt-2 flex items-center justify-between">
        {lead.contact_email && (
          <span className="text-[10px] text-muted-foreground/70 truncate max-w-[120px]">
            {lead.contact_email}
          </span>
        )}
        {onMoveNext && (
          <button
            type="button"
            className="text-[10px] text-teal-600 hover:text-teal-500 dark:text-teal-300"
            onClick={(e) => {
              e.stopPropagation();
              onMoveNext();
            }}
          >
            Move →
          </button>
        )}
      </div>
    </div>
  );
}

function LeadDetail({
  lead,
  tasks,
  onClose,
  onStageChange,
  onAddActivity,
  onCreateTask,
  onDelete,
}: {
  lead: any;
  tasks: any[];
  onClose: () => void;
  onStageChange: (id: string, stage: string) => void;
  onAddActivity: any;
  onCreateTask: any;
  onDelete: any;
}) {
  const [activityType, setActivityType] = useState("note");
  const [activityText, setActivityText] = useState("");
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDate, setTaskDate] = useState("");
  const [taskType, setTaskType] = useState("follow_up");

  const handleAddActivity = async () => {
    if (!activityText.trim()) return;
    await onAddActivity({
      leadId: lead.id,
      activityType,
      title: activityType.replace("_", " "),
      description: activityText,
    });
    setActivityText("");
    invalidateQueries();
  };

  const handleCreateTask = async () => {
    if (!taskTitle.trim()) return;
    await onCreateTask({
      leadId: lead.id,
      title: taskTitle,
      taskType,
      dueDate: taskDate || undefined,
    });
    setTaskTitle("");
    setTaskDate("");
    invalidateQueries();
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{lead.company_name}</DialogTitle>
        <DialogDescription>
          {lead.contact_name || "No contact"} · {lead.contact_email || ""}
        </DialogDescription>
      </DialogHeader>

      {/* Stage */}
      <div className="flex flex-wrap gap-2">
        {STAGES.map((stage) => (
          <button
            key={stage.key}
            type="button"
            onClick={() => onStageChange(lead.id, stage.key)}
            className={`rounded-lg px-2.5 py-1 text-[11px] font-medium transition-colors ${
              lead.pipeline_stage === stage.key
                ? `ring-2 ring-offset-1 ${STAGE_COLORS[stage.key] ?? "bg-muted"}`
                : "border border-border/60 text-muted-foreground hover:border-teal-400/30"
            }`}
          >
            {stage.label}
          </button>
        ))}
      </div>

      {/* Info */}
      <div className="grid grid-cols-2 gap-3 text-sm">
        {lead.contact_phone && (
          <div>
            <p className="text-[11px] text-muted-foreground">Phone</p>
            <p>{lead.contact_phone}</p>
          </div>
        )}
        {lead.website && (
          <div>
            <p className="text-[11px] text-muted-foreground">Website</p>
            <a
              href={lead.website}
              target="_blank"
              rel="noopener"
              className="text-teal-600 dark:text-teal-300 hover:underline"
            >
              {lead.website}
            </a>
          </div>
        )}
        {lead.source && (
          <div>
            <p className="text-[11px] text-muted-foreground">Source</p>
            <p>{lead.source}</p>
          </div>
        )}
        {lead.contractor_type && (
          <div>
            <p className="text-[11px] text-muted-foreground">Type</p>
            <p>{lead.contractor_type}</p>
          </div>
        )}
      </div>

      {/* Add Activity */}
      <div className="space-y-2 rounded-lg border border-border/60 p-3">
        <p className="text-xs font-medium text-muted-foreground">
          Add Activity
        </p>
        <div className="flex gap-2">
          <Select value={activityType} onValueChange={setActivityType}>
            <SelectTrigger className="w-[120px] h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="note">Note</SelectItem>
              <SelectItem value="call">Call</SelectItem>
              <SelectItem value="email">Email</SelectItem>
              <SelectItem value="meeting">Meeting</SelectItem>
            </SelectContent>
          </Select>
          <Input
            value={activityText}
            onChange={(e) => setActivityText(e.target.value)}
            placeholder="Add a note..."
            className="h-8 text-xs"
            onKeyDown={(e) => {
              if (e.key === "Enter") handleAddActivity();
            }}
          />
          <Button
            size="sm"
            variant="outline"
            className="h-8"
            onClick={handleAddActivity}
          >
            <Send className="size-3" />
          </Button>
        </div>
      </div>

      {/* Create Task */}
      <div className="space-y-2 rounded-lg border border-border/60 p-3">
        <p className="text-xs font-medium text-muted-foreground">
          Create Task
        </p>
        <div className="flex gap-2">
          <Input
            value={taskTitle}
            onChange={(e) => setTaskTitle(e.target.value)}
            placeholder="Task title..."
            className="h-8 text-xs flex-1"
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreateTask();
            }}
          />
          <Input
            type="date"
            value={taskDate}
            onChange={(e) => setTaskDate(e.target.value)}
            className="h-8 text-xs w-[130px]"
          />
          <Button
            size="sm"
            variant="outline"
            className="h-8"
            onClick={handleCreateTask}
          >
            <Plus className="size-3" />
          </Button>
        </div>
      </div>

      {/* Tasks */}
      {tasks.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">Tasks</p>
          {tasks.map((t: any) => (
            <div key={t.id} className="flex items-center gap-2 text-xs">
              <div
                className={`size-3 rounded border ${t.status === "completed" ? "border-green-500 bg-green-500" : "border-muted-foreground/40"}`}
              />
              <span
                className={
                  t.status === "completed"
                    ? "text-muted-foreground line-through"
                    : ""
                }
              >
                {t.title}
              </span>
              {t.due_date && (
                <span className="text-muted-foreground/60">
                  {new Date(t.due_date).toLocaleDateString()}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Notes */}
      {lead.notes && (
        <div>
          <p className="text-xs font-medium text-muted-foreground">Notes</p>
          <p className="text-sm text-foreground/80">{lead.notes}</p>
        </div>
      )}

      <DialogFooter>
        <Button
          variant="destructive"
          size="sm"
          onClick={async () => {
            await onDelete({ leadId: lead.id });
            onClose();
            invalidateQueries();
          }}
        >
          <Trash2 className="mr-1 size-3" />
          Delete
        </Button>
      </DialogFooter>
    </>
  );
}

function FormField({
  label,
  type = "text",
  required,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  type?: string;
  required?: boolean;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">
        {label} {required && <span className="text-red-500">*</span>}
      </Label>
      <Input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-9"
      />
    </div>
  );
}
