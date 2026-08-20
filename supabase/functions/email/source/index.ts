// ---------------------------------------------------------------------------// email — IMAP/SMTP Edge Function for Atlas Mail (SECURITY HARDENED)
//
// ALL credential handling happens server-side. The browser never receives// passwords, encryption keys, or decrypted credentials.
//
// AES-256-GCM encryption for credential storage:
// - Key derived from ENCRYPTION_KEY env var (base64-encoded 32-byte key)
// - Random 12-byte IV per encryption
// - Authenticated encryption prevents tampering// - Credentials stored as: iv(12) + ciphertext + auth_tag(16)  all base64
//
// SECURITY CONTRACT:
// - Browser sends password ONLY during account creation/test
// - Edge Function encrypts and stores in database
// - For sync/send, Edge Function reads encrypted blob from DB and decrypts
// - Browser NEVER receives decrypted credentials back
// - No passwords in logs, error messages, or API responses
// ---------------------------------------------------------------------------

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.112.3";
import {
  atlasCorsHeaders,
  atlasJson,
  handleAtlasPreflight,
} from "./cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// ── AES-GCM Encryption ──────────────────────────────────────────────────

function getEncryptionKey(): Uint8Array {
  const raw = Deno.env.get("ENCRYPTION_KEY");
  if (!raw) {
    throw new Error("ENCRYPTION_KEY environment variable is not set");
  }
  // Decode base64 key
  const keyBytes = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));
  if (keyBytes.length !== 32) {
    throw new Error("ENCRYPTION_KEY must be a 32-byte (256-bit) key");
  }
  return keyBytes;
}

async function encryptCredential(plaintext: string): Promise<string> {
  const keyData = getEncryptionKey();
  const key = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "AES-GCM" },
    false,
    ["encrypt"],
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoded,
  );
  // Combine: iv(12) + ciphertext (includes 16-byte auth tag)
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);
  return btoa(String.fromCharCode(...combined));
}

async function decryptCredential(encryptedBase64: string): Promise<string> {
  const keyData = getEncryptionKey();
  const key = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "AES-GCM" },
    false,
    ["decrypt"],
  );
  const combined = Uint8Array.from(atob(encryptedBase64), (c) =>
    c.charCodeAt(0),
  );
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    ciphertext,
  );
  return new TextDecoder().decode(decrypted);
}

// ── HTML Sanitization ───────────────────────────────────────────────────

function sanitizeHtml(html: string): string {
  // Strip dangerous tags and attributes
  let safe = html
    // Remove script tags and content
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    // Remove event handlers
    .replace(/\son\w+\s*=\s*["'][^"']*["']/gi, "")
    .replace(/\son\w+\s*=\s*\S+/gi, "")
    // Remove javascript: URLs
    .replace(/javascript\s*:/gi, "")
    // Remove data: URLs (except common safe ones)
    .replace(/data\s*:(?!image\/(?:png|gif|jpeg|jpg|svg\+xml))/gi, "")
    // Remove iframe/object/embed/applet
    .replace(/<(iframe|object|embed|applet|form|input|button|select|textarea)\b[^>]*>/gi, "")
    .replace(/<\/(iframe|object|embed|applet|form|input|button|select|textarea)>/gi, "")
    // Remove base tag
    .replace(/<base\b[^>]*>/gi, "")
    // Remove link tags (can load external stylesheets)
    .replace(/<link\b[^>]*>/gi, "")
    // Remove meta refresh redirects
    .replace(/<meta\b[^>]*http-equiv\s*=\s*["']refresh["'][^>]*>/gi, "")
    // Remove style tags (can contain CSS expressions)
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
    // Remove XML processing instructions
    .replace(/<\?[^>]*\?>/g, "")
    // Remove VML
    .replace(/<!--\[if[^>]*>[\s\S]*?<!\[endif\]-->/gi, "")
    // Remove expression() in style attributes
    .replace(/expression\s*\([^)]*\)/gi, "")
    // Remove -moz-binding
    .replace(/-moz-binding\s*:[^;]*/gi, "")
    // Remove behavior:
    .replace(/behavior\s*:[^;]*/gi, "");

  return safe;
}

// ── Helpers ──────────────────────────────────────────────────────────────

/** Resolve the caller's tenant from the JWT + memberships table. */
async function resolveTenant(
  admin: ReturnType<typeof createClient>,
): Promise<string | null> {
  const {
    data: { user },
    error: userError,
  } = await admin.auth.getUser(
    admin.rest.headers.get("Authorization")?.replace("Bearer ", "") ?? "",
  );
  if (userError || !user) return null;
  const { data: memberships } = await admin
    .from("memberships")
    .select('"tenantId"')
    .eq("userId", user.id)
    .eq("status", "active")
    .limit(1);
  return (memberships?.[0]?.tenantId as string) ?? null;
}

/** Read email account credentials from the database and decrypt. */
async function getDecryptedCredentials(
  admin: ReturnType<typeof createClient>,
  accountId: string,
): Promise<{
  email: string;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  password: string;
  syncFolders: Array<{ name: string; uid_validity?: number; last_uid?: number }>;
} | null> {
  const { data: account, error } = await admin
    .from("email_accounts")
    .select("*")
    .eq("id", accountId)
    .single();
  if (error || !account) return null;

  let password = "";
  if (account.encrypted_credentials) {
    try {
      password = await decryptCredential(account.encrypted_credentials);
    } catch (e) {
      console.error("[email] Failed to decrypt credentials:", e);
      return null;
    }
  }

  return {
    email: account.email_address,
    imapHost: account.imap_host,
    imapPort: account.imap_port,
    imapSecure: account.imap_secure,
    smtpHost: account.smtp_host,
    smtpPort: account.smtp_port,
    smtpSecure: account.smtp_secure,
    password,
    syncFolders: Array.isArray(account.sync_folders)
      ? account.sync_folders
      : [],
  };
}

/** Safe error message extraction — never includes credentials. */
function safeErrorMessage(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  // Strip any potential credential leakage
  return msg
    .replace(/password\s*[=:]\s*\S+/gi, "password=***")
    .replace(/PASS\s+\S+/gi, "PASS ***")
    .replace(/AUTH\s+\S+/gi, "AUTH ***")
    .slice(0, 200);
}

// ── Minimal IMAP Client (Deno native TCP) ────────────────────────────────

interface ImapConnection {
  conn: Deno.TcpConn | Deno.TlsConn;
  reader: ReadableStreamDefaultReader<Uint8Array>;
  writer: WritableStreamDefaultWriter<Uint8Array>;
  buffer: string;
  tagCounter: number;
}

async function imapConnect(
  host: string,
  port: number,
  secure: boolean,
): Promise<ImapConnection> {
  let conn: Deno.TcpConn | Deno.TlsConn;
  if (secure) {
    conn = await Deno.connectTls({ hostname: host, port });
  } else {
    conn = await Deno.connect({ hostname: host, port });
  }
  const reader = conn.readable.getReader();
  const writer = conn.writable.getWriter();
  const imap: ImapConnection = {
    conn,
    reader,
    writer,
    buffer: "",
    tagCounter: 0,
  };
  await imapReadLine(imap);
  return imap;
}

async function imapReadLine(imap: ImapConnection): Promise<string> {
  while (true) {
    const newlineIdx = imap.buffer.indexOf("\r\n");
    if (newlineIdx !== -1) {
      const line = imap.buffer.slice(0, newlineIdx);
      imap.buffer = imap.buffer.slice(newlineIdx + 2);
      return line;
    }
    const { value, done } = await imap.reader.read();
    if (done) throw new Error("IMAP connection closed");
    imap.buffer += new TextDecoder().decode(value);
  }
}

async function imapReadLiteral(
  imap: ImapConnection,
  size: number,
): Promise<string> {
  while (imap.buffer.length < size) {
    const { value, done } = await imap.reader.read();
    if (done) throw new Error("IMAP connection closed during literal");
    imap.buffer += new TextDecoder().decode(value);
  }
  const data = imap.buffer.slice(0, size);
  imap.buffer = imap.buffer.slice(size);
  await imapReadLine(imap);
  return data;
}

async function imapSendCommand(
  imap: ImapConnection,
  command: string,
): Promise<string[]> {
  imap.tagCounter++;
  const tag = `A${String(imap.tagCounter).padStart(4, "0")}`;
  const cmd = `${tag} ${command}\r\n`;
  await imap.writer.write(new TextEncoder().encode(cmd));
  const responses: string[] = [];
  let complete = false;
  while (!complete) {
    let line = await imapReadLine(imap);
    const literalMatch = line.match(/\{(\d+)\}$/);
    if (literalMatch) {
      const size = parseInt(literalMatch[1]);
      await imapReadLiteral(imap, size);
      line = await imapReadLine(imap);
    }
    responses.push(line);
    if (line.startsWith(tag + " ")) {
      complete = true;
    }
  }
  return responses;
}

function parseImapFolders(
  responses: string[],
): Array<{ name: string; delimiter: string; flags: string[] }> {
  const folders: Array<{ name: string; delimiter: string; flags: string[] }> =
    [];
  for (const line of responses) {
    const listMatch = line.match(
      /^\* LIST \(([^)]*)\) "([^"]*)" (.+)$/,
    );
    if (listMatch) {
      const flags = listMatch[1]
        .split(" ")
        .map((f) => f.replace(/^\(|\)$/g, "").trim())
        .filter(Boolean);
      const delimiter = listMatch[2];
      let name = listMatch[3].trim();
      if (name.startsWith('"') && name.endsWith('"')) {
        name = name.slice(1, -1);
      }
      folders.push({ name, delimiter, flags });
    }
  }
  return folders;
}

async function imapClose(imap: ImapConnection): Promise<void> {
  try {
    await imapSendCommand(imap, "LOGOUT");
  } catch {
    // Ignore
  }
  try { imap.reader.cancel(); } catch { /* */ }
  try { imap.conn.close(); } catch { /* */ }
}

// ── Minimal SMTP Client ──────────────────────────────────────────────────

interface SmtpConnection {
  conn: Deno.TcpConn | Deno.TlsConn;
  reader: ReadableStreamDefaultReader<Uint8Array>;
  writer: WritableStreamDefaultWriter<Uint8Array>;
  buffer: string;
}

async function smtpConnect(
  host: string,
  port: number,
  secure: boolean,
): Promise<SmtpConnection> {
  let conn: Deno.TcpConn | Deno.TlsConn;
  if (secure) {
    conn = await Deno.connectTls({ hostname: host, port });
  } else {
    conn = await Deno.connect({ hostname: host, port });
  }
  const smtp: SmtpConnection = {
    conn,
    reader: conn.readable.getReader(),
    writer: conn.writable.getWriter(),
    buffer: "",
  };
  await smtpReadResponse(smtp);
  return smtp;
}

async function smtpReadResponse(smtp: SmtpConnection): Promise<string[]> {
  const lines: string[] = [];
  while (true) {
    const newlineIdx = smtp.buffer.indexOf("\r\n");
    if (newlineIdx !== -1) {
      const line = smtp.buffer.slice(0, newlineIdx);
      smtp.buffer = smtp.buffer.slice(newlineIdx + 2);
      lines.push(line);
      if (line.length >= 4 && line[3] === " ") break;
    } else {
      const { value, done } = await smtp.reader.read();
      if (done) throw new Error("SMTP connection closed");
      smtp.buffer += new TextDecoder().decode(value);
    }
  }
  return lines;
}

async function smtpSend(
  smtp: SmtpConnection,
  command: string,
): Promise<string[]> {
  await smtp.writer.write(new TextEncoder().encode(command + "\r\n"));
  return smtpReadResponse(smtp);
}

async function smtpAuthenticate(
  smtp: SmtpConnection,
  user: string,
  pass: string,
): Promise<void> {
  const ehloResp = await smtpSend(smtp, "EHLO atlas-mail");
  const ehloStr = ehloResp.join("\n").toLowerCase();
  if (ehloStr.includes("auth login")) {
    await smtpSend(smtp, "AUTH LOGIN");
    await smtpSend(smtp, btoa(user));
    const authResp = await smtpSend(smtp, btoa(pass));
    if (!authResp.join("").startsWith("235")) {
      throw new Error("SMTP authentication failed");
    }
  } else if (ehloStr.includes("auth plain")) {
    const authStr = btoa(`\0${user}\0${pass}`);
    const authResp = await smtpSend(smtp, `AUTH PLAIN ${authStr}`);
    if (!authResp.join("").startsWith("235")) {
      throw new Error("SMTP authentication failed");
    }
  } else {
    throw new Error("SMTP server does not support AUTH LOGIN or AUTH PLAIN");
  }
}

async function smtpSendMessage(
  smtp: SmtpConnection,
  from: string,
  recipients: string[],
  rawMessage: string,
): Promise<void> {
  const mailResp = await smtpSend(smtp, `MAIL FROM:<${from}>`);
  if (!mailResp.join("").startsWith("250")) {
    throw new Error("SMTP MAIL FROM rejected");
  }
  for (const rcpt of recipients) {
    const rcptResp = await smtpSend(smtp, `RCPT TO:<${rcpt}>`);
    if (!rcptResp.join("").startsWith("250")) {
      throw new Error(`SMTP recipient rejected: ${rcpt}`);
    }
  }
  const dataResp = await smtpSend(smtp, "DATA");
  if (!dataResp.join("").startsWith("354")) {
    throw new Error("SMTP DATA rejected");
  }
  const lines = rawMessage.split("\r\n");
  for (const line of lines) {
    const escapedLine = line.startsWith(".") ? "." + line : line;
    await smtp.writer.write(new TextEncoder().encode(escapedLine + "\r\n"));
  }
  await smtp.writer.write(new TextEncoder().encode(".\r\n"));
  const finalResp = await smtpReadResponse(smtp);
  if (!finalResp.join("").startsWith("250")) {
    throw new Error("SMTP message rejected");
  }
}

async function smtpClose(smtp: SmtpConnection): Promise<void> {
  try { await smtpSend(smtp, "QUIT"); } catch { /* */ }
  try { smtp.reader.cancel(); } catch { /* */ }
  try { smtp.conn.close(); } catch { /* */ }
}

// ── Build raw email message ──────────────────────────────────────────────

function buildRawMessage(params: {
  from: string;
  fromName: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  textBody: string;
  htmlBody: string;
  inReplyTo?: string;
  references?: string[];
}): string {
  const boundary = `----=_Part_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const messageId = `<${Date.now()}.${Math.random().toString(36).slice(2)}@atlas-mail>`;
  const lines: string[] = [];
  lines.push(`From: ${params.fromName ? `${params.fromName} ` : ""}<${params.from}>`);
  lines.push(`To: ${params.to.join(", ")}`);
  if (params.cc.length > 0) lines.push(`CC: ${params.cc.join(", ")}`);
  if (params.bcc.length > 0) lines.push(`BCC: ${params.bcc.join(", ")}`);
  lines.push(`Subject: ${params.subject}`);
  lines.push(`Message-ID: ${messageId}`);
  lines.push(`Date: ${new Date().toUTCString()}`);
  lines.push(`MIME-Version: 1.0`);
  if (params.inReplyTo) lines.push(`In-Reply-To: ${params.inReplyTo}`);
  if (params.references && params.references.length > 0) {
    lines.push(`References: ${params.references.join(" ")}`);
  }

  const hasHtml = params.htmlBody && params.htmlBody.trim().length > 0;

  if (hasHtml) {
    lines.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
    lines.push("");
    if (params.textBody) {
      lines.push(`--${boundary}`);
      lines.push(`Content-Type: text/plain; charset=UTF-8`);
      lines.push(`Content-Transfer-Encoding: 7bit`);
      lines.push("");
      lines.push(params.textBody);
      lines.push("");
    }
    lines.push(`--${boundary}`);
    lines.push(`Content-Type: text/html; charset=UTF-8`);
    lines.push(`Content-Transfer-Encoding: 7bit`);
    lines.push("");
    lines.push(params.htmlBody);
    lines.push("");
    lines.push(`--${boundary}--`);
  } else {
    lines.push(`Content-Type: text/plain; charset=UTF-8`);
    lines.push(`Content-Transfer-Encoding: 7bit`);
    lines.push("");
    lines.push(params.textBody);
  }

  return lines.join("\r\n");
}

// ── Thread ID computation ────────────────────────────────────────────────

function computeThreadId(
  messageId: string | null,
  inReplyTo: string | null,
  references: string[],
  subject: string,
): string {
  // Priority: Message-ID chain > subject normalization
  if (inReplyTo) return inReplyTo;
  if (references.length > 0) return references[0];
  if (messageId) return messageId;
  // Fallback: normalized subject
  const normalized = subject
    .replace(/^(Re|Fw|Fwd|RE|FW|FWD):\s*/gi, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-");
  return normalized || `msg-${Date.now()}`;
}

// ── Handlers ─────────────────────────────────────────────────────────────

async function handleTestConnection(
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const {
    imapHost,
    imapPort,
    imapSecure,
    imapUser,
    imapPassword,
    smtpHost,
    smtpPort,
    smtpSecure,
    smtpUser,
    smtpPassword,
  } = body as Record<string, unknown>;

  if (!imapHost || !imapUser || !imapPassword) {
    return { ok: false, error: "IMAP credentials are required" };
  }

  let imapOk = false;
  let imapError = "";
  let folders: string[] = [];

  // Test IMAP
  try {
    const imap = await imapConnect(
      imapHost as string,
      imapPort as number,
      imapSecure as boolean,
    );
    try {
      await imapSendCommand(imap, `LOGIN "${imapUser}" "${imapPassword}"`);
      const listResp = await imapSendCommand(imap, 'LIST "" "*"');
      folders = parseImapFolders(listResp).map((f) => f.name);
      await imapSendCommand(imap, "LOGOUT");
      imapOk = true;
    } finally {
      await imapClose(imap);
    }
  } catch (e) {
    imapError = safeErrorMessage(e);
  }

  let smtpOk = false;
  let smtpError = "";

  if (smtpHost && smtpUser && smtpPassword) {
    try {
      const smtp = await smtpConnect(
        smtpHost as string,
        smtpPort as number,
        smtpSecure as boolean,
      );
      try {
        await smtpAuthenticate(smtp, smtpUser as string, smtpPassword as string);
        smtpOk = true;
      } finally {
        await smtpClose(smtp);
      }
    } catch (e) {
      smtpError = safeErrorMessage(e);
    }
  }

  return {
    ok: imapOk && (smtpOk || !smtpHost),
    imap: { ok: imapOk, error: imapError || undefined, folders },
    smtp: { ok: smtpOk, error: smtpError || undefined },
  };
}

async function handleSetupAccount(
  body: Record<string, unknown>,
  admin: ReturnType<typeof createClient>,
  tenantId: string,
): Promise<Record<string, unknown>> {
  const {
    accountId,
    imapUser,
    imapPassword,
  } = body as Record<string, unknown>;

  if (!accountId || !imapPassword) {
    return { ok: false, error: "Account ID and password required" };
  }

  // Encrypt the password server-side
  const encrypted = await encryptCredential(imapPassword as string);

  // Store encrypted credentials
  const { error } = await admin
    .from("email_accounts")
    .update({
      encrypted_credentials: encrypted,
      connection_status: "connected",
      connection_error: null,
      connection_tested_at: new Date().toISOString(),
    })
    .eq("id", accountId)
    .eq("tenant_id", tenantId);

  if (error) {
    return { ok: false, error: "Failed to store credentials" };
  }

  return { ok: true };
}

async function handleSyncFolder(
  body: Record<string, unknown>,
  admin: ReturnType<typeof createClient>,
  tenantId: string,
): Promise<Record<string, unknown>> {
  const { accountId, folder, limit } = body as Record<string, unknown>;
  const syncLimit = Math.min((limit as number) ?? 100, 200);

  if (!accountId || !folder) {
    return { ok: false, error: "Account ID and folder required" };
  }

  // Read and decrypt credentials from database
  const creds = await getDecryptedCredentials(admin, accountId as string);
  if (!creds) {
    return { ok: false, error: "Account not found or credentials unreadable" };
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  let synced = 0;
  let imap: ImapConnection | null = null;

  try {
    imap = await imapConnect(creds.imapHost, creds.imapPort, creds.imapSecure);
    await imapSendCommand(imap, `LOGIN "${creds.email}" "${creds.password}"`);

    // Get sync state for incremental sync
    const folderState = creds.syncFolders.find(
      (f) => f.name === (folder as string),
    );
    const lastUid = folderState?.last_uid ?? 0;

    const selectResp = await imapSendCommand(imap, `SELECT "${folder}"`);
    const existsLine = selectResp.find((l) => l.includes("EXISTS"));
    const totalMessages = existsLine
      ? parseInt(existsLine.match(/(\d+) EXISTS/)?.[1] ?? "0")
      : 0;

    // Get UIDVALIDITY
    const uidValidLine = selectResp.find((l) => l.includes("UIDVALIDITY"));
    const uidValidity = uidValidLine
      ? parseInt(uidValidLine.match(/UIDVALIDITY (\d+)/)?.[1] ?? "0")
      : 0;

    if (totalMessages === 0) {
      await imapSendCommand(imap, "LOGOUT");
      return { ok: true, synced: 0, total: 0, folder };
    }

    // Incremental sync: only fetch messages with UID > lastUid
    let range: string;
    if (lastUid > 0) {
      range = `${lastUid + 1}:*`;
    } else {
      const start = Math.max(1, totalMessages - syncLimit + 1);
      range = `${start}:${totalMessages}`;
    }

    const responses = await imapSendCommand(
      imap,
      `FETCH ${range} (UID ENVELOPE FLAGS)`,
    );

    let currentUid: string | null = null;
    let currentSubject = "";
    let currentDate = "";
    let currentFrom = "";
    let currentFromName = "";
    let currentMessageId = "";
    let currentInReplyTo = "";
    let currentReferences: string[] = [];
    let currentFlags: string[] = [];
    let maxUid = lastUid;
    const messages: Array<{
      uid: string;
      subject: string;
      date: string;
      fromAddress: string;
      fromName: string;
      messageId: string;
      inReplyTo: string;
      references: string[];
      flags: string[];
    }> = [];

    for (const line of responses) {
      if (line.includes("FETCH")) {
        if (currentUid) {
          messages.push({
            uid: currentUid,
            subject: currentSubject,
            date: currentDate,
            fromAddress: currentFrom,
            fromName: currentFromName,
            messageId: currentMessageId,
            inReplyTo: currentInReplyTo,
            references: [...currentReferences],
            flags: [...currentFlags],
          });
          const uidNum = parseInt(currentUid);
          if (uidNum > maxUid) maxUid = uidNum;
        }

        const uidMatch = line.match(/UID (\d+)/);
        currentUid = uidMatch?.[1] ?? null;
        currentSubject = "";
        currentDate = "";
        currentFrom = "";
        currentFromName = "";
        currentMessageId = "";
        currentInReplyTo = "";
        currentReferences = [];
        currentFlags = [];

        const flagsMatch = line.match(/FLAGS \(([^)]*)\)/);
        if (flagsMatch) {
          currentFlags = flagsMatch[1]
            .split(" ")
            .map((f) => f.replace(/^\\/, "").trim())
            .filter(Boolean);
        }
      }

      // Parse ENVELOPE
      if (line.includes("ENVELOPE")) {
        const subjectMatch = line.match(/ENVELOPE \([^)]*"([^"]*)"/);
        if (subjectMatch) currentSubject = subjectMatch[1];

        const fromMatch = line.match(/\("([^"]*)" NIL "([^"]*)" "([^"]*)"\)/);
        if (fromMatch) {
          currentFromName = fromMatch[1];
          currentFrom = `${fromMatch[2]}@${fromMatch[3]}`;
        }

        const dateMatch = line.match(/ENVELOPE \("([^"]*)"/);
        if (dateMatch) currentDate = dateMatch[1];

        // Extract Message-ID from envelope
        const msgIdMatch = line.match(/"([^"]*<[^>]*>)"/);
        if (msgIdMatch) currentMessageId = msgIdMatch[1];

        // Extract In-Reply-To
        const replyMatch = line.match(/"([^"]*<[^>]*>)"/g);
        if (replyMatch && replyMatch.length > 3) {
          const potentialReplyTo = replyMatch[3].replace(/"/g, "");
          if (potentialReplyTo !== "NIL" && potentialReplyTo !== currentMessageId) {
            currentInReplyTo = potentialReplyTo;
          }
        }

        // Extract References
        const refsMatch = line.match(/\(([^)]*(?:<[^>]*>[^)]*)*)\)/g);
        if (refsMatch && refsMatch.length > 4) {
          const refStr = refsMatch[4].replace(/[()"]/g, "");
          if (refStr && refStr !== "NIL") {
            currentReferences = refStr.split(/\s+/).filter((r) => r.includes("<"));
          }
        }
      }
    }

    // Push last message
    if (currentUid) {
      messages.push({
        uid: currentUid,
        subject: currentSubject,
        date: currentDate,
        fromAddress: currentFrom,
        fromName: currentFromName,
        messageId: currentMessageId,
        inReplyTo: currentInReplyTo,
        references: [...currentReferences],
        flags: [...currentFlags],
      });
      const uidNum = parseInt(currentUid);
      if (uidNum > maxUid) maxUid = uidNum;
    }

    // Store messages in database
    for (const msg of messages) {
      const isRead = msg.flags.includes("Seen");
      const isStarred = msg.flags.includes("Flagged");

      // Check if message already exists
      const { data: existing } = await supabase
        .from("email_messages")
        .select("id")
        .eq("account_id", accountId)
        .eq("provider_message_id", msg.uid)
        .eq("folder", folder)
        .maybeSingle();

      if (existing) continue;

      // Compute thread ID using Message-ID chain (not just subject)
      const threadId = computeThreadId(
        msg.messageId || null,
        msg.inReplyTo || null,
        msg.references,
        msg.subject,
      );

      const snippet = msg.subject ? msg.subject.slice(0, 200) : "";

      await supabase.from("email_messages").insert({
        account_id: accountId,
        provider_message_id: msg.uid,
        message_id: msg.messageId || null,
        thread_id: threadId,
        in_reply_to: msg.inReplyTo || null,
        references: msg.references.length > 0 ? JSON.stringify(msg.references) : null,
        from_address: msg.fromAddress,
        from_name: msg.fromName,
        to_addresses: JSON.stringify([{ name: "", address: creds.email }]),
        subject: msg.subject,
        snippet,
        received_at: msg.date ? new Date(msg.date).toISOString() : null,
        is_read: isRead,
        is_starred: isStarred,
        folder,
        body_fetched: false,
        uid_validity: uidValidity,
        last_uid: parseInt(msg.uid),
      });

      synced++;
    }

    // Update sync state for incremental sync
    await supabase.rpc("email_accounts_update_sync_state", {
      p_id: accountId,
      p_folder: folder,
      p_uid_validity: uidValidity,
      p_last_uid: maxUid,
      p_last_synced_at: new Date().toISOString(),
    });

    // Update account status
    await supabase
      .from("email_accounts")
      .update({
        connection_status: "connected",
        connection_error: null,
        last_synced_at: new Date().toISOString(),
      })
      .eq("id", accountId);

    await imapSendCommand(imap, "LOGOUT");
    return {
      ok: true,
      synced,
      total: totalMessages,
      fetched: messages.length,
      folder,
    };
  } catch (e) {
    // Update account with error status
    await supabase
      .from("email_accounts")
      .update({
        connection_status: "error",
        connection_error: safeErrorMessage(e),
      })
      .eq("id", accountId);

    return {
      ok: false,
      error: safeErrorMessage(e),
      synced,
    };
  } finally {
    if (imap) {
      try { await imapClose(imap); } catch { /* */ }
    }
  }
}

async function handleFetchBody(
  body: Record<string, unknown>,
  admin: ReturnType<typeof createClient>,
): Promise<Record<string, unknown>> {
  const { accountId, messageDbId, folder, uid } = body as Record<string, unknown>;

  if (!accountId || !uid) {
    return { ok: false, error: "Account ID and UID required" };
  }

  // Read and decrypt credentials from database
  const creds = await getDecryptedCredentials(admin, accountId as string);
  if (!creds) {
    return { ok: false, error: "Account not found or credentials unreadable" };
  }

  const imap = await imapConnect(creds.imapHost, creds.imapPort, creds.imapSecure);
  try {
    await imapSendCommand(imap, `LOGIN "${creds.email}" "${creds.password}"`);
    await imapSendCommand(imap, `SELECT "${folder ?? "INBOX"}"`);

    // Fetch the full message body
    const responses = await imapSendCommand(
      imap,
      `FETCH ${uid} (BODY[])`,
    );

    let rawBody = "";
    for (const line of responses) {
      if (line.includes("BODY[]")) {
        const bodyMatch = line.match(/\{(\d+)\}/);
        if (bodyMatch) {
          rawBody = await imapReadLiteral(imap, parseInt(bodyMatch[1]));
        }
      }
    }

    await imapSendCommand(imap, "LOGOUT");

    // Parse the raw email to extract text and HTML bodies
    let textBody = "";
    let htmlBody = "";

    // Simple MIME parsing
    const boundaryMatch = rawBody.match(/boundary="?([^";\r\n]+)"?/i);
    if (boundaryMatch) {
      const boundary = boundaryMatch[1];
      const parts = rawBody.split(new RegExp(`--${boundary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:--)?`));
      for (const part of parts) {
        if (part.includes("text/plain") && !textBody) {
          const headerEnd = part.indexOf("\r\n\r\n");
          if (headerEnd !== -1) {
            textBody = part.slice(headerEnd + 4).trim();
          }
        }
        if (part.includes("text/html") && !htmlBody) {
          const headerEnd = part.indexOf("\r\n\r\n");
          if (headerEnd !== -1) {
            htmlBody = part.slice(headerEnd + 4).trim();
          }
        }
      }
    } else {
      // No MIME — plain text
      const headerEnd = rawBody.indexOf("\r\n\r\n");
      if (headerEnd !== -1) {
        textBody = rawBody.slice(headerEnd + 4).trim();
      }
    }

    // Sanitize HTML
    if (htmlBody) {
      htmlBody = sanitizeHtml(htmlBody);
    }

    // Update the message in the database
    if (messageDbId) {
      const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
      await supabase
        .from("email_messages")
        .update({
          text_body: textBody || null,
          html_body: htmlBody || null,
          body_fetched: true,
        })
        .eq("id", messageDbId);
    }

    return { ok: true, textBody, htmlBody };
  } finally {
    try { await imapClose(imap); } catch { /* */ }
  }
}

/**
 * Test an existing account's IMAP/SMTP connections.
 * Reads encrypted credentials from the database — no password sent from browser.
 */
async function handleTestExistingAccount(
  body: Record<string, unknown>,
  admin: ReturnType<typeof createClient>,
  _tenantId: string,
): Promise<Record<string, unknown>> {
  const { accountId } = body as Record<string, unknown>;
  if (!accountId) return { ok: false, error: "Account ID required" };

  const creds = await getDecryptedCredentials(admin, accountId as string);
  if (!creds) return { ok: false, error: "Account not found or credentials unreadable" };

  let imapOk = false;
  let imapError = "";
  let folders: string[] = [];

  try {
    const imap = await imapConnect(creds.imapHost, creds.imapPort, creds.imapSecure);
    try {
      await imapSendCommand(imap, `LOGIN "${creds.email}" "${creds.password}"`);
      const listResp = await imapSendCommand(imap, 'LIST "" "*"');
      folders = parseImapFolders(listResp).map((f) => f.name);
      await imapSendCommand(imap, "LOGOUT");
      imapOk = true;
    } finally {
      await imapClose(imap);
    }
  } catch (e) {
    imapError = safeErrorMessage(e);
  }

  let smtpOk = false;
  let smtpError = "";

  if (creds.smtpHost) {
    try {
      const smtp = await smtpConnect(creds.smtpHost, creds.smtpPort, creds.smtpSecure);
      try {
        await smtpAuthenticate(smtp, creds.email, creds.password);
        smtpOk = true;
      } finally {
        await smtpClose(smtp);
      }
    } catch (e) {
      smtpError = safeErrorMessage(e);
    }
  }

  // Update account status
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  await supabase
    .from("email_accounts")
    .update({
      connection_status: imapOk && (smtpOk || !creds.smtpHost) ? "connected" : "error",
      connection_error: !imapOk ? imapError : !smtpOk ? smtpError : null,
      connection_tested_at: new Date().toISOString(),
    })
    .eq("id", accountId);

  return {
    ok: imapOk && (smtpOk || !creds.smtpHost),
    imap: { ok: imapOk, error: imapError || undefined, folders },
    smtp: { ok: smtpOk, error: smtpError || undefined },
  };
}

async function handleSendMessage(
  body: Record<string, unknown>,
  admin: ReturnType<typeof createClient>,
  tenantId: string,
): Promise<Record<string, unknown>> {
  const {
    accountId,
    fromAddress,
    fromName,
    to,
    cc,
    bcc,
    subject,
    textBody,
    htmlBody,
    inReplyTo,
    references,
  } = body as Record<string, unknown>;

  if (!accountId || !to || !(to as string[]).length) {
    return { ok: false, error: "Account ID and at least one recipient required" };
  }

  // Read and decrypt credentials from database
  const creds = await getDecryptedCredentials(admin, accountId as string);
  if (!creds) {
    return { ok: false, error: "Account not found or credentials unreadable" };
  }

  const rawMessage = buildRawMessage({
    from: fromAddress as string ?? creds.email,
    fromName: (fromName as string) ?? "",
    to: (to as string[]) ?? [],
    cc: (cc as string[]) ?? [],
    bcc: (bcc as string[]) ?? [],
    subject: (subject as string) || "(no subject)",
    textBody: (textBody as string) ?? "",
    htmlBody: (htmlBody as string) ?? "",
    inReplyTo: inReplyTo as string | undefined,
    references: references as string[] | undefined,
  });

  const smtp = await smtpConnect(creds.smtpHost, creds.smtpPort, creds.smtpSecure);
  try {
    await smtpAuthenticate(smtp, creds.email, creds.password);
    const allRecipients = [
      ...(to as string[]),
      ...((cc as string[]) ?? []),
      ...((bcc as string[]) ?? []),
    ];
    await smtpSendMessage(smtp, creds.email, allRecipients, rawMessage);
    await smtpClose(smtp);

    // Store sent message in database
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const messageId = `<${Date.now()}.${Math.random().toString(36).slice(2)}@atlas-mail>`;
    const threadId = computeThreadId(
      messageId,
      (inReplyTo as string) || null,
      (references as string[]) || [],
      (subject as string) || "",
    );

    await supabase.from("email_messages").insert({
      account_id: accountId,
      message_id: messageId,
      thread_id: threadId,
      in_reply_to: inReplyTo || null,
      references: references ? JSON.stringify(references) : null,
      from_address: fromAddress ?? creds.email,
      from_name: fromName ?? null,
      to_addresses: JSON.stringify(
        ((to as string[]) ?? []).map((a) => ({ name: "", address: a })),
      ),
      cc_addresses: JSON.stringify(
        ((cc as string[]) ?? []).map((a) => ({ name: "", address: a })),
      ),
      subject: subject ?? "(no subject)",
      text_body: textBody as string ?? null,
      snippet: ((textBody as string) ?? "").slice(0, 200),
      sent_at: new Date().toISOString(),
      is_read: true,
      folder: "Sent",
    });

    return { ok: true };
  } catch (e) {
    await smtpClose(smtp);
    return { ok: false, error: safeErrorMessage(e) };
  }
}

// ── Main Handler ─────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  const preflight = handleAtlasPreflight(req);
  if (preflight) return preflight;

  const headers = atlasCorsHeaders(req);

  try {
    const authorization = req.headers.get("authorization") ?? "";
    const token = authorization.replace(/^Bearer\s+/i, "").trim();
    if (!token) {
      return atlasJson({ ok: false, error: "Unauthorized" }, 401, headers);
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const tenantId = await resolveTenant(admin);
    if (!tenantId) {
      return atlasJson({ ok: false, error: "No active workspace" }, 403, headers);
    }

    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch { /* GET or empty */ }

    const action = (body.action as string) ?? "";
    let result: Record<string, unknown>;

    switch (action) {
      case "test_connection":
        result = await handleTestConnection(body);
        break;
      case "setup_account":
        result = await handleSetupAccount(body, admin, tenantId);
        break;
      case "sync_folder":
        result = await handleSyncFolder(body, admin, tenantId);
        break;
      case "send_message":
        result = await handleMessageSend(body, admin, tenantId);
        break;
      case "fetch_body":
        result = await handleFetchBody(body, admin);
        break;
      case "test_existing_account":
        result = await handleTestExistingAccount(body, admin, tenantId);
        break;
      default:
        result = { ok: false, error: `Unknown action: ${action}` };
    }

    return atlasJson(result, 200, headers);
  } catch (e) {
    console.error("[email] handler failed:", e);
    return atlasJson({ ok: false, error: "Internal error" }, 500, headers);
  }
});

// Alias for the send handler
const handleMessageSend = handleSendMessage;
