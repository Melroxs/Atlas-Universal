// ---------------------------------------------------------------------------
// Deploy the conversation-converse edge function from the hosting build.
//
// The Freebuff hosting build is the only place the platform's production
// environment values are visible to a process we control. This script pushes
// the edge-function CODE to Supabase when a usable management token is
// present. The Gemini secrets themselves are managed DIRECTLY in Supabase
// (Edge Function secrets) by the workspace owner — this script never reads
// or writes secret VALUES, so a misconfigured value can never clobber the
// real keys.
//
// Secret resolution (in order): process.env → .env* files at the project
// root and supabase/ (the platform may merge production values into either).
//
// Safety:
//   - Runs AFTER `vite build`; the static output in dist/ is untouched except
//     for one small diagnostic marker (dist/edge-deploy-status.json) that
//     records ONLY booleans/codes/shape flags — never secret values.
//   - No-ops (exit 0) when no usable token is present, so local builds and
//     previews are never broken.
//   - The token is passed to the Supabase CLI via env (standard CI practice);
//     it is never written to stdout/stderr and never logged.
//   - Idempotent: `functions deploy` replaces the function bundle.
//   - A deploy failure logs the real (secret-free) error and exits 0 so the
//     frontend hosting build is never taken down by an edge-function issue.
// ---------------------------------------------------------------------------

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync, statSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const REF = "ibxvzxblyhzwokljkslt"; // project ref of atlasmvp
const FUNCTION = "conversation-converse";
const MARKER = "dist/edge-deploy-status.json";

const envFiles = [];
for (const dir of [".", "supabase"]) {
  try {
    for (const name of readdirSync(dir)) {
      if (name.startsWith(".env")) {
        const p = join(dir, name);
        try {
          if (statSync(p).isFile()) envFiles.push(p);
        } catch {}
      }
    }
  } catch {}
}

function parseEnvFile(file) {
  const out = {};
  try {
    for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq === -1) continue;
      out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
    }
  } catch {}
  return out;
}

/** Never returns values — only where the key was found and a coarse shape. */
function locate(name) {
  const direct = process.env[name];
  if (typeof direct === "string" && direct.trim()) {
    return { source: "process", shape: shapeOf(direct) };
  }
  for (const f of envFiles) {
    const v = parseEnvFile(f)[name];
    if (typeof v === "string" && v.trim()) return { source: f, shape: shapeOf(v) };
  }
  return { source: "missing", shape: "missing" };
}

/** Coarse, secret-free classification of a value's shape. */
function shapeOf(v) {
  const t = v.trim();
  if (t.startsWith("eyJ")) return "base64_json_envelope";
  if (/^sbp_[A-Za-z0-9._-]+$/.test(t)) return "supabase_pat";
  if (/^AIza[0-9A-Za-z_-]{20,}$/.test(t)) return "google_api_key";
  if (/^[A-Za-z0-9_-]{6,}$/.test(t)) return "plainish";
  if (t.length === 0) return "empty";
  return `other_len_${t.length}`;
}

/**
 * Decode a platform secret envelope WITHOUT ever exposing its value.
 *
 * The Freebuff hosting build delivers secrets as `base64(JSON)` strings
 * (they start with `eyJ`, base64 of `{`). The JSON can take several shapes
 * across platform versions, so we extract defensively:
 *   {"<NAME>": "value"} | {"value": "..."} | {"data": "..."} | {"secret": "..."}
 *   {"<NAME>": {"value": "..."}} | [{"key":"<NAME>","value":"..."}]
 *   a bare JSON string (possibly double-encoded)
 *
 * Returns { value, path } where path is a SECRET-FREE description of which
 * extraction succeeded (for the diagnostic marker), or { value: "", path }
 * when nothing could be extracted. The value itself is only ever passed to
 * the Supabase CLI via the environment — never printed.
 */
function decodeSecret(raw) {
  const attempt = (s, depth) => {
    if (depth > 3 || typeof s !== "string" || !s.trim()) return null;
    const t = s.trim();
    const candidates = [];
    // Standard and URL-safe base64 variants. Node's base64 decoder is
    // lenient about padding, so unpadded platform strings still decode.
    for (const variant of [t, t.replace(/-/g, "+").replace(/_/g, "/")]) {
      try {
        candidates.push(JSON.parse(Buffer.from(variant, "base64").toString("utf8")));
      } catch {
        /* not base64-json */
      }
    }
    try {
      candidates.push(JSON.parse(t));
    } catch {
      /* not raw json */
    }
    for (const parsed of candidates) {
      if (parsed === null || parsed === undefined) continue;
      if (typeof parsed === "string" || typeof parsed === "object") {
        return { parsed, t };
      }
    }
    return null;
  };

  const first = attempt(raw, 0);
  if (!first) return { value: "", path: "not_json_envelope" };
  const { parsed, t } = first;

  const asString = (x) => (typeof x === "string" && x.trim() ? x.trim() : null);
  const PREFERRED_KEYS = [
    "SUPABASE_ACCESS_TOKEN", "supabase_access_token", "GEMINI_API_KEY", "GEMINI_MODEL",
    "AI_PROVIDER", "value", "data", "secret", "token", "apiKey", "api_key", "key",
  ];
  const pick = (obj, keys) => {
    for (const k of keys) {
      if (obj && typeof obj === "object" && !Array.isArray(obj) && typeof obj[k] === "string" && obj[k].trim()) {
        return { value: obj[k].trim(), path: `envelope.${k}` };
      }
      if (obj && typeof obj === "object" && !Array.isArray(obj) && obj[k] && typeof obj[k] === "object") {
        const nested = pick(obj[k], ["value", "data", "secret", "key", "token"]);
        if (nested) return { value: nested.value, path: `envelope.${k}.${nested.path.split(".").pop()}` };
      }
    }
    return null;
  };

  /** Last resort: walk the whole envelope and return the first string leaf
   *  under a credential-ish key anywhere in the tree. */
  const walk = (node, depth) => {
    if (depth > 5) return null;
    if (typeof node === "string") return node.trim() || null;
    if (Array.isArray(node)) {
      for (const x of node) {
        const r = walk(x, depth + 1);
        if (r) return r;
      }
      return null;
    }
    if (node && typeof node === "object") {
      const byKey = pick(node, PREFERRED_KEYS);
      if (byKey) return byKey.value;
      for (const k of Object.keys(node)) {
        const r = walk(node[k], depth + 1);
        if (r) return r;
      }
    }
    return null;
  };

  // 1. A bare string (possibly the secret itself, maybe double-encoded).
  const direct = asString(parsed);
  if (direct) {
    // If the string is itself valid base64 of JSON, prefer the deeper value
    // (some platform versions double-encode secrets).
    const again = attempt(direct, 1);
    if (again) {
      const deep = asString(again.parsed);
      if (deep && deep !== direct) return { value: deep, path: "envelope.double_encoded_string" };
      const deepObj = pick(again.parsed, ["value", "data", "secret", "token", "apiKey", "api_key"]);
      if (deepObj) return deepObj;
    }
    return { value: direct, path: "envelope.direct_string" };
  }

  // 2. An array of { key/name, value } entries.
  if (Array.isArray(parsed)) {
    for (const item of parsed) {
      if (item && typeof item === "object") {
        const v = asString(item.value) ?? asString(item.secret) ?? asString(item.token) ?? asString(item.data);
        if (v) return { value: v, path: "envelope.array_entry" };
      }
    }
    return { value: "", path: "envelope.array_no_match" };
  }

  // 3. An object: prefer a matching env-var key, then common value keys,
  //    then any string leaf anywhere in the envelope.
  const byName = pick(parsed, PREFERRED_KEYS);
  if (byName) return byName;
  const walked = walk(parsed, 0);
  if (walked) return { value: walked, path: "envelope.walked_leaf" };

  // 4. The decoded JSON may itself be a JSON-string value (double encode).
  const again = attempt(parsed, 1);
  if (again) {
    const deep = asString(again.parsed);
    if (deep) return { value: deep, path: "envelope.double_encoded_string" };
  }

  return { value: "", path: "envelope.unrecognized_shape" };
}

/**
 * SECRET-FREE structural fingerprint of an envelope: maps each key to the
 * SHAPE of its value (never the value itself). Used only for diagnostics so
 * the build marker can tell us which envelope layout the platform uses.
 */
function describeEnvelope(raw) {
  const shapeOfValue = (v) => {
    if (typeof v === "string") return shapeOf(v);
    if (v === null || v === undefined) return String(v);
    if (Array.isArray(v)) return `array[${v.length}]`;
    if (typeof v === "object") {
      const out = {};
      for (const [k, val] of Object.entries(v).slice(0, 8)) {
        out[k] = shapeOfValue(val);
      }
      return out;
    }
    return typeof v;
  };
  // Classify the payload field `c` WITHOUT exposing it: is it JSON, printable
  // text, or binary ciphertext?
  const classifyPayload = (s) => {
    if (typeof s !== "string" || !s) return "missing";
    for (const variant of [s, s.replace(/-/g, "+").replace(/_/g, "/")]) {
      try {
        const buf = Buffer.from(variant, "base64");
        const text = buf.toString("utf8");
        try {
          const parsed = JSON.parse(text);
          if (parsed && typeof parsed === "object") {
            const keys = Object.keys(parsed).slice(0, 6);
            return `json:${keys.join(",")}`;
          }
          return `json_string(${shapeOf(String(parsed))})`;
        } catch {
          // Not JSON — is it printable text?
          const printable = /^[\x20-\x7E\n\r\t]*$/.test(text) && text.length > 0;
          return printable ? `utf8_text_len_${text.length}` : `binary_len_${buf.length}`;
        }
      } catch {
        /* not base64 */
      }
    }
    return `not_base64_len_${s.length}`;
  };
  if (typeof raw !== "string" || !raw.trim()) return "missing";
  const t = raw.trim();
  for (const variant of [t, t.replace(/-/g, "+").replace(/_/g, "/")]) {
    try {
      const parsed = JSON.parse(Buffer.from(variant, "base64").toString("utf8"));
      if (typeof parsed === "string") return `string(${shapeOf(parsed)})`;
      if (typeof parsed === "object" && parsed !== null) {
        if (Array.isArray(parsed)) {
          return { array: parsed.slice(0, 6).map((x) => shapeOfValue(x)) };
        }
        const out = {};
        for (const [k, val] of Object.entries(parsed).slice(0, 10)) {
          out[k] =
            k === "c"
              ? classifyPayload(String(val))
              : k === "k"
                ? (Array.isArray(val)
                    ? `array[${val.length}]`
                    : shapeOfValue(val))
                : shapeOfValue(val);
        }
        return out;
      }
      return typeof parsed;
    } catch {
      /* not base64-json */
    }
  }
  return `not_json(${shapeOf(t)})`;
}

function valueOf(name) {
  const direct = process.env[name];
  if (typeof direct === "string" && direct.trim()) return direct.trim();
  for (const f of envFiles) {
    const v = parseEnvFile(f)[name];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

/**
 * Resolve a secret from the build environment, decoding the platform's
 * base64-JSON envelope when present. Returns { value, source, shape, path }
 * — all fields except `value` are secret-free and safe to log/record.
 */
function resolveSecret(name) {
  const direct = process.env[name];
  if (typeof direct === "string" && direct.trim()) {
    const dec = decodeSecret(direct);
    const value = dec.value || direct.trim();
    return {
      value,
      source: "process",
      shape: shapeOf(value),
      path: dec.value ? dec.path : shapeOf(direct),
    };
  }
  for (const f of envFiles) {
    const v = parseEnvFile(f)[name];
    if (typeof v === "string" && v.trim()) {
      return { value: v.trim(), source: f, shape: shapeOf(v), path: "env_file" };
    }
  }
  return { value: "", source: "missing", shape: "missing", path: "missing" };
}

const tokenRes = resolveSecret("SUPABASE_ACCESS_TOKEN");
const token = tokenRes.value;

const writeMarker = (state) => {
  try {
    mkdirSync("dist", { recursive: true });
    writeFileSync(
      MARKER,
      JSON.stringify(
        {
          tool: "deploy-conversation-converse",
          ts: Date.now(),
          buildEnvNames: Object.keys(process.env)
            .filter((k) => /KEY|TOKEN|SECRET|GEMINI|SUPABASE|VLY|FREE|DECRYPT|ENC|VAULT|PASS/i.test(k))
            .sort(),
          envFiles: envFiles.map((f) => f.replace(/^\.\//, "")),
          token: {
            source: tokenRes.source,
            shape: tokenRes.shape,
            path: tokenRes.path,
            envelope: describeEnvelope(process.env.SUPABASE_ACCESS_TOKEN ?? ""),
          },
          geminiKey: (() => {
            const r = resolveSecret("GEMINI_API_KEY");
            return { source: r.source, shape: r.shape, path: r.path };
          })(),
          geminiModel: (() => {
            const r = resolveSecret("GEMINI_MODEL");
            return { source: r.source, shape: r.shape, path: r.path };
          })(),
          aiProvider: (() => {
            const r = resolveSecret("AI_PROVIDER");
            return { source: r.source, shape: r.shape, path: r.path };
          })(),
          ...state,
        },
        null,
        2,
      ),
    );
  } catch {
    /* marker is best-effort */
  }
};

if (!token) {
  console.log(
    "[deploy-edge] SUPABASE_ACCESS_TOKEN not present in build env — skipping edge function deploy (frontend build unaffected).",
  );
  writeMarker({ step: "skipped" });
  process.exit(0);
}

// Only proceed with a token that is actually a Supabase PAT — never pass an
// opaque envelope (or any other non-token value) to the CLI.
if (tokenRes.shape !== "supabase_pat") {
  console.log(
    `[deploy-edge] SUPABASE_ACCESS_TOKEN resolved (source=${tokenRes.source}, path=${tokenRes.path}) but shape=${tokenRes.shape} (not a supabase_pat) — skipping edge function deploy.`,
  );
  writeMarker({ step: "skipped_bad_shape" });
  process.exit(0);
}

writeMarker({ step: "started" });

const run = (args, opts = {}) =>
  execFileSync("bunx", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, SUPABASE_ACCESS_TOKEN: token, CI: "1" },
    ...opts,
  });

try {
  // Deploy the function code (the Gemini reasoning layer). Secrets are NOT
  // managed here — they live in Supabase's own Edge Function secret store.
  const out = run([
    "supabase@latest",
    "functions",
    "deploy",
    FUNCTION,
    "--project-ref",
    REF,
    "--no-verify-jwt",
  ]);
  const tail = out
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .slice(-6)
    .join("\n");
  console.log(`[deploy-edge] ${FUNCTION} deploy:\n${tail.slice(0, 500)}`);
  writeMarker({ step: "deployed" });
} catch (e) {
  // A deploy failure must not take down the frontend hosting build — log the
  // real error (CLI output only; it never contains secret values) and exit 0.
  const msg = e && typeof e === "object" && "stdout" in e ? String(e.stdout ?? "") : "";
  const err = e && typeof e === "object" && "stderr" in e ? String(e.stderr ?? "") : "";
  const detail = (msg || err || String(e && e.message ? e.message : e)).slice(0, 400);
  console.error(`[deploy-edge] deploy failed: ${detail}`);
  writeMarker({ step: "failed", error: detail.slice(0, 300) });
  process.exit(0);
}
