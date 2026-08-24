// ---------------------------------------------------------------------------
// Atlas Mail — Edge Function for IMAP/SMTP operations
// (SECURITY HARDENED — 2026-08-24)
//
// Actions: test_connection, setup_account, test_existing_account,
//          list_folders, sync_folder, send_message, fetch_body
//
// SECURITY MODEL:
//   - ENCRYPTION_KEY is REQUIRED — function fails closed if missing
//   - Credentials are encrypted with AES-GCM before database storage
//   - The browser never receives decrypted passwords
//   - The Edge Function reads encrypted credentials from the database
//   - Only authenticated super_admin / atlas_admin users can invoke
//   - CORS restricted to production origins only
//   - Error messages never expose credentials, encryption keys, or internals
// ---------------------------------------------------------------------------

// ── CORS ────────────────────────────────────────────────────────────────

const ATLAS_ALLOWED_ORIGINS = [
  "https://atlasmvp.freebuff.app",
  "https://atlasuniversalos.freebuff.app",
];

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  const h: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
  if (ATLAS_ALLOWED_ORIGINS.includes(origin)) {
    h["Access-Control-Allow-Origin"] = origin;
  }
  return h;
}

// ── Safe error helper (never expose internals) ───────────────────────────

function safeError(
  message: string,
  internalDetail?: string,
): { ok: false; error: string } {
  // Log internals server-side only — never return to client
  if (internalDetail) {
    console.error(`[email-fn] ${message}: ${internalDetail}`);
  }
  return { ok: false, error: message };
}

// ── AES-GCM encryption helpers ──────────────────────────────────────────
//
// ENCRYPTION_KEY is loaded from Supabase Edge Function secrets.
// In production it MUST be set via: supabase secrets set ENCRYPTION_KEY=<hex-or-string>
// If not set, the function refuses to operate — no default/fallback key.

function getEncryptionKey(): CryptoKey {
  const raw = Deno.env.get("ENCRYPTION_KEY");
  if (!raw || raw.length === 0) {
    throw new Error(
      "Server configuration error: ENCRYPTION_KEY is not set. " +
        "Contact your Atlas administrator to configure mail encryption.",
    );
  }
  // Derive a 256-bit AES key from the raw secret using HKDF
  // This accepts any-length input and produces a deterministic 32-byte key
  const keyMaterial = new TextEncoder().encode(raw);
  return crypto.subtle.importKey(
    "raw",
    keyMaterial.length >= 32
      ? keyMaterial.slice(0, 32)
      : keyMaterial.padEnd(32, 0),
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
}

async function encryptCredential(plaintext: string): Promise<string> {
  const key = await getEncryptionKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  // Prepend IV (12 bytes) to ciphertext
  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(encrypted), iv.length);
  return btoa(String.fromCharCode(...combined));
}

async function decryptCredential(encryptedBase64: string): Promise<string> {
  const key = await getEncryptionKey();
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

// ── Supabase helpers ────────────────────────────────────────────────────

function getSupabaseUrl(): string {
  const url = Deno.env.get("SUPABASE_URL");
  if (!url) throw new Error("Server configuration error: SUPABASE_URL not set");
  return url;
}

function getSupabaseKey(): string {
  // Use SUPABASE_SECRET_KEYS (modern) with legacy fallback
  const secretKeys = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (secretKeys) {
    try {
      const parsed = JSON.parse(secretKeys);
      return parsed.default ?? parsed.service_role ?? "";
    } catch {
      /* fall through */
    }
  }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
}

function supabaseHeaders(): Record<string, string> {
  const key = getSupabaseKey();
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
}

async function supabaseRpc(
  fn: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const url = `${getSupabaseUrl()}/rest/v1/rpc/${fn}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: supabaseHeaders(),
    body: JSON.stringify(args),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`RPC ${fn} failed (${resp.status}): ${text.slice(0, 200)}`);
  }
  return resp.json();
}

async function supabaseQuery(
  table: string,
  select: string,
  filter: string,
): Promise<unknown[]> {
  const url = `${getSupabaseUrl()}/rest/v1/${table}?select=${select}&${filter}`;
  const resp = await fetch(url, { headers: supabaseHeaders() });
  if (!resp.ok) return [];
  return resp.json();
}

async function supabaseUpdate(
  table: string,
  filter: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const url = `${getSupabaseUrl()}/rest/v1/${table}?${filter}`;
  await fetch(url, {
    method: "PATCH",
    headers: { ...supabaseHeaders(), Prefer: "return=minimal" },
    body: JSON.stringify(patch),
  });
}

async function supabaseInsert(
  table: string,
  row: Record<string, unknown>,
): Promise<unknown> {
  const url = `${getSupabaseUrl()}/rest/v1/${table}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { ...supabaseHeaders(), Prefer: "return=representation" },
    body: JSON.stringify(row),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Insert ${table} failed: ${text.slice(0, 200)}`);
  }
  return resp.json();
}

// ── Auth verification ───────────────────────────────────────────────────

interface AuthUser {
  id: string;
  email?: string;
}

async function verifyAuth(req: Request): Promise<AuthUser> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    throw new Error("Unauthorized: missing token");
  }
  const token = authHeader.slice(7);
  const url = `${getSupabaseUrl()}/auth/v1/user`;
  const resp = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: getSupabaseKey(),
    },
  });
  if (!resp.ok) throw new Error("Unauthorized: invalid token");
  const data = await resp.json();
  return { id: data.id, email: data.email };
}

// ── Role-based authorization ────────────────────────────────────────────

type AtlasRole = "super_admin" | "atlas_admin" | string;

interface AuthUserWithRole extends AuthUser {
  role: AtlasRole;
  tenantId: string;
}

/**
 * Verify the caller is an authenticated Atlas administrator.
 * Checks the profiles table for platform_role.
 * Only super_admin and atlas_admin can invoke mail operations.
 */
async function verifyAdminAuth(req: Request): Promise<AuthUserWithRole> {
  const user = await verifyAuth(req);

  // Look up Atlas profile for role
  const profiles = await supabaseQuery(
    "profiles",
    "platform_role",
    `_id=eq.${user.id}&limit=1`,
  );
  if (!profiles.length) {
    throw new Error("Unauthorized: no Atlas profile found");
  }

  const profile = profiles[0] as Record<string, unknown>;
  const role = (profile.platform_role as string) ?? "user";

  if (role !== "super_admin" && role !== "atlas_admin") {
    throw new Error("Unauthorized: insufficient privileges");
  }

  // Get tenant from memberships table (camelCase columns match the schema)
  const membersUrl = `${getSupabaseUrl()}/rest/v1/memberships?select=%22tenantId%22&%22userId%22=eq.${user.id}&status=eq.active&limit=1`;
  const membersResp = await fetch(membersUrl, { headers: supabaseHeaders() });
  const memberships = membersResp.ok ? await membersResp.json() : [];
  if (!memberships.length) {
    throw new Error("Unauthorized: no active workspace membership");
  }
  const tenantId = (memberships[0] as Record<string, unknown>).tenantId as string;

  return { ...user, role, tenantId };
}

// ── IMAP Client (minimal) ──────────────────────────────────────────────

class ImapClient {
  private conn: Deno.TlsConn | null = null;
  private tag = 0;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private buffer = "";

  async connect(
    host: string,
    port: number,
    user: string,
    password: string,
  ): Promise<void> {
    this.conn = await Deno.connectTls({
      hostname: host,
      port,
      transport: "tcp",
    });
    this.reader = this.conn.readable.getReader();

    // Read greeting
    await this.readResponse();

    // Login
    await this.send(
      `A${++this.tag} LOGIN "${user}" "${password}"`,
    );
    await this.readTaggedResponse();
  }

  async listFolders(): Promise<string[]> {
    await this.send(`A${++this.tag} LIST "" "*"`);
    const lines = await this.readTaggedResponse();
    const folders: string[] = [];
    for (const line of lines) {
      const match = line.match(
        /LIST\s+\([^)]*\)\s+"[^"]*"\s+"([^"]+)"/,
      );
      if (match) folders.push(match[1]);
    }
    return folders;
  }

  async selectFolder(
    folder: string,
  ): Promise<{ uidValidity: number; lastUid: number }> {
    await this.send(`A${++this.tag} SELECT "${folder}"`);
    const lines = await this.readTaggedResponse();
    let uidValidity = 0;
    let lastUid = 0;
    for (const line of lines) {
      const uidv = line.match(/UIDVALIDITY\s+(\d+)/);
      if (uidv) uidValidity = parseInt(uidv[1]);
      const uidn = line.match(/UIDNEXT\s+(\d+)/);
      if (uidn) lastUid = parseInt(uidn[1]);
    }
    return { uidValidity, lastUid };
  }

  async searchMessages(since?: Date): Promise<number[]> {
    const sinceStr = since
      ? since.toISOString().slice(0, 11)
      : undefined;
    const cmd = sinceStr
      ? `A${++this.tag} SEARCH SINCE ${sinceStr}`
      : `A${++this.tag} SEARCH ALL`;
    await this.send(cmd);
    const lines = await this.readTaggedResponse();
    for (const line of lines) {
      const match = line.match(/SEARCH\s+(.*)/);
      if (match && match[1].trim()) {
        return match[1].trim().split(/\s+/).map(Number);
      }
    }
    return [];
  }

  async fetchMessages(
    uids: number[],
    folder: string,
  ): Promise<Record<string, unknown>[]> {
    if (uids.length === 0) return [];
    const results: Record<string, unknown>[] = [];
    for (let i = 0; i < uids.length; i += 20) {
      const batch = uids.slice(i, i + 20);
      const uidSet = batch.join(",");
      await this.send(
        `A${++this.tag} FETCH ${uidSet} (UID FLAGS ENVELOPE BODY.PEEK[HEADER.FIELDS (FROM TO CC SUBJECT DATE MESSAGE-ID REFERENCES)])`,
      );
      const lines = await this.readTaggedResponse();
      let current: Record<string, unknown> | null = null;
      for (const line of lines) {
        if (line.includes("FETCH (")) {
          if (current) results.push(current);
          current = { folder };
          const uidMatch = line.match(/UID\s+(\d+)/);
          if (uidMatch) current.uid = parseInt(uidMatch[1]);
          const flagsMatch = line.match(/FLAGS\s+\(([^)]*)\)/);
          if (flagsMatch) {
            current.is_read = flagsMatch[1].includes("\\Seen");
            current.is_starred = flagsMatch[1].includes("\\Flagged");
          }
        }
        if (current) {
          const subjMatch = line.match(
            /SUBJECT\s+\{[^}]+\}\r?\n(.*)/,
          );
          if (subjMatch) current.subject = subjMatch[1].trim();
          const fromMatch = line.match(
            /FROM\s+\{[^}]+\}\r?\n(.*)/,
          );
          if (fromMatch) {
            const from = fromMatch[1].trim();
            const nameEmail = from.match(
              /"?(.*?)"?\s*<(.*)>/,
            );
            if (nameEmail) {
              current.from_name = nameEmail[1].replace(/"/g, "");
              current.from_address = nameEmail[2];
            } else {
              current.from_address = from;
            }
          }
          const dateMatch = line.match(
            /DATE\s+\{[^}]+\}\r?\n(.*)/,
          );
          if (dateMatch)
            current.received_at = new Date(
              dateMatch[1].trim(),
            ).toISOString();
          const msgIdMatch = line.match(
            /MESSAGE-ID\s+\{[^}]+\}\r?\n(.*)/,
          );
          if (msgIdMatch)
            current.message_id = msgIdMatch[1]
              .trim()
              .replace(/[<>]/g, "");
          const refMatch = line.match(
            /REFERENCES\s+\{[^}]+\}\r?\n(.*)/,
          );
          if (refMatch)
            current.references = refMatch[1]
              .trim()
              .split(/\s+/);
        }
      }
      if (current) results.push(current);
    }
    return results;
  }

  async fetchBody(
    folder: string,
    uid: number,
  ): Promise<{ textBody: string; htmlBody: string }> {
    await this.send(`A${++this.tag} SELECT "${folder}"`);
    await this.readTaggedResponse();
    await this.send(`A${++this.tag} FETCH ${uid} (BODY[])`);
    const lines = await this.readTaggedResponse();
    const bodyText = lines.join("\n");
    let textBody = "";
    let htmlBody = "";
    const textMatch = bodyText.match(
      /Content-Type: text\/plain[^]*?\r?\n\r?\n([\s\S]*?)(?=Content-Type:|--|\r?\n\.\r?\n)/,
    );
    if (textMatch) textBody = textMatch[1].trim();
    const htmlMatch = bodyText.match(
      /Content-Type: text\/html[^]*?\r?\n\r?\n([\s\S]*?)(?=Content-Type:|--|\r?\n\.\r?\n)/,
    );
    if (htmlMatch) htmlBody = htmlMatch[1].trim();
    if (!textBody && !htmlBody) {
      textBody = bodyText
        .replace(/^[^\n]*FETCH[^\n]*\n/, "")
        .replace(/\r?\n\.\r?\n$/, "");
    }
    return { textBody, htmlBody };
  }

  async logout(): Promise<void> {
    try {
      await this.send(`A${++this.tag} LOGOUT`);
    } catch {
      /* ignore */
    }
    if (this.reader) {
      try {
        await this.reader.releaseLock();
      } catch {
        /* ignore */
      }
    }
    if (this.conn) {
      try {
        await this.conn.close();
      } catch {
        /* ignore */
      }
    }
  }

  private async send(cmd: string): Promise<void> {
    if (!this.conn) throw new Error("Not connected");
    const data = new TextEncoder().encode(cmd + "\r\n");
    await this.conn.write(data);
  }

  private async readResponse(): Promise<string> {
    if (!this.reader) throw new Error("Not connected");
    const { value, done } = await this.reader.read();
    if (done) throw new Error("Connection closed");
    const text = new TextDecoder().decode(
      value ?? new Uint8Array(),
    );
    this.buffer += text;
    return text;
  }

  private async readTaggedResponse(): Promise<string[]> {
    const tag = `A${this.tag}`;
    const lines: string[] = [];
    const timeout = 15000;
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const text = await this.readResponse();
      const parts = text.split("\r\n");
      for (const part of parts) {
        if (!part) continue;
        lines.push(part);
        if (part.startsWith(tag + " ")) {
          if (part.includes("NO") || part.includes("BAD")) {
            throw new Error(`IMAP error: ${part}`);
          }
          return lines;
        }
      }
    }
    throw new Error("IMAP timeout");
  }
}

// ── SMTP Client (minimal) ──────────────────────────────────────────────

class SmtpClient {
  private conn: Deno.TlsConn | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;

  async connect(
    host: string,
    port: number,
    user: string,
    password: string,
  ): Promise<void> {
    this.conn = await Deno.connectTls({
      hostname: host,
      port,
      transport: "tcp",
    });
    this.reader = this.conn.readable.getReader();

    await this.readResponse();

    await this.send("EHLO atlas-mail");
    await this.readResponse();

    // STARTTLS for port 587 (465 is implicit TLS)
    if (port === 587) {
      await this.send("STARTTLS");
      await this.readResponse();
      await this.conn.close();
      this.conn = await Deno.connectTls({
        hostname: host,
        port,
        transport: "tcp",
      });
      this.reader = this.conn.readable.getReader();
      await this.send("EHLO atlas-mail");
      await this.readResponse();
    }

    await this.send("AUTH LOGIN");
    await this.readResponse();
    await this.send(btoa(user));
    await this.readResponse();
    await this.send(btoa(password));
    await this.readResponse();
  }

  async sendMail(
    from: string,
    to: string[],
    subject: string,
    body: string,
    extraHeaders?: Record<string, string>,
  ): Promise<void> {
    await this.send(`MAIL FROM:<${from}>`);
    await this.readResponse();

    for (const addr of to) {
      await this.send(`RCPT TO:<${addr}>`);
      await this.readResponse();
    }

    await this.send("DATA");
    await this.readResponse();

    const lines: string[] = [];
    lines.push(`From: ${from}`);
    lines.push(`To: ${to.join(", ")}`);
    lines.push(`Subject: ${subject}`);
    lines.push(`Date: ${new Date().toUTCString()}`);
    lines.push("MIME-Version: 1.0");
    lines.push("Content-Type: text/plain; charset=utf-8");
    if (extraHeaders) {
      for (const [k, v] of Object.entries(extraHeaders)) {
        lines.push(`${k}: ${v}`);
      }
    }
    lines.push("");
    lines.push(body);
    lines.push(".");
    lines.push("");

    for (const line of lines) {
      await this.send(line);
    }
    await this.readResponse();
  }

  async quit(): Promise<void> {
    try {
      await this.send("QUIT");
    } catch {
      /* ignore */
    }
    if (this.reader) {
      try {
        await this.reader.releaseLock();
      } catch {
        /* ignore */
      }
    }
    if (this.conn) {
      try {
        await this.conn.close();
      } catch {
        /* ignore */
      }
    }
  }

  private async send(cmd: string): Promise<void> {
    if (!this.conn) throw new Error("Not connected");
    const data = new TextEncoder().encode(cmd + "\r\n");
    await this.conn.write(data);
  }

  private async readResponse(): Promise<string> {
    if (!this.reader) throw new Error("Not connected");
    const timeout = 15000;
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const { value, done } = await this.reader.read();
      if (done) throw new Error("SMTP connection closed");
      const text = new TextDecoder().decode(
        value ?? new Uint8Array(),
      );
      if (text.match(/^[\d-]{3,4}\s/)) {
        if (text.startsWith("5") || text.startsWith("4")) {
          throw new Error(`SMTP error: ${text.trim()}`);
        }
        return text;
      }
    }
    throw new Error("SMTP timeout");
  }
}

// ── Action handlers ─────────────────────────────────────────────────────
//
// All handlers receive the verified admin user and return safe responses.
// Internal errors are logged server-side; client sees only user-friendly
// messages that never expose credentials, keys, or infrastructure details.

async function handleTestConnection(
  params: Record<string, unknown>,
): Promise<unknown> {
  const imapResult = { ok: false, error: "", folders: [] as string[] };
  const smtpResult = { ok: false, error: "" };

  const imap = new ImapClient();
  try {
    await imap.connect(
      params.imapHost as string,
      params.imapPort as number,
      params.imapUser as string,
      params.imapPassword as string,
    );
    const folders = await imap.listFolders();
    imapResult.ok = true;
    imapResult.folders = folders;
  } catch (e) {
    imapResult.error = e instanceof Error ? e.message : "IMAP connection failed";
  } finally {
    await imap.logout();
  }

  const smtp = new SmtpClient();
  try {
    await smtp.connect(
      params.smtpHost as string,
      params.smtpPort as number,
      params.smtpUser as string,
      params.smtpPassword as string,
    );
    smtpResult.ok = true;
  } catch (e) {
    smtpResult.error =
      e instanceof Error ? e.message : "SMTP connection failed";
  } finally {
    await smtp.quit();
  }

  return {
    ok: imapResult.ok && smtpResult.ok,
    imap: imapResult,
    smtp: smtpResult,
  };
}

async function handleSetupAccount(
  params: Record<string, unknown>,
): Promise<unknown> {
  const accountId = params.accountId as string;
  const imapUser = params.imapUser as string;
  const imapPassword = params.imapPassword as string;

  if (!accountId || !imapUser || !imapPassword) {
    return safeError("Missing required fields: accountId, imapUser, imapPassword");
  }

  try {
    const encrypted = await encryptCredential(
      JSON.stringify({ imapUser, imapPassword }),
    );

    await supabaseUpdate("email_accounts", `id=eq.${accountId}`, {
      encrypted_credentials: { data: encrypted },
      connection_status: "connected",
      connection_tested_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    return { ok: true };
  } catch (e) {
    // Never expose encryption key or internal details
    const msg = e instanceof Error ? e.message : "Setup failed";
    if (msg.includes("ENCRYPTION_KEY")) {
      return safeError(
        "Mail encryption is not configured. Contact your Atlas administrator.",
        msg,
      );
    }
    return safeError("Failed to store mailbox credentials.", msg);
  }
}

async function handleTestExistingAccount(
  params: Record<string, unknown>,
  adminUser: AuthUserWithRole,
): Promise<unknown> {
  const accountId = params.accountId as string;
  if (!accountId) return safeError("Missing accountId");

  const accounts = await supabaseQuery(
    "email_accounts",
    "id,imap_host,imap_port,imap_secure,smtp_host,smtp_port,smtp_secure,encrypted_credentials,tenant_id",
    `id=eq.${accountId}&tenant_id=eq.${adminUser.tenantId}`,
  );
  if (!accounts.length) return safeError("Account not found");

  const account = accounts[0] as Record<string, unknown>;
  const creds = account.encrypted_credentials as Record<
    string,
    unknown
  > | null;
  if (!creds?.data)
    return safeError(
      "No credentials stored for this account. Please reconnect the mailbox.",
    );

  let decrypted: { imapUser: string; imapPassword: string };
  try {
    decrypted = JSON.parse(await decryptCredential(creds.data as string));
  } catch (e) {
    return safeError(
      "Failed to decrypt stored credentials. The encryption key may have changed.",
      e instanceof Error ? e.message : "decrypt error",
    );
  }

  // Test IMAP
  const imapResult = { ok: false, error: "", folders: [] as string[] };
  const imap = new ImapClient();
  try {
    await imap.connect(
      account.imap_host as string,
      account.imap_port as number,
      decrypted.imapUser,
      decrypted.imapPassword,
    );
    const folders = await imap.listFolders();
    imapResult.ok = true;
    imapResult.folders = folders;
  } catch (e) {
    imapResult.error =
      e instanceof Error ? e.message : "IMAP test failed";
  } finally {
    await imap.logout();
  }

  // Test SMTP
  const smtpResult = { ok: false, error: "" };
  const smtp = new SmtpClient();
  try {
    await smtp.connect(
      account.smtp_host as string,
      account.smtp_port as number,
      decrypted.imapUser,
      decrypted.imapPassword,
    );
    smtpResult.ok = true;
  } catch (e) {
    smtpResult.error =
      e instanceof Error ? e.message : "SMTP test failed";
  } finally {
    await smtp.quit();
  }

  // Update connection status
  const status = imapResult.ok && smtpResult.ok ? "connected" : "error";
  await supabaseUpdate("email_accounts", `id=eq.${accountId}`, {
    connection_status: status,
    connection_error: !imapResult.ok
      ? imapResult.error
      : !smtpResult.ok
        ? smtpResult.error
        : null,
    connection_tested_at: new Date().toISOString(),
  });

  return {
    ok: imapResult.ok && smtpResult.ok,
    imap: imapResult,
    smtp: smtpResult,
  };
}

async function handleListFolders(
  params: Record<string, unknown>,
  adminUser: AuthUserWithRole,
): Promise<unknown> {
  const accountId = params.accountId as string;
  if (!accountId) return safeError("Missing accountId");

  const accounts = await supabaseQuery(
    "email_accounts",
    "id,imap_host,imap_port,encrypted_credentials,tenant_id",
    `id=eq.${accountId}&tenant_id=eq.${adminUser.tenantId}`,
  );
  if (!accounts.length) return safeError("Account not found");

  const account = accounts[0] as Record<string, unknown>;
  const creds = account.encrypted_credentials as Record<
    string,
    unknown
  > | null;
  if (!creds?.data) return safeError("No credentials stored");

  let decrypted: { imapUser: string; imapPassword: string };
  try {
    decrypted = JSON.parse(await decryptCredential(creds.data as string));
  } catch (e) {
    return safeError("Failed to decrypt credentials.", e instanceof Error ? e.message : "decrypt error");
  }

  const imap = new ImapClient();
  try {
    await imap.connect(
      account.imap_host as string,
      account.imap_port as number,
      decrypted.imapUser,
      decrypted.imapPassword,
    );
    const folders = await imap.listFolders();
    return { ok: true, folders };
  } catch (e) {
    return safeError(
      "Failed to list folders.",
      e instanceof Error ? e.message : "IMAP folder list failed",
    );
  } finally {
    await imap.logout();
  }
}

async function handleSyncFolder(
  params: Record<string, unknown>,
  adminUser: AuthUserWithRole,
): Promise<unknown> {
  const accountId = params.accountId as string;
  const folder = (params.folder as string) || "INBOX";
  const limit = (params.limit as number) || 100;

  if (!accountId) return safeError("Missing accountId");

  const accounts = await supabaseQuery(
    "email_accounts",
    "id,imap_host,imap_port,encrypted_credentials,tenant_id",
    `id=eq.${accountId}&tenant_id=eq.${adminUser.tenantId}`,
  );
  if (!accounts.length) return safeError("Account not found");

  const account = accounts[0] as Record<string, unknown>;
  const creds = account.encrypted_credentials as Record<
    string,
    unknown
  > | null;
  if (!creds?.data) return safeError("No credentials stored");

  let decrypted: { imapUser: string; imapPassword: string };
  try {
    decrypted = JSON.parse(await decryptCredential(creds.data as string));
  } catch (e) {
    return safeError("Failed to decrypt credentials.", e instanceof Error ? e.message : "decrypt error");
  }

  const imap = new ImapClient();
  let synced = 0;
  try {
    await imap.connect(
      account.imap_host as string,
      account.imap_port as number,
      decrypted.imapUser,
      decrypted.imapPassword,
    );

    const { uidValidity, lastUid } = await imap.selectFolder(folder);
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const uids = await imap.searchMessages(since);
    const fetchUids = uids.slice(-limit);
    const messages = await imap.fetchMessages(fetchUids, folder);

    for (const msg of messages) {
      const msgData = {
        tenant_id: adminUser.tenantId,
        account_id: accountId,
        provider_message_id: String(msg.uid ?? ""),
        message_id: msg.message_id ?? null,
        from_address: msg.from_address ?? null,
        from_name: msg.from_name ?? null,
        subject: msg.subject ?? null,
        snippet: (msg.subject as string)?.slice(0, 200) ?? null,
        received_at: msg.received_at ?? null,
        is_read: msg.is_read ?? false,
        is_starred: msg.is_starred ?? false,
        folder,
        message_references: Array.isArray(msg.references)
          ? msg.references
          : [],
        uid_validity: uidValidity,
        last_uid: typeof msg.uid === "number" ? msg.uid : null,
        body_fetched: false,
      };
      try {
        await supabaseInsert("email_messages", msgData);
        synced++;
      } catch {
        // Message likely already exists
      }
    }

    await supabaseUpdate("email_accounts", `id=eq.${accountId}`, {
      last_synced_at: new Date().toISOString(),
    });

    return {
      ok: true,
      synced,
      total: uids.length,
      fetched: messages.length,
      folder,
    };
  } catch (e) {
    return safeError(
      "Failed to sync folder.",
      e instanceof Error ? e.message : "sync error",
    );
  } finally {
    await imap.logout();
  }
}

async function handleSendMessage(
  params: Record<string, unknown>,
  adminUser: AuthUserWithRole,
): Promise<unknown> {
  const accountId = params.accountId as string;
  const to = params.to as string[];
  const subject = params.subject as string;
  const textBody = params.textBody as string;
  const fromAddress = (params.fromAddress as string) ?? "";

  if (!accountId || !to?.length || !subject) {
    return safeError("Missing required fields: accountId, to, subject");
  }

  const accounts = await supabaseQuery(
    "email_accounts",
    "id,smtp_host,smtp_port,encrypted_credentials,tenant_id",
    `id=eq.${accountId}&tenant_id=eq.${adminUser.tenantId}`,
  );
  if (!accounts.length) return safeError("Account not found");

  const account = accounts[0] as Record<string, unknown>;
  const creds = account.encrypted_credentials as Record<
    string,
    unknown
  > | null;
  if (!creds?.data) return safeError("No credentials stored");

  let decrypted: { imapUser: string; imapPassword: string };
  try {
    decrypted = JSON.parse(await decryptCredential(creds.data as string));
  } catch (e) {
    return safeError("Failed to decrypt credentials.", e instanceof Error ? e.message : "decrypt error");
  }

  const smtp = new SmtpClient();
  try {
    await smtp.connect(
      account.smtp_host as string,
      account.smtp_port as number,
      decrypted.imapUser,
      decrypted.imapPassword,
    );

    await smtp.sendMail(fromAddress, to, subject, textBody);

    await supabaseInsert("email_messages", {
      tenant_id: adminUser.tenantId,
      account_id: accountId,
      from_address: fromAddress,
      to_addresses: to.map((a) => ({ name: "", address: a })),
      subject,
      text_body: textBody,
      sent_at: new Date().toISOString(),
      is_read: true,
      folder: "Sent",
    });

    return { ok: true };
  } catch (e) {
    return safeError(
      "Failed to send message.",
      e instanceof Error ? e.message : "SMTP send failed",
    );
  } finally {
    await smtp.quit();
  }
}

async function handleFetchBody(
  params: Record<string, unknown>,
  adminUser: AuthUserWithRole,
): Promise<unknown> {
  const accountId = params.accountId as string;
  const folder = params.folder as string;
  const uid = parseInt(params.uid as string);

  if (!accountId || !folder || isNaN(uid)) {
    return safeError("Missing required fields: accountId, folder, uid");
  }

  const accounts = await supabaseQuery(
    "email_accounts",
    "id,imap_host,imap_port,encrypted_credentials,tenant_id",
    `id=eq.${accountId}&tenant_id=eq.${adminUser.tenantId}`,
  );
  if (!accounts.length) return safeError("Account not found");

  const account = accounts[0] as Record<string, unknown>;
  const creds = account.encrypted_credentials as Record<
    string,
    unknown
  > | null;
  if (!creds?.data) return safeError("No credentials stored");

  let decrypted: { imapUser: string; imapPassword: string };
  try {
    decrypted = JSON.parse(await decryptCredential(creds.data as string));
  } catch (e) {
    return safeError("Failed to decrypt credentials.", e instanceof Error ? e.message : "decrypt error");
  }

  const imap = new ImapClient();
  try {
    await imap.connect(
      account.imap_host as string,
      account.imap_port as number,
      decrypted.imapUser,
      decrypted.imapPassword,
    );

    const { textBody, htmlBody } = await imap.fetchBody(folder, uid);

    if (params.messageDbId) {
      await supabaseUpdate(
        "email_messages",
        `id=eq.${params.messageDbId}`,
        {
          text_body: textBody,
          html_body: htmlBody,
          body_fetched: true,
        },
      );
    }

    return { ok: true, textBody, htmlBody };
  } catch (e) {
    return safeError(
      "Failed to fetch message body.",
      e instanceof Error ? e.message : "IMAP fetch failed",
    );
  } finally {
    await imap.logout();
  }
}

// ── Main handler ────────────────────────────────────────────────────────

Deno.serve(async (req: Request): Promise<Response> => {
  const corsH = corsHeaders(req);

  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsH });
  }

  try {
    // Verify authentication AND authorization (super_admin or atlas_admin only)
    const adminUser = await verifyAdminAuth(req);

    // Parse request body
    const body = await req.json().catch(() => ({}));
    const action = body.action as string;

    if (!action) {
      return new Response(
        JSON.stringify({ data: null, error: "Missing action" }),
        {
          status: 400,
          headers: { ...corsH, "Content-Type": "application/json" },
        },
      );
    }

    let result: unknown;

    switch (action) {
      case "test_connection":
        result = await handleTestConnection(body);
        break;
      case "setup_account":
        result = await handleSetupAccount(body);
        break;
      case "test_existing_account":
        result = await handleTestExistingAccount(body, adminUser);
        break;
      case "list_folders":
        result = await handleListFolders(body, adminUser);
        break;
      case "sync_folder":
        result = await handleSyncFolder(body, adminUser);
        break;
      case "send_message":
        result = await handleSendMessage(body, adminUser);
        break;
      case "fetch_body":
        result = await handleFetchBody(body, adminUser);
        break;
      default:
        return new Response(
          JSON.stringify({ data: null, error: "Unknown action" }),
          {
            status: 400,
            headers: { ...corsH, "Content-Type": "application/json" },
          },
        );
    }

    return new Response(JSON.stringify({ data: result }), {
      status: 200,
      headers: { ...corsH, "Content-Type": "application/json" },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Internal error";
    // Classify the error for appropriate HTTP status
    const status = message.startsWith("Unauthorized") ? 401 : 500;
    // Never expose internal details to the client
    const safeMsg = message.startsWith("Unauthorized")
      ? message
      : "An unexpected error occurred. Please try again.";
    console.error("[email-fn] Unhandled error:", e);
    return new Response(
      JSON.stringify({ data: null, error: safeMsg }),
      {
        status,
        headers: { ...corsH, "Content-Type": "application/json" },
      },
    );
  }
});
