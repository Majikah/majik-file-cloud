// majik-file-cloud.test.ts
//
// Refactored unit tests for the MajikFileCloud subclass.
// These tests exercise storage routing, sharing, storage type mutations,
// and serialization for general cloud storage files.
//
// ALL CRYPTO IS REAL. Zero mocks are used. MajikFile inheritance and
// @noble/post-quantum (ML-KEM-768) implementations run purely in reality.
//
// ─────────────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeAll } from "vitest";

import { MajikFileCloud } from "../src/majik-file-cloud";
import {
  MajikFileError,
  FILE_SCHEMA_VERSION,
  CRYPTO_SUITE,
  type MajikFileIdentity,
  type MajikFileRecipient,
} from "@majikah/majik-file";
import type { MajikFileCloudJSON } from "../src/core/types";

import type { MajikKey } from "@majikah/majik-key";
import { getTestKey } from "./helpers/crypto";

const CRYPTO_TIMEOUT = 60_000;

// ── TEST HELPERS ─────────────────────────────────────────────────────────────

interface TestFileUser {
  identity: MajikFileIdentity;
  recipient: MajikFileRecipient;
}

/** Generates real ML-KEM-768 identities and recipients */
async function createTestFileUser(): Promise<TestFileUser> {
  const keys = await getTestKey();
  return {
    identity: {
      publicKey: keys.publicKeyBase64,
      fingerprint: keys.fingerprint,
      mlKemPublicKey: keys.mlKemPublicKey,
      mlKemSecretKey: keys.mlKemSecretKey!,
    },
    recipient: {
      fingerprint: keys.fingerprint,
      publicKey: keys.publicKeyBase64,
      mlKemPublicKey: keys.mlKemPublicKey,
    },
  };
}

const DUMMY_DATA = new TextEncoder().encode(
  "Hello, Majikah Cloud! This payload is encrypted via post-quantum crypto.",
);
const USER_ID = "auth-user-alice-uuid-12345";

// ── TEST SUITE ───────────────────────────────────────────────────────────────

describe("MajikFileCloud Class Unit Tests", () => {
  let alice: TestFileUser;
  let bob: TestFileUser;
  let signerKeyA: MajikKey;

  beforeAll(async () => {
    [alice, bob, signerKeyA] = await Promise.all([
      createTestFileUser(),
      createTestFileUser(),
      getTestKey(),
    ]);
  }, CRYPTO_TIMEOUT * 5);

  // ── 1. CREATE() VALIDATION ───────────────────────────────────────────────
  describe("create() — input validation", () => {
    it("should reject when userId is missing", async () => {
      await expect(
        MajikFileCloud.create({
          data: DUMMY_DATA,
          userId: "   ",
          identity: alice.identity,
        }),
      ).rejects.toThrow(/userId is required/i);
    });

    it("should reject isTemporary without expiresAt", async () => {
      await expect(
        MajikFileCloud.create({
          data: DUMMY_DATA,
          userId: USER_ID,
          identity: alice.identity,
          isTemporary: true,
          expiresAt: undefined,
        }),
      ).rejects.toThrow(/expiresAt is required for temporary files/i);
    });
  });

  // ── 2. QUICK-CREATE WRAPPERS ─────────────────────────────────────────────
  describe("Quick-create wrappers", () => {
    it(
      "createUserUpload() should succeed and respect isShared and referenceId",
      async () => {
        const file = await MajikFileCloud.createUserUpload({
          data: DUMMY_DATA,
          userId: USER_ID,
          identity: alice.identity,
          originalName: "notes.txt",
          isShared: true,
          referenceId: "ext-ref-999",
        });

        expect(file.storageType).toBe("permanent");
        expect(file.isShared).toBe(true);
        expect(file.referenceId).toBe("ext-ref-999");
      },
      CRYPTO_TIMEOUT,
    );

    it(
      "createTemporaryUpload() should default to a 15-day duration",
      async () => {
        const file = await MajikFileCloud.createTemporaryUpload({
          data: DUMMY_DATA,
          userId: USER_ID,
          identity: alice.identity,
        });
        expect(file.storageType).toBe("temporary");
        expect(file.expiresAt).not.toBeNull();

        const days =
          (new Date(file.expiresAt!).getTime() - Date.now()) /
          (1000 * 60 * 60 * 24);
        expect(days).toBeGreaterThan(14.9);
        expect(days).toBeLessThan(15.1);
      },
      CRYPTO_TIMEOUT,
    );

    it(
      "createTemporaryUpload() should respect a custom duration",
      async () => {
        const file = await MajikFileCloud.createTemporaryUpload({
          data: DUMMY_DATA,
          userId: USER_ID,
          identity: alice.identity,
          duration: 3,
        });
        const days =
          (new Date(file.expiresAt!).getTime() - Date.now()) /
          (1000 * 60 * 60 * 24);
        expect(days).toBeGreaterThan(2.9);
        expect(days).toBeLessThan(3.1);
      },
      CRYPTO_TIMEOUT,
    );
  });

  // ── 3. STORAGE TYPE, SHARING, EXPIRY ─────────────────────────────────────
  describe("Storage type mutation, sharing, and expiry", () => {
    it(
      "setTemporary() / setPermanent() should toggle storage type and R2 key",
      async () => {
        const file = await MajikFileCloud.create({
          data: DUMMY_DATA,
          userId: USER_ID,
          identity: alice.identity,
        });
        expect(file.storageType).toBe("permanent");
        const permKey = file.r2Key;

        file.setTemporary(7);
        expect(file.storageType).toBe("temporary");
        expect(file.r2Key).not.toBe(permKey);
        expect(file.expiresAt).not.toBeNull();

        file.setPermanent();
        expect(file.storageType).toBe("permanent");
        expect(file.expiresAt).toBeNull();
      },
      CRYPTO_TIMEOUT,
    );

    it(
      "toggleSharing() should turn sharing on (auto token) and off (clears token)",
      async () => {
        const file = await MajikFileCloud.create({
          data: DUMMY_DATA,
          userId: USER_ID,
          identity: alice.identity,
        });
        expect(file.hasShareToken).toBe(false);

        const token = file.toggleSharing();
        expect(token).toBeTruthy();
        expect(file.isShared).toBe(true);
        expect(file.hasShareToken).toBe(true);

        const cleared = file.toggleSharing();
        expect(cleared).toBeNull();
        expect(file.isShared).toBe(false);
        expect(file.hasShareToken).toBe(false);
      },
      CRYPTO_TIMEOUT,
    );

    it(
      "toggleSharing() should accept an explicit token and reject a blank one",
      async () => {
        const file = await MajikFileCloud.create({
          data: DUMMY_DATA,
          userId: USER_ID,
          identity: alice.identity,
        });
        const token = file.toggleSharing("custom-token-abc");
        expect(token).toBe("custom-token-abc");

        file.toggleSharing(); // turn off
        expect(() => file.toggleSharing("   ")).toThrow(
          /token must be a non-empty string/i,
        );
      },
      CRYPTO_TIMEOUT,
    );

    it("isExpired / isTemporary should strictly reflect the stored expiry date", () => {
      const baseJson: MajikFileCloudJSON = {
        id: "id-1",
        schema_version: FILE_SCHEMA_VERSION,
        kind: "majik_file_cloud",
        user_id: USER_ID,
        r2_key: "files/public/15/x_y.mjkb",
        original_name: null,
        mime_type: null,
        size_original: 10,
        size_stored: 20,
        file_hash: "abc",
        encryption_iv: "abc",
        kem_alg: CRYPTO_SUITE.kemAlg,
        cipher_alg: CRYPTO_SUITE.cipherAlg,
        is_shared: false,
        share_token: null,
        reference_id: null,
        participants: [],
        timestamp: new Date().toISOString(),
        last_update: new Date().toISOString(),
        signature: null,
        storage_type: "permanent",
        expires_at: null,
      };

      const expired = MajikFileCloud.fromJSON({
        ...baseJson,
        storage_type: "temporary",
        expires_at: new Date(Date.now() - 1000).toISOString(),
      });
      expect(expired.isExpired).toBe(true);
      expect(expired.isTemporary).toBe(true);

      const notExpired = MajikFileCloud.fromJSON({
        ...baseJson,
        storage_type: "temporary",
        expires_at: new Date(Date.now() + 1_000_000).toISOString(),
      });
      expect(notExpired.isExpired).toBe(false);

      const permanent = MajikFileCloud.fromJSON({
        ...baseJson,
        storage_type: "permanent",
        expires_at: null,
      });
      expect(permanent.isExpired).toBe(false);
      expect(permanent.isTemporary).toBe(false);
    });
  });

  // ── 4. SERIALIZATION: toJSON() / fromJSON() ──────────
  describe("Serialization", () => {
    let originalFile: MajikFileCloud;

    beforeAll(async () => {
      originalFile = await MajikFileCloud.create({
        data: DUMMY_DATA,
        userId: USER_ID,
        identity: alice.identity,
        originalName: "backup-archive.zip",
        mimeType: "application/zip",
        referenceId: "archive-ref-42",
      });
    }, CRYPTO_TIMEOUT);

    it("toJSON() should yield a complete MajikFileCloudJSON structure", () => {
      const json = originalFile.toJSON();
      expect(json.kind).toBe("message_file");
      expect(json.r2_key).toBeDefined();
      expect(json.storage_type).toBe("permanent");
      expect(json.is_shared).toBe(false);
      expect(json.reference_id).toBe("archive-ref-42");
      expect(json.schema_version).toBe(FILE_SCHEMA_VERSION);
    });

    it("fromJSON() should hydrate a metadata-only MajikFileCloud", () => {
      const restored = MajikFileCloud.fromJSON(originalFile.toJSON());
      expect(restored).toBeInstanceOf(MajikFileCloud);
      expect(restored.hasBinary).toBe(false);
      expect(restored.referenceId).toBe("archive-ref-42");
    });

    it("fromJSON() should reject invalid row records", () => {
      const badJson = { ...originalFile.toJSON(), user_id: "" };
      expect(() => MajikFileCloud.fromJSON(badJson as any)).toThrow(
        MajikFileError,
      );
    });
  });

  // ── 5. CRYPTO INHERITANCE (Sanity Checks) ──────────────────────────────
  describe("Cryptography & Base inheritance bounds (sanity checks)", () => {
    it(
      "should decrypt and retrieve original bytes utilizing real keys",
      async () => {
        const file = await MajikFileCloud.create({
          data: DUMMY_DATA,
          userId: USER_ID,
          identity: alice.identity,
          recipients: [bob.recipient],
        });

        expect(file.isGroup).toBe(true);

        const decryptedAlice = await file.decryptBinary(alice.identity);
        const decryptedBob = await file.decryptBinary(bob.identity);

        expect(new TextDecoder().decode(decryptedAlice)).toBe(
          "Hello, Majikah Cloud! This payload is encrypted via post-quantum crypto.",
        );
        expect(new TextDecoder().decode(decryptedBob)).toBe(
          "Hello, Majikah Cloud! This payload is encrypted via post-quantum crypto.",
        );
      },
      CRYPTO_TIMEOUT,
    );

    it(
      "getStats() should append cloud-specific statistics",
      async () => {
        const file = await MajikFileCloud.create({
          data: DUMMY_DATA,
          userId: USER_ID,
          identity: alice.identity,
        });
        const stats = file.getStats();
        expect(stats.storageType).toBe("permanent");
        expect(stats.r2Key).toContain("files/");
        expect(stats.isShared).toBe(false);
        expect(stats.isExpired).toBe(false);
      },
      CRYPTO_TIMEOUT,
    );
  });
});
