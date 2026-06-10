import { normalizeVideo, normalizeDubMedia } from "./normalizeVideo"

// ── Builders ────────────────────────────────────────────────────────
//
// makeChild builds one parent.children[] entry (a { child } relation wrapper).
// The whole makeRawVideo return is cast to the normalizer's param type, so this
// stays as an inferred object literal whose concrete field types overlap it.
function makeChild(documentId: string, slug: string, title: string) {
  return {
    child: {
      documentId,
      slug,
      label: "SEGMENT",
      locales: [
        { documentId: `${documentId}-loc`, languageSlug: "english", title },
      ],
      images: [] as {
        documentId: string
        url: string | null
        thumbnail: string | null
        mobileCinematicHigh: string | null
        mobileCinematicLow: string | null
      }[],
    },
  }
}

function makeRawDub(overrides: Record<string, unknown> = {}) {
  return {
    documentId: "dub-1",
    downloads: [
      {
        documentId: "dl-1",
        quality: "720p",
        size: "52428800",
        url: "https://dl.example.com/720p.mp4",
      },
    ],
    videoEdition: {
      subtitles: [
        {
          documentId: "sub-1",
          language: { slug: "english", name: "English", bcp47: "en" },
          vttSrc: "https://subs.example.com/en.vtt",
          primary: true,
          aiGenerated: false,
        },
        {
          documentId: "sub-2",
          language: {
            slug: "spanish",
            name: { en: "Spanish", es: "Español" },
            bcp47: "es",
          },
          vttSrc: "https://subs.example.com/es.vtt",
          primary: false,
          aiGenerated: true,
        },
      ],
    },
    ...overrides,
  }
}

// makeRawVideo defaults to the CURRENT (inverted) schema shape: the parent's
// children list contains ONLY this video (self-references), which is what the
// live videoBySlug(...).children probe returns on main today.
function makeRawVideo(overrides: Record<string, unknown> = {}) {
  return {
    documentId: "vid-1",
    slug: "the-crucifixion",
    label: "SEGMENT",
    images: [
      {
        documentId: "img-1",
        url: "https://img.example.com/poster.jpg",
        thumbnail: "https://img.example.com/thumb.jpg",
        mobileCinematicHigh: "https://img.example.com/cinematic.jpg",
        mobileCinematicLow: null,
      },
    ],
    primaryLanguage: { coreId: "529", bcp47: "en" },
    locales: [
      {
        documentId: "loc-1",
        languageSlug: "english",
        title: "The Crucifixion",
        description: "A depiction of the crucifixion.",
        snippet: "Short snippet",
        imageAlt: "Crucifixion scene",
      },
    ],
    parents: [
      {
        parent: {
          documentId: "parent-1",
          slug: "easter-story",
          label: "COLLECTION",
          locales: [
            {
              documentId: "ploc-1",
              languageSlug: "english",
              title: "The Easter Story",
            },
          ],
          images: [],
          // Inverted schema: only self-references.
          children: [
            makeChild("vid-1", "the-crucifixion", "The Crucifixion"),
            makeChild("vid-1", "the-crucifixion", "The Crucifixion"),
          ],
        },
      },
    ],
    variants: [
      {
        documentId: "dub-1",
        slug: "the-crucifixion-english",
        published: true,
        hls: "https://stream.mux.com/abc123.m3u8",
        duration: 725,
        language: {
          coreId: "529",
          bcp47: "en",
          slug: "english",
          name: { en: "English" },
        },
        muxVideo: { playbackId: "abc123" },
      },
      {
        documentId: "dub-2",
        slug: "the-crucifixion-spanish",
        published: true,
        hls: "https://stream.mux.com/def456.m3u8",
        duration: 730,
        language: {
          coreId: "21028",
          bcp47: "es",
          slug: "spanish",
          name: { en: "Spanish", es: "Español" },
        },
        muxVideo: { playbackId: "def456" },
      },
      {
        documentId: "dub-3",
        slug: "unpublished-dub",
        published: false,
        hls: null,
        duration: null,
        language: null,
        muxVideo: null,
      },
    ],
    studyQuestions: [
      {
        documentId: "sq-2",
        languageSlug: "english",
        value: "Second question?",
        order: 2,
      },
      {
        documentId: "sq-1",
        languageSlug: "english",
        value: "First question?",
        order: 1,
      },
      { documentId: "sq-3", languageSlug: "english", value: "", order: 3 },
    ],
    bibleCitations: [
      {
        documentId: "bc-1",
        chapterStart: 19,
        chapterEnd: 19,
        verseStart: 30,
        verseEnd: 30,
        order: 1,
        osisId: "John.19.30",
        bibleBook: { documentId: "bb-1", name: { en: "John" } },
      },
    ],
    ...overrides,
  } as Parameters<typeof normalizeVideo>[0]
}

describe("normalizeVideo — base record", () => {
  it("returns null for null / undefined input", () => {
    expect(normalizeVideo(null)).toBeNull()
    expect(normalizeVideo(undefined)).toBeNull()
  })

  it("returns null when the partial object has no documentId (no identity yet)", () => {
    expect(
      normalizeVideo({ slug: "lonely" } as Parameters<
        typeof normalizeVideo
      >[0]),
    ).toBeNull()
  })

  it("produces a complete record from a fully populated response", () => {
    const result = normalizeVideo(makeRawVideo())!

    expect(result.documentId).toBe("vid-1")
    expect(result.slug).toBe("the-crucifixion")
    expect(result.label).toBe("SEGMENT")
    expect(result.title).toBe("The Crucifixion")
    expect(result.description).toBe("A depiction of the crucifixion.")
    expect(result.posterUrl).toBe("https://img.example.com/cinematic.jpg")
    expect(result.streamingUrl).toBe("https://stream.mux.com/abc123.m3u8")
    expect(result.muxPlaybackId).toBe("abc123")
    expect(result.duration).toBe(725)
    expect(result.primaryLanguageBcp47).toBe("en")
  })

  it("filters unpublished variants", () => {
    const result = normalizeVideo(makeRawVideo())!
    expect(result.variants).toHaveLength(2)
    expect(result.variants.every((v) => v.published)).toBe(true)
  })

  it("does not project per-dub downloads/subtitles onto bulk variants", () => {
    const result = normalizeVideo(makeRawVideo())!
    const englishVariant = result.variants.find(
      (v) => v.languageSlug === "english",
    )!
    expect(englishVariant).not.toHaveProperty("downloads")
    expect(englishVariant).not.toHaveProperty("subtitles")
  })

  it("computes languageNameNative: null for English, the native label for a distinct one", () => {
    const result = normalizeVideo(makeRawVideo())!
    const en = result.variants.find((v) => v.languageSlug === "english")!
    const es = result.variants.find((v) => v.languageSlug === "spanish")!
    // Branch 1: bcp47 === "en" → null (no redundant native label for English).
    expect(en.languageNameNative).toBeNull()
    // Branch 3: native name distinct from the English name → returned.
    expect(es.languageNameNative).toBe("Español")
  })

  it("languageNameNative is null when the native name equals the English name", () => {
    // Branch 2: a language whose name map has only an English entry — the native
    // lookup falls back to the same string, so there is no distinct native label.
    const result = normalizeVideo(
      makeRawVideo({
        variants: [
          {
            documentId: "dub-ko",
            slug: "korean-dub",
            published: true,
            hls: "https://stream.mux.com/kkk.m3u8",
            duration: 100,
            language: {
              coreId: "1",
              bcp47: "ko",
              slug: "korean",
              name: { en: "Korean" },
            },
            muxVideo: { playbackId: "kkk" },
          },
        ],
      }),
    )!
    const ko = result.variants.find((v) => v.languageSlug === "korean")!
    expect(ko.languageNameNative).toBeNull()
  })

  it("sorts study questions by order and filters empty values", () => {
    const result = normalizeVideo(makeRawVideo())!
    expect(result.studyQuestions).toHaveLength(2)
    expect(result.studyQuestions[0].value).toBe("First question?")
    expect(result.studyQuestions[1].value).toBe("Second question?")
  })

  it("normalizes bible citations with book name from locale map", () => {
    const result = normalizeVideo(makeRawVideo())!
    expect(result.bibleCitations).toHaveLength(1)
    expect(result.bibleCitations[0].bookName).toBe("John")
    expect(result.bibleCitations[0].osisId).toBe("John.19.30")
    expect(result.bibleCitations[0].chapterStart).toBe(19)
    expect(result.bibleCitations[0].verseStart).toBe(30)
  })

  it("handles missing relations gracefully", () => {
    const result = normalizeVideo(
      makeRawVideo({
        locales: [],
        images: [],
        variants: [],
        studyQuestions: null,
        bibleCitations: null,
        parents: null,
        primaryLanguage: null,
      }),
    )!

    expect(result.title).toBeNull()
    expect(result.posterUrl).toBeNull()
    expect(result.streamingUrl).toBeNull()
    expect(result.muxPlaybackId).toBeNull()
    expect(result.primaryLanguageBcp47).toBeNull()
    expect(result.siblings).toEqual([])
    expect(result.variants).toEqual([])
    expect(result.studyQuestions).toEqual([])
    expect(result.bibleCitations).toEqual([])
  })
})

describe("normalizeVideo — Up Next siblings", () => {
  // KTD5: on the CURRENT inverted admin schema, parent.children holds only
  // self-references, so after the self-filter the rail is EMPTY (not unordered).
  it("current (inverted) schema: a children list of only self-references yields an empty sibling list", () => {
    const result = normalizeVideo(makeRawVideo())!
    expect(result.siblings).toEqual([])
  })

  // POST-FIX schema: genuine siblings, including a stray self-ref and a dup —
  // self removed and duplicates collapsed (R15).
  it("post-fix schema: genuine siblings with a stray self-ref + duplicate → self removed, deduped", () => {
    const raw = makeRawVideo({
      parents: [
        {
          parent: {
            documentId: "parent-1",
            slug: "easter-story",
            label: "COLLECTION",
            locales: [],
            images: [],
            children: [
              makeChild("vid-1", "the-crucifixion", "The Crucifixion"), // self — must drop
              makeChild("vid-2", "the-resurrection", "The Resurrection"),
              makeChild("vid-3", "the-ascension", "The Ascension"),
              makeChild("vid-2", "the-resurrection", "The Resurrection"), // dup — collapse
            ],
          },
        },
      ],
    })
    const result = normalizeVideo(raw)!
    expect(result.siblings.map((s) => s.slug)).toEqual([
      "the-resurrection",
      "the-ascension",
    ])
    expect(result.siblings.map((s) => s.documentId)).toEqual(["vid-2", "vid-3"])
  })

  it("returns empty siblings for orphan videos (no parents)", () => {
    const result = normalizeVideo(makeRawVideo({ parents: [] }))!
    expect(result.siblings).toEqual([])
  })

  it("uses the first parent's children when a video has multiple parents", () => {
    const raw = makeRawVideo({
      parents: [
        {
          parent: {
            documentId: "parent-1",
            slug: "easter-story",
            label: "COLLECTION",
            locales: [],
            images: [],
            children: [
              makeChild("vid-2", "from-first-parent", "From First Parent"),
            ],
          },
        },
        {
          parent: {
            documentId: "parent-2",
            slug: "other-collection",
            label: "COLLECTION",
            locales: [],
            images: [],
            children: [
              makeChild("vid-99", "from-second-parent", "From Second Parent"),
            ],
          },
        },
      ],
    })
    const result = normalizeVideo(raw)!
    expect(result.siblings).toHaveLength(1)
    expect(result.siblings[0].slug).toBe("from-first-parent")
  })
})

describe("normalizeVideo — memoization (WeakMap on raw reference)", () => {
  it("re-normalizing the same raw reference returns the memoized record (identity, no re-walk)", () => {
    const raw = makeRawVideo()
    const first = normalizeVideo(raw)
    const second = normalizeVideo(raw)
    expect(first).not.toBeNull()
    expect(second).toBe(first) // referential identity proves the cache hit
  })

  it("a different raw reference produces a distinct record", () => {
    const a = normalizeVideo(makeRawVideo())
    const b = normalizeVideo(makeRawVideo())
    expect(a).not.toBe(b)
  })
})

describe("normalizeDubMedia (lazy per-dub media)", () => {
  it("preserves downloads with quality and URL", () => {
    const media = normalizeDubMedia(makeRawDub())
    expect(media.downloads).toHaveLength(1)
    expect(media.downloads[0]).toEqual({
      documentId: "dl-1",
      quality: "720p",
      size: "52428800",
      url: "https://dl.example.com/720p.mp4",
    })
  })

  it("maps subtitles with language info", () => {
    const media = normalizeDubMedia(makeRawDub())
    expect(media.subtitles).toHaveLength(2)
    expect(media.subtitles[0].languageBcp47).toBe("en")
    expect(media.subtitles[0].primary).toBe(true)
    expect(media.subtitles[1].languageName).toBe("Spanish")
    expect(media.subtitles[1].aiGenerated).toBe(true)
  })

  it("computes subtitle languageNameNative like audio dubs (null for English, native otherwise)", () => {
    const media = normalizeDubMedia(makeRawDub())
    // English subtitle (bcp47 "en") → no redundant native label.
    expect(media.subtitles[0].languageNameNative).toBeNull()
    // Spanish subtitle has a distinct native name in its locale map → returned.
    expect(media.subtitles[1].languageNameNative).toBe("Español")
  })

  it("returns a fresh empty record for a missing dub", () => {
    expect(normalizeDubMedia(null)).toEqual({ downloads: [], subtitles: [] })
    expect(normalizeDubMedia(undefined)).toEqual({
      downloads: [],
      subtitles: [],
    })
  })

  it("tolerates a dub with no downloads or subtitles", () => {
    const media = normalizeDubMedia(
      makeRawDub({ downloads: [], videoEdition: null }),
    )
    expect(media).toEqual({ downloads: [], subtitles: [] })
  })
})
