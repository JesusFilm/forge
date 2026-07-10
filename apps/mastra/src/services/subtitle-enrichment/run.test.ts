import { beforeEach, describe, expect, it, vi } from "vitest"

import { chunkSegments } from "./chunker"
import { deterministicRetime, validateRetimingOutput } from "./retimer"
import { runSubtitleEnrichment } from "./run"
import type {
  Chunk,
  LanguageConfig,
  SubtitleScriptureContext,
  SubtitleScriptureValidationResult,
} from "./types"

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
  const loadBiblePassage = vi.fn()
  const validateScripture = vi.fn()
  const written: Array<{ artifactType: string; body: string | Uint8Array }> = []

  beforeEach(() => {
    readArtifact.mockReset()
    writeArtifact.mockReset()
    translate.mockReset()
    retime.mockReset()
    loadConfig.mockReset()
    detectScriptureContext.mockReset()
    loadBiblePassage.mockReset()
    validateScripture.mockReset()
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
    loadBiblePassage.mockResolvedValue({
      ok: false,
      reason: "provider_config_missing",
    })
  })

  function validationResult(
    overrides: Partial<SubtitleScriptureValidationResult> = {},
  ): SubtitleScriptureValidationResult {
    return {
      targetLanguage: "en",
      contentDomain: "bible_story",
      likelyBibleReferences: ["Luke 2"],
      verdict: "pass",
      basis: "model_knowledge",
      confidence: 0.8,
      checkedReferenceCount: 1,
      warningCount: 0,
      needsReviewCount: 0,
      fallbackReason: "provider_config_missing",
      findings: [],
      ...overrides,
    }
  }

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
    validateScripture.mockResolvedValue(validationResult())
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
        loadBiblePassage,
        validateScripture,
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
    expect(validateScripture).toHaveBeenCalledWith(
      expect.objectContaining({
        targetLanguage: "en",
        scriptureContext,
        fallbackReason: "provider_config_missing",
      }),
    )
  })

  it("logs detector failures and continues with sanitized fallback context", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    detectScriptureContext.mockRejectedValue(new Error("provider down"))
    validateScripture.mockResolvedValue(validationResult())
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
            loadBiblePassage,
            validateScripture,
          },
        ),
      ).resolves.toEqual([
        {
          lang: "en",
          status: "completed",
          artifactKeys: {
            vtt: "qa-asset/subtitles-en.vtt",
            json: "qa-asset/translation-en.json",
            validation: "qa-asset/subtitle-validation-en.json",
          },
          validationSummary: {
            verdict: "pass",
            basis: "model_knowledge",
            confidence: 0.8,
            checkedReferenceCount: 1,
            warningCount: 0,
            needsReviewCount: 0,
            fallbackReason: "provider_config_missing",
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
      const validationWrite = written.find(
        (write) => write.artifactType === "subtitle-validation-en",
      )
      expect(JSON.parse(String(validationWrite?.body))).toMatchObject({
        basis: "model_knowledge",
        verdict: "pass",
        fallbackReason: "provider_config_missing",
      })
    } finally {
      warnSpy.mockRestore()
    }
  })

  it("uses an available Bible passage to produce target-text validation", async () => {
    const scriptureContext: SubtitleScriptureContext = {
      contentDomain: "bible_story",
      likelyBibleReferences: ["Luke 2"],
      confidence: 0.91,
    }
    const targetBibleValidation: SubtitleScriptureValidationResult = {
      targetLanguage: "en",
      contentDomain: "bible_story",
      likelyBibleReferences: ["Luke 2"],
      verdict: "pass",
      basis: "target_bible_text",
      confidence: 0.8,
      checkedReferenceCount: 1,
      warningCount: 0,
      needsReviewCount: 0,
      provider: {
        name: "api_bible",
        bibleId: "spa-rvr",
        language: "en",
        reference: "Luke 2",
      },
      findings: [],
    }
    detectScriptureContext.mockResolvedValue(scriptureContext)
    loadBiblePassage.mockResolvedValue({
      ok: true,
      passage: {
        provider: {
          name: "api_bible",
          bibleId: "spa-rvr",
          language: "en",
          reference: "Luke 2",
        },
        referenceCount: 1,
        text: "Mary gave birth to her firstborn son.",
      },
    })
    validateScripture.mockResolvedValue(targetBibleValidation)
    translate.mockResolvedValue({ text: "Hello.", usage: emptyUsage })
    retime.mockResolvedValue({
      segments: [{ start: 0, end: 2, text: "Hello." }],
      usage: emptyUsage,
      fallbackUsed: false,
    })

    const results = await runSubtitleEnrichment(
      {
        assetId: "qa-asset",
        sourceLanguage: "es",
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
        loadBiblePassage,
        validateScripture,
      },
    )

    expect(validateScripture).toHaveBeenCalledWith(
      expect.objectContaining({
        biblePassage: expect.objectContaining({
          text: "Mary gave birth to her firstborn son.",
        }),
        fallbackReason: undefined,
      }),
    )
    expect(results[0]).toMatchObject({
      artifactKeys: {
        validation: "qa-asset/subtitle-validation-en.json",
      },
      validationSummary: {
        basis: "target_bible_text",
        verdict: "pass",
      },
    })
  })

  it("validates referenced gospel teaching contexts", async () => {
    const scriptureContext: SubtitleScriptureContext = {
      contentDomain: "gospel_teaching",
      likelyBibleReferences: ["Matthew 6:14-15"],
      confidence: 0.82,
    }
    detectScriptureContext.mockResolvedValue(scriptureContext)
    validateScripture.mockResolvedValue(
      validationResult({
        contentDomain: "gospel_teaching",
        likelyBibleReferences: ["Matthew 6:14-15"],
      }),
    )
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
      },
      {
        readArtifact,
        writeArtifact,
        translate,
        retime,
        loadConfig,
        detectScriptureContext,
        loadBiblePassage,
        validateScripture,
      },
    )

    expect(validateScripture).toHaveBeenCalledWith(
      expect.objectContaining({
        scriptureContext,
        fallbackReason: "provider_config_missing",
      }),
    )
    expect(
      written.some((write) => write.artifactType === "subtitle-validation-en"),
    ).toBe(true)
  })

  it("records validation unavailable without failing completed translation", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    detectScriptureContext.mockResolvedValue({
      contentDomain: "bible_story",
      likelyBibleReferences: ["Luke 2"],
      confidence: 0.91,
    })
    validateScripture.mockRejectedValue(new Error("validator offline"))
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
          },
          {
            readArtifact,
            writeArtifact,
            translate,
            retime,
            loadConfig,
            detectScriptureContext,
            loadBiblePassage,
            validateScripture,
          },
        ),
      ).resolves.toEqual([
        {
          lang: "en",
          status: "completed",
          artifactKeys: {
            vtt: "qa-asset/subtitles-en.vtt",
            json: "qa-asset/translation-en.json",
            validation: "qa-asset/subtitle-validation-en.json",
          },
          validationSummary: {
            verdict: "unavailable",
            basis: "unavailable",
            confidence: 0,
            checkedReferenceCount: 0,
            warningCount: 0,
            needsReviewCount: 0,
            unavailableReason: "provider_failed",
          },
        },
      ])
      expect(warnSpy).toHaveBeenCalledWith(
        JSON.stringify({
          event: "subtitle_scripture_validation_failed",
          assetId: "qa-asset",
          targetLanguage: "en",
          errorName: "Error",
        }),
      )
    } finally {
      warnSpy.mockRestore()
    }
  })

  it("keeps validation summary visible when validation artifact writing fails", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    detectScriptureContext.mockResolvedValue({
      contentDomain: "bible_story",
      likelyBibleReferences: ["Luke 2"],
      confidence: 0.91,
    })
    validateScripture.mockResolvedValue(
      validationResult({
        verdict: "needs_review",
        needsReviewCount: 1,
        findings: [
          {
            severity: "needs_review",
            category: "meaning_drift",
            message: "Meaning drift.",
          },
        ],
      }),
    )
    writeArtifact.mockImplementation(
      async (options: { artifactType: string; ext: string; body: string }) => {
        if (options.artifactType === "subtitle-validation-en") {
          throw new Error("storage offline")
        }
        written.push({
          artifactType: options.artifactType,
          body: options.body,
        })
        return `qa-asset/${options.artifactType}.${options.ext}`
      },
    )
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
          },
          {
            readArtifact,
            writeArtifact,
            translate,
            retime,
            loadConfig,
            detectScriptureContext,
            loadBiblePassage,
            validateScripture,
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
          validationSummary: {
            verdict: "needs_review",
            basis: "model_knowledge",
            confidence: 0.8,
            checkedReferenceCount: 1,
            warningCount: 0,
            needsReviewCount: 1,
            fallbackReason: "provider_config_missing",
            unavailableReason: "artifact_write_failed",
          },
        },
      ])
      expect(warnSpy).toHaveBeenCalledWith(
        JSON.stringify({
          event: "subtitle_scripture_validation_artifact_write_failed",
          assetId: "qa-asset",
          targetLanguage: "en",
          errorName: "Error",
        }),
      )
    } finally {
      warnSpy.mockRestore()
    }
  })
})
