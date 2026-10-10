import { beforeEach, describe, expect, it, vi } from "vitest"

const mockEnv = vi.hoisted(() => ({
  env: {
    CORE_SYNC_CRON_SECRET: "cron-secret",
  },
}))
const dispatchCoreSync = vi.hoisted(() => vi.fn())

vi.mock("@/config/env", () => mockEnv)
vi.mock("@/services/core-sync/job", () => ({ dispatchCoreSync }))

function makePost(
  headers: Record<string, string> = {},
  body?: unknown,
): Request {
  return new Request("http://localhost/api/core-sync/scheduled", {
    method: "POST",
    headers,
    body: body == null ? undefined : JSON.stringify(body),
  })
}

describe("scheduled Core sync endpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockEnv.env.CORE_SYNC_CRON_SECRET = "cron-secret"
  })

  it("rejects GET", async () => {
    const { GET } = await import("./route")
    const res = await GET()

    expect(res.status).toBe(405)
    expect(res.headers.get("allow")).toBe("POST")
  })

  it("rejects POST without auth", async () => {
    const { POST } = await import("./route")
    const res = await POST(makePost())

    expect(res.status).toBe(401)
    expect(dispatchCoreSync).not.toHaveBeenCalled()
  })

  it("rejects POST with the wrong bearer secret", async () => {
    const { POST } = await import("./route")
    const res = await POST(makePost({ authorization: "Bearer wrong-secret" }))

    expect(res.status).toBe(401)
    expect(dispatchCoreSync).not.toHaveBeenCalled()
  })

  it("rejects POST when the endpoint secret is not configured", async () => {
    mockEnv.env.CORE_SYNC_CRON_SECRET = ""
    const { POST } = await import("./route")
    const res = await POST(makePost({ authorization: "Bearer cron-secret" }))

    expect(res.status).toBe(401)
    expect(dispatchCoreSync).not.toHaveBeenCalled()
  })

  it("dispatches one scheduled incremental all-scope sync with valid auth", async () => {
    dispatchCoreSync.mockResolvedValueOnce({
      workflow: "core-sync",
      runId: "run-scheduled-1",
      scope: [
        "languages",
        "countries",
        "keywords",
        "video-origins",
        "videos",
        "video-images",
        "video-editions",
        "video-subtitles",
        "video-dubs",
        "video-dub-downloads",
      ],
      incremental: true,
      trigger: "scheduled",
      status: "queued",
    })
    const { POST } = await import("./route")
    const res = await POST(makePost({ authorization: "Bearer cron-secret" }))

    expect(res.status).toBe(202)
    await expect(res.json()).resolves.toMatchObject({
      ok: true,
      dispatch: {
        workflow: "core-sync",
        runId: "run-scheduled-1",
        incremental: true,
        trigger: "scheduled",
        status: "queued",
      },
    })
    expect(dispatchCoreSync).toHaveBeenCalledTimes(1)
    expect(dispatchCoreSync).toHaveBeenCalledWith({
      incremental: true,
      scope: undefined,
      trigger: "scheduled",
    })
  })

  it("dispatches a requested full scoped sync with valid auth", async () => {
    dispatchCoreSync.mockResolvedValueOnce({
      workflow: "core-sync",
      runId: "run-scheduled-full",
      scope: ["languages", "videos"],
      incremental: false,
      trigger: "scheduled",
      status: "queued",
    })
    const { POST } = await import("./route")
    const res = await POST(
      makePost(
        {
          authorization: "Bearer cron-secret",
          "content-type": "application/json",
        },
        { incremental: false, scope: "languages,videos" },
      ),
    )

    expect(res.status).toBe(202)
    expect(dispatchCoreSync).toHaveBeenCalledWith({
      incremental: false,
      scope: ["languages", "videos"],
      trigger: "scheduled",
    })
  })

  it("rejects invalid scheduled sync options", async () => {
    const { POST } = await import("./route")
    const res = await POST(
      makePost(
        {
          authorization: "Bearer cron-secret",
          "content-type": "application/json",
        },
        { incremental: "false" },
      ),
    )

    expect(res.status).toBe(400)
    expect(dispatchCoreSync).not.toHaveBeenCalled()
  })
})
