// ---------------------------------------------------------------------------
// Atlas Experience — barrel export
// ---------------------------------------------------------------------------

// Context & state
export { AtlasContextProvider, useAtlasContext, useEntityScope } from "./context";
export type {
  AtlasContextValue,
  AtlasEntity,
  AtlasEntityType,
  AtlasBreadcrumb,
  WorkspaceHealth,
  EntityRelationship,
  EntityTimelineEntry,
} from "./context";

// Attention model
export {
  type AttentionItem,
  type AttentionSeverity,
  type AttentionCategory,
  SEVERITY_STYLES,
  CATEGORY_LABELS,
  CATEGORY_ICONS,
  sortAttentionItems,
  filterBySeverity,
  countBySeverity,
  SEVERITY_ORDER,
  recommendationToAttentionItem,
  claimToAttentionItem,
  pipelineToAttentionItems,
} from "./attention";

// Intelligence aggregation engine
export {
  type EnrichedAttentionItem,
  type IntelligenceSnapshot,
  buildIntelligenceSnapshot,
  prioritizeItems,
  computePriorityScore,
  createAttentionItem,
  deduplicateItems,
  filterActiveItems,
} from "./intelligence";

// Revenue intelligence
export {
  collectRevenueIntelligence,
  collectSupplementOpportunities,
  collectOutstandingAmounts,
  collectIncompleteClaims,
  collectClaimDiscrepancies,
  collectOpenRecommendations,
  type ClaimForIntelligence,
  type RecommendationForIntelligence,
} from "./revenue-intelligence";

// Evidence intelligence
export {
  collectEvidenceIntelligence,
  collectDocumentFailures,
  collectStaleProcessing,
  collectEmptyKnowledge,
  collectUnderutilizedKnowledge,
  type DocumentStats,
  type EntityStats,
} from "./evidence-intelligence";

// Workflow intelligence
export {
  collectWorkflowIntelligence,
  collectFailedWorkflows,
  collectPendingApprovals,
  collectStuckProcessing,
  type WorkflowForIntelligence,
} from "./workflow-intelligence";

// Entity reference model
export {
  type AtlasEntityReference,
  type AtlasEntityRelation,
  type AtlasEntityTimelineEntry,
  type EntityType,
  ENTITY_TYPE_LABELS,
  ENTITY_TYPE_ICONS,
  createEntityReference,
  createClaimReference,
  createDocumentReference,
  createSupplementReference,
  createRecommendationReference,
} from "./entity-reference";

// Entity relationships
export {
  type EntityRelationshipGraph,
  type EntityRelationshipResult,
  resolveEntityRelationships,
  resolveEntityParent,
  resolveEntityChildren,
  resolveEntitySiblings,
  getEntityHierarchy,
  getEntityBreadcrumb,
  type RelationshipType,
  RELATIONSHIP_TYPES,
} from "./entity-relationships";

// Activity model
export {
  type AtlasActivity,
  type ActivityActor,
  type ActivitySignificance,
  type ActivityCategory,
  type ActivityDateGroup,
  type WorkspaceActivitySummary,
  CATEGORY_SIGNIFICANCE,
  CATEGORY_LABELS as ACTIVITY_CATEGORY_LABELS,
  claimEventToActivity,
  jobEventToActivity,
  recommendationEventToActivity,
  documentEventToActivity,
} from "./activity";

// Activity aggregation
export {
  getDateLabel,
  groupActivitiesByDate,
  collectClaimActivity,
  collectJobActivity,
  collectRecommendationActivity,
  collectDocumentActivity,
  computeWorkspaceActivitySummary,
  filterBySignificance,
  filterByCategory,
  filterByActorType,
  filterByEntity,
  filterImportantActivities,
  getRecentActivities,
} from "./activity-aggregation";

// Decision model
export {
  type AtlasDecision,
  type AtlasObservation,
  type AtlasEvidenceReference,
  type AtlasDecisionImportance,
  type AtlasDecisionRecommendation,
  type AtlasDecisionAction,
  type AtlasDecisionStatus,
  DECISION_STATUS_LABELS,
  DECISION_STATUS_STYLES,
  SEVERITY_STYLES as DECISION_SEVERITY_STYLES,
  SEVERITY_PRIORITY,
  getConfidenceLabel,
  getConfidenceStyle,
  recommendationStatusToDecisionStatus,
  recommendationToDecision,
  attentionItemToDecision,
  sortDecisionsByImportance,
  filterDecisionsByStatus,
  getDecisionsRequiringApproval,
  getHighImpactDecisions,
  getTotalPotentialImpact,
} from "./decision";

// Command center
export {
  computeSystemStatus,
  selectNextBestAction,
  buildAskAtlasContext,
  type CommandCenterState,
  type NextBestAction,
  type AskAtlasContext,
} from "./command-center";

// React hooks
export { useIntelligence, useRevenueIntelligence, useEvidenceIntelligence, useCriticalItems } from "./useIntelligence";
export type { UseIntelligenceResult } from "./useIntelligence";
export { useActivity } from "./useActivity";
export type { UseActivityResult } from "./useActivity";
export { useDecisions } from "./useDecisions";
export type { UseDecisionsResult } from "./useDecisions";

// Commands
export {
  BUILTIN_COMMANDS,
  searchCommands,
  groupCommands,
  type AtlasCommand,
  type CommandCategory,
} from "./commands";

// Signal model (Proactive Atlas)
export {
  type AtlasSignal,
  type SignalSource,
  type SignalSignificance,
  type SignalType,
  type SeenSignalState,
  type SinceLastVisit,
  type ProactiveAtlasContext,
  SIGNAL_SIGNIFICANCE,
  SIGNIFICANCE_ORDER,
  shouldSurfaceSignal,
  filterSurfaceSignals,
  detectNewSignals,
  detectUnseenSignals,
  deduplicateSignals,
  attentionToSignal,
  decisionToSignal,
  activityToSignal,
  buildSinceLastVisit,
  buildProactiveContext,
} from "./signal";

// Conversational Intelligence Layer
export {
  type AtlasConversationContext,
  type AtlasInvestigationContext,
  type ContextBuilderInput,
  type ConversationalIntent,
  type IntentClassification,
  type AtlasAnswer,
  type ConversationalEvidenceRef,
  type AtlasProvenance,
  type AtlasAction,
  type SafetyLevel,
  type ConversationTurn,
  type ConversationMemory,
  buildConversationContext,
  buildContextSummary,
  classifyIntent,
  generateAnswer,
  classifyActionSafety,
  requiresConfirmation,
  resolveFollowUp,
  buildSuggestedQuestions,
} from "./conversational-intelligence";

// Controlled Action & Agent Execution Layer
export {
  type AtlasActionType,
  type AtlasActionStatus,
  type ActionRisk,
  type AtlasExecutableAction,
  type AtlasUserRole,
  type PermissionCheck,
  type ConfirmationResult,
  type AtlasActionResult,
  type AtlasCapability,
  type CapabilityParameter,
  type ActionAuditEntry,
  type ActionTelemetryEvent,
  type ActionTelemetryRecord,
  transitionAction,
  canTransition,
  getActionRisk,
  alwaysRequiresConfirmation,
  safetyLevelToActionRisk,
  checkAuthorization,
  generateConfirmationToken,
  prepareForConfirmation,
  validateConfirmation,
  isActionExpired,
  isActionStale,
  generateSourceFingerprint,
  generateIdempotencyKey,
  registerCapability,
  registerCapabilities,
  getCapability,
  getAllCapabilities,
  getCapabilitiesByCategory,
  getCapabilitiesForRole,
  clearCapabilities,
  validateActionInput,
  createAction,
  createSuccessResult,
  createFailureResult,
  createBlockedResult,
  proposeAction,
  resolveActionEntity,
  buildConfirmationPrompt,
  getAuditTrail,
  summarizeAuditTrail,
  logActionTelemetry,
  getActionTelemetry,
  clearActionTelemetry,
  registerDefaultCapabilities,
  decisionToAction,
  resolvePrepareIntent,
  resolveSubmitIntent,
  DEFAULT_CONFIRMATION_TIMEOUT_MS,
} from "./execution";

// Action handlers — real Supabase RPC integration
export {
  type ActionErrorCode,
  type ActionHandlerContext,
  type ActionHandler,
  handleRecommendationAction,
  handleCreateSupplement,
  handleUpdateSupplementStatus,
  handlePrepareEmail,
  handleSendEmail,
  getActionHandler,
  registerActionHandler,
  executeAction,
  prepareSupplement,
  prepareEmail,
  handleUnsupportedAction,
} from "./action-handlers";

// Conversational ↔ Execution bridge
export {
  type ConversationActionProposal,
  type ConversationResolutionContext,
  resolveConversationEntity,
  bridgeIntentToAction,
  processVoiceCommand,
  handleConfirmationResponse,
  generateProactiveActionSuggestions,
} from "./conversational-execution-bridge";

// Action persistence
export {
  type PersistedAction,
  type ActionStoreSummary,
  type RecoveryResult,
  createAction as createActionRecord,
  transitionActionStatus,
  confirmAction,
  getAction as getServerAction,
  listActions as listServerActions,
  setActionResult,
  getPersistedAction,
  getActiveActions,
  getActionsForEntity,
  recoverPersistedActions,
  loadCachedActions,
  cacheAction,
  removeCachedAction,
  clearCachedActions,
} from "./action-persistence";

// Action availability (entity-state-aware)
export {
  type ActionAvailability,
  type EntityActionContext,
  getAvailableActions,
  getExecutableActions,
  createActionProposals,
} from "./action-availability";

// Staleness protection
export {
  type StalenessCheckResult,
  checkStaleness,
  captureSourceFingerprint,
  createActionWithFingerprint,
} from "./staleness";

// Action deduplication
export {
  type ActionProposalInput,
  type DeduplicatedAction,
  type AtlasSurfaceProposals,
  deduplicateActionProposals,
  collectAndDeduplicate,
} from "./action-deduplication";

// Opportunity engine
export {
  type ChangeSeverity,
  type OpportunityType,
  type DetectedChange,
  type GeneratedOpportunity,
  type CausalTraceEntry,
  classifyChange,
  generateOpportunity,
  opportunityToAttentionItem,
} from "./opportunity-engine";
