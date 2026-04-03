import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  readArtifactMock,
  writeArtifactMock,
  translateChunkMock,
  retimeChunkMock,
} = vi.hoisted(() => ({
  readArtifactMock: vi.fn(),
  writeArtifactMock: vi.fn(),
  translateChunkMock: vi.fn(),
  retimeChunkMock: vi.fn(),
}))

vi.mock("@/services/storage", () => ({
  readArtifact: readArtifactMock,
  writeArtifact: writeArtifactMock,
}))

vi.mock("@/services/subtitleTranslation/translator", () => ({
  translateChunk: translateChunkMock,
}))

vi.mock("@/services/subtitleTranslation/retimer", () => ({
  retimeChunk: retimeChunkMock,
}))

vi.mock("@/services/subtitleTranslation/languageConfig", () => ({
  loadLanguageConfig: vi.fn().mockResolvedValue(undefined),
}))

import { translateSubtitles } from "@/services/subtitleTranslation"

describe("translateSubtitles", () => {
  beforeEach(() => {
    readArtifactMock.mockReset()
    writeArtifactMock.mockReset()
    translateChunkMock.mockReset()
    retimeChunkMock.mockReset()
  })

  it("throws when all requested target languages fail", async () => {
    readArtifactMock.mockResolvedValue(
      new TextEncoder().encode(
        JSON.stringify({
          segments: [{ start: 0, end: 2, text: "Hola." }],
        }),
      ),
    )
    translateChunkMock.mockRejectedValue(new Error("llm offline"))

    await expect(
      translateSubtitles({
        assetId: "qa-asset",
        sourceLanguage: "es",
        targetLanguages: ["en", "fr"],
      }),
    ).rejects.toThrow(
      "Subtitle translation failed for all target languages (en: llm offline, fr: llm offline)",
    )

    expect(writeArtifactMock).not.toHaveBeenCalled()
  })

  it("returns partial success when at least one target language completes", async () => {
    readArtifactMock.mockResolvedValue(
      new TextEncoder().encode(
        JSON.stringify({
          segments: [{ start: 0, end: 2, text: "Hola." }],
        }),
      ),
    )
    writeArtifactMock.mockImplementation(
      async ({ artifactType, ext }: { artifactType: string; ext: string }) =>
        `qa/${artifactType}.${ext}`,
    )
    translateChunkMock.mockImplementation(async (_chunk, targetLanguage) => {
      if (targetLanguage === "fr") throw new Error("quota exceeded")
      return "Hello."
    })
    retimeChunkMock.mockResolvedValue([{ start: 0, end: 2, text: "Hello." }])

    await expect(
      translateSubtitles({
        assetId: "qa-asset",
        sourceLanguage: "es",
        targetLanguages: ["en", "fr"],
      }),
    ).resolves.toEqual([
      {
        lang: "en",
        status: "completed",
        artifactKeys: {
          vtt: "qa/subtitles-en.vtt",
          json: "qa/translation-en.json",
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
    readArtifactMock.mockResolvedValue(
      new TextEncoder().encode(
        JSON.stringify({
          segments: [{ start: 0, end: 2, text: "Привет." }],
        }),
      ),
    )
    writeArtifactMock.mockImplementation(
      async ({ artifactType, ext }: { artifactType: string; ext: string }) =>
        `qa/${artifactType}.${ext}`,
    )
    translateChunkMock.mockResolvedValue("Hello.")
    retimeChunkMock.mockResolvedValue([{ start: 0, end: 2, text: "Hello." }])

    const results = await translateSubtitles({
      assetId: "qa-asset",
      sourceLanguage: "ru",
      targetLanguages: ["en"],
    })

    expect(results).toEqual([
      {
        lang: "en",
        status: "completed",
        artifactKeys: {
          vtt: "qa/subtitles-en.vtt",
          json: "qa/translation-en.json",
        },
      },
    ])

    const jsonWriteCall = writeArtifactMock.mock.calls.find(
      (call) => call[0]?.artifactType === "translation-en",
    )

    expect(jsonWriteCall).toBeDefined()
    const body = jsonWriteCall?.[0]?.body
    expect(typeof body).toBe("string")
    expect(JSON.parse(body as string)).toEqual({
      sourceLanguage: "ru",
      targetLanguage: "en",
      text: "Hello.",
    })
  })
})
