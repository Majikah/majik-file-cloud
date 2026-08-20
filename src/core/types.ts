/**
 * core/types.ts
 *
 */

import type {
  MajikFileJSON,
  MajikFileCreateOptions,
  MajikFileStats,
} from "@majikah/majik-file";

// ─── Domain Types ─────────────────────────────────────────────────────────────

export type StorageType = "permanent" | "temporary";

/** Allowed TTLs for temporary files in days. Maps 1:1 to R2 lifecycle prefixes. */
export type TempFileDuration = 1 | 2 | 3 | 5 | 7 | 15;

/** MajikFileCloud's kind discriminator — see MajikFileKind in base.ts. */
export type MajikFileCloudKind = "message_file";

// ─── MajikFileCloudJSON ─────────────────────────────────────────────────────

/**
 * Serialised representation of a MajikFileCloud. Extends the base
 * MajikFileJSON with everything storage/messaging-specific. Maps 1-to-1
 * with the `majikah.majik_files` Supabase table.
 */
export interface MajikFileCloudJSON extends Omit<MajikFileJSON, "kind"> {
  kind: string;
  /** R2 object key — unique path within the bucket. */
  r2_key: string;
  storage_type: StorageType;
  is_shared: boolean;
  /** Opaque token for shareable public links. Only meaningful when is_shared. */
  share_token: string | null;
  /** Optional reference id */
  reference_id: string | null;

  /** ISO-8601 expiry timestamp. Required for temporary files. */
  expires_at: string | null;
}

// ─── MajikFileCloudCreateOptions ────────────────────────────────────────────

export interface MajikFileCloudCreateOptions extends MajikFileCreateOptions {
  /**
   * If true, the file is stored under the temporary R2 prefix and
   * auto-deleted by the bucket lifecycle policy. Requires expiresAt.
   * @default false
   */
  isTemporary?: boolean;
  /** If true, a share_token can be generated to allow public access. @default false */
  isShared?: boolean;
  /** Temporary file duration in days. Required when isTemporary = true. */
  expiresAt?: TempFileDuration;
  referenceId?: string;
}

// ─── MajikFileCloudStats ─────────────────────────────────────────────────────

export interface MajikFileCloudStats extends MajikFileStats {
  storageType: StorageType;
  isShared: boolean;
  isExpired: boolean;
  expiresAt: string | null;
  r2Key: string;
}
