import type { ReactNode } from "react"
import Loadable from "next/dist/shared/lib/loadable.shared-runtime"
import { PassThrough } from "node:stream"
import { renderToPipeableStream } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

const { home, page } = vi.hoisted(() => ({ home: vi.fn(), page: vi.fn() }))

vi.mock("@/lib/watch-home", async () => ({
  ...(await vi.importActual<typeof import("@/lib/watch-home")>(
    "@/lib/watch-home",
  )),
  resolveWatchHome: home,
}))
vi.mock("@/lib/content", async () => ({
  ...(await vi.importActual<typeof import("@/lib/content")>("@/lib/content")),
  resolveWatchPage: page,
}))
vi.mock("@/lib/feature-flags", async () => ({
  ...(await vi.importActual<typeof import("@/lib/feature-flags")>(
    "@/lib/feature-flags",
  )),
  isWatchAudienceEnabled: async () => false,
}))
vi.mock("next/navigation", () => ({
  usePathname: () => "/watch",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ prefetch: vi.fn() }),
  redirect: (destination: string) => {
    throw new Error(`NEXT_REDIRECT:${destination}`)
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND")
  },
}))

import HomePage from "./page"
import SlugRestPage from "./[...rest]/page"
import WatchContentLayout from "./[...rest]/layout"
import { WatchHomeExperiencePage } from "@/components/home/WatchHomeExperiencePage"
import type { Section } from "@/lib/content"

const emptyHero = {
  heroSlides: [],
  sections: [],
  carousel: { pools: [] },
  missingData: [],
}
const heroBlock = { __typename: "WatchHomeHeroBlock" }
const rail = {
  __typename: "MediaCollectionBlock",
  sectionKey: "independent-rail",
  title: "Independent authored films",
  itemsSource: "manual",
  items: [
    {
      videoId: "independent-film",
      videoSlug: "independent-film",
      resolvedTitle: "Independent film",
      titleOverride: null,
      subtitleOverride: null,
      labelOverride: null,
      collectionSize: null,
    },
  ],
}

async function html(element: ReactNode): Promise<string> {
  await Loadable.preloadAll()
  return new Promise((resolve, reject) => {
    const output = new PassThrough()
    let result = ""
    output.on("data", (chunk) => (result += chunk.toString()))
    output.on("end", () => resolve(result))
    const stream = renderToPipeableStream(element, {
      onAllReady: () => stream.pipe(output),
      onError: reject,
    })
  })
}

const routes = [
  [
    "root",
    () =>
      HomePage({ params: Promise.resolve({ locale: "en", htmlLang: "en" }) }),
  ],
  [
    "localized",
    async () =>
      WatchContentLayout({
        children: await SlugRestPage({
          params: Promise.resolve({
            locale: "es",
            htmlLang: "es-ES",
            rest: ["spanish-castilian.html"],
          }),
        }),
        params: Promise.resolve({
          locale: "es",
          rest: ["spanish-castilian.html"],
        }),
      }),
  ],
] as const

describe.each(routes)(
  "%s home failure rendering with real components",
  (_name, route) => {
    it("retains the independently loaded rail, footer, chrome and a single main", async () => {
      home.mockResolvedValue({
        data: null,
        error: new Error("Fixture hero failure"),
      })
      page.mockResolvedValue({
        data: { kind: "experience", experience: { blocks: [heroBlock, rail] } },
        error: null,
      })
      const result = await html(await route())
      expect(result).toContain("Independent authored films")
      expect(result).toContain("Independent film")
      expect(result).toContain('data-testid="watch-home-footer"')
      expect(result).toContain('data-testid="floating-search')
      expect(result.match(/<main[ >]/g)).toHaveLength(1)
      expect(result).not.toContain('data-testid="watch-home-tv-carousel"')
      expect(result).not.toContain("Fixture hero failure")
    })

    it("retains a legacy compatibility category rail even with only the hero placeholder", async () => {
      home.mockResolvedValue({
        data: null,
        error: new Error("Fixture hero failure"),
      })
      page.mockResolvedValue({
        data: {
          kind: "experience",
          experience: { blocks: [heroBlock] },
          watchHomeCategoryRailCompatibility: "legacy-schema",
        },
        error: null,
      })
      const result = await html(await route())
      expect(result).toContain('data-testid="watch-home-category-rail"')
      expect(result).toContain('data-testid="watch-home-footer"')
      expect(result).not.toContain("text-red-600")
    })

    it("preserves successful hero-only response semantics", async () => {
      home.mockResolvedValue({ data: emptyHero, error: null })
      page.mockResolvedValue({
        data: { kind: "experience", experience: { blocks: [heroBlock] } },
        error: null,
      })
      const result = await html(await route())
      expect(result).toContain('data-testid="watch-home-footer"')
      expect(result).not.toContain("text-red-600")
    })

    it.each([
      ["hero only", [heroBlock]],
      ["no blocks", []],
      ["empty static rail", [heroBlock, { ...rail, items: [] }]],
      [
        "route-children rail without route context",
        [{ ...rail, itemsSource: "routeVideoChildren" }],
      ],
      [
        "empty nested section",
        [
          {
            __typename: "SectionBlock",
            sectionContent: [{ ...rail, items: [] }],
          },
        ],
      ],
      [
        "orphaned container content",
        [{ __typename: "ContainerBlock", content: [rail] }],
      ],
    ])(
      "keeps the error when there is no independent body: %s",
      async (_label, blocks) => {
        home.mockResolvedValue({
          data: null,
          error: new Error("Fixture hero failure"),
        })
        page.mockResolvedValue({
          data: { kind: "experience", experience: { blocks } },
          error: null,
        })
        const result = await html(await route())
        expect(result).toContain("text-red-600")
        expect(result).not.toContain('data-testid="watch-home-footer"')
        expect(result.match(/<main[ >]/g)).toHaveLength(1)
      },
    )
  },
)

it("demonstrates why a hero placeholder and an empty rail are not independent content", async () => {
  const result = await html(
    <WatchHomeExperiencePage
      heroModel={emptyHero}
      blocks={[heroBlock, { ...rail, items: [] }] as unknown as Section[]}
      languageSlug="english"
    />,
  )
  expect(result).not.toContain("Independent authored films")
  expect(result).not.toContain('data-testid="watch-home-tv-carousel"')
  expect(result).toContain('data-testid="watch-home-footer"')
})
