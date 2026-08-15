// Prints ONLY presence flags for keys in the sandbox process environment
// (never values). Used to learn whether the Freebuff platform injects the
// production secrets into the terminal session.
for (const k of [
  "SUPABASE_ACCESS_TOKEN",
  "GEMINI_API_KEY",
  "GEMINI_MODEL",
  "AI_PROVIDER",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
]) {
  const v = process.env[k];
  console.log(`${k}: ${typeof v === "string" && v.length > 0 ? "set" : "missing"}`);
}
