// Prints the Gemini API key for command substitution ONLY:
//   GEMINI_API_KEY="$(node scripts/print-gemini-key.mjs)" ...
// The value goes into a shell variable; it is never printed to the terminal
// by this script itself. Used to set the Supabase Edge Function secret
// without exposing the key in the transcript.
import { readFileSync } from "node:fs";

const text = readFileSync(".env.local", "utf8");
const m = text.match(/^GEMINI_API_KEY=(.*)$/m);
if (!m) {
  console.error("GEMINI_API_KEY not found in .env.local");
  process.exit(1);
}
process.stdout.write(m[1].trim());
