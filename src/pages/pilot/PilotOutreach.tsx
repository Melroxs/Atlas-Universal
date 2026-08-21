import { api } from "@/lib/api";
import { useMutation, useQuery } from "@/hooks/use-supabase";
import { invalidateQueries } from "@/hooks/use-supabase";
import { PageHeader } from "@/components/atlas-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  ArrowRight,
  Copy,
  FileText,
  Loader2,
  Mail,
  Pencil,
  Plus,
  Send,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export default function PilotOutreach() {
  const [tab, setTab] = useState("outreach");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Outreach Center"
        description="Manage email outreach, templates, and AI-generated content."
      />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="outreach">Outreach</TabsTrigger>
          <TabsTrigger value="templates">Templates</TabsTrigger>
          <TabsTrigger value="compose">Compose</TabsTrigger>
        </TabsList>
        <TabsContent value="outreach" className="mt-4">
          <OutreachList />
        </TabsContent>
        <TabsContent value="templates" className="mt-4">
          <TemplateLibrary />
        </TabsContent>
        <TabsContent value="compose" className="mt-4">
          <ComposeView />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function OutreachList() {
  const outreach = useQuery(api.email.listOutreach);

  return (
    <div className="space-y-3">
      {(outreach ?? []).length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Mail className="mx-auto size-8 text-muted-foreground/50" />
            <p className="mt-3 text-sm text-muted-foreground">
              No outreach yet. Compose your first message.
            </p>
          </CardContent>
        </Card>
      ) : (
        (outreach ?? []).map((item: any) => (
          <div
            key={item.id}
            className="flex items-center gap-4 rounded-xl border border-border/60 bg-card p-4"
          >
            <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted/50">
              <Mail className="size-4 text-muted-foreground" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground truncate">
                {item.subject}
              </p>
              <p className="text-xs text-muted-foreground">
                To: {item.recipient_name || item.recipient_email}
                {item.sent_at &&
                  ` · Sent ${new Date(item.sent_at).toLocaleDateString()}`}
              </p>
            </div>
            <Badge
              variant="outline"
              className={`shrink-0 text-[10px] ${
                item.status === "sent"
                  ? "border-green-500/30 bg-green-500/10 text-green-600"
                  : item.status === "draft"
                    ? "border-yellow-500/30 bg-yellow-500/10 text-yellow-600"
                    : ""
              }`}
            >
              {item.status}
            </Badge>
          </div>
        ))
      )}
    </div>
  );
}

function TemplateLibrary() {
  const templates = useQuery(api.email.listTemplates);
  const saveTemplate = useMutation(api.email.saveTemplate);
  const deleteTemplate = useMutation(api.email.deleteTemplate);
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({
    name: "",
    subject: "",
    body: "",
    description: "",
    stage: "",
  });

  const handleSave = async () => {
    if (!form.name || !form.subject || !form.body) {
      toast.error("Name, subject, and body are required");
      return;
    }
    try {
      await saveTemplate({
        name: form.name,
        subject: form.subject,
        body: form.body,
        description: form.description || undefined,
        stage: form.stage || undefined,
      });
      toast.success("Template saved");
      setShowNew(false);
      setForm({ name: "", subject: "", body: "", description: "", stage: "" });
      invalidateQueries();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setShowNew(true)}>
          <Plus className="mr-1 size-3" />
          New Template
        </Button>
      </div>

      {(templates ?? []).length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <FileText className="mx-auto size-8 text-muted-foreground/50" />
            <p className="mt-3 text-sm text-muted-foreground">
              No templates yet. Create one to reuse outreach messages.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {(templates ?? []).map((t: any) => (
            <Card key={t.id}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-sm">{t.name}</CardTitle>
                    {t.description && (
                      <CardDescription className="mt-0.5 text-xs">
                        {t.description}
                      </CardDescription>
                    )}
                  </div>
                  {t.stage && (
                    <Badge variant="outline" className="text-[10px]">
                      {t.stage}
                    </Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-xs font-medium text-foreground/80">
                  Subject: {t.subject}
                </p>
                <p className="mt-1 line-clamp-3 text-xs text-muted-foreground">
                  {t.body}
                </p>
                <div className="mt-3 flex gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={async () => {
                      await deleteTemplate({ templateId: t.id });
                      invalidateQueries();
                    }}
                  >
                    <Trash2 className="size-3" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={showNew} onOpenChange={setShowNew}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>New Template</DialogTitle>
            <DialogDescription>
              Create a reusable email template.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs">
                Name <span className="text-red-500">*</span>
              </Label>
              <Input
                value={form.name}
                onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                placeholder="Day 0 Outreach"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Stage</Label>
              <Input
                value={form.stage}
                onChange={(e) => setForm((p) => ({ ...p, stage: e.target.value }))}
                placeholder="day_0, day_3, pilot_invitation..."
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">
                Subject <span className="text-red-500">*</span>
              </Label>
              <Input
                value={form.subject}
                onChange={(e) =>
                  setForm((p) => ({ ...p, subject: e.target.value }))
                }
                placeholder="Subject line with {{first_name}}"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Description</Label>
              <Input
                value={form.description}
                onChange={(e) =>
                  setForm((p) => ({ ...p, description: e.target.value }))
                }
                placeholder="Brief description"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">
                Body <span className="text-red-500">*</span>
              </Label>
              <Textarea
                value={form.body}
                onChange={(e) => setForm((p) => ({ ...p, body: e.target.value }))}
                placeholder="Email body with {{variables}}..."
                rows={8}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNew(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave}>Save Template</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ComposeView() {
  const createOutreach = useMutation(api.email.createOutreach);
  const templates = useQuery(api.email.listTemplates);
  const leads = useQuery(api.crm.listLeads);
  const [sending, setSending] = useState(false);
  const [form, setForm] = useState({
    recipientEmail: "",
    recipientName: "",
    subject: "",
    body: "",
    leadId: "",
    templateId: "",
  });

  const handleSend = async (asDraft = true) => {
    if (!form.recipientEmail || !form.subject || !form.body) {
      toast.error("Recipient, subject, and body are required");
      return;
    }
    setSending(true);
    try {
      await createOutreach({
        recipientEmail: form.recipientEmail,
        recipientName: form.recipientName || undefined,
        subject: form.subject,
        body: form.body,
        leadId: form.leadId || undefined,
        templateId: form.templateId || undefined,
        outreachType: form.templateId ? "manual" : "manual",
      });
      toast.success(asDraft ? "Draft saved" : "Outreach created");
      invalidateQueries();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setSending(false);
    }
  };

  const applyTemplate = (templateId: string) => {
    const tmpl = (templates ?? []).find((t: any) => t.id === templateId);
    if (tmpl) {
      setForm((p) => ({
        ...p,
        templateId,
        subject: tmpl.subject ?? "",
        body: tmpl.body ?? "",
      }));
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label className="text-xs">
            Recipient Email <span className="text-red-500">*</span>
          </Label>
          <Input
            type="email"
            value={form.recipientEmail}
            onChange={(e) =>
              setForm((p) => ({ ...p, recipientEmail: e.target.value }))
            }
            placeholder="contact@company.com"
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Recipient Name</Label>
            <Input
              value={form.recipientName}
              onChange={(e) =>
                setForm((p) => ({ ...p, recipientName: e.target.value }))
              }
              placeholder="John Smith"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Link to Lead</Label>
            <select
              value={form.leadId}
              onChange={(e) =>
                setForm((p) => ({ ...p, leadId: e.target.value }))
              }
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            >
              <option value="">None</option>
              {(leads ?? []).map((l: any) => (
                <option key={l.id} value={l.id}>
                  {l.company_name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">
            Subject <span className="text-red-500">*</span>
          </Label>
          <Input
            value={form.subject}
            onChange={(e) =>
              setForm((p) => ({ ...p, subject: e.target.value }))
            }
            placeholder="Subject line"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">
            Body <span className="text-red-500">*</span>
          </Label>
          <Textarea
            value={form.body}
            onChange={(e) => setForm((p) => ({ ...p, body: e.target.value }))}
            placeholder="Write your message..."
            rows={12}
            className="font-mono text-sm"
          />
        </div>
        <div className="flex gap-3">
          <Button
            variant="outline"
            disabled={sending}
            onClick={() => handleSend(true)}
          >
            {sending ? <Loader2 className="mr-1 size-3 animate-spin" /> : null}
            Save Draft
          </Button>
          <Button disabled={sending} onClick={() => handleSend(false)}>
            <Send className="mr-1 size-3" />
            Send
          </Button>
        </div>
      </div>

      {/* Template Sidebar */}
      <div className="space-y-3">
        <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Templates
        </h3>
        {(templates ?? []).length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No templates. Create one in the Templates tab.
          </p>
        ) : (
          (templates ?? []).map((t: any) => (
            <button
              key={t.id}
              type="button"
              onClick={() => applyTemplate(t.id)}
              className="w-full rounded-lg border border-border/60 p-3 text-left transition-colors hover:border-teal-400/30 hover:bg-muted/30"
            >
              <p className="text-xs font-medium text-foreground">{t.name}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground truncate">
                {t.subject}
              </p>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
