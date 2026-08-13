// ---------------------------------------------------------------------------
// Data-model types — replacement for the Convex generated data model.
//
// Supabase stores ids as UUIDs; they are opaque strings to the app. Every
// RPC returns rows that include `_id` (the record uuid) and `_creationTime`
// (epoch ms) so the rest of the app can keep using the Convex-era shape.
// ---------------------------------------------------------------------------

/** Opaque record id (uuid string). */
export type Id<_Table extends string> = string;

/** A document-shaped object returned by the backend (loosely typed). */
export type Doc<_Table extends string> = Record<string, unknown> & {
  _id: string;
  _creationTime?: number;
};

/** Table names used across the app (for readability only — ids are strings). */
export type TableName = string;
