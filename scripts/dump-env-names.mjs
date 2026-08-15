// Prints ONLY variable NAMES (never values) that look sensitive/related to the
// platform secret flow. Used to discover whether a decryption key or the
// production secrets are injected into the sandbox/build environment.
import { readFileSync } from "node:fs";

const RE = /KEY|TOKEN|SECRET|GEMINI|SUPABASE|VLY|FREE|ENC|DECRYPT|PASS|VAULT/i;

console.log("--- process.env names (filtered) ---");
const names = Object.keys(process.env).filter((k) => RE.test(k)).sort();
console.log(names.join("\n") || "(none)");

console.log("\n--- .env.local names ---");
try {
  const t = readFileSync(".env.local", "utf8");
  const keys = t
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => l.split("=")[0]);
  console.log(keys.join("\n") || "(empty)");
} catch {
  console.log("(missing)");
}
