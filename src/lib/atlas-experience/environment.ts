// ---------------------------------------------------------------------------
// Atlas Environment Validation
//
// Identifies which environment variables are configured, missing, optional,
// or required for production. Never exposes secret values.
// ---------------------------------------------------------------------------

export type EnvVarStatus = "configured" | "missing" | "optional";

export interface EnvVarInfo {
  name: string;
  status: EnvVarStatus;
  required: boolean;
  description: string;
}

export interface EnvironmentValidation {
  allConfigured: boolean;
  requiredMissing: EnvVarInfo[];
  vars: EnvVarInfo[];
}

/**
 * Validate required and optional environment variables.
 * Never prints values — only reports configured/missing status.
 */
export function validateEnvironment(): EnvironmentValidation {
  const vars: EnvVarInfo[] = [
    {
      name: "VITE_SUPABASE_URL",
      status: isConfigured("VITE_SUPABASE_URL") ? "configured" : "missing",
      required: true,
      description: "Supabase project URL",
    },
    {
      name: "VITE_SUPABASE_ANON_KEY",
      status: isConfigured("VITE_SUPABASE_ANON_KEY") ? "configured" : "missing",
      required: true,
      description: "Supabase anonymous/public key",
    },
    {
      name: "VITE_GEMINI_API_KEY",
      status: isConfigured("VITE_GEMINI_API_KEY") ? "configured" : "missing",
      required: false,
      description: "Google Gemini API key for AI features",
    },
    {
      name: "VITE_NVIDIA_API_KEY",
      status: isConfigured("VITE_NVIDIA_API_KEY") ? "configured" : "missing",
      required: false,
      description: "NVIDIA NIM API key for AI features (optional)",
    },
    {
      name: "VITE_VLY_INTEGRATION_KEY",
      status: isConfigured("VITE_VLY_INTEGRATION_KEY") ? "configured" : "missing",
      required: false,
      description: "Vly integration key for enhanced AI",
    },
  ];

  const requiredMissing = vars.filter((v) => v.required && v.status === "missing");
  const allConfigured = requiredMissing.length === 0;

  return {
    allConfigured,
    requiredMissing,
    vars,
  };
}

/**
 * Check if an environment variable is configured and non-empty.
 * Never reads the value — only checks existence.
 */
function isConfigured(name: string): boolean {
  try {
    const value = import.meta.env?.[name];
    return typeof value === "string" && value.length > 0;
  } catch {
    return false;
  }
}

/**
 * Build a human-readable environment status summary.
 * Never exposes secret values.
 */
export function getEnvironmentSummary(): string {
  const validation = validateEnvironment();

  if (validation.allConfigured) {
    return "All required environment variables are configured.";
  }

  const missing = validation.requiredMissing
    .map((v) => `${v.name} — ${v.description}`)
    .join("\n");

  return `Missing required environment variables:\n${missing}`;
}
