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
 *  - UX regression: WatchStudyQuestions has NO chevron / accordion semantics
 *    on either prompt rows or the placeholder row.
 */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { WatchBody } from "@/components/watch/WatchBody"
import { WatchStudyQuestions } from "@/components/watch/WatchStudyQuestions"
import { DownloadButton } from "@/components/watch/DownloadButton"
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
    url: `https://cdn.test/clip-${i + 1}.mp4`,
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
  it("happy path: video with 3 study questions + 5 downloads renders two columns, bullet list, and Download button", () => {
    const block = makeBlock({ downloadCount: 5 })
    const sq = makeStudyQuestions(["Q1?", "Q2?", "Q3?"])

    act(() => {
      root.render(
        <WatchBody
          block={block}
          studyQuestions={sq}
          onDownloadClick={vi.fn()}
          onAskYoursClick={vi.fn()}
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
    expect(left!.className).toContain("md:col-span-8")

    const right = container.querySelector('[data-testid="watch-body-right"]')
    expect(right).not.toBeNull()

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

    // Title and Download share the same flex row (alignment contract for the
    // top-of-watch-page UI -- Download must sit on the same Y axis as the
    // h1 title; a future move out of this row would break that intent).
    const titleRow = container.querySelector(
      '[data-testid="watch-body-title-row"]',
    )
    expect(titleRow).not.toBeNull()
    expect(titleRow!.className).toContain("flex")
    expect(titleRow!.className).toContain("items-center")
    expect(titleRow!.className).toContain("justify-between")
    const titleEl = container.querySelector('[data-testid="watch-body-title"]')
    expect(titleEl!.parentElement).toBe(titleRow)
    expect(dl!.closest('[data-testid="watch-body-title-row"]')).toBe(titleRow)

    // Right-column header pt and mb are alignment-critical -- pinning them
    // so a revert / merge resolution cannot silently clobber the values.
    // pt-0 mobile (columns stack, no extra gap) -> md:pt-9 (text-4xl h1)
    // -> xl:pt-11 (text-5xl h1) tracks the h1 size scale across breakpoints.
    const studySection = container.querySelector(
      '[data-testid="watch-study-questions"]',
    )
    expect(studySection).not.toBeNull()
    expect(studySection!.className).toContain("pt-0")
    expect(studySection!.className).toContain("md:pt-9")
    expect(studySection!.className).toContain("xl:pt-11")
    const headerRow = studySection!.querySelector(
      "div.mb-4.flex.flex-wrap.items-center.justify-between",
    )
    expect(headerRow).not.toBeNull()
  })

  it("renders the optional uppercase label tag when present", () => {
    const block = makeBlock({ label: "EPISODE", downloadCount: 1 })

    act(() => {
      root.render(
        <WatchBody
          block={block}
          studyQuestions={null}
          onDownloadClick={vi.fn()}
          onAskYoursClick={vi.fn()}
        />,
      )
    })

    const tag = container.querySelector('[data-testid="watch-body-label"]')
    expect(tag?.textContent).toBe("EPISODE")
    expect(tag?.className).toContain("uppercase")
  })

  it("omits the label tag when Video.label is null", () => {
    const block = makeBlock({ label: null, downloadCount: 1 })

    act(() => {
      root.render(
        <WatchBody
          block={block}
          studyQuestions={null}
          onDownloadClick={vi.fn()}
          onAskYoursClick={vi.fn()}
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
          onAskYoursClick={vi.fn()}
        />,
      )
    })

    const left = container.querySelector('[data-testid="watch-body-left"]')
    expect(left!.className).toContain("md:col-span-8")

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
          onAskYoursClick={vi.fn()}
        />,
      )
    })

    const left = container.querySelector('[data-testid="watch-body-left"]')
    expect(left!.className).toContain("md:col-span-8")
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
          onAskYoursClick={vi.fn()}
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
          onAskYoursClick={vi.fn()}
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
    expect(left!.className).toContain("md:col-span-8")
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
          onAskYoursClick={vi.fn()}
        />,
      )
    })

    const wrapper = container.querySelector('[data-testid="watch-body"]')!
    expect(wrapper.className).toContain("grid-cols-12")
    expect(wrapper.className).toContain("md:grid-cols-12")
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
          onAskYoursClick={vi.fn()}
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
          onAskYoursClick={vi.fn()}
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

  it("invokes onAskYoursClick when the Ask Yours CTA is clicked", () => {
    const onAskYoursClick = vi.fn()
    const block = makeBlock({ downloadCount: 0 })
    const sq = makeStudyQuestions(["Q1?"])

    act(() => {
      root.render(
        <WatchBody
          block={block}
          studyQuestions={sq}
          onDownloadClick={vi.fn()}
          onAskYoursClick={onAskYoursClick}
        />,
      )
    })

    const ay = container.querySelector(
      '[data-testid="watch-study-questions-ask-yours"]',
    ) as HTMLButtonElement | null
    expect(ay).not.toBeNull()

    act(() => {
      ay!.click()
    })

    expect(onAskYoursClick).toHaveBeenCalledTimes(1)
  })
})

describe("WatchStudyQuestions — UX regression: no false-affordance chevrons", () => {
  it("renders prompts as a static <ul> bullet list (no <details>/<summary>)", () => {
    act(() => {
      root.render(
        <WatchStudyQuestions
          prompts={["A?", "B?"]}
          onAskYoursClick={vi.fn()}
        />,
      )
    })

    const ul = container.querySelector(
      '[data-testid="watch-study-questions-list"]',
    )
    expect(ul).not.toBeNull()
    expect(ul!.tagName.toLowerCase()).toBe("ul")

    // No accordion semantics anywhere in the rendered tree.
    expect(container.querySelectorAll("details").length).toBe(0)
    expect(container.querySelectorAll("summary").length).toBe(0)
  })

  it("does not put aria-haspopup or expand affordances on prompt items", () => {
    act(() => {
      root.render(
        <WatchStudyQuestions
          prompts={["A?", "B?", "C?"]}
          onAskYoursClick={vi.fn()}
        />,
      )
    })

    const items = container.querySelectorAll(
      '[data-testid="watch-study-questions-item"]',
    )
    expect(items.length).toBe(3)
    for (const item of items) {
      expect(item.tagName.toLowerCase()).toBe("li")
      // Prompt rows must NOT signal interactivity.
      expect(item.hasAttribute("aria-haspopup")).toBe(false)
      expect(item.hasAttribute("aria-expanded")).toBe(false)
      expect(item.hasAttribute("role")).toBe(false)
      // No nested button or link inside the prompt rows. Decorative SVG (the
      // shared `QuestionIcon` mirrored from RelatedQuestions) is allowed —
      // what's banned is anything that *implies* interactivity, e.g. a
      // chevron with `rotate` transitions.
      expect(item.querySelector("button")).toBeNull()
      expect(item.querySelector("a")).toBeNull()
      // Any SVG present must be explicitly decorative (`aria-hidden="true"`)
      // and must not carry rotate/transition classes that would suggest an
      // expandable affordance.
      const svgs = item.querySelectorAll("svg")
      for (const svg of svgs) {
        expect(svg.getAttribute("aria-hidden")).toBe("true")
        const cls = svg.getAttribute("class") ?? ""
        expect(cls).not.toMatch(/\brotate-/)
        expect(cls).not.toMatch(/\btransition\b/)
      }
    }
  })

  it("renders the Ask Yours CTA as the only interactive element in the section", () => {
    act(() => {
      root.render(
        <WatchStudyQuestions
          prompts={["A?", "B?"]}
          onAskYoursClick={vi.fn()}
        />,
      )
    })

    const section = container.querySelector(
      '[data-testid="watch-study-questions"]',
    )
    expect(section).not.toBeNull()
    const buttons = section!.querySelectorAll("button")
    expect(buttons.length).toBe(1)
    expect(buttons[0]?.getAttribute("data-testid")).toBe(
      "watch-study-questions-ask-yours",
    )
  })

  it("placeholder row (empty prompts) is non-interactive: no nested button/anchor, decorative SVG only, and Ask Yours stays the only button", () => {
    act(() => {
      root.render(
        <WatchStudyQuestions prompts={[]} onAskYoursClick={vi.fn()} />,
      )
    })

    // Accordion semantics still banned across the placeholder branch.
    expect(container.querySelectorAll("details").length).toBe(0)
    expect(container.querySelectorAll("summary").length).toBe(0)

    const placeholder = container.querySelector(
      '[data-testid="watch-study-questions-placeholder"]',
    )
    expect(placeholder).not.toBeNull()
    expect(placeholder!.tagName.toLowerCase()).toBe("li")
    expect(placeholder!.hasAttribute("aria-haspopup")).toBe(false)
    expect(placeholder!.hasAttribute("aria-expanded")).toBe(false)
    expect(placeholder!.hasAttribute("role")).toBe(false)
    expect(placeholder!.querySelector("button")).toBeNull()
    expect(placeholder!.querySelector("a")).toBeNull()
    // Any SVG inside the placeholder row must be decorative and free of
    // rotate/transition classes that would suggest an expandable affordance.
    const svgs = placeholder!.querySelectorAll("svg")
    expect(svgs.length).toBeGreaterThan(0)
    for (const svg of svgs) {
      expect(svg.getAttribute("aria-hidden")).toBe("true")
      const cls = svg.getAttribute("class") ?? ""
      expect(cls).not.toMatch(/\brotate-/)
      expect(cls).not.toMatch(/\btransition\b/)
    }

    // Real prompt rows must be absent in the placeholder branch.
    expect(
      container.querySelectorAll('[data-testid="watch-study-questions-item"]')
        .length,
    ).toBe(0)

    // Singleton-button contract holds across the empty-prompts path too.
    const section = container.querySelector(
      '[data-testid="watch-study-questions"]',
    )
    expect(section).not.toBeNull()
    const buttons = section!.querySelectorAll("button")
    expect(buttons.length).toBe(1)
    expect(buttons[0]?.getAttribute("data-testid")).toBe(
      "watch-study-questions-ask-yours",
    )
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

    act(() => {
      btn.click()
    })

    expect(onClick).toHaveBeenCalledTimes(1)
  })
})
