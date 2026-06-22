import { describe, expect, it } from "vitest"

import {
  handleExperienceChatRouteRequest,
  type ExperienceChatRouteMastra,
} from "./experience-chat-route"

const SERVICE_KEYS = ["test-service-key"] as const
const AUTH = "Bearer test-service-key"

function textStream(chunks: string[]): ReadableStream<string> {
  return new ReadableStream<string>({
    start(controller) {
      for (const c of chunks) controller.enqueue(c)
      controller.close()
    },
  })
}

function makeMastra(opts: {
  chunks?: string[]
  stream?: (
    prompt: string,
    o: { maxSteps?: number; abortSignal?: AbortSignal },
  ) => unknown
}): { mastra: ExperienceChatRouteMastra; streamCalls: unknown[] } {
  const streamCalls: unknown[] = []
  const stream =
    opts.stream ??
    ((prompt: string, o: unknown) => {
      streamCalls.push({ prompt, o })
      return { textStream: textStream(opts.chunks ?? []) }
    })
  const mastra: ExperienceChatRouteMastra = {
    getAgentById: (_id: string) => ({ stream }),
  }
  return { mastra, streamCalls }
}

async function readSse(res: Response): Promise<string> {
  return await res.text()
}

describe("handleExperienceChatRouteRequest", () => {
  it("returns 401 without a valid bearer", async () => {
    const { mastra } = makeMastra({})
    const res = await handleExperienceChatRouteRequest({
      authHeader: "Bearer wrong",
      serviceKeys: SERVICE_KEYS,
      readJson: async () => ({ prompt: "hi" }),
      getMastra: () => mastra,
    })
    expect(res.status).toBe(401)
  })

  it("returns 400 when the prompt is missing", async () => {
    const { mastra } = makeMastra({})
    const res = await handleExperienceChatRouteRequest({
      authHeader: AUTH,
      serviceKeys: SERVICE_KEYS,
      readJson: async () => ({}),
      getMastra: () => mastra,
    })
    expect(res.status).toBe(400)
  })

  it("streams token_delta frames then a result frame with producedBy", async () => {
    const { mastra, streamCalls } = makeMastra({ chunks: ["Hel", "lo"] })
    const res = await handleExperienceChatRouteRequest({
      authHeader: AUTH,
      serviceKeys: SERVICE_KEYS,
      readJson: async () => ({ prompt: "draft a page" }),
      getMastra: () => mastra,
    })
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toContain("text/event-stream")
    const body = await readSse(res)
    // Two token frames, in order, then the terminal result with the full text.
    expect(body).toContain('event: token_delta\ndata: {"text":"Hel"}')
    expect(body).toContain('event: token_delta\ndata: {"text":"lo"}')
    expect(body).toContain(
      'event: result\ndata: {"text":"Hello","producedBy":"experience-default-chat"}',
    )
    // The prompt + maxSteps were forwarded to the agent stream.
    expect(streamCalls).toHaveLength(1)
    expect((streamCalls[0] as { prompt: string }).prompt).toBe("draft a page")
  })

  it("emits an error frame when the agent stream throws", async () => {
    const { mastra } = makeMastra({
      stream: () => {
        throw new Error("provider exploded")
      },
    })
    const res = await handleExperienceChatRouteRequest({
      authHeader: AUTH,
      serviceKeys: SERVICE_KEYS,
      readJson: async () => ({ prompt: "x" }),
      getMastra: () => mastra,
    })
    expect(res.status).toBe(200)
    const body = await readSse(res)
    expect(body).toContain("event: error")
    expect(body).toContain('"reason":"generation_failed"')
  })
})
