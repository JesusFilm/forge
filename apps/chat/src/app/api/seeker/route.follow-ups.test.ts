// feat-366 U2: the optional promptSource click-source tag crossing this proxy
// (split from route.test.ts so neither file crosses the 1k-line bar).
import { describe, expect, it, vi } from "vitest"

import {
  handleSeekerProxyRequest,
  type SeekerProxyConfig,
  type SeekerProxyHandlerInput,
} from "./route"
import type { SeekerGateDecision } from "@/lib/seeker-gate"
import { encodeSseFrame, readSseStream } from "@/lib/sse"

const GRANTED: SeekerGateDecision = { seekerEnabled: true, outcome: "granted" }

function runProxy(
  input: Omit<SeekerProxyHandlerInput, "resourceId" | "resolveGate"> & {
    resourceId?: string
    resolveGate?: SeekerProxyHandlerInput["resolveGate"]
  },
): Promise<Response> {
  return handleSeekerProxyRequest({
    resourceId: "anon:00000000-0000-4000-8000-000000000000",
    resolveGate: () => Promise.resolve(GRANTED),
    ...input,
  })
}

const BASE_CONFIG: SeekerProxyConfig = {
  baseUrl: "https://mastra.internal",
  apiKey: "svc-key",
  allowedHosts: undefined,
  requireAllowlist: false,
  timeoutMs: 95000,
}

function upstream(
  frames: Array<{ event: string; data: unknown }>,
  status = 200,
): Response {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const f of frames) {
        controller.enqueue(encoder.encode(encodeSseFrame(f.event, f.data)))
      }
      controller.close()
    },
  })
  return new Response(body, {
    status,
    headers: { "content-type": "text/event-stream" },
  })
}

async function proxyFrames(
  response: Response,
): Promise<Array<{ event: string; data: unknown }>> {
  const frames: Array<{ event: string; data: unknown }> = []
  if (response.body == null) return frames
  await readSseStream(response.body, (event, data) =>
    frames.push({ event, data }),
  )
  return frames
}

function readJson(body: unknown) {
  return () => Promise.resolve(body)
}

describe("handleSeekerProxyRequest — promptSource click-source tag (feat-366, KTD11)", () => {
  // The guard FORWARDS a valid enum and never INVENTS one. Anything else is
  // dropped as absent — an invalid value is never a 400, because a junk tag
  // must not cost the person their answer.
  async function upstreamBodyFor(promptSource: unknown) {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        upstream([
          { event: "result", data: { text: "a", sources: [], grounded: true } },
        ]),
      )
    const raw: Record<string, unknown> = { text: "hi", conversationId: "c1" }
    if (promptSource !== undefined) raw.promptSource = promptSource
    const res = await runProxy({
      readJson: readJson(raw),
      config: BASE_CONFIG,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(res.status).toBe(200)
    await proxyFrames(res)
    return JSON.parse(
      (fetchImpl.mock.calls[0][1] as RequestInit).body as string,
    ) as Record<string, unknown>
  }

  it("forwards the valid enum verbatim to /forge-seeker", async () => {
    expect((await upstreamBodyFor("follow_up")).promptSource).toBe("follow_up")
  })

  it("OMITS the key when the client sent none (a typed send)", async () => {
    expect("promptSource" in (await upstreamBodyFor(undefined))).toBe(false)
  })

  it.each([
    ["an unknown vocabulary value", "typed"],
    ["an adjacent unknown value", "followup"],
    ["a case variant", "FOLLOW_UP"],
    ["a non-string", 7],
    ["an object", { source: "follow_up" }],
    ["an array", ["follow_up"]],
    ["null", null],
    ["the empty string", ""],
  ])("DROPS %s rather than forwarding it", async (_label, value) => {
    expect("promptSource" in (await upstreamBodyFor(value))).toBe(false)
  })

  it("never 400s over an invalid tag — the answer still streams", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        upstream([
          { event: "result", data: { text: "a", sources: [], grounded: true } },
        ]),
      )
    const res = await runProxy({
      readJson: readJson({
        text: "hi",
        conversationId: "c1",
        promptSource: { evil: true },
      }),
      config: BASE_CONFIG,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(res.status).toBe(200)
    const frames = await proxyFrames(res)
    expect(frames.map((f) => f.event)).toEqual(["result"])
  })

  it("relays the terminal frame's followUps to the browser untouched", async () => {
    // The proxy re-emits `result` verbatim (chat's seam is the projection
    // point) — this pins that the new field is not dropped in transit.
    const fetchImpl = vi.fn().mockResolvedValue(
      upstream([
        {
          event: "result",
          data: {
            text: "a",
            sources: [],
            grounded: true,
            followUps: ["Why pray?"],
          },
        },
      ]),
    )
    const res = await runProxy({
      readJson: readJson({ text: "hi", conversationId: "c1" }),
      config: BASE_CONFIG,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    const frames = await proxyFrames(res)
    expect((frames[0].data as { followUps?: unknown }).followUps).toEqual([
      "Why pray?",
    ])
  })
})
