import {
  generateUUID,
  inferMimeTypeFromFilename,
  convertImageToWebP,
  arrayToBase64,
  MajikFile,
  MajikFileValidator,
  MajikFileError,
  FILE_SCHEMA_VERSION,
  CRYPTO_SUITE,
  MajikFileIdentity,
  MajikFileRecipient,
  MajikFileJSON,
} from "@majikah/majik-file";
import {
  R2_PREFIX,
  buildPermanentR2Key,
  buildTemporaryR2Key,
  buildExpiryDate,
  isExpired,
  MAJIK_FILE_CLOUD_NAMESPACE,
} from "./core/utils";
import type {
  StorageType,
  TempFileDuration,
  MajikFileCloudJSON,
  MajikFileCloudCreateOptions,
  MajikFileCloudStats,
} from "./core/types";
import { v5 as uuidv5 } from "uuid";

import type { MajikKey } from "@majikah/majik-key";
import { MajikFileCloudValidator } from "./core/validator";

/**
 * MajikFileCloud
 * ----------------
 * The Majikah-messaging MajikFile: everything storage/context/binding
 * related. Composes the base crypto pipeline (`_encryptCore()`) rather
 * than inheriting `create()` — this class has its own extra fields to
 * layer on afterward. See MajikFile's class-level doc comment for the
 * extensibility design (hooks, sealing, versioning).
 *
 * ⚠️ R2_PREFIX values in core/message/message-utils.ts are partially
 * inferred, not confirmed — see that file's header comment.
 */
export class MajikFileCloud extends MajikFile {
  protected _r2Key: string;
  protected _storageType: StorageType;
  protected _isShared: boolean;
  protected _shareToken: string | null;
  protected _referenceId: string | null;
  protected _expiresAt: string | null;

  protected constructor(
    json: MajikFileCloudJSON,
    binary: Uint8Array | null,
    isGroup: boolean,
  ) {
    super(json, binary, isGroup);
    this._r2Key = json.r2_key;
    this._storageType = json.storage_type;
    this._isShared = json.is_shared;
    this._shareToken = json.share_token;
    this._referenceId = json.reference_id;
    this._expiresAt = json.expires_at;
  }

  // ── Getters ───────────────────────────────────────────────────────────────

  get r2Key(): string {
    return this._r2Key;
  }
  get storageType(): StorageType {
    return this._storageType;
  }
  get isShared(): boolean {
    return this._isShared;
  }
  get shareToken(): string | null {
    return this._shareToken;
  }

  get referenceId(): string | null {
    return this._referenceId;
  }

  get expiresAt(): string | null {
    return this._expiresAt;
  }
  get hasShareToken(): boolean {
    return this._shareToken !== null && this._shareToken.length > 0;
  }
  get isExpired(): boolean {
    return isExpired(this._expiresAt);
  }
  get isTemporary(): boolean {
    return this._storageType === "temporary";
  }

  // ── CREATE ────────────────────────────────────────────────────────────────

  static async create(
    options: MajikFileCloudCreateOptions,
  ): Promise<MajikFileCloud> {
    const {
      data,
      identity,
      recipients = [],
      originalName = null,
      mimeType: rawMimeType = null,
      isTemporary = false,
      isShared = false,
      bypassSizeLimit = false,
      expiresAt,
      referenceId = null,
      userId,
      compressionLevel,
    } = options;

    MajikFileValidator.assertUserId(userId);
    if (!identity) throw MajikFileError.invalidInput("identity is required");

    if (isTemporary && !expiresAt) {
      throw MajikFileError.invalidInput(
        "expiresAt is required for temporary files. Use MajikFileCloud.buildExpiryDate() to generate one.",
      );
    }

    const mimeType =
      rawMimeType ??
      (originalName ? inferMimeTypeFromFilename(originalName) : null);

    // `this` here is MajikFileCloud (static method invoked on this
    // class), so _encryptCore's internal `this._preProcess(...)` call
    // dispatches to the override above — see MajikFile's class doc.
    const core = await this._encryptCore({
      data,
      identity,
      recipients,
      originalName,
      mimeType,
      bypassSizeLimit,
      compressionLevel,
    });

    let r2Key: string;
    if (isTemporary) {
      r2Key = buildTemporaryR2Key(userId, core.fileHash, expiresAt!);
    } else {
      r2Key = buildPermanentR2Key(userId, core.fileHash);
    }

    const genID = uuidv5(
      `${userId}:${core.fileHash}`,
      MAJIK_FILE_CLOUD_NAMESPACE,
    );
    const now = new Date().toISOString();
    const json: MajikFileCloudJSON = {
      id: genID,
      schema_version: FILE_SCHEMA_VERSION,
      kind: "majik_file_cloud",
      user_id: userId,
      original_name: originalName,
      mime_type: core.resolvedMimeType,
      size_original: core.sizeOriginal,
      size_stored: core.sizeStored,
      file_hash: core.fileHash,
      encryption_iv: core.ivHex,
      participants: core.participants,
      kem_alg: CRYPTO_SUITE.kemAlg,
      cipher_alg: CRYPTO_SUITE.cipherAlg,
      timestamp: now,
      last_update: now,
      signature: null,
      r2_key: r2Key,
      storage_type: isTemporary ? "temporary" : "permanent",
      is_shared: isShared,
      share_token: null,
      reference_id: referenceId,
      expires_at: isTemporary ? buildExpiryDate(expiresAt) : null,
    };

    const instance = new MajikFileCloud(json, core.binary, core.isGroup);
    instance._validateCreate();
    return instance._sealInstance();
  }

  static async createAndSign(
    options: MajikFileCloudCreateOptions,
    key: MajikKey,
    signOptions?: { contentType?: string; timestamp?: string },
  ): Promise<MajikFileCloud> {
    const file = await MajikFileCloud.create(options);
    await file.sign(key, signOptions);
    return file;
  }

  // ── QUICK-CREATE WRAPPERS ─────────────────────────────────────────────────

  static async createUserUpload(options: {
    data: Uint8Array | ArrayBuffer;
    userId: string;
    identity: MajikFileIdentity;
    originalName?: string;
    mimeType?: string;
    isShared?: boolean;
    recipients?: MajikFileRecipient[];
    referenceId?: string;
  }): Promise<MajikFileCloud> {
    return MajikFileCloud.create({
      data: options.data,
      userId: options.userId,
      identity: options.identity,
      originalName: options.originalName,
      mimeType: options.mimeType,
      isShared: options.isShared ?? false,
      recipients: options.recipients ?? [],
      isTemporary: false,
      referenceId: options?.referenceId,
    });
  }

  /** @param duration Days until expiry. Defaults to 15. */
  static async createTemporaryUpload(options: {
    data: Uint8Array | ArrayBuffer;
    userId: string;
    identity: MajikFileIdentity;
    originalName?: string;
    mimeType?: string;
    duration?: TempFileDuration;
    recipients?: MajikFileRecipient[];
    referenceId?: string;
  }): Promise<MajikFileCloud> {
    const duration = options.duration ?? 15;
    return MajikFileCloud.create({
      data: options.data,
      userId: options.userId,
      identity: options.identity,
      referenceId: options?.referenceId,
      originalName: options.originalName,
      mimeType: options.mimeType,
      recipients: options.recipients ?? [],
      isTemporary: true,
      expiresAt: duration,
    });
  }

  // ── STORAGE TYPE MUTATION ─────────────────────────────────────────────────

  setStorageType(
    type: StorageType,
    expiresAt: string | null,
    duration: TempFileDuration = 15,
  ): void {
    MajikFileCloudValidator.assertStorageType(type);
    if (type === "temporary" && !expiresAt) {
      throw MajikFileError.invalidInput(
        "setStorageType: expiresAt is required when switching to temporary. Use setTemporary(days?) instead.",
      );
    }

    const newR2Key =
      type === "temporary"
        ? buildTemporaryR2Key(this._userId, this._fileHash, duration)
        : buildPermanentR2Key(this._userId, this._fileHash);

    this._storageType = type;
    this._expiresAt = type === "temporary" ? expiresAt : null;
    this._r2Key = newR2Key;
    this._lastUpdate = new Date().toISOString();
  }

  setPermanent(): void {
    this.setStorageType("permanent", null);
  }

  /** @param duration Days until expiry. Must be one of: 1 | 2 | 3 | 5 | 7 | 15. Defaults to 15. */
  setTemporary(duration: TempFileDuration = 15): void {
    this.setStorageType("temporary", buildExpiryDate(duration), duration);
  }

  // ── SHARING ───────────────────────────────────────────────────────────────

  /**
   * Toggle shareable state. OFF→ON assigns a token (auto-generated if
   * omitted); ON→OFF clears it. Returns the active token, or null if
   * sharing was disabled.
   */
  toggleSharing(token?: string): string | null {
    if (this._isShared) {
      this._isShared = false;
      this._shareToken = null;
      this._lastUpdate = new Date().toISOString();
      return null;
    }
    if (token !== undefined && !token.trim()) {
      throw MajikFileError.invalidInput(
        "toggleSharing: token must be a non-empty string when provided",
      );
    }
    this._isShared = true;
    this._shareToken = token?.trim() ?? generateUUID();
    this._lastUpdate = new Date().toISOString();
    return this._shareToken;
  }

  // ── SERIALISATION ─────────────────────────────────────────────────────────

  toJSON(): MajikFileCloudJSON {
    const base = super.toJSON();
    return {
      ...base,
      kind: "message_file",
      r2_key: this._r2Key,
      storage_type: this._storageType,
      is_shared: this._isShared,
      share_token: this._shareToken,
      reference_id: this.referenceId,
      expires_at: this._expiresAt,
    };
  }

  toDangerousJSON(): MajikFileCloudJSON & {
    decrypted_base64: string | null;
  } {
    return {
      ...this.toJSON(),
      decrypted_base64: this.decryptedFile
        ? arrayToBase64(this.decryptedFile)
        : null,
    };
  }

  validate(): void {
    const errors = this._collectErrors();
    const push = (err: string | null) => {
      if (err) errors.push(err);
    };

    push(MajikFileCloudValidator.checkStorageType(this._storageType));
    push(
      MajikFileCloudValidator.checkExpiresAtRequired(
        this._storageType,
        this._expiresAt,
      ),
    );

    MajikFileCloudValidator.assertAll(errors);
  }

  /**
   * Stricter validation used only during create() — includes R2 prefix
   * checks against the file's declared storage class.
   */
  private _validateCreate(): void {
    this.validate();

    const errors: string[] = [];
    const permanentPrefix = `${R2_PREFIX.PERMANENT}/${this._userId}/`;
    const temporaryPrefix = `${R2_PREFIX.TEMPORARY}/`;

    if (this._storageType === "permanent") {
      const err = MajikFileCloudValidator.checkStorageKeyPrefix(
        this._r2Key,
        permanentPrefix,
        "r2_key for permanent files",
      );
      if (err) errors.push(err);
    } else if (this._storageType === "temporary") {
      const err = MajikFileCloudValidator.checkStorageKeyPrefix(
        this._r2Key,
        temporaryPrefix,
        "r2_key for temporary files",
      );
      if (err) errors.push(err);
    }

    if (errors.length > 0) throw MajikFileError.validationFailed(errors);
  }

  /**
   * True if `json` carries the majik-file-cloud fields (r2_key, context, etc.)
   * on top of the base MajikFileJSON shape.
   */
  static isCloudJSON(json: unknown): json is MajikFileCloudJSON {
    return (
      json != null &&
      typeof json === "object" &&
      "r2_key" in (json as Record<string, unknown>) &&
      "storage_type" in (json as Record<string, unknown>)
    );
  }

  /**
   * Restore a MajikFileCloud from its serialised JSON — auto-detects and
   * transparently migrates legacy (pre-refactor) rows via fromLegacyJSON().
   * Callers never need to know a row's age.
   *
   * Parameter type is deliberately widened to `MajikFileJSON` (the base
   * type) rather than narrowed to `MajikFileCloudJSON` in the signature —
   * TypeScript requires a subclass's static method parameters to be
   * contravariant with the base class's (accept at least what the base
   * accepts), so narrowing here would make `typeof MajikFileCloud`
   * structurally incompatible with `typeof MajikFile`. The actual
   * message-shape check happens at runtime via isCloudJSON() below.
   */
  static fromJSON(
    json: MajikFileJSON | MajikFileCloudJSON,
    binary?: Uint8Array | ArrayBuffer | null,
  ): MajikFileCloud {
    if (!json || typeof json !== "object") {
      throw MajikFileError.invalidInput(
        "fromJSON: json must be a non-null object",
      );
    }

    if (!MajikFileCloud.isCloudJSON(json)) {
      throw MajikFileError.invalidInput(
        "fromJSON: json does not look like a MajikFileCloudJSON record " +
          "(missing r2_key/storage_type) — did you mean to call MajikFile.fromJSON() instead?",
      );
    }

    const current = json; // narrowed to MajikFileCloudJSON by the guard above
    MajikFileValidator.assertSchemaVersion(
      current.schema_version,
      FILE_SCHEMA_VERSION,
    );

    const binaryBytes =
      binary != null
        ? binary instanceof Uint8Array
          ? binary
          : new Uint8Array(binary)
        : null;
    const isGroup = MajikFileCloud._detectIsGroupFromBinary(binaryBytes);

    const instance = new MajikFileCloud(current, binaryBytes, isGroup);
    instance.validate();
    return instance._sealInstance();
  }

  /** Same parameter-widening rationale as fromJSON() above — see its doc comment. */
  static async fromJSONWithBlob(
    json: MajikFileJSON,
    binary: Blob,
  ): Promise<MajikFileCloud> {
    const bytes = new Uint8Array(await binary.arrayBuffer());
    return MajikFileCloud.fromJSON(json, bytes);
  }

  // ── STATS ─────────────────────────────────────────────────────────────────

  getStats(): MajikFileCloudStats {
    const base = super.getStats();
    return {
      ...base,
      storageType: this._storageType,
      isShared: this._isShared,
      isExpired: this.isExpired,
      expiresAt: this._expiresAt,
      r2Key: this._r2Key,
    };
  }
}
