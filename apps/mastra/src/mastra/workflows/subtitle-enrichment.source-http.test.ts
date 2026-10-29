import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { describe, expect, it, vi } from "vitest"

import {
  handleSubtitleEnrichmentRouteRequest,
  runSubtitleEnrichmentWorkflow,
} from "./subtitle-enrichment"

describe("source-only subtitle HTTP failures", () => {
  it.each([
    {
      name: "missing header",
      body: "00:00:00.000 --> 00:00:02.000\nHello\n",
      reason: "source_invalid",
      status: 400,
      retryable: false,
    },
    {
      name: "empty cue",
      body: "WEBVTT\n\n00:00:00.000 --> 00:00:02.000\n\n",
      reason: "source_invalid",
      status: 400,
      retryable: false,
    },
    {
      name: "reversed timing",
      body: "WEBVTT\n\n00:00:02.000 --> 00:00:01.000\nHello\n",
      reason: "source_invalid",
      status: 400,
      retryable: false,
    },
    {
      name: "storage unavailable",
      error: new Error("private storage details"),
      reason: "source_failed",
      status: 502,
      retryable: true,
    },
    {
      name: "storage read decoding failed",
      error: new SyntaxError("private read failure"),
      reason: "source_failed",
      status: 502,
      retryable: true,
    },
  ])(
    "classifies $name through the authenticated source-only route",
    async (fixture) => {
      const writeArtifact = vi.fn()
      const readMuxSource = vi.fn()
      const run = vi.fn()
      const server = createServer(async (request, response) => {
        const outcome = await handleSubtitleEnrichmentRouteRequest({
          authHeader: request.headers.authorization,
          serviceKeys: ["local-test-key"],
          readJson: async () => {
            const chunks: Buffer[] = []
            for await (const chunk of request) chunks.push(Buffer.from(chunk))
            return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown
          },
          launch: (input, options) =>
            runSubtitleEnrichmentWorkflow(input, {
              ...options,
              apiKey: "",
              run,
              sourceDeps: {
                readArtifact: async () => {
                  if (fixture.error) throw fixture.error
                  return new TextEncoder().encode(fixture.body)
                },
                writeArtifact,
                readMuxSource,
              },
            }),
        })
        response.writeHead(outcome.status, {
          "content-type": "application/json",
        })
        response.end(JSON.stringify(outcome.body))
      })
      await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve),
      )
      try {
        const { port } = server.address() as AddressInfo
        const response = await fetch(
          `http://127.0.0.1:${port}/forge-subtitle-enrichment`,
          {
            method: "POST",
            headers: {
              authorization: "Bearer local-test-key",
              "content-type": "application/json",
            },
            body: JSON.stringify({
              assetId: "asset-1",
              sourceLanguage: "en",
              targetLanguages: [],
              source: { kind: "subtitle_artifact" },
            }),
          },
        )
        expect(response.status).toBe(fixture.status)
        const body = await response.json()
        expect(body).toMatchObject({
          result: {
            ok: false,
            reason: fixture.reason,
            retryable: fixture.retryable,
          },
        })
        expect(JSON.stringify(body)).not.toContain("private")
        expect(writeArtifact).not.toHaveBeenCalled()
        expect(readMuxSource).not.toHaveBeenCalled()
        expect(run).not.toHaveBeenCalled()
      } finally {
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        )
      }
    },
  )
})
