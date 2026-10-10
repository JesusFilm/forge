import { beforeEach, describe, expect, it, vi } from "vitest"

const resolvePrincipalFromRequest = vi.hoisted(() => vi.fn())
const dispatchCoreSync = vi.hoisted(() => vi.fn())

vi.mock("@/auth/session", () => ({ resolvePrincipalFromRequest }))
vi.mock("@/services/core-sync/job", () => ({ dispatchCoreSync }))

function makePost(): Request {
  return new Request("http://localhost/api/core-sync/manual", {
    method: "POST",
  })
}

describe("manual Core sync endpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("rejects unauthenticated callers", async () => {
    resolvePrincipalFromRequest.mockResolvedValueOnce(null)
    const { POST } = await import("./route")
    const res = await POST(makePost())

    expect(res.status).toBe(403)
    expect(dispatchCoreSync).not.toHaveBeenCalled()
  })

  it("rejects callers without workflow trigger permission", async () => {
    resolvePrincipalFromRequest.mockResolvedValueOnce({
      id: "viewer-1",
      role: "VIEWER",
    })
    const { POST } = await import("./route")
    const res = await POST(makePost())

    expect(res.status).toBe(403)
    expect(dispatchCoreSync).not.toHaveBeenCalled()
  })

  it("dispatches one manual incremental sync for admins", async () => {
    resolvePrincipalFromRequest.mockResolvedValueOnce({
      id: "admin-1",
      role: "ADMIN",
    })
    dispatchCoreSync.mockResolvedValueOnce({
      workflow: "core-sync",
      runId: "run-manual-1",
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
      trigger: "manual",
      status: "queued",
    })
    const { POST } = await import("./route")
    const res = await POST(makePost())

    expect(res.status).toBe(202)
    await expect(res.json()).resolves.toMatchObject({
      ok: true,
      dispatch: {
        workflow: "core-sync",
        runId: "run-manual-1",
        incremental: true,
        trigger: "manual",
        status: "queued",
      },
    })
    expect(dispatchCoreSync).toHaveBeenCalledTimes(1)
    expect(dispatchCoreSync).toHaveBeenCalledWith({
      incremental: true,
      trigger: "manual",
    })
  })
})
