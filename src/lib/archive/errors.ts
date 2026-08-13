// ---------------------------------------------------------------------------
// Archive error reporting.
//
// Turns raw backend/PostgREST errors into concise, user-facing messages that
// distinguish failure classes (extraction, security, upload, database,
// missing function, processing, auth, authorization). The underlying detail
// is preserved for audit purposes — it is only ever the message string, never
// credentials or secrets.
// ---------------------------------------------------------------------------

export interface ArchiveErrorDescription {
  /** Short user-facing headline. */
  title: string;
  /** Longer explanation for the error panel. */
  detail: string;
  /** Machine-usable category (also stored in audit logs). */
  category:
    | "extraction"
    | "unsupported"
    | "security"
    | "upload"
    | "database"
    | "missing_backend_function"
    | "processing"
    | "authentication"
    | "authorization"
    | "unknown";
}

const UNKNOWN: ArchiveErrorDescription = {
  title: "Atlas couldn't process that archive",
  detail: "An unexpected error occurred. The import was not recorded — try again or contact support with the message below.",
  category: "unknown",
};

function matchCategory(message: string): ArchiveErrorDescription {
  const m = message.toLowerCase();

  if (m.includes("could not find the function") || m.includes("pgrst202")) {
    return {
      title: "Atlas is missing a backend function",
      detail:
        "The deployed data service is missing a required archive function. The import was not recorded — the application needs to be redeployed against the current database schema.",
      category: "missing_backend_function",
    };
  }
  if (m.includes("must be signed in") || m.includes("401") || m.includes("invalid api key")) {
    return {
      title: "Your session expired",
      detail: "Please sign in again and retry the import.",
      category: "authentication",
    };
  }
  if (m.includes("viewers can read") || m.includes("only editors") || m.includes("only managers")) {
    return {
      title: "You don't have permission to import archives",
      detail: "Your role can read the knowledge base but not import company data. Ask an owner or manager for access.",
      category: "authorization",
    };
  }
  if (m.includes("only .zip and .rar")) {
    return {
      title: "Unsupported archive format",
      detail: "Atlas accepts .zip and .rar company-data packages. No data was imported.",
      category: "unsupported",
    };
  }
  if (m.includes("exceeds the maximum") || m.includes("too large")) {
    return {
      title: "Archive is too large",
      detail: "The archive exceeds Atlas's size limits. No data was imported.",
      category: "security",
    };
  }
  if (m.includes("checksum") || m.includes("corrupt") || m.includes("password protected")) {
    return {
      title: "Archive could not be validated",
      detail:
        "Atlas could not verify the archive's integrity. It may be corrupt, incomplete, or password protected. No data was imported.",
      category: "security",
    };
  }
  if (m.includes("missing from storage") || m.includes("upload") || m.includes("storage")) {
    return {
      title: "Archive upload failed",
      detail: "Files could not be stored securely. Nothing was recorded — please retry the import.",
      category: "upload",
    };
  }
  if (m.includes("no readable text") || m.includes("unsupported compression") || m.includes("could not read this archive")) {
    return {
      title: "Atlas couldn't extract this archive",
      detail:
        "The archive could not be read or its files contain no readable text. No data was imported.",
      category: "extraction",
    };
  }
  if (m.includes("already finished processing") || m.includes("archive not found") || m.includes("inventory batch")) {
    return {
      title: "Archive state conflict",
      detail: "The archive's state changed while it was being processed. Refresh the archive page to see its current status.",
      category: "database",
    };
  }
  if (m.includes("permission denied") || m.includes("42501") || m.includes("rlspolicy")) {
    return {
      title: "Access was denied",
      detail: "The data service denied the operation. No data was imported.",
      category: "authorization",
    };
  }
  return { ...UNKNOWN, detail: `Atlas couldn't process the archive. ${message}`, category: "unknown" };
}

/** Classify a thrown error into a user-facing description. */
export function describeArchiveError(e: unknown): ArchiveErrorDescription {
  if (e instanceof Error && e.message) return matchCategory(e.message);
  if (typeof e === "string" && e) return matchCategory(e);
  return UNKNOWN;
}
