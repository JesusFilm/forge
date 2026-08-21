import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from "node:crypto"

const TOKEN_BYTES = 32
const LOOKUP_DIGEST_BYTES = 32
const ENCRYPTION_KEY_BYTES = 32
const GCM_NONCE_BYTES = 12
const KEY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/

export type UserPlaylistCapabilityKey = {
  id: string
  key: Uint8Array
  active?: boolean
}

export type UserPlaylistCapabilityMaterial = {
  digest: Uint8Array
  digestKeyId: string
  ciphertext: Uint8Array
  encryptionKeyId: string
  nonce: Uint8Array
  authTag: Uint8Array
}

export class UserPlaylistCapabilityConfigurationError extends Error {
  constructor(
    message = "Invalid User Playlist capability key-ring configuration",
  ) {
    super(message)
    this.name = "UserPlaylistCapabilityConfigurationError"
  }
}

export class UserPlaylistCapabilityIntegrityError extends Error {
  constructor(message = "User Playlist capability material is corrupt") {
    super(message)
    this.name = "UserPlaylistCapabilityIntegrityError"
  }
}

function aad(playlistId: string, tokenVersion: number): Buffer {
  return Buffer.from(
    JSON.stringify({
      purpose: "user-playlist-share",
      playlistId,
      tokenVersion,
    }),
    "utf8",
  )
}

function validateRing(
  name: string,
  keys: readonly UserPlaylistCapabilityKey[],
  keyLength: number | null,
): UserPlaylistCapabilityKey {
  if (keys.length === 0) {
    throw new UserPlaylistCapabilityConfigurationError(
      `${name} key ring is empty`,
    )
  }
  const ids = new Set<string>()
  for (const entry of keys) {
    if (!KEY_ID_PATTERN.test(entry.id) || ids.has(entry.id)) {
      throw new UserPlaylistCapabilityConfigurationError(
        `${name} key ids must be valid and unique`,
      )
    }
    ids.add(entry.id)
    if (keyLength != null && entry.key.byteLength !== keyLength) {
      throw new UserPlaylistCapabilityConfigurationError(
        `${name} keys must be ${keyLength} bytes`,
      )
    }
    if (keyLength == null && entry.key.byteLength < LOOKUP_DIGEST_BYTES) {
      throw new UserPlaylistCapabilityConfigurationError(
        `${name} keys must be at least ${LOOKUP_DIGEST_BYTES} bytes`,
      )
    }
  }
  const active = keys.filter((entry) => entry.active === true)
  if (active.length !== 1) {
    throw new UserPlaylistCapabilityConfigurationError(
      `${name} key ring must have exactly one active key`,
    )
  }
  return active[0]!
}

function digest(token: string, entry: UserPlaylistCapabilityKey): Buffer {
  return createHmac("sha256", entry.key).update(token, "ascii").digest()
}

export class UserPlaylistCapability {
  private readonly lookupById: ReadonlyMap<string, UserPlaylistCapabilityKey>
  private readonly encryptionById: ReadonlyMap<
    string,
    UserPlaylistCapabilityKey
  >
  private readonly activeLookup: UserPlaylistCapabilityKey
  private readonly activeEncryption: UserPlaylistCapabilityKey

  constructor(
    private readonly config: {
      lookupKeys: readonly UserPlaylistCapabilityKey[]
      encryptionKeys: readonly UserPlaylistCapabilityKey[]
      randomBytes?: (size: number) => Uint8Array
    },
  ) {
    this.activeLookup = validateRing("lookup", config.lookupKeys, null)
    this.activeEncryption = validateRing(
      "encryption",
      config.encryptionKeys,
      ENCRYPTION_KEY_BYTES,
    )
    this.lookupById = new Map(
      config.lookupKeys.map((entry) => [entry.id, entry]),
    )
    this.encryptionById = new Map(
      config.encryptionKeys.map((entry) => [entry.id, entry]),
    )
  }

  isTokenShape(token: string): boolean {
    return TOKEN_PATTERN.test(token)
  }

  lookupDigests(token: string): Array<{ keyId: string; digest: Buffer }> {
    if (!this.isTokenShape(token)) return []
    return this.config.lookupKeys.map((entry) => ({
      keyId: entry.id,
      digest: digest(token, entry),
    }))
  }

  create(
    playlistId: string,
    tokenVersion: number,
  ): { token: string; material: UserPlaylistCapabilityMaterial } {
    const bytes = Buffer.from(
      (this.config.randomBytes ?? randomBytes)(TOKEN_BYTES),
    )
    if (bytes.byteLength !== TOKEN_BYTES) {
      throw new UserPlaylistCapabilityConfigurationError(
        `Capability randomness must return ${TOKEN_BYTES} bytes`,
      )
    }
    const token = bytes.toString("base64url")
    const nonce = Buffer.from(
      (this.config.randomBytes ?? randomBytes)(GCM_NONCE_BYTES),
    )
    if (nonce.byteLength !== GCM_NONCE_BYTES) {
      throw new UserPlaylistCapabilityConfigurationError(
        `Capability nonce randomness must return ${GCM_NONCE_BYTES} bytes`,
      )
    }
    const cipher = createCipheriv(
      "aes-256-gcm",
      this.activeEncryption.key,
      nonce,
    )
    cipher.setAAD(aad(playlistId, tokenVersion))
    const ciphertext = Buffer.concat([
      cipher.update(token, "ascii"),
      cipher.final(),
    ])

    return {
      token,
      material: {
        digest: digest(token, this.activeLookup),
        digestKeyId: this.activeLookup.id,
        ciphertext,
        encryptionKeyId: this.activeEncryption.id,
        nonce,
        authTag: cipher.getAuthTag(),
      },
    }
  }

  reveal(
    playlistId: string,
    tokenVersion: number,
    material: UserPlaylistCapabilityMaterial,
  ): string {
    const encryptionKey = this.encryptionById.get(material.encryptionKeyId)
    const lookupKey = this.lookupById.get(material.digestKeyId)
    if (!encryptionKey || !lookupKey) {
      throw new UserPlaylistCapabilityConfigurationError(
        "Capability material references a missing key",
      )
    }
    let token: string
    try {
      const decipher = createDecipheriv(
        "aes-256-gcm",
        encryptionKey.key,
        material.nonce,
      )
      decipher.setAAD(aad(playlistId, tokenVersion))
      decipher.setAuthTag(Buffer.from(material.authTag))
      token = Buffer.concat([
        decipher.update(material.ciphertext),
        decipher.final(),
      ]).toString("ascii")
    } catch {
      throw new UserPlaylistCapabilityIntegrityError()
    }
    if (!this.isTokenShape(token))
      throw new UserPlaylistCapabilityIntegrityError()
    const recoveredDigest = digest(token, lookupKey)
    if (!recoveredDigest.equals(Buffer.from(material.digest))) {
      throw new UserPlaylistCapabilityIntegrityError()
    }
    return token
  }
}
