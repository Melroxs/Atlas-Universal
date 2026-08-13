// ---------------------------------------------------------------------------
// connections-run-due-syncs — entry shim.
//
// The Freebuff bundler treats source/index.ts as the entry point and only
// packages files inside this function package directory, so the real handler
// (and its LOCAL CORS copy) live under source/. This shim keeps the standard
// Supabase CLI deploy path (`supabase functions deploy`) working too: it just
// executes the same self-contained handler — no import ever escapes this
// function's package directory.
// ---------------------------------------------------------------------------

import "./source/index.ts";
