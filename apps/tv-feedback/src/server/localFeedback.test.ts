import { randomUUID } from "node:crypto"
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import sharp from "sharp"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
const linear = vi.hoisted(() => ({
  createIssue: vi.fn(),
  findIssueByReference: vi.fn(),
  issueDetails: vi.fn(),
  uploadMedia: vi.fn(),
  attachMedia: vi.fn(),
}))
vi.mock("./linear", () => linear)

import {
  DELETE,
  GET,
  POST,
  PUT,
} from "../app/api/feedback/local/[...operation]/route"
import { localFeedbackConfig } from "./localConfig"
import { LOCAL_COOKIE } from "./localFeedback"

const origin = "http://192.168.1.25:3210"
let directory: string
let png: Buffer
async function call(
  operation: string,
  options: {
    method?: "POST" | "GET" | "PUT" | "DELETE"
    cookie?: string
    body?: unknown
    bytes?: Buffer
    headers?: Record<string, string>
  } = {},
) {
  const method = options.method ?? "POST"
  const request = new Request(`${origin}/api/feedback/local/${operation}`, {
    method,
    headers: {
      host: new URL(origin).host,
      origin,
      "content-type": options.bytes ? "image/png" : "application/json",
      ...(options.cookie ? { cookie: options.cookie } : {}),
      ...options.headers,
    },
    ...(method === "GET"
      ? {}
      : {
          body: options.bytes
            ? new Uint8Array(options.bytes)
            : JSON.stringify(options.body ?? {}),
        }),
  })
  return { GET, PUT, POST, DELETE }[method](request, {
    params: Promise.resolve({ operation: operation.split("/") }),
  })
}
async function session() {
  const response = await call("session")
  expect(response.status).toBe(201)
  const cookie = response.headers.get("set-cookie")!.split(";")[0]
  return { cookie, id: cookie.slice(LOCAL_COOKIE.length + 1).split(".")[0] }
}
async function upload(cookie: string) {
  const reserved = await call("uploads", {
    cookie,
    body: { name: "screen.png", size: png.length, type: "image/png" },
  })
  expect(reserved.status).toBe(201)
  const { uploadId } = (await reserved.json()) as { uploadId: string }
  expect(
    (await call(`uploads/${uploadId}`, { cookie, method: "PUT", bytes: png }))
      .status,
  ).toBe(200)
  return uploadId
}
function submission(uploadId: string) {
  return {
    category: "problem",
    flow: "photo",
    message: "Local simulator annotation test",
    tvContext: {
      platform: "apple-tv",
      appVersion: "1.0.0",
      screen: "settings",
    },
    consentPhoneContext: false,
    uploadIds: [uploadId],
    idempotencyKey: randomUUID(),
    turnstileToken: "",
    website: "",
    annotationMarks: [
      { id: "circle", type: "draw", x: 1, y: 2, points: [1, 2, 3, 4] },
    ],
  }
}
async function saved() {
  const owner = await session()
  const uploadId = await upload(owner.cookie)
  const body = submission(uploadId)
  const response = await call("submissions", { cookie: owner.cookie, body })
  expect(response.status).toBe(201)
  return { ...owner, uploadId, body, receipt: body.idempotencyKey }
}
beforeEach(async () => {
  // Even a future alias/mock regression must never contact a live service.
  vi.stubGlobal(
    "fetch",
    vi.fn().mockRejectedValue(new Error("unexpected_network_in_local_test")),
  )
  directory = await mkdtemp(path.join(tmpdir(), "tv-feedback-local-test-"))
  vi.stubEnv("NODE_ENV", "development")
  vi.stubEnv("FEEDBACK_LOCAL_ENABLED", "true")
  vi.stubEnv("FEEDBACK_LOCAL_BASE_URL", origin)
  vi.stubEnv("FEEDBACK_LOCAL_STORAGE_DIR", directory)
  vi.stubEnv("FEEDBACK_LOCAL_LINEAR_ENABLED", "false")
  png = await sharp({
    create: { width: 8, height: 8, channels: 3, background: "red" },
  })
    .png()
    .toBuffer()
  linear.createIssue.mockResolvedValue("issue-1")
  linear.issueDetails.mockResolvedValue({
    issueUrl: "https://linear.app/watch/issue/TV-1",
    issueIdentifier: "TV-1",
  })
  linear.findIssueByReference.mockResolvedValue(null)
  linear.uploadMedia.mockResolvedValue("https://uploads.linear.app/test.png")
  linear.attachMedia.mockResolvedValue(undefined)
})
afterEach(async () => {
  const networkCalls = vi.mocked(fetch).mock.calls.length
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.resetAllMocks()
  await rm(directory, { recursive: true, force: true })
  expect(networkCalls).toBe(0)
})

describe("local boundary", () => {
  it.each(["", "   "])(
    "uses the ignored capture default for a blank storage path",
    (value) => {
      vi.stubEnv("FEEDBACK_LOCAL_STORAGE_DIR", value)
      expect(localFeedbackConfig().directory).toBe(
        path.resolve("../../.local-tools/tv-feedback-captures"),
      )
    },
  )
  it.each(["production", "test"])(
    "returns 404 in %s even with both flags enabled",
    async (environment) => {
      vi.stubEnv("NODE_ENV", environment)
      vi.stubEnv("FEEDBACK_LOCAL_LINEAR_ENABLED", "true")
      for (const method of ["POST", "PUT", "GET", "DELETE"] as const)
        expect((await call("session", { method })).status).toBe(404)
      expect(await readdir(directory)).toEqual([])
      expect(linear.createIssue).not.toHaveBeenCalled()
    },
  )
  it("requires an explicit server switch", async () => {
    vi.stubEnv("FEEDBACK_LOCAL_ENABLED", "false")
    expect((await call("session")).status).toBe(404)
  })
  it.each([
    "https://192.168.1.25:3210",
    "http://example.com:3210",
    "http://192.168.1.25:3210/path",
    "http://user:secret@192.168.1.25:3210",
  ])("rejects a nonlocal or noncanonical base %s", (base) => {
    vi.stubEnv("FEEDBACK_LOCAL_BASE_URL", base)
    expect(() => localFeedbackConfig()).toThrow()
  })
  it("rejects cross-origin and DNS-rebinding requests", async () => {
    expect(
      (await call("session", { headers: { origin: "http://evil.example" } }))
        .status,
    ).toBe(403)
    expect(
      (await call("session", { headers: { host: "evil.example:3210" } }))
        .status,
    ).toBe(403)
    expect(
      (await call("session", { headers: { "sec-fetch-site": "cross-site" } }))
        .status,
    ).toBe(403)
    expect(await readdir(directory)).toEqual([])
  })
  it("uses a separate HttpOnly strict cookie, reuses it and rejects a forged token", async () => {
    const response = await call("session")
    const cookie = response.headers.get("set-cookie")!
    expect(cookie).toContain("HttpOnly")
    expect(cookie).toContain("SameSite=strict")
    expect(cookie).toContain("Path=/api/feedback/local")
    expect(
      (await call("session", { cookie: cookie.split(";")[0] })).status,
    ).toBe(200)
    expect(
      (
        await call("uploads", {
          cookie: `${cookie.split(";")[0]}forged`,
          body: {},
        })
      ).status,
    ).toBe(401)
  })
  it("does not cross sessions for uploads or reports", async () => {
    const owner = await saved(),
      stranger = await session()
    for (const method of ["GET", "PUT", "DELETE"] as const) {
      expect(
        (
          await call(`uploads/${owner.uploadId}`, {
            cookie: stranger.cookie,
            method,
            ...(method === "PUT" ? { bytes: png } : {}),
          })
        ).status,
      ).toBe(404)
    }
    expect(
      (
        await call("status", {
          cookie: stranger.cookie,
          body: { receipt: owner.receipt },
        })
      ).status,
    ).toBe(404)
    expect(
      (await call("submissions", { cookie: stranger.cookie, body: owner.body }))
        .status,
    ).toBe(404)
  })
  it("expires the session without deleting evidence", async () => {
    const owner = await saved()
    const filename = path.join(directory, owner.id, "session.json")
    const state = JSON.parse(await readFile(filename, "utf8"))
    state.expiresAt = Date.now() - 1
    await writeFile(filename, JSON.stringify(state))
    expect(
      (
        await call("status", {
          cookie: owner.cookie,
          body: { receipt: owner.receipt },
        })
      ).status,
    ).toBe(401)
    expect((await readdir(path.join(directory, owner.id))).length).toBe(3)
  })
})

describe("local evidence", () => {
  it("saves real image bytes, normalized evidence, annotation marks and TV context without Linear", async () => {
    const owner = await saved()
    const state = JSON.parse(
      await readFile(path.join(directory, owner.id, "session.json"), "utf8"),
    )
    expect(state.reports[owner.receipt].submission.annotationMarks).toEqual(
      owner.body.annotationMarks,
    )
    expect(state.reports[owner.receipt].submission.tvContext).toEqual(
      owner.body.tvContext,
    )
    expect(
      state.reports[owner.receipt].submission.turnstileToken,
    ).toBeUndefined()
    expect(
      await readFile(
        path.join(directory, owner.id, `${owner.uploadId}.source`),
      ),
    ).toEqual(png)
    expect(
      (
        await sharp(
          path.join(directory, owner.id, `${owner.uploadId}.jpg`),
        ).metadata()
      ).format,
    ).toBe("jpeg")
    expect(
      await (
        await call("status", {
          cookie: owner.cookie,
          body: { receipt: owner.receipt },
        })
      ).json(),
    ).toMatchObject({ status: "local_saved" })
    expect(linear.createIssue).not.toHaveBeenCalled()
  })
  it("keeps duplicate submissions idempotent and rejects changed retries", async () => {
    const owner = await saved()
    expect(
      await (
        await call("submissions", { cookie: owner.cookie, body: owner.body })
      ).json(),
    ).toEqual({ receipt: owner.receipt, status: "local_saved" })
    expect(
      (
        await call("submissions", {
          cookie: owner.cookie,
          body: {
            ...owner.body,
            message: "Changed payload cannot silently replace evidence",
          },
        })
      ).status,
    ).toBe(409)
    expect(
      (
        await call(`uploads/${owner.uploadId}`, {
          cookie: owner.cookie,
          method: "DELETE",
        })
      ).status,
    ).toBe(409)
  })
  it("rejects unready, oversize, invalid and nonimage uploads", async () => {
    const owner = await session()
    expect(
      (
        await call("uploads", {
          cookie: owner.cookie,
          body: {
            name: "large.jpg",
            type: "image/jpeg",
            size: 11 * 1024 * 1024,
          },
        })
      ).status,
    ).toBe(400)
    expect(
      (
        await call("uploads", {
          cookie: owner.cookie,
          body: { name: "video.mp4", type: "video/mp4", size: 16 },
        })
      ).status,
    ).toBe(400)
    const reserved = (await (
      await call("uploads", {
        cookie: owner.cookie,
        body: { name: "bad.png", type: "image/png", size: 8 },
      })
    ).json()) as { uploadId: string }
    expect(
      (
        await call("submissions", {
          cookie: owner.cookie,
          body: submission(reserved.uploadId),
        })
      ).status,
    ).toBe(409)
    expect(
      (
        await call(`uploads/${reserved.uploadId}`, {
          cookie: owner.cookie,
          method: "PUT",
          bytes: Buffer.from("notimage"),
        })
      ).status,
    ).toBe(422)
  })
  it("enforces cumulative reservation and session limits without deleting evidence", async () => {
    const owner = await session()
    for (let i = 0; i < 6; i++)
      expect(
        (
          await call("uploads", {
            cookie: owner.cookie,
            body: { name: "a.png", type: "image/png", size: 10 * 1024 * 1024 },
          })
        ).status,
      ).toBe(201)
    expect(
      (
        await call("uploads", {
          cookie: owner.cookie,
          body: { name: "a.png", type: "image/png", size: 1 },
        })
      ).status,
    ).toBe(429)
    for (let i = 0; i < 31; i++) await session()
    expect((await call("session")).status).toBe(429)
  })
  it("fails closed when an earlier writer lock remains", async () => {
    await mkdir(path.join(directory, ".writer-lock"))
    expect((await call("session")).status).toBe(409)
    expect(await readdir(directory)).toEqual([".writer-lock"])
  })
})

describe("explicit Linear forwarding", () => {
  function enable() {
    vi.stubEnv("FEEDBACK_LOCAL_LINEAR_ENABLED", "true")
    vi.stubEnv("FEEDBACK_LINEAR_API_KEY", "mock-key-never-used-on-network")
    vi.stubEnv("FEEDBACK_LINEAR_TEAM_ID", "mock-team")
    vi.stubEnv("FEEDBACK_LINEAR_PROJECT_ID", "mock-project")
  }
  it("does not forward until separately enabled and configured", async () => {
    const owner = await saved()
    expect(
      (
        await call("linear", {
          cookie: owner.cookie,
          body: { receipt: owner.receipt },
        })
      ).status,
    ).toBe(404)
    vi.stubEnv("FEEDBACK_LOCAL_LINEAR_ENABLED", "true")
    vi.stubEnv("FEEDBACK_LINEAR_PROJECT_ID", "")
    expect(
      (
        await call("linear", {
          cookie: owner.cookie,
          body: { receipt: owner.receipt },
        })
      ).status,
    ).toBe(503)
    expect(linear.createIssue).not.toHaveBeenCalled()
  })
  it("confirms issue and attachment, with duplicate send producing no extra writes", async () => {
    enable()
    const owner = await saved()
    for (let i = 0; i < 2; i++)
      expect(
        await (
          await call("linear", {
            cookie: owner.cookie,
            body: { receipt: owner.receipt },
          })
        ).json(),
      ).toMatchObject({ status: "delivered", issueIdentifier: "TV-1" })
    expect(linear.createIssue).toHaveBeenCalledTimes(1)
    expect(linear.createIssue).toHaveBeenCalledWith(
      expect.objectContaining({
        id: `LOCAL-SIMULATOR-${owner.receipt}`,
        message: expect.stringContaining("[LOCAL SIMULATOR TEST]"),
      }),
      { title: "[SIMULATOR TEST] Local simulator annotation test" },
    )
    expect(linear.uploadMedia).toHaveBeenCalledTimes(1)
    expect(linear.attachMedia).toHaveBeenCalledTimes(1)
  })
  it("never retries an uncertain issue creation", async () => {
    enable()
    linear.createIssue.mockRejectedValue(new Error("response_lost"))
    const owner = await saved()
    for (let i = 0; i < 2; i++)
      expect(
        await (
          await call("linear", {
            cookie: owner.cookie,
            body: { receipt: owner.receipt },
          })
        ).json(),
      ).toMatchObject({ status: "needs_attention" })
    expect(linear.createIssue).toHaveBeenCalledTimes(1)
    expect(linear.findIssueByReference).toHaveBeenCalledTimes(1)
    expect(linear.attachMedia).not.toHaveBeenCalled()
  })
  it("preserves partial evidence and does not report delivery or retry uncertain attachments", async () => {
    enable()
    linear.attachMedia.mockRejectedValue(new Error("response_lost"))
    const owner = await saved()
    for (let i = 0; i < 2; i++)
      expect(
        await (
          await call("linear", {
            cookie: owner.cookie,
            body: { receipt: owner.receipt },
          })
        ).json(),
      ).toMatchObject({ status: "needs_attention", issueIdentifier: "TV-1" })
    expect(linear.createIssue).toHaveBeenCalledTimes(1)
    expect(linear.uploadMedia).toHaveBeenCalledTimes(1)
    expect(linear.attachMedia).toHaveBeenCalledTimes(1)
    expect(
      await readFile(
        path.join(directory, owner.id, `${owner.uploadId}.source`),
      ),
    ).toEqual(png)
  })
})
