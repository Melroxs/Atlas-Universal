// ---------------------------------------------------------------------------
// Atlas CRM — Outreach API (Resend email integration)
//
// All email sending goes through the outreach-send Edge Function.
// The Resend API key never reaches the browser.
// ---------------------------------------------------------------------------

import { getSupabaseClient } from "@/lib/supabase";

// ── Edge Function helper ────────────────────────────────────────────────

async function invokeOutreachEdge(
  action: string,
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error("Supabase is not configured.");

  const { data, error } = await supabase.functions.invoke("outreach-send", {
    body: { action, ...params },
  });

  if (error) {
    const status = (error as Record<string, unknown>).status as number | undefined;
    const rawMsg = error.message || String(error);

    // Classify common errors
    if (status === 404 || rawMsg.includes("not found")) {
      throw new Error("Outreach service is not available. Please try again later.");
    }
    if (status === 401 || rawMsg.includes("unauthorized")) {
      throw new Error("Your session has expired. Please sign in again.");
    }
    if (rawMsg.includes("permission") || status === 403) {
      throw new Error("You do not have permission to send outreach emails.");
    }
    throw new Error("Failed to send request to the outreach service.");
  }

  const payload = data as { ok?: boolean; error?: string; [k: string]: unknown };
  if (payload && !payload.ok && payload.error) {
    throw new Error(payload.error);
  }

  return payload ?? {};
}

// ── Send email ──────────────────────────────────────────────────────────

export interface SendEmailParams {
  to: string;
  subject: string;
  body: string;
  htmlBody?: string;
  leadId?: string;
  leadName?: string;
  outreachType?: "manual" | "ai_generated" | "template" | "bulk";
  templateId?: string;
}

export interface SendEmailResult {
  ok: boolean;
  messageId?: string;
  testMode?: boolean;
  recipient?: string;
  error?: string;
}

export async function sendOutreachEmail(params: SendEmailParams): Promise<SendEmailResult> {
  const result = await invokeOutreachEdge("send_email", {
    to: params.to,
    subject: params.subject,
    body: params.body,
    htmlBody: params.htmlBody,
    leadId: params.leadId,
    leadName: params.leadName,
    outreachType: params.outreachType || "manual",
    templateId: params.templateId,
  });

  return {
    ok: true,
    messageId: result.messageId as string,
    testMode: result.testMode as boolean,
    recipient: result.recipient as string,
  };
}

// ── Send test email ─────────────────────────────────────────────────────

export async function sendTestEmail(
  to: string,
  subject: string,
  body: string,
): Promise<SendEmailResult> {
  const result = await invokeOutreachEdge("send_test_email", {
    to,
    subject,
    body,
  });

  return {
    ok: true,
    messageId: result.messageId as string,
    recipient: result.recipient as string,
  };
}

// ── Suppression management ──────────────────────────────────────────────

export interface SuppressionRecord {
  id: string;
  email: string;
  reason: string;
  created_at: string;
}

export async function checkSuppression(email: string): Promise<boolean> {
  const result = await invokeOutreachEdge("check_suppression", { email });
  return result.suppressed as boolean;
}

export async function addSuppression(
  email: string,
  reason: string = "manual",
): Promise<void> {
  await invokeOutreachEdge("add_suppression", { email, reason });
}

export async function removeSuppression(email: string): Promise<void> {
  await invokeOutreachEdge("remove_suppression", { email });
}

export async function listSuppression(): Promise<SuppressionRecord[]> {
  const result = await invokeOutreachEdge("list_suppression", {});
  return (result.records as SuppressionRecord[]) || [];
}

// ── RPC-based outreach operations ───────────────────────────────────────
// These use Supabase RPCs (database) for tracking/management.
// Email sending always goes through the Edge Function.

import { rpcCall } from "@/lib/actions/rpc";

export interface OutreachRecord {
  id: string;
  lead_id: string | null;
  recipient_email: string;
  recipient_name: string | null;
  subject: string;
  status: string;
  outreach_type: string;
  provider_message_id: string | null;
  sent_at: string | null;
  created_at: string;
  company_name?: string | null;
  contact_name?: string | null;
}

export interface OutreachTemplate {
  id: string;
  name: string;
  description: string | null;
  subject: string;
  body: string;
  stage: string | null;
  variables: string[] | null;
  use_count: number;
  created_at: string;
}

export async function listOutreachRecords(params?: {
  leadId?: string;
  status?: string;
  limit?: number;
}): Promise<OutreachRecord[]> {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error("Supabase is not configured.");
  const data = await rpcCall(supabase, "outreach_records_list", {
    pLeadId: params?.leadId ?? null,
    pStatus: params?.status ?? null,
    pLimit: params?.limit ?? 50,
    pOffset: 0,
  });
  return (Array.isArray(data) ? data : []) as OutreachRecord[];
}

export async function createOutreachRecord(params: {
  leadId?: string;
  recipientEmail: string;
  recipientName?: string;
  subject: string;
  body: string;
  status?: string;
  providerMessageId?: string;
}): Promise<{ id: string }> {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error("Supabase is not configured.");
  const data = await rpcCall(supabase, "outreach_records_create", {
    pLeadId: params.leadId ?? null,
    pRecipientEmail: params.recipientEmail,
    pRecipientName: params.recipientName ?? null,
    pSubject: params.subject,
    pBody: params.body,
    pStatus: params.status ?? "sent",
    pProviderMessageId: params.providerMessageId ?? null,
  });
  return data as { id: string };
}

export async function listOutreachTemplates(): Promise<OutreachTemplate[]> {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error("Supabase is not configured.");
  const data = await rpcCall(supabase, "outreach_templates_list", {
    pLimit: 50,
  });
  return (Array.isArray(data) ? data : []) as OutreachTemplate[];
}

export async function createOutreachTemplate(params: {
  name: string;
  subject: string;
  body: string;
  description?: string;
  stage?: string;
}): Promise<{ id: string }> {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error("Supabase is not configured.");
  const data = await rpcCall(supabase, "outreach_templates_create", {
    pName: params.name,
    pSubject: params.subject,
    pBody: params.body,
    pDescription: params.description ?? null,
    pStage: params.stage ?? null,
  });
  return data as { id: string };
}

export async function deleteOutreachTemplate(templateId: string): Promise<boolean> {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error("Supabase is not configured.");
  const data = await rpcCall(supabase, "outreach_templates_delete", {
    pTemplateId: templateId,
  });
  return data as boolean;
}

export async function getOutreachStats(): Promise<{
  total: number;
  sent: number;
  opened: number;
  replied: number;
  bounced: number;
  failed: number;
  drafts: number;
}> {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error("Supabase is not configured.");
  const data = await rpcCall(supabase, "outreach_stats", {});
  return (data ?? {
    total: 0, sent: 0, opened: 0, replied: 0,
    bounced: 0, failed: 0, drafts: 0,
  }) as any;
}
