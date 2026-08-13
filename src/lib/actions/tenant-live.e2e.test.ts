// ---------------------------------------------------------------------------
// LIVE end-to-end test — tenant bootstrap idempotency (disabled by default).
//
//   RUN_LIVE_E2E=1 bun vitest run src/lib/actions/tenant-live.e2e.test.ts
//
// Guards the production onboarding defect: repeated/concurrent
// tenants_create_tenant calls raised "You already belong to a workspace."
// (P0001 → HTTP 400) or raced past the null check and died on the
// companyProfiles unique violation (23505 → HTTP 409). After migration 0011
// the function is idempotent: repeated calls return the SAME workspace and
// never create duplicate tenants/memberships.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { getSupabaseClient } from "@/lib/supabase";
import { rpcCall } from "./rpc";

const RUN = process.env.RUN_LIVE_E2E === "1";

describe.skipIf(!RUN)("tenant bootstrap idempotency (real project)", () => {
  it(
    "creates one workspace and returns the same tenant on repeated calls",
    async () => {
      const supabase = getSupabaseClient();
      if (!supabase) throw new Error("Supabase is not configured.");

      // Fresh throwaway user.
      const email = `tenant-e2e-${Date.now()}@example.com`;
      const password = "TenantE2e!42";
      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
      });
      expect(signUpError).toBeNull();
      const session =
        signUpData?.session ??
        (await supabase.auth.signInWithPassword({ email, password })).data.session;
      expect(session, "expected an active session after signup").toBeTruthy();
      if (session) await supabase.auth.setSession(session);

      // 1. First create succeeds.
      const first = (await rpcCall(supabase, "tenants_create_tenant", {
        name: "Idempotent Restoration Co",
      })) as { tenantId: string; existing?: boolean };
      expect(first.tenantId).toBeTruthy();

      // 2. Repeated create with the SAME name returns the same tenant (no 400).
      const second = (await rpcCall(supabase, "tenants_create_tenant", {
        name: "Idempotent Restoration Co",
      })) as { tenantId: string; existing?: boolean };
      expect(second.tenantId).toBe(first.tenantId);

      // 3. Repeated create with a DIFFERENT name still returns the same tenant
      //    (a user never ends up with a second workspace).
      const third = (await rpcCall(supabase, "tenants_create_tenant", {
        name: "A Completely Different Name",
      })) as { tenantId: string; existing?: boolean };
      expect(third.tenantId).toBe(first.tenantId);

      // 4. Exactly one membership exists for the user, pointing at that tenant.
      const { data: memberships, error: membershipsError } = await supabase
        .from("memberships")
        .select("tenantId")
        .eq("userId", session!.user.id);
      expect(membershipsError).toBeNull();
      expect(memberships?.length ?? 0).toBe(1);
      expect(memberships?.[0]?.tenantId).toBe(first.tenantId);
    },
    60_000,
  );
});
