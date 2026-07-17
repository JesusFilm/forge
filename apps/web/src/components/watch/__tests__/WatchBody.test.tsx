/**
 * @vitest-environment jsdom
 *
 * U7 — WatchBody + WatchStudyQuestions + DownloadButton tests.
 *
 * Covers:
 *  - Two-column layout when both columns have content.
 *  - Right column always renders -- placeholder row + Ask Yours CTA appear
 *    even when studyQuestions is null or empty (the CTA is always relevant).
 *  - Download button hidden when `variant.downloads` empty.
 *  - Mobile DOM order — left column first in source.
 *  - Click integration for both modal triggers.
 *  - WatchStudyQuestions accordion: each prompt row (and the placeholder row)
 *    is expandable; the expanded body always renders the "no-answer"
 *    fallback (private-discussion line + Chat / Ask-a-Bible-question CTAs),
 *    mirroring core/apps/watch's DiscussionQuestions component.
 */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { WatchBody } from "@/components/watch/WatchBody"
import { WatchStudyQuestions } from "@/components/watch/WatchStudyQuestions"
import { DownloadButton } from "@/components/watch/DownloadButton"
import {
  WATCH_PILL_BUTTON_CLASS,
  WATCH_SECTION_EYEBROW_CLASS,
} from "@/components/watch/watch-section-styles"
import type { WatchBodyBlock, WatchStudyQuestionsBlock } from "@/lib/content"

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
  vi.useRealTimers()
  container.remove()
})

function makeBlock(
  opts: {
    label?: string | null
    title?: string
    description?: string | null
    downloadCount?: number
  } = {},
): WatchBodyBlock {
  const downloads = Array.from({ length: opts.downloadCount ?? 0 }, (_, i) => ({
    documentId: `dl-${i + 1}`,
    quality: "high",
    size: 12345,
  }))
  return {
    kind: "WatchBody",
    video: {
      documentId: "video-1",
      slug: "jesus",
      title: opts.title ?? "Jesus",
      snippet: "snippet",
      description:
        opts.description === undefined ? "A description." : opts.description,
      noIndex: false,
      label: opts.label === undefined ? "FILM" : opts.label,
      imageAlt: null,
      images: [],
      primaryLanguage: { coreId: "529", bcp47: "en" },
      parents: [],
      variants: [],
      studyQuestions: [],
      bibleCitations: [],
    } as never,
    variant: {
      documentId: "variant-1",
      slug: "en",
      published: true,
      hls: "https://cdn.test/jesus.m3u8",
      language: {
        coreId: "529",
        bcp47: "en",
        slug: "english",
        name: "English",
      },
      downloads,
      muxVideo: { playbackId: "playback-id-123" },
    } as never,
  }
}

function makeStudyQuestions(values: string[]): WatchStudyQuestionsBlock {
  return {
    kind: "StudyQuestions",
    studyQuestions: values.map((value, index) => ({
      documentId: `sq-${index + 1}`,
      value,
      order: index + 1,
    })) as never,
  }
}

describe("WatchBody — two-column layout", () => {
  it("renders an optimistic title without replacing route-owned description", () => {
    const block = makeBlock({ title: "Current Video" })

    act(() => {
      root.render(
        <WatchBody
          block={block}
          studyQuestions={null}
          onDownloadClick={vi.fn()}
          optimisticTitle="Clicked Video"
        />,
      )
    })

    expect(
      container.querySelector('[data-testid="watch-body-title"]')?.textContent,
    ).toBe("Clicked Video")
    expect(
      container.querySelector('[data-testid="watch-body-description"]')
        ?.textContent,
    ).toBe("A description.")
  })

  it("happy path: video with 3 study questions + 5 downloads renders two columns, bullet list, and Download button", () => {
    const block = makeBlock({ downloadCount: 5 })
    const sq = makeStudyQuestions(["Q1?", "Q2?", "Q3?"])

    act(() => {
      root.render(
        <WatchBody
          block={block}
          studyQuestions={sq}
          onDownloadClick={vi.fn()}
        />,
      )
    })

    const wrapper = container.querySelector('[data-testid="watch-body"]')
    expect(wrapper).not.toBeNull()
    // Two-column grid classes present (12-col grid mirroring Container.tsx).
    expect(wrapper!.className).toContain("md:grid-cols-12")
    const left = container.querySelector('[data-testid="watch-body-left"]')
    expect(left).not.toBeNull()
    // With a right column present, left column does NOT span the full grid.
    expect(left!.className).not.toContain("md:col-span-12")
    expect(left!.className).toContain("md:col-span-7")

    const right = container.querySelector('[data-testid="watch-body-right"]')
    expect(right).not.toBeNull()
    expect(right!.className).toContain("md:col-span-5")

    // Bullet list with 3 items in `order` ASC (matches the input order).
    const items = right!.querySelectorAll(
      '[data-testid="watch-study-questions-item"]',
    )
    expect(items.length).toBe(3)
    expect(Array.from(items).map((el) => el.textContent)).toEqual([
      "Q1?",
      "Q2?",
      "Q3?",
    ])

    // Download button visible.
    const dl = container.querySelector('[data-testid="watch-download-button"]')
    expect(dl).not.toBeNull()

    // Title and Download keep the established row by default, then switch to
    // a leading-aligned stack on landscape phones so long localized titles
    // can use the full column width.
    const titleRow = container.querySelector(
      '[data-testid="watch-body-title-row"]',
    )
    expect(titleRow).not.toBeNull()
    expect(titleRow!.className).toContain("flex")
    expect(titleRow!.className).toContain("flex-nowrap")
    expect(titleRow!.className).toContain("items-center")
    expect(titleRow!.className).toContain("justify-between")
    expect(titleRow!.className).toContain("gap-3")
    expect(titleRow!.className.split(" ")).not.toContain("flex-col")
    expect(titleRow!.className).toContain(
      "[@media(max-width:1023px)_and_(orientation:landscape)]:flex-col",
    )
    expect(titleRow!.className).toContain(
      "[@media(max-width:1023px)_and_(orientation:landscape)]:items-start",
    )
    const titleEl = container.querySelector('[data-testid="watch-body-title"]')
    expect(titleEl!.parentElement).toBe(titleRow)
    expect(titleEl?.className).toContain("flex-1")
    expect(titleEl?.className).toContain(
      "[@media(max-width:1023px)_and_(orientation:landscape)]:w-full",
    )
    expect(titleEl?.className).toContain("text-lg")
    expect(titleEl?.className).toContain("sm:text-[27px]")
    expect(titleEl?.className).toContain("md:text-4xl")
    expect(titleEl?.className).toContain("xl:text-5xl")
    expect(titleEl?.className).toContain("leading-[1.08]")
    expect(titleEl?.className).toContain("font-semibold")
    expect(titleEl?.className).not.toContain("text-3xl")
    expect(titleEl?.className).not.toContain("font-bold")
    expect(dl!.closest('[data-testid="watch-body-title-row"]')).toBe(titleRow)
    const downloadGroup = container.querySelector(
      '[data-testid="watch-download-group"]',
    )
    expect(dl!.parentElement).toBe(downloadGroup)
    expect(downloadGroup?.className).toContain("ml-auto")
    expect(downloadGroup?.className).toContain("items-end")
    expect(downloadGroup?.className).toContain(
      "[@media(max-width:1023px)_and_(orientation:landscape)]:ml-0",
    )
    expect(downloadGroup?.className).toContain(
      "[@media(max-width:1023px)_and_(orientation:landscape)]:items-start",
    )

    // Right-column header top padding is alignment-critical: the right
    // header row should start flush with the title / Download row.
    const studySection = container.querySelector(
      '[data-testid="watch-study-questions"]',
    )
    expect(studySection).not.toBeNull()
    expect(studySection!.className).toContain("pt-0")
    expect(studySection!.className).not.toContain("md:pt-")
    expect(studySection!.className).not.toContain("xl:pt-")
    const headerRow = studySection!.querySelector(
      '[data-testid="watch-study-questions-header"]',
    )
    expect(headerRow).not.toBeNull()
    expect(headerRow?.className).toContain("flex-wrap")
    expect(headerRow?.className).toContain("items-center")
    expect(headerRow?.className).toContain("justify-between")
    expect(headerRow?.className).toContain(
      "[@media(max-width:1023px)_and_(orientation:landscape)]:flex-col",
    )
    expect(headerRow?.className).toContain(
      "[@media(max-width:1023px)_and_(orientation:landscape)]:items-start",
    )
    expect(headerRow?.className).toContain(
      "[@media(max-width:1023px)_and_(orientation:landscape)]:gap-3",
    )
    expect(
      headerRow?.querySelector(
        '[data-testid="watch-study-questions-ask-yours"]',
      ),
    ).not.toBeNull()
    expect(
      container.querySelector("#watch-related-questions-heading")?.className,
    ).toContain(WATCH_SECTION_EYEBROW_CLASS)
    const relatedHeading = container.querySelector(
      "#watch-related-questions-heading",
    )
    expect(relatedHeading?.querySelector(".md\\:hidden")?.textContent).toBe(
      "Questions",
    )
    expect(
      relatedHeading?.querySelector(".hidden.md\\:inline")?.textContent,
    ).toBe("Related Questions")

    // Description starts lower than the title row so its top aligns with
    // the first question, not the Related Questions heading.
    const description = container.querySelector(
      '[data-testid="watch-body-description"]',
    )
    expect(description?.className).toContain("md:mt-6")
    expect(description?.className).toContain("font-normal")
    expect(description?.className).not.toContain("font-medium")
  })

  it("does not render the duplicated body label tag when present", () => {
    const block = makeBlock({ label: "EPISODE", downloadCount: 1 })

    act(() => {
      root.render(
        <WatchBody
          block={block}
          studyQuestions={null}
          onDownloadClick={vi.fn()}
        />,
      )
    })

    const tag = container.querySelector('[data-testid="watch-body-label"]')
    expect(tag).toBeNull()
  })

  it("omits the body label tag when Video.label is null", () => {
    const block = makeBlock({ label: null, downloadCount: 1 })

    act(() => {
      root.render(
        <WatchBody
          block={block}
          studyQuestions={null}
          onDownloadClick={vi.fn()}
        />,
      )
    })

    expect(
      container.querySelector('[data-testid="watch-body-label"]'),
    ).toBeNull()
  })
})

describe("WatchBody — right column always renders (Ask Yours CTA is always relevant)", () => {
  it("renders right column with placeholder row when studyQuestions block is null", () => {
    const block = makeBlock({ downloadCount: 2 })

    act(() => {
      root.render(
        <WatchBody
          block={block}
          studyQuestions={null}
          onDownloadClick={vi.fn()}
        />,
      )
    })

    const left = container.querySelector('[data-testid="watch-body-left"]')
    expect(left!.className).toContain("md:col-span-7")

    const right = container.querySelector('[data-testid="watch-body-right"]')
    expect(right).not.toBeNull()

    // Placeholder row + Ask Yours CTA both present.
    const placeholder = container.querySelector(
      '[data-testid="watch-study-questions-placeholder"]',
    )
    expect(placeholder).not.toBeNull()
    // Pin the user-visible copy so silent edits to the constant get caught.
    expect(placeholder!.textContent).toContain(
      "If you could ask the creator of this video a question, what would it be?",
    )
    expect(
      container.querySelector(
        '[data-testid="watch-study-questions-ask-yours"]',
      ),
    ).not.toBeNull()

    // Download button still visible.
    expect(
      container.querySelector('[data-testid="watch-download-button"]'),
    ).not.toBeNull()
  })

  it("renders right column with placeholder when studyQuestions array is empty", () => {
    const block = makeBlock({ downloadCount: 1 })
    const emptySq: WatchStudyQuestionsBlock = {
      kind: "StudyQuestions",
      studyQuestions: [],
    }

    act(() => {
      root.render(
        <WatchBody
          block={block}
          studyQuestions={emptySq}
          onDownloadClick={vi.fn()}
        />,
      )
    })

    const left = container.querySelector('[data-testid="watch-body-left"]')
    expect(left!.className).toContain("md:col-span-7")
    expect(
      container.querySelector(
        '[data-testid="watch-study-questions-placeholder"]',
      ),
    ).not.toBeNull()
    // Ask Yours CTA must also render in the empty-array path; the null path
    // already pins this and the two cases should stay symmetric.
    expect(
      container.querySelector(
        '[data-testid="watch-study-questions-ask-yours"]',
      ),
    ).not.toBeNull()
  })
})

describe("WatchBody — Download button visibility", () => {
  it("hides Download button when variant.downloads is empty (two-column preserved)", () => {
    const block = makeBlock({ downloadCount: 0 })
    const sq = makeStudyQuestions(["Q1?"])

    act(() => {
      root.render(
        <WatchBody
          block={block}
          studyQuestions={sq}
          onDownloadClick={vi.fn()}
        />,
      )
    })

    expect(
      container.querySelector('[data-testid="watch-download-button"]'),
    ).toBeNull()

    // Two-column layout still preserved.
    expect(
      container.querySelector('[data-testid="watch-body-right"]'),
    ).not.toBeNull()
  })

  it("renders right column placeholder with no Download button when both are empty", () => {
    const block = makeBlock({ downloadCount: 0 })

    act(() => {
      root.render(
        <WatchBody
          block={block}
          studyQuestions={null}
          onDownloadClick={vi.fn()}
        />,
      )
    })

    // Right column with placeholder still renders -- the Ask Yours CTA is
    // always relevant, even when there are no editorial prompts and no
    // downloadable variants.
    expect(
      container.querySelector('[data-testid="watch-body-right"]'),
    ).not.toBeNull()
    expect(
      container.querySelector(
        '[data-testid="watch-study-questions-placeholder"]',
      ),
    ).not.toBeNull()
    expect(
      container.querySelector('[data-testid="watch-download-button"]'),
    ).toBeNull()

    const left = container.querySelector('[data-testid="watch-body-left"]')
    expect(left).not.toBeNull()
    expect(left!.className).toContain("md:col-span-7")
  })
})

describe("WatchBody — responsive class names", () => {
  it("uses the same 12-col grid as the Experience-page Container at md+ breakpoint", () => {
    const block = makeBlock({ downloadCount: 1 })
    const sq = makeStudyQuestions(["Q1?"])

    act(() => {
      root.render(
        <WatchBody
          block={block}
          studyQuestions={sq}
          onDownloadClick={vi.fn()}
        />,
      )
    })

    const wrapper = container.querySelector('[data-testid="watch-body"]')!
    expect(wrapper.className).toContain("grid-cols-1")
    expect(wrapper.className).toContain("md:grid-cols-12")
    const left = container.querySelector('[data-testid="watch-body-left"]')!
    const right = container.querySelector('[data-testid="watch-body-right"]')!
    expect(left.className).toContain("col-span-1")
    expect(right.className).toContain("col-span-1")
    expect(left.className).toContain("md:col-span-7")
    expect(right.className).toContain("md:col-span-5")
  })

  it("renders left column before right column in source order (mobile stack order)", () => {
    const block = makeBlock({ downloadCount: 1 })
    const sq = makeStudyQuestions(["Q1?"])

    act(() => {
      root.render(
        <WatchBody
          block={block}
          studyQuestions={sq}
          onDownloadClick={vi.fn()}
        />,
      )
    })

    const wrapper = container.querySelector('[data-testid="watch-body"]')!
    const children = Array.from(wrapper.children)
    expect(children[0]?.getAttribute("data-testid")).toBe("watch-body-left")
    expect(children[1]?.getAttribute("data-testid")).toBe("watch-body-right")
  })
})

describe("WatchBody — modal trigger integration", () => {
  it("invokes onDownloadClick when the Download button is clicked", () => {
    const onDownloadClick = vi.fn()
    const block = makeBlock({ downloadCount: 1 })

    act(() => {
      root.render(
        <WatchBody
          block={block}
          studyQuestions={null}
          onDownloadClick={onDownloadClick}
        />,
      )
    })

    const dl = container.querySelector(
      '[data-testid="watch-download-button"]',
    ) as HTMLButtonElement | null
    expect(dl).not.toBeNull()

    act(() => {
      dl!.click()
    })

    expect(onDownloadClick).toHaveBeenCalledTimes(1)
  })

  it("Ask Yours CTA links to the external talk page in a new tab", () => {
    const block = makeBlock({ downloadCount: 0 })
    const sq = makeStudyQuestions(["Q1?"])

    act(() => {
      root.render(
        <WatchBody
          block={block}
          studyQuestions={sq}
          onDownloadClick={vi.fn()}
        />,
      )
    })

    const ay = container.querySelector(
      '[data-testid="watch-study-questions-ask-yours"]',
    ) as HTMLAnchorElement | null
    expect(ay).not.toBeNull()
    expect(ay!.tagName.toLowerCase()).toBe("a")
    expect(ay!.getAttribute("href")).toBe(
      "https://issuesiface.com/talk?utm_source=jesusfilm-watch",
    )
    expect(ay!.getAttribute("target")).toBe("_blank")
    expect(ay!.getAttribute("aria-label")).toBe("Ask yours")
    expect(ay!.textContent).toContain("Ask yours")
    for (const token of WATCH_PILL_BUTTON_CLASS.split(" ")) {
      expect(ay!.className).toContain(token)
    }
    expect(ay!.className).toContain("cursor-pointer")
    expect(ay!.className).toContain("[&_*]:pointer-events-none")
    expect(ay!.className).toContain("[&_*]:cursor-pointer")
    expect(ay!.style.cursor).toBe("pointer")
    // noopener prevents window.opener access; noreferrer additionally
    // strips the Referer header on the cross-origin navigation.
    const rel = ay!.getAttribute("rel") ?? ""
    expect(rel).toContain("noopener")
    expect(rel).toContain("noreferrer")
  })
})

describe("WatchStudyQuestions — accordion expand with no-answer fallback", () => {
  it("matches production row, question icon, and chevron styling", () => {
    act(() => {
      root.render(<WatchStudyQuestions prompts={["How do you look?"]} />)
    })

    const trigger = container.querySelector(
      '[data-testid="watch-study-questions-item-trigger"]',
    ) as HTMLButtonElement
    expect(trigger).not.toBeNull()
    expect(trigger.className).toContain("rounded-lg")
    expect(trigger.className).toContain("px-0")
    expect(trigger.className).toContain("grid-cols-[minmax(0,1fr)_auto]")
    expect(trigger.className).toContain("gap-2")
    expect(trigger.className).toContain("py-4")
    expect(trigger.className).not.toContain("hover:bg-white/10")

    const icon = trigger.querySelector("svg[viewBox='0 0 24 24']")
    expect(icon?.getAttribute("class")).toContain("size-6")
    expect(icon?.getAttribute("class")).toContain("md:size-7")
    expect(icon?.getAttribute("class")).toContain("mt-0")
    expect(icon?.getAttribute("class")).toContain("opacity-20")

    const question = trigger.querySelector("h3")
    expect(question?.className).toContain("font-normal")
    expect(question?.className).toContain("md:text-lg")
    expect(question?.className).toContain("group-hover:text-brand-red")
    expect(question?.className).not.toContain("sm:pr-4")

    const chevron = trigger.querySelector("span svg")
    expect(chevron?.getAttribute("class")).toContain("size-6")
    expect(chevron?.getAttribute("class")).toContain("md:size-7")
    expect(chevron?.getAttribute("class")).not.toContain("translate-y-0.5")
  })

  it("each prompt row carries a trigger button with aria-expanded=false by default", () => {
    act(() => {
      root.render(<WatchStudyQuestions prompts={["A?", "B?", "C?"]} />)
    })

    const items = container.querySelectorAll(
      '[data-testid="watch-study-questions-item"]',
    )
    expect(items.length).toBe(3)
    for (const item of items) {
      expect(item.tagName.toLowerCase()).toBe("li")
      const trigger = item.querySelector(
        '[data-testid="watch-study-questions-item-trigger"]',
      ) as HTMLButtonElement | null
      expect(trigger).not.toBeNull()
      expect(trigger!.tagName.toLowerCase()).toBe("button")
      expect(trigger!.getAttribute("aria-expanded")).toBe("false")
      // Panel starts unmounted while collapsed so closed rows stay free of
      // fallback body text until they have been opened once.
      expect(
        item.querySelector('[data-testid="watch-study-questions-item-panel"]'),
      ).toBeNull()
    }
  })

  it("clicking a row opens its panel and reveals the no-answer fallback + two CTAs", () => {
    act(() => {
      root.render(<WatchStudyQuestions prompts={["What is hope?"]} />)
    })

    const trigger = container.querySelector(
      '[data-testid="watch-study-questions-item-trigger"]',
    ) as HTMLButtonElement
    expect(trigger).not.toBeNull()
    act(() => {
      trigger.click()
    })
    expect(trigger.getAttribute("aria-expanded")).toBe("true")

    const panel = container.querySelector(
      '[data-testid="watch-study-questions-item-panel"]',
    )
    expect(panel).not.toBeNull()
    expect(panel!.textContent).toContain(
      "Have a private discussion with someone who is ready to listen.",
    )
    expect(
      panel!.querySelector(
        '[data-testid="watch-study-questions-item-fallback-body"]',
      )?.className,
    ).toContain("font-normal")

    const chat = container.querySelector(
      '[data-testid="watch-study-questions-chat-cta"]',
    ) as HTMLAnchorElement | null
    expect(chat).not.toBeNull()
    expect(chat!.tagName.toLowerCase()).toBe("a")
    expect(chat!.getAttribute("href")).toBe(
      "https://chataboutjesus.com/chat/?utm_source=jesusfilm-watch",
    )
    expect(chat!.getAttribute("target")).toBe("_blank")
    const chatRel = chat!.getAttribute("rel") ?? ""
    expect(chatRel).toContain("noopener")
    expect(chatRel).toContain("noreferrer")
    expect(chat!.textContent).toContain("Chat with a person")
    for (const token of WATCH_PILL_BUTTON_CLASS.split(" ")) {
      expect(chat!.className).toContain(token)
    }

    const ask = container.querySelector(
      '[data-testid="watch-study-questions-ask-bible-cta"]',
    ) as HTMLAnchorElement | null
    expect(ask).not.toBeNull()
    expect(ask!.tagName.toLowerCase()).toBe("a")
    expect(ask!.getAttribute("href")).toBe(
      "https://www.everystudent.com/contact.php?utm_source=jesusfilm-watch",
    )
    expect(ask!.getAttribute("target")).toBe("_blank")
    const askRel = ask!.getAttribute("rel") ?? ""
    expect(askRel).toContain("noopener")
    expect(askRel).toContain("noreferrer")
    expect(ask!.textContent).toContain("Ask a Bible question")
    for (const token of WATCH_PILL_BUTTON_CLASS.split(" ")) {
      expect(ask!.className).toContain(token)
    }
  })

  it("only one row is open at a time — clicking a second row closes the first", () => {
    vi.useFakeTimers()

    act(() => {
      root.render(<WatchStudyQuestions prompts={["First?", "Second?"]} />)
    })

    const triggers = container.querySelectorAll(
      '[data-testid="watch-study-questions-item-trigger"]',
    )
    expect(triggers.length).toBe(2)
    act(() => {
      ;(triggers[0] as HTMLButtonElement).click()
    })
    expect(
      container.querySelectorAll(
        '[data-testid="watch-study-questions-item-panel"]',
      ).length,
    ).toBe(1)
    act(() => {
      ;(triggers[1] as HTMLButtonElement).click()
    })
    const panels = container.querySelectorAll(
      '[data-testid="watch-study-questions-item-panel"]',
    )
    expect(panels.length).toBe(2)
    expect(triggers[0]?.getAttribute("aria-expanded")).toBe("false")
    expect(triggers[1]?.getAttribute("aria-expanded")).toBe("true")
    expect(panels[0]?.getAttribute("aria-hidden")).toBe("true")
    expect(panels[0]?.className).toContain("transition-[height]")
    expect(panels[0]?.className).toContain("pointer-events-none")
    expect((panels[0] as HTMLElement | undefined)?.style.height).toBe("0px")
    expect(panels[1]?.getAttribute("aria-hidden")).toBe("false")
    expect(panels[1]?.className).toContain("transition-[height]")

    act(() => {
      vi.advanceTimersByTime(300)
    })
    const settledPanels = container.querySelectorAll(
      '[data-testid="watch-study-questions-item-panel"]',
    )
    expect(settledPanels.length).toBe(1)
    expect(settledPanels[0]?.getAttribute("aria-hidden")).toBe("false")
  })

  it("resets openIndex when the prompts array reference changes — stale index never reveals a different question's panel", () => {
    // Open the second row, then re-render with a shorter prompts array that
    // no longer has an index 1 — the new render must NOT show any panel.
    const firstPrompts = ["A?", "B?"]
    const secondPrompts = ["Only one?"]

    act(() => {
      root.render(<WatchStudyQuestions prompts={firstPrompts} />)
    })

    const triggers = container.querySelectorAll(
      '[data-testid="watch-study-questions-item-trigger"]',
    )
    expect(triggers.length).toBe(2)
    act(() => {
      ;(triggers[1] as HTMLButtonElement).click()
    })
    expect(
      container.querySelectorAll(
        '[data-testid="watch-study-questions-item-panel"]',
      ).length,
    ).toBe(1)

    // Re-render with a different (shorter) prompts reference.
    act(() => {
      root.render(<WatchStudyQuestions prompts={secondPrompts} />)
    })

    // No panel should be open after prompts changed.
    expect(
      container.querySelectorAll(
        '[data-testid="watch-study-questions-item-panel"]',
      ).length,
    ).toBe(0)
    const newTriggers = container.querySelectorAll(
      '[data-testid="watch-study-questions-item-trigger"]',
    )
    expect(newTriggers.length).toBe(1)
    expect(newTriggers[0]?.getAttribute("aria-expanded")).toBe("false")
  })

  it("clicking an open row's trigger again collapses it (toggle off)", () => {
    vi.useFakeTimers()

    act(() => {
      root.render(<WatchStudyQuestions prompts={["A?"]} />)
    })

    const trigger = container.querySelector(
      '[data-testid="watch-study-questions-item-trigger"]',
    ) as HTMLButtonElement
    act(() => {
      trigger.click()
    })
    expect(trigger.getAttribute("aria-expanded")).toBe("true")
    act(() => {
      trigger.click()
    })
    expect(trigger.getAttribute("aria-expanded")).toBe("false")
    const closingPanel = container.querySelector(
      '[data-testid="watch-study-questions-item-panel"]',
    )
    expect(closingPanel).not.toBeNull()
    expect(closingPanel?.getAttribute("aria-hidden")).toBe("true")
    expect(closingPanel?.className).toContain("transition-[height]")
    expect(closingPanel?.className).toContain("pointer-events-none")
    expect((closingPanel as HTMLElement | null)?.style.height).toBe("0px")

    const closingLinks = closingPanel!.querySelectorAll("a")
    for (const link of closingLinks) {
      expect(link.getAttribute("tabindex")).toBe("-1")
    }

    act(() => {
      vi.advanceTimersByTime(300)
    })
    expect(
      container.querySelector(
        '[data-testid="watch-study-questions-item-panel"]',
      ),
    ).toBeNull()
  })

  it("placeholder row (empty prompts) is also expandable and reveals the same fallback content", () => {
    act(() => {
      root.render(<WatchStudyQuestions prompts={[]} />)
    })

    const placeholder = container.querySelector(
      '[data-testid="watch-study-questions-placeholder"]',
    )
    expect(placeholder).not.toBeNull()
    expect(placeholder!.tagName.toLowerCase()).toBe("li")
    const trigger = placeholder!.querySelector(
      '[data-testid="watch-study-questions-placeholder-trigger"]',
    ) as HTMLButtonElement | null
    expect(trigger).not.toBeNull()
    expect(trigger!.getAttribute("aria-expanded")).toBe("false")

    act(() => {
      trigger!.click()
    })
    expect(trigger!.getAttribute("aria-expanded")).toBe("true")
    const panel = container.querySelector(
      '[data-testid="watch-study-questions-placeholder-panel"]',
    )
    expect(panel).not.toBeNull()
    expect(panel!.textContent).toContain(
      "Have a private discussion with someone who is ready to listen.",
    )
    // Same external-target CTAs are reachable from the placeholder body.
    expect(
      container.querySelector('[data-testid="watch-study-questions-chat-cta"]'),
    ).not.toBeNull()
    expect(
      container.querySelector(
        '[data-testid="watch-study-questions-ask-bible-cta"]',
      ),
    ).not.toBeNull()

    // Real prompt rows must still be absent in the placeholder branch.
    expect(
      container.querySelectorAll('[data-testid="watch-study-questions-item"]')
        .length,
    ).toBe(0)
  })
})

describe("DownloadButton — isolated render", () => {
  it("calls onClick when activated", () => {
    const onClick = vi.fn()

    act(() => {
      root.render(<DownloadButton onClick={onClick} />)
    })

    const btn = container.querySelector(
      '[data-testid="watch-download-button"]',
    ) as HTMLButtonElement
    expect(btn).not.toBeNull()
    expect(btn.tagName.toLowerCase()).toBe("button")
    expect(btn.getAttribute("type")).toBe("button")
    for (const token of WATCH_PILL_BUTTON_CLASS.split(" ")) {
      expect(btn.className).toContain(token)
    }

    act(() => {
      btn.click()
    })

    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it("renders an alternate label for the production LaunchDarkly copy smoke", () => {
    act(() => {
      root.render(<DownloadButton label="Save Video" onClick={vi.fn()} />)
    })

    const btn = container.querySelector(
      '[data-testid="watch-download-button"]',
    ) as HTMLButtonElement
    expect(btn).not.toBeNull()
    expect(btn.textContent).toContain("Save Video")
    expect(btn.getAttribute("aria-label")).toBe("Save Video")
  })

  it("renders a concrete fallback link when an href is supplied", () => {
    const onClick = vi.fn()

    act(() => {
      root.render(
        <DownloadButton
          href="/watch/api/download?downloadId=dl-1&variantId=variant-1&videoSlug=jesus"
          onClick={onClick}
        />,
      )
    })

    const link = container.querySelector(
      '[data-testid="watch-download-button"]',
    ) as HTMLAnchorElement
    expect(link).not.toBeNull()
    expect(link.tagName.toLowerCase()).toBe("a")
    expect(link.getAttribute("href")).toContain("/watch/api/download?")
    expect(link.getAttribute("href")).toContain("downloadId=dl-1")
    expect(link.getAttribute("download")).toBe("")
    expect(link.getAttribute("aria-label")).toBe("Download")
    for (const token of WATCH_PILL_BUTTON_CLASS.split(" ")) {
      expect(link.className).toContain(token)
    }

    const clickEvent = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
    })
    act(() => {
      expect(link.dispatchEvent(clickEvent)).toBe(false)
    })

    expect(clickEvent.defaultPrevented).toBe(true)
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})
