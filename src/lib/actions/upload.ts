// ---------------------------------------------------------------------------
// Supabase Storage uploads — shared by single-document uploads (Knowledge) and
// archive ingestion (ArchiveUpload).
//
// RLS on storage.objects only allows inserts under <tenantId>/…, so every
// upload starts by asking Postgres for the tenant-scoped folder prefix.
// The returned object path is the storageId the backend records.
// ---------------------------------------------------------------------------

import { getSupabaseClient } from "@/lib/supabase";

export interface UploadToStorageOptions {
  /** Which bucket to upload into. Default: "documents". */
  bucket?: "documents" | "archives";
  bytes: Blob | Uint8Array | ArrayBuffer;
  mimeType?: string;
}

/**
 * Upload bytes to the tenant-scoped folder and return the object path
 * (storageId). Throws on any failure.
 */
export async function uploadToStorage(
  opts: UploadToStorageOptions,
): Promise<{ storageId: string }> {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error("Storage is not configured.");

  const { data: folder, error: folderError } = await supabase.rpc(
    "documents_upload_folder",
  );
  if (folderError || !folder) {
    throw new Error(folderError?.message ?? "Could not allocate upload folder.");
  }

  const path = `${String(folder)}/${crypto.randomUUID()}`;
  const { error: uploadError } = await supabase.storage
    .from(opts.bucket ?? "documents")
    .upload(path, opts.bytes, {
      contentType: opts.mimeType || "application/octet-stream",
    });
  if (uploadError) throw uploadError;

  return { storageId: path };
}
