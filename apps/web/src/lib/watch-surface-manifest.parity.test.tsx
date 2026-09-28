// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import { MediaCollection } from "@/components/sections/MediaCollection"
import { SiblingCarousel } from "@/components/watch/SiblingCarousel"
import { WatchHomeCategoryRailExperience } from "@/components/sections/WatchHomeCategoryRailExperience"
import { BibleQuotesCarousel } from "@/components/sections/BibleQuotesCarousel"
import { Text } from "@/components/sections/Text"
import { PromoBanner } from "@/components/sections/PromoBanner"
import { CTASection } from "@/components/sections/CTASection"
import { VideoHero } from "@/components/sections/VideoHero"
import { RelatedQuestions } from "@/components/sections/RelatedQuestions"
import type {
  RouteVideo,
  WatchChild,
  WatchSiblingCarouselBlock,
} from "./content"
import {
  authoredWatchSurfaceSource,
  watchChaptersSource,
} from "./watch-surface-manifest.sources"

// Model Next Link's configured production /watch basePath; raw anchors stay unchanged.
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    prefetch,
    ...props
  }: import("react").ComponentProps<"a"> & { prefetch?: boolean }) => (
    <a
      {...props}
      data-prefetch={prefetch}
      href={
        href?.startsWith("/") && !href.startsWith("/watch/")
          ? `/watch${href}`
          : href
      }
    >
      {children}
    </a>
  ),
}))

const config = {
  surface: "watch-home",
  block: "authored",
  presentation: "authored-block",
  placement: "authored-parity",
} as const
function child(slug: string | null): WatchChild {
  return {
    documentId: slug ?? "missing",
    slug,
    title: slug,
    label: "episode",
    images: [],
    durationSeconds: null,
    muxPlaybackId: null,
    muxThumbnailBlurDataUrl: null,
  }
}
function renderedHrefs(markup: string): string[] {
  const document = new DOMParser().parseFromString(markup, "text/html")
  return [...document.querySelectorAll("a[href]")].map(
    (anchor) => anchor.getAttribute("href") ?? "",
  )
}

function measuredPaths(
  markup: string,
  publicDocumentPathname = "/watch/spanish.html",
) {
  return renderedHrefs(markup).flatMap((href) => {
    const url = new URL(
      href,
      `https://www.jesusfilm.org${publicDocumentPathname}`,
    )
    return url.origin === "https://www.jesusfilm.org" &&
      /^\/watch\/[a-zA-Z0-9_-]+\.html(?:\/[a-zA-Z0-9_-]+\.html){0,2}$/.test(
        url.pathname,
      )
      ? [url.pathname]
      : []
  })
}

describe("source manifests mirror actual renderer output", () => {
  it("decodes rendered attributes once and preserves literal entity text", () => {
    const href = "/watch/jesus.html?literal=&quot;&amp;&#x3c;"
    const markup = renderToStaticMarkup(<a href={href}>Card</a>)
    expect(renderedHrefs(markup)).toEqual([href])
    expect(measuredPaths(markup)).toEqual(["/watch/jesus.html"])
  })
  it("matches promotional CommonMark links, reference definitions, autolinks and inert raw HTML", () => {
    const data = {
      textVariant: "promotional",
      contentParagraphs: [
        "[Reference][film] and [Inline](/watch/birth.html).",
        '[film]: /watch/jesus.html "Film"',
        "<https://www.jesusfilm.org/watch/autolink.html>",
        '<a href="/watch/raw-html.html">Raw HTML</a>',
        "\\[Escaped](/watch/escaped.html)",
        "```\n[Code](/watch/code.html)\n```",
        "[External](https://other.example/watch/other.html)",
      ],
    } as unknown as Parameters<typeof Text>[0]["data"]
    const paths = measuredPaths(renderToStaticMarkup(<Text data={data} />))
    expect(paths).toEqual([
      "/watch/jesus.html",
      "/watch/birth.html",
      "/watch/autolink.html",
    ])
    expect(
      authoredWatchSurfaceSource(
        config,
        { __typename: "TextBlock", ...data },
        "english",
      )?.items.map((item) => item.itemPath),
    ).toEqual(paths)
  })
  it("matches RelatedQuestions CTA first and answer links even inside closed disclosures", () => {
    const data = {
      ctaLink: "/watch/jesus.html",
      questions: [
        null,
        { question: "First", answer: "[Birth](/watch/birth.html)" },
        {
          question: "Second",
          answer:
            '<https://www.jesusfilm.org/watch/autolink.html> and <a href="/watch/raw.html">raw</a>',
        },
      ],
    } as unknown as Parameters<typeof RelatedQuestions>[0]["data"]
    const paths = measuredPaths(
      renderToStaticMarkup(<RelatedQuestions data={data} />),
    )
    expect(paths).toEqual([
      "/watch/jesus.html",
      "/watch/birth.html",
      "/watch/autolink.html",
    ])
    expect(
      authoredWatchSurfaceSource(
        config,
        { __typename: "RelatedQuestionsBlock", ...data },
        "english",
      )?.items.map((item) => item.itemPath),
    ).toEqual(paths)
    const empty = { ...data, questions: [] }
    expect(renderToStaticMarkup(<RelatedQuestions data={empty} />)).toBe("")
    expect(
      authoredWatchSurfaceSource(
        config,
        { __typename: "RelatedQuestionsBlock", ...empty },
        "english",
      )?.items,
    ).toEqual([])
  })
  it("matches route-derived collection context and its suppression when that context is absent", () => {
    const data = {
      __typename: "MediaCollectionBlock",
      itemsSource: "routeVideoChildren",
      mediaDefaultCollectionSlug: "ignored",
      items: [{ videoSlug: "also-ignored" }],
    } as unknown as Parameters<typeof MediaCollection>[0]["data"]
    const routeVideo: RouteVideo = {
      documentId: "route",
      slug: "jesus",
      title: "Jesus",
      snippet: null,
      description: null,
      noIndex: false,
      imageUrl: null,
      imageAlt: null,
      streamingUrl: null,
      relatedItems: [
        {
          id: "birth",
          title: "Birth",
          subtitle: "",
          label: "episode",
          collectionSize: "",
          imageUrl: null,
          blurDataUrl: null,
          dominantColor: null,
          videoSlug: "birth",
          languageSlug: "spanish-castilian",
          muxPlaybackId: null,
        },
      ],
    }
    const paths = measuredPaths(
      renderToStaticMarkup(
        <MediaCollection
          data={data}
          routeVideo={routeVideo}
          languageSlug="english"
        />,
      ),
    )
    expect(paths).toEqual([
      "/watch/jesus.html",
      "/watch/birth.html/spanish-castilian.html",
    ])
    expect(
      authoredWatchSurfaceSource(config, data, "english", {
        routeVideo,
      })?.items.map((item) => item.itemPath),
    ).toEqual(paths)
    expect(
      renderToStaticMarkup(
        <MediaCollection data={data} languageSlug="english" />,
      ),
    ).toBe("")
    expect(authoredWatchSurfaceSource(config, data, "english")?.items).toEqual(
      [],
    )
  })
  it("matches a visible chapter parent anchor and its two child anchors", () => {
    const block: WatchSiblingCarouselBlock = {
      kind: "SiblingCarousel",
      currentVideoDocumentId: "birth",
      canonicalParent: {
        documentId: "parent",
        slug: "jesus",
        title: "Jesus",
        children: [child("birth"), child("baptism")],
      },
    }
    const paths = measuredPaths(
      renderToStaticMarkup(
        <SiblingCarousel block={block} languageSlug="english" />,
      ),
    )
    expect(paths).toHaveLength(3)
    expect(
      watchChaptersSource(block, 1, "english")?.items.map(
        (item) => item.itemPath,
      ),
    ).toEqual(paths)
  })
  it("does not issue alternative chapters when the initial parent suppresses the selector", () => {
    const parent = {
      documentId: "parent",
      slug: "jesus",
      title: "Jesus",
      children: [child("birth")],
    }
    const alternative = {
      ...parent,
      documentId: "other",
      slug: "other",
      children: [child("birth"), child("baptism")],
    }
    const block: WatchSiblingCarouselBlock = {
      kind: "SiblingCarousel",
      currentVideoDocumentId: "birth",
      canonicalParent: parent,
      selectableParents: [parent, alternative],
    }
    expect(
      renderToStaticMarkup(
        <SiblingCarousel block={block} languageSlug="english" />,
      ),
    ).toBe("")
    expect(watchChaptersSource(block, 1, "english")?.items).toEqual([])
  })
  it("matches an empty MediaCollection despite an explicit measured CTA", () => {
    const data = {
      __typename: "MediaCollectionBlock",
      mediaCtaLink: "/watch/jesus.html",
      mediaDefaultCollectionSlug: "jesus",
      items: [],
    } as unknown as Parameters<typeof MediaCollection>[0]["data"]
    const markup = renderToStaticMarkup(
      <MediaCollection data={data} languageSlug="english" />,
    )
    expect(markup).toBe("")
    expect(authoredWatchSurfaceSource(config, data, "english")?.items).toEqual(
      [],
    )
  })
  it.each([
    { children: [] },
    { children: [child("birth")] },
    { children: [child("birth"), child(null)] },
  ])("matches suppressed chapter output for %j", ({ children }) => {
    const block: WatchSiblingCarouselBlock = {
      kind: "SiblingCarousel",
      currentVideoDocumentId: "birth",
      canonicalParent: {
        documentId: "parent",
        slug: "jesus",
        title: "Jesus",
        children,
      },
    }
    expect(
      renderToStaticMarkup(
        <SiblingCarousel block={block} languageSlug="english" />,
      ),
    ).toBe("")
    expect(watchChaptersSource(block, 1, "english")?.items).toEqual([])
  })
  it("matches measured category anchors after unsafe and external tiles are filtered", () => {
    const data = {
      tiles: [
        { id: "a", title: "Jesus", href: "/watch/jesus.html" },
        { id: "b", title: "Unsafe", href: "javascript:alert(1)" },
        {
          id: "c",
          title: "External",
          href: "https://other.example/watch/jesus.html",
        },
      ],
    }
    const paths = measuredPaths(
      renderToStaticMarkup(
        <WatchHomeCategoryRailExperience data={data} languageSlug="english" />,
      ),
    )
    expect(paths).toEqual(["/watch/jesus.html"])
    expect(
      authoredWatchSurfaceSource(
        config,
        { __typename: "WatchHomeCategoryRailBlock", ...data },
        "english",
      )?.items.map((item) => item.itemPath),
    ).toEqual(paths)
  })
  it("matches measured Bible quote anchors and excludes unlabeled links", () => {
    const data = {
      quotes: [
        {
          id: "one",
          reference: "Ref",
          text: "Verse",
          ctaLabel: null,
          ctaLink: "/watch/ignored.html",
        },
        {
          id: "two",
          reference: "Ref",
          text: "Verse",
          ctaLabel: "Read",
          ctaLink: "/watch/jesus.html",
        },
      ],
    } as unknown as Parameters<typeof BibleQuotesCarousel>[0]["data"]
    const paths = measuredPaths(
      renderToStaticMarkup(<BibleQuotesCarousel data={data} />),
    )
    expect(paths).toEqual(["/watch/jesus.html"])
    expect(
      authoredWatchSurfaceSource(
        config,
        { __typename: "BibleQuotesCarouselBlock", ...data },
        "english",
      )?.items.map((item) => item.itemPath),
    ).toEqual(paths)
  })
})

describe("navigation-relative raw anchors retain document authority", () => {
  const cases = [
    {
      kind: "PromoBannerBlock",
      field: "promoCtaLink",
      render: (href: string) => (
        <PromoBanner
          data={
            { promoCtaLink: href } as Parameters<typeof PromoBanner>[0]["data"]
          }
        />
      ),
    },
    {
      kind: "CtaBlock",
      field: "buttonLink",
      render: (href: string) => (
        <CTASection
          data={
            { buttonLink: href } as Parameters<typeof CTASection>[0]["data"]
          }
        />
      ),
    },
    {
      kind: "VideoHeroBlock",
      field: "ctaLink",
      render: (href: string) => (
        <VideoHero
          data={
            { ctaLabel: "Watch", ctaLink: href } as Parameters<
              typeof VideoHero
            >[0]["data"]
          }
        />
      ),
    },
    {
      kind: "BibleQuotesCarouselBlock",
      field: "quotes",
      render: (href: string) => (
        <BibleQuotesCarousel
          data={
            {
              quotes: [{ id: "resource", ctaLabel: "Watch", ctaLink: href }],
            } as Parameters<typeof BibleQuotesCarousel>[0]["data"]
          }
        />
      ),
    },
    {
      kind: "RelatedQuestionsBlock",
      field: "ctaLink",
      render: (href: string) => (
        <RelatedQuestions
          data={
            {
              ctaLink: href,
              questions: [{ question: "Question", answer: "Answer" }],
            } as Parameters<typeof RelatedQuestions>[0]["data"]
          }
        />
      ),
    },
    {
      kind: "MediaCollectionBlock",
      field: "mediaCtaLink",
      render: (href: string) => (
        <MediaCollection
          languageSlug="english"
          data={
            {
              mediaCtaLink: href,
              items: [{ videoSlug: "later", title: "Later" }],
            } as Parameters<typeof MediaCollection>[0]["data"]
          }
        />
      ),
    },
  ]
  const blockFor = (kind: string, field: string, href: string) => ({
    __typename: kind,
    [field]:
      field === "quotes"
        ? [{ id: "resource", ctaLabel: "Watch", ctaLink: href }]
        : href,
    ctaLabel: "Watch",
    questions: [{ question: "Question", answer: "Answer" }],
    items: [{ videoSlug: "later", title: "Later" }],
  })
  for (const { kind, field, render } of cases) {
    it.each([
      "watch/birth.html",
      "birth.html",
      "#section",
      "?lang=english",
      "https:watch/birth.html",
      "https:birth.html",
      "https:#section",
      "https:?q=1",
    ])(
      `${kind} leaves %s and subsequent positions unknown without an exact base`,
      (href) => {
        const block = blockFor(kind, field, href)
        expect(authoredWatchSurfaceSource(config, block, "english")).toBeNull()
        const section = {
          __typename: "SectionBlock",
          sectionContent: [
            block,
            {
              __typename: "MediaCollectionBlock",
              items: [{ videoSlug: "later", title: "Later" }],
            },
          ],
        }
        expect(
          authoredWatchSurfaceSource(config, section, "english"),
        ).toBeNull()
        for (const pathname of [
          "/watch/discipleship.html",
          "/watch/discipleship.html/english.html",
        ]) {
          const measured = measuredPaths(
            renderToStaticMarkup(render(href)),
            pathname,
          )
          if (href === "watch/birth.html" || href === "https:watch/birth.html")
            expect(measured).toEqual(
              kind === "MediaCollectionBlock" ? ["/watch/later.html"] : [],
            )
          if (href === "birth.html" || href === "https:birth.html")
            expect(measured[0]).toBe(
              pathname.endsWith("/english.html")
                ? "/watch/discipleship.html/birth.html"
                : "/watch/birth.html",
            )
          if (
            href.startsWith("#") ||
            href.startsWith("?") ||
            href === "https:#section" ||
            href === "https:?q=1"
          )
            expect(measured[0]).toBe(pathname)
        }
      },
    )
    it.each(["/watch", "/watch/spanish.html"])(
      `${kind} matches exact home base %s`,
      (publicDocumentPathname) => {
        for (const href of [
          "watch/birth.html",
          "birth.html",
          "#section",
          "?lang=english",
          "https:watch/birth.html",
          "https:birth.html",
          "https:#section",
          "https:?q=1",
        ]) {
          const block = blockFor(kind, field, href)
          const measured = measuredPaths(
            renderToStaticMarkup(render(href)),
            publicDocumentPathname,
          )
          expect(
            authoredWatchSurfaceSource(config, block, "english", {
              publicDocumentPathname,
            })?.items,
          ).toEqual(
            measured.map((itemPath, position) => ({ position, itemPath })),
          )
        }
      },
    )
  }
  it.each(["/watch", "/watch/spanish.html"])(
    "uses the same exact home base %s for compiled Markdown",
    (publicDocumentPathname) => {
      const data = {
        textVariant: "promotional",
        contentParagraphs: [
          "[Birth](birth.html) [Watch](watch/birth.html) [Self](#section) [Query](?x=1) [SchemeBirth](https:birth.html) [SchemeWatch](https:watch/birth.html) [SchemeSelf](https:#section) [SchemeQuery](https:?q=1)",
        ],
      } as unknown as Parameters<typeof Text>[0]["data"]
      const measured = measuredPaths(
        renderToStaticMarkup(<Text data={data} />),
        publicDocumentPathname,
      )
      expect(
        authoredWatchSurfaceSource(
          config,
          { __typename: "TextBlock", ...data },
          "english",
          { publicDocumentPathname },
        )?.items,
      ).toEqual(measured.map((itemPath, position) => ({ position, itemPath })))
    },
  )
})

it.each([
  "https:watch/birth.html",
  "https:birth.html",
  "https:#section",
  "https:?q=1",
])(
  "compiled Markdown with %s remains unknown at ambiguous video bases",
  (href) => {
    const data = {
      textVariant: "promotional",
      contentParagraphs: [`[Relative](${href}) [Later](/watch/later.html)`],
    } as unknown as Parameters<typeof Text>[0]["data"]
    const block = { __typename: "TextBlock", ...data }
    expect(authoredWatchSurfaceSource(config, block, "english")).toBeNull()
    for (const publicDocumentPathname of [
      "/watch/discipleship.html",
      "/watch/discipleship.html/english.html",
    ]) {
      const measured = measuredPaths(
        renderToStaticMarkup(<Text data={data} />),
        publicDocumentPathname,
      )
      expect(measured.at(-1)).toBe("/watch/later.html")
      expect(
        authoredWatchSurfaceSource(config, block, "english", {
          publicDocumentPathname,
        })?.items,
      ).toEqual(measured.map((itemPath, position) => ({ position, itemPath })))
    }
  },
)
