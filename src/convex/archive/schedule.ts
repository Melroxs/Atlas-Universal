/**
 * Phase 13 — durable batch scheduler.
 *
 * Lives in its own module so the self-scheduling action can reference itself
 * through the generated API (`internal.archive.processBatch`) WITHOUT a
 * TypeScript circular-type error: process.ts → schedule.ts → _generated/api
 * (value) → process.ts (type-only) is a safe acyclic graph.
 */

import { internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

/** Schedule the next durable ingestion batch for an archive. */
export function scheduleProcessBatch(
  ctx: ActionCtx,
  archiveId: Id<"archiveIngestions">,
): void {
  void ctx.scheduler.runAfter(0, internal.archive.process.processBatch, { archiveId });
}
