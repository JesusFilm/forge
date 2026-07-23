/**
 * @vitest-environment jsdom
 */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/components/DatadogRum", () => ({
  reportDatadogRumAction: vi.fn(),
}))

import { ExperienceSectionRenderer, type Section } from "@/components/sections"
import { resolveWatchHomeSectionCtaHref } from "@/lib/watch-home-cta"

type InventoryItem = {
  sectionKey: string
  title: string
  label: string
  href: string
  inferredCollectionSlug?: string
}

const MEDIA_CTA_INVENTORY: readonly InventoryItem[] = [
  {
    sectionKey: "seven-days-with-jesus",
    title: "Seven Days With Jesus",
    label: "Begin Day One",
    href: "/watch/7-days-with-jesus-walk-with-jesus.html/english.html",
  },
  {
    sectionKey: "watch-the-gospels",
    title: "Experience the Story of Jesus from the Bible",
    label: "Watch",
    href: "/watch/lumo.html/english.html",
  },
  {
    sectionKey: "questions-about-happiness",
    title: "What Really Makes Us Happy?",
    label: "See all",
    href: "/watch/shine-happy.html/english.html",
  },
  {
    sectionKey: "films-about-jesus",
    title: "Meet Jesus Through Stories from Around the World",
    label: "See all",
    href: "/",
    inferredCollectionSlug: "jfm-collection",
  },
  {
    sectionKey: "el-camino",
    title: "El Camino: Stories Along the Way",
    label: "See all",
    href: "/watch/the-way-of-st-james.html/english.html",
  },
  {
    sectionKey: "acts",
    title: "The Acts of the Apostles",
    label: "Watch",
    href: "/watch/lumo-acts-of-the-apostles.html/english.html",
  },
  {
    sectionKey: "bible-on-film",
    title: "Watch Scripture Come to Life",
    label: "Watch",
    href: "/watch/languages",
  },
  {
    sectionKey: "new-believer-course",
    title: "New to Christianity? Start Here.",
    label: "Begin the Course",
    href: "/watch/new-believer-course.html/english.html",
  },
  {
    sectionKey: "nua",
    title: "Questions Are Welcome Here",
    label: "Watch",
    href: "/watch/nua-fresh-perspective.html/english.html",
  },
  {
    sectionKey: "every-gospel",
    title: "Scripture, Spoken Exactly as Written",
    label: "Watch",
    href: "/watch/languages",
  },
  {
    sectionKey: "creation-to-christ",
    title: "Creation to Christ",
    label: "Watch the Full Story",
    href: "/watch/creation-to-christ.html/1-the-most-high-god-and-his-creation/english.html",
  },
] as const

function makeMediaData(item: InventoryItem, index: number) {
  return {
    __typename: "MediaCollectionBlock",
    id: `media-${index}`,
    sectionKey: item.sectionKey,
    title: item.title,
    subtitle: null,
    mediaDescription: null,
    backgroundColor: null,
    categoryLabel: null,
    itemsSource: "manual",
    mediaCtaLink: item.href,
    mediaCtaLabel: item.label,
    mediaDefaultCollectionSlug: item.inferredCollectionSlug ?? null,
    showItemNumbers: false,
    mediaCollectionVariant: "grid",
    footerText: null,
    items: [
      {
        videoId: `video-${index}`,
        videoSlug: `video-${index}`,
        titleOverride: `Video ${index}`,
        subtitleOverride: null,
        labelOverride: null,
        collectionSize: null,
        imageAsset: null,
      },
    ],
  } as unknown as Section
}

function makeQuestionsData() {
  return {
    __typename: "RelatedQuestionsBlock",
    id: "faq",
    sectionKey: "frequently-asked-questions",
    heading: "Frequently asked questions",
    ctaLabel: "Read more",
    ctaLink: "https://www.jesusfilm.org/about/faq/",
    questions: [
      {
        id: "faq-1",
        question: "Where can I watch the JESUS film online for free?",
        answer: "Watch it free in the film library.",
      },
    ],
  } as unknown as Section
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
})

describe("Watch homepage content CTA inventory", () => {
  it("keeps all twelve current section actions descriptive and off the homepage", async () => {
    await act(async () => {
      root.render(
        <>
          <main data-testid="watch-home-content">
            {MEDIA_CTA_INVENTORY.map((item, index) => (
              <ExperienceSectionRenderer
                key={item.sectionKey}
                section={makeMediaData(item, index)}
                surface="watch-home"
                languageSlug="english"
              />
            ))}
            <ExperienceSectionRenderer
              section={makeQuestionsData()}
              surface="watch-home"
            />
          </main>
        </>,
      )
    })

    await act(async () => {
      await vi.waitFor(
        () => {
          expect(
            container.querySelectorAll("[data-watch-home-section-cta]"),
          ).toHaveLength(12)
        },
        { timeout: 5000 },
      )
    })

    const ctas = Array.from(
      container.querySelectorAll<HTMLAnchorElement>(
        "[data-watch-home-section-cta]",
      ),
    )
    const inventory = ctas.map((cta) => ({
      href: cta.getAttribute("href"),
      name: cta.getAttribute("aria-label"),
    }))
    expect(inventory).toEqual([
      ...MEDIA_CTA_INVENTORY.map((item) => ({
        href:
          item.sectionKey === "films-about-jesus"
            ? "/watch/jfm-collection.html/english.html"
            : item.href,
        name: `${item.label}: ${item.title}`,
      })),
      {
        href: "https://www.jesusfilm.org/about/faq/",
        name: "Read more: Frequently asked questions",
      },
    ])

    for (const cta of ctas) {
      const href = cta.getAttribute("href")
      expect(resolveWatchHomeSectionCtaHref(href)).toBe(href)
    }
  })
})
