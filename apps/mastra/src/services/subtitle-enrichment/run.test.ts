import { beforeEach, describe, expect, it, vi } from "vitest"

import { chunkSegments } from "./chunker"
import { deterministicRetime, validateRetimingOutput } from "./retimer"
import { runSubtitleEnrichment } from "./run"
import type { Chunk, LanguageConfig, SubtitleScriptureContext } from "./types"

const emptyUsage = {
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
}

describe("chunkSegments", () => {
  it("returns an empty array for no segments", () => {
    expect(chunkSegments([])).toEqual([])
  })

  it("keeps chunk indices sequential and preserves derived fields", () => {
    const chunks = chunkSegments([
      { start: 0, end: 1, text: "Hello" },
      { start: 1, end: 2, text: "world." },
      { start: 2, end: 3, text: "Next" },
      { start: 3, end: 5, text: "sentence." },
    ])

    expect(chunks).toEqual([
      {
        index: 0,
        segments: [
          { start: 0, end: 1, text: "Hello" },
          { start: 1, end: 2, text: "world." },
          { start: 2, end: 3, text: "Next" },
          { start: 3, end: 5, text: "sentence." },
        ],
        startTime: 0,
        endTime: 5,
        sourceText: "Hello world. Next sentence.",
      },
    ])
  })

  it("never exceeds the max chunk size when no sentence boundary exists", () => {
    const chunks = chunkSegments(
      Array.from({ length: 10 }, (_, index) => ({
        start: index,
        end: index + 1,
        text: `Segment ${index + 1}`,
      })),
    )

    expect(chunks.map((chunk) => chunk.segments.length)).toEqual([6, 4])
    expect(chunks.every((chunk) => chunk.segments.length <= 6)).toBe(true)
  })
})

describe("deterministicRetime", () => {
  function buildChunk(startTime: number, endTime: number): Chunk {
    return {
      index: 0,
      segments: [
        { start: startTime, end: (startTime + endTime) / 2, text: "Opening" },
        { start: (startTime + endTime) / 2, end: endTime, text: "Closing" },
      ],
      startTime,
      endTime,
      sourceText: "Source text",
    }
  }

  it("splits a 14 second chunk into two valid slots", () => {
    const chunk = buildChunk(0, 14)
    const result = deterministicRetime(
      chunk,
      "Bonjour le monde comment allez vous",
    )

    expect(result).toEqual([
      { start: 0, end: 7, text: "Bonjour le monde" },
      { start: 7, end: 14, text: "comment allez vous" },
    ])
    expect(validateRetimingOutput(result, chunk)).toEqual([])
  })

  it("reports overlap errors", () => {
    const chunk = buildChunk(0, 10)

    expect(
      validateRetimingOutput(
        [
          { start: 0, end: 5.2, text: "Bonjour" },
          { start: 5, end: 10, text: "le monde" },
        ],
        chunk,
      ),
    ).toContain("Segments 0 and 1 overlap: 5.2 > 5")
  })
})

describe("runSubtitleEnrichment", () => {
  const readArtifact = vi.fn()
  const writeArtifact = vi.fn()
  const translate = vi.fn()
  const retime = vi.fn()
  const loadConfig = vi.fn()
  const detectScriptureContext = vi.fn()
  const written: Array<{ artifactType: string; body: string | Uint8Array }> = []

  beforeEach(() => {
    readArtifact.mockReset()
    writeArtifact.mockReset()
    translate.mockReset()
    retime.mockReset()
    loadConfig.mockReset()
    detectScriptureContext.mockReset()
    written.length = 0

    readArtifact.mockResolvedValue(
      new TextEncoder().encode(
        JSON.stringify({
          segments: [{ start: 0, end: 2, text: "Hola." }],
        }),
      ),
    )
    writeArtifact.mockImplementation(
      async (options: { artifactType: string; ext: string; body: string }) => {
        written.push({
          artifactType: options.artifactType,
          body: options.body,
        })
        return `qa-asset/${options.artifactType}.${options.ext}`
      },
    )
    loadConfig.mockResolvedValue(undefined)
    detectScriptureContext.mockResolvedValue(undefined)
  })

  it("returns partial success when at least one target language completes", async () => {
    translate.mockImplementation(
      async (input: { targetLanguage: string; config?: LanguageConfig }) => {
        if (input.targetLanguage === "fr") throw new Error("quota exceeded")
        return { text: "Hello.", usage: emptyUsage }
      },
    )
    retime.mockResolvedValue({
      segments: [{ start: 0, end: 2, text: "Hello." }],
      usage: emptyUsage,
      fallbackUsed: false,
    })

    await expect(
      runSubtitleEnrichment(
        {
          assetId: "qa-asset",
          sourceLanguage: "es",
          targetLanguages: ["en", "fr"],
          model: "test-model",
          apiKey: "openrouter-key",
          timeoutMs: 30_000,
        },
        {
          readArtifact,
          writeArtifact,
          translate,
          retime,
          loadConfig,
          detectScriptureContext,
        },
      ),
    ).resolves.toEqual([
      {
        lang: "en",
        status: "completed",
        artifactKeys: {
          vtt: "qa-asset/subtitles-en.vtt",
          json: "qa-asset/translation-en.json",
        },
      },
      {
        lang: "fr",
        status: "failed",
        error: "quota exceeded",
      },
    ])
  })

  it("writes translation artifacts with the real source language", async () => {
    translate.mockResolvedValue({ text: "Hello.", usage: emptyUsage })
    retime.mockResolvedValue({
      segments: [{ start: 0, end: 2, text: "Hello." }],
      usage: emptyUsage,
      fallbackUsed: false,
    })

    const results = await runSubtitleEnrichment(
      {
        assetId: "qa-asset",
        sourceLanguage: "ru",
        targetLanguages: ["en"],
        model: "test-model",
        apiKey: "openrouter-key",
        timeoutMs: 30_000,
      },
      {
        readArtifact,
        writeArtifact,
        translate,
        retime,
        loadConfig,
        detectScriptureContext,
      },
    )

    expect(results).toEqual([
      {
        lang: "en",
        status: "completed",
        artifactKeys: {
          vtt: "qa-asset/subtitles-en.vtt",
          json: "qa-asset/translation-en.json",
        },
      },
    ])

    const jsonWrite = written.find(
      (write) => write.artifactType === "translation-en",
    )
    expect(JSON.parse(String(jsonWrite?.body))).toEqual({
      sourceLanguage: "ru",
      targetLanguage: "en",
      text: "Hello.",
    })
    expect(String(written[0]?.body)).toContain("WEBVTT")
  })

  it("writes no-op translation artifacts when source and target match", async () => {
    const results = await runSubtitleEnrichment(
      {
        assetId: "qa-asset",
        sourceLanguage: "en",
        targetLanguages: ["en"],
        model: "test-model",
        apiKey: undefined,
        timeoutMs: 30_000,
      },
      {
        readArtifact,
        writeArtifact,
        translate,
        retime,
        loadConfig,
        detectScriptureContext,
      },
    )

    expect(translate).not.toHaveBeenCalled()
    expect(retime).not.toHaveBeenCalled()
    expect(detectScriptureContext).not.toHaveBeenCalled()
    expect(results).toEqual([
      {
        lang: "en",
        status: "completed",
        artifactKeys: {
          vtt: "qa-asset/subtitles-en.vtt",
          json: "qa-asset/translation-en.json",
        },
      },
    ])

    const jsonWrite = written.find(
      (write) => write.artifactType === "translation-en",
    )
    expect(JSON.parse(String(jsonWrite?.body))).toEqual({
      sourceLanguage: "en",
      targetLanguage: "en",
      text: "Hola.",
      mode: "source_equals_target",
      translated: false,
    })
  })

  it("passes language config to translation and retiming calls", async () => {
    const config = { glossary: { Christ: "Cristo" } }
    loadConfig.mockResolvedValue(config)
    translate.mockResolvedValue({ text: "Hola.", usage: emptyUsage })
    retime.mockResolvedValue({
      segments: [{ start: 0, end: 2, text: "Hola." }],
      usage: emptyUsage,
      fallbackUsed: false,
    })

    await runSubtitleEnrichment(
      {
        assetId: "qa-asset",
        sourceLanguage: "en",
        targetLanguages: ["es"],
        model: "test-model",
        apiKey: "openrouter-key",
        timeoutMs: 30_000,
      },
      {
        readArtifact,
        writeArtifact,
        translate,
        retime,
        loadConfig,
        detectScriptureContext,
      },
    )

    expect(translate).toHaveBeenCalledWith(
      expect.objectContaining({ targetLanguage: "es", config }),
    )
    expect(retime).toHaveBeenCalledWith(
      expect.objectContaining({ targetLanguage: "es", config }),
    )
  })

  it("reuses detected scripture context for translation, retiming, and JSON provenance", async () => {
    const scriptureContext: SubtitleScriptureContext = {
      contentDomain: "bible_story",
      likelyBibleReferences: ["Luke 2"],
      confidence: 0.91,
      rationale: "Birth narrative.",
    }
    detectScriptureContext.mockResolvedValue(scriptureContext)
    translate.mockResolvedValue({ text: "Hello.", usage: emptyUsage })
    retime.mockResolvedValue({
      segments: [{ start: 0, end: 2, text: "Hello." }],
      usage: emptyUsage,
      fallbackUsed: false,
    })

    await runSubtitleEnrichment(
      {
        assetId: "qa-asset",
        sourceLanguage: "es",
        targetLanguages: ["en"],
        model: "test-model",
        apiKey: "openrouter-key",
        timeoutMs: 30_000,
        translationContext: {
          videoTitle: "Birth of Jesus",
          bibleReferences: ["Luke 2"],
        },
      },
      {
        readArtifact,
        writeArtifact,
        translate,
        retime,
        loadConfig,
        detectScriptureContext,
      },
    )

    expect(detectScriptureContext).toHaveBeenCalledTimes(1)
    expect(detectScriptureContext).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceLanguage: "es",
        translationContext: {
          videoTitle: "Birth of Jesus",
          bibleReferences: ["Luke 2"],
        },
      }),
    )
    expect(translate).toHaveBeenCalledWith(
      expect.objectContaining({ scriptureContext }),
    )
    expect(retime).toHaveBeenCalledWith(
      expect.objectContaining({ scriptureContext }),
    )
    const jsonWrite = written.find(
      (write) => write.artifactType === "translation-en",
    )
    expect(JSON.parse(String(jsonWrite?.body))).toMatchObject({
      translationContext: {
        contentDomain: "bible_story",
        likelyBibleReferences: ["Luke 2"],
        confidence: 0.91,
      },
    })
    expect(String(jsonWrite?.body)).not.toContain("Birth narrative")
  })

  it("logs detector failures and continues with sanitized fallback context", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    detectScriptureContext.mockRejectedValue(new Error("provider down"))
    translate.mockResolvedValue({ text: "Hello.", usage: emptyUsage })
    retime.mockResolvedValue({
      segments: [{ start: 0, end: 2, text: "Hello." }],
      usage: emptyUsage,
      fallbackUsed: false,
    })

    try {
      await expect(
        runSubtitleEnrichment(
          {
            assetId: "qa-asset",
            sourceLanguage: "es",
            targetLanguages: ["en"],
            model: "test-model",
            apiKey: "openrouter-key",
            timeoutMs: 30_000,
            translationContext: {
              bibleReferences: [" Luke 2 ", "not scripture"],
            },
          },
          {
            readArtifact,
            writeArtifact,
            translate,
            retime,
            loadConfig,
            detectScriptureContext,
          },
        ),
      ).resolves.toEqual([
        {
          lang: "en",
          status: "completed",
          artifactKeys: {
            vtt: "qa-asset/subtitles-en.vtt",
            json: "qa-asset/translation-en.json",
          },
        },
      ])

      expect(warnSpy).toHaveBeenCalledWith(
        JSON.stringify({
          event: "subtitle_scripture_context_detection_failed",
          assetId: "qa-asset",
          errorName: "Error",
        }),
      )
      const jsonWrite = written.find(
        (write) => write.artifactType === "translation-en",
      )
      expect(JSON.parse(String(jsonWrite?.body))).toMatchObject({
        translationContext: {
          contentDomain: "bible_story",
          likelyBibleReferences: ["Luke 2"],
          confidence: 0.65,
        },
      })
    } finally {
      warnSpy.mockRestore()
    }
  })
})
