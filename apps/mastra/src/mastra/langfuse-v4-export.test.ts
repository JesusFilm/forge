import { createServer, type IncomingHttpHeaders } from "node:http"
import { gunzipSync } from "node:zlib"

import { SpanType } from "@mastra/core/observability"
import { MastraStorageExporter, Observability } from "@mastra/observability"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  buildFollowUpsTracingCallOptions,
  buildObservabilityConfigs,
  buildSeekerTracingCallOptions,
  LANGFUSE_SEEKER_TRACING_MARKER,
  selectObservabilityConfig,
} from "./langfuse-tracing"

type WireSpan = {
  name: string
  traceId: string
  spanId: string
  parentSpanId?: string
  status: { code: number; message?: string }
  attributes: { key: string; value: Record<string, unknown> }[]
}
type WirePayload = {
  resourceSpans: { scopeSpans: { spans: WireSpan[] }[] }[]
}

function attributes(span: WireSpan): Record<string, unknown> {
  return Object.fromEntries(
    span.attributes.map(({ key, value }) => [key, Object.values(value)[0]]),
  )
}

type WireRequest = {
  path: string | undefined
  headers: IncomingHttpHeaders
  body: WirePayload
}

async function withWireCollector(
  nodeEnv: string,
  run: (observability: Observability, requests: WireRequest[]) => Promise<void>,
) {
  // Real Mastra conversion and Langfuse/OTel serialization, synthetic data,
  // and a loopback-only collector: no Cloud keys or model calls required.
  vi.stubEnv("LANGFUSE_MEDIA_UPLOAD_ENABLED", "false")
  const requests: WireRequest[] = []
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    const bytes = Buffer.concat(chunks)
    const decoded =
      request.headers["content-encoding"] === "gzip" ? gunzipSync(bytes) : bytes
    requests.push({
      path: request.url,
      headers: request.headers,
      body: JSON.parse(decoded.toString("utf8")) as WirePayload,
    })
    response.writeHead(200, { "content-type": "application/json" })
    response.end("{}")
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  let observability: Observability | undefined
  try {
    const address = server.address()
    if (!address || typeof address === "string") throw new Error("No port")
    observability = new Observability({
      sensitiveDataFilter: true,
      configSelector: selectObservabilityConfig,
      configs: buildObservabilityConfigs(
        {
          serviceName: "forge-mastra",
          exporters: [new MastraStorageExporter()],
        },
        {
          getEnabled: () => true,
          getNodeEnv: () => nodeEnv,
          getConfig: () => ({
            baseUrl: `http://127.0.0.1:${address.port}`,
            publicKey: "pk-lf-test",
            secretKey: "sk-lf-test",
          }),
        },
      ),
    })
    await run(observability, requests)
  } finally {
    try {
      await observability?.shutdown()
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      )
    }
  }
}

afterEach(() => vi.unstubAllEnvs())

describe("Langfuse v4 wire contract", () => {
  it.each(["production", "development"])(
    "exports real %s SDK requests with observation attribution and no routing token",
    async (nodeEnv) => {
      await withWireCollector(nodeEnv, async (observability, requests) => {
        const options = buildSeekerTracingCallOptions({
          promptName: "seeker-system",
          promptProvenance: {
            text: "synthetic system prompt",
            source: "langfuse",
            resolvedLabel: "production",
            version: 7,
          },
          resource: "user:synthetic-v4",
          thread: "synthetic-session",
          sendOrigin: "typed",
        })
        const instance = observability.getSelectedInstance(options)!
        const root = instance.startSpan({
          name: "seeker-turn",
          type: SpanType.AGENT_RUN,
          input: "synthetic question",
          ...options,
        })
        const child = root.createChildSpan({
          name: "synthetic-generation",
          type: SpanType.MODEL_GENERATION,
          attributes: { model: "synthetic-model", provider: "synthetic" },
          input: "synthetic model input",
        })
        child.end({
          output: "synthetic answer",
          attributes: { usage: { inputTokens: 11, outputTokens: 7 } },
        })
        const tool = root.createChildSpan({
          name: "synthetic-tool",
          type: SpanType.TOOL_CALL,
          attributes: { toolCallId: "synthetic-tool" },
          input: { query: "synthetic query" },
        })
        tool.error({ error: new Error("synthetic failure"), endSpan: true })
        root
          .createChildSpan({ name: "chunk", type: SpanType.MODEL_CHUNK })
          .end()
        root.end({ output: "synthetic answer" })
        await instance.flush()
        await instance.flush()

        expect(requests.length).toBeGreaterThan(0)
        for (const request of requests) {
          expect(request.path).toBe("/api/public/otel/v1/traces")
          expect(request.headers.authorization).toBe(
            `Basic ${Buffer.from("pk-lf-test:sk-lf-test").toString("base64")}`,
          )
          expect(request.headers["x-langfuse-sdk-name"]).toBe("javascript")
          expect(request.headers["x-langfuse-ingestion-version"]).toBe("4")
          const version = String(request.headers["x-langfuse-sdk-version"])
            .split(".")
            .map(Number)
          expect(version[0] > 5 || (version[0] === 5 && version[1] >= 4)).toBe(
            true,
          )
        }
        const spans = requests.flatMap(({ body }) =>
          body.resourceSpans.flatMap(({ scopeSpans }) =>
            scopeSpans.flatMap(({ spans }) => spans),
          ),
        )
        // Repeated flushing must not re-ingest completed spans; token chunks
        // must stay excluded by the production configuration.
        expect(spans).toHaveLength(3)
        expect(new Set(spans.map(({ spanId }) => spanId)).size).toBe(3)
        const rootSpan = spans.find(({ name }) => name === "seeker-turn")!
        const generation = spans.find(
          (span) => attributes(span)["mastra.span.type"] === "model_generation",
        )!
        expect(generation.traceId).toBe(rootSpan.traceId)
        expect(generation.parentSpanId).toBe(rootSpan.spanId)
        for (const span of spans) {
          expect(attributes(span)).toMatchObject({
            "user.id": "user:synthetic-v4",
            "session.id": "synthetic-session",
            "langfuse.observation.prompt.name": "seeker-system",
            "langfuse.observation.prompt.version": 7,
            "langfuse.trace.name": "seeker-turn",
            "langfuse.environment": nodeEnv,
            "langfuse.trace.metadata.promptSource": "langfuse",
            "langfuse.trace.metadata.sendOrigin": "typed",
          })
        }
        expect(attributes(generation)).toMatchObject({
          "gen_ai.request.model": "synthetic-model",
          "gen_ai.usage.input_tokens": 11,
          "gen_ai.usage.output_tokens": 7,
          "gen_ai.input.messages": "synthetic model input",
          "gen_ai.output.messages": "synthetic answer",
        })
        expect(attributes(rootSpan)).toMatchObject({
          "langfuse.observation.input": "synthetic question",
          "langfuse.observation.output": "synthetic answer",
        })
        const toolSpan = spans.find(
          (span) => attributes(span)["mastra.span.type"] === "tool_call",
        )!
        expect(toolSpan.status.code).toBe(2)
        expect(toolSpan.parentSpanId).toBe(rootSpan.spanId)
        expect(JSON.stringify(requests)).not.toContain(
          LANGFUSE_SEEKER_TRACING_MARKER,
        )
      })
    },
  )

  it.each([
    {
      name: "fallback",
      source: "fallback",
      version: undefined,
      stale: false,
      linked: false,
    },
    {
      name: "fallback with an unexpected version",
      source: "fallback",
      version: 7,
      stale: false,
      linked: false,
    },
    {
      name: "versionless stale managed prompt",
      source: "langfuse",
      version: undefined,
      stale: true,
      linked: false,
    },
    {
      name: "versioned stale managed prompt",
      source: "langfuse",
      version: 7,
      stale: true,
      linked: true,
    },
  ] as const)(
    "preserves $name provenance and native-link boundaries on root and child observations",
    async ({ source, version, stale, linked }) => {
      await withWireCollector("production", async (observability, requests) => {
        const options = buildSeekerTracingCallOptions({
          promptName: "seeker-system",
          promptProvenance: {
            text: "synthetic system prompt",
            source,
            resolvedLabel: "production",
            version,
            stale,
          },
          resource: "user:synthetic-v4",
          thread: "synthetic-session",
          sendOrigin: "follow_up",
        })
        const instance = observability.getSelectedInstance(options)!
        const root = instance.startSpan({
          name: "seeker-turn",
          type: SpanType.AGENT_RUN,
          ...options,
        })
        root
          .createChildSpan({
            name: "synthetic-generation",
            type: SpanType.MODEL_GENERATION,
            attributes: { model: "synthetic-model", provider: "synthetic" },
          })
          .end()
        root.end()
        await instance.flush()

        const spans = requests.flatMap(({ body }) =>
          body.resourceSpans.flatMap(({ scopeSpans }) =>
            scopeSpans.flatMap(({ spans }) => spans),
          ),
        )
        expect(spans).toHaveLength(2)
        const rootSpan = spans.find(({ name }) => name === "seeker-turn")!
        const generation = spans.find(
          (span) => attributes(span)["mastra.span.type"] === "model_generation",
        )!
        expect(generation.traceId).toBe(rootSpan.traceId)
        expect(generation.parentSpanId).toBe(rootSpan.spanId)
        for (const span of spans) {
          const values = attributes(span)
          expect(values).toMatchObject({
            "user.id": "user:synthetic-v4",
            "session.id": "synthetic-session",
            "langfuse.trace.metadata.promptSource": source,
            "langfuse.trace.metadata.promptName": "seeker-system",
            "langfuse.trace.metadata.promptLabel": "production",
            "langfuse.trace.metadata.sendOrigin": "follow_up",
          })
          // The adapter JSON-encodes non-string metadata values.
          expect(values["langfuse.trace.metadata.promptStale"]).toBe(
            stale ? "true" : undefined,
          )
          expect(values["langfuse.observation.prompt.name"]).toBe(
            linked ? "seeker-system" : undefined,
          )
          expect(values["langfuse.observation.prompt.version"]).toBe(
            linked ? version : undefined,
          )
        }
        expect(JSON.stringify(requests)).not.toContain(
          LANGFUSE_SEEKER_TRACING_MARKER,
        )
      })
    },
  )

  it.each(["sibling", "linked"] as const)(
    "preserves attribution and parentage for %s follow-up generation without a managed-prompt link",
    async (shape) => {
      await withWireCollector("production", async (observability, requests) => {
        const turnTraceId = "a".repeat(32)
        const turnSpanId = "b".repeat(16)
        const options = buildFollowUpsTracingCallOptions({
          resource: "user:synthetic-v4",
          thread: "synthetic-session",
          ...(shape === "linked" ? { turnTraceId, turnSpanId } : {}),
        })
        const instance = observability.getSelectedInstance(options)!
        instance
          .startSpan({
            name: "synthetic-follow-ups",
            type: SpanType.MODEL_GENERATION,
            attributes: { model: "synthetic-model", provider: "synthetic" },
            ...options,
          })
          .end()
        await instance.flush()

        const spans = requests.flatMap(({ body }) =>
          body.resourceSpans.flatMap(({ scopeSpans }) =>
            scopeSpans.flatMap(({ spans }) => spans),
          ),
        )
        expect(spans).toHaveLength(1)
        const span = spans[0]!
        expect(attributes(span)).toMatchObject({
          "user.id": "user:synthetic-v4",
          "session.id": "synthetic-session",
          "langfuse.trace.name": "seeker-follow-ups",
          "langfuse.environment": "production",
        })
        // This generator uses its own code-owned prompt, not seeker-system.
        expect(
          attributes(span)["langfuse.observation.prompt.name"],
        ).toBeUndefined()
        expect(
          attributes(span)["langfuse.observation.prompt.version"],
        ).toBeUndefined()
        if (shape === "linked") {
          expect(span.traceId).toBe(turnTraceId)
          expect(span.parentSpanId).toBe(turnSpanId)
        } else {
          expect(span.traceId).not.toBe(turnTraceId)
          expect(span.parentSpanId ?? "").toBe("")
        }
        expect(JSON.stringify(requests)).not.toContain(
          LANGFUSE_SEEKER_TRACING_MARKER,
        )
      })
    },
  )
})
