import { randomBytes } from "node:crypto"
import { decodeProtectedHeader, SignJWT } from "jose"
import { describe, expect, it, vi } from "vitest"
import {
  RecommendationTokenConfigurationError,
  RecommendationTokenInvalidError,
  createRecommendationTokenService,
  parseRecommendationKeyring,
} from "./token.service"

const key = () => randomBytes(32).toString("base64url")

function rawKeyring() {
  return JSON.stringify({
    keys: [
      { kid: "rec-current", status: "active", key: key() },
      { kid: "rec-previous", status: "previous", key: key() },
    ],
  })
}

describe("recommendation capability keyring", () => {
  it("requires one active signer, unique allowlisted kids, and 256-bit keys", () => {
    const invalid = [
      JSON.stringify({ keys: [] }),
      JSON.stringify({
        keys: [
          { kid: "one", status: "active", key: key() },
          { kid: "two", status: "active", key: key() },
        ],
      }),
      JSON.stringify({
        keys: [
          { kid: "same", status: "active", key: key() },
          { kid: "same", status: "previous", key: key() },
        ],
      }),
      JSON.stringify({
        keys: [{ kid: "bad kid", status: "active", key: key() }],
      }),
      JSON.stringify({
        keys: [
          {
            kid: "too-short",
            status: "active",
            key: randomBytes(31).toString("base64url"),
          },
        ],
      }),
      "not-json",
    ]

    for (const raw of invalid) {
      expect(() => parseRecommendationKeyring(raw)).toThrow(
        RecommendationTokenConfigurationError,
      )
    }
  })

  it("never includes encoded or decoded key material in configuration errors", () => {
    const secret = randomBytes(31).toString("base64url")
    let caught: Error | undefined
    try {
      parseRecommendationKeyring(
        JSON.stringify({
          keys: [{ kid: "short", status: "active", key: secret }],
        }),
      )
    } catch (error) {
      caught = error as Error
    }

    expect(caught).toBeInstanceOf(RecommendationTokenConfigurationError)
    expect(caught?.message).not.toContain(secret)
    expect(caught?.message).not.toContain(
      Buffer.from(secret, "base64url").toString("utf8"),
    )
  })
})

describe("recommendation capability tokens", () => {
  const now = new Date("2026-08-19T00:00:00.000Z")
  const deliveryBinding = {
    jti: "delivery-jti",
    requestId: "request-1",
    itemId: "item-1",
    sessionDigest: "a".repeat(64),
    surface: "watch-below-player-v1" as const,
    manifestId: "semantic-transcript-pgvector-v1",
  }
  const episodeBinding = {
    jti: "episode-jti",
    episodeId: "episode-1",
    requestId: "request-1",
    itemId: "item-1",
    sessionDigest: "a".repeat(64),
    mediaId: "video-2",
    generation: 1,
  }

  it("signs with the active key and verifies exact stored delivery bindings", async () => {
    const keyring = parseRecommendationKeyring(rawKeyring())
    const readRevokedKids = vi.fn(async () => [] as string[])
    const service = createRecommendationTokenService({
      keyring,
      readRevokedKids,
      now: () => now,
    })

    const token = await service.signDeliveryCapability(deliveryBinding)
    await expect(
      service.verifyDeliveryCapability(token, deliveryBinding),
    ).resolves.toMatchObject({
      typ: "recommendation-delivery+jwt",
      aud: "forge-web-recommendation-evidence",
      iss: "forge-admin",
      ...deliveryBinding,
    })
    await expect(
      service.verifyDeliveryCapability(token, {
        ...deliveryBinding,
        itemId: "different-item",
      }),
    ).rejects.toBeInstanceOf(RecommendationTokenInvalidError)
    expect(readRevokedKids).toHaveBeenCalledTimes(3)
  })

  it("binds a complete assignment context and rejects partial assignment claims", async () => {
    const service = createRecommendationTokenService({
      keyring: parseRecommendationKeyring(rawKeyring()),
      readRevokedKids: async () => [],
      now: () => now,
    })
    const assignedBinding = {
      ...deliveryBinding,
      assignmentId: "assignment-1",
      experimentId: "semantic-aa-v1",
      experimentVersion: "semantic-aa-v1",
      experimentGeneration: 1,
      experimentArm: "challenger" as const,
      effectiveManifestId: "semantic-experiment-aa-v1",
      assignmentProbability: 0.5,
      assignmentConfigurationDigest: "b".repeat(64),
    }

    const token = await service.signDeliveryCapability(assignedBinding)
    await expect(
      service.verifyDeliveryCapability(token, assignedBinding),
    ).resolves.toMatchObject(assignedBinding)
    await expect(
      service.signDeliveryCapability({
        ...deliveryBinding,
        assignmentId: "assignment-1",
      }),
    ).rejects.toBeInstanceOf(RecommendationTokenInvalidError)
  })

  it("re-reads emergency revocation on issuance and verification", async () => {
    const keyring = parseRecommendationKeyring(rawKeyring())
    const readRevokedKids = vi
      .fn<() => Promise<string[]>>()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(["rec-current"])
    const service = createRecommendationTokenService({
      keyring,
      readRevokedKids,
      now: () => now,
    })

    const token = await service.signDeliveryCapability(deliveryBinding)
    await expect(
      service.verifyDeliveryCapability(token, deliveryBinding),
    ).rejects.toBeInstanceOf(RecommendationTokenInvalidError)
  })

  it("rejects delivery capability use at expiry without clock tolerance", async () => {
    let current = now
    const service = createRecommendationTokenService({
      keyring: parseRecommendationKeyring(rawKeyring()),
      readRevokedKids: async () => [],
      now: () => current,
    })
    const token = await service.signDeliveryCapability(deliveryBinding)

    current = new Date(now.getTime() + 10 * 60 * 1_000 - 1)
    await expect(
      service.verifyDeliveryCapability(token, deliveryBinding),
    ).resolves.toMatchObject(deliveryBinding)

    current = new Date(now.getTime() + 10 * 60 * 1_000)
    await expect(
      service.verifyDeliveryCapability(token, deliveryBinding),
    ).rejects.toBeInstanceOf(RecommendationTokenInvalidError)
  })

  it("accepts only terminal episode facts during the bounded late window", async () => {
    const service = createRecommendationTokenService({
      keyring: parseRecommendationKeyring(rawKeyring()),
      readRevokedKids: async () => [],
      now: () => now,
    })
    const token = await service.signEpisodeCapability(episodeBinding)
    const occurredAt = new Date(now.getTime() + 4 * 60 * 60 * 1000 - 1)
    const receivedAt = new Date(now.getTime() + 5 * 60 * 60 * 1000)

    await expect(
      service.verifyEpisodeCapability(token, {
        ...episodeBinding,
        eventKind: "playback_end",
        occurredAt,
        receivedAt,
      }),
    ).resolves.toMatchObject({ late: true })
    await expect(
      service.verifyEpisodeCapability(token, {
        ...episodeBinding,
        eventKind: "playback_progress",
        occurredAt,
        receivedAt,
      }),
    ).rejects.toBeInstanceOf(RecommendationTokenInvalidError)
    await expect(
      service.verifyEpisodeCapability(token, {
        ...episodeBinding,
        eventKind: "playback_end",
        occurredAt: new Date(now.getTime() + 4 * 60 * 60 * 1000 + 1_000),
        receivedAt,
      }),
    ).rejects.toBeInstanceOf(RecommendationTokenInvalidError)
    await expect(
      service.verifyEpisodeCapability(token, {
        ...episodeBinding,
        eventKind: "playback_end",
        occurredAt: new Date(now.getTime() + 5 * 60 * 60 * 1000),
        receivedAt: new Date(now.getTime() + 60 * 60 * 1000),
      }),
    ).rejects.toBeInstanceOf(RecommendationTokenInvalidError)
    await expect(
      service.verifyEpisodeCapability(token, {
        ...episodeBinding,
        eventKind: "playback_end",
        occurredAt,
        receivedAt: new Date(now.getTime() + 6 * 60 * 60 * 1000 + 1_000),
      }),
    ).rejects.toBeInstanceOf(RecommendationTokenInvalidError)
  })

  it("samples episode issuance time once across the revocation lookup", async () => {
    let current = now
    const service = createRecommendationTokenService({
      keyring: parseRecommendationKeyring(rawKeyring()),
      readRevokedKids: async () => {
        current = new Date(now.getTime() + 1_000)
        return []
      },
      now: () => current,
    })

    const token = await service.signEpisodeCapability(episodeBinding)
    const claims = await service.verifyEpisodeCapability(token, {
      ...episodeBinding,
      eventKind: "playback_start",
      occurredAt: now,
      receivedAt: current,
    })
    const issuedAt = Math.floor(now.getTime() / 1_000)
    expect(claims.iat).toBe(issuedAt)
    expect(claims.exp).toBe(issuedAt + 4 * 60 * 60)
    expect(claims.hardExp).toBe(issuedAt + 6 * 60 * 60)
  })

  it("replays a committed episode capability with its stored key and original horizons", async () => {
    let current = new Date("2026-08-19T04:00:00.000Z")
    const service = createRecommendationTokenService({
      keyring: parseRecommendationKeyring(rawKeyring()),
      readRevokedKids: async () => [],
      now: () => current,
    })
    const claimedAt = new Date("2026-08-19T03:00:00.123Z")
    const issuance = { issuedAt: claimedAt, signingKid: "rec-previous" }

    const original = await service.signEpisodeCapability(
      episodeBinding,
      issuance,
    )
    current = new Date("2026-08-19T05:00:00.000Z")
    const replay = await service.signEpisodeCapability(episodeBinding, issuance)

    expect(replay).toBe(original)
    expect(decodeProtectedHeader(replay).kid).toBe("rec-previous")
    await expect(
      service.verifyEpisodeCapability(replay, {
        ...episodeBinding,
        eventKind: "playback_start",
        occurredAt: claimedAt,
        receivedAt: current,
      }),
    ).resolves.toMatchObject({
      iat: Math.floor(claimedAt.getTime() / 1_000),
      exp: Math.floor(claimedAt.getTime() / 1_000) + 4 * 60 * 60,
      hardExp: Math.floor(claimedAt.getTime() / 1_000) + 6 * 60 * 60,
    })
  })

  it("rejects a wrong algorithm before claim acceptance", async () => {
    const parsed = parseRecommendationKeyring(rawKeyring())
    const service = createRecommendationTokenService({
      keyring: parsed,
      readRevokedKids: async () => [],
      now: () => now,
    })
    const hostile = await new SignJWT({ ...deliveryBinding })
      .setProtectedHeader({
        alg: "HS384",
        typ: "recommendation-delivery+jwt",
        kid: parsed.active.kid,
      })
      .setIssuer("forge-admin")
      .setAudience("forge-web-recommendation-evidence")
      .setIssuedAt(Math.floor(now.getTime() / 1000))
      .setExpirationTime(Math.floor(now.getTime() / 1000) + 600)
      .sign(parsed.active.material)

    await expect(
      service.verifyDeliveryCapability(hostile, deliveryBinding),
    ).rejects.toBeInstanceOf(RecommendationTokenInvalidError)
  })
})
