import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from "node:crypto"
import { isIP } from "node:net"

const KEY_BYTES = 32
const GCM_NONCE_BYTES = 12
const KEY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
const REPORTER_DIGEST_RETENTION_MS = 7 * 24 * 60 * 60 * 1000

export type UserPlaylistReportCryptoKey = {
  id: string
  key: Uint8Array
  active?: boolean
}

export type UserPlaylistReportDetailMaterial = {
  ciphertext: Uint8Array
  keyId: string
  nonce: Uint8Array
  authTag: Uint8Array
}

export type TrustedUserPlaylistReporterIp = {
  integrityVerified: true
  normalizedIp: string
}

export type UserPlaylistReporterIpMaterial = {
  digest: Uint8Array
  keyId: string
  digestDay: string
  deleteAfter: Date
}

export class UserPlaylistReportCryptoConfigurationError extends Error {
  constructor(message = "Invalid User Playlist report crypto configuration") {
    super(message)
    this.name = "UserPlaylistReportCryptoConfigurationError"
  }
}

function validateKeyRing(
  label: string,
  keys: readonly UserPlaylistReportCryptoKey[],
): UserPlaylistReportCryptoKey {
  if (keys.length === 0) {
    throw new UserPlaylistReportCryptoConfigurationError(
      `${label} key ring is empty`,
    )
  }
  const ids = new Set<string>()
  for (const key of keys) {
    if (
      !KEY_ID_PATTERN.test(key.id) ||
      ids.has(key.id) ||
      key.key.byteLength !== KEY_BYTES
    ) {
      throw new UserPlaylistReportCryptoConfigurationError(
        `${label} keys must have unique ids and be ${KEY_BYTES} bytes`,
      )
    }
    ids.add(key.id)
  }
  const active = keys.filter((key) => key.active === true)
  if (active.length !== 1) {
    throw new UserPlaylistReportCryptoConfigurationError(
      `${label} key ring must have exactly one active key`,
    )
  }
  return active[0]!
}

function detailAad(input: {
  reportId: string
  playlistId: string
  category: string
}): Buffer {
  return Buffer.from(
    JSON.stringify({
      purpose: "user-playlist-report-detail",
      reportId: input.reportId,
      playlistId: input.playlistId,
      category: input.category,
    }),
    "utf8",
  )
}

export class UserPlaylistReportDetailCipher {
  private readonly activeKey: UserPlaylistReportCryptoKey
  private readonly keysById: ReadonlyMap<string, UserPlaylistReportCryptoKey>

  constructor(
    private readonly config: {
      keys: readonly UserPlaylistReportCryptoKey[]
      randomBytes?: (size: number) => Uint8Array
    },
  ) {
    this.activeKey = validateKeyRing("Report detail", config.keys)
    this.keysById = new Map(config.keys.map((key) => [key.id, key]))
  }

  encrypt(
    detail: string,
    context: { reportId: string; playlistId: string; category: string },
  ): UserPlaylistReportDetailMaterial {
    const nonce = Buffer.from(
      (this.config.randomBytes ?? randomBytes)(GCM_NONCE_BYTES),
    )
    if (nonce.byteLength !== GCM_NONCE_BYTES) {
      throw new UserPlaylistReportCryptoConfigurationError(
        `Report detail nonce must be ${GCM_NONCE_BYTES} bytes`,
      )
    }
    const cipher = createCipheriv("aes-256-gcm", this.activeKey.key, nonce)
    cipher.setAAD(detailAad(context))
    const ciphertext = Buffer.concat([
      cipher.update(detail, "utf8"),
      cipher.final(),
    ])
    return {
      ciphertext,
      keyId: this.activeKey.id,
      nonce,
      authTag: cipher.getAuthTag(),
    }
  }

  decrypt(
    material: UserPlaylistReportDetailMaterial,
    context: { reportId: string; playlistId: string; category: string },
  ): string {
    const key = this.keysById.get(material.keyId)
    if (!key) {
      throw new UserPlaylistReportCryptoConfigurationError(
        "Report detail references a missing key",
      )
    }
    const decipher = createDecipheriv("aes-256-gcm", key.key, material.nonce)
    decipher.setAAD(detailAad(context))
    decipher.setAuthTag(Buffer.from(material.authTag))
    return Buffer.concat([
      decipher.update(material.ciphertext),
      decipher.final(),
    ]).toString("utf8")
  }
}

export class UserPlaylistReporterIpDigester {
  private readonly activeKey: UserPlaylistReportCryptoKey

  constructor(config: { keys: readonly UserPlaylistReportCryptoKey[] }) {
    this.activeKey = validateKeyRing("Reporter IP digest", config.keys)
  }

  digest(
    context: TrustedUserPlaylistReporterIp | null,
    now: Date,
  ): UserPlaylistReporterIpMaterial | null {
    if (
      context?.integrityVerified !== true ||
      isIP(context.normalizedIp) === 0
    ) {
      return null
    }
    const digestDay = now.toISOString().slice(0, 10)
    const digest = createHmac("sha256", this.activeKey.key)
      .update("user-playlist-report-ip", "ascii")
      .update("\0", "ascii")
      .update(digestDay, "ascii")
      .update("\0", "ascii")
      .update(context.normalizedIp, "ascii")
      .digest()
    return {
      digest,
      keyId: this.activeKey.id,
      digestDay,
      deleteAfter: new Date(now.getTime() + REPORTER_DIGEST_RETENTION_MS),
    }
  }
}
