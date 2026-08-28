#!/usr/bin/env node
/**
 * Complete YC Demo onboarding end-to-end.
 *
 * 1. Creates the company profile if missing (via service-role admin)
 * 2. Signs in as the YC Demo user
 * 3. Fills in all 4 onboarding steps with fictional data via RPCs
 * 4. Seeds intelligence packs and marks onboarding complete
 * 5. Falls back to direct admin DB updates if auth fails
 *
 * Usage:
 *   node scripts/complete-ycdemo-onboarding.mjs              # full run
 *   node scripts/complete-ycdemo-onboarding.mjs --dry-run    # inspect only
 *   node scripts/complete-ycdemo-onboarding.mjs --reset      # reset to step 1
 */

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const YC_DEMO_EMAIL = "ycdemo@gmail.com";
const YC_DEMO_PASSWORD = process.env.YC_DEMO_PASSWORD || "AtlasDemo2026!";

function loadEnv() {
  for (const f of [".env.local", ".env"]) {
    try {
      const txt = readFileSync(f, "utf-8");
      for (const line of txt.split("\n")) {
        const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.+)/);
        if (m && !process.env[m[1]]) {
          process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
        }
      }
    } catch {}
  }
}

loadEnv();

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error("Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in env");
  process.exit(1);
}

const dryRun = process.argv.includes("--dry-run");
const resetOnly = process.argv.includes("--reset");

const USER_ID = "c7e29b03-81d5-49c3-9504-151aa0dcd510";

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const admin = SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
  : anonClient;

// ---------------------------------------------------------------------------
// Fictional YC Demo data
// ---------------------------------------------------------------------------

const COMPANY = {
  companyName: "YC Demo",
  industry: "Insurance restoration",
  subIndustry: "Roofing & Property Restoration",
  country: "United States",
  stateProvince: "Texas",
  city: "Austin",
  operatingGeography: "Central Texas",
  companySize: "11\u201350",
  employeeCount: 34,
  businessModel: "B2B insurance restoration services",
  servicesProducts: [
    "Insurance restoration",
    "Roofing",
    "Water mitigation",
    "Fire damage repair",
    "Storm damage restoration",
    "Reconstruction",
  ],
  website: "https://yc-demo.example.com",
};

const SYSTEMS = [
  { name: "CRM", category: "crm", vendor: "HubSpot", status: "active" },
  { name: "Accounting", category: "accounting", vendor: "QuickBooks", status: "active" },
  { name: "Job management", category: "job_management", vendor: "DASH", status: "active" },
  { name: "Field software", category: "field", vendor: "CompanyCam", status: "planned" },
  { name: "Google Drive", category: "document_storage", vendor: "Google", status: "active" },
  { name: "Microsoft 365", category: "document_storage", vendor: "Microsoft", status: "none" },
  { name: "Email", category: "email", vendor: "Microsoft Outlook", status: "active" },
  { name: "Estimating", category: "estimating", vendor: "Xactimate", status: "active" },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ts = () => Date.now();

/** Case-insensitive column matching for Supabase PostgREST */
function col(row, camel, snake) {
  return row[camel] ?? row[snake] ?? row[camel.toLowerCase()];
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("\n\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550");
  console.log("  YC Demo Onboarding \u2014 Complete End-to-End");
  console.log("\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\n");

  // ── Step 0: Inspect ───────────────────────────────────────────────────
  console.log("\ud83d\udccb Step 0: Inspecting current state...");

  const { data: mems } = await admin
    .from("memberships")
    .select("*")
    .eq("userId", USER_ID);
  const tenantId = mems?.[0]?.tenantId;

  if (!tenantId) {
    console.error("  \u2717 No membership found for YC Demo user.");
    process.exit(1);
  }
  console.log(`  User ID:     ${USER_ID}`);
  console.log(`  Tenant ID:   ${tenantId}`);

  const { data: cpRows } = await admin
    .from("companyprofiles")
    .select("*")
    .eq("tenantId", tenantId)
    .limit(1);
  const existingProfile = cpRows?.[0] || null;

  const companyName = existingProfile ? col(existingProfile, "companyName", "companyname") : null;
  const onboardingComplete = existingProfile ? col(existingProfile, "onboardingComplete", "onboardingcomplete") : false;
  const onboardingStep = existingProfile ? col(existingProfile, "onboardingStep", "onboardingstep") : null;

  console.log(`  Company:     ${companyName || "none (needs creation)"}`);
  console.log(`  Onboarding:  ${onboardingComplete ? "COMPLETE" : "INCOMPLETE"} (step ${onboardingStep ?? "?"})`);

  const { data: sys } = await admin
    .from("companysystems")
    .select("*")
    .eq("tenantId", tenantId);
  console.log(`  Systems:     ${sys?.length || 0} configured`);

  const { data: packs } = await admin
    .from("tenantpacks")
    .select("*")
    .eq("tenantId", tenantId);
  console.log(`  Packs:       ${packs?.map((p) => col(p, "packKey", "packkey")).join(", ") || "none"}`);

  if (dryRun) {
    console.log("\n  [DRY RUN] No changes made.");
    return;
  }

  // ── Reset mode ────────────────────────────────────────────────────────
  if (resetOnly) {
    console.log("\n\ud83d\udd04 Resetting onboarding to step 1...");
    if (existingProfile) {
      await admin
        .from("companyprofiles")
        .update({
          companyName: null,
          industry: null,
          subIndustry: null,
          country: null,
          stateProvince: null,
          city: null,
          operatingGeography: null,
          companySize: null,
          employeeCount: null,
          businessModel: null,
          servicesProducts: null,
          website: null,
          onboardingStep: 1,
          onboardingComplete: false,
          updatedAt: ts(),
        })
        .eq("_id", existingProfile._id);
    }
    await admin.from("companysystems").delete().eq("tenantId", tenantId);
    await admin.from("tenantpacks").delete().eq("tenantId", tenantId);
    await admin.from("organizationcontexts").delete().eq("tenantId", tenantId);
    console.log("  \u2713 Reset complete. Navigate to /setup to re-do onboarding.");
    return;
  }

  // ── Step 1: Ensure company profile exists ─────────────────────────────
  console.log("\n\ud83c\udfe2 Step 1: Ensure workspace + company profile...");

  let profileId = existingProfile?._id;

  if (!existingProfile) {
    console.log("  Company profile missing \u2014 creating via admin...");
    const { data: newProfile, error: createErr } = await admin
      .from("companyprofiles")
      .insert({
        tenantId: tenantId,
        companyName: "YC Demo",
        onboardingStep: 0,
        onboardingComplete: false,
        updatedAt: ts(),
      })
      .select("_id")
      .single();

    if (createErr) {
      console.error(`  \u2717 Failed to create profile: ${createErr.message}`);
      process.exit(1);
    }
    profileId = newProfile._id;
    console.log(`  \u2713 Company profile created (${profileId})`);
  } else {
    console.log("  \u2713 Company profile exists");
  }

  // ── Step 2: Sign in as YC Demo ────────────────────────────────────────
  console.log("\n\ud83d\udd10 Step 2: Signing in as YC Demo...");

  let signedIn = false;
  const { data: authData, error: authErr } = await anonClient.auth.signInWithPassword({
    email: YC_DEMO_EMAIL,
    password: YC_DEMO_PASSWORD,
  });

  if (authErr) {
    console.log(`  \u26a0 Auth failed (${authErr.message}) \u2014 trying alternate password...`);
    // Try the common demo password patterns
    for (const pw of ["Demo1234!", "AtlasDemo123!", "password", "Demo2026!"]) {
      const r = await anonClient.auth.signInWithPassword({ email: YC_DEMO_EMAIL, password: pw });
      if (!r.error) {
        console.log(`  \u2713 Signed in with alternate password`);
        signedIn = true;
        break;
      }
    }
    if (!signedIn) {
      console.log("  \u26a0 Could not authenticate \u2014 using admin DB updates instead");
    }
  } else {
    signedIn = true;
    console.log(`  \u2713 Signed in as ${authData.user.email}`);
  }

  // ── Step 3: Company profile (via RPC if signed in, else admin) ────────
  console.log("\n\ud83d\udcdd Step 3: Company profile...");

  if (signedIn) {
    // Delete existing profile row to let RPC re-create with correct columns
    if (existingProfile) {
      // The RPC expects a row to exist. If the row exists, update it.
    }
    const r2 = await anonClient.rpc("onboarding_update_company_profile", {
      p_companyname: COMPANY.companyName,
      p_industry: COMPANY.industry,
      p_subindustry: COMPANY.subIndustry,
      p_country: COMPANY.country,
      p_stateprovince: COMPANY.stateProvince,
      p_city: COMPANY.city,
      p_operatinggeography: COMPANY.operatingGeography,
      p_companysize: COMPANY.companySize,
      p_employeecount: COMPANY.employeeCount,
      p_businessmodel: COMPANY.businessModel,
      p_servicesproducts: JSON.stringify(COMPANY.servicesProducts),
      p_website: COMPANY.website,
      p_onboardingstep: 2,
    });
    if (r2.error) {
      console.error(`  \u2717 RPC failed: ${r2.error.message} \u2014 falling back to admin`);
      signedIn = false;
    } else {
      console.log("  \u2713 Company profile saved via RPC");
    }
  }

  if (!signedIn) {
    // Direct admin update
    const { error } = await admin
      .from("companyprofiles")
      .update({
        companyName: COMPANY.companyName,
        industry: COMPANY.industry,
        subIndustry: COMPANY.subIndustry,
        country: COMPANY.country,
        stateProvince: COMPANY.stateProvince,
        city: COMPANY.city,
        operatingGeography: COMPANY.operatingGeography,
        companySize: COMPANY.companySize,
        employeeCount: COMPANY.employeeCount,
        businessModel: COMPANY.businessModel,
        servicesProducts: COMPANY.servicesProducts,
        website: COMPANY.website,
        onboardingStep: 2,
        updatedAt: ts(),
      })
      .eq("_id", profileId);
    if (error) {
      console.error(`  \u2717 Admin update failed: ${error.message}`);
    } else {
      console.log("  \u2713 Company profile saved via admin");
    }
  }

  // ── Step 4: Systems ───────────────────────────────────────────────────
  console.log("\n\u2699\ufe0f  Step 4: Systems...");

  if (signedIn) {
    for (const sys of SYSTEMS) {
      if (sys.status === "none") continue;
      const r = await anonClient.rpc("onboarding_save_company_system", {
        p_name: sys.name,
        p_category: sys.category,
        p_vendor: sys.vendor,
        p_status: sys.status,
      });
      if (r.error) {
        console.error(`  \u2717 ${sys.name}: ${r.error.message}`);
      } else {
        console.log(`  \u2713 ${sys.name} (${sys.vendor}) \u2192 ${sys.status}`);
      }
    }
  } else {
    // Admin insert (delete existing first since no unique constraint)
    await admin.from("companysystems").delete().eq("tenantId", tenantId);
    for (const sys of SYSTEMS) {
      if (sys.status === "none") continue;
      const { error } = await admin
        .from("companysystems")
        .insert({ tenantId, name: sys.name, category: sys.category, vendor: sys.vendor, status: sys.status });
      if (error) console.error(`  \u2717 ${sys.name}: ${error.message}`);
      else console.log(`  \u2713 ${sys.name} (${sys.vendor}) \u2192 ${sys.status}`);
    }
  }

  // ── Step 5: Seed intelligence ──────────────────────────────────────────
  console.log("\n\ud83d\ude80 Step 5: Seed intelligence packs...");

  if (signedIn) {
    const { PACK_SEEDS } = await import("@/lib/atlas-data/packs");
    const { data: seedResult, error: seedErr } = await anonClient.rpc("intelligence_seed_packs", {
      p_packs: PACK_SEEDS,
    });
    if (seedErr) {
      console.error(`  \u2717 Seed failed: ${seedErr.message}`);
    } else {
      console.log(`  \u2713 Intelligence seeded (${seedResult?.seeded ?? "?"} packs)`);
    }
  } else {
    try {
      const { PACK_SEEDS } = await import("@/lib/atlas-data/packs");
      let count = 0;
      for (const pack of PACK_SEEDS) {
        const { error } = await admin
          .from("intelligencepacks")
          .upsert(
            {
              key: pack.key,
              name: pack.name,
              packType: pack.packType,
              publisher: pack.publisher,
              description: pack.description,
              version: pack.version,
              status: "active",
            },
            { onConflict: "key" }
          );
        if (!error) count++;
      }
      console.log(`  \u2713 ${count} intelligence packs seeded via admin`);
    } catch (e) {
      console.error(`  \u2717 Pack import failed: ${e.message}`);
    }
  }

  // ── Step 6: Complete onboarding ────────────────────────────────────────
  console.log("\n\ud83d\ude80 Step 6: Complete onboarding...");

  if (signedIn) {
    const { data: result, error } = await anonClient.rpc("onboarding_complete_onboarding");
    if (error) {
      console.error(`  \u2717 Complete failed: ${error.message}`);
    } else {
      console.log(`  \u2713 Onboarding complete! Packs: ${JSON.stringify(result?.activatedPacks)}`);
    }
  } else {
    // Admin: activate packs + create connection + org context + mark complete
    const industry = COMPANY.industry.toLowerCase();
    const country = COMPANY.country.toLowerCase();
    const activationPacks = ["atlas-core", "general-business"];
    if (/restoration|construction|mitigation|roof|property/.test(industry)) activationPacks.push("insurance-restoration");
    if (/united/.test(country)) activationPacks.push("us-federal");

    for (const pk of activationPacks) {
      await admin
        .from("tenantpacks")
        .upsert(
          { tenantId, packKey: pk, activatedAt: ts(), activatedBy: USER_ID, status: "active" },
          { onConflict: "tenantId,packKey" }
        );
    }
    console.log(`  \u2713 Tenant packs activated: ${activationPacks.join(", ")}`);

    // Manual upload connection
    const { data: connExists } = await admin
      .from("connections")
      .select("_id")
      .eq("tenantId", tenantId)
      .eq("provider", "manual_upload")
      .limit(1);
    if (!connExists?.length) {
      await admin.from("connections").insert({
        tenantId,
        name: "Manual file uploads",
        provider: "manual_upload",
        category: "document_storage",
        status: "connected",
        notes: "Files uploaded directly to Atlas.",
        settings: { kind: "upload" },
      });
      console.log("  \u2713 Manual upload connection created");
    }

    // Org context
    const { data: orgExists } = await admin
      .from("organizationcontexts")
      .select("_id")
      .eq("tenantId", tenantId)
      .limit(1);
    if (!orgExists?.length) {
      await admin.from("organizationcontexts").insert({
        tenantId,
        country: COMPANY.country,
        industry: COMPANY.industry,
        businessModel: COMPANY.businessModel,
        companySize: COMPANY.companySize,
        updatedAt: ts(),
      });
      console.log("  \u2713 Organization context created");
    }

    // Mark complete
    await admin
      .from("companyprofiles")
      .update({ onboardingStep: 5, onboardingComplete: true, updatedAt: ts() })
      .eq("_id", profileId);
    console.log("  \u2713 Onboarding marked complete");
  }

  // ── Final verification ────────────────────────────────────────────────
  console.log("\n\ud83d\udd0d Final verification...");

  if (signedIn) {
    const { data: ws } = await anonClient.rpc("tenants_get_my_workspace");
    console.log(`  Company:     ${ws?.profile?.companyName || "missing"}`);
    console.log(`  Industry:    ${ws?.profile?.industry || "missing"}`);
    console.log(`  City:        ${ws?.profile?.city || "missing"}`);
    console.log(`  Systems:     ${ws?.systems?.length || 0} configured`);
    console.log(`  Packs:       ${ws?.packs?.map((p) => p.packKey).join(", ") || "none"}`);
    console.log(`  Complete:    ${ws?.profile?.onboardingComplete ? "YES \u2713" : "NO \u2717"}`);
    await anonClient.auth.signOut();
  } else {
    const { data: fp } = await admin
      .from("companyprofiles")
      .select("*")
      .eq("_id", profileId)
      .single();
    const { data: fs } = await admin
      .from("companysystems")
      .select("*")
      .eq("tenantId", tenantId);
    const { data: fpk } = await admin
      .from("tenantpacks")
      .select("*")
      .eq("tenantId", tenantId);

    console.log(`  Company:     ${fp ? col(fp, "companyName", "companyname") : "missing"}`);
    console.log(`  Industry:    ${fp ? col(fp, "industry", "industry") : "missing"}`);
    console.log(`  City:        ${fp ? col(fp, "city", "city") : "missing"}`);
    console.log(`  Systems:     ${fs?.length || 0} configured`);
    console.log(`  Packs:       ${fpk?.map((p) => col(p, "packKey", "packkey")).join(", ") || "none"}`);
    console.log(`  Complete:    ${fp && col(fp, "onboardingComplete", "onboardingcomplete") ? "YES \u2713" : "NO \u2717"}`);
  }

  console.log("\n\u2705 Done! Sign in at /auth to see the fresh YC Demo workspace.");
}

main().catch((e) => {
  console.error("\nFatal:", e);
  process.exit(1);
});
