// ---------------------------------------------------------------------------
// Atlas AI Runtime — Admin Status Component
//
// Internal status view for Super Admin dashboard. Shows:
//   - Active providers and models
//   - Model availability and health
//   - Routing mode and configuration
//   - Fallback status
//   - Usage statistics (aggregated, no prompt content)
//
// Does NOT expose API keys.
// ---------------------------------------------------------------------------

import { useState, useEffect } from "react";
import {
  getRoutingStatus,
  getRoutingConfig,
  updateRoutingConfig,
  type RoutingMode,
} from "@/lib/ai-runtime/task-router";
import {
  getModelRegistryStatus,
  getAllModelProfiles,
  setModelDisabled,
} from "@/lib/ai-runtime/model-registry";
import {
  getTotalCost,
  getUsageByProvider,
  getErrorRateByProvider,
} from "@/lib/ai-runtime/usage-tracker";

// ---------------------------------------------------------------------------
// Status types
// ---------------------------------------------------------------------------

interface RuntimeStatus {
  routing: ReturnType<typeof getRoutingStatus>;
  models: ReturnType<typeof getModelRegistryStatus>;
  usage: {
    totalCost: number;
    byProvider: Record<string, { totalCalls: number; successfulCalls: number; failedCalls: number; totalTokens: number; totalCostUsd: number; avgLatencyMs: number }>;
    errorRates: Record<string, number>;
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AIRuntimeStatus() {
  const [status, setStatus] = useState<RuntimeStatus | null>(null);
  const [editing, setEditing] = useState(false);
  const [selectedMode, setSelectedMode] = useState<RoutingMode>("routed");

  useEffect(() => {
    refreshStatus();
  }, []);

  function refreshStatus() {
    const routing = getRoutingStatus();
    const models = getModelRegistryStatus();
    const totalCost = getTotalCost();
    const byProvider = getUsageByProvider();
    const errorRates = getErrorRateByProvider();

    setStatus({
      routing,
      models,
      usage: {
        totalCost,
        byProvider,
        errorRates,
      },
    });
    setSelectedMode(routing.mode);
  }

  function handleModeChange(mode: RoutingMode) {
    updateRoutingConfig({ mode });
    setSelectedMode(mode);
    setEditing(false);
    refreshStatus();
  }

  function handleToggleModel(modelId: string, disabled: boolean) {
    setModelDisabled(modelId, disabled);
    refreshStatus();
  }

  if (!status) {
    return (
      <div className="p-6 text-slate-400">
        Loading AI Runtime status...
      </div>
    );
  }

  const models = getAllModelProfiles();

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-white">AI Runtime Status</h2>
          <p className="text-sm text-slate-400">
            Provider-agnostic model routing and health monitoring
          </p>
        </div>
        <button
          onClick={refreshStatus}
          className="px-3 py-1.5 text-sm bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-md transition-colors"
        >
          Refresh
        </button>
      </div>

      {/* Routing Mode */}
      <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-slate-300">Routing Mode</h3>
          {editing ? (
            <div className="flex gap-2">
              {(["legacy", "single-provider", "routed"] as RoutingMode[]).map((mode) => (
                <button
                  key={mode}
                  onClick={() => handleModeChange(mode)}
                  className={`px-3 py-1 text-xs rounded-md transition-colors ${
                    selectedMode === mode
                      ? "bg-blue-600 text-white"
                      : "bg-slate-700 text-slate-300 hover:bg-slate-600"
                  }`}
                >
                  {mode}
                </button>
              ))}
              <button
                onClick={() => setEditing(false)}
                className="px-3 py-1 text-xs bg-slate-700 text-slate-400 hover:text-slate-200 rounded-md"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setEditing(true)}
              className="px-3 py-1 text-xs bg-slate-700 text-slate-300 hover:bg-slate-600 rounded-md transition-colors"
            >
              Change Mode
            </button>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
            status.routing.mode === "routed"
              ? "bg-green-900/50 text-green-300"
              : status.routing.mode === "legacy"
                ? "bg-yellow-900/50 text-yellow-300"
                : "bg-blue-900/50 text-blue-300"
          }`}>
            {status.routing.mode}
          </span>
          <span className="text-xs text-slate-500">
            {status.routing.config.preferCostOptimized ? "Cost-optimized" : "Quality-first"}
          </span>
        </div>
      </div>

      {/* Model Overview */}
      <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4">
        <h3 className="text-sm font-medium text-slate-300 mb-3">Model Registry</h3>
        <div className="grid grid-cols-4 gap-4 mb-4">
          <Stat label="Total Models" value={status.models.totalModels} />
          <Stat label="Available" value={status.models.availableModels} color="text-green-400" />
          <Stat label="Disabled" value={status.models.disabledModels} color="text-yellow-400" />
          <Stat label="With Failures" value={status.models.modelsWithFailures} color="text-red-400" />
        </div>

        {/* Model List */}
        <div className="space-y-2">
          {models.map((model) => (
            <div
              key={model.modelId}
              className="flex items-center justify-between px-3 py-2 bg-slate-900/50 rounded-md"
            >
              <div className="flex items-center gap-3">
                <span className={`w-2 h-2 rounded-full ${
                  model.available && !model.disabled
                    ? "bg-green-400"
                    : model.disabled
                      ? "bg-yellow-400"
                      : "bg-red-400"
                }`} />
                <div>
                  <span className="text-sm text-slate-200">{model.modelId}</span>
                  <span className="ml-2 text-xs text-slate-500">
                    ({model.providerId} · {model.tier})
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <span className="text-xs text-slate-500">
                  ${model.costPer1kTokens.toFixed(4)}/1K tokens
                </span>
                {model.failureCount > 0 && (
                  <span className="text-xs text-red-400">
                    {model.failureCount} failures
                  </span>
                )}
                <button
                  onClick={() => handleToggleModel(model.modelId, !model.disabled)}
                  className={`text-xs px-2 py-0.5 rounded ${
                    model.disabled
                      ? "bg-green-900/50 text-green-300 hover:bg-green-800/50"
                      : "bg-slate-700 text-slate-400 hover:bg-slate-600"
                  }`}
                >
                  {model.disabled ? "Enable" : "Disable"}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Provider Status */}
      <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4">
        <h3 className="text-sm font-medium text-slate-300 mb-3">Provider Status</h3>
        <div className="space-y-2">
          {Object.entries(status.models.byProvider).map(([provider, info]) => (
            <div
              key={provider}
              className="flex items-center justify-between px-3 py-2 bg-slate-900/50 rounded-md"
            >
              <div className="flex items-center gap-3">
                <span className={`w-2 h-2 rounded-full ${
                  info.available > 0 ? "bg-green-400" : "bg-red-400"
                }`} />
                <span className="text-sm text-slate-200">{provider}</span>
              </div>
              <div className="flex items-center gap-4">
                <span className="text-xs text-slate-500">
                  {info.available}/{info.total} models available
                </span>
                {status.usage.byProvider[provider] !== undefined && (
                  <span className="text-xs text-slate-500">
                    ${status.usage.byProvider[provider]?.totalCostUsd.toFixed(2) ?? "0.00"}
                  </span>
                )}
                {status.usage.errorRates[provider] !== undefined && (
                  <span className={`text-xs ${
                    (status.usage.errorRates[provider] ?? 0) > 10
                      ? "text-red-400"
                      : "text-slate-500"
                  }`}>
                    {(status.usage.errorRates[provider] ?? 0).toFixed(1)}% errors
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Usage Summary */}
      <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4">
        <h3 className="text-sm font-medium text-slate-300 mb-3">Usage Summary</h3>
        <div className="grid grid-cols-3 gap-4">
          <Stat
            label="Total Cost"
            value={`$${status.usage.totalCost.toFixed(4)}`}
          />
          <Stat
            label="Active Providers"
            value={Object.keys(status.models.byProvider).length}
          />
          <Stat
            label="Routing Mode"
            value={status.routing.mode}
          />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helper components
// ---------------------------------------------------------------------------

function Stat({
  label,
  value,
  color = "text-slate-200",
}: {
  label: string;
  value: string | number;
  color?: string;
}) {
  return (
    <div>
      <div className="text-xs text-slate-500 mb-1">{label}</div>
      <div className={`text-lg font-semibold ${color}`}>{value}</div>
    </div>
  );
}

export default AIRuntimeStatus;
