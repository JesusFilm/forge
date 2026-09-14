import { describe, expect, it } from "vitest"
import {
  applyIntentionalExperienceEditorDubChoice,
  createExperienceEditorDubChoice,
  deduplicateExperienceEditorDubs,
  editorDubStreamUrl,
  EMPTY_EXPERIENCE_EDITOR_DUB_INVENTORY,
  experienceEditorLanguageIdentity,
  NOT_LOADED_EXPERIENCE_EDITOR_DUB_INVENTORY,
  resolveExperienceEditorDub,
  type ExperienceEditorDubCandidate,
} from "./experience-editor-video.service"

function dub(
  overrides: Partial<ExperienceEditorDubCandidate> &
    Pick<ExperienceEditorDubCandidate, "id">,
): ExperienceEditorDubCandidate {
  return {
    id: overrides.id,
    videoId: "video-1",
    languageId: "language-en",
    deletedAt: null,
    updatedAt: new Date("2026-09-14T12:00:00.000Z"),
    hls: null,
    dash: null,
    share: null,
    duration: null,
    lengthInMilliseconds: null,
    language: {
      id: "language-en",
      slug: "english",
      bcp47: "en",
      iso3: "eng",
      name: { en: "English" },
    },
    ...overrides,
  }
}

describe("experience editor dub semantics", () => {
  it("keeps editor eligibility independent of published state and prefers HLS within a dub", () => {
    const choice = createExperienceEditorDubChoice(
      dub({
        id: "dub-any-stream",
        published: false,
        hls: " https://media.example/video.m3u8 ",
        dash: "https://media.example/video.mpd",
        share: "https://media.example/video.mp4",
        lengthInMilliseconds: BigInt(125_900),
      }),
      "en",
    )

    expect(editorDubStreamUrl(dub({ id: "dash", dash: "dash-url" }))).toBe(
      "dash-url",
    )
    expect(choice).toMatchObject({
      key: "dub-any-stream",
      streamUrl: "https://media.example/video.m3u8",
      durationSeconds: 125,
    })
    expect(
      createExperienceEditorDubChoice(
        dub({ id: "deleted", deletedAt: new Date(), hls: "hls-url" }),
        "en",
      ),
    ).toBeNull()
    expect(
      createExperienceEditorDubChoice(dub({ id: "empty", hls: "  " }), "en"),
    ).toBeNull()
  })

  it("resolves language before a mismatched legacy stream, then legacy before locale fallback", () => {
    const english = dub({ id: "dub-en", hls: "en-hls" })
    const french = dub({
      id: "dub-fr",
      languageId: "language-fr",
      hls: "fr-hls",
      language: {
        id: "language-fr",
        slug: "french",
        bcp47: "fr",
        iso3: "fra",
        name: { en: "French" },
      },
    })

    expect(
      resolveExperienceEditorDub([english, french], "fr", {
        videoId: "video-1",
        languageId: "language-en",
        legacyStreamingUrl: "fr-hls",
      })?.id,
    ).toBe("dub-en")
    expect(
      resolveExperienceEditorDub([english, french], "en", {
        videoId: "video-1",
        languageId: null,
        legacyStreamingUrl: "fr-hls",
      })?.id,
    ).toBe("dub-fr")
    expect(resolveExperienceEditorDub([english, french], "fr", null)?.id).toBe(
      "dub-fr",
    )
  })

  it("uses locale before protocol fallback and stable ids for equal timestamps", () => {
    const localeDash = dub({
      id: "dub-fr-dash",
      languageId: "language-fr",
      dash: "fr-dash",
      language: {
        id: "language-fr",
        slug: "french",
        bcp47: "fr-CA",
        iso3: "fra",
        name: { en: "French" },
      },
    })
    const laterIdHls = dub({ id: "dub-z", hls: "z-hls" })
    const earlierIdHls = dub({ id: "dub-a", hls: "a-hls" })

    expect(
      resolveExperienceEditorDub(
        [laterIdHls, earlierIdHls, localeDash],
        "fr-CA",
        null,
      )?.id,
    ).toBe("dub-fr-dash")
    expect(
      resolveExperienceEditorDub(
        [laterIdHls, earlierIdHls, localeDash],
        "de",
        null,
      )?.id,
    ).toBe("dub-a")
  })

  it("deduplicates language identities by slug, bcp47, iso3, language id, then dub id", () => {
    const newer = dub({
      id: "dub-z-newer",
      hls: "newer-hls",
      updatedAt: new Date("2026-09-14T13:00:00.000Z"),
    })
    const older = dub({ id: "dub-a-older", hls: "older-hls" })
    const languageIdOnly = dub({
      id: "dub-id-only",
      languageId: "language-id-only",
      dash: "id-only-dash",
      language: {
        id: "language-id-only",
        slug: null,
        bcp47: null,
        iso3: null,
        name: {},
      },
    })
    const noLanguage = dub({
      id: "dub-no-language",
      languageId: null,
      share: "share-url",
      language: null,
    })

    expect(
      deduplicateExperienceEditorDubs(
        [older, noLanguage, languageIdOnly, newer],
        "en",
      ).map((choice) => choice.key),
    ).toEqual(["dub-z-newer", "dub-id-only", "dub-no-language"])
    expect(
      experienceEditorLanguageIdentity(
        dub({
          id: "dub-bcp47",
          languageId: "language-bcp47",
          language: {
            id: "language-bcp47",
            slug: null,
            bcp47: "PT-BR",
            iso3: "por",
            name: {},
          },
        }),
      ),
    ).toBe("pt-br")
    expect(
      experienceEditorLanguageIdentity(
        dub({
          id: "dub-iso3",
          languageId: "language-iso3",
          language: {
            id: "language-iso3",
            slug: null,
            bcp47: null,
            iso3: "SPA",
            name: {},
          },
        }),
      ),
    ).toBe("spa")
  })

  it("distinguishes an omitted inventory from a loaded empty page", () => {
    expect(NOT_LOADED_EXPERIENCE_EDITOR_DUB_INVENTORY).toEqual({
      status: "not-loaded",
    })
    expect(EMPTY_EXPERIENCE_EDITOR_DUB_INVENTORY).toEqual({
      status: "loaded",
      choices: [],
      nextCursor: null,
    })
  })

  it("keeps background fallback read-only and resets clips only for an intentional language change", () => {
    const english = createExperienceEditorDubChoice(
      dub({ id: "dub-en", hls: "en-hls" }),
      "en",
    )!
    const french = createExperienceEditorDubChoice(
      dub({
        id: "dub-fr",
        languageId: "language-fr",
        hls: "fr-hls",
        language: {
          id: "language-fr",
          slug: "french",
          bcp47: "fr",
          iso3: "fra",
          name: { en: "French" },
        },
      }),
      "en",
    )!
    const authored = {
      languageId: "language-en",
      streamingUrl: "legacy-en-url",
      clipStartSeconds: 12,
      clipEndSeconds: 34,
      title: "Keep me",
    }

    resolveExperienceEditorDub([dub({ id: "dub-en", hls: "en-hls" })], "en", {
      videoId: "video-1",
      languageId: authored.languageId,
      legacyStreamingUrl: authored.streamingUrl,
    })
    expect(authored).toEqual({
      languageId: "language-en",
      streamingUrl: "legacy-en-url",
      clipStartSeconds: 12,
      clipEndSeconds: 34,
      title: "Keep me",
    })
    expect(applyIntentionalExperienceEditorDubChoice(authored, english)).toBe(
      authored,
    )
    expect(applyIntentionalExperienceEditorDubChoice(authored, french)).toEqual(
      {
        languageId: "language-fr",
        streamingUrl: undefined,
        clipStartSeconds: 0,
        clipEndSeconds: undefined,
        title: "Keep me",
      },
    )
  })
})
