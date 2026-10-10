import { describe, expect, it, vi } from "vitest"

import { sha256Bytes } from "@/features/subtitle-lab/subtitle-lab-contract"
import type { SubtitleEvalArtifactBackend } from "./subtitle-eval-artifacts"
import {
  activateSubtitleEvalCorpus,
  assertAllowedCoreUrl,
  assertLockedTrackCoverage,
  assertUniqueLanguageMappings,
  readBoundedResponse,
} from "./subtitle-corpus-activation"

describe("subtitle corpus activation", () => {
  it("downloads each exact locked track once and preserves exact Admin languages", async () => {
    const source = "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nHello\n"
    const spanish = "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nHola\n"
    const french = "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nBonjour\n"
    const manifestJson = JSON.stringify({
      schemaVersion: "subtitle-translation-eval/v1",
      referenceAuthority: "provisional",
      referenceNotes: "Fixture reference authority requires certification.",
      sourceLanguage: "en",
      targetLanguages: ["es", "fr"],
      languages: [
        { bcp47: "en", coreLanguageId: "529", label: "English" },
        { bcp47: "es", coreLanguageId: "21028", label: "Spanish" },
        { bcp47: "fr", coreLanguageId: "496", label: "French" },
      ],
      cases: [
        {
          id: "fixture-case",
          videoId: "video-1",
          title: "Fixture",
          collection: "Fixture Collection",
          edition: "base",
          coreVideoEditionId: "edition-1",
          clip: { startSeconds: 0, endSeconds: 2 },
        },
      ],
    })
    const manifestDigest = sha256Bytes(manifestJson)
    const track = (
      role: "source" | "reference",
      language: string,
      coreLanguageId: string,
      subtitleId: string,
      body: string,
    ) => ({
      caseId: "fixture-case",
      role,
      language,
      coreLanguageId,
      subtitleId,
      videoId: "video-1",
      edition: "base",
      coreVideoEditionId: "edition-1",
      primary: role === "source",
      sourceUrl: `https://core.example/${subtitleId}.vtt`,
      sourceSha256: sha256Bytes(body),
      clippedSha256: sha256Bytes(body),
      cueCount: 1,
    })
    const lockJson = JSON.stringify({
      schemaVersion: "subtitle-translation-eval-corpus-lock/v1",
      manifestSha256: manifestDigest,
      resolvedAt: "2026-08-20T00:00:00.000Z",
      tracks: [
        track("source", "en", "529", "source-1", source),
        track("reference", "es", "21028", "reference-es", spanish),
        track("reference", "fr", "496", "reference-fr", french),
      ],
    })
    const bodies = new Map([
      ["source-1", source],
      ["reference-es", spanish],
      ["reference-fr", french],
    ])
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const id = /\/([^/]+)\.vtt$/.exec(String(url))?.[1]
      return new Response(bodies.get(id ?? ""), { status: 200 })
    }) as typeof fetch
    const objects = new Map<string, Uint8Array>()
    const artifactBackend: SubtitleEvalArtifactBackend = {
      async putIfAbsent(key, bytes) {
        if (objects.has(key)) return "exists"
        objects.set(key, bytes.slice())
        return "created"
      },
      async read(key) {
        return objects.get(key)!.slice()
      },
    }
    const result = await activateSubtitleEvalCorpus(
      {
        manifestJson,
        lockJson,
        languageIdentities: [
          {
            bcp47: "en",
            coreLanguageId: "529",
            languageId: "admin-en",
            languageSlug: "english",
          },
          {
            bcp47: "es",
            coreLanguageId: "21028",
            languageId: "admin-es",
            languageSlug: "spanish",
          },
          {
            bcp47: "fr",
            coreLanguageId: "496",
            languageId: "admin-fr",
            languageSlug: "french",
          },
        ],
      },
      {
        expectedManifestDigest: manifestDigest,
        expectedLockDigest: sha256Bytes(lockJson),
        fetchImpl,
        artifactBackend,
        allowedCoreHosts: ["core.example"],
      },
    )
    expect(fetchImpl).toHaveBeenCalledTimes(3)
    expect(result.cells).toHaveLength(2)
    expect(
      result.cells.map((cell) => [
        cell.targetLanguageId,
        cell.targetLanguageSlug,
      ]),
    ).toEqual([
      ["admin-es", "spanish"],
      ["admin-fr", "french"],
    ])
    expect(result.cells[0]?.sourceSnapshot.objectKey).toBe(
      result.cells[1]?.sourceSnapshot.objectKey,
    )
  })

  it("streams exactly the byte ceiling and cancels at one byte over", async () => {
    const boundary = new Uint8Array(16)
    await expect(
      readBoundedResponse(new Response(boundary), 16),
    ).resolves.toHaveLength(16)
    await expect(
      readBoundedResponse(new Response(new Uint8Array(17)), 16),
    ).rejects.toThrow(/byte ceiling/i)
  })

  it("rejects an untrusted locked or redirect destination", async () => {
    expect(() =>
      assertAllowedCoreUrl("http://api-media-core.jesusfilm.org/file.vtt"),
    ).toThrow(/not allowed/i)
    expect(() =>
      assertAllowedCoreUrl("https://metadata.internal/file.vtt"),
    ).toThrow(/not allowed/i)
    expect(() =>
      assertAllowedCoreUrl("https://user:password@core.example:8443/file.vtt", [
        "core.example",
      ]),
    ).toThrow(/not allowed/i)
    expect(() =>
      assertAllowedCoreUrl("https://core.example/file.vtt", ["core.example"]),
    ).not.toThrow()
  })

  it("rejects redirect responses before following them", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: "http://169.254.169.254/latest/meta-data" },
        }),
    ) as typeof fetch
    const manifestJson = JSON.stringify({
      schemaVersion: "subtitle-translation-eval/v1",
      referenceAuthority: "provisional",
      referenceNotes: "Fixture reference authority requires certification.",
      sourceLanguage: "en",
      targetLanguages: ["es"],
      languages: [
        { bcp47: "en", coreLanguageId: "529", label: "English" },
        { bcp47: "es", coreLanguageId: "21028", label: "Spanish" },
      ],
      cases: [
        {
          id: "fixture-case",
          videoId: "video-1",
          title: "Fixture",
          collection: "Fixture Collection",
          edition: "base",
          coreVideoEditionId: "edition-1",
          clip: { startSeconds: 0, endSeconds: 2 },
        },
      ],
    })
    const manifestDigest = sha256Bytes(manifestJson)
    const track = (role: "source" | "reference", language: string) => ({
      caseId: "fixture-case",
      role,
      language,
      coreLanguageId: language === "en" ? "529" : "21028",
      subtitleId: `${role}-${language}`,
      videoId: "video-1",
      edition: "base",
      coreVideoEditionId: "edition-1",
      primary: role === "source",
      sourceUrl: `https://core.example/${role}-${language}.vtt`,
      sourceSha256: "0".repeat(64),
      clippedSha256: "0".repeat(64),
      cueCount: 1,
    })
    const lockJson = JSON.stringify({
      schemaVersion: "subtitle-translation-eval-corpus-lock/v1",
      manifestSha256: manifestDigest,
      resolvedAt: "2026-08-20T00:00:00.000Z",
      tracks: [track("source", "en"), track("reference", "es")],
    })

    await expect(
      activateSubtitleEvalCorpus(
        {
          manifestJson,
          lockJson,
          languageIdentities: [
            {
              bcp47: "en",
              coreLanguageId: "529",
              languageId: "admin-en",
              languageSlug: "english",
            },
            {
              bcp47: "es",
              coreLanguageId: "21028",
              languageId: "admin-es",
              languageSlug: "spanish",
            },
          ],
        },
        {
          expectedManifestDigest: manifestDigest,
          expectedLockDigest: sha256Bytes(lockJson),
          fetchImpl,
          allowedCoreHosts: ["core.example"],
        },
      ),
    ).rejects.toThrow(/redirect/i)
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ redirect: "manual" }),
    )
  })

  it("rejects ambiguous and extra Admin language mappings", () => {
    const languages = [
      { bcp47: "en", coreLanguageId: "529" },
      { bcp47: "es", coreLanguageId: "21028" },
    ]
    const english = {
      bcp47: "en",
      coreLanguageId: "529",
      languageId: "admin-en",
      languageSlug: "english",
    }
    const spanish = {
      bcp47: "es",
      coreLanguageId: "21028",
      languageId: "admin-es",
      languageSlug: "spanish",
    }

    expect(() =>
      assertUniqueLanguageMappings(
        [english, { ...spanish, languageId: english.languageId }],
        languages,
      ),
    ).toThrow(/unique/i)
    expect(() =>
      assertUniqueLanguageMappings(
        [english, { ...spanish, languageSlug: english.languageSlug }],
        languages,
      ),
    ).toThrow(/unique/i)
    expect(() =>
      assertUniqueLanguageMappings(
        [
          english,
          spanish,
          {
            ...spanish,
            bcp47: "fr",
            languageId: "admin-fr",
            languageSlug: "french",
          },
        ],
        languages,
      ),
    ).toThrow(/exactly cover/i)
  })

  it("rejects a locked track bound to the wrong frozen video", () => {
    const manifest = {
      sourceLanguage: "en",
      targetLanguages: ["es"],
      languages: [
        { bcp47: "en", coreLanguageId: "529" },
        { bcp47: "es", coreLanguageId: "21028" },
      ],
      cases: [
        {
          id: "case-1",
          videoId: "video-1",
          edition: "base",
          coreVideoEditionId: "edition-1",
        },
      ],
    }
    const base = {
      caseId: "case-1",
      videoId: "video-1",
      edition: "base",
      coreVideoEditionId: "edition-1",
    }
    expect(() =>
      assertLockedTrackCoverage(
        manifest as never,
        {
          tracks: [
            {
              ...base,
              role: "source",
              language: "en",
              coreLanguageId: "529",
              subtitleId: "source-1",
              primary: true,
            },
            {
              ...base,
              role: "reference",
              language: "es",
              coreLanguageId: "21028",
              subtitleId: "reference-1",
              primary: false,
              videoId: "wrong-video",
            },
          ],
        } as never,
      ),
    ).toThrow(/identity/i)
  })
})
