import { randomUUID } from "node:crypto"
import { rm } from "node:fs/promises"
import { join } from "node:path"
import { describe, expect, it, vi } from "vitest"

import { runSubtitleSource } from "./source"
import { readSubtitleArtifact, writeSubtitleArtifact } from "./storage"
import { runSubtitleEnrichment } from "./run"

const encode = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value))
const segment = { start: 0, end: 2, text: "Hello world" }

describe("subtitle source artifact execution", () => {
  it("writes real Manager artifacts through source acquisition and translation with deterministic provider adapters", async () => {
    const assetId = `source-execution-${randomUUID()}`
    const usage = {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      costUsd: 0,
    }
    const translate = vi.fn(async () => ({ text: "Hola mundo", usage }))
    const retime = vi.fn(async () => ({
      segments: [{ start: 0, end: 2, text: "Hola mundo" }],
      usage,
      fallbackUsed: false,
    }))
    try {
      const source = await runSubtitleSource(
        {
          assetId,
          sourceLanguage: "en",
          source: { kind: "mux", muxAssetId: "mux-1" },
        },
        {
          readMuxSource: async () => ({ language: "en", segments: [segment] }),
        },
      )
      const languages = await runSubtitleEnrichment(
        {
          assetId,
          sourceLanguage: source.language,
          targetLanguages: ["es"],
          model: "deterministic-test",
          timeoutMs: 1000,
        },
        {
          translate,
          retime,
          detectScriptureContext: async () => ({
            contentDomain: "other",
            likelyBibleReferences: [],
            confidence: 1,
          }),
          loadConfig: async () => ({}),
        },
      )
      expect(source.summary.artifactKeys).toEqual({
        transcript: `${assetId}/transcript.json`,
        subtitles: `${assetId}/subtitles.vtt`,
      })
      expect(languages).toEqual([
        {
          lang: "es",
          status: "completed",
          artifactKeys: {
            vtt: `${assetId}/subtitles-es.vtt`,
            json: `${assetId}/translation-es.json`,
          },
        },
      ])
      expect(
        JSON.parse(
          new TextDecoder().decode(
            await readSubtitleArtifact(assetId, "transcript", "json"),
          ),
        ),
      ).toMatchObject({
        text: "Hello world",
        language: "en",
        segments: [segment],
      })
      expect(
        new TextDecoder().decode(
          await readSubtitleArtifact(assetId, "subtitles", "vtt"),
        ),
      ).toContain("Hello world")
      expect(
        new TextDecoder().decode(
          await readSubtitleArtifact(assetId, "subtitles-es", "vtt"),
        ),
      ).toContain("Hola mundo")
      expect(
        JSON.parse(
          new TextDecoder().decode(
            await readSubtitleArtifact(assetId, "translation-es", "json"),
          ),
        ),
      ).toMatchObject({
        text: "Hola mundo",
        sourceLanguage: "en",
        targetLanguage: "es",
      })
      expect(translate).toHaveBeenCalledTimes(1)
      expect(retime).toHaveBeenCalledTimes(1)
    } finally {
      await rm(join(process.cwd(), ".tmp", "artifacts", assetId), {
        recursive: true,
        force: true,
      })
    }
  })

  it("reuses approved VTT bytes and writes the canonical transcript without calling Mux", async () => {
    const assetId = `approved-vtt-${randomUUID()}`
    const body = "WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nHello world\n"
    const readMuxSource = vi.fn()
    try {
      await writeSubtitleArtifact({
        assetId,
        artifactType: "subtitles",
        ext: "vtt",
        body,
      })
      await runSubtitleSource(
        {
          assetId,
          sourceLanguage: "en",
          source: { kind: "subtitle_artifact" },
        },
        { readMuxSource },
      )
      expect(
        new TextDecoder().decode(
          await readSubtitleArtifact(assetId, "subtitles", "vtt"),
        ),
      ).toBe(body)
      expect(
        JSON.parse(
          new TextDecoder().decode(
            await readSubtitleArtifact(assetId, "transcript", "json"),
          ),
        ),
      ).toMatchObject({ segments: [segment] })
      expect(readMuxSource).not.toHaveBeenCalled()
    } finally {
      await rm(join(process.cwd(), ".tmp", "artifacts", assetId), {
        recursive: true,
        force: true,
      })
    }
  })

  it.each([
    { name: "missing header", body: "00:00:00.000 --> 00:00:02.000\nHello\n" },
    { name: "empty cue", body: "WEBVTT\n\n00:00:00.000 --> 00:00:02.000\n\n" },
    {
      name: "invalid timestamp",
      body: "WEBVTT\n\ninvalid --> 00:00:02.000\nHello\n",
    },
    {
      name: "reversed timing",
      body: "WEBVTT\n\n00:00:02.000 --> 00:00:01.000\nHello\n",
    },
    { name: "no cues", body: "WEBVTT\n\n" },
  ])(
    "rejects invalid approved VTT without retry or fallback: $name",
    async ({ body }) => {
      const writeArtifact = vi.fn()
      const readMuxSource = vi.fn()
      await expect(
        runSubtitleSource(
          {
            assetId: "asset-1",
            sourceLanguage: "en",
            source: { kind: "subtitle_artifact" },
          },
          {
            readArtifact: async () => new TextEncoder().encode(body),
            writeArtifact,
            readMuxSource,
          },
        ),
      ).rejects.toMatchObject({
        reason: "source_invalid",
        retryable: false,
        message: "Subtitle source content is invalid.",
      })
      expect(writeArtifact).not.toHaveBeenCalled()
      expect(readMuxSource).not.toHaveBeenCalled()
    },
  )

  it.each([
    new Error("private storage details"),
    new SyntaxError("private read failure"),
  ])("keeps artifact read errors retryable: %s", async (error) => {
    const writeArtifact = vi.fn()
    await expect(
      runSubtitleSource(
        {
          assetId: "asset-1",
          sourceLanguage: "en",
          source: { kind: "subtitle_artifact" },
        },
        {
          readArtifact: async () => {
            throw error
          },
          writeArtifact,
        },
      ),
    ).rejects.toMatchObject({
      reason: "source_failed",
      retryable: true,
      message: "Subtitle source could not be read or validated.",
    })
    expect(writeArtifact).not.toHaveBeenCalled()
  })

  it("materializes validated source subtitles from an approved transcript", async () => {
    const writeArtifact = vi.fn(
      async ({ artifactType, ext }) => `asset-1/${artifactType}.${ext}`,
    )
    const result = await runSubtitleSource(
      {
        assetId: "asset-1",
        sourceLanguage: "en",
        source: { kind: "transcript_artifact" },
      },
      {
        readArtifact: vi.fn(async () =>
          encode({ language: "en", segments: [segment] }),
        ),
        writeArtifact,
      },
    )
    expect(result).toMatchObject({
      language: "en",
      text: "Hello world",
      segments: [segment],
      summary: {
        kind: "transcript_artifact",
        language: "en",
        segmentCount: 1,
        artifactKeys: {
          transcript: "asset-1/transcript.json",
          subtitles: "asset-1/subtitles.vtt",
        },
      },
    })
    expect(writeArtifact).toHaveBeenCalledWith(
      expect.objectContaining({
        artifactType: "subtitles",
        ext: "vtt",
        body: expect.stringContaining("Hello world"),
      }),
    )
    expect(
      writeArtifact.mock.calls.some(
        ([options]) => options.artifactType === "transcript",
      ),
    ).toBe(false)
  })

  it("rejects mismatched source language, unsafe identity and failed persistence without fallback success", async () => {
    const readMuxSource = vi.fn()
    const writeArtifact = vi.fn()
    await expect(
      runSubtitleSource(
        {
          assetId: "asset-1",
          sourceLanguage: "en",
          source: { kind: "transcript_artifact" },
        },
        {
          readArtifact: async () =>
            encode({ language: "es", segments: [segment] }),
          writeArtifact,
          readMuxSource,
        },
      ),
    ).rejects.toMatchObject({ reason: "source_invalid", retryable: false })
    await expect(
      runSubtitleSource(
        {
          assetId: "../asset",
          sourceLanguage: "en",
          source: { kind: "transcript_artifact" },
        },
        {
          readArtifact: vi.fn(),
          writeArtifact,
          readMuxSource,
        },
      ),
    ).rejects.toMatchObject({ reason: "source_invalid" })
    expect(writeArtifact).not.toHaveBeenCalled()
    expect(readMuxSource).not.toHaveBeenCalled()
    await expect(
      runSubtitleSource(
        {
          assetId: "asset-1",
          sourceLanguage: "en",
          source: { kind: "mux", muxAssetId: "mux-1" },
        },
        {
          readMuxSource: async () => ({ language: "en", segments: [segment] }),
          writeArtifact: async () => {
            throw new Error("secret storage details")
          },
        },
      ),
    ).rejects.toMatchObject({
      reason: "source_failed",
      message: "Subtitle source artifacts could not be stored.",
    })
  })

  it.each(
    [
      [],
      [{ start: -1, end: 2, text: "Hello" }],
      [{ start: 2, end: 1, text: "Hello" }],
      [{ start: 0, end: 2, text: " " }],
      [{ start: "0", end: 2, text: "Hello" }],
    ].map((segments) => ({ segments })),
  )(
    "rejects unusable transcript segments before writing: %j",
    async ({ segments }) => {
      const writeArtifact = vi.fn()
      await expect(
        runSubtitleSource(
          {
            assetId: "asset-1",
            sourceLanguage: "en",
            source: { kind: "transcript_artifact" },
          },
          {
            readArtifact: async () => encode({ segments }),
            writeArtifact,
          },
        ),
      ).rejects.toThrow()
      expect(writeArtifact).not.toHaveBeenCalled()
    },
  )
})
