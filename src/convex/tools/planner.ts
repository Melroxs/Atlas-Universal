"use node";

// ---------------------------------------------------------------------------
// Tool planner (internal).
//
// Turns a natural-language request into a structured, SCHEMA-VALIDATED tool
// proposal. The planner only PROPOSES — authorization, confirmation and
// execution live in the execution service. Ask Atlas and the future voice
// interface call this; neither can bypass the runtime.
// ---------------------------------------------------------------------------

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { aiAvailable, chat } from "../ai/provider";
import { TOOL_REGISTRY } from "./registry";
import { validateToolInput, type ValidatedInput } from "./schema";

export const planToolUse = internalAction({
  args: {
    tenantId: v.id("tenants"),
    userId: v.id("users"),
    request: v.string(),
    contextEvidence: v.optional(v.array(v.string())),
  },
  handler: async (_ctx, { request, contextEvidence }) => {
    if (!aiAvailable()) return null;

    const implemented = TOOL_REGISTRY.filter((t) => t.implementationStatus === "implemented");
    const toolList = implemented
      .map(
        (t) =>
          `${t.id} | ${t.name} | ${t.description} | risk=${t.riskLevel} | confirm=${t.confirmationPolicy} | args=${t.inputSchema.fields
            .map((f) => `${f.key}${f.required ? "!" : ""}:${f.type}`)
            .join(",")}`,
      )
      .join("\n");

    const system = `You are the Atlas tool planner. Given a user request, decide whether one of the registered tools can perform it.
Rules:
- Only choose from the tool list. Never invent tool ids or endpoints.
- If the request is answerable from company knowledge alone, or is not actionable, output {"action":"none","reason":"..."}
- If a tool applies, output {"action":"propose","toolId":"...","arguments":{...},"confidence":0-1,"expectedOutcome":"...","verificationPlan":"..."}
- Fill arguments exactly per the declared args for the chosen tool; omit unknown keys. Do not include text content unless the user explicitly provided the material.
- Respond with ONLY JSON, no markdown.

Tools:
${toolList}`;

    const user = `Request: ${request}${
      contextEvidence && contextEvidence.length
        ? `\nContext evidence: ${contextEvidence.join(" | ")}`
        : ""
    }`;

    try {
      const raw = await chat(
        [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        { temperature: 0, maxTokens: 600 },
      );
      if (!raw) return null;
      const start = raw.indexOf("{");
      const end = raw.lastIndexOf("}");
      if (start < 0 || end <= start) return null;
      const parsed = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;

      if (parsed.action === "none" || parsed.action === undefined) {
        return {
          status: "none",
          reason: String(parsed.reason ?? "No applicable tool for this request."),
        };
      }
      if (parsed.action !== "propose") {
        return { status: "none", reason: "No applicable tool." };
      }
      const tool = TOOL_REGISTRY.find((t) => t.id === parsed.toolId);
      if (!tool) {
        return { status: "none", reason: "The planner referenced an unregistered tool." };
      }
      const validation = validateToolInput(tool, parsed.arguments);
      if (!validation.ok) {
        return {
          status: "invalid_arguments",
          toolId: tool.id,
          reason: validation.errors.join(" "),
          proposed: parsed.arguments,
        };
      }
      return {
        status: "ready",
        toolId: tool.id,
        toolName: tool.name,
        arguments: validation.value as ValidatedInput,
        confidence: Math.min(Math.max(Number(parsed.confidence) || 0.5, 0), 1),
        expectedOutcome: String(parsed.expectedOutcome ?? ""),
        verificationPlan: String(parsed.verificationPlan ?? ""),
        reason: String(parsed.reason ?? ""),
      };
    } catch {
      return { status: "none", reason: "The planner could not produce a valid plan." };
    }
  },
});
