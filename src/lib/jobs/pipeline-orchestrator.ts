// ---------------------------------------------------------------------------
// Atlas Pipeline Orchestrator — Combines Deterministic + Agent Steps
//
// Creates the full claim analysis pipeline by combining:
//   1. Existing 7 deterministic evidence pipeline steps
//   2. New 4 agent-powered steps
//   3. Human review gate
//
// The orchestrator does NOT execute — it defines the complete pipeline
// definition that the existing Worker executes through the Handler Registry.
// ---------------------------------------------------------------------------

import type { PipelineStepDefinition, PipelineDefinition } from "./types";
import { EVIDENCE_PIPELINE_STEPS, getEvidencePipelineDefinition } from "./evidence-pipeline";
import { AGENT_PIPELINE_STEPS, getAgentPipelineSteps } from "./agent-pipeline";
import { generateCorrelationId } from "./evidence-pipeline";
import { getPipelineConfig } from "./pipeline-config";
import { getAgentConfig } from "../agents";

// ---------------------------------------------------------------------------
// Full Pipeline Definition
// ---------------------------------------------------------------------------

export function getFullPipelineDefinition(): PipelineDefinition {
  const deterministicSteps = getEvidencePipelineDefinition().steps;
  const agentSteps = getAgentPipelineSteps();

  const allSteps: PipelineStepDefinition[] = [...deterministicSteps];

  // Only include agent steps if agents are enabled
  const agentConfig = getAgentConfig();
  if (agentConfig.enabled) {
    allSteps.push(...agentSteps);
  }

  return {
    id: "atlas_claim_analysis_v1",
    name: "Atlas Claim Analysis Pipeline",
    version: "1.0.0",
    steps: allSteps,
    total_timeout_ms: allSteps.reduce((sum, s) => sum + s.timeout_ms, 0),
  };
}

// ---------------------------------------------------------------------------
// Get all step types in dependency order
// ---------------------------------------------------------------------------

export function getAllStepTypes(): string[] {
  const pipeline = getFullPipelineDefinition();
  return pipeline.steps.map((s) => s.type);
}

// ---------------------------------------------------------------------------
// Check if a step is an agent step
// ---------------------------------------------------------------------------

export function isAgentStep(stepType: string): boolean {
  return Object.values(AGENT_PIPELINE_STEPS).includes(
    stepType as (typeof AGENT_PIPELINE_STEPS)[keyof typeof AGENT_PIPELINE_STEPS],
  );
}

// ---------------------------------------------------------------------------
// Check if a step is a deterministic step
// ---------------------------------------------------------------------------

export function isDeterministicStep(stepType: string): boolean {
  return Object.values(EVIDENCE_PIPELINE_STEPS).includes(
    stepType as (typeof EVIDENCE_PIPELINE_STEPS)[keyof typeof EVIDENCE_PIPELINE_STEPS],
  );
}

// ---------------------------------------------------------------------------
// Get step dependencies
// ---------------------------------------------------------------------------

export function getStepDependencies(stepType: string): string[] {
  const pipeline = getFullPipelineDefinition();
  const step = pipeline.steps.find((s) => s.type === stepType);
  return step?.depends_on ?? [];
}

// ---------------------------------------------------------------------------
// Get downstream steps
// ---------------------------------------------------------------------------

export function getDownstreamSteps(stepType: string): string[] {
  const pipeline = getFullPipelineDefinition();
  return pipeline.steps
    .filter((s) => (s.depends_on ?? []).includes(stepType))
    .map((s) => s.type);
}

// ---------------------------------------------------------------------------
// Check which steps are ready given completed steps
// ---------------------------------------------------------------------------

export function getReadySteps(completedSteps: Set<string>): string[] {
  const pipeline = getFullPipelineDefinition();
  return pipeline.steps
    .filter((step) => {
      // Skip already completed steps
      if (completedSteps.has(step.type)) return false;
      // Ready if all dependencies are completed
      return (step.depends_on ?? []).every((dep: string) => completedSteps.has(dep));
    })
    .map((s) => s.type);
}

// ---------------------------------------------------------------------------
// Check if pipeline is complete
// ---------------------------------------------------------------------------

export function isPipelineComplete(completedSteps: Set<string>): boolean {
  const pipeline = getFullPipelineDefinition();
  return pipeline.steps.every((step) => completedSteps.has(step.type));
}

// ---------------------------------------------------------------------------
// Pipeline summary for observability
// ---------------------------------------------------------------------------

export function getPipelineSummary(): {
  totalSteps: number;
  deterministicSteps: number;
  agentSteps: number;
  agentsEnabled: boolean;
  steps: Array<{ type: string; category: "deterministic" | "agent"; depends_on: string[] }>;
} {
  const pipeline = getFullPipelineDefinition();
  const steps = pipeline.steps.map((s) => ({
    type: s.type,
    category: isAgentStep(s.type) ? "agent" as const : "deterministic" as const,
    depends_on: s.depends_on ?? [],
  }));

  return {
    totalSteps: steps.length,
    deterministicSteps: steps.filter((s) => s.category === "deterministic").length,
    agentSteps: steps.filter((s) => s.category === "agent").length,
    agentsEnabled: getAgentConfig().enabled,
    steps,
  };
}
