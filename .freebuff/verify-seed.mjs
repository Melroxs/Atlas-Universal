const URL = "http://127.0.0.1:54331";
const ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const email = process.argv[2] || "demo.1786503238726@atlas.test";
let r = await fetch(`${URL}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" }, body: JSON.stringify({ email, password: "test-pass-123" }) });
const j = await r.json();
if (!j.access_token) { console.log("SIGNIN FAILED:", j.error_description || j.msg || j); process.exit(1); }
const token = j.access_token;
const sample = [{ key: "atlas-core", name: "Atlas Core Knowledge", packType: "core", description: "d", version: "1.0.0", publisher: "Atlas", items: [{ itemType: "terminology", key: "k1", title: "T1", summary: "s", content: { text: "x" }, confidence: 0.9 }] }];
const res = await fetch(`${URL}/rest/v1/rpc/intelligence_seed_packs`, { method: "POST", headers: { apikey: ANON, "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ p_packs: sample }) });
const body = await res.json().catch(() => null);
console.log("seed_packs(sample):", res.status, JSON.stringify(body));
