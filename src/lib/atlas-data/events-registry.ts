// ---------------------------------------------------------------------------
// Atlas Universal — Event Registry
//
// Every event type Atlas can actually receive is explicitly registered here —
// never hardcoded in UI or processors. A connector is a connection to a
// system; an event is something that happened inside it.
//
// Google Drive is the first real event source. Its events arrive through
// honest change POLLING (labeled as polling — not webhooks): the Drive
// changes API is polled on a schedule and each change is normalized into an
// event envelope. Roadmap connectors are registered as "planned" with no
// handler — no fake integrations, no claimed event sources.
//
// PURE module: imported by the UI (catalog/policies), the ingest mutation
// (validation) and the processor (routing).
// ---------------------------------------------------------------------------

import type { EventDefinition } from "./contracts";

const DRIVE_DOCS = "https://developers.google.com/drive/api/reference/rest/v3/changes/list";

export const EVENT_REGISTRY: EventDefinition[] = [
  // -----------------------------------------------------------------------
  // Google Drive — the reference event source (honest polling)
  // -----------------------------------------------------------------------
  {
    id: "drive.file_created",
    type: "drive.file_created",
    provider: "google_drive",
    connector: "Google Drive",
    description: "A new file appeared in the connected Drive.",
    version: "1.0.0",
    source: "google-drive-changes-poll",
    payloadSchema: {
      fields: [
        { key: "fileId", type: "string", required: true, description: "Drive file id." },
        { key: "name", type: "string", description: "File name." },
        { key: "mimeType", type: "string", description: "MIME type." },
        { key: "modifiedTime", type: "string", description: "ISO modified time." },
        { key: "size", type: "number", description: "Size in bytes." },
        { key: "parents", type: "string_array", description: "Folder ids." },
        { key: "changeId", type: "string", description: "Drive change id." },
      ],
    },
    requiredScopes: ["https://www.googleapis.com/auth/drive.readonly"],
    implementationStatus: "implemented",
    sourceMechanism: "polling",
    deduplicationStrategy: "provider_key",
    handlerId: "drive",
    documentationUrl: DRIVE_DOCS,
  },
  {
    id: "drive.file_updated",
    type: "drive.file_updated",
    provider: "google_drive",
    connector: "Google Drive",
    description: "A file's content or metadata changed in the connected Drive.",
    version: "1.0.0",
    source: "google-drive-changes-poll",
    payloadSchema: {
      fields: [
        { key: "fileId", type: "string", required: true, description: "Drive file id." },
        { key: "name", type: "string", description: "File name." },
        { key: "mimeType", type: "string", description: "MIME type." },
        { key: "modifiedTime", type: "string", description: "ISO modified time." },
        { key: "size", type: "number", description: "Size in bytes." },
        { key: "parents", type: "string_array", description: "Folder ids." },
        { key: "changeId", type: "string", description: "Drive change id." },
      ],
    },
    requiredScopes: ["https://www.googleapis.com/auth/drive.readonly"],
    implementationStatus: "implemented",
    sourceMechanism: "polling",
    deduplicationStrategy: "provider_key",
    handlerId: "drive",
    documentationUrl: DRIVE_DOCS,
  },
  {
    id: "drive.file_deleted",
    type: "drive.file_deleted",
    provider: "google_drive",
    connector: "Google Drive",
    description: "A file was removed (trashed) from the connected Drive.",
    version: "1.0.0",
    source: "google-drive-changes-poll",
    payloadSchema: {
      fields: [
        { key: "fileId", type: "string", required: true, description: "Drive file id." },
        { key: "name", type: "string", description: "Last known file name." },
        { key: "changeId", type: "string", description: "Drive change id." },
      ],
    },
    requiredScopes: ["https://www.googleapis.com/auth/drive.readonly"],
    implementationStatus: "implemented",
    sourceMechanism: "polling",
    deduplicationStrategy: "provider_key",
    handlerId: "drive",
    documentationUrl: DRIVE_DOCS,
  },
  {
    id: "drive.file_moved",
    type: "drive.file_moved",
    provider: "google_drive",
    connector: "Google Drive",
    description: "A file was moved between folders in the connected Drive.",
    version: "1.0.0",
    source: "google-drive-changes-poll",
    payloadSchema: {
      fields: [
        { key: "fileId", type: "string", required: true, description: "Drive file id." },
        { key: "name", type: "string", description: "File name." },
        { key: "parents", type: "string_array", description: "New folder ids." },
        { key: "previousParents", type: "string_array", description: "Previous folder ids." },
        { key: "changeId", type: "string", description: "Drive change id." },
      ],
    },
    requiredScopes: ["https://www.googleapis.com/auth/drive.readonly"],
    implementationStatus: "implemented",
    sourceMechanism: "polling",
    deduplicationStrategy: "provider_key",
    handlerId: "drive",
    documentationUrl: DRIVE_DOCS,
  },
  {
    id: "drive.permission_changed",
    type: "drive.permission_changed",
    provider: "google_drive",
    connector: "Google Drive",
    description: "Sharing or access permissions changed on a file in the connected Drive.",
    version: "1.0.0",
    source: "google-drive-changes-poll",
    payloadSchema: {
      fields: [
        { key: "fileId", type: "string", required: true, description: "Drive file id." },
        { key: "name", type: "string", description: "File name." },
        { key: "permissionIds", type: "string_array", description: "Current permission ids." },
        { key: "previousPermissionIds", type: "string_array", description: "Previous permission ids." },
        { key: "changeId", type: "string", description: "Drive change id." },
      ],
    },
    requiredScopes: ["https://www.googleapis.com/auth/drive.readonly"],
    implementationStatus: "implemented",
    sourceMechanism: "polling",
    deduplicationStrategy: "provider_key",
    handlerId: "drive",
    documentationUrl: DRIVE_DOCS,
  },

  // -----------------------------------------------------------------------
  // Roadmap event sources — registered so the architecture is universal,
  // but honestly "planned": no handler, no fake events, no claimed sources.
  // -----------------------------------------------------------------------
  {
    id: "gmail.message_received",
    type: "gmail.message_received",
    provider: "google_gmail",
    connector: "Gmail",
    description: "A new message arrived in a connected Gmail inbox.",
    version: "0.0.1",
    source: "gmail-push",
    payloadSchema: { fields: [{ key: "messageId", type: "string", required: true, description: "Gmail message id." }] },
    requiredScopes: ["https://www.googleapis.com/auth/gmail.readonly"],
    implementationStatus: "planned",
    sourceMechanism: "webhook",
    deduplicationStrategy: "provider_key",
    handlerId: null,
  },
  {
    id: "microsoft365.message_received",
    type: "microsoft365.message_received",
    provider: "microsoft365",
    connector: "Microsoft 365",
    description: "A new email or Teams message arrived.",
    version: "0.0.1",
    source: "microsoft365-push",
    payloadSchema: { fields: [{ key: "messageId", type: "string", required: true, description: "Message id." }] },
    requiredScopes: [],
    implementationStatus: "planned",
    sourceMechanism: "webhook",
    deduplicationStrategy: "provider_key",
    handlerId: null,
  },
  {
    id: "slack.message_created",
    type: "slack.message_created",
    provider: "slack",
    connector: "Slack",
    description: "A new message was posted in a watched Slack channel.",
    version: "0.0.1",
    source: "slack-events-api",
    payloadSchema: { fields: [{ key: "messageId", type: "string", required: true, description: "Slack message id." }] },
    requiredScopes: [],
    implementationStatus: "planned",
    sourceMechanism: "webhook",
    deduplicationStrategy: "provider_key",
    handlerId: null,
  },
  {
    id: "hubspot.contact_updated",
    type: "hubspot.contact_updated",
    provider: "hubspot",
    connector: "HubSpot",
    description: "A contact record changed in the connected HubSpot account.",
    version: "0.0.1",
    source: "hubspot-webhooks",
    payloadSchema: { fields: [{ key: "objectId", type: "string", required: true, description: "Contact id." }] },
    requiredScopes: [],
    implementationStatus: "planned",
    sourceMechanism: "webhook",
    deduplicationStrategy: "provider_key",
    handlerId: null,
  },
  {
    id: "quickbooks.invoice_created",
    type: "quickbooks.invoice_created",
    provider: "quickbooks",
    connector: "QuickBooks",
    description: "A new invoice was created in QuickBooks.",
    version: "0.0.1",
    source: "quickbooks-webhooks",
    payloadSchema: { fields: [{ key: "invoiceId", type: "string", required: true, description: "Invoice id." }] },
    requiredScopes: [],
    implementationStatus: "planned",
    sourceMechanism: "webhook",
    deduplicationStrategy: "provider_key",
    handlerId: null,
  },
  {
    id: "stripe.payment_succeeded",
    type: "stripe.payment_succeeded",
    provider: "stripe",
    connector: "Stripe",
    description: "A payment succeeded in the connected Stripe account.",
    version: "0.0.1",
    source: "stripe-webhooks",
    payloadSchema: { fields: [{ key: "paymentIntentId", type: "string", required: true, description: "Payment intent id." }] },
    requiredScopes: [],
    implementationStatus: "planned",
    sourceMechanism: "webhook",
    deduplicationStrategy: "provider_key",
    handlerId: null,
  },
  {
    id: "dropbox.file_changed",
    type: "dropbox.file_changed",
    provider: "dropbox",
    connector: "Dropbox",
    description: "A file changed in the connected Dropbox.",
    version: "0.0.1",
    source: "dropbox-webhooks",
    payloadSchema: { fields: [{ key: "fileId", type: "string", required: true, description: "Dropbox file id." }] },
    requiredScopes: [],
    implementationStatus: "planned",
    sourceMechanism: "webhook",
    deduplicationStrategy: "provider_key",
    handlerId: null,
  },
  {
    id: "notion.page_updated",
    type: "notion.page_updated",
    provider: "notion",
    connector: "Notion",
    description: "A page changed in the connected Notion workspace.",
    version: "0.0.1",
    source: "notion-webhooks",
    payloadSchema: { fields: [{ key: "pageId", type: "string", required: true, description: "Notion page id." }] },
    requiredScopes: [],
    implementationStatus: "planned",
    sourceMechanism: "webhook",
    deduplicationStrategy: "provider_key",
    handlerId: null,
  },
  {
    id: "github.push_created",
    type: "github.push_created",
    provider: "github",
    connector: "GitHub",
    description: "Code was pushed to a watched repository.",
    version: "0.0.1",
    source: "github-webhooks",
    payloadSchema: { fields: [{ key: "commitId", type: "string", required: true, description: "Head commit sha." }] },
    requiredScopes: [],
    implementationStatus: "planned",
    sourceMechanism: "webhook",
    deduplicationStrategy: "provider_key",
    handlerId: null,
  },
  // -----------------------------------------------------------------------
  // Authority ingestion — emitted by the authority check loop (honest polling)
  // -----------------------------------------------------------------------
  {
    id: "authority.checked",
    type: "authority.checked",
    provider: "atlas_authority",
    connector: "Authority Ingestion",
    description: "An authoritative source was checked for changes.",
    version: "1.0.0",
    source: "authority-check-sweep",
    payloadSchema: {
      fields: [
        { key: "sourceId", type: "string", required: true, description: "Authoritative source id." },
        { key: "changeType", type: "string", description: "Detected change classification." },
        { key: "contentHash", type: "string", description: "New content hash." },
      ],
    },
    requiredScopes: [],
    implementationStatus: "implemented",
    sourceMechanism: "polling",
    deduplicationStrategy: "resource_hash",
    handlerId: "authority",
  },
  {
    id: "authority.changed",
    type: "authority.changed",
    provider: "atlas_authority",
    connector: "Authority Ingestion",
    description: "An authoritative source's content changed materially.",
    version: "1.0.0",
    source: "authority-check-sweep",
    payloadSchema: {
      fields: [
        { key: "sourceId", type: "string", required: true, description: "Authoritative source id." },
        { key: "knowledgeId", type: "string", description: "Affected knowledge item." },
        { key: "changeType", type: "string", description: "Substantive change classification." },
      ],
    },
    requiredScopes: [],
    implementationStatus: "implemented",
    sourceMechanism: "polling",
    deduplicationStrategy: "resource_hash",
    handlerId: "authority",
  },
  {
    id: "authority.version_published",
    type: "authority.version_published",
    provider: "atlas_authority",
    connector: "Authority Ingestion",
    description: "A new immutable version of authoritative knowledge was published.",
    version: "1.0.0",
    source: "authority-check-sweep",
    payloadSchema: {
      fields: [
        { key: "sourceId", type: "string", required: true, description: "Authoritative source id." },
        { key: "versionId", type: "string", required: true, description: "New immutable version id." },
        { key: "version", type: "string", description: "Version label." },
      ],
    },
    requiredScopes: [],
    implementationStatus: "implemented",
    sourceMechanism: "polling",
    deduplicationStrategy: "resource_hash",
    handlerId: "authority",
  },
  {
    id: "authority.superseded",
    type: "authority.superseded",
    provider: "atlas_authority",
    connector: "Authority Ingestion",
    description: "A knowledge item was superseded by a newer version.",
    version: "1.0.0",
    source: "authority-check-sweep",
    payloadSchema: {
      fields: [
        { key: "sourceId", type: "string", required: true, description: "Authoritative source id." },
        { key: "knowledgeId", type: "string", required: true, description: "Affected knowledge item." },
        { key: "supersededById", type: "string", description: "Newer version id." },
      ],
    },
    requiredScopes: [],
    implementationStatus: "implemented",
    sourceMechanism: "polling",
    deduplicationStrategy: "resource_hash",
    handlerId: "authority",
  },
  {
    id: "authority.applicability_changed",
    type: "authority.applicability_changed",
    provider: "atlas_authority",
    connector: "Authority Ingestion",
    description: "Applicability of knowledge to an operating context changed.",
    version: "1.0.0",
    source: "authority-check-sweep",
    payloadSchema: {
      fields: [
        { key: "sourceId", type: "string", required: true, description: "Authoritative source id." },
        { key: "knowledgeId", type: "string", required: true, description: "Affected knowledge item." },
        { key: "applicable", type: "boolean", description: "New applicability result." },
      ],
    },
    requiredScopes: [],
    implementationStatus: "implemented",
    sourceMechanism: "polling",
    deduplicationStrategy: "resource_hash",
    handlerId: "authority",
  },
  {
    id: "authority.knowledge_stale",
    type: "authority.knowledge_stale",
    provider: "atlas_authority",
    connector: "Authority Ingestion",
    description: "Knowledge was marked stale — never silently presented as current.",
    version: "1.0.0",
    source: "authority-check-sweep",
    payloadSchema: {
      fields: [
        { key: "sourceId", type: "string", required: true, description: "Authoritative source id." },
        { key: "knowledgeId", type: "string", required: true, description: "Affected knowledge item." },
        { key: "freshness", type: "string", description: "New freshness state." },
      ],
    },
    requiredScopes: [],
    implementationStatus: "implemented",
    sourceMechanism: "polling",
    deduplicationStrategy: "resource_hash",
    handlerId: "authority",
  },
  {
    id: "authority.review_required",
    type: "authority.review_required",
    provider: "atlas_authority",
    connector: "Authority Ingestion",
    description: "A change requires human governance review before any operational action.",
    version: "1.0.0",
    source: "authority-check-sweep",
    payloadSchema: {
      fields: [
        { key: "sourceId", type: "string", required: true, description: "Authoritative source id." },
        { key: "knowledgeId", type: "string", required: true, description: "Affected knowledge item." },
        { key: "assessmentId", type: "string", description: "Impact assessment id." },
        { key: "severity", type: "string", description: "Assessment severity." },
      ],
    },
    requiredScopes: [],
    implementationStatus: "implemented",
    sourceMechanism: "polling",
    deduplicationStrategy: "resource_hash",
    handlerId: "authority",
  },
];

/** Fast lookup by event type. */
export const EVENT_BY_TYPE: Record<string, EventDefinition> = Object.fromEntries(
  EVENT_REGISTRY.map((e) => [e.type, e]),
);

export function getEventDefinition(type: string): EventDefinition | undefined {
  return EVENT_BY_TYPE[type];
}

/** Only implemented event types participate in processing. */
export function isEventImplemented(def: EventDefinition | undefined): boolean {
  return !!def && def.implementationStatus === "implemented";
}

// ---------------------------------------------------------------------------
// Event automation policies — frontend contract (Events page).
//
// The page renders one card per REGISTERED event type, merged with the
// tenant-scoped policy state the backend returns. The backend RPC is
// events_raw_policies (raw eventPolicies rows); the merge below is the
// canonical way the UI builds its PolicyRow contract from the registry +
// raw state. This is a pure function so the page can never crash when the
// backend is missing, slow or empty.
// ---------------------------------------------------------------------------

export interface EventPolicyState {
  _id: string;
  eventType: string;
  enabled: boolean;
  autoLowRiskWrite: boolean;
}

export interface EventPolicyRow {
  eventType: string;
  name: string;
  description: string;
  sourceMechanism: string;
  handlerId: string | null;
  policy: EventPolicyState | null;
}

/**
 * Merge the static event registry with tenant policy state. Every registered
 * event type gets a row; `policy` is null when the tenant has not customized
 * it (the UI treats that as the default: enabled with no auto-writes).
 * Handles null/malformed backend data defensively — it never throws.
 */
export function mergeEventPolicies(
  registry: EventDefinition[],
  rawPolicies: Array<Record<string, unknown>> | null | undefined,
): EventPolicyRow[] {
  const byType = new Map<string, Record<string, unknown>>();
  for (const raw of Array.isArray(rawPolicies) ? rawPolicies : []) {
    if (!raw || typeof raw.eventType !== "string") continue;
    byType.set(raw.eventType, raw);
  }
  return registry.map((def) => {
    const raw = byType.get(def.type);
    const policy: EventPolicyState | null = raw
      ? {
          _id: String(raw._id ?? ""),
          eventType: String(raw.eventType),
          enabled: raw.enabled !== false,
          autoLowRiskWrite: raw.autoLowRiskWrite === true,
        }
      : null;
    return {
      eventType: def.type,
      name: def.connector,
      description: def.description,
      sourceMechanism: def.sourceMechanism,
      handlerId: def.handlerId ?? null,
      policy,
    };
  });
}
