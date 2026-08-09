import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { Infer, v } from "convex/values";

// default user roles. can add / remove based on the project as needed
export const ROLES = {
  ADMIN: "admin",
  USER: "user",
  MEMBER: "member",
} as const;

export const roleValidator = v.union(
  v.literal(ROLES.ADMIN),
  v.literal(ROLES.USER),
  v.literal(ROLES.MEMBER),
);
export type Role = Infer<typeof roleValidator>;

export const MEMBER_ROLES = [
  "owner",
  "admin",
  "manager",
  "analyst",
  "viewer",
] as const;
export const memberRoleValidator = v.union(
  v.literal("owner"),
  v.literal("admin"),
  v.literal("manager"),
  v.literal("analyst"),
  v.literal("viewer"),
);
export type MemberRole = Infer<typeof memberRoleValidator>;

export const DOC_STATUS = v.union(
  v.literal("uploaded"),
  v.literal("processing"),
  v.literal("ready"),
  v.literal("failed"),
);
export const CLASSIFICATIONS = [
  "SOP",
  "Policy",
  "Handbook",
  "Template",
  "Contract",
  "Estimate",
  "Invoice",
  "Report",
  "Meeting Notes",
  "Communication",
  "Training Material",
  "Regulatory Reference",
  "Spreadsheet",
  "Financial Record",
  "Unknown",
] as const;
export const classificationValidator = v.union(
  ...CLASSIFICATIONS.map((c) => v.literal(c)),
);

export const KNOWLEDGE_CLASSES = [
  "FACT",
  "RULE",
  "OBSERVATION",
  "INFERENCE",
  "RECOMMENDATION",
] as const;
export const knowledgeClassValidator = v.union(
  ...KNOWLEDGE_CLASSES.map((c) => v.literal(c)),
);

const schema = defineSchema(
  {
    // default auth tables using convex auth.
    ...authTables, // do not remove or modify

    // the users table is the default users table that is brought in by the authTables
    users: defineTable({
      name: v.optional(v.string()), // name of the user. do not remove
      image: v.optional(v.string()), // image of the user. do not remove
      email: v.optional(v.string()), // email of the user. do not remove
      emailVerificationTime: v.optional(v.number()), // email verification time. do not remove
      isAnonymous: v.optional(v.boolean()), // is the user anonymous. do not remove

      role: v.optional(roleValidator), // role of the user. do not remove
    }).index("email", ["email"]), // index for the email. do not remove or modify

    // ------------------------------------------------------------------
    // ATLAS CORE — Identity & Tenancy
    // ------------------------------------------------------------------

    /** One tenant = one company workspace. Strictly isolated. */
    tenants: defineTable({
      name: v.string(),
      slug: v.string(),
      status: v.union(v.literal("active"), v.literal("suspended")),
      settings: v.optional(v.any()),
    }).index("by_slug", ["slug"]),

    /** Membership of a user in a tenant workspace. */
    memberships: defineTable({
      tenantId: v.id("tenants"),
      userId: v.id("users"),
      role: memberRoleValidator,
      status: v.union(
        v.literal("active"),
        v.literal("invited"),
        v.literal("suspended"),
      ),
      invitedBy: v.optional(v.id("users")),
      joinedAt: v.optional(v.number()),
    })
      .index("by_user", ["userId"])
      .index("by_tenant", ["tenantId"])
      .index("by_tenant_user", ["tenantId", "userId"]),

    /** Email invitations for people who haven't signed up yet. */
    invites: defineTable({
      tenantId: v.id("tenants"),
      email: v.string(),
      role: memberRoleValidator,
      invitedBy: v.id("users"),
      status: v.union(
        v.literal("pending"),
        v.literal("accepted"),
        v.literal("declined"),
      ),
    })
      .index("by_tenant", ["tenantId"])
      .index("by_email", ["email"]),

    // ------------------------------------------------------------------
    // Company profile & onboarding
    // ------------------------------------------------------------------

    companyProfiles: defineTable({
      tenantId: v.id("tenants"),
      companyName: v.string(),
      country: v.optional(v.string()),
      stateProvince: v.optional(v.string()),
      city: v.optional(v.string()),
      operatingGeography: v.optional(v.string()),
      industry: v.optional(v.string()),
      subIndustry: v.optional(v.string()),
      companySize: v.optional(v.string()),
      employeeCount: v.optional(v.number()),
      businessModel: v.optional(v.string()),
      servicesProducts: v.optional(v.array(v.string())),
      website: v.optional(v.string()),
      onboardingStep: v.optional(v.number()),
      onboardingComplete: v.optional(v.boolean()),
      updatedAt: v.optional(v.number()),
    }).index("by_tenant", ["tenantId"]),

    /** Systems the company operates with (CRM, accounting, drives...). */
    companySystems: defineTable({
      tenantId: v.id("tenants"),
      name: v.string(),
      category: v.optional(v.string()),
      vendor: v.optional(v.string()),
      notes: v.optional(v.string()),
      status: v.union(
        v.literal("active"),
        v.literal("planned"),
        v.literal("none"),
      ),
    }).index("by_tenant", ["tenantId"]),

    // ------------------------------------------------------------------
    // Intelligence Packs (global, versioned bundles of knowledge)
    // ------------------------------------------------------------------

    intelligencePacks: defineTable({
      key: v.string(),
      name: v.string(),
      packType: v.string(), // industry | geographic | regulatory | company | workflow | benchmark
      publisher: v.optional(v.string()),
      description: v.string(),
      version: v.string(),
      status: v.union(v.literal("active"), v.literal("draft"), v.literal("deprecated")),
    }).index("by_key", ["key"]),

    /** Items inside a pack: terminology, entity types, workflows, risk patterns... */
    intelligenceItems: defineTable({
      packKey: v.string(),
      itemType: v.string(), // terminology | entity_type | workflow | role | risk_pattern | document_expectation | benchmark | kpi
      key: v.string(),
      title: v.string(),
      summary: v.optional(v.string()),
      content: v.any(),
      jurisdiction: v.optional(v.string()),
      industry: v.optional(v.string()),
      status: v.optional(v.string()),
      confidence: v.optional(v.number()),
    }).index("by_pack", ["packKey"]),

    /** Per-tenant pack activation state. */
    tenantPacks: defineTable({
      tenantId: v.id("tenants"),
      packKey: v.string(),
      activatedAt: v.number(),
      activatedBy: v.optional(v.id("users")),
      status: v.union(v.literal("active"), v.literal("dismissed")),
    })
      .index("by_tenant", ["tenantId"])
      .index("by_tenant_pack", ["tenantId", "packKey"]),

    // ------------------------------------------------------------------
    // Documents & ingestion
    // ------------------------------------------------------------------

    documents: defineTable({
      tenantId: v.id("tenants"),
      title: v.string(),
      sourceType: v.string(), // upload | drive | csv | manual | sample
      mimeType: v.optional(v.string()),
      size: v.optional(v.number()),
      classification: classificationValidator,
      status: DOC_STATUS,
      storageId: v.optional(v.id("_storage")),
      uploadedBy: v.optional(v.id("users")),
      error: v.optional(v.string()),
      summary: v.optional(v.string()),
      chunkCount: v.optional(v.number()),
      entityCount: v.optional(v.number()),
      processedAt: v.optional(v.number()),
      /** External source identity (e.g. Google Drive file id) for dedupe. */
      sourceId: v.optional(v.string()),
      /** External source last-modified time (ms) for change detection. */
      sourceModifiedAt: v.optional(v.number()),
      /** Set when the external source reports the file was removed. The doc and its provenance are retained. */
      externalDeletedAt: v.optional(v.number()),
      /** Last known external folder ids (for event move detection). */
      externalParents: v.optional(v.array(v.string())),
      /** Last known external permission ids (for event permission detection). */
      externalPermissionIds: v.optional(v.array(v.string())),
    })
      .index("by_tenant", ["tenantId"])
      .index("by_tenant_status", ["tenantId", "status"])
      .index("by_tenant_source", ["tenantId", "sourceId"]),

    /** Semantic chunks of a document, with embeddings for retrieval. */
    documentChunks: defineTable({
      tenantId: v.id("tenants"),
      documentId: v.id("documents"),
      chunkIndex: v.number(),
      content: v.string(),
      embedding: v.optional(v.array(v.number())),
      tokenCount: v.optional(v.number()),
    })
      .index("by_tenant", ["tenantId"])
      .index("by_document", ["documentId"])
      .searchIndex("search_content", {
        searchField: "content",
      }),

    /** Background jobs (parse, extract, embed...). */
    ingestionJobs: defineTable({
      tenantId: v.id("tenants"),
      documentId: v.optional(v.id("documents")),
      jobType: v.string(),
      status: v.union(
        v.literal("queued"),
        v.literal("running"),
        v.literal("completed"),
        v.literal("failed"),
      ),
      payload: v.optional(v.any()),
      error: v.optional(v.string()),
      retryCount: v.optional(v.number()),
      startedAt: v.optional(v.number()),
      completedAt: v.optional(v.number()),
    }).index("by_tenant", ["tenantId"]),

    // ------------------------------------------------------------------
    // Knowledge Graph
    // ------------------------------------------------------------------

    entities: defineTable({
      tenantId: v.id("tenants"),
      entityTypeKey: v.string(), // claim | carrier | adjuster | policyholder | property | document | person | organization | product | location | system | project | financial | unknown
      name: v.string(),
      summary: v.optional(v.string()),
      status: v.optional(v.string()),
      confidence: v.number(),
      attributes: v.optional(v.any()),
      sourceDocumentId: v.optional(v.id("documents")),
      firstObservedAt: v.optional(v.number()),
      lastObservedAt: v.optional(v.number()),
    })
      .index("by_tenant", ["tenantId"])
      .index("by_tenant_type", ["tenantId", "entityTypeKey"])
      .searchIndex("search_name", {
        searchField: "name",
      }),

    entityRelationships: defineTable({
      tenantId: v.id("tenants"),
      subjectEntityId: v.id("entities"),
      relationshipTypeKey: v.string(), // relates_to | belongs_to | part_of | produces | uses | located_at | mentions
      objectEntityId: v.id("entities"),
      confidence: v.number(),
      sourceDocumentId: v.optional(v.id("documents")),
      evidence: v.optional(v.string()),
    })
      .index("by_tenant", ["tenantId"])
      .index("by_subject", ["subjectEntityId"]),

    /** Labeled knowledge statements with classification + provenance. */
    knowledgeAssertions: defineTable({
      tenantId: v.id("tenants"),
      classification: knowledgeClassValidator,
      statement: v.string(),
      confidence: v.number(),
      sourceDocumentId: v.optional(v.id("documents")),
      entityId: v.optional(v.id("entities")),
      evidence: v.optional(v.string()),
      status: v.union(
        v.literal("confirmed"),
        v.literal("proposed"),
        v.literal("requires_confirmation"),
      ),
    }).index("by_tenant", ["tenantId"]),

    // ------------------------------------------------------------------
    // Ask Atlas
    // ------------------------------------------------------------------

    askSessions: defineTable({
      tenantId: v.id("tenants"),
      userId: v.id("users"),
      question: v.string(),
      answer: v.string(),
      classification: knowledgeClassValidator,
      confidence: v.number(),
      mode: v.union(v.literal("ai"), v.literal("local")),
      suggestedActions: v.optional(v.array(v.string())),
      /** Structured tool-use proposal produced by the planner (Ask → Actions). */
      toolPlan: v.optional(v.any()),
      limitations: v.optional(v.string()),
    })
      .index("by_tenant", ["tenantId"])
      .index("by_tenant_user", ["tenantId", "userId"]),

    askEvidence: defineTable({
      sessionId: v.id("askSessions"),
      kind: v.string(), // chunk | entity | intelligence | document
      documentId: v.optional(v.id("documents")),
      chunkId: v.optional(v.id("documentChunks")),
      entityId: v.optional(v.id("entities")),
      documentTitle: v.optional(v.string()),
      title: v.optional(v.string()),
      snippet: v.optional(v.string()),
      relevance: v.number(),
      /** FACT | OBSERVATION | INFERENCE | RULE — the nature of this evidence. */
      evidenceType: v.optional(v.string()),
    }).index("by_session", ["sessionId"]),

    // ------------------------------------------------------------------
    // Recommendations, approvals, outcomes
    // ------------------------------------------------------------------

    recommendations: defineTable({
      tenantId: v.id("tenants"),
      title: v.string(),
      summary: v.string(),
      reason: v.string(),
      classification: knowledgeClassValidator,
      detectorKey: v.string(),
      priority: v.union(v.literal("high"), v.literal("medium"), v.literal("low")),
      confidence: v.number(),
      status: v.union(
        v.literal("open"),
        v.literal("approved"),
        v.literal("rejected"),
        v.literal("dismissed"),
        v.literal("executed"),
      ),
      expectedImpact: v.optional(v.string()),
      risk: v.optional(v.string()),
      requiredApprovalMode: v.union(v.literal("SUGGEST"), v.literal("APPROVE"), v.literal("AUTO")),
      decidedBy: v.optional(v.id("users")),
      decidedAt: v.optional(v.number()),
    })
      .index("by_tenant", ["tenantId"])
      .index("by_tenant_status", ["tenantId", "status"]),

    recommendationEvidence: defineTable({
      recommendationId: v.id("recommendations"),
      kind: v.string(),
      documentId: v.optional(v.id("documents")),
      chunkId: v.optional(v.id("documentChunks")),
      entityId: v.optional(v.id("entities")),
      title: v.optional(v.string()),
      snippet: v.optional(v.string()),
      relevance: v.number(),
    }).index("by_recommendation", ["recommendationId"]),

    // ------------------------------------------------------------------
    // Connections (source systems)
    // ------------------------------------------------------------------

    connections: defineTable({
      tenantId: v.id("tenants"),
      name: v.string(),
      provider: v.string(),
      category: v.string(),
      status: v.union(
        v.literal("connected"),
        v.literal("syncing"),
        v.literal("error"),
        v.literal("disconnected"),
      ),
      lastSyncAt: v.optional(v.number()),
      lastError: v.optional(v.string()),
      /** Verified against the live API (testConnection). Never set by config alone. */
      healthStatus: v.optional(
        v.union(
          v.literal("healthy"),
          v.literal("degraded"),
          v.literal("untested"),
          v.literal("error"),
        ),
      ),
      lastTestedAt: v.optional(v.number()),
      lastTestSuccessAt: v.optional(v.number()),
      lastTestFailureAt: v.optional(v.number()),
      lastTestLatencyMs: v.optional(v.number()),
      /** Human-readable identity of the connected account (e.g. Gmail address). */
      accountName: v.optional(v.string()),
      accountEmail: v.optional(v.string()),
      /** Scopes actually granted during OAuth. */
      scopes: v.optional(v.array(v.string())),
      notes: v.optional(v.string()),
      settings: v.optional(v.any()),
    }).index("by_tenant", ["tenantId"]),

    // ------------------------------------------------------------------
    // Tool & Action Runtime
    // ------------------------------------------------------------------

    /** One persisted execution attempt of a registered tool. */
    toolActions: defineTable({
      tenantId: v.id("tenants"),
      /** User who requested it — undefined for system/event-triggered actions. */
      actorId: v.optional(v.id("users")),
      /** Where the action came from: a user, an event, or the system. */
      trigger: v.optional(
        v.union(
          v.literal("user"),
          v.literal("event"),
          v.literal("system"),
          v.literal("workflow"),
        ),
      ),
      /** The event that triggered this action, when applicable. */
      sourceEventId: v.optional(v.id("events")),
      /** The workflow instance this action belongs to, when applicable. */
      workflowInstanceId: v.optional(v.id("workflowInstances")),
      toolId: v.string(),
      connectorId: v.optional(v.id("connections")),
      status: v.union(
        v.literal("proposed"),
        v.literal("awaiting_confirmation"),
        v.literal("approved"),
        v.literal("executing"),
        v.literal("succeeded"),
        v.literal("failed"),
        v.literal("verified"),
        v.literal("verification_failed"),
        v.literal("cancelled"),
      ),
      /** Schema-validated input only — never the raw client payload. */
      input: v.any(),
      result: v.optional(v.any()),
      error: v.optional(v.string()),
      confirmationRequired: v.optional(v.boolean()),
      confirmationMessage: v.optional(v.string()),
      confirmedAt: v.optional(v.number()),
      confirmedBy: v.optional(v.id("users")),
      startedAt: v.optional(v.number()),
      completedAt: v.optional(v.number()),
      verificationStatus: v.optional(
        v.union(
          v.literal("pending"),
          v.literal("verified"),
          v.literal("verification_failed"),
          v.literal("skipped"),
        ),
      ),
      verificationResult: v.optional(v.any()),
      /** Evidence consulted before acting (kind, documentId, chunkId, entityId…). */
      evidence: v.optional(v.any()),
      /** The original natural-language request, when routed from Ask/voice. */
      requestText: v.optional(v.string()),
      /** Structured rationale for the action (why, based on what, with what result). */
      explanation: v.optional(v.any()),
    })
      .index("by_tenant", ["tenantId"])
      .index("by_tenant_status", ["tenantId", "status"])
      .index("by_actor", ["actorId"]),

    // ------------------------------------------------------------------
    // Events (universal event substrate)
    // ------------------------------------------------------------------

    /**
     * One normalized, tenant-scoped event record. Every event that Atlas
     * actually receives is persisted here with its idempotency identity,
     * processing state, structured intelligence and any resulting action.
     */
    events: defineTable({
      tenantId: v.id("tenants"),
      /** Deterministic event id (hash of the idempotency key). */
      eventId: v.string(),
      eventType: v.string(),
      provider: v.string(),
      connectorId: v.optional(v.id("connections")),
      connectionId: v.optional(v.id("connections")),
      sourceResourceId: v.string(),
      occurredAt: v.number(),
      receivedAt: v.number(),
      /** Sanitized payload — never raw provider bodies, never secrets. */
      payload: v.any(),
      payloadVersion: v.string(),
      correlationId: v.optional(v.string()),
      /** Provider idempotency key when supplied, else a stable hash. */
      idempotencyKey: v.string(),
      /** Index key used for deduplication. */
      dedupeKey: v.string(),
      status: v.union(
        v.literal("received"),
        v.literal("processing"),
        v.literal("processed"),
        v.literal("ignored"),
        v.literal("failed"),
        v.literal("retrying"),
      ),
      attempts: v.number(),
      maxAttempts: v.number(),
      lastError: v.optional(v.string()),
      processedAt: v.optional(v.number()),
      processingMs: v.optional(v.number()),
      duplicateOf: v.optional(v.id("events")),
      /** Structured Atlas interpretation (no hidden reasoning). */
      intelligence: v.optional(v.any()),
      /** The tool action this event triggered, if any. */
      actionId: v.optional(v.id("toolActions")),
      /** polling | webhook | manual — how the event actually arrived. */
      sourceMechanism: v.string(),
      /** Provider's own event identity (e.g. Drive changeId). */
      providerEventId: v.optional(v.string()),
      createdBy: v.optional(v.string()),
      createdAt: v.number(),
    })
      .index("by_tenant_received", ["tenantId", "receivedAt"])
      .index("by_dedupeKey", ["dedupeKey"])
      .index("by_tenant_status", ["tenantId", "status"])
      .index("by_tenant_type", ["tenantId", "eventType"]),

    /** In-app notification abstraction (channels: email/slack/voice come later). */
    notifications: defineTable({
      tenantId: v.id("tenants"),
      /** Undefined = workspace-wide. */
      recipientId: v.optional(v.id("users")),
      severity: v.union(
        v.literal("info"),
        v.literal("low"),
        v.literal("medium"),
        v.literal("high"),
        v.literal("critical"),
      ),
      title: v.string(),
      description: v.optional(v.string()),
      sourceEventId: v.optional(v.id("events")),
      actionId: v.optional(v.id("toolActions")),
      read: v.boolean(),
      createdAt: v.number(),
    })
      .index("by_tenant_created", ["tenantId", "createdAt"])
      .index("by_tenant_unread", ["tenantId", "read"]),

    /** Per-tenant event policy overrides (manager-configured). */
    eventPolicies: defineTable({
      tenantId: v.id("tenants"),
      eventType: v.string(),
      /** Whether this event type participates in action evaluation. */
      enabled: v.boolean(),
      /** Allow automatic LOW_WRITE tools for this event type. */
      autoLowRiskWrite: v.boolean(),
      allowedTools: v.optional(v.array(v.string())),
      blockedTools: v.optional(v.array(v.string())),
      riskOverrides: v.optional(v.any()),
      confirmationOverride: v.optional(v.string()),
      updatedAt: v.number(),
    }).index("by_tenant_type", ["tenantId", "eventType"]),

    // ------------------------------------------------------------------
    // Workflows (durable orchestration over events + tools + approvals)
    // ------------------------------------------------------------------

    /** Per-tenant workflow activation + overrides. Definitions live in the registry. */
    workflowSettings: defineTable({
      tenantId: v.id("tenants"),
      workflowId: v.string(),
      enabled: v.boolean(),
      descriptionOverride: v.optional(v.string()),
      approvalRoleOverride: v.optional(v.string()),
      maxActionsOverride: v.optional(v.number()),
      updatedAt: v.number(),
    }).index("by_tenant_workflow", ["tenantId", "workflowId"]),

    /** One durable workflow execution. State survives restarts — never memory-only. */
    workflowInstances: defineTable({
      tenantId: v.id("tenants"),
      definitionId: v.string(),
      workflowVersion: v.string(),
      triggerEventId: v.optional(v.id("events")),
      triggerEventType: v.optional(v.string()),
      sourceResourceId: v.optional(v.string()),
      status: v.union(
        v.literal("pending"),
        v.literal("running"),
        v.literal("waiting"),
        v.literal("awaiting_approval"),
        v.literal("paused"),
        v.literal("completed"),
        v.literal("failed"),
        v.literal("cancelled"),
        v.literal("timed_out"),
      ),
      currentStepId: v.string(),
      /** Structured, sanitized context — references over payload copies. */
      context: v.any(),
      evidenceReferences: v.optional(v.any()),
      actionReferences: v.optional(v.array(v.string())),
      approvalReferences: v.optional(v.array(v.string())),
      waitConditions: v.optional(v.any()),
      /** Correlation keys already consumed by event waits (loop + dup protection). */
      waitResumeKeys: v.optional(v.array(v.string())),
      completedStepIds: v.optional(v.array(v.string())),
      retryCounts: v.optional(v.any()),
      actionCount: v.number(),
      loopGuard: v.optional(v.any()),
      failureReason: v.optional(v.string()),
      errorClass: v.optional(v.string()),
      /** definitionId + trigger event/resource — one instance per dispatch. */
      dedupeKey: v.string(),
      startedAt: v.number(),
      updatedAt: v.number(),
      completedAt: v.optional(v.number()),
    })
      .index("by_tenant_created", ["tenantId", "startedAt"])
      .index("by_tenant_status", ["tenantId", "status"])
      .index("by_dedupeKey", ["dedupeKey"])
      .index("by_tenant_def_resource", ["tenantId", "definitionId", "sourceResourceId"]),

    /** One recorded execution attempt of a workflow step (idempotent by key). */
    workflowSteps: defineTable({
      tenantId: v.id("tenants"),
      instanceId: v.id("workflowInstances"),
      stepId: v.string(),
      stepType: v.string(),
      attempt: v.number(),
      /** workflowInstanceId + stepId + attempt — deterministic execution identity. */
      stepKey: v.string(),
      status: v.union(
        v.literal("pending"),
        v.literal("running"),
        v.literal("succeeded"),
        v.literal("failed"),
        v.literal("skipped"),
        v.literal("waiting"),
      ),
      startedAt: v.optional(v.number()),
      completedAt: v.optional(v.number()),
      durationMs: v.optional(v.number()),
      output: v.optional(v.any()),
      error: v.optional(v.string()),
      actionId: v.optional(v.id("toolActions")),
      approvalId: v.optional(v.id("workflowApprovals")),
      evidenceReferences: v.optional(v.any()),
      createdAt: v.number(),
    })
      .index("by_instance", ["instanceId"])
      .index("by_tenant", ["tenantId"])
      .index("by_step_key", ["stepKey"]),

    /** Human approval requests raised by workflow approval steps. */
    workflowApprovals: defineTable({
      tenantId: v.id("tenants"),
      instanceId: v.id("workflowInstances"),
      workflowDefinitionId: v.string(),
      stepId: v.string(),
      title: v.string(),
      description: v.string(),
      proposedAction: v.optional(v.any()),
      affectedSystem: v.optional(v.string()),
      targetResource: v.optional(v.string()),
      expectedConsequences: v.optional(v.string()),
      evidence: v.optional(v.any()),
      rationale: v.optional(v.string()),
      reversibility: v.optional(v.string()),
      requestedRole: v.union(
        v.literal("member"),
        v.literal("manager"),
        v.literal("owner"),
      ),
      status: v.union(
        v.literal("pending"),
        v.literal("approved"),
        v.literal("rejected"),
        v.literal("expired"),
      ),
      expiresAt: v.optional(v.number()),
      decidedBy: v.optional(v.id("users")),
      decidedAt: v.optional(v.number()),
      createdAt: v.number(),
    })
      .index("by_tenant_status", ["tenantId", "status"])
      .index("by_instance", ["instanceId"])
      .index("by_status", ["status"]),

    // ------------------------------------------------------------------
    // Audit
    // ------------------------------------------------------------------

    auditLogs: defineTable({
      tenantId: v.id("tenants"),
      actorType: v.string(), // user | system
      actorId: v.optional(v.id("users")),
      actionType: v.string(),
      targetType: v.optional(v.string()),
      targetId: v.optional(v.string()),
      metadata: v.optional(v.any()),
    }).index("by_tenant", ["tenantId"]),
  },
  {
    schemaValidation: false,
  },
);

export default schema;
