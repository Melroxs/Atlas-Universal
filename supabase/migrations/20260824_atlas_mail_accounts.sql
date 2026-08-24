-- ==========================================================================
-- Atlas Mail — Email Accounts, Messages, Drafts, Labels
-- Migration: 20260824_atlas_mail_accounts.sql
--
-- Adds the database tables and RPCs required by the Atlas Mail inbox,
-- settings, and compose screens. Credentials are stored encrypted via the
-- `email` Edge Function — the RPC layer never sees plaintext passwords.
-- ==========================================================================

-- ── 1. Email Accounts ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.email_accounts (
  id                uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id         uuid NOT NULL REFERENCES public.tenants(_id) ON DELETE CASCADE,
  created_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,

  email_address     text NOT NULL,
  display_name      text,
  provider          text DEFAULT 'custom',

  imap_host         text,
  imap_port         integer DEFAULT 993,
  imap_secure       boolean DEFAULT true,

  smtp_host         text,
  smtp_port         integer DEFAULT 465,
  smtp_secure       boolean DEFAULT true,

  -- Encrypted credentials blob (written/read only by Edge Function)
  encrypted_credentials jsonb,

  sync_enabled      boolean DEFAULT false,
  sync_folders      text[] DEFAULT '{}',
  last_synced_at    timestamptz,

  connection_status text DEFAULT 'untested',  -- untested | connected | syncing | error | disabled
  connection_error  text,
  connection_tested_at timestamptz,

  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_accounts_tenant ON public.email_accounts(tenant_id);

ALTER TABLE public.email_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "email_accounts_isolation" ON public.email_accounts;
CREATE POLICY "email_accounts_isolation" ON public.email_accounts
  USING (tenant_id = public.my_tenant_id());

-- ── 2. Email Messages ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.email_messages (
  id                  uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id           uuid NOT NULL REFERENCES public.tenants(_id) ON DELETE CASCADE,
  account_id          uuid NOT NULL REFERENCES public.email_accounts(id) ON DELETE CASCADE,

  provider_message_id text,  -- IMAP UID or message-id header
  message_id          text,  -- RFC 2822 Message-ID
  thread_id           text,
  in_reply_to         text,
  references          text[] DEFAULT '{}',

  from_address        text,
  from_name           text,
  to_addresses        jsonb DEFAULT '[]',
  cc_addresses        jsonb DEFAULT '[]',
  bcc_addresses       jsonb DEFAULT '[]',

  subject             text,
  text_body           text,
  html_body           text,
  snippet             text,

  received_at         timestamptz,
  sent_at             timestamptz,

  is_read             boolean DEFAULT false,
  is_starred          boolean DEFAULT false,
  is_draft            boolean DEFAULT false,

  folder              text DEFAULT 'INBOX',

  has_attachments     boolean DEFAULT false,
  attachment_count    integer DEFAULT 0,

  labels              text[] DEFAULT '{}',

  body_fetched        boolean DEFAULT false,
  uid_validity        bigint,
  last_uid            bigint,

  created_at          timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_messages_tenant ON public.email_messages(tenant_id);
CREATE INDEX IF NOT EXISTS idx_email_messages_account ON public.email_messages(account_id);
CREATE INDEX IF NOT EXISTS idx_email_messages_folder ON public.email_messages(account_id, folder);
CREATE INDEX IF NOT EXISTS idx_email_messages_thread ON public.email_messages(account_id, thread_id);

ALTER TABLE public.email_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "email_messages_isolation" ON public.email_messages;
CREATE POLICY "email_messages_isolation" ON public.email_messages
  USING (tenant_id = public.my_tenant_id());

-- ── 3. Email Drafts ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.email_drafts (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id       uuid NOT NULL REFERENCES public.tenants(_id) ON DELETE CASCADE,
  account_id      uuid NOT NULL REFERENCES public.email_accounts(id) ON DELETE CASCADE,

  thread_id       text,
  in_reply_to     text,
  references      text[] DEFAULT '{}',

  to_addresses    jsonb DEFAULT '[]',
  cc_addresses    jsonb DEFAULT '[]',
  bcc_addresses   jsonb DEFAULT '[]',

  subject         text,
  text_body       text,
  html_body       text,
  attachments     jsonb DEFAULT '[]',
  labels          text[] DEFAULT '{}',
  signature_id    uuid,

  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_drafts_tenant ON public.email_drafts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_email_drafts_account ON public.email_drafts(account_id);

ALTER TABLE public.email_drafts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "email_drafts_isolation" ON public.email_drafts;
CREATE POLICY "email_drafts_isolation" ON public.email_drafts
  USING (tenant_id = public.my_tenant_id());

-- ── 4. Email Labels ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.email_labels (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES public.tenants(_id) ON DELETE CASCADE,
  name        text NOT NULL,
  color       text DEFAULT '#6b7280',
  created_at  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_labels_tenant ON public.email_labels(tenant_id);

ALTER TABLE public.email_labels ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "email_labels_isolation" ON public.email_labels;
CREATE POLICY "email_labels_isolation" ON public.email_labels
  USING (tenant_id = public.my_tenant_id());

-- ── 5. Message ↔ Label join ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.email_message_labels (
  message_id  uuid NOT NULL REFERENCES public.email_messages(id) ON DELETE CASCADE,
  label_id    uuid NOT NULL REFERENCES public.email_labels(id) ON DELETE CASCADE,
  PRIMARY KEY (message_id, label_id)
);

ALTER TABLE public.email_message_labels ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "email_message_labels_isolation" ON public.email_message_labels;
CREATE POLICY "email_message_labels_isolation" ON public.email_message_labels
  USING (EXISTS (
    SELECT 1 FROM public.email_messages m
    WHERE m.id = message_id AND m.tenant_id = public.my_tenant_id()
  ));


-- ══════════════════════════════════════════════════════════════════════════
-- RPC FUNCTIONS
-- ══════════════════════════════════════════════════════════════════════════

-- ── Email Accounts ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.email_accounts_list()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN COALESCE((
    SELECT jsonb_agg(row_to_json(a.*) ORDER BY a.created_at DESC)
    FROM public.email_accounts a WHERE a.tenant_id = public.my_tenant_id()
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.email_accounts_create(
  p_email_address text,
  p_display_name text DEFAULT NULL,
  p_provider text DEFAULT 'custom',
  p_imap_host text DEFAULT NULL,
  p_imap_port integer DEFAULT 993,
  p_imap_secure boolean DEFAULT true,
  p_smtp_host text DEFAULT NULL,
  p_smtp_port integer DEFAULT 465,
  p_smtp_secure boolean DEFAULT true
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_account jsonb;
BEGIN
  IF NOT public.is_super_admin() AND NOT public.is_atlas_admin() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  INSERT INTO public.email_accounts (
    tenant_id, created_by, email_address, display_name, provider,
    imap_host, imap_port, imap_secure,
    smtp_host, smtp_port, smtp_secure,
    connection_status
  ) VALUES (
    public.my_tenant_id(), auth.uid(), p_email_address, p_display_name, p_provider,
    p_imap_host, p_imap_port, p_imap_secure,
    p_smtp_host, p_smtp_port, p_smtp_secure,
    'untested'
  )
  RETURNING row_to_json(email_accounts.*) INTO v_account;

  RETURN v_account;
END;
$$;

CREATE OR REPLACE FUNCTION public.email_accounts_update(
  p_id uuid,
  p_email_address text DEFAULT NULL,
  p_display_name text DEFAULT NULL,
  p_imap_host text DEFAULT NULL,
  p_imap_port integer DEFAULT NULL,
  p_imap_secure boolean DEFAULT NULL,
  p_smtp_host text DEFAULT NULL,
  p_smtp_port integer DEFAULT NULL,
  p_smtp_secure boolean DEFAULT NULL,
  p_sync_enabled boolean DEFAULT NULL,
  p_sync_folders text DEFAULT NULL,
  p_connection_status text DEFAULT NULL,
  p_connection_error text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_account jsonb;
BEGIN
  IF NOT public.is_super_admin() AND NOT public.is_atlas_admin() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  UPDATE public.email_accounts SET
    email_address = COALESCE(p_email_address, email_address),
    display_name = COALESCE(p_display_name, display_name),
    imap_host = COALESCE(p_imap_host, imap_host),
    imap_port = COALESCE(p_imap_port, imap_port),
    imap_secure = COALESCE(p_imap_secure, imap_secure),
    smtp_host = COALESCE(p_smtp_host, smtp_host),
    smtp_port = COALESCE(p_smtp_port, smtp_port),
    smtp_secure = COALESCE(p_smtp_secure, smtp_secure),
    sync_enabled = COALESCE(p_sync_enabled, sync_enabled),
    sync_folders = COALESCE(
      CASE WHEN p_sync_folders IS NOT NULL THEN string_to_array(p_sync_folders, ',') END,
      sync_folders
    ),
    connection_status = COALESCE(p_connection_status, connection_status),
    connection_error = p_connection_error,
    updated_at = now()
  WHERE id = p_id AND tenant_id = public.my_tenant_id()
  RETURNING row_to_json(email_accounts.*) INTO v_account;

  IF v_account IS NULL THEN
    RAISE EXCEPTION 'Account not found';
  END IF;

  RETURN v_account;
END;
$$;

CREATE OR REPLACE FUNCTION public.email_accounts_delete(p_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NOT public.is_super_admin() AND NOT public.is_atlas_admin() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  DELETE FROM public.email_accounts WHERE id = p_id AND tenant_id = public.my_tenant_id();
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.email_accounts_set_sync_state(
  p_id uuid,
  p_sync_enabled boolean DEFAULT NULL,
  p_sync_folders text DEFAULT NULL
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NOT public.is_super_admin() AND NOT public.is_atlas_admin() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  UPDATE public.email_accounts SET
    sync_enabled = COALESCE(p_sync_enabled, sync_enabled),
    sync_folders = COALESCE(
      CASE WHEN p_sync_folders IS NOT NULL THEN string_to_array(p_sync_folders, ',') END,
      sync_folders
    ),
    updated_at = now()
  WHERE id = p_id AND tenant_id = public.my_tenant_id();
  RETURN FOUND;
END;
$$;

-- ── Email Messages ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.email_messages_list(
  p_account_id uuid,
  p_folder text DEFAULT 'INBOX',
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0,
  p_search text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN COALESCE((
    SELECT jsonb_agg(row_to_json(m.*) ORDER BY m.received_at DESC NULLS LAST)
    FROM public.email_messages m
    WHERE m.tenant_id = public.my_tenant_id()
      AND m.account_id = p_account_id
      AND m.folder = p_folder
      AND (p_search IS NULL OR m.subject ILIKE '%' || p_search || '%'
           OR m.from_name ILIKE '%' || p_search || '%'
           OR m.from_address ILIKE '%' || p_search || '%')
    LIMIT p_limit OFFSET p_offset
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.email_messages_list_sent(
  p_account_id uuid,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN COALESCE((
    SELECT jsonb_agg(row_to_json(m.*) ORDER BY m.sent_at DESC NULLS LAST)
    FROM public.email_messages m
    WHERE m.tenant_id = public.my_tenant_id()
      AND m.account_id = p_account_id
      AND m.folder = 'Sent'
    LIMIT p_limit OFFSET p_offset
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.email_messages_list_drafts(
  p_account_id uuid,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN COALESCE((
    SELECT jsonb_agg(row_to_json(d.*) ORDER BY d.updated_at DESC)
    FROM public.email_drafts d
    WHERE d.tenant_id = public.my_tenant_id()
      AND d.account_id = p_account_id
    LIMIT p_limit OFFSET p_offset
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.email_messages_list_starred(
  p_account_id uuid,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN COALESCE((
    SELECT jsonb_agg(row_to_json(m.*) ORDER BY m.received_at DESC NULLS LAST)
    FROM public.email_messages m
    WHERE m.tenant_id = public.my_tenant_id()
      AND m.account_id = p_account_id
      AND m.is_starred = true
    LIMIT p_limit OFFSET p_offset
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.email_messages_list_all(
  p_account_id uuid,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0,
  p_search text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN COALESCE((
    SELECT jsonb_agg(row_to_json(m.*) ORDER BY m.received_at DESC NULLS LAST)
    FROM public.email_messages m
    WHERE m.tenant_id = public.my_tenant_id()
      AND m.account_id = p_account_id
      AND (p_search IS NULL OR m.subject ILIKE '%' || p_search || '%'
           OR m.from_name ILIKE '%' || p_search || '%'
           OR m.from_address ILIKE '%' || p_search || '%'
           OR m.snippet ILIKE '%' || p_search || '%')
    LIMIT p_limit OFFSET p_offset
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.email_messages_get(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_msg jsonb; v_attachments jsonb;
BEGIN
  SELECT row_to_json(m.*) INTO v_msg
  FROM public.email_messages m
  WHERE m.id = p_id AND m.tenant_id = public.my_tenant_id();

  IF v_msg IS NULL THEN
    RETURN NULL;
  END IF;

  -- No attachments table yet; return empty array
  v_attachments := '[]'::jsonb;

  RETURN jsonb_build_object(
    'message', v_msg,
    'attachments', v_attachments
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.email_messages_list_thread(
  p_thread_id text,
  p_account_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN COALESCE((
    SELECT jsonb_agg(row_to_json(m.*) ORDER BY m.received_at ASC NULLS LAST)
    FROM public.email_messages m
    WHERE m.tenant_id = public.my_tenant_id()
      AND m.account_id = p_account_id
      AND m.thread_id = p_thread_id
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.email_messages_mark_read(
  p_id uuid,
  p_is_read boolean DEFAULT true
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE public.email_messages SET is_read = p_is_read
  WHERE id = p_id AND tenant_id = public.my_tenant_id();
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.email_messages_mark_starred(
  p_id uuid,
  p_is_starred boolean DEFAULT true
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE public.email_messages SET is_starred = p_is_starred
  WHERE id = p_id AND tenant_id = public.my_tenant_id();
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.email_messages_move(
  p_id uuid,
  p_folder text
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE public.email_messages SET folder = p_folder
  WHERE id = p_id AND tenant_id = public.my_tenant_id();
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.email_messages_delete(p_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  DELETE FROM public.email_messages
  WHERE id = p_id AND tenant_id = public.my_tenant_id();
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.email_messages_count(
  p_account_id uuid,
  p_folder text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_total integer; v_unread integer;
BEGIN
  SELECT count(*) INTO v_total
  FROM public.email_messages
  WHERE tenant_id = public.my_tenant_id()
    AND account_id = p_account_id
    AND (p_folder IS NULL OR folder = p_folder);

  SELECT count(*) INTO v_unread
  FROM public.email_messages
  WHERE tenant_id = public.my_tenant_id()
    AND account_id = p_account_id
    AND (p_folder IS NULL OR folder = p_folder)
    AND is_read = false;

  RETURN jsonb_build_object('total', v_total, 'unread', v_unread);
END;
$$;

CREATE OR REPLACE FUNCTION public.email_messages_set_labels(
  p_message_id uuid,
  p_label_ids text DEFAULT '[]'
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_label_ids uuid[];
BEGIN
  -- Delete existing labels
  DELETE FROM public.email_message_labels WHERE message_id = p_message_id;

  -- Add new labels
  IF p_label_ids != '[]' THEN
    v_label_ids := string_to_array(replace(replace(p_label_ids, '[', ''), ']', ''), ',')::uuid[];
    INSERT INTO public.email_message_labels (message_id, label_id)
    SELECT p_message_id, unnest(v_label_ids);
  END IF;

  RETURN true;
END;
$$;

-- ── Email Drafts ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.email_drafts_save(
  p_account_id uuid,
  p_id uuid DEFAULT NULL,
  p_thread_id text DEFAULT NULL,
  p_in_reply_to text DEFAULT NULL,
  p_references text DEFAULT NULL,
  p_to_addresses text DEFAULT '[]',
  p_cc_addresses text DEFAULT '[]',
  p_bcc_addresses text DEFAULT '[]',
  p_subject text DEFAULT NULL,
  p_text_body text DEFAULT NULL,
  p_html_body text DEFAULT NULL,
  p_attachments text DEFAULT '[]',
  p_signature_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_draft jsonb;
BEGIN
  IF p_id IS NOT NULL THEN
    UPDATE public.email_drafts SET
      thread_id = COALESCE(p_thread_id, thread_id),
      in_reply_to = COALESCE(p_in_reply_to, in_reply_to),
      references = COALESCE(
        CASE WHEN p_references IS NOT NULL THEN string_to_array(replace(replace(replace(p_references, '[', ''), ']', ''), '"', ''), ',') END,
        references
      ),
      to_addresses = COALESCE(p_to_addresses::jsonb, to_addresses),
      cc_addresses = COALESCE(p_cc_addresses::jsonb, cc_addresses),
      bcc_addresses = COALESCE(p_bcc_addresses::jsonb, bcc_addresses),
      subject = COALESCE(p_subject, subject),
      text_body = COALESCE(p_text_body, text_body),
      html_body = COALESCE(p_html_body, html_body),
      attachments = COALESCE(p_attachments::jsonb, attachments),
      signature_id = COALESCE(p_signature_id, signature_id),
      updated_at = now()
    WHERE id = p_id AND tenant_id = public.my_tenant_id()
    RETURNING row_to_json(email_drafts.*) INTO v_draft;
  ELSE
    INSERT INTO public.email_drafts (
      tenant_id, account_id, thread_id, in_reply_to, references,
      to_addresses, cc_addresses, bcc_addresses,
      subject, text_body, html_body, attachments, signature_id
    ) VALUES (
      public.my_tenant_id(), p_account_id, p_thread_id, p_in_reply_to,
      CASE WHEN p_references IS NOT NULL THEN string_to_array(replace(replace(replace(p_references, '[', ''), ']', ''), '"', ''), ',') END,
      p_to_addresses::jsonb, p_cc_addresses::jsonb, p_bcc_addresses::jsonb,
      p_subject, p_text_body, p_html_body, p_attachments::jsonb, p_signature_id
    )
    RETURNING row_to_json(email_drafts.*) INTO v_draft;
  END IF;

  RETURN v_draft;
END;
$$;

CREATE OR REPLACE FUNCTION public.email_drafts_delete(p_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  DELETE FROM public.email_drafts WHERE id = p_id AND tenant_id = public.my_tenant_id();
  RETURN FOUND;
END;
$$;

-- ── Email Labels ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.email_labels_list()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN COALESCE((
    SELECT jsonb_agg(row_to_json(l.*) ORDER BY l.name)
    FROM public.email_labels l WHERE l.tenant_id = public.my_tenant_id()
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.email_labels_save(
  p_id uuid DEFAULT NULL,
  p_name text,
  p_color text DEFAULT '#6b7280'
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_label jsonb;
BEGIN
  IF p_id IS NOT NULL THEN
    UPDATE public.email_labels SET name = p_name, color = p_color
    WHERE id = p_id AND tenant_id = public.my_tenant_id()
    RETURNING row_to_json(email_labels.*) INTO v_label;
  ELSE
    INSERT INTO public.email_labels (tenant_id, name, color)
    VALUES (public.my_tenant_id(), p_name, p_color)
    RETURNING row_to_json(email_labels.*) INTO v_label;
  END IF;
  RETURN v_label;
END;
$$;

CREATE OR REPLACE FUNCTION public.email_labels_delete(p_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  DELETE FROM public.email_labels WHERE id = p_id AND tenant_id = public.my_tenant_id();
  RETURN FOUND;
END;
$$;

-- ── Verify ──────────────────────────────────────────────────────────────
SELECT 'Atlas Mail tables and RPCs created' as status;
