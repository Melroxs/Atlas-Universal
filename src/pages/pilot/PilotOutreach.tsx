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
  CheckCircle2,
  Copy,
  FileText,
  Loader2,
  Mail,
  Pencil,
  Plus,
  Send,
  Sparkles,
  Trash2,
  AlertCircle,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { generateOutreach, type LeadContext } from "@/lib/crm/ai-outreach";
import { sendOutreachEmail, createOutreachRecord } from "@/lib/crm/outreach-api";

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
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiInstruction, setAiInstruction] = useState("");
  const [showAi, setShowAi] = useState(false);
  const [form, setForm] = useState({
    recipientEmail: "",
    recipientName: "",
    subject: "",
    body: "",
    leadId: "",
    templateId: "",
  });

  const [sendResult, setSendResult] = useState<{ status: "success" | "error" | "test"; message: string; messageId?: string } | null>(null);

  const handleSend = async (asDraft = true) => {
    if (!form.recipientEmail || !form.subject || !form.body) {
      toast.error("Recipient, subject, and body are required");
      return;
    }
    setSending(true);
    setSendResult(null);
    try {
      if (asDraft) {
        // Save as draft — no email sent
        await createOutreachRecord({
          recipientEmail: form.recipientEmail,
          recipientName: form.recipientName || undefined,
          subject: form.subject,
          body: form.body,
          leadId: form.leadId || undefined,
          status: "draft",
        });
        toast.success("Draft saved");
      } else {
        // Actually send the email via Resend
        const result = await sendOutreachEmail({
          to: form.recipientEmail,
          subject: form.subject,
          body: form.body,
          leadId: form.leadId || undefined,
          leadName: form.recipientName || undefined,
          outreachType: form.templateId ? "template" : "manual",
          templateId: form.templateId || undefined,
        });

        // Record the send in the database
        await createOutreachRecord({
          recipientEmail: form.recipientEmail,
          recipientName: form.recipientName || undefined,
          subject: form.subject,
          body: form.body,
          leadId: form.leadId || undefined,
          status: result.testMode ? "sent-test" : "sent",
          providerMessageId: result.messageId,
        });

        if (result.testMode) {
          setSendResult({
            status: "test",
            message: `Test email sent! In production mode, this would deliver to ${form.recipientEmail}.`,
            messageId: result.messageId,
          });
          toast.info("Test email sent (test mode is active)");
        } else {
          setSendResult({
            status: "success",
            message: `Email sent to ${form.recipientEmail}${result.messageId ? ` (ID: ${result.messageId.slice(0, 8)}...)` : ""}`,
            messageId: result.messageId,
          });
          toast.success("Email sent successfully!");
        }
      }
      invalidateQueries();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to send email";
      setSendResult({ status: "error", message: msg });
      toast.error(msg);
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

  const handleAiGenerate = async () => {
    if (!aiInstruction.trim()) {
      toast.error("Tell Atlas what you want to say");
      return;
    }
    setAiGenerating(true);
    try {
      // Build lead context from selected lead
      const selectedLead = form.leadId
        ? (leads ?? []).find((l: any) => l.id === form.leadId)
        : null;

      const leadContext: LeadContext = selectedLead
        ? {
            firstName: (selectedLead.contact_name ?? "").split(" ")[0] || "",
            lastName: (selectedLead.contact_name ?? "").split(" ").slice(1).join(" ") || "",
            fullName: selectedLead.contact_name || "",
            companyName: selectedLead.company_name || "",
            industry: selectedLead.contractor_type || "",
            city: "",
            state: "",
            serviceArea: "",
            website: selectedLead.website || "",
            jobTitle: "",
            notes: selectedLead.notes || "",
            previousActivities: [],
          }
        : {
            firstName: "",
            lastName: "",
            fullName: "",
            companyName: "",
            industry: "",
            city: "",
            state: "",
            serviceArea: "",
            website: "",
            jobTitle: "",
            notes: "",
            previousActivities: [],
          };

      const result = await generateOutreach({
        leadContext,
        instruction: aiInstruction,
        tone: "founder-led",
        length: "medium",
      });

      setForm((p) => ({
        ...p,
        subject: result.subject,
        body: result.body,
      }));
      toast.success("Outreach generated — review and edit below");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "AI generation failed");
    } finally {
      setAiGenerating(false);
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
      <div className="space-y-4">
        {/* AI Generation Panel */}
        <div className="rounded-lg border border-teal-400/30 bg-teal-500/5 p-4">
          <button
            type="button"
            onClick={() => setShowAi(!showAi)}
            className="flex w-full items-center justify-between text-sm font-medium text-foreground"
          >
            <div className="flex items-center gap-2">
              <Sparkles className="size-4 text-teal-500" />
              AI Outreach Generator
            </div>
            <span className="text-xs text-muted-foreground">
              {showAi ? "Collapse" : "Expand"}
            </span>
          </button>
          {showAi && (
            <div className="mt-3 space-y-3">
              <p className="text-xs text-muted-foreground">
                Describe what you want to communicate. Atlas will generate a
                subject and email body. Select a lead above to personalize it.
              </p>
              <textarea
                value={aiInstruction}
                onChange={(e) => setAiInstruction(e.target.value)}
                placeholder="Introduce Atlas and explain we're selecting a small group of roofing contractors for our pilot. Keep it short and founder-led."
                rows={3}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-mono"
              />
              <Button
                size="sm"
                disabled={aiGenerating || !aiInstruction.trim()}
                onClick={handleAiGenerate}
                className="bg-teal-600 hover:bg-teal-700"
              >
                {aiGenerating ? (
                  <>
                    <Loader2 className="mr-1 size-3 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <Sparkles className="mr-1 size-3" />
                    Generate Outreach
                  </>
                )}
              </Button>
            </div>
          )}
        </div>

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
        {/* Send result banner */}
        {sendResult && (
          <div className={`rounded-lg border p-3 text-sm ${
            sendResult.status === "success"
              ? "border-green-500/30 bg-green-500/5 text-green-700 dark:text-green-300"
              : sendResult.status === "test"
                ? "border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-300"
                : "border-red-500/30 bg-red-500/5 text-red-700 dark:text-red-300"
          }`}>
            <div className="flex items-start gap-2">
              {sendResult.status === "success" ? (
                <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
              ) : sendResult.status === "test" ? (
                <AlertCircle className="mt-0.5 size-4 shrink-0" />
              ) : (
                <AlertCircle className="mt-0.5 size-4 shrink-0" />
              )}
              <div>
                <p>{sendResult.message}</p>
                {sendResult.messageId && (
                  <p className="mt-1 text-xs opacity-70 font-mono">Provider ID: {sendResult.messageId}</p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Sender info */}
        <div className="rounded-lg border border-border/60 bg-muted/30 p-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Mail className="size-3" />
            <span>Sending as: <strong className="text-foreground">Melissa October &lt;melissa@atlas-ai-os.com&gt;</strong></span>
            <Badge variant="outline" className="ml-auto text-[10px]">Resend</Badge>
          </div>
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
            {sending ? "Sending..." : "Send via Resend"}
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
