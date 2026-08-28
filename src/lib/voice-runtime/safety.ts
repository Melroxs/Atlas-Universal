// ---------------------------------------------------------------------------
// Atlas Voice Runtime — Safety Gate System
//
// Manages confirmation requirements for voice-triggered actions. Enforces:
//   - Risk-based confirmation gates
//   - Explicit user confirmation (no silence/interruption as confirmation)
//   - Timeout for pending confirmations
//   - Audit trail for all action attempts
// ---------------------------------------------------------------------------

import type { VoiceActionContext, VoiceActionResult, VoiceActionRiskLevel } from "./types";

// ---------------------------------------------------------------------------
// Safety gate types
// ---------------------------------------------------------------------------

export interface SafetyGateConfig {
  /** Whether confirmation is required for low-risk writes. */
  confirmLowRisk: boolean;
  /** Whether confirmation is required for read operations. */
  confirmReads: boolean;
  /** Timeout (ms) for pending confirmations before auto-cancellation. */
  confirmationTimeoutMs: number;
  /** Maximum number of unconfirmed actions per session. */
  maxPendingConfirmations: number;
}

export const DEFAULT_SAFETY_CONFIG: SafetyGateConfig = {
  confirmLowRisk: true,
  confirmReads: false,
  confirmationTimeoutMs: 30_000, // 30 seconds
  maxPendingConfirmations: 5,
};

export type ConfirmationStatus =
  | "pending"
  | "confirmed"
  | "rejected"
  | "expired"
  | "cancelled";

export interface PendingConfirmation {
  id: string;
  actionId: string;
  actionName: string;
  riskLevel: VoiceActionRiskLevel;
  params: Record<string, unknown>;
  context: VoiceActionContext;
  prompt: string;
  createdAt: number;
  status: ConfirmationStatus;
  confirmedAt?: number;
}

export interface SafetyAuditEntry {
  timestamp: string;
  sessionId: string;
  actionId: string;
  riskLevel: VoiceActionRiskLevel;
  decision: "allowed" | "confirmation_required" | "blocked" | "confirmed" | "rejected" | "expired";
  userId: string | null;
  reason: string;
}

// ---------------------------------------------------------------------------
// Safety gate singleton
// ---------------------------------------------------------------------------

let _config: SafetyGateConfig = { ...DEFAULT_SAFETY_CONFIG };
const _pendingConfirmations: Map<string, PendingConfirmation> = new Map();
const _auditLog: SafetyAuditEntry[] = [];
const MAX_AUDIT_ENTRIES = 1000;

/**
 * Initialize the safety gate system.
 */
export function initSafetyGate(config?: Partial<SafetyGateConfig>): void {
  if (config) {
    _config = { ...DEFAULT_SAFETY_CONFIG, ...config };
  }
}

/**
 * Reset the safety gate (for testing).
 */
export function resetSafetyGate(): void {
  _config = { ...DEFAULT_SAFETY_CONFIG };
  _pendingConfirmations.clear();
  _auditLog.length = 0;
}

// ---------------------------------------------------------------------------
// Confirmation flow
// ---------------------------------------------------------------------------

/**
 * Check whether an action requires confirmation based on its risk level.
 * Returns the confirmation prompt if confirmation is needed, or null if
 * the action can proceed immediately.
 */
export function checkConfirmationRequired(
  actionId: string,
  actionName: string,
  riskLevel: VoiceActionRiskLevel,
  params: Record<string, unknown>,
  context: VoiceActionContext,
): { required: boolean; prompt?: string; confirmationId?: string } {
  // Determine if confirmation is needed
  let needsConfirmation = false;

  switch (riskLevel) {
    case "high_risk_write":
      // Always require confirmation for high-risk actions
      needsConfirmation = true;
      break;
    case "low_risk_write":
      needsConfirmation = _config.confirmLowRisk;
      break;
    case "read":
      needsConfirmation = _config.confirmReads;
      break;
  }

  if (!needsConfirmation) {
    logAuditEntry({
      timestamp: new Date().toISOString(),
      sessionId: context.sessionId ?? "unknown",
      actionId,
      riskLevel,
      decision: "allowed",
      userId: context.userId,
      reason: `Risk level ${riskLevel} does not require confirmation`,
    });
    return { required: false };
  }

  // Check pending confirmation limit
  if (_pendingConfirmations.size >= _config.maxPendingConfirmations) {
    logAuditEntry({
      timestamp: new Date().toISOString(),
      sessionId: context.sessionId ?? "unknown",
      actionId,
      riskLevel,
      decision: "blocked",
      userId: context.userId,
      reason: "Maximum pending confirmations reached",
    });
    return {
      required: true,
      prompt: "Too many actions awaiting confirmation. Please confirm or cancel pending actions first.",
    };
  }

  // Create pending confirmation
  const confirmationId = `conf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const prompt = buildConfirmationPrompt(actionName, riskLevel, params);

  const pending: PendingConfirmation = {
    id: confirmationId,
    actionId,
    actionName,
    riskLevel,
    params,
    context,
    prompt,
    createdAt: Date.now(),
    status: "pending",
  };

  _pendingConfirmations.set(confirmationId, pending);

  // Set up timeout
  setTimeout(() => {
    const item = _pendingConfirmations.get(confirmationId);
    if (item && item.status === "pending") {
      item.status = "expired";
      logAuditEntry({
        timestamp: new Date().toISOString(),
        sessionId: context.sessionId ?? "unknown",
        actionId,
        riskLevel,
        decision: "expired",
        userId: context.userId,
        reason: "Confirmation timed out",
      });
      // Clean up after timeout
      _pendingConfirmations.delete(confirmationId);
    }
  }, _config.confirmationTimeoutMs);

  logAuditEntry({
    timestamp: new Date().toISOString(),
    sessionId: context.sessionId ?? "unknown",
    actionId,
    riskLevel,
    decision: "confirmation_required",
    userId: context.userId,
    reason: prompt,
  });

  return { required: true, prompt, confirmationId };
}

/**
 * Confirm a pending action. Returns the pending confirmation if valid.
 */
export function confirmAction(
  confirmationId: string,
): PendingConfirmation | null {
  const pending = _pendingConfirmations.get(confirmationId);
  if (!pending || pending.status !== "pending") return null;

  pending.status = "confirmed";
  pending.confirmedAt = Date.now();

  logAuditEntry({
    timestamp: new Date().toISOString(),
    sessionId: pending.context.sessionId ?? "unknown",
    actionId: pending.actionId,
    riskLevel: pending.riskLevel,
    decision: "confirmed",
    userId: pending.context.userId,
    reason: "User explicitly confirmed",
  });

  // Clean up
  _pendingConfirmations.delete(confirmationId);
  return pending;
}

/**
 * Confirm the most recent pending action for a session.
 * Returns the confirmed action, or null if none pending.
 */
export function confirmLatestPending(
  sessionId: string,
): PendingConfirmation | null {
  // Find the most recent pending confirmation for this session
  let latest: PendingConfirmation | null = null;
  for (const pending of _pendingConfirmations.values()) {
    if (pending.context.sessionId === sessionId && pending.status === "pending") {
      if (!latest || pending.createdAt > latest.createdAt) {
        latest = pending;
      }
    }
  }

  if (!latest) return null;
  return confirmAction(latest.id);
}

/**
 * Reject a pending action.
 */
export function rejectAction(confirmationId: string): boolean {
  const pending = _pendingConfirmations.get(confirmationId);
  if (!pending || pending.status !== "pending") return false;

  pending.status = "rejected";

  logAuditEntry({
    timestamp: new Date().toISOString(),
    sessionId: pending.context.sessionId ?? "unknown",
    actionId: pending.actionId,
    riskLevel: pending.riskLevel,
    decision: "rejected",
    userId: pending.context.userId,
    reason: "User explicitly rejected",
  });

  _pendingConfirmations.delete(confirmationId);
  return true;
}

/**
 * Get all pending confirmations for a session.
 */
export function getPendingConfirmations(sessionId: string): PendingConfirmation[] {
  return Array.from(_pendingConfirmations.values()).filter(
    (p) => p.context.sessionId === sessionId && p.status === "pending",
  );
}

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

function buildConfirmationPrompt(
  actionName: string,
  riskLevel: VoiceActionRiskLevel,
  params: Record<string, unknown>,
): string {
  const riskLabel = riskLevel === "high_risk_write"
    ? "This action cannot be undone"
    : riskLevel === "low_risk_write"
      ? "This will make changes to your data"
      : "";

  const details = Object.entries(params)
    .filter(([k]) => !k.startsWith("_"))
    .map(([k, v]) => `${k}: ${String(v)}`)
    .join(", ");

  const detailStr = details ? ` (${details})` : "";

  return `Confirm: ${actionName}${detailStr}? ${riskLabel}. Say "yes" to confirm or "no" to cancel.`;
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

function logAuditEntry(entry: SafetyAuditEntry): void {
  _auditLog.push(entry);
  if (_auditLog.length > MAX_AUDIT_ENTRIES) {
    _auditLog.splice(0, _auditLog.length - MAX_AUDIT_ENTRIES);
  }
}

/**
 * Get the safety audit log (for observability).
 */
export function getSafetyAuditLog(limit?: number): SafetyAuditEntry[] {
  if (limit) return _auditLog.slice(-limit);
  return [..._auditLog];
}

/**
 * Get confirmation statistics.
 */
export function getConfirmationStats(): {
  total: number;
  confirmed: number;
  rejected: number;
  expired: number;
  pending: number;
} {
  // Count from audit log
  let confirmed = 0;
  let rejected = 0;
  let expired = 0;

  for (const entry of _auditLog) {
    if (entry.decision === "confirmed") confirmed++;
    else if (entry.decision === "rejected") rejected++;
    else if (entry.decision === "expired") expired++;
  }

  return {
    total: confirmed + rejected + expired + _pendingConfirmations.size,
    confirmed,
    rejected,
    expired,
    pending: _pendingConfirmations.size,
  };
}
