/**
 * core/utils.ts
 *
 * Helpers specific to MajikFileCloud — R2 key construction and temporary-
 * file expiry. None of this belongs in the base MajikFile; a generic file
 * doesn't inherently know what "temporary storage" or an R2 bucket is.
 *
 */

import type { TempFileDuration } from "./types";

export const MAJIK_FILE_CLOUD_NAMESPACE = "5d822315-68c9-56c3-9a63-8f130d17009a";

export const R2_PREFIX = {
  /** ⚠️ inferred — confirm against real constants.ts */
  PERMANENT: "files/permanent",
  /** ⚠️ inferred — confirm against real constants.ts */
  TEMPORARY: "files/public",
} as const;

// ─── R2 key builders ────────────────────────────────────────────────────────

export function buildPermanentR2Key(userId: string, fileHash: string): string {
  return `${R2_PREFIX.PERMANENT}/${userId}/${fileHash}.mjkb`;
}

/**
 * ⚠️ Duration-scoped subfolder is inferred (useful for R2 lifecycle rules
 * keyed per-TTL) — confirm this matches your actual temporary key layout.
 */
export function buildTemporaryR2Key(
  userId: string,
  fileHash: string,
  duration: TempFileDuration,
): string {
  return `${R2_PREFIX.TEMPORARY}/${duration}d/${userId}/${fileHash}.mjkb`;
}


// ─── Expiry ───────────────────────────────────────────────────────────────────

export function buildExpiryDate(days: TempFileDuration = 15): string {
  const ms = days * 24 * 60 * 60 * 1000;
  return new Date(Date.now() + ms).toISOString();
}

export function isExpired(expiresAt: string | null): boolean {
  if (!expiresAt) return false;
  return new Date(expiresAt).getTime() <= Date.now();
}
