// ---------------------------------------------------------------------------
// Regression tests — converse routing + failure propagation contract.
//
// Defects being guarded:
//   1. The deployed conversation-converse function answered the browser's
//      OPTIONS preflight with a 404 (it was never deployed) — the preflight
//      failed with "Response to preflight request does not have HTTP ok
//      status", and supabase-js wrapped the blocked fetch in a
//      FunctionsFetchError ("Failed to send a request to the Edge Function").
//      The converse client did NOT recognize that message as
//      "engine unreachable", so instead of degrading to the same
//      deterministic retrieval brain over real evidence it rethrew and the
//      assistant reported "I hit a problem responding to that".
//   2. Voice (ambient wake-word + push-to-talk) and typed Ask Atlas must
//      submit their transcript to the SAME converse entry — one brain, not a
//      second voice-specific engine.
//   3. GENUINE business errors from a reachable engine ("Unauthorized",
//      "Conversation failed: …") must propagate, never be swallowed.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { api, isConverseEngineUnreachable } from "./api";

describe("converse routing — one conversational brain", () => {
  it("routes through the conversation-converse client entry (the same brain for voice and typed Ask Atlas)", () => {
    const converse = api.conversation.converse;
    expect(converse.name).toBe("conversation-converse");
    expect(converse.kind).toBe("client");
    // The client posts the transcript — voice wake-word commands and typed
    // Ask Atlas messages both arrive here as { transcript }.
    expect(typeof converse.clientImpl).toBe("function");
  });

  it("treats the FunctionsFetchError message as engine-unreachable (the CORS 404 defect)", () => {
    expect(isConverseEngineUnreachable("Failed to send a request to the Edge Function")).toBe(
      true,
    );
  });

  it("treats the preflight/404 failure modes as engine-unreachable", () => {
    for (const msg of [
      "Response to preflight request does not have HTTP ok status",
      "Failed to fetch",
      "load failed",
      "404",
      "Function not found",
      "no Access-Control-Allow-Origin header is present",
    ]) {
      expect(isConverseEngineUnreachable(msg), msg).toBe(true);
    }
  });

  it("PROPAGATES genuine business errors from a reachable engine (never swallowed)", () => {
    for (const msg of [
      "Unauthorized",
      "Conversation failed: something broke in the retrieval RPC",
      "Atlas can't answer yet — finish setting up your workspace first.",
      "No transcript provided — send { transcript } in the request body.",
      "RPC failed: permission denied for table documents",
    ]) {
      expect(isConverseEngineUnreachable(msg), msg).toBe(false);
    }
  });
});
