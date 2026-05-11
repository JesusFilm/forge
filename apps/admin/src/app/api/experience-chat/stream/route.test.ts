import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ChatStreamEvent } from "@/services/experience-ai/experience-ai-chat.service"

vi.mock("@/auth/rate-limit", () => ({
  rateLimitAuthRoute: vi.fn(),
}))

vi.mock("@/auth/session", () => ({
  resolvePrincipalFromRequest: vi.fn(),
}))

const { streamChatTurnMock } = vi.hoisted(() => ({
  streamChatTurnMock: vi.fn(),
}))
vi.mock("@/services/experience-ai/experience-ai-chat.service", () => ({
  streamChatTurn: streamChatTurnMock,
}))

vi.mock("@/db/client", () => ({ prisma: {} }))

import { rateLimitAuthRoute } from "@/auth/rate-limit"
import { resolvePrincipalFromRequest } from "@/auth/session"
import { POST } from "./route"

function postJson(body: unknown, opts?: { signal?: AbortSignal }): Request {
  return new Request("http://localhost/api/experience-chat/stream", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: opts?.signal,
  })
}

function allow() {
  vi.mocked(rateLimitAuthRoute).mockResolvedValue({
    allowed: true,
    source: "local",
  })
}

function deny() {
  vi.mocked(rateLimitAuthRoute).mockResolvedValue({
    allowed: false,
    source: "local",
  })
}

function asEditor() {
  vi.mocked(resolvePrincipalFromRequest).mockResolvedValue({
    id: "editor-1",
    role: "EDITOR",
  })
}

async function readSseFrames(response: Response): Promise<string[]> {
  const text = await response.text()
  return text
    .split("\n\n")
    .map((frame) => frame.trim())
    .filter((frame) => frame.length > 0)
}

async function* eventGenerator(
  events: ChatStreamEvent[],
): AsyncIterable<ChatStreamEvent> {
  for (const e of events) {
    yield e
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  allow()
  asEditor()
  streamChatTurnMock.mockReset()
})

describe("POST /api/experience-chat/stream", () => {
  it("returns 429 when rate-limited", async () => {
    deny()
    const res = await POST(postJson({ threadId: "t", prompt: "hi" }))
    expect(res.status).toBe(429)
    expect(streamChatTurnMock).not.toHaveBeenCalled()
  })

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(resolvePrincipalFromRequest).mockResolvedValue(null)
    const res = await POST(postJson({ threadId: "t", prompt: "hi" }))
    expect(res.status).toBe(401)
    expect(streamChatTurnMock).not.toHaveBeenCalled()
  })

  it("returns 403 when principal lacks write:experiences", async () => {
    vi.mocked(resolvePrincipalFromRequest).mockResolvedValue({
      id: "viewer-1",
      role: "VIEWER",
    })
    const res = await POST(postJson({ threadId: "t", prompt: "hi" }))
    expect(res.status).toBe(403)
    expect(streamChatTurnMock).not.toHaveBeenCalled()
  })

  it("returns 400 on invalid body", async () => {
    const res = await POST(postJson({ threadId: "" }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe("Invalid request body")
  })

  it("streams scripted events as SSE frames on the happy path", async () => {
    streamChatTurnMock.mockReturnValue(
      eventGenerator([
        { type: "token_delta", text: "Hello" },
        { type: "token_delta", text: "world" },
        {
          type: "mutation_applied",
          messageId: "msg-1",
          diff: { scalars: {} },
        },
        { type: "done", messageId: "msg-1" },
      ]),
    )

    const res = await POST(postJson({ threadId: "t1", prompt: "hi" }))
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toBe(
      "text/event-stream; charset=utf-8",
    )

    const frames = await readSseFrames(res)
    expect(frames).toHaveLength(4)

    expect(frames[0]).toMatch(/^event: token_delta/)
    expect(frames[0]).toContain('"text":"Hello"')
    expect(frames[2]).toMatch(/^event: mutation_applied/)
    expect(frames[3]).toMatch(/^event: done/)
  })

  it("forwards confirmedAcrossLocales through to the service", async () => {
    streamChatTurnMock.mockReturnValue(
      eventGenerator([{ type: "done", messageId: "m" }]),
    )

    await POST(
      postJson({
        threadId: "t1",
        prompt: "hi",
        confirmedAcrossLocales: true,
      }),
    )

    expect(streamChatTurnMock).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: "t1",
        prompt: "hi",
        confirmedAcrossLocales: true,
      }),
      expect.objectContaining({
        user: expect.objectContaining({ role: "EDITOR" }),
      }),
    )
  })

  it("emits an error frame when the service throws mid-stream", async () => {
    async function* throwing(): AsyncIterable<ChatStreamEvent> {
      yield { type: "token_delta", text: "partial" }
      throw new Error("boom")
    }
    streamChatTurnMock.mockReturnValue(throwing())

    const res = await POST(postJson({ threadId: "t1", prompt: "hi" }))
    const frames = await readSseFrames(res)
    expect(frames.find((f) => f.startsWith("event: error"))).toBeDefined()
  })

  it("passes request.signal to the service", async () => {
    streamChatTurnMock.mockReturnValue(
      eventGenerator([{ type: "done", messageId: "m" }]),
    )
    const controller = new AbortController()
    await POST(
      postJson({ threadId: "t1", prompt: "hi" }, { signal: controller.signal }),
    )
    const callDeps = streamChatTurnMock.mock.calls[0][1]
    expect(callDeps.abortSignal).toBeDefined()
  })
})
