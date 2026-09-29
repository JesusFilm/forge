import {
  normalizeVideo,
  normalizeDubMedia,
  normalizeSeries,
  type VideoTextInput,
} from "../normalizeVideo"
import {
  ENGLISH_ADMIN_FORMS,
  adminFormsFor,
  type AdminLanguageForms,
} from "../../i18n/adminLanguage"

// The fixtures below carry their text rows on the raw object, in the text
// companion's shape (KTD10), so each case passes the raw object as the
// companion too. The U6 cases pass a separate companion.
function norm(
  raw: Parameters<typeof normalizeVideo>[0],
  forms: AdminLanguageForms = ENGLISH_ADMIN_FORMS,
) {
  return normalizeVideo(raw, forms, raw as unknown as VideoTextInput)
}

function normSeries(
  raw: Parameters<typeof normalizeSeries>[0],
  forms: AdminLanguageForms = ENGLISH_ADMIN_FORMS,
) {
  return normalizeSeries(raw, forms, raw as unknown as VideoTextInput)
}

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
        videoStill: null,
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
                    videoStill: null,
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
                    videoStill: null,
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
          iso3: "eng",
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
          iso3: "spa",
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
        bibleBook: {
          documentId: "bb-1",
          name: { en: "John" },
          osisId: "John",
          paratextAbbreviation: "JHN",
        },
      },
    ],
    ...overrides,
    // The fixture carries the text rows too, in the companion's shape (see
    // `norm`), so it is wider than the language-free document's type.
  } as unknown as Parameters<typeof normalizeVideo>[0]
}

describe("normalizeVideo", () => {
  it("returns null for null input", () => {
    expect(norm(null)).toBeNull()
    expect(norm(undefined)).toBeNull()
  })

  it("produces a complete record from a fully populated response", () => {
    const result = norm(makeRawVideo())!

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
    const result = norm(
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
      titleLang: "en",
    })
  })

  // Regression: the default fixture's parent is a COLLECTION ("The Easter Story").
  // Its members are individually watchable — they must render standalone, never
  // folded under the collection as if it were a series.
  it("resolves parentSeries to null for a COLLECTION parent", () => {
    const result = norm(makeRawVideo())!
    expect(result.parentSeries).toBeNull()
  })

  it("resolves parentSeries to null when the video has no parents", () => {
    const result = norm(makeRawVideo({ parents: [] }))!
    expect(result.parentSeries).toBeNull()
  })

  // Pins the intentional parents[0]-only contract (shared with the siblings
  // derivation): a SERIES parent behind a COLLECTION at index 0 is not searched.
  it("resolves parentSeries to null when a SERIES parent sits behind a COLLECTION at index 0", () => {
    const result = norm(
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
    const result = norm({ ...raw, variants } as typeof raw)!

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
    const result = norm({ ...raw, variants } as typeof raw)!

    // dub-1's hls is unplayable; the pick must advance to dub-2 (Spanish).
    expect(result.streamingUrl).toBe("https://stream.mux.com/def456.m3u8")
  })

  // Prod regression (Up Next blank card): the "Life of Jesus (Gospel of John)"
  // sibling's images[0] is videoStill-first, and its bare Cloudflare `url` is
  // the variant-less delivery base that 400s. Never pick it over real art.
  it("skips a sibling's variant-less url for its cinematic art", () => {
    const raw = makeRawVideo()
    const parent = raw!.parents![0]!.parent!
    parent.children = parent.children!.map((rel) =>
      rel.child?.documentId === "vid-2"
        ? {
            child: {
              ...rel.child,
              images: [
                {
                  documentId: "cimg-2a",
                  url: "https://img.example.com/bare.jpg",
                  thumbnail: "https://img.example.com/thumb.jpg/f=jpg,w=120",
                  mobileCinematicHigh: null,
                  mobileCinematicLow: null,
                  videoStill: "https://img.example.com/still.jpg/f=jpg,w=1920",
                },
                {
                  documentId: "cimg-2b",
                  url: "https://img.example.com/bare-cinematic.jpg",
                  thumbnail: null,
                  mobileCinematicHigh:
                    "https://img.example.com/cinematic.jpg/f=jpg,w=1280",
                  mobileCinematicLow: null,
                  videoStill: null,
                },
              ],
            },
          }
        : rel,
    )

    const result = norm(raw)!
    const sibling = result.siblings.find((s) => s.documentId === "vid-2")!
    expect(sibling.posterUrl).toBe(
      "https://img.example.com/cinematic.jpg/f=jpg,w=1280",
    )
  })

  it("filters self-references from siblings", () => {
    const result = norm(makeRawVideo())!

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
          images: [],
        },
      },
    ]

    const result = norm(raw)!
    const resurrectionCount = result.siblings.filter(
      (s) => s.documentId === "vid-2",
    ).length
    expect(resurrectionCount).toBe(1)
  })

  it("returns empty siblings for orphan videos (no parents)", () => {
    const result = norm(makeRawVideo({ parents: [] }))!
    expect(result.siblings).toEqual([])
  })

  it("filters unpublished variants", () => {
    const result = norm(makeRawVideo())!
    expect(result.variants).toHaveLength(2)
    expect(result.variants.every((v) => v.published)).toBe(true)
  })

  it("projects each dub language's ISO 639-3 code as admin sends it (U6)", () => {
    const result = norm(makeRawVideo())!
    expect(result.variants.map((v) => v.languageIso3)).toEqual(["eng", "spa"])
  })

  it("reads a blank or absent dub language code as null", () => {
    const raw = makeRawVideo()
    const variants = (
      raw as unknown as {
        variants: { language: Record<string, unknown> | null }[]
      }
    ).variants.map((v, index) =>
      index === 0
        ? { ...v, language: { ...v.language, iso3: "  " } }
        : { ...v, language: { ...v.language, iso3: null } },
    )
    const result = norm({ ...raw, variants } as typeof raw)!
    expect(result.variants).toHaveLength(2)
    expect(result.variants.map((v) => v.languageIso3)).toEqual([null, null])
  })

  it("does not project per-dub downloads/subtitles onto bulk variants", () => {
    // The bulk WatchVideo query is lean by design — downloads/subtitles are
    // fetched lazily per dub (normalizeDubMedia), never inlined here.
    const result = norm(makeRawVideo())!
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

    // Admin's Language.slug is nullable and real rows hit it (a French track on
    // considering-christmas, 2026-08-13). A slug-less track cannot be selected:
    // it keys as "" everywhere, and "" is falsy, so the watch route's
    // `!activeSubtitleSlug` guard reads a genuine pick as "nothing selected" and
    // silently renders no captions while the control still names the language.
    it("drops a subtitle whose language has no slug", () => {
      const media = normalizeDubMedia(
        makeRawDub({
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
                documentId: "sub-fr",
                language: { slug: null, name: { en: "French" }, bcp47: "fr" },
                vttSrc: "https://subs.example.com/fr.vtt",
                primary: false,
                aiGenerated: false,
              },
            ],
          },
        }),
      )
      expect(media.subtitles.map((s) => s.languageSlug)).toEqual(["english"])
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
    const result = norm(makeRawVideo())!
    expect(result.studyQuestions).toHaveLength(2)
    expect(result.studyQuestions[0].value).toBe("First question?")
    expect(result.studyQuestions[1].value).toBe("Second question?")
  })

  // KTD10: rows are chosen by the language slug (the identity), never by a
  // sort over whatever rows came back. `hu` is shared by Hungarian and Csángó.
  it("reads the hungarian row for hu even when a csango row comes first", () => {
    const result = norm(
      makeRawVideo({
        locales: [
          {
            documentId: "loc-csango",
            languageSlug: "csango",
            title: "Csángó cím",
            description: null,
            snippet: null,
          },
          {
            documentId: "loc-hu",
            languageSlug: "hungarian",
            title: "Magyar cím",
            description: null,
            snippet: null,
          },
        ],
      }),
      adminFormsFor("hu"),
    )!

    expect(result.title).toBe("Magyar cím")
    expect(result.titleLang).toBe("hu")
  })

  it("sorts study questions by order, then slug, then id by code unit", () => {
    const result = norm(
      makeRawVideo({
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

    expect(result.studyQuestions.map((question) => question.value)).toEqual([
      "A question?",
      "Z question?",
      "Legacy question?",
    ])
  })

  it("normalizes bible citations with book name from locale map", () => {
    const result = norm(makeRawVideo())!
    expect(result.bibleCitations).toHaveLength(1)
    expect(result.bibleCitations[0].bookName).toBe("John")
    expect(result.bibleCitations[0].osisId).toBe("John.19.30")
    expect(result.bibleCitations[0].chapterStart).toBe(19)
    expect(result.bibleCitations[0].verseStart).toBe(30)
  })

  // feat-553 U12. The reader keys a book by its USFM code. These are admin's
  // real `BibleBook` spellings: Core sync writes `osisId: "John"` with
  // `paratextAbbreviation: "JHN"`, and admin's own OSIS table spells the
  // numbered books `1Cor` and the Psalms `Ps` (`youversion-reference.ts`).
  describe("citation book code", () => {
    function bookCodeFor(bibleBook: Record<string, unknown> | null) {
      const result = norm(
        makeRawVideo({
          bibleCitations: [
            {
              documentId: "bc-1",
              chapterStart: 3,
              chapterEnd: null,
              verseStart: 16,
              verseEnd: 17,
              order: 1,
              osisId: "John.3.16",
              bibleBook,
            },
          ],
        }),
      )!
      return result.bibleCitations[0]?.bookUsfm
    }

    it.each([
      ["John", "JHN", "JHN"],
      ["1Cor", "1CO", "1CO"],
      ["Ps", "PSA", "PSA"],
      ["Song", "SNG", "SNG"],
      ["Gen", "GEN", "GEN"],
      ["Rev", "REV", "REV"],
    ])("maps admin's osisId %s to %s", (osisId, paratext, usfm) => {
      // The real row carries both fields.
      expect(
        bookCodeFor({
          documentId: "bb-1",
          name: { en: "Book" },
          osisId,
          paratextAbbreviation: paratext,
        }),
      ).toBe(usfm)
      // With no Paratext code, only the osisId mapping can give the answer.
      expect(
        bookCodeFor({
          documentId: "bb-1",
          name: { en: "Book" },
          osisId,
          paratextAbbreviation: null,
        }),
      ).toBe(usfm)
    })

    it("prefers the osisId over a Paratext code that disagrees", () => {
      expect(
        bookCodeFor({
          documentId: "bb-1",
          name: { en: "1 Corinthians" },
          osisId: "1Cor",
          paratextAbbreviation: "JHN",
        }),
      ).toBe("1CO")
    })

    it("falls back to the Paratext code when the osisId is absent", () => {
      expect(
        bookCodeFor({
          documentId: "bb-1",
          name: { en: "John" },
          osisId: null,
          paratextAbbreviation: "JHN",
        }),
      ).toBe("JHN")
    })

    // A deuterocanonical book is a real Core shape and BSB has no text for it.
    it("gives no code for a book outside BSB's 66", () => {
      expect(
        bookCodeFor({
          documentId: "bb-1",
          name: { en: "Tobit" },
          osisId: "Tob",
          paratextAbbreviation: "TOB",
        }),
      ).toBeNull()
    })

    // The USFM spelling in the OSIS field is not an OSIS id.
    it("does not read a USFM code out of the osisId field", () => {
      expect(
        bookCodeFor({
          documentId: "bb-1",
          name: { en: "John" },
          osisId: "JHN",
          paratextAbbreviation: null,
        }),
      ).toBeNull()
    })

    it("gives no code for a citation with no book", () => {
      expect(bookCodeFor(null)).toBeNull()
    })

    // The lean series fragment selects no book codes. It must still normalize.
    it("gives no code for the series fragment's book shape", () => {
      const result = normSeries(
        makeRawSeries({
          bibleCitations: [
            {
              documentId: "bc-1",
              chapterStart: 3,
              chapterEnd: null,
              verseStart: 16,
              verseEnd: null,
              order: 1,
              osisId: "John.3.16",
              bibleBook: { documentId: "bb-1", name: { en: "John" } },
            },
          ],
        }),
      )!
      expect(result.bibleCitations).toHaveLength(1)
      expect(result.bibleCitations[0]?.bookUsfm).toBeNull()
    })
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

    const result = norm(makeRawVideo({ bibleCitations: frozenCitations }))!

    expect(result.bibleCitations).toHaveLength(2)
    // Ascending by order: bc-1 (order 1) before bc-2 (order 2).
    expect(result.bibleCitations[0].documentId).toBe("bc-1")
    expect(result.bibleCitations[1].documentId).toBe("bc-2")
  })

  it("handles missing fields gracefully", () => {
    const result = norm(
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
    const result = norm(raw)!
    expect(result.siblings).toHaveLength(1)
    expect(result.siblings[0].slug).toBe("from-first-parent")
  })
})

describe("normalizeVideo — partial data (returnPartialData)", () => {
  const partial = (o: Record<string, unknown>) =>
    o as unknown as Parameters<typeof normalizeVideo>[0]

  it("returns null for null / undefined input", () => {
    expect(norm(null)).toBeNull()
    expect(norm(undefined)).toBeNull()
  })

  it("returns null when the partial object has no documentId (no identity yet)", () => {
    expect(norm(partial({ slug: "lonely" }))).toBeNull()
    expect(norm(makeRawVideo({ documentId: "" }) as never)).toBeNull()
  })

  it("produces a valid record with empty arrays when relations are absent", () => {
    const result = norm(
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
          videoStill: null,
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
        videoStill: null,
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
    expect(normSeries(null)).toBeNull()
    expect(normSeries(undefined)).toBeNull()
    expect(normSeries(makeRawSeries({ documentId: "" }) as never)).toBeNull()
  })

  it("maps children to episodes sorted by order", () => {
    const result = normSeries(makeRawSeries())!
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
    const result = normSeries(
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
    const result = normSeries(
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
    const result = normSeries(makeRawSeries())!
    expect(result.episodes[0].durationSeconds).toBeUndefined()
  })

  it("resolves parentSeries to null for the lean series fragment (no parents chain)", () => {
    const result = normSeries(makeRawSeries())!
    expect(result.parentSeries).toBeNull()
  })

  it("deduplicates episodes by documentId", () => {
    const raw = makeRawSeries()
    raw!.children = [...raw!.children!, raw!.children![0]]
    const result = normSeries(raw)!
    expect(result.episodes.filter((e) => e.documentId === "ep-2")).toHaveLength(
      1,
    )
  })

  it("builds the language union, localized and deduped by slug", () => {
    const result = normSeries(makeRawSeries())!
    expect(result.languages.map((l) => l.slug)).toEqual(["english", "spanish"])
    expect(result.languages[1].name).toBe("Spanish")
    expect(result.languages[1].bcp47).toBe("es")
  })

  it("exposes the series' own playable dub as the trailer", () => {
    const result = normSeries(makeRawSeries())!
    expect(result.streamingUrl).toBe("https://stream.mux.com/trailer.m3u8")
    expect(result.muxPlaybackId).toBe("trailer123")
    expect(result.variants).toHaveLength(1)
  })

  // Contract guard (mocked-shape vs real-contract): SeriesWatchVideo omits the
  // player-only duration/muxVideo, so those keys are absent (undefined), not null.
  // Builder must still make a trailer from hls; dropping `?? null` should fail here.
  it("tolerates the lean dub shape (duration/muxVideo absent): trailer from hls, duration & muxPlaybackId null", () => {
    const result = normSeries(
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
    // The lean series fragment selects no `iso3` on the dub language.
    expect(result.variants[0].languageIso3).toBeNull()
  })

  it("has no trailer streamingUrl when no dub is playable", () => {
    const result = normSeries(
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
    const result = normSeries(
      makeRawSeries({ children: [], childDubLanguages: [] }),
    )!
    expect(result.episodes).toEqual([])
    expect(result.languages).toEqual([])
  })

  it("drops a null child relation from the episode list", () => {
    const result = normSeries(
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
    const result = normSeries(
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
    expect(normSeries(raw)).toBe(normSeries(raw))
  })
})

// ── U6. Text in the UI locale (KTD10, KTD16) ───────────────────────────────

const RU = adminFormsFor("ru")
const ZH_HANS = adminFormsFor("zh-Hans")

function textRow(
  documentId: string,
  languageSlug: string,
  fields: { title?: string | null; description?: string | null },
) {
  return {
    documentId,
    languageSlug,
    title: fields.title ?? null,
    description: fields.description ?? null,
    snippet: null,
    imageAlt: null,
  }
}

/** A GET_VIDEO_TEXT companion for the default fixture (vid-1). */
function companion(overrides: Record<string, unknown> = {}): VideoTextInput {
  return {
    documentId: "vid-1",
    locales: [
      textRow("loc-ru", "russian", { title: "Распятие", description: null }),
    ],
    englishLocales: [
      textRow("loc-en", "english", {
        title: "The Crucifixion",
        description: "A depiction of the crucifixion.",
      }),
    ],
    parents: [
      {
        parent: {
          documentId: "parent-1",
          locales: [],
          englishLocales: [
            textRow("ploc-en", "english", { title: "The Easter Story" }),
          ],
          children: [
            {
              child: {
                documentId: "vid-2",
                locales: [
                  textRow("c2-ru", "russian", { title: "Воскресение" }),
                ],
                englishLocales: [
                  textRow("c2-en", "english", { title: "The Resurrection" }),
                ],
              },
            },
            {
              child: {
                documentId: "vid-3",
                locales: [],
                englishLocales: [
                  textRow("c3-en", "english", { title: "The Ascension" }),
                ],
              },
            },
          ],
        },
      },
    ],
    ...overrides,
  }
}

/** The language-free document: the fixture without any text rows. */
function heavyOnly(): Parameters<typeof normalizeVideo>[0] {
  const strip = (video: Record<string, unknown>) => {
    const kept = { ...video }
    delete kept.locales
    return kept
  }
  const raw = strip(makeRawVideo() as unknown as Record<string, unknown>)
  const parent = (raw.parents as { parent: Record<string, unknown> }[])[0]
    .parent
  return {
    ...raw,
    parents: [
      {
        parent: {
          ...strip(parent),
          children: (
            parent.children as { child: Record<string, unknown> }[]
          ).map((rel) => ({ child: strip(rel.child) })),
        },
      },
    ],
  } as unknown as Parameters<typeof normalizeVideo>[0]
}

describe("normalizeVideo — text from the companion, per field (U6)", () => {
  it("has no text until the companion lands", () => {
    const result = normalizeVideo(heavyOnly(), RU)!
    expect(result.title).toBeNull()
    expect(result.description).toBeNull()
    expect(result.siblings.map((s) => s.title)).toEqual([null, null])
  })

  it("shows the Russian title and the English description when Russian has no description", () => {
    const result = normalizeVideo(heavyOnly(), RU, companion())!
    expect(result.title).toBe("Распятие")
    expect(result.titleLang).toBe("ru")
    expect(result.description).toBe("A depiction of the crucifixion.")
    expect(result.descriptionLang).toBe("en")
  })

  it("titles each sibling in Russian, else in English with lang en", () => {
    const result = normalizeVideo(heavyOnly(), RU, companion())!
    expect(
      result.siblings.map((s) => ({ title: s.title, lang: s.titleLang })),
    ).toEqual([
      { title: "Воскресение", lang: "ru" },
      { title: "The Ascension", lang: "en" },
    ])
  })

  it("ignores a companion for another video", () => {
    const result = normalizeVideo(
      heavyOnly(),
      RU,
      companion({ documentId: "vid-other" }),
    )!
    expect(result.title).toBeNull()
  })

  it("keeps one record per raw object, forms, and companion", () => {
    const raw = heavyOnly()
    const text = companion()
    expect(normalizeVideo(raw, RU, text)).toBe(normalizeVideo(raw, RU, text))
    expect(normalizeVideo(raw, RU)).toBe(normalizeVideo(raw, RU))
  })
})

describe("normalizeVideo — Admin names in the screen's forms (U6)", () => {
  // Apollo returns the SAME `name` object after a language change, so a memo
  // keyed on the raw object alone would keep the old language's names.
  it("returns new language names after an epoch change for the same raw object", () => {
    const raw = heavyOnly()
    const spanish = (forms: AdminLanguageForms) =>
      normalizeVideo(raw, forms)!.variants.find(
        (v) => v.languageSlug === "spanish",
      )!

    expect(spanish(ENGLISH_ADMIN_FORMS).languageName).toBe("Spanish")
    const inSpanish = spanish(adminFormsFor("es"))
    expect(inSpanish.languageName).toBe("Español")
    expect(inSpanish.languageNameLang).toBe("es")
    // The English UI again: still English, from the same raw object.
    expect(spanish(ENGLISH_ADMIN_FORMS).languageName).toBe("Spanish")
  })

  it("reads Admin's raw tag, not the catalog tag, and marks an English fallback", () => {
    const raw = makeRawVideo({
      variants: [
        {
          documentId: "dub-1",
          slug: "x-english",
          published: true,
          hls: "https://stream.mux.com/abc123.m3u8",
          duration: 1,
          language: {
            coreId: "529",
            bcp47: "en",
            slug: "english",
            name: { en: "English", "zh-hans": "英语", "zh-Hans": "wrong" },
            iso3: "eng",
          },
          muxVideo: null,
        },
        {
          documentId: "dub-2",
          slug: "x-hausa",
          published: true,
          hls: "https://stream.mux.com/def456.m3u8",
          duration: 1,
          language: {
            coreId: "1",
            bcp47: "ha",
            slug: "hausa",
            name: { en: "Hausa" },
            iso3: "hau",
          },
          muxVideo: null,
        },
      ],
    })
    const [english, hausa] = normalizeVideo(raw, ZH_HANS)!.variants
    expect(english.languageName).toBe("英语")
    expect(english.languageNameLang).toBe("zh-Hans")
    expect(hausa.languageName).toBe("Hausa")
    expect(hausa.languageNameLang).toBe("en")
  })

  it("names a Bible book by the raw tag", () => {
    const raw = makeRawVideo({
      bibleCitations: [
        {
          documentId: "bc-1",
          chapterStart: 19,
          chapterEnd: 19,
          verseStart: 30,
          verseEnd: 30,
          order: 1,
          osisId: "John.19.30",
          bibleBook: {
            documentId: "bb-1",
            name: { en: "John", ru: "Иоанна" },
            osisId: "John",
            paratextAbbreviation: "JHN",
          },
        },
      ],
    })
    const [citation] = normalizeVideo(raw, RU)!.bibleCitations
    expect(citation.bookName).toBe("Иоанна")
    expect(citation.bookNameLang).toBe("ru")
  })

  it("names subtitle languages in the forms passed to normalizeDubMedia", () => {
    const media = normalizeDubMedia(makeRawDub(), adminFormsFor("es"))
    expect(media.subtitles.map((s) => s.languageName)).toEqual([
      "English",
      "Español",
    ])
  })

  it("records the forms it read with, for the screen's other readers", () => {
    expect(normalizeVideo(heavyOnly(), RU)!.adminForms).toBe(RU)
  })
})

describe("normalizeSeries — episode titles from GET_SERIES_TEXT (U6)", () => {
  it("titles episodes from the companion and names languages by the raw tag", () => {
    const raw = makeRawSeries({
      childDubLanguages: [
        {
          slug: "english",
          name: { en: "English", ru: "Английский" },
          bcp47: "en",
        },
      ],
    })
    const shape = raw as unknown as {
      documentId: string
      children: { child: { documentId: string } }[]
    }
    const text: VideoTextInput = {
      documentId: shape.documentId,
      locales: [textRow("s-ru", "russian", { title: "Сериал" })],
      englishLocales: [],
      children: shape.children.map((rel, index) => ({
        child: {
          documentId: rel.child.documentId,
          locales:
            index === 0
              ? [textRow(`e${index}-ru`, "russian", { title: "Эпизод" })]
              : [],
          englishLocales: [
            textRow(`e${index}-en`, "english", { title: `Episode ${index}` }),
          ],
        },
      })),
    }

    const result = normalizeSeries(raw, RU, text)!
    const titles = new Map(
      result.episodes.map((e) => [e.documentId, [e.title, e.titleLang]]),
    )
    expect(result.title).toBe("Сериал")
    expect(titles.get(shape.children[0].child.documentId)).toEqual([
      "Эпизод",
      "ru",
    ])
    expect(titles.get(shape.children[1].child.documentId)).toEqual([
      "Episode 1",
      "en",
    ])
    expect(result.languages[0].name).toBe("Английский")
  })
})
