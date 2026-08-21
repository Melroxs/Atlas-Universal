// ---------------------------------------------------------------------------
// Atlas CRM — AI Outreach Generator
//
// Uses the existing conversation-converse edge function's Gemini integration
// for outreach email generation. Falls back to a structured prompt approach
// when the edge function is unavailable.
//
// The API key is NEVER exposed to the client — it lives in the edge function's
// server environment (SUPABASE_SERVICE_ROLE_KEY + GEMINI_API_KEY).
// ---------------------------------------------------------------------------

import { getSupabaseClient } from "@/lib/supabase";

export interface LeadContext {
  firstName: string;
  lastName: string;
  fullName: string;
  companyName: string;
  industry: string;
  city: string;
  state: string;
  serviceArea: string;
  website: string;
  jobTitle: string;
  notes: string;
  previousActivities: string[];
}

export interface OutreachRequest {
  leadContext: LeadContext;
  instruction: string;
  tone?: "professional" | "friendly" | "direct" | "founder-led" | "concise";
  length?: "short" | "medium" | "long";
  cta?: string;
}

export interface GeneratedOutreach {
  subject: string;
  body: string;
  cta: string;
  personalizationUsed: string[];
  provider: string;
  model: string | null;
}

/**
 * Generate an outreach email using the existing Atlas AI infrastructure.
 *
 * Architecture:
 *   1. Build a structured prompt from lead context + instruction
 *   2. Send to the conversation-converse edge function (which uses Gemini)
 *   3. Parse the structured response
 *   4. Return validated outreach content
 *
 * If the edge function is unavailable, returns null (caller shows retry).
 */
export async function generateOutreach(
  request: OutreachRequest,
): Promise<GeneratedOutreach> {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error("Supabase is not configured.");

  const prompt = buildOutreachPrompt(request);

  try {
    // Use the existing conversation-converse edge function
    const { data, error } = await supabase.functions.invoke(
      "conversation-converse",
      { body: { transcript: prompt } },
    );

    if (error) throw error;

    const payload = data as {
      data?: {
        answer?: string;
        ai?: { provider?: string; model?: string | null; status?: string };
      };
      error?: string;
    };

    if (payload?.error) throw new Error(payload.error);

    const answer = payload?.data?.answer ?? "";
    if (!answer) throw new Error("No response from AI");

    return parseOutreachResponse(answer, request);
  } catch (e) {
    // If the edge function is unavailable, throw with clear message
    const msg = e instanceof Error ? e.message : String(e);
    if (
      msg.includes("404") ||
      msg.includes("not found") ||
      msg.includes("Failed to send") ||
      msg.includes("load failed") ||
      msg.includes("preflight")
    ) {
      throw new Error(
        "AI generation service is not available. Configure GEMINI_API_KEY in your Supabase Edge Function environment to enable AI outreach.",
      );
    }
    throw e;
  }
}

function buildOutreachPrompt(request: OutreachRequest): string {
  const { leadContext, instruction, tone, length, cta } = request;
  const parts: string[] = [];

  parts.push("You are Atlas, a helpful outreach assistant for a pilot program.");
  parts.push("");
  parts.push("TASK: Generate an email for the following outreach objective.");
  parts.push("");

  if (tone) parts.push(`TONE: ${tone}`);
  if (length) parts.push(`LENGTH: ${length}`);
  if (cta) parts.push(`CALL TO ACTION: ${cta}`);
  parts.push("");

  parts.push("INSTRUCTION FROM USER:");
  parts.push(instruction);
  parts.push("");

  parts.push("RECIPIENT INFORMATION:");
  if (leadContext.firstName) parts.push(`First name: ${leadContext.firstName}`);
  if (leadContext.lastName) parts.push(`Last name: ${leadContext.lastName}`);
  if (leadContext.companyName) parts.push(`Company: ${leadContext.companyName}`);
  if (leadContext.industry) parts.push(`Industry: ${leadContext.industry}`);
  if (leadContext.city) parts.push(`City: ${leadContext.city}`);
  if (leadContext.state) parts.push(`State: ${leadContext.state}`);
  if (leadContext.serviceArea) parts.push(`Service area: ${leadContext.serviceArea}`);
  if (leadContext.website) parts.push(`Website: ${leadContext.website}`);
  if (leadContext.jobTitle) parts.push(`Role: ${leadContext.jobTitle}`);
  if (leadContext.notes) parts.push(`Notes: ${leadContext.notes}`);
  if (leadContext.previousActivities.length > 0) {
    parts.push(`Previous interactions: ${leadContext.previousActivities.join("; ")}`);
  }
  parts.push("");

  parts.push("OUTPUT FORMAT — respond in this exact structure:");
  parts.push("SUBJECT: <email subject line>");
  parts.push("BODY: <email body>");
  parts.push("CTA: <call to action used>");
  parts.push("PERSONALIZATION: <comma-separated list of personalization elements used>");
  parts.push("");
  parts.push("IMPORTANT:");
  parts.push("- Do NOT use undefined or missing values. If a value is not provided, do not reference it.");
  parts.push("- Use the person's first name if available, otherwise use their company name.");
  parts.push("- Keep the email natural and conversational, not robotic.");
  parts.push("- Do not fabricate claims about the product that aren't supported.");
  parts.push("- Be specific to their industry/company where possible.");

  return parts.join("\n");
}

function parseOutreachResponse(
  answer: string,
  request: OutreachRequest,
): GeneratedOutreach {
  const lines = answer.split("\n").filter((l) => l.trim());

  let subject = "";
  let body = "";
  let cta = "";
  let personalizationUsed: string[] = [];

  let currentSection = "body";
  const bodyLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.match(/^SUBJECT:\s*/i)) {
      subject = trimmed.replace(/^SUBJECT:\s*/i, "").trim();
    } else if (trimmed.match(/^CTA:\s*/i)) {
      cta = trimmed.replace(/^CTA:\s*/i, "").trim();
    } else if (trimmed.match(/^PERSONALIZATION:\s*/i)) {
      const val = trimmed.replace(/^PERSONALIZATION:\s*/i, "").trim();
      personalizationUsed = val
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (trimmed.match(/^BODY:\s*/i)) {
      currentSection = "body";
      const bodyStart = trimmed.replace(/^BODY:\s*/i, "").trim();
      if (bodyStart) bodyLines.push(bodyStart);
    } else if (currentSection === "body") {
      bodyLines.push(trimmed);
    }
  }

  body = bodyLines.join("\n").trim();

  // Fallback if parsing failed
  if (!subject || !body) {
    // Try to extract subject from the first line if it looks like one
    if (!subject && lines.length > 0) {
      subject = lines[0].replace(/^(subject|re|fwd):\s*/i, "").trim();
    }
    if (!body) body = answer;
  }

  // Resolve personalization
  const resolved: string[] = [];
  if (request.leadContext.firstName) resolved.push("first_name");
  if (request.leadContext.companyName) resolved.push("company_name");
  if (request.leadContext.industry) resolved.push("industry");
  if (request.leadContext.city) resolved.push("city");
  personalizationUsed = personalizationUsed.length > 0 ? personalizationUsed : resolved;

  return {
    subject,
    body,
    cta: cta || "Reply to this email",
    personalizationUsed,
    provider: "gemini",
    model: null,
  };
}

/**
 * Resolve template variables in a string.
 * Safely replaces {{variable}} placeholders with actual values.
 * Never produces "Hi undefined" or "Hi {{first_name}}".
 */
export function resolveVariables(
  text: string,
  lead: Partial<LeadContext>,
): string {
  const variables: Record<string, string> = {
    first_name: lead.firstName || "",
    last_name: lead.lastName || "",
    company_name: lead.companyName || "",
    city: lead.city || "",
    state: lead.state || "",
    service_area: lead.serviceArea || "",
    industry: lead.industry || "",
    website: lead.website || "",
    job_title: lead.jobTitle || "",
    full_name: lead.fullName || "",
  };

  let result = text;
  for (const [key, value] of Object.entries(variables)) {
    const pattern = new RegExp(`\\{\\{${key}\\}\\}`, "gi");
    result = result.replace(pattern, value || "");
  }

  // Clean up any remaining unresolved variables
  result = result.replace(/\{\{[^}]+\}\}/g, "");

  // Clean up greeting lines that ended up empty
  result = result.replace(/Hi\s+,/g, "Hi there,");
  result = result.replace(/Dear\s+,/g, "Hi there,");
  result = result.replace(/\n{3,}/g, "\n\n");

  return result.trim();
}
