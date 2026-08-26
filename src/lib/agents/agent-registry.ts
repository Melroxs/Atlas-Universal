// ---------------------------------------------------------------------------
// Atlas Agent Runtime — Agent Registry
//
// Central registry for agent definitions. Agents are explicitly registered
// and versioned. Unknown agents fail safely. The registry is the single
// source of truth for what agents exist and what they're allowed to do.
// ---------------------------------------------------------------------------

import type { AgentType } from "../jobs/types";
import type { AgentDefinition } from "./types";

// ---------------------------------------------------------------------------
// Registry singleton
// ---------------------------------------------------------------------------

const _agents = new Map<string, AgentDefinition>();

function registryKey(type: AgentType, version: string): string {
  return `${type}@${version}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function registerAgent(def: AgentDefinition): void {
  const key = registryKey(def.type, def.version);
  _agents.set(key, def);
}

export function registerAgents(defs: AgentDefinition[]): void {
  for (const def of defs) {
    registerAgent(def);
  }
}

/**
 * Get the latest version of an agent by type.
 * Returns undefined if no version is registered.
 */
export function getAgent(type: AgentType): AgentDefinition | undefined {
  let latest: AgentDefinition | undefined;
  for (const def of _agents.values()) {
    if (def.type === type) {
      if (!latest || def.version > latest.version) {
        latest = def;
      }
    }
  }
  return latest;
}

/**
 * Get a specific version of an agent.
 */
export function getAgentVersion(
  type: AgentType,
  version: string,
): AgentDefinition | undefined {
  return _agents.get(registryKey(type, version));
}

export function hasAgent(type: AgentType): boolean {
  return getAgent(type) !== undefined;
}

export function listAgents(): AgentDefinition[] {
  return Array.from(_agents.values());
}

export function listAgentTypes(): AgentType[] {
  const types = new Set<AgentType>();
  for (const def of _agents.values()) {
    types.add(def.type);
  }
  return Array.from(types);
}

/** Reset the registry (for testing). */
export function clearAgents(): void {
  _agents.clear();
}
