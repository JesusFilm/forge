import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  PARTNER_KEY_LOOKUP_TIMEOUT_MS,
  PartnerKeyAlreadyExistsError,
  PartnerKeyNotFoundError,
  createPartnerKey,
  importPartnerKeyFromPlaintext,
  listPartnerKeys,
  revokePartnerKey,
  rotatePartnerKey,
  verifyPartnerToken,
} from "@/services/partner-api-key.service"
import { generatePartnerToken, hashRawToken } from "@/auth/partner-token"

type RowShape = {
  id: string
  keyId: string
  keyHash: string
  name: string
  ownerEmail: string
  note: string | null
  createdAt: Date
  updatedAt: Date
  lastUsedAt: Date | null
  revokedAt: Date | null
  createdById: string | null
  revokedById: string | null
}

function buildRow(overrides: Partial<RowShape> = {}): RowShape {
  const now = new Date("2026-05-18T12:00:00Z")
  return {
    id: "cuid-row-1",
    keyId: "ABCDEFGHJKLM",
    keyHash: "deadbeef".repeat(8),
    name: "Acme Partner",
    ownerEmail: "owner@example.com",
    note: null,
    createdAt: now,
    updatedAt: now,
    lastUsedAt: null,
    revokedAt: null,
    createdById: null,
    revokedById: null,
    ...overrides,
  }
}

function makeMockPrisma() {
  return {
    partnerApiKey: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
  } as const
}

// Helper to make a `Promise.race` that exceeds the timeout — must not
// resolve quickly. We use a Promise that pends past the budget.
function neverResolving<T>(): Promise<T> {
  return new Promise<T>(() => {
    /* never resolves */
  })
}

describe("partner-api-key.service", () => {
  let mockPrisma: ReturnType<typeof makeMockPrisma>

  beforeEach(() => {
    mockPrisma = makeMockPrisma()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe("createPartnerKey", () => {
    it("issues a fresh token and persists the hashed row", async () => {
      const row = buildRow()
      mockPrisma.partnerApiKey.create.mockResolvedValueOnce(row)

      const result = await createPartnerKey(
        {
          name: "Acme Partner",
          ownerEmail: "owner@example.com",
          createdById: "user-cuid-1",
        },
        mockPrisma as never,
      )

      expect(result.rawToken).toMatch(
        /^jfp_search_[A-Za-z2-9]{12}_[A-Za-z0-9_-]{43}$/,
      )
      expect(result.keyId).toHaveLength(12)
      expect(mockPrisma.partnerApiKey.create).toHaveBeenCalledTimes(1)
      const arg = mockPrisma.partnerApiKey.create.mock.calls[0]![0]!
      // keyHash is hashed, NEVER plaintext.
      expect(arg.data.keyHash).toBe(hashRawToken(result.rawToken))
      expect(arg.data).not.toHaveProperty("rawToken")
      expect(arg.data.createdById).toBe("user-cuid-1")
    })

    it("persists null note when none provided", async () => {
      mockPrisma.partnerApiKey.create.mockResolvedValueOnce(buildRow())
      await createPartnerKey(
        { name: "x", ownerEmail: "y@z" },
        mockPrisma as never,
      )
      const arg = mockPrisma.partnerApiKey.create.mock.calls[0]![0]!
      expect(arg.data.note).toBeNull()
    })
  })

  describe("importPartnerKeyFromPlaintext", () => {
    it("hashes the provided plaintext and creates a row", async () => {
      mockPrisma.partnerApiKey.findUnique.mockResolvedValueOnce(null)
      mockPrisma.partnerApiKey.create.mockResolvedValueOnce(buildRow())

      const rawToken = "xoSPdummyTestToken12345_with_some_entropy_chars"
      await importPartnerKeyFromPlaintext(
        { rawToken, name: "Legacy Partner", ownerEmail: "legacy@example.com" },
        mockPrisma as never,
      )

      const arg = mockPrisma.partnerApiKey.create.mock.calls[0]![0]!
      expect(arg.data.keyHash).toBe(hashRawToken(rawToken))
      expect(arg.data.note).toMatch(/Imported from SEARCH_API_KEYS/)
    })

    it("throws PartnerKeyAlreadyExistsError when hash collides", async () => {
      mockPrisma.partnerApiKey.findUnique.mockResolvedValueOnce({
        keyHash: hashRawToken("anything"),
      })
      await expect(
        importPartnerKeyFromPlaintext(
          { rawToken: "anything", name: "x", ownerEmail: "y@z" },
          mockPrisma as never,
        ),
      ).rejects.toBeInstanceOf(PartnerKeyAlreadyExistsError)
      expect(mockPrisma.partnerApiKey.create).not.toHaveBeenCalled()
    })
  })

  describe("revokePartnerKey", () => {
    it("sets revokedAt + revokedById on an active key", async () => {
      mockPrisma.partnerApiKey.findUnique.mockResolvedValueOnce({
        id: "row-1",
        revokedAt: null,
      })
      mockPrisma.partnerApiKey.update.mockResolvedValueOnce(
        buildRow({ revokedAt: new Date(), revokedById: "user-cuid-1" }),
      )

      await revokePartnerKey(
        { keyId: "ABCDEFGHJKLM", revokedById: "user-cuid-1" },
        mockPrisma as never,
      )

      expect(mockPrisma.partnerApiKey.update).toHaveBeenCalledTimes(1)
      const arg = mockPrisma.partnerApiKey.update.mock.calls[0]![0]!
      expect(arg.where).toEqual({ keyId: "ABCDEFGHJKLM" })
      expect(arg.data.revokedAt).toBeInstanceOf(Date)
      expect(arg.data.revokedById).toBe("user-cuid-1")
    })

    it("is idempotent — already-revoked returns the existing row without update", async () => {
      mockPrisma.partnerApiKey.findUnique.mockResolvedValueOnce({
        id: "row-1",
        revokedAt: new Date("2026-05-01"),
      })
      mockPrisma.partnerApiKey.findUniqueOrThrow.mockResolvedValueOnce(
        buildRow({ revokedAt: new Date("2026-05-01") }),
      )

      const result = await revokePartnerKey(
        { keyId: "ABCDEFGHJKLM" },
        mockPrisma as never,
      )

      expect(result.revokedAt).toEqual(new Date("2026-05-01"))
      expect(mockPrisma.partnerApiKey.update).not.toHaveBeenCalled()
    })

    it("throws PartnerKeyNotFoundError for unknown keyIds", async () => {
      mockPrisma.partnerApiKey.findUnique.mockResolvedValueOnce(null)
      await expect(
        revokePartnerKey({ keyId: "missing-12345" }, mockPrisma as never),
      ).rejects.toBeInstanceOf(PartnerKeyNotFoundError)
    })
  })

  describe("rotatePartnerKey", () => {
    it("issues a new key for the same owner without revoking the old one", async () => {
      const old = buildRow({ keyId: "OLDKEYIDABCD" })
      mockPrisma.partnerApiKey.findUnique.mockResolvedValueOnce(old)
      mockPrisma.partnerApiKey.create.mockResolvedValueOnce(
        buildRow({ keyId: "NEWKEYIDABCD" }),
      )

      const { old: oldOut, fresh } = await rotatePartnerKey(
        { keyId: "OLDKEYIDABCD" },
        mockPrisma as never,
      )

      expect(oldOut.keyId).toBe("OLDKEYIDABCD")
      expect(fresh.keyId).toMatch(/^[A-Za-z2-9]{12}$/)
      expect(fresh.rawToken).toMatch(/^jfp_search_/)
      // Old row is NOT touched — caller revokes after partner cuts over.
      expect(mockPrisma.partnerApiKey.update).not.toHaveBeenCalled()
    })

    it("throws PartnerKeyNotFoundError for unknown keyIds", async () => {
      mockPrisma.partnerApiKey.findUnique.mockResolvedValueOnce(null)
      await expect(
        rotatePartnerKey({ keyId: "missing" }, mockPrisma as never),
      ).rejects.toBeInstanceOf(PartnerKeyNotFoundError)
    })
  })

  describe("listPartnerKeys", () => {
    it("filters out revoked rows by default", async () => {
      mockPrisma.partnerApiKey.findMany.mockResolvedValueOnce([buildRow()])
      await listPartnerKeys({}, mockPrisma as never)
      const arg = mockPrisma.partnerApiKey.findMany.mock.calls[0]![0]!
      expect(arg.where).toEqual({ revokedAt: null })
    })

    it("includes revoked when requested", async () => {
      mockPrisma.partnerApiKey.findMany.mockResolvedValueOnce([])
      await listPartnerKeys({ includeRevoked: true }, mockPrisma as never)
      const arg = mockPrisma.partnerApiKey.findMany.mock.calls[0]![0]!
      expect(arg.where).toEqual({})
    })

    it("sorts by lastUsedAt DESC NULLS LAST then createdAt DESC", async () => {
      mockPrisma.partnerApiKey.findMany.mockResolvedValueOnce([])
      await listPartnerKeys({}, mockPrisma as never)
      const arg = mockPrisma.partnerApiKey.findMany.mock.calls[0]![0]!
      expect(arg.orderBy).toEqual([
        { lastUsedAt: { sort: "desc", nulls: "last" } },
        { createdAt: "desc" },
      ])
    })
  })

  describe("verifyPartnerToken", () => {
    it("returns valid:false when authHeader is null", async () => {
      const res = await verifyPartnerToken(null, mockPrisma as never)
      expect(res).toEqual({ valid: false })
      expect(mockPrisma.partnerApiKey.findUnique).not.toHaveBeenCalled()
    })

    it("returns valid:false when token shape doesn't match jfp_search_", async () => {
      // Falls through without a DB call.
      const res = await verifyPartnerToken(
        "Bearer not-a-partner-token",
        mockPrisma as never,
      )
      expect(res).toEqual({ valid: false })
      expect(mockPrisma.partnerApiKey.findUnique).not.toHaveBeenCalled()
    })

    it("returns valid:false when keyId is not in DB", async () => {
      mockPrisma.partnerApiKey.findUnique.mockResolvedValueOnce(null)
      const { rawToken } = generatePartnerToken()
      const res = await verifyPartnerToken(
        `Bearer ${rawToken}`,
        mockPrisma as never,
      )
      expect(res).toEqual({ valid: false })
    })

    it("returns valid:false when row is revoked", async () => {
      const { rawToken, keyId, keyHash } = generatePartnerToken()
      mockPrisma.partnerApiKey.findUnique.mockResolvedValueOnce({
        keyId,
        keyHash,
        revokedAt: new Date(),
      })
      const res = await verifyPartnerToken(
        `Bearer ${rawToken}`,
        mockPrisma as never,
      )
      expect(res).toEqual({ valid: false })
    })

    it("returns valid:false when hash doesn't match (replay of a different token)", async () => {
      const { rawToken: presentedRaw, keyId } = generatePartnerToken()
      const { keyHash: storedHashForOther } = generatePartnerToken()
      mockPrisma.partnerApiKey.findUnique.mockResolvedValueOnce({
        keyId,
        keyHash: storedHashForOther, // different hash
        revokedAt: null,
      })
      const res = await verifyPartnerToken(
        `Bearer ${presentedRaw}`,
        mockPrisma as never,
      )
      expect(res).toEqual({ valid: false })
    })

    it("returns valid:true + keyId for a non-revoked matching row", async () => {
      const { rawToken, keyId, keyHash } = generatePartnerToken()
      mockPrisma.partnerApiKey.findUnique.mockResolvedValueOnce({
        keyId,
        keyHash,
        revokedAt: null,
      })
      // Make the lastUsedAt update resolve so .catch doesn't fire.
      mockPrisma.partnerApiKey.update.mockResolvedValueOnce(buildRow())
      const res = await verifyPartnerToken(
        `Bearer ${rawToken}`,
        mockPrisma as never,
      )
      expect(res).toEqual({ valid: true, keyId })
    })

    it("fires lastUsedAt update fire-and-forget on success (does not await)", async () => {
      const { rawToken, keyId, keyHash } = generatePartnerToken()
      mockPrisma.partnerApiKey.findUnique.mockResolvedValueOnce({
        keyId,
        keyHash,
        revokedAt: null,
      })
      let updateResolved = false
      mockPrisma.partnerApiKey.update.mockReturnValueOnce(
        new Promise((resolve) => {
          setTimeout(() => {
            updateResolved = true
            resolve(buildRow())
          }, 10)
        }) as never,
      )

      const res = await verifyPartnerToken(
        `Bearer ${rawToken}`,
        mockPrisma as never,
      )
      // Verify returned BEFORE the update resolved — proves fire-and-forget.
      expect(res).toEqual({ valid: true, keyId })
      expect(updateResolved).toBe(false)
    })

    it("does not crash when the lastUsedAt update REJECTS async", async () => {
      const { rawToken, keyId, keyHash } = generatePartnerToken()
      mockPrisma.partnerApiKey.findUnique.mockResolvedValueOnce({
        keyId,
        keyHash,
        revokedAt: null,
      })
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
      mockPrisma.partnerApiKey.update.mockRejectedValueOnce(
        new Error("simulated db write failure"),
      )

      const res = await verifyPartnerToken(
        `Bearer ${rawToken}`,
        mockPrisma as never,
      )
      expect(res).toEqual({ valid: true, keyId })
      // Give the .catch microtask a tick to run.
      await new Promise((r) => setImmediate(r))
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("event=partner_key.last_used_at_update_failed"),
      )
    })

    it("does not crash when the lastUsedAt update THROWS synchronously", async () => {
      const { rawToken, keyId, keyHash } = generatePartnerToken()
      mockPrisma.partnerApiKey.findUnique.mockResolvedValueOnce({
        keyId,
        keyHash,
        revokedAt: null,
      })
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
      mockPrisma.partnerApiKey.update.mockImplementationOnce(() => {
        throw new Error("simulated sync throw inside Prisma client")
      })

      const res = await verifyPartnerToken(
        `Bearer ${rawToken}`,
        mockPrisma as never,
      )
      expect(res).toEqual({ valid: true, keyId })
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("event=partner_key.last_used_at_update_failed"),
      )
    })

    it(
      "returns valid:false on DB timeout and logs partner_key.lookup_timeout",
      async () => {
        const { rawToken } = generatePartnerToken()
        // findUnique never resolves — Promise.race trips the budget.
        mockPrisma.partnerApiKey.findUnique.mockReturnValueOnce(
          neverResolving<never>() as never,
        )
        const error = vi.spyOn(console, "error").mockImplementation(() => {})

        const res = await verifyPartnerToken(
          `Bearer ${rawToken}`,
          mockPrisma as never,
        )
        expect(res).toEqual({ valid: false })
        expect(error).toHaveBeenCalledWith(
          expect.stringContaining("event=partner_key.lookup_timeout"),
        )
        expect(error).toHaveBeenCalledWith(
          expect.stringContaining(`budgetMs=${PARTNER_KEY_LOOKUP_TIMEOUT_MS}`),
        )
      },
      PARTNER_KEY_LOOKUP_TIMEOUT_MS + 1000,
    )

    it("returns valid:false on unexpected Prisma error and logs partner_key.lookup_error", async () => {
      const { rawToken } = generatePartnerToken()
      mockPrisma.partnerApiKey.findUnique.mockRejectedValueOnce(
        new Error("connection refused"),
      )
      const error = vi.spyOn(console, "error").mockImplementation(() => {})

      const res = await verifyPartnerToken(
        `Bearer ${rawToken}`,
        mockPrisma as never,
      )
      expect(res).toEqual({ valid: false })
      expect(error).toHaveBeenCalledWith(
        expect.stringContaining("event=partner_key.lookup_error"),
      )
    })
  })
})
