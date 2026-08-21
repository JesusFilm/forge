import { Buffer } from "node:buffer"
import { createCipheriv } from "node:crypto"
import { describe, expect, it } from "vitest"
import {
  UserPlaylistCapability,
  UserPlaylistCapabilityConfigurationError,
  UserPlaylistCapabilityIntegrityError,
} from "./user-playlist-capability"

const key = (fill: number) => Buffer.alloc(32, fill)

function capabilities() {
  return new UserPlaylistCapability({
    lookupKeys: [{ id: "lookup-v1", key: key(1), active: true }],
    encryptionKeys: [{ id: "encryption-v1", key: key(2), active: true }],
  })
}

describe("UserPlaylistCapability", () => {
  it("generates a 32-byte base64url bearer and recovers it with bound AAD", () => {
    const service = capabilities()
    const created = service.create("playlist-1", 1)

    expect(created.token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(created.material.digest).toHaveLength(32)
    expect(created.material.nonce).toHaveLength(12)
    expect(created.material.authTag).toHaveLength(16)
    expect(service.reveal("playlist-1", 1, created.material)).toBe(
      created.token,
    )
    expect(() => service.reveal("playlist-2", 1, created.material)).toThrow()
    expect(() => service.reveal("playlist-1", 2, created.material)).toThrow()
  })

  it("uses separate active lookup and encryption keys and supports old keys", () => {
    const first = capabilities().create("playlist-1", 1)
    const rotatedRing = new UserPlaylistCapability({
      lookupKeys: [
        { id: "lookup-v1", key: key(1) },
        { id: "lookup-v2", key: key(3), active: true },
      ],
      encryptionKeys: [
        { id: "encryption-v1", key: key(2) },
        { id: "encryption-v2", key: key(4), active: true },
      ],
    })

    expect(rotatedRing.reveal("playlist-1", 1, first.material)).toBe(
      first.token,
    )
    expect(rotatedRing.lookupDigests(first.token)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ keyId: "lookup-v1" }),
        expect.objectContaining({ keyId: "lookup-v2" }),
      ]),
    )
  })

  it("classifies an authenticated but invalid plaintext as corrupt material", () => {
    const nonce = Buffer.alloc(12, 9)
    const cipher = createCipheriv("aes-256-gcm", key(2), nonce)
    cipher.setAAD(
      Buffer.from(
        JSON.stringify({
          purpose: "user-playlist-share",
          playlistId: "playlist-1",
          tokenVersion: 1,
        }),
        "utf8",
      ),
    )
    const ciphertext = Buffer.concat([
      cipher.update("not-a-capability", "ascii"),
      cipher.final(),
    ])

    expect(() =>
      capabilities().reveal("playlist-1", 1, {
        digest: Buffer.alloc(32),
        digestKeyId: "lookup-v1",
        ciphertext,
        encryptionKeyId: "encryption-v1",
        nonce,
        authTag: cipher.getAuthTag(),
      }),
    ).toThrow(UserPlaylistCapabilityIntegrityError)
  })

  it("classifies a digest mismatch as corrupt material", () => {
    const service = capabilities()
    const created = service.create("playlist-1", 1)

    expect(() =>
      service.reveal("playlist-1", 1, {
        ...created.material,
        digest: Buffer.alloc(32, 8),
      }),
    ).toThrow(UserPlaylistCapabilityIntegrityError)
  })

  it.each([
    [
      {
        lookupKeys: [],
        encryptionKeys: [{ id: "e", key: key(2), active: true }],
      },
    ],
    [
      {
        lookupKeys: [{ id: "l", key: key(1), active: true }],
        encryptionKeys: [],
      },
    ],
    [
      {
        lookupKeys: [
          { id: "l", key: key(1), active: true },
          { id: "x", key: key(2), active: true },
        ],
        encryptionKeys: [{ id: "e", key: key(2), active: true }],
      },
    ],
    [
      {
        lookupKeys: [{ id: "l", key: key(1), active: true }],
        encryptionKeys: [{ id: "e", key: Buffer.alloc(31), active: true }],
      },
    ],
  ])("rejects invalid key-ring configuration", (config) => {
    expect(
      () =>
        new UserPlaylistCapability(
          config as ConstructorParameters<typeof UserPlaylistCapability>[0],
        ),
    ).toThrow(UserPlaylistCapabilityConfigurationError)
  })
})
