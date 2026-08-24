// ---------------------------------------------------------------------------
// Atlas CRM — Outreach API (Resend email integration)
//
// All email sending goes through the outreach-send Edge Function.
// The Resend API key never reaches the browser.
//
// RPC layer: uses the EXISTING email_* RPCs from migration 20260821
// (email_create_outreach, email_list_outreach, email_list_templates,
//  email_save_template, email_delete_template) which write to the
//  email_outreach and email_templates tables that already exist in
//  the production database.
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
// Uses the EXISTING email_* RPCs from migration 20260821_atlas_crm_outreach.sql
// which write to email_outreach and email_templates tables.
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

/**
 * List outreach records using the existing email_list_outreach RPC.
 * This reads from the email_outreach table (migration 20260821).
 */
export async function listOutreachRecords(params?: {
  leadId?: string;
  status?: string;
  limit?: number;
}): Promise<OutreachRecord[]> {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error("Supabase is not configured.");
  const data = await rpcCall(supabase, "email_list_outreach", {
    p_status: params?.status ?? null,
    p_lead_id: params?.leadId ?? null,
    p_limit: params?.limit ?? 50,
  });
  return (Array.isArray(data) ? data : []) as OutreachRecord[];
}

/**
 * Create an outreach record using the existing email_create_outreach RPC.
 * This writes to the email_outreach table (migration 20260821).
 * The RPC hardcodes status='draft' — for sent emails, the Edge Function
 * handles recording via its own database write.
 */
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
  const data = await rpcCall(supabase, "email_create_outreach", {
    p_recipient_email: params.recipientEmail,
    p_subject: params.subject,
    p_body: params.body,
    p_lead_id: params.leadId ?? null,
    p_recipient_name: params.recipientName ?? null,
    p_template_id: null,
    p_outreach_type: "manual",
  });
  return (data ?? { id: "" }) as { id: string };
}

/**
 * List templates using the existing email_list_templates RPC.
 * This reads from the email_templates table (migration 20260821).
 */
export async function listOutreachTemplates(): Promise<OutreachTemplate[]> {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error("Supabase is not configured.");
  const data = await rpcCall(supabase, "email_list_templates", {});
  return (Array.isArray(data) ? data : []) as OutreachTemplate[];
}

/**
 * Create a template using the existing email_save_template RPC.
 * This writes to the email_templates table (migration 20260821).
 */
export async function createOutreachTemplate(params: {
  name: string;
  subject: string;
  body: string;
  description?: string;
  stage?: string;
}): Promise<{ id: string }> {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error("Supabase is not configured.");
  const data = await rpcCall(supabase, "email_save_template", {
    p_name: params.name,
    p_subject: params.subject,
    p_body: params.body,
    p_description: params.description ?? null,
    p_stage: params.stage ?? null,
    p_variables: [],
  });
  return (data ?? { id: "" }) as { id: string };
}

/**
 * Delete a template using the existing email_delete_template RPC.
 */
export async function deleteOutreachTemplate(templateId: string): Promise<boolean> {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error("Supabase is not configured.");
  const data = await rpcCall(supabase, "email_delete_template", {
    p_template_id: templateId,
  });
  return data as boolean;
}

/**
 * Get outreach stats. Returns placeholder data since the email_outreach
 * table doesn't have the full status breakdown the stats RPC needs.
 * Can be enhanced once the outreach_records migration is applied.
 */
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
  try {
    // Try the stats RPC first (will work if 20260824 migration is applied)
    const data = await rpcCall(supabase, "outreach_stats", {});
    return (data ?? {
      total: 0, sent: 0, opened: 0, replied: 0,
      bounced: 0, failed: 0, drafts: 0,
    }) as any;
  } catch {
    // Fallback: count from email_list_outreach
    try {
      const all = await rpcCall(supabase, "email_list_outreach", { p_limit: 1000 });
      const records = Array.isArray(all) ? all : [];
      return {
        total: records.length,
        sent: records.filter((r: any) => r.status === "sent").length,
        opened: records.filter((r: any) => r.status === "opened").length,
        replied: records.filter((r: any) => r.status === "replied").length,
        bounced: records.filter((r: any) => r.status === "bounced").length,
        failed: records.filter((r: any) => r.status === "failed").length,
        drafts: records.filter((r: any) => r.status === "draft").length,
      };
    } catch {
      return { total: 0, sent: 0, opened: 0, replied: 0, bounced: 0, failed: 0, drafts: 0 };
    }
  }
}
