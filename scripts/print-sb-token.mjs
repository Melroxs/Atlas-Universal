// Prints the Supabase access token for command substitution ONLY:
//   SUPABASE_ACCESS_TOKEN="$(node scripts/print-sb-token.mjs)" supabase ...
// The value goes into a shell variable; it is never printed to the terminal
// by this script itself.
import { readFileSync } from "node:fs";

const text = readFileSync(".env.local", "utf8");
const m = text.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m);
if (!m) {
  console.error("SUPABASE_ACCESS_TOKEN not found in .env.local");
  process.exit(1);
}
process.stdout.write(m[1].trim());
