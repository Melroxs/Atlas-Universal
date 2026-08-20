// ---------------------------------------------------------------------------
// Atlas Mail — TypeScript types for the email client
//
// SECURITY: The browser never receives decrypted credentials, encryption
// keys, or passwords. These types represent the data contract between the
// frontend and the Supabase RPC functions (which strip credentials).
// ---------------------------------------------------------------------------

export interface EmailAccount {
  id: string;
  tenant_id: string;
  email_address: string;
  display_name: string | null;
  provider: string;
  imap_host: string | null;
  imap_port: number;
  imap_secure: boolean;
  smtp_host: string | null;
  smtp_port: number;
  smtp_secure: boolean;
  // NOTE: encrypted_credentials is NEVER included in RPC responses.
  // The frontend never sees this field.
  sync_enabled: boolean;
  last_synced_at: string | null;
  sync_folders: string[];
  connection_status: "untested" | "connected" | "syncing" | "error" | "disabled";
  connection_error: string | null;
  connection_tested_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface EmailMessage {
  id: string;
  account_id: string;
  provider_message_id: string | null;
  message_id: string | null;
  thread_id: string | null;
  in_reply_to: string | null;
  references: string[];
  from_address: string | null;
  from_name: string | null;
  to_addresses: AddressEntry[];
  cc_addresses: AddressEntry[];
  bcc_addresses: AddressEntry[];
  subject: string | null;
  text_body: string | null;
  html_body: string | null;
  snippet: string | null;
  received_at: string | null;
  sent_at: string | null;
  is_read: boolean;
  is_starred: boolean;
  is_draft: boolean;
  folder: string;
  has_attachments: boolean;
  attachment_count: number;
  labels: string[];
  body_fetched: boolean;
  uid_validity: number | null;
  last_uid: number | null;
  attachments?: EmailAttachment[];
}

export interface EmailThread {
  id: string;
  account_id: string;
  normalized_subject: string | null;
  message_ids: string[];
  latest_message_at: string | null;
  message_count: number;
  participant_addresses: string[];
  created_at: string;
  updated_at: string;
}

export interface EmailAttachment {
  id: string;
  message_id: string;
  filename: string | null;
  mime_type: string | null;
  size: number | null;
  storage_path: string | null;
  created_at: string;
}

export interface EmailDraft {
  id: string;
  account_id: string;
  thread_id: string | null;
  in_reply_to: string | null;
  references: string[];
  to_addresses: AddressEntry[];
  cc_addresses: AddressEntry[];
  bcc_addresses: AddressEntry[];
  subject: string | null;
  text_body: string | null;
  html_body: string | null;
  attachments: unknown[];
  labels: string[];
  signature_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface EmailSignature {
  id: string;
  user_id: string;
  tenant_id: string;
  name: string;
  signature_html: string | null;
  signature_text: string | null;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface EmailLabel {
  id: string;
  tenant_id: string;
  name: string;
  color: string;
  created_at: string;
}

export interface AddressEntry {
  name: string;
  address: string;
}

export type MailFolder =
  | "INBOX"
  | "Sent"
  | "Drafts"
  | "Trash"
  | "Archive"
  | "Spam"
  | "Starred";

export interface MailCounts {
  total: number;
  unread: number;
}

export interface TestConnectionResult {
  ok: boolean;
  imap: { ok: boolean; error?: string; folders: string[] };
  smtp: { ok: boolean; error?: string };
}

export interface SyncResult {
  ok: boolean;
  synced: number;
  total: number;
  fetched: number;
  folder: string;
  error?: string;
}
