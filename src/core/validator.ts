/**
 * majik-message-file-validator.ts
 *
 * Validation rules specific to MajikMessageFile — context, storage type,
 * conversation/thread binding, storage-key (R2) shape. Same check/assert
 * dual-mode pattern as MajikFileValidator; composes it rather than
 * extending it, since these rules apply to a different layer of the data
 * (subclass-only fields), not a specialisation of the base rules.
 */

import { MajikFileError, MajikFileValidator } from "@majikah/majik-file";
import { StorageType } from "./types";

export class MajikFileCloudValidator {
  /** Re-exported so callers only need to import one validator for aggregation. */
  static assertAll = MajikFileValidator.assertAll;

  // ── storage type / expiry ───────────────────────────────────────────────

  static checkStorageType(type: unknown): string | null {
    return type === "permanent" || type === "temporary"
      ? null
      : `storage_type must be "permanent" or "temporary" (got "${type}")`;
  }
  static assertStorageType(type: unknown): void {
    const err = this.checkStorageType(type);
    if (err) throw MajikFileError.invalidInput(err);
  }

  static checkExpiresAtRequired(
    storageType: StorageType,
    expiresAt: string | null,
  ): string | null {
    return storageType === "temporary" && !expiresAt
      ? "expires_at is required for temporary files"
      : null;
  }
  static assertExpiresAtRequired(
    storageType: StorageType,
    expiresAt: string | null,
  ): void {
    const err = this.checkExpiresAtRequired(storageType, expiresAt);
    if (err) throw MajikFileError.invalidInput(err);
  }

  // ── storage key (R2) shape ──────────────────────────────────────────────

  /**
   * Platform-neutral name/behaviour — checks that a storage key starts with
   * the prefix expected for its storage class. Throws storageKeyMismatch()
   * rather than invalidInput() so callers can distinguish "malformed input"
   * from "data structurally inconsistent with its own metadata."
   */
  static checkStorageKeyPrefix(
    storageKey: string,
    expectedPrefix: string,
    label: string,
  ): string | null {
    return storageKey.startsWith(expectedPrefix)
      ? null
      : `${label} must start with "${expectedPrefix}"`;
  }
  static assertStorageKeyPrefix(
    storageKey: string,
    expectedPrefix: string,
    label: string,
  ): void {
    const err = this.checkStorageKeyPrefix(storageKey, expectedPrefix, label);
    if (err) throw MajikFileError.storageKeyMismatch(err);
  }
}
