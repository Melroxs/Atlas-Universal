// ---------------------------------------------------------------------------
// Atlas Action Confirmation Dialog
//
// Provides a calm, structured confirmation experience for Atlas actions.
// Shows what Atlas is about to do, why, the risk level, relevant evidence,
// and requires explicit human confirmation before execution.
//
// States: preparing | prepared | executing | completed | failed
// ---------------------------------------------------------------------------

import React, { useState, useCallback, useEffect, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  XCircle,
  Shield,
  FileText,
} from "lucide-react";
import {
  type AtlasExecutableAction,
  type AtlasActionResult,
  type ActionRisk,
  validateConfirmation,
  DEFAULT_CONFIRMATION_TIMEOUT_MS,
} from "@/lib/atlas-experience/execution";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ConfirmationDialogState =
  | "idle"
  | "preparing"
  | "prepared"
  | "executing"
  | "completed"
  | "failed";

export interface ActionConfirmationDialogProps {
  /** Whether the dialog is open */
  open: boolean;

  /** The action awaiting confirmation (null when idle) */
  action: AtlasExecutableAction | null;

  /** Current dialog state */
  state: ConfirmationDialogState;

  /** Execution result (set after execution) */
  result?: AtlasActionResult | null;

  /** Error message if execution failed */
  error?: string | null;

  /** Called when user confirms the action */
  onConfirm: (action: AtlasExecutableAction) => void;

  /** Called when user cancels/rejects the action */
  onCancel: (action: AtlasExecutableAction) => void;

  /** Called when dialog is dismissed after completion */
  onDismiss: () => void;

  /** Time remaining before confirmation expires (ms) */
  expiresIn?: number;
}

// ---------------------------------------------------------------------------
// Risk badge styling
// ---------------------------------------------------------------------------

const RISK_STYLES: Record<ActionRisk, { bg: string; text: string; label: string; icon: React.ReactNode }> = {
  low: {
    bg: "bg-emerald-100",
    text: "text-emerald-800",
    label: "Low Risk",
    icon: <CheckCircle2 className="h-3 w-3" />,
  },
  medium: {
    bg: "bg-amber-100",
    text: "text-amber-800",
    label: "Medium Risk",
    icon: <AlertTriangle className="h-3 w-3" />,
  },
  high: {
    bg: "bg-red-100",
    text: "text-red-800",
    label: "High Risk",
    icon: <Shield className="h-3 w-3" />,
  },
};

// ---------------------------------------------------------------------------
// Timer component
// ---------------------------------------------------------------------------

function ConfirmationTimer({ expiresAt, onExpired }: { expiresAt?: string; onExpired?: () => void }) {
  const [remaining, setRemaining] = useState<string>("");

  useEffect(() => {
    if (!expiresAt) return;

    const update = () => {
      const diff = new Date(expiresAt).getTime() - Date.now();
      if (diff <= 0) {
        setRemaining("Expired");
        onExpired?.();
        return;
      }
      const mins = Math.floor(diff / 60000);
      const secs = Math.floor((diff % 60000) / 1000);
      setRemaining(`${mins}:${secs.toString().padStart(2, "0")}`);
    };

    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [expiresAt, onExpired]);

  if (!remaining || remaining === "Expired") return null;

  return (
    <span className="text-xs text-muted-foreground tabular-nums">
      Expires in {remaining}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ActionConfirmationDialog({
  open,
  action,
  state,
  result,
  error,
  onConfirm,
  onCancel,
  onDismiss,
  expiresIn,
}: ActionConfirmationDialogProps) {
  const confirmButtonRef = useRef<HTMLButtonElement>(null);

  // Focus the confirm button when dialog opens
  useEffect(() => {
    if (open && state === "prepared") {
      // Small delay to let dialog animate in
      const t = setTimeout(() => confirmButtonRef.current?.focus(), 200);
      return () => clearTimeout(t);
    }
  }, [open, state]);

  const handleConfirm = useCallback(() => {
    if (action && state === "prepared") {
      onConfirm(action);
    }
  }, [action, state, onConfirm]);

  const handleCancel = useCallback(() => {
    if (action) {
      onCancel(action);
    }
  }, [action, onCancel]);

  if (!action) return null;

  const riskStyle = RISK_STYLES[action.risk];
  const isExecuting = state === "executing" || state === "preparing";
  const isComplete = state === "completed" || state === "failed";

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen && isComplete) {
          onDismiss();
        }
      }}
    >
      <DialogContent className="sm:max-w-lg" onPointerDownOutside={(e) => {
        if (isExecuting) e.preventDefault();
      }}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isComplete ? (
              state === "completed" ? (
                <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              ) : (
                <XCircle className="h-5 w-5 text-red-600" />
              )
            ) : (
              <FileText className="h-5 w-5 text-atlas-600" />
            )}
            <span>
              {isComplete
                ? state === "completed"
                  ? "Action Completed"
                  : "Action Failed"
                : "Confirm Action"}
            </span>
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            {isComplete
              ? result?.message ?? "Action has been processed."
              : action.description}
          </DialogDescription>
        </DialogHeader>

        {/* Action details */}
        <div className="space-y-3 py-2">
          {/* What */}
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              What Atlas will do
            </p>
            <p className="text-sm font-medium">{action.label}</p>
            <p className="text-sm text-muted-foreground">{action.description}</p>
          </div>

          {/* Entity */}
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Target
            </p>
            <p className="text-sm">
              {action.entity.label ?? `${action.entity.type} ${action.entity.id}`}
            </p>
          </div>

          {/* Risk */}
          {!isComplete && (
            <div className="flex items-center gap-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Risk
              </p>
              <Badge
                variant="secondary"
                className={`${riskStyle.bg} ${riskStyle.text} border-0`}
              >
                {riskStyle.icon}
                <span className="ml-1">{riskStyle.label}</span>
              </Badge>
              {action.requiresApproval && (
                <Badge variant="outline" className="border-amber-300 text-amber-700">
                  Approval required
                </Badge>
              )}
            </div>
          )}

          {/* Parameters */}
          {Object.keys(action.parameters).length > 0 && !isComplete && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Details
              </p>
              <div className="rounded-md bg-muted/50 p-3 space-y-1">
                {Object.entries(action.parameters).map(([key, value]) =>
                  value != null && value !== "" ? (
                    <div key={key} className="flex justify-between text-sm">
                      <span className="text-muted-foreground capitalize">
                        {key.replace(/([A-Z])/g, " $1").trim()}
                      </span>
                      <span className="font-medium text-right max-w-[60%] truncate">
                        {typeof value === "object" ? JSON.stringify(value) : String(value)}
                      </span>
                    </div>
                  ) : null,
                )}
              </div>
            </div>
          )}

          {/* Execution result */}
          {isComplete && result && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Result
              </p>
              <div
                className={`rounded-md p-3 text-sm ${
                  state === "completed"
                    ? "bg-emerald-50 text-emerald-800"
                    : "bg-red-50 text-red-800"
                }`}
              >
                {result.message}
                {result.error && (
                  <p className="mt-1 text-xs opacity-75">
                    {result.error.code}: {result.error.message}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Error display */}
          {state === "failed" && error && (
            <div className="rounded-md bg-red-50 p-3 text-sm text-red-800">
              {error}
            </div>
          )}
        </div>

        <Separator />

        <DialogFooter className="flex-row items-center justify-between gap-2">
          {/* Timer */}
          {state === "prepared" && action.expiresAt && (
            <ConfirmationTimer
              expiresAt={action.expiresAt}
              onExpired={handleCancel}
            />
          )}

          <div className="flex gap-2 ml-auto">
            {/* Cancel / Dismiss */}
            {isComplete ? (
              <Button variant="outline" onClick={onDismiss}>
                Close
              </Button>
            ) : isExecuting ? null : (
              <Button variant="outline" onClick={handleCancel}>
                Cancel
              </Button>
            )}

            {/* Confirm / Execute */}
            {!isComplete && (
              <Button
                ref={confirmButtonRef}
                variant={action.risk === "high" ? "destructive" : "default"}
                disabled={isExecuting || state !== "prepared"}
                onClick={handleConfirm}
                className="min-w-[120px]"
              >
                {isExecuting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Executing...
                  </>
                ) : action.risk === "high" ? (
                  "Confirm & Execute"
                ) : action.risk === "medium" ? (
                  "Confirm & Prepare"
                ) : (
                  "Confirm"
                )}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Hook: useActionConfirmation
// ---------------------------------------------------------------------------

export interface UseActionConfirmationReturn {
  /** Current dialog state */
  state: ConfirmationDialogState;

  /** The pending action */
  pendingAction: AtlasExecutableAction | null;

  /** The result after execution */
  result: AtlasActionResult | null;

  /** Error message */
  error: string | null;

  /** Open dialog with an action for confirmation */
  requestConfirmation: (action: AtlasExecutableAction) => void;

  /** Confirm and execute the pending action */
  confirmAndExecute: (
    action: AtlasExecutableAction,
    executor: (action: AtlasExecutableAction) => Promise<AtlasActionResult>,
  ) => void;

  /** Cancel the pending action */
  cancel: () => void;

  /** Dismiss after completion */
  dismiss: () => void;
}

/**
 * Hook for managing the action confirmation + execution lifecycle.
 * This bridges the execution layer's proposeAction → confirm → execute flow
 * with the UI confirmation dialog.
 */
export function useActionConfirmation(): UseActionConfirmationReturn {
  const [state, setState] = useState<ConfirmationDialogState>("idle");
  const [pendingAction, setPendingAction] = useState<AtlasExecutableAction | null>(null);
  const [result, setResult] = useState<AtlasActionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const executedRef = useRef<Set<string>>(new Set());

  const requestConfirmation = useCallback((action: AtlasExecutableAction) => {
    setPendingAction(action);
    setResult(null);
    setError(null);
    setState("prepared");
  }, []);

  const confirmAndExecute = useCallback(
    async (
      action: AtlasExecutableAction,
      executor: (action: AtlasExecutableAction) => Promise<AtlasActionResult>,
    ) => {
      // Idempotency guard
      if (executedRef.current.has(action.idempotencyKey)) {
        setError("This action has already been executed.");
        setState("failed");
        return;
      }

      // Mark as executing
      executedRef.current.add(action.idempotencyKey);
      setState("executing");
      setError(null);

      try {
        const executionResult = await executor(action);
        setResult(executionResult);

        if (executionResult.status === "executed") {
          setState("completed");
        } else {
          setState("failed");
          setError(executionResult.error?.message ?? executionResult.message);
          // Remove from executed set so retry is possible
          executedRef.current.delete(action.idempotencyKey);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Unknown error";
        setError(msg);
        setState("failed");
        setResult(null);
        // Allow retry
        executedRef.current.delete(action.idempotencyKey);
      }
    },
    [],
  );

  const cancel = useCallback(() => {
    setState("idle");
    setPendingAction(null);
    setResult(null);
    setError(null);
  }, []);

  const dismiss = useCallback(() => {
    setState("idle");
    setPendingAction(null);
    setResult(null);
    setError(null);
  }, []);

  return {
    state,
    pendingAction,
    result,
    error,
    requestConfirmation,
    confirmAndExecute,
    cancel,
    dismiss,
  };
}
