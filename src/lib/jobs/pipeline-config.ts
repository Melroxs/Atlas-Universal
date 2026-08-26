// ---------------------------------------------------------------------------
// Atlas Evidence Pipeline — Configuration
//
// Feature flags and pipeline configuration for the evidence pipeline.
// The async pipeline can be toggled independently of the existing
// synchronous processing paths.
// ---------------------------------------------------------------------------

/** Pipeline configuration. */
export interface PipelineConfig {
  /** Enable the async evidence pipeline. When false, existing sync paths are used. */
  enabled: boolean;
  /** Pipeline version for future schema evolution. */
  version: string;
  /** Maximum concurrent pipeline jobs per worker. */
  maxConcurrent: number;
  /** Step timeout in milliseconds. */
  stepTimeoutMs: number;
  /** Maximum retry attempts per step. */
  maxStepRetries: number;
}

/** Default pipeline configuration. */
export const DEFAULT_PIPELINE_CONFIG: PipelineConfig = {
  enabled: false, // Off by default — activate per-tenant
  version: "1.0.0",
  maxConcurrent: 3,
  stepTimeoutMs: 60_000, // 1 minute per step
  maxStepRetries: 3,
};

/** Current pipeline configuration — mutable for testing. */
let _config: PipelineConfig = { ...DEFAULT_PIPELINE_CONFIG };

/**
 * Get the current pipeline configuration.
 */
export function getPipelineConfig(): PipelineConfig {
  return { ..._config };
}

/**
 * Check whether the evidence pipeline is enabled.
 * Returns false if the feature flag is off.
 */
export function isEvidencePipelineEnabled(): boolean {
  return _config.enabled;
}

/**
 * Override pipeline configuration (for testing or runtime toggle).
 */
export function setPipelineConfig(overrides: Partial<PipelineConfig>): void {
  _config = { ..._config, ...overrides };
}

/**
 * Reset pipeline configuration to defaults (for testing).
 */
export function resetPipelineConfig(): void {
  _config = { ...DEFAULT_PIPELINE_CONFIG };
}

/**
 * The global pipeline configuration object exported for convenience.
 * Prefer using `getPipelineConfig()` for reads and `setPipelineConfig()`
 * for writes.
 */
export const PIPELINE_CONFIG: PipelineConfig = _config;
