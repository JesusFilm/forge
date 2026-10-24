import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mockEnv = vi.hoisted(() => ({
  env: {
    BACKUP_DOWNLOAD_API_KEYS: "dev-token,stg-token",
    RAILWAY_S3_BUCKET: "admin-db-backups",
    RAILWAY_S3_ENDPOINT: "https://storage.example.com",
    RAILWAY_S3_REGION: "auto",
    RAILWAY_S3_ACCESS_KEY_ID: "access-key",
    RAILWAY_S3_SECRET_ACCESS_KEY: "secret-key",
  },
}))

const rateLimitAuthRoute = vi.hoisted(() => vi.fn())
const sendMock = vi.hoisted(() => vi.fn())
const destroyMock = vi.hoisted(() => vi.fn())
const getSignedUrl = vi.hoisted(() => vi.fn())

vi.mock("@/config/env", () => mockEnv)
vi.mock("@/auth/rate-limit", () => ({ rateLimitAuthRoute }))
vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: vi.fn(() => ({ send: sendMock, destroy: destroyMock })),
  ListObjectsV2Command: vi.fn((input) => ({ kind: "ListObjectsV2", input })),
  GetObjectCommand: vi.fn((input) => ({ kind: "GetObject", input })),
}))
vi.mock("@aws-sdk/s3-request-presigner", () => ({ getSignedUrl }))

function makePost({
  authorization = "Bearer dev-token",
  body = { profile: "video-core" },
}: {
  authorization?: string
  body?: unknown
} = {}): Request {
  return new Request("http://localhost/api/internal/video-db-backups/presign", {
    method: "POST",
    headers: {
      authorization,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  })
}

describe("video DB backup presign endpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(Date, "now").mockReturnValue(
      new Date("2026-05-15T00:00:00.000Z").getTime(),
    )
    mockEnv.env.BACKUP_DOWNLOAD_API_KEYS = "dev-token,stg-token"
    mockEnv.env.RAILWAY_S3_BUCKET = "admin-db-backups"
    rateLimitAuthRoute.mockResolvedValue({ allowed: true, source: "local" })
    sendMock.mockResolvedValue({
      Contents: [
        {
          Key: "admin-video-db-backups/video-core/old.dump",
          LastModified: new Date("2026-05-13T00:00:00Z"),
          Size: 10,
        },
        {
          Key: "admin-video-db-backups/video-core/new.dump",
          LastModified: new Date("2026-05-14T00:00:00Z"),
          Size: 20,
        },
      ],
    })
    getSignedUrl.mockResolvedValue("https://signed.example.com/new.dump")
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("rejects GET", async () => {
    const { GET } = await import("./route")
    const res = await GET()

    expect(res.status).toBe(405)
    expect(res.headers.get("allow")).toBe("POST")
  })

  it("rejects requests without a configured bearer token", async () => {
    const { POST } = await import("./route")
    const res = await POST(makePost({ authorization: "Bearer wrong-token" }))

    expect(res.status).toBe(401)
    expect(sendMock).not.toHaveBeenCalled()
  })

  it("rejects invalid profiles", async () => {
    const { POST } = await import("./route")
    const res = await POST(makePost({ body: { profile: "everything" } }))

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: "invalid-profile" })
    expect(sendMock).not.toHaveBeenCalled()
  })

  it("rate-limits before authorizing", async () => {
    rateLimitAuthRoute.mockResolvedValueOnce({
      allowed: false,
      source: "local",
    })
    const { POST } = await import("./route")
    const res = await POST(makePost())

    expect(res.status).toBe(429)
    expect(sendMock).not.toHaveBeenCalled()
  })

  it("returns a clean configuration error when backup storage is not configured", async () => {
    mockEnv.env.RAILWAY_S3_BUCKET = ""
    const { POST } = await import("./route")
    const res = await POST(makePost())

    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toEqual({
      error: "backup-storage-not-configured",
    })
    expect(sendMock).not.toHaveBeenCalled()
  })

  it("signs a short-lived GET URL for the latest backup in the requested profile", async () => {
    const { POST } = await import("./route")
    const res = await POST(makePost())

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({
      url: "https://signed.example.com/new.dump",
      profile: "video-core",
      key: "admin-video-db-backups/video-core/new.dump",
      expiresInSeconds: 600,
      size: 20,
      lastModified: "2026-05-14T00:00:00.000Z",
      freshness: expect.objectContaining({
        status: "fresh",
        ageMilliseconds: 24 * 60 * 60 * 1000,
      }),
    })
    expect(getSignedUrl).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        input: {
          Bucket: "admin-db-backups",
          Key: "admin-video-db-backups/video-core/new.dump",
        },
      }),
      { expiresIn: 600 },
    )
    expect(destroyMock).toHaveBeenCalled()
  })

  it("paginates the complete profile prefix before selecting the newest object", async () => {
    sendMock
      .mockResolvedValueOnce({
        Contents: [
          {
            Key: "admin-video-db-backups/video-search/first-page.dump",
            LastModified: new Date("2026-05-13T00:00:00Z"),
          },
        ],
        IsTruncated: true,
        NextContinuationToken: "next-page",
      })
      .mockResolvedValueOnce({
        Contents: [
          {
            Key: "admin-video-db-backups/video-search/newest.dump",
            LastModified: new Date("2026-05-14T12:00:00Z"),
          },
        ],
        IsTruncated: false,
      })

    const { POST } = await import("./route")
    const res = await POST(makePost({ body: { profile: "video-search" } }))

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({
      profile: "video-search",
      key: "admin-video-db-backups/video-search/newest.dump",
      freshness: { status: "fresh" },
    })
    expect(sendMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        input: expect.objectContaining({ ContinuationToken: "next-page" }),
      }),
    )
  })

  it("classifies an object exactly 36 hours old as fresh", async () => {
    sendMock.mockResolvedValueOnce({
      Contents: [
        {
          Key: "admin-video-db-backups/video-core/threshold.dump",
          LastModified: new Date("2026-05-13T12:00:00Z"),
        },
      ],
    })

    const { POST } = await import("./route")
    const res = await POST(makePost())

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({
      freshness: {
        status: "fresh",
        ageMilliseconds: 36 * 60 * 60 * 1000,
      },
    })
  })

  it("returns stale signed metadata for restore acknowledgement", async () => {
    sendMock.mockResolvedValueOnce({
      Contents: [
        {
          Key: "admin-video-db-backups/video-core/stale.dump",
          LastModified: new Date("2026-05-13T11:59:59.999Z"),
        },
      ],
    })

    const { POST } = await import("./route")
    const res = await POST(makePost())

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({
      key: "admin-video-db-backups/video-core/stale.dump",
      freshness: { status: "stale" },
    })
    expect(getSignedUrl).toHaveBeenCalledOnce()
  })

  it("returns the deliberate not-found contract without signing", async () => {
    sendMock.mockResolvedValueOnce({ Contents: [] })

    const { POST } = await import("./route")
    const res = await POST(makePost())

    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toMatchObject({
      error: "backup-not-found",
      profile: "video-core",
      freshness: { status: "not-found" },
    })
    expect(getSignedUrl).not.toHaveBeenCalled()
  })

  it.each([undefined, new Date("invalid")])(
    "returns unavailable metadata without signing for timestamp %s",
    async (lastModified) => {
      sendMock.mockResolvedValueOnce({
        Contents: [
          {
            Key: "admin-video-db-backups/video-core/unusable.dump",
            LastModified: lastModified,
          },
        ],
      })

      const { POST } = await import("./route")
      const res = await POST(makePost())

      expect(res.status).toBe(503)
      await expect(res.json()).resolves.toMatchObject({
        error: "backup-freshness-unavailable",
        profile: "video-core",
        freshness: {
          status: "unavailable-metadata",
          key: "admin-video-db-backups/video-core/unusable.dump",
        },
      })
      expect(getSignedUrl).not.toHaveBeenCalled()
    },
  )

  it("returns a clean storage error without leaking provider details", async () => {
    sendMock.mockRejectedValueOnce(
      new Error(
        "secret-key https://signed.example.com/private.dump?credential=private",
      ),
    )

    const { POST } = await import("./route")
    const res = await POST(makePost())
    const body = await res.text()

    expect(res.status).toBe(503)
    expect(body).toBe('{"error":"backup-storage-unavailable"}')
    expect(body).not.toContain("secret-key")
    expect(body).not.toContain("signed.example.com")
    expect(getSignedUrl).not.toHaveBeenCalled()
  })

  it("does not log the bearer token", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined)
    try {
      const { POST } = await import("./route")
      await POST(makePost({ authorization: "Bearer dev-token" }))
    } finally {
      info.mockRestore()
    }

    const combined = info.mock.calls.flat().join("\n")
    expect(combined).not.toContain("dev-token")
    expect(combined).not.toContain("Bearer ")
  })
})
