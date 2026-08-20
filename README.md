# Majik File Cloud

[![Developed by Zelijah](https://img.shields.io/badge/Developed%20by-Zelijah-red?logo=github&logoColor=white)](https://thezelijah.world) ![GitHub Sponsors](https://img.shields.io/github/sponsors/jedlsf?style=plastic&label=Sponsors&link=https%3A%2F%2Fgithub.com%2Fsponsors%2Fjedlsf)

[![Static Badge](https://img.shields.io/badge/IANA-vnd.majikah.bundle-green)](https://www.iana.org/assignments/media-types/application/vnd.majikah.bundle)

**Cloud-native post-quantum file encryption for Majikah.** `MajikFileCloud` is the storage-aware subclass of [`MajikFile`](https://www.npmjs.com/package/@majikah/majik-file) — it adds R2 routing, public sharing features, and temporary-file expiry on top of the same `.mjkb` cryptographic pipeline, without duplicating a single line of crypto logic.

> **Note on Architecture:** This package does **not** implement encryption, compression, or the `.mjkb` binary codec — that all lives in the platform-agnostic [`@majikah/majik-file`](https://www.npmjs.com/package/@majikah/majik-file) base class, which this package depends on and extends. If you need generic file encryption with no storage concepts attached, use `MajikFile` directly instead.

![npm](https://img.shields.io/npm/v/@majikah/majik-file-cloud) ![npm downloads](https://img.shields.io/npm/dm/@majikah/majik-file-cloud) ![npm bundle size](https://img.shields.io/bundlephobia/min/%40majikah%2Fmajik-file-cloud) [![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0) ![TypeScript](https://img.shields.io/badge/TypeScript-Ready-blue)

---

## Contents

- [Majik File Cloud](#majik-file-cloud)
  - [Contents](#contents)
  - [Why a subclass](#why-a-subclass)
  - [R2 key routing](#r2-key-routing)
  - [Installation](#installation)
  - [Quick start](#quick-start)
    - [User upload (permanent)](#user-upload-permanent)
    - [Temporary upload](#temporary-upload)
    - [Decrypting](#decrypting)
  - [Storage type \& sharing](#storage-type--sharing)
  - [API reference](#api-reference)
    - [`MajikFileCloud.create(options)`](#majikfilecloudcreateoptions)
    - [Quick-create wrappers](#quick-create-wrappers)
    - [Instance methods](#instance-methods)
    - [Instance getters](#instance-getters)
  - [Type reference](#type-reference)
    - [`MajikFileCloudJSON`](#majikfilecloudjson)
    - [`TempFileDuration`](#tempfileduration)
  - [Validation \& errors](#validation--errors)
  - [Storage model](#storage-model)
  - [Relationship to `MajikFile`](#relationship-to-majikfile)
  - [Related Projects](#related-projects)
    - [Majik Message](#majik-message)
    - [Majik File](#majik-file)
    - [Majik Key](#majik-key)
    - [Majik Envelope](#majik-envelope)
  - [Contributing](#contributing)
  - [License](#license)
  - [Author](#author)
  - [Contact](#contact)

---

## Why a subclass

Everything cryptographic — hashing, compression policy, ML-KEM-768 encapsulation, AES-256-GCM sealing, `.mjkb` encoding/decoding, signing, zeroization — is owned entirely by `MajikFile`. `MajikFileCloud` never re-implements or forks any of it. Instead it **composes** the base pipeline through `MajikFile._encryptCore()` and layers on exactly the fields a cloud storage platform needs:

- Where the encrypted binary is stored (R2 key, storage type, expiry)
- Optional external reference IDs for linking to external databases
- Whether it's publicly shareable via secure tokens

This keeps the base library reusable by any platform, while this package stays free to evolve storage and routing concerns independently.

---

## R2 key routing

`create()` picks the object key automatically based on the chosen storage type:

```
isTemporary === true       → files/public/<duration>d/<userId>/<fileHash>.mjkb
otherwise (permanent)      → files/permanent/<userId>/<fileHash>.mjkb
```

---

## Installation

```bash
npm install @majikah/majik-file-cloud @majikah/majik-file
```

`@majikah/majik-file` is a peer dependency — `MajikFileCloud` extends `MajikFile` directly, so both packages need to resolve to compatible versions. 

---

## Quick start

### User upload (permanent)

```typescript
import { MajikFileCloud } from '@majikah/majik-file-cloud'

const majikFile = await MajikFileCloud.createUserUpload({
  data: fileBytes,
  userId: 'user-uuid',
  identity,                        // MajikFileIdentity from your key store
  originalName: 'notes.txt',
  isShared: false,
  referenceId: 'ext-ref-123',
})

const blob = majikFile.toMJKB()     // upload to R2 at majikFile.r2Key
const metadata = majikFile.toJSON() // insert into Supabase
```

### Temporary upload

```typescript
const majikFile = await MajikFileCloud.createTemporaryUpload({
  data: fileBytes,
  userId: 'user-uuid',
  identity,
  duration: 7, // days — one of 1, 2, 3, 5, 7, 15. Defaults to 15.
})

majikFile.isExpired   // false, until expiresAt passes
majikFile.expiresAt   // ISO-8601 string
```

Temporary files route to `files/public/` and are expected to be swept by an R2 lifecycle policy after the chosen duration.

### Decrypting

Decryption is entirely inherited from `MajikFile` — nothing cloud-specific about it:

```typescript
const { bytes, originalName, mimeType } = await MajikFileCloud.decryptWithMetadata(
  mjkbBlob,
  { fingerprint: identity.fingerprint, mlKemSecretKey: identity.mlKemSecretKey }
)
```

See the [`MajikFile` README](https://www.npmjs.com/package/@majikah/majik-file) for `decrypt()`, `decryptHydrate()`, `batchDecrypt()`, signing, and verification.

---

## Storage type & sharing

```typescript
majikFile.setTemporary(7)   // switch to temporary, 7-day expiry, recomputes r2Key
majikFile.setPermanent()    // switch back to permanent, clears expiresAt, recomputes r2Key

const token = majikFile.toggleSharing()        // enable sharing, auto-generated token
majikFile.toggleSharing()                      // call again to disable — returns null
```

---

## API reference

### `MajikFileCloud.create(options)`

```typescript
static async create(options: MajikFileCloudCreateOptions): Promise<MajikFileCloud>
```

`MajikFileCloudCreateOptions` extends the base `MajikFileCreateOptions` (`data`, `userId`, `identity`, `recipients?`, `originalName?`, `mimeType?`, `id?`, `bypassSizeLimit?`, `compressionLevel?`) with:

| Field         | Type               | Required | Description                                     |
| ------------- | ------------------ | -------- | ----------------------------------------------- |
| `isTemporary` | `boolean`          | —        | Default `false`. Requires `expiresAt` if `true` |
| `isShared`    | `boolean`          | —        | Default `false`                                 |
| `expiresAt`   | `TempFileDuration` | —        | Days until expiry. Required when `isTemporary`  |
| `referenceId` | `string`           | —        | Optional reference id for external systems      |

Throws `MajikFileError("VALIDATION_FAILED")` if the resulting R2 key doesn't match the expected prefix for its declared storage class.

### Quick-create wrappers

Thin, narrower-typed convenience wrappers around `create()`:

| Method                           | Notes                                                   |
| -------------------------------- | ------------------------------------------------------- |
| `createUserUpload(options)`      | Permanent upload, supports `isShared` and `referenceId` |
| `createTemporaryUpload(options)` | `duration?: TempFileDuration`, defaults to 15           |

### Instance methods

| Method                                       | Returns                                     | Description                                       |
| -------------------------------------------- | ------------------------------------------- | ------------------------------------------------- |
| `setStorageType(type, expiresAt, duration?)` | `void`                                      | Recomputes `r2Key`                                |
| `setPermanent()`                             | `void`                                      | Shorthand for `setStorageType('permanent', null)` |
| `setTemporary(duration?)`                    | `void`                                      | Shorthand for `setStorageType('temporary', ...)`  |
| `toggleSharing(token?)`                      | `string \| null`                            | Toggles sharing; returns active token or `null`   |
| `toJSON()`                                   | `MajikFileCloudJSON`                        | Extends base `toJSON()`                           |
| `toDangerousJSON()`                          | `MajikFileCloudJSON & { decrypted_base64 }` | ⚠️ Includes plaintext if hydrated                  |
| `validate()`                                 | `void`                                      | Combines base + cloud-specific checks             |
| `getStats()`                                 | `MajikFileCloudStats`                       | Extends base `getStats()`                         |

All base `MajikFile` instance methods — `toMJKB()`, `toBinaryBytes()`, `decryptBinary()`, `decryptHydrate()`, `decryptWithMetadata()`, `sign()`, `verify()`, `verifyBinary()`, `toSignedMJKB()`, `secureLock()`, `canDecrypt()`, `isDuplicateOf()`, `exceedsSize()`, `attachBinary()`, `clearBinary()` — are inherited unchanged.

### Instance getters

| Getter          | Type                         | Description                   |
| --------------- | ---------------------------- | ----------------------------- |
| `r2Key`         | `string`                     | Full R2 object key            |
| `storageType`   | `"permanent" \| "temporary"` |                               |
| `isShared`      | `boolean`                    |                               |
| `shareToken`    | `string \| null`             |                               |
| `hasShareToken` | `boolean`                    |                               |
| `referenceId`   | `string \| null`             |                               |
| `expiresAt`     | `string \| null`             | ISO-8601                      |
| `isExpired`     | `boolean`                    | Derived from `expiresAt`      |
| `isTemporary`   | `boolean`                    | `storageType === "temporary"` |

---

## Type reference

### `MajikFileCloudJSON`

Mirrors the `majikah.majik_files` Supabase table. Extends the base `MajikFileJSON` (minus its `kind` literal, widened to `string`).

```typescript
interface MajikFileCloudJSON extends Omit<MajikFileJSON, "kind"> {
  kind: string                       // "message_file"
  r2_key: string
  storage_type: "permanent" | "temporary"
  is_shared: boolean
  share_token: string | null
  reference_id: string | null
  expires_at: string | null
}
```

### `TempFileDuration`

```typescript
type TempFileDuration = 1 | 2 | 3 | 5 | 7 | 15  // days — maps 1:1 to R2 lifecycle prefixes
```

---

## Validation & errors

`validate()` combines the base `MajikFile` invariants with:
- `storageType` is `"permanent"` or `"temporary"`
- `expiresAt` is present when `storageType === "temporary"`

`create()` additionally runs a stricter, R2-prefix-aware check (`_validateCreate()`) that confirms the generated `r2Key` actually matches the prefix implied by the file's storage class.

---

## Storage model

Same two-artefact split as the base library:

| Artefact            | What it is       | Where it goes                  |
| ------------------- | ---------------- | ------------------------------ |
| `toMJKB()` → `Blob` | Encrypted binary | Cloudflare R2 at `r2Key`       |
| `toJSON()` → object | Metadata record  | Supabase `majikah.majik_files` |

This package doesn't perform R2 uploads or Supabase inserts — it only produces the data and computes the correct key. Persistence is the caller's responsibility.

---

## Relationship to `MajikFile`

| Concern                                                      | Owned by         |
| ------------------------------------------------------------ | ---------------- |
| Hashing, compression, ML-KEM-768, AES-256-GCM, `.mjkb` codec | `MajikFile`      |
| Signing, verification, zeroization                           | `MajikFile`      |
| R2 key, storage type, expiry                                 | `MajikFileCloud` |
| Reference IDs, Sharing tokens                                | `MajikFileCloud` |

---

## Related Projects

### [Majik Message](https://apps.microsoft.com/detail/9pmjgvzzjspn)
The secure software product this library powers. Available on Windows and WebApp.

### [Majik File](https://majikah.solutions/sdk/majik-file)
The platform-agnostic base class this package extends.

### [Majik Key](https://majikah.solutions/sdk/majik-key)
Seed phrase account library for generating deterministic ML-KEM-768 keypairs.

### [Majik Envelope](https://majikah.solutions/sdk/majik-envelope)
The core cryptographic engine handling message encryption and multi-recipient key encapsulation.

---

## Contributing

If you want to contribute or help extend support to more platforms or file formats, reach out via email. All contributions are welcome!

---

## License

[Apache-2.0](LICENSE) — free for personal and commercial use.

---

## Author

Developed by **Josef Elijah Fabian (Zelijah)** | [Majikah Solutions OPC](https://majikah.solutions/about)

**Developer**: [Josef Elijah Fabian](https://github.com/jedlsf)
**GitHub**: [https://github.com/Majikah](https://github.com/Majikah)
**Project Repository**: [https://github.com/Majikah/majik-file-cloud](https://github.com/Majikah/majik-file-cloud)

---

## Contact

- **Business Email**: [business@majikah.solutions](mailto:business@majikah.solutions)
- **Official Website**: [https://www.thezelijah.world](https://www.thezelijah.world)
- **Majikah Ecosystem**: [https://majikah.solutions](https://majikah.solutions)