import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto"

const INTENT_VERSION = "v1"
const INTENT_PURPOSE = "user-playlist-report"
const CAPABILITY_DIGEST_BYTES = 32
const INTENT_NONCE_BYTES = 16
const INTENT_DIGEST_BYTES = 32
const GCM_NONCE_BYTES = 12
const GCM_TAG_BYTES = 16
const MIN_TTL_MS = 1_000
const MAX_TTL_MS = 10 * 60 * 1000
const KEY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
const PLAYLIST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/

export type UserPlaylistReportIntentKey = {
  id: string
  key: Uint8Array
  active?: boolean
}

export type VerifiedUserPlaylistReportIntent = {
  playlistId: string
  nonce: string
  expiresAt: Date
  intentDigest: Uint8Array
}

export class UserPlaylistReportIntentConfigurationError extends Error {
  constructor(message = "Invalid User Playlist report-intent configuration") {
    super(message)
    this.name = "UserPlaylistReportIntentConfigurationError"
  }
}

type IntentPayload = {
  purpose: typeof INTENT_PURPOSE
  playlistId: string
  capabilityBinding: string
  nonce: string
  expiresAt: number
}

function hmac(key: Uint8Array, value: string | Uint8Array): Buffer {
  return createHmac("sha256", key).update(value).digest()
}

function deriveKey(key: Uint8Array, purpose: "encrypt" | "digest"): Buffer {
  return createHmac("sha256", key)
    .update(`${INTENT_PURPOSE}:${purpose}`, "ascii")
    .digest()
}

function aad(keyId: string): Buffer {
  return Buffer.from(`${INTENT_VERSION}:${keyId}:${INTENT_PURPOSE}`, "ascii")
}

function equal(left: Uint8Array, right: Uint8Array): boolean {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  return a.byteLength === b.byteLength && timingSafeEqual(a, b)
}

function decodeBase64Url(value: string): Buffer | null {
  if (!BASE64URL_PATTERN.test(value)) return null
  const decoded = Buffer.from(value, "base64url")
  return decoded.toString("base64url") === value ? decoded : null
}

export class UserPlaylistReportIntent {
  private readonly activeKey: UserPlaylistReportIntentKey
  private readonly keysById: ReadonlyMap<string, UserPlaylistReportIntentKey>

  constructor(
    private readonly config: {
      keys: readonly UserPlaylistReportIntentKey[]
      ttlMs?: number
      randomBytes?: (size: number) => Uint8Array
    },
  ) {
    if (config.keys.length === 0) {
      throw new UserPlaylistReportIntentConfigurationError(
        "Report-intent key ring is empty",
      )
    }
    const ids = new Set<string>()
    for (const key of config.keys) {
      if (
        !KEY_ID_PATTERN.test(key.id) ||
        ids.has(key.id) ||
        key.key.byteLength < INTENT_DIGEST_BYTES
      ) {
        throw new UserPlaylistReportIntentConfigurationError(
          "Report-intent signing keys must have unique ids and at least 32 bytes",
        )
      }
      ids.add(key.id)
    }
    const activeKeys = config.keys.filter((key) => key.active === true)
    if (activeKeys.length !== 1) {
      throw new UserPlaylistReportIntentConfigurationError(
        "Report-intent key ring must have exactly one active key",
      )
    }
    const ttlMs = config.ttlMs ?? 5 * 60 * 1000
    if (!Number.isInteger(ttlMs) || ttlMs < MIN_TTL_MS || ttlMs > MAX_TTL_MS) {
      throw new UserPlaylistReportIntentConfigurationError(
        "Report-intent TTL must be between 1 second and 10 minutes",
      )
    }
    this.activeKey = activeKeys[0]!
    this.keysById = new Map(config.keys.map((key) => [key.id, key]))
  }

  mint(input: {
    playlistId: string
    capabilityDigest: Uint8Array
    now?: Date
  }): string {
    if (
      !PLAYLIST_ID_PATTERN.test(input.playlistId) ||
      input.capabilityDigest.byteLength !== CAPABILITY_DIGEST_BYTES
    ) {
      throw new UserPlaylistReportIntentConfigurationError(
        "Invalid report-intent subject",
      )
    }
    const now = input.now ?? new Date()
    const intentNonce = Buffer.from(
      (this.config.randomBytes ?? randomBytes)(INTENT_NONCE_BYTES),
    )
    const encryptionNonce = Buffer.from(
      (this.config.randomBytes ?? randomBytes)(GCM_NONCE_BYTES),
    )
    if (
      intentNonce.byteLength !== INTENT_NONCE_BYTES ||
      encryptionNonce.byteLength !== GCM_NONCE_BYTES
    ) {
      throw new UserPlaylistReportIntentConfigurationError(
        "Report-intent randomness returned an invalid byte length",
      )
    }
    const payload: IntentPayload = {
      purpose: INTENT_PURPOSE,
      playlistId: input.playlistId,
      capabilityBinding: Buffer.from(input.capabilityDigest).toString(
        "base64url",
      ),
      nonce: intentNonce.toString("base64url"),
      expiresAt: now.getTime() + (this.config.ttlMs ?? 5 * 60 * 1000),
    }
    const cipher = createCipheriv(
      "aes-256-gcm",
      deriveKey(this.activeKey.key, "encrypt"),
      encryptionNonce,
    )
    cipher.setAAD(aad(this.activeKey.id))
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(payload), "utf8"),
      cipher.final(),
    ])
    return [
      INTENT_VERSION,
      this.activeKey.id,
      encryptionNonce.toString("base64url"),
      ciphertext.toString("base64url"),
      cipher.getAuthTag().toString("base64url"),
    ].join(".")
  }

  private open(input: { token: string; now?: Date }): {
    intent: VerifiedUserPlaylistReportIntent
    capabilityBinding: Uint8Array
  } | null {
    if (input.token.length > 1_024) return null
    const parts = input.token.split(".")
    if (parts.length !== 5 || parts[0] !== INTENT_VERSION) return null
    const [, keyId, encodedNonce, encodedCiphertext, encodedAuthTag] = parts
    if (
      keyId == null ||
      encodedNonce == null ||
      encodedCiphertext == null ||
      encodedAuthTag == null ||
      !KEY_ID_PATTERN.test(keyId)
    ) {
      return null
    }
    const key = this.keysById.get(keyId)
    const encryptionNonce = decodeBase64Url(encodedNonce)
    const ciphertext = decodeBase64Url(encodedCiphertext)
    const authTag = decodeBase64Url(encodedAuthTag)
    if (
      !key ||
      !encryptionNonce ||
      encryptionNonce.byteLength !== GCM_NONCE_BYTES ||
      !ciphertext ||
      ciphertext.byteLength === 0 ||
      !authTag ||
      authTag.byteLength !== GCM_TAG_BYTES
    ) {
      return null
    }

    let payload: unknown
    try {
      const decipher = createDecipheriv(
        "aes-256-gcm",
        deriveKey(key.key, "encrypt"),
        encryptionNonce,
      )
      decipher.setAAD(aad(keyId))
      decipher.setAuthTag(authTag)
      payload = JSON.parse(
        Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
          "utf8",
        ),
      )
    } catch {
      return null
    }
    if (
      typeof payload !== "object" ||
      payload == null ||
      Object.keys(payload).length !== 5
    ) {
      return null
    }
    const candidate = payload as Partial<IntentPayload>
    if (
      candidate.purpose !== INTENT_PURPOSE ||
      typeof candidate.playlistId !== "string" ||
      !PLAYLIST_ID_PATTERN.test(candidate.playlistId) ||
      typeof candidate.capabilityBinding !== "string" ||
      typeof candidate.nonce !== "string" ||
      typeof candidate.expiresAt !== "number" ||
      !Number.isSafeInteger(candidate.expiresAt)
    ) {
      return null
    }
    const binding = decodeBase64Url(candidate.capabilityBinding)
    const nonce = decodeBase64Url(candidate.nonce)
    if (
      !binding ||
      binding.byteLength !== INTENT_DIGEST_BYTES ||
      !nonce ||
      nonce.byteLength !== INTENT_NONCE_BYTES ||
      (input.now ?? new Date()).getTime() >= candidate.expiresAt
    ) {
      return null
    }
    return {
      intent: {
        playlistId: candidate.playlistId,
        nonce: candidate.nonce,
        expiresAt: new Date(candidate.expiresAt),
        intentDigest: hmac(deriveKey(key.key, "digest"), input.token),
      },
      capabilityBinding: binding,
    }
  }

  verify(input: {
    token: string
    capabilityDigest: Uint8Array
    now?: Date
  }): VerifiedUserPlaylistReportIntent | null {
    if (input.capabilityDigest.byteLength !== CAPABILITY_DIGEST_BYTES) {
      return null
    }
    const opened = this.open(input)
    if (!opened || !equal(opened.capabilityBinding, input.capabilityDigest)) {
      return null
    }
    return opened.intent
  }

  async verifyCurrent(input: {
    token: string
    now?: Date
    resolveCapabilityDigest(playlistId: string): Promise<Uint8Array | null>
  }): Promise<VerifiedUserPlaylistReportIntent | null> {
    const opened = this.open(input)
    if (!opened) return null
    const current = await input.resolveCapabilityDigest(
      opened.intent.playlistId,
    )
    if (
      current == null ||
      current.byteLength !== CAPABILITY_DIGEST_BYTES ||
      !equal(opened.capabilityBinding, current)
    ) {
      return null
    }
    return opened.intent
  }
}
