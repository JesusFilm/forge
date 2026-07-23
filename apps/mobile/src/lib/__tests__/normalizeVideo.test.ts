import {
  normalizeVideo,
  normalizeDubMedia,
  normalizeSeries,
} from "../normalizeVideo"

// A single dub's raw shape as returned by GET_VIDEO_DUB (the lazy per-dub media
// query). Downloads + subtitles now live here, not on the bulk WatchVideo dubs.
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
      {
        documentId: "dl-2",
        quality: "480p",
        size: "26214400",
        url: "https://dl.example.com/480p.mp4",
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
          children: [
            {
              child: {
                documentId: "vid-1",
                slug: "the-crucifixion",
                label: "SEGMENT",
                locales: [
                  {
                    documentId: "cloc-1",
                    languageSlug: "english",
                    title: "The Crucifixion",
                  },
                ],
                images: [
                  {
                    documentId: "cimg-1",
                    url: "https://img.example.com/crucifixion.jpg",
                    thumbnail: null,
                    mobileCinematicHigh: null,
                    mobileCinematicLow: null,
                  },
                ],
              },
            },
            {
              child: {
                documentId: "vid-2",
                slug: "the-resurrection",
                label: "SEGMENT",
                locales: [
                  {
                    documentId: "cloc-2",
                    languageSlug: "english",
                    title: "The Resurrection",
                  },
                ],
                images: [
                  {
                    documentId: "cimg-2",
                    url: "https://img.example.com/resurrection.jpg",
                    thumbnail: null,
                    mobileCinematicHigh: null,
                    mobileCinematicLow: null,
                  },
                ],
              },
            },
            {
              child: {
                documentId: "vid-3",
                slug: "the-ascension",
                label: "SEGMENT",
                locales: [
                  {
                    documentId: "cloc-3",
                    languageSlug: "english",
                    title: "The Ascension",
                  },
                ],
                images: [],
              },
            },
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

describe("normalizeVideo", () => {
  it("returns null for null input", () => {
    expect(normalizeVideo(null)).toBeNull()
    expect(normalizeVideo(undefined)).toBeNull()
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

  // U1: the watch route attaches seriesSlug/seriesTitle from parentSeries — but
  // ONLY for a genuine episodic SERIES parent, so standalone films that merely
  // belong to a COLLECTION don't fold into a Library series folder.
  it("surfaces parentSeries only for a genuine SERIES parent", () => {
    const result = normalizeVideo(
      makeRawVideo({
        parents: [
          {
            parent: {
              documentId: "parent-1",
              slug: "storyclubs",
              label: "SERIES",
              locales: [
                {
                  documentId: "ploc-1",
                  languageSlug: "english",
                  title: "StoryClubs",
                },
              ],
              images: [],
              children: [],
            },
          },
        ],
      }),
    )!
    expect(result.parentSeries).toEqual({
      documentId: "parent-1",
      slug: "storyclubs",
      title: "StoryClubs",
    })
  })

  // Regression: the default fixture's parent is a COLLECTION ("The Easter Story").
  // Its members are individually watchable — they must render standalone, never
  // folded under the collection as if it were a series.
  it("resolves parentSeries to null for a COLLECTION parent", () => {
    const result = normalizeVideo(makeRawVideo())!
    expect(result.parentSeries).toBeNull()
  })

  it("resolves parentSeries to null when the video has no parents", () => {
    const result = normalizeVideo(makeRawVideo({ parents: [] }))!
    expect(result.parentSeries).toBeNull()
  })

  // Pins the intentional parents[0]-only contract (shared with the siblings
  // derivation): a SERIES parent behind a COLLECTION at index 0 is not searched.
  it("resolves parentSeries to null when a SERIES parent sits behind a COLLECTION at index 0", () => {
    const result = normalizeVideo(
      makeRawVideo({
        parents: [
          {
            parent: {
              documentId: "col-1",
              slug: "a-collection",
              label: "COLLECTION",
              locales: [],
              images: [],
              children: [],
            },
          },
          {
            parent: {
              documentId: "ser-1",
              slug: "a-series",
              label: "SERIES",
              locales: [],
              images: [],
              children: [],
            },
          },
        ],
      }),
    )!
    expect(result.parentSeries).toBeNull()
  })

  // Prod regression: a dub's hls shipped with a trailing "\n"; the raw string
  // reaching the native player 400s at Mux. Ingest trimmed, never raw.
  it("trims whitespace-tainted hls at ingestion (streamingUrl + variants)", () => {
    const raw = makeRawVideo()
    const variants = (
      raw as unknown as { variants: { hls: string | null }[] }
    ).variants.map((v, index) =>
      index === 0 ? { ...v, hls: `${v.hls}\n` } : v,
    )
    const result = normalizeVideo({ ...raw, variants } as typeof raw)!

    expect(result.streamingUrl).toBe("https://stream.mux.com/abc123.m3u8")
    expect(
      result.variants.map((v) => v.hls).every((h) => h === h?.trim()),
    ).toBe(true)
  })

  it("skips a whitespace-only hls when picking the first playable variant", () => {
    const raw = makeRawVideo()
    const variants = (
      raw as unknown as { variants: { hls: string | null }[] }
    ).variants.map((v, index) => (index === 0 ? { ...v, hls: "  \n" } : v))
    const result = normalizeVideo({ ...raw, variants } as typeof raw)!

    // dub-1's hls is unplayable; the pick must advance to dub-2 (Spanish).
    expect(result.streamingUrl).toBe("https://stream.mux.com/def456.m3u8")
  })

  it("filters self-references from siblings", () => {
    const result = normalizeVideo(makeRawVideo())!

    expect(result.siblings).toHaveLength(2)
    expect(result.siblings.map((s) => s.slug)).toEqual([
      "the-resurrection",
      "the-ascension",
    ])
  })

  it("deduplicates siblings by documentId", () => {
    const raw = makeRawVideo()
    const parent = raw!.parents![0]!.parent!
    parent.children = [
      ...parent.children!,
      {
        child: {
          documentId: "vid-2",
          slug: "the-resurrection",
          label: "SEGMENT",
          locales: [
            {
              documentId: "cloc-2",
              languageSlug: "english",
              title: "The Resurrection",
            },
          ],
          images: [],
        },
      },
    ]

    const result = normalizeVideo(raw)!
    const resurrectionCount = result.siblings.filter(
      (s) => s.documentId === "vid-2",
    ).length
    expect(resurrectionCount).toBe(1)
  })

  it("returns empty siblings for orphan videos (no parents)", () => {
    const result = normalizeVideo(makeRawVideo({ parents: [] }))!
    expect(result.siblings).toEqual([])
  })

  it("filters unpublished variants", () => {
    const result = normalizeVideo(makeRawVideo())!
    expect(result.variants).toHaveLength(2)
    expect(result.variants.every((v) => v.published)).toBe(true)
  })

  it("does not project per-dub downloads/subtitles onto bulk variants", () => {
    // The bulk WatchVideo query is lean by design — downloads/subtitles are
    // fetched lazily per dub (normalizeDubMedia), never inlined here.
    const result = normalizeVideo(makeRawVideo())!
    const englishVariant = result.variants.find(
      (v) => v.languageSlug === "english",
    )!
    expect(englishVariant).not.toHaveProperty("downloads")
    expect(englishVariant).not.toHaveProperty("subtitles")
  })

  describe("normalizeDubMedia (lazy per-dub media)", () => {
    it("preserves downloads with quality and URL", () => {
      const media = normalizeDubMedia(makeRawDub())
      expect(media.downloads).toHaveLength(2)
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
      expect(media.subtitles[1].aiGenerated).toBe(true)
    })

    it("returns empty media for a missing dub", () => {
      expect(normalizeDubMedia(null)).toEqual({ downloads: [], subtitles: [] })
    })

    it("tolerates a dub with no downloads or subtitles", () => {
      const media = normalizeDubMedia(
        makeRawDub({ downloads: [], videoEdition: null }),
      )
      expect(media).toEqual({ downloads: [], subtitles: [] })
    })
  })

  it("sorts study questions by order and filters empty", () => {
    const result = normalizeVideo(makeRawVideo())!
    expect(result.studyQuestions).toHaveLength(2)
    expect(result.studyQuestions[0].value).toBe("First question?")
    expect(result.studyQuestions[1].value).toBe("Second question?")
  })

  it("chooses broad locale rows deterministically when multiple variants share BCP-47", () => {
    const result = normalizeVideo(
      makeRawVideo({
        locales: [
          {
            documentId: "loc-z",
            languageSlug: "russian-z",
            title: "Russian Z",
            description: "Russian Z description",
            snippet: "Russian Z snippet",
          },
          {
            documentId: "loc-legacy",
            languageSlug: null,
            title: "Legacy Russian",
            description: "Legacy Russian description",
            snippet: "Legacy Russian snippet",
          },
          {
            documentId: "loc-a",
            languageSlug: "russian-a",
            title: "Russian A",
            description: "Russian A description",
            snippet: "Russian A snippet",
          },
        ],
        studyQuestions: [
          {
            documentId: "sq-z",
            languageSlug: "russian-z",
            value: "Z question?",
            order: 1,
          },
          {
            documentId: "sq-legacy",
            languageSlug: null,
            value: "Legacy question?",
            order: 1,
          },
          {
            documentId: "sq-a",
            languageSlug: "russian-a",
            value: "A question?",
            order: 1,
          },
        ],
      }),
    )!

    expect(result.title).toBe("Russian A")
    expect(result.studyQuestions.map((question) => question.value)).toEqual([
      "A question?",
      "Z question?",
      "Legacy question?",
    ])
  })

  it("normalizes bible citations with book name from locale map", () => {
    const result = normalizeVideo(makeRawVideo())!
    expect(result.bibleCitations).toHaveLength(1)
    expect(result.bibleCitations[0].bookName).toBe("John")
    expect(result.bibleCitations[0].osisId).toBe("John.19.30")
    expect(result.bibleCitations[0].chapterStart).toBe(19)
    expect(result.bibleCitations[0].verseStart).toBe(30)
  })

  it("sorts a frozen bibleCitations array without mutating it", () => {
    // Apollo's InMemoryCache returns frozen arrays and Array.sort mutates in
    // place, so normalizeVideo must copy before sorting (else "Cannot assign to
    // read-only property"). Inverted order forces a swap, so no copy = throw.
    const frozenCitations = Object.freeze([
      {
        documentId: "bc-2",
        chapterStart: 1,
        verseStart: 1,
        order: 2,
        osisId: "John.1.1",
        bibleBook: { documentId: "bb-2", name: { en: "John" } },
      },
      {
        documentId: "bc-1",
        chapterStart: 3,
        verseStart: 16,
        order: 1,
        osisId: "John.3.16",
        bibleBook: { documentId: "bb-1", name: { en: "John" } },
      },
    ])

    const result = normalizeVideo(
      makeRawVideo({ bibleCitations: frozenCitations }),
    )!

    expect(result.bibleCitations).toHaveLength(2)
    // Ascending by order: bc-1 (order 1) before bc-2 (order 2).
    expect(result.bibleCitations[0].documentId).toBe("bc-1")
    expect(result.bibleCitations[1].documentId).toBe("bc-2")
  })

  it("handles missing fields gracefully", () => {
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
    expect(result.description).toBeNull()
    expect(result.posterUrl).toBeNull()
    expect(result.streamingUrl).toBeNull()
    expect(result.muxPlaybackId).toBeNull()
    expect(result.primaryLanguageBcp47).toBeNull()
    expect(result.siblings).toEqual([])
    expect(result.variants).toEqual([])
    expect(result.studyQuestions).toEqual([])
    expect(result.bibleCitations).toEqual([])
  })

  it("uses first parent's children for siblings with multiple parents", () => {
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
              {
                child: {
                  documentId: "vid-2",
                  slug: "from-first-parent",
                  label: "SEGMENT",
                  locales: [
                    {
                      documentId: "l1",
                      languageSlug: "english",
                      title: "From First Parent",
                    },
                  ],
                  images: [],
                },
              },
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
              {
                child: {
                  documentId: "vid-99",
                  slug: "from-second-parent",
                  label: "SEGMENT",
                  locales: [
                    {
                      documentId: "l2",
                      languageSlug: "english",
                      title: "From Second Parent",
                    },
                  ],
                  images: [],
                },
              },
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

describe("normalizeVideo — partial data (returnPartialData)", () => {
  const partial = (o: Record<string, unknown>) =>
    o as unknown as Parameters<typeof normalizeVideo>[0]

  it("returns null for null / undefined input", () => {
    expect(normalizeVideo(null)).toBeNull()
    expect(normalizeVideo(undefined)).toBeNull()
  })

  it("returns null when the partial object has no documentId (no identity yet)", () => {
    expect(normalizeVideo(partial({ slug: "lonely" }))).toBeNull()
    expect(normalizeVideo(makeRawVideo({ documentId: "" }) as never)).toBeNull()
  })

  it("produces a valid record with empty arrays when relations are absent", () => {
    const result = normalizeVideo(
      partial({ documentId: "vid-9", slug: "lonely", label: "SEGMENT" }),
    )!
    expect(result).not.toBeNull()
    expect(result.documentId).toBe("vid-9")
    expect(result.slug).toBe("lonely")
    expect(result.variants).toEqual([])
    expect(result.siblings).toEqual([])
    expect(result.studyQuestions).toEqual([])
    expect(result.bibleCitations).toEqual([])
    expect(result.streamingUrl).toBeNull()
    expect(result.posterUrl).toBeNull()
    expect(result.title).toBeNull()
  })
})

function makeRawSeries(overrides: Record<string, unknown> = {}) {
  const child = (
    n: number,
    extra: Record<string, unknown> = {},
  ): { order: number; child: Record<string, unknown> } => ({
    order: n,
    child: {
      documentId: `ep-${n}`,
      slug: `episode-${n}`,
      label: "EPISODE",
      locales: [
        {
          documentId: `eploc-${n}`,
          languageSlug: "english",
          title: `Episode ${n}`,
        },
      ],
      images: [
        {
          documentId: `epimg-${n}`,
          url: `https://img.example.com/ep${n}.jpg`,
          thumbnail: `https://img.example.com/ep${n}-thumb.jpg`,
          mobileCinematicHigh: `https://img.example.com/ep${n}-cine.jpg`,
          mobileCinematicLow: null,
        },
      ],
      ...extra,
    },
  })
  return {
    documentId: "series-1",
    slug: "storyclubs",
    label: "SERIES",
    images: [
      {
        documentId: "simg-1",
        url: "https://img.example.com/series-poster.jpg",
        thumbnail: "https://img.example.com/series-thumb.jpg",
        mobileCinematicHigh: "https://img.example.com/series-cine.jpg",
        mobileCinematicLow: null,
      },
    ],
    primaryLanguage: { coreId: "529", bcp47: "en" },
    locales: [
      {
        documentId: "sloc-1",
        languageSlug: "english",
        title: "StoryClubs",
        description: "Bible lessons for kids.",
        snippet: "Kids around the world",
        imageAlt: "StoryClubs",
      },
    ],
    parents: [],
    variants: [
      {
        documentId: "trailer-dub",
        slug: "storyclubs-trailer-english",
        published: true,
        hls: "https://stream.mux.com/trailer.m3u8",
        duration: 45,
        language: {
          coreId: "529",
          bcp47: "en",
          slug: "english",
          name: { en: "English" },
        },
        muxVideo: { playbackId: "trailer123" },
      },
    ],
    // Deliberately out of order to prove sort-by-`order`.
    children: [child(2), child(1), child(3)],
    childDubLanguages: [
      { slug: "english", name: { en: "English" }, bcp47: "en" },
      { slug: "spanish", name: { en: "Spanish", es: "Español" }, bcp47: "es" },
      // Duplicate slug to prove dedupe.
      { slug: "english", name: { en: "English" }, bcp47: "en" },
    ],
    studyQuestions: [],
    bibleCitations: [],
    ...overrides,
  } as unknown as Parameters<typeof normalizeSeries>[0]
}

describe("normalizeSeries", () => {
  it("returns null for null / undefined / identity-less input", () => {
    expect(normalizeSeries(null)).toBeNull()
    expect(normalizeSeries(undefined)).toBeNull()
    expect(
      normalizeSeries(makeRawSeries({ documentId: "" }) as never),
    ).toBeNull()
  })

  it("maps children to episodes sorted by order", () => {
    const result = normalizeSeries(makeRawSeries())!
    expect(result.episodes.map((e) => e.slug)).toEqual([
      "episode-1",
      "episode-2",
      "episode-3",
    ])
    expect(result.episodes[0].title).toBe("Episode 1")
    expect(result.episodes[0].posterUrl).toBe(
      "https://img.example.com/ep1-cine.jpg",
    )
  })

  // U1: order → seriesEpisodeIndex and durationSeconds carry onto each episode
  // (previously discarded after the sort). Fixture reuses episode 1's shape.
  it("carries order → seriesEpisodeIndex and durationSeconds per episode", () => {
    const result = normalizeSeries(
      makeRawSeries({
        children: [
          {
            order: 5,
            child: {
              documentId: "ep-5",
              slug: "episode-5",
              label: "EPISODE",
              locales: [
                {
                  documentId: "eploc-5",
                  languageSlug: "english",
                  title: "Episode 5",
                },
              ],
              images: [],
              durationSeconds: 300,
            },
          },
        ],
      }),
    )!
    expect(result.episodes[0].seriesEpisodeIndex).toBe(5)
    expect(result.episodes[0].durationSeconds).toBe(300)
  })

  it("round-trips seriesEpisodeIndex: 0 / durationSeconds: 0 without conflating with absent", () => {
    const result = normalizeSeries(
      makeRawSeries({
        children: [
          {
            order: 0,
            child: {
              documentId: "ep-0",
              slug: "episode-0",
              label: "EPISODE",
              locales: [],
              images: [],
              durationSeconds: 0,
            },
          },
        ],
      }),
    )!
    expect(result.episodes[0].seriesEpisodeIndex).toBe(0)
    expect(result.episodes[0].durationSeconds).toBe(0)
  })

  it("leaves durationSeconds undefined when the child omits it", () => {
    // Default fixture children never set durationSeconds.
    const result = normalizeSeries(makeRawSeries())!
    expect(result.episodes[0].durationSeconds).toBeUndefined()
  })

  it("resolves parentSeries to null for the lean series fragment (no parents chain)", () => {
    const result = normalizeSeries(makeRawSeries())!
    expect(result.parentSeries).toBeNull()
  })

  it("deduplicates episodes by documentId", () => {
    const raw = makeRawSeries()
    raw!.children = [...raw!.children!, raw!.children![0]]
    const result = normalizeSeries(raw)!
    expect(result.episodes.filter((e) => e.documentId === "ep-2")).toHaveLength(
      1,
    )
  })

  it("builds the language union, localized and deduped by slug", () => {
    const result = normalizeSeries(makeRawSeries())!
    expect(result.languages.map((l) => l.slug)).toEqual(["english", "spanish"])
    expect(result.languages[1].name).toBe("Spanish")
    expect(result.languages[1].bcp47).toBe("es")
  })

  it("exposes the series' own playable dub as the trailer", () => {
    const result = normalizeSeries(makeRawSeries())!
    expect(result.streamingUrl).toBe("https://stream.mux.com/trailer.m3u8")
    expect(result.muxPlaybackId).toBe("trailer123")
    expect(result.variants).toHaveLength(1)
  })

  // Contract guard (mocked-shape vs real-contract): SeriesWatchVideo omits the
  // player-only duration/muxVideo, so those keys are absent (undefined), not null.
  // Builder must still make a trailer from hls; dropping `?? null` should fail here.
  it("tolerates the lean dub shape (duration/muxVideo absent): trailer from hls, duration & muxPlaybackId null", () => {
    const result = normalizeSeries(
      makeRawSeries({
        variants: [
          {
            documentId: "dub-lean",
            slug: "english",
            published: true,
            hls: "https://stream.mux.com/lean.m3u8",
            language: {
              coreId: "529",
              bcp47: "en",
              slug: "english",
              name: { en: "English" },
            },
          },
        ],
      }),
    )!
    expect(result.streamingUrl).toBe("https://stream.mux.com/lean.m3u8")
    expect(result.duration).toBeNull()
    expect(result.muxPlaybackId).toBeNull()
    expect(result.variants[0].duration).toBeNull()
    expect(result.variants[0].muxPlaybackId).toBeNull()
  })

  it("has no trailer streamingUrl when no dub is playable", () => {
    const result = normalizeSeries(
      makeRawSeries({
        variants: [
          {
            documentId: "d",
            slug: "d",
            published: true,
            hls: null,
            duration: null,
            language: null,
            muxVideo: null,
          },
        ],
      }),
    )!
    expect(result.streamingUrl).toBeNull()
  })

  it("yields empty episodes/languages for a series with none", () => {
    const result = normalizeSeries(
      makeRawSeries({ children: [], childDubLanguages: [] }),
    )!
    expect(result.episodes).toEqual([])
    expect(result.languages).toEqual([])
  })

  it("drops a null child relation from the episode list", () => {
    const result = normalizeSeries(
      makeRawSeries({
        children: [
          { order: 1, child: null },
          {
            order: 2,
            child: {
              documentId: "ep-2",
              slug: "episode-2",
              label: "EPISODE",
              locales: [
                {
                  documentId: "l",
                  languageSlug: "english",
                  title: "Episode 2",
                },
              ],
              images: [],
            },
          },
        ],
      }),
    )!
    expect(result.episodes.map((e) => e.slug)).toEqual(["episode-2"])
  })

  it("drops an empty-string language slug from the union", () => {
    const result = normalizeSeries(
      makeRawSeries({
        childDubLanguages: [
          { slug: "", name: { en: "Blank" }, bcp47: "xx" },
          { slug: "english", name: { en: "English" }, bcp47: "en" },
        ],
      }),
    )!
    expect(result.languages.map((l) => l.slug)).toEqual(["english"])
  })

  it("memoizes on the raw reference (cache-first re-entry returns same record)", () => {
    const raw = makeRawSeries()
    expect(normalizeSeries(raw)).toBe(normalizeSeries(raw))
  })
})
