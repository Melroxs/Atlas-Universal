// ---------------------------------------------------------------------------
// Atlas Mail — Email API functions (SECURITY HARDENED)
//
// SECURITY CONTRACT:
// - Password is sent to the Edge Function ONLY during account setup/test
// - The Edge Function encrypts and stores credentials server-side
// - For sync/send, the Edge Function reads encrypted credentials from DB
// - The browser NEVER receives decrypted credentials back
// - No passwords appear in API responses, logs, or error messages
// ---------------------------------------------------------------------------

import { getSupabaseClient } from "@/lib/supabase";
import { rpcCall } from "@/lib/actions/rpc";
import type {
  EmailAccount,
  EmailMessage,
  EmailAttachment,
  EmailDraft,
  EmailSignature,
  EmailLabel,
  MailCounts,
  TestConnectionResult,
  SyncResult,
} from "./types";

// ── Account operations ──────────────────────────────────────────────────

export async function listEmailAccounts(): Promise<EmailAccount[]> {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error("Supabase is not configured.");
  const data = await rpcCall(supabase, "email_accounts_list");
  return (Array.isArray(data) ? data : []) as EmailAccount[];
}

export async function createEmailAccount(
  account: Partial<EmailAccount> & {
    email_address: string;
  },
): Promise<EmailAccount> {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error("Supabase is not configured.");
  const data = await rpcCall(supabase, "email_accounts_create", {
    emailAddress: account.email_address,
    displayName: account.display_name ?? null,
    provider: account.provider ?? "custom",
    imapHost: account.imap_host ?? null,
    imapPort: account.imap_port ?? 993,
    imapSecure: account.imap_secure ?? true,
    smtpHost: account.smtp_host ?? null,
    smtpPort: account.smtp_port ?? 465,
    smtpSecure: account.smtp_secure ?? true,
  });
  return data as EmailAccount;
}

export async function updateEmailAccount(
  id: string,
  updates: Partial<EmailAccount>,
): Promise<EmailAccount> {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error("Supabase is not configured.");
  const data = await rpcCall(supabase, "email_accounts_update", {
    id,
    emailAddress: updates.email_address ?? null,
    displayName: updates.display_name ?? null,
    imapHost: updates.imap_host ?? null,
    imapPort: updates.imap_port ?? null,
    imapSecure: updates.imap_secure ?? null,
    smtpHost: updates.smtp_host ?? null,
    smtpPort: updates.smtp_port ?? null,
    smtpSecure: updates.smtp_secure ?? null,
    syncEnabled: updates.sync_enabled ?? null,
  });
  return data as EmailAccount;
}

export async function deleteEmailAccount(id: string): Promise<boolean> {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error("Supabase is not configured.");
  const data = await rpcCall(supabase, "email_accounts_delete", { id });
  return data as boolean;
}

export async function setSyncState(
  id: string,
  syncEnabled?: boolean,
  syncFolders?: string[],
): Promise<boolean> {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error("Supabase is not configured.");
  const data = await rpcCall(supabase, "email_accounts_set_sync_state", {
    id,
    syncEnabled: syncEnabled ?? null,
    syncFolders: syncFolders ? JSON.stringify(syncFolders) : null,
  });
  return data as boolean;
}

// ── Message operations ──────────────────────────────────────────────────

export async function listMessages(
  accountId: string,
  folder: string = "INBOX",
  limit: number = 50,
  offset: number = 0,
  search?: string,
): Promise<EmailMessage[]> {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error("Supabase is not configured.");
  const data = await rpcCall(supabase, "email_messages_list", {
    accountId,
    folder,
    limit,
    offset,
    search: search ?? null,
  });
  return (Array.isArray(data) ? data : []) as EmailMessage[];
}

export async function listSentMessages(
  accountId: string,
  limit: number = 50,
  offset: number = 0,
): Promise<EmailMessage[]> {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error("Supabase is not configured.");
  const data = await rpcCall(supabase, "email_messages_list_sent", {
    accountId,
    limit,
    offset,
  });
  return (Array.isArray(data) ? data : []) as EmailMessage[];
}

export async function listDrafts(
  accountId: string,
  limit: number = 50,
  offset: number = 0,
): Promise<EmailDraft[]> {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error("Supabase is not configured.");
  const data = await rpcCall(supabase, "email_messages_list_drafts", {
    accountId,
    limit,
    offset,
  });
  return (Array.isArray(data) ? data : []) as EmailDraft[];
}

export async function listStarredMessages(
  accountId: string,
  limit: number = 50,
  offset: number = 0,
): Promise<EmailMessage[]> {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error("Supabase is not configured.");
  const data = await rpcCall(supabase, "email_messages_list_starred", {
    accountId,
    limit,
    offset,
  });
  return (Array.isArray(data) ? data : []) as EmailMessage[];
}

export async function listAllMessages(
  accountId: string,
  limit: number = 50,
  offset: number = 0,
  search?: string,
): Promise<EmailMessage[]> {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error("Supabase is not configured.");
  const data = await rpcCall(supabase, "email_messages_list_all", {
    accountId,
    limit,
    offset,
    search: search ?? null,
  });
  return (Array.isArray(data) ? data : []) as EmailMessage[];
}

export async function getMessage(
  id: string,
): Promise<(EmailMessage & { attachments: EmailAttachment[] }) | null> {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error("Supabase is not configured.");
  const data = await rpcCall(supabase, "email_messages_get", { id });
  return data as (EmailMessage & { attachments: EmailAttachment[] }) | null;
}

export async function getThreadMessages(
  threadId: string,
  accountId: string,
): Promise<(EmailMessage & { attachments: EmailAttachment[] })[]> {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error("Supabase is not configured.");
  const data = await rpcCall(supabase, "email_messages_list_thread", {
    threadId,
    accountId,
  });
  return (Array.isArray(data) ? data : []) as (EmailMessage & {
    attachments: EmailAttachment[];
  })[];
}

export async function markRead(
  id: string,
  isRead: boolean = true,
): Promise<boolean> {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error("Supabase is not configured.");
  const data = await rpcCall(supabase, "email_messages_mark_read", {
    id,
    isRead,
  });
  return data as boolean;
}

export async function markStarred(
  id: string,
  isStarred: boolean = true,
): Promise<boolean> {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error("Supabase is not configured.");
  const data = await rpcCall(supabase, "email_messages_mark_starred", {
    id,
    isStarred,
  });
  return data as boolean;
}

export async function moveMessage(
  id: string,
  folder: string,
): Promise<boolean> {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error("Supabase is not configured.");
  const data = await rpcCall(supabase, "email_messages_move", {
    id,
    folder,
  });
  return data as boolean;
}

export async function deleteMessage(id: string): Promise<boolean> {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error("Supabase is not configured.");
  const data = await rpcCall(supabase, "email_messages_delete", { id });
  return data as boolean;
}

export async function getMessageCounts(
  accountId: string,
  folder?: string,
): Promise<MailCounts> {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error("Supabase is not configured.");
  const data = await rpcCall(supabase, "email_messages_count", {
    accountId,
    folder: folder ?? null,
  });
  return (data as MailCounts) ?? { total: 0, unread: 0 };
}

// ── Draft operations ────────────────────────────────────────────────────

export async function saveDraft(
  accountId: string,
  draft: Partial<EmailDraft> & { id?: string },
): Promise<EmailDraft> {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error("Supabase is not configured.");
  const data = await rpcCall(supabase, "email_drafts_save", {
    accountId,
    id: draft.id ?? null,
    threadId: draft.thread_id ?? null,
    inReplyTo: draft.in_reply_to ?? null,
    references: draft.references ? JSON.stringify(draft.references) : null,
    toAddresses: JSON.stringify(draft.to_addresses ?? []),
    ccAddresses: JSON.stringify(draft.cc_addresses ?? []),
    bccAddresses: JSON.stringify(draft.bcc_addresses ?? []),
    subject: draft.subject ?? null,
    textBody: draft.text_body ?? null,
    htmlBody: draft.html_body ?? null,
    attachments: JSON.stringify(draft.attachments ?? []),
    signatureId: draft.signature_id ?? null,
  });
  return data as EmailDraft;
}

export async function deleteDraft(id: string): Promise<boolean> {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error("Supabase is not configured.");
  const data = await rpcCall(supabase, "email_drafts_delete", { id });
  return data as boolean;
}

// ── Signature operations ────────────────────────────────────────────────

export async function listSignatures(): Promise<EmailSignature[]> {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error("Supabase is not configured.");
  const data = await rpcCall(supabase, "email_signatures_list");
  return (Array.isArray(data) ? data : []) as EmailSignature[];
}

export async function saveSignature(
  sig: Partial<EmailSignature> & { name: string; id?: string },
): Promise<EmailSignature> {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error("Supabase is not configured.");
  const data = await rpcCall(supabase, "email_signatures_save", {
    id: sig.id ?? null,
    name: sig.name,
    signatureHtml: sig.signature_html ?? null,
    signatureText: sig.signature_text ?? null,
    isDefault: sig.is_default ?? false,
  });
  return data as EmailSignature;
}

export async function deleteSignature(id: string): Promise<boolean> {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error("Supabase is not configured.");
  const data = await rpcCall(supabase, "email_signatures_delete", { id });
  return data as boolean;
}

// ── Label operations ────────────────────────────────────────────────────

export async function listLabels(): Promise<EmailLabel[]> {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error("Supabase is not configured.");
  const data = await rpcCall(supabase, "email_labels_list");
  return (Array.isArray(data) ? data : []) as EmailLabel[];
}

export async function saveLabel(
  label: Partial<EmailLabel> & { name: string; id?: string },
): Promise<EmailLabel> {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error("Supabase is not configured.");
  const data = await rpcCall(supabase, "email_labels_save", {
    id: label.id ?? null,
    name: label.name,
    color: label.color ?? "#6b7280",
  });
  return data as EmailLabel;
}

export async function deleteLabel(id: string): Promise<boolean> {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error("Supabase is not configured.");
  const data = await rpcCall(supabase, "email_labels_delete", { id });
  return data as boolean;
}

export async function setMessageLabels(
  messageId: string,
  labelIds: string[],
): Promise<boolean> {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error("Supabase is not configured.");
  const data = await rpcCall(supabase, "email_messages_set_labels", {
    messageId,
    labelIds: JSON.stringify(labelIds),
  });
  return data as boolean;
}

// ── Edge Function operations (IMAP/SMTP) ────────────────────────────────

async function invokeEmailEdge(
  action: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error("Supabase is not configured.");
  const { data, error } = await supabase.functions.invoke("email", {
    body: { action, ...params },
  });
  if (error) throw error;
  const payload = data as { data?: unknown; error?: string } | null;
  if (payload && typeof payload === "object" && payload.error) {
    throw new Error(payload.error);
  }
  if (payload && typeof payload === "object" && "data" in payload) {
    return payload.data;
  }
  return payload;
}

/**
 * Test IMAP + SMTP connection. Password is sent to the Edge Function
 * which encrypts and stores it server-side. The password is NOT stored
 * in the browser after this call.
 */
export async function testConnection(params: {
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  imapUser: string;
  imapPassword: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  smtpPassword: string;
}): Promise<TestConnectionResult> {
  return (await invokeEmailEdge("test_connection", params)) as TestConnectionResult;
}

/**
 * Store encrypted credentials server-side. Called after successful test.
 * The Edge Function encrypts the password with AES-GCM and stores it
 * in the database. The password is NEVER returned to the browser.
 */
export async function setupAccountCredentials(params: {
  accountId: string;
  imapUser: string;
  imapPassword: string;
}): Promise<{ ok: boolean; error?: string }> {
  return (await invokeEmailEdge("setup_account", params)) as {
    ok: boolean;
    error?: string;
  };
}

/**
 * Test an existing account's connections. Password is NOT sent from browser.
 * The Edge Function reads encrypted credentials from the database.
 */
export async function testExistingAccount(params: {
  accountId: string;
}): Promise<TestConnectionResult> {
  return (await invokeEmailEdge("test_existing_account", params)) as TestConnectionResult;
}

export async function listImapFolders(params: {
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  imapUser: string;
  imapPassword: string;
}): Promise<{ ok: boolean; folders: string[] }> {
  return (await invokeEmailEdge("list_folders", params)) as {
    ok: boolean;
    folders: string[];
  };
}

/**
 * Sync messages from IMAP. Password is NOT sent — the Edge Function
 * reads encrypted credentials from the database and decrypts server-side.
 */
export async function syncFolder(params: {
  accountId: string;
  folder: string;
  limit?: number;
}): Promise<SyncResult> {
  return (await invokeEmailEdge("sync_folder", params)) as SyncResult;
}

/**
 * Send email via SMTP. Password is NOT sent — the Edge Function
 * reads encrypted credentials from the database and decrypts server-side.
 */
export async function sendMessage(params: {
  accountId: string;
  fromAddress?: string;
  fromName?: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  textBody: string;
  htmlBody?: string;
  inReplyTo?: string;
  references?: string[];
}): Promise<{ ok: boolean; error?: string }> {
  return (await invokeEmailEdge("send_message", params)) as {
    ok: boolean;
    error?: string;
  };
}

/**
 * Fetch full message body on demand. Password is NOT sent —
 * the Edge Function reads encrypted credentials from the database.
 */
export async function fetchMessageBody(params: {
  accountId: string;
  messageDbId?: string;
  folder: string;
  uid: string;
}): Promise<{ ok: boolean; textBody: string; htmlBody: string }> {
  return (await invokeEmailEdge("fetch_body", params)) as {
    ok: boolean;
    textBody: string;
    htmlBody: string;
  };
}
