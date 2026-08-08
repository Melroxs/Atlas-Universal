"use node";

// ---------------------------------------------------------------------------
// AI provider abstraction.
//
// Atlas never calls a vendor SDK directly. This module routes through the
// Freebuff/VLY AI gateway (key auto-injected as VLY_INTEGRATION_KEY). When the
// gateway is unreachable or unconfigured, every function returns null and the
// ingestion / reasoning pipelines fall back to deterministic local logic, so
// the product keeps working without external AI.
// ---------------------------------------------------------------------------

import { vly } from "../../lib/vly-integrations";

export const aiAvailable = (): boolean =>
  !!process.env.VLY_INTEGRATION_KEY;

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** Chat completion. Returns text or null when unavailable/failed. */
export async function chat(
  messages: ChatMessage[],
  opts: { temperature?: number; maxTokens?: number } = {},
): Promise<string | null> {
  try {
    const res = await vly.ai.completion({
      model: "gpt-4o-mini",
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      temperature: opts.temperature ?? 0.2,
      maxTokens: opts.maxTokens ?? 700,
    });
    if (res.success && res.data) {
      return res.data.choices[0]?.message?.content ?? null;
    }
    console.warn("[atlas.ai] completion failed:", res.error);
    return null;
  } catch (e) {
    console.warn("[atlas.ai] completion error:", e);
    return null;
  }
}

/** Embed a batch of texts. Returns null when unavailable/failed. */
export async function embedTexts(
  texts: string[],
): Promise<number[][] | null> {
  if (texts.length === 0) return [];
  try {
    const res = await vly.ai.embeddings(texts);
    if (res.success && res.data) {
      return res.data.embeddings;
    }
    console.warn("[atlas.ai] embeddings failed:", res.error);
    return null;
  } catch (e) {
    console.warn("[atlas.ai] embeddings error:", e);
    return null;
  }
}
