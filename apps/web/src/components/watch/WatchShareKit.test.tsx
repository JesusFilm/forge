// @vitest-environment jsdom
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/env", () => ({
  env: { NEXT_PUBLIC_CANONICAL_ORIGIN: "https://share.example" },
}))

import type { WatchLanguagePickerVariant } from "@/lib/content"
import { WatchShareKit } from "./WatchShareKit"
import type { WatchShareFilm } from "@/lib/watch-share-kit"

let container: HTMLDivElement
let root: Root

function variant(slug: string, name: string): WatchLanguagePickerVariant {
  return {
    documentId: slug,
    hls: "https://stream.example/a.m3u8",
    published: true,
    language: { slug, name },
  }
}

const film: WatchShareFilm = {
  slug: "seed-demo-video",
  title: "Seed Demo Video",
  languageSlug: "english",
  languageName: "English",
  runtimeMinutes: 4,
  studyQuestions: [],
  languageVariants: [
    variant("english", "English"),
    variant("spanish-latin-american", "Spanish, Latin American"),
  ],
  languageOptionsStatus: "ready",
}

function render(
  overrides: Partial<WatchShareFilm> = {},
  props: { onClose?: () => void; onRequestLanguageOptions?: () => void } = {},
) {
  act(() =>
    root.render(
      createElement(WatchShareKit, {
        film: { ...film, ...overrides },
        onClose: props.onClose ?? vi.fn(),
        onRequestLanguageOptions: props.onRequestLanguageOptions,
      }),
    ),
  )
}

it.each(["بداية الخدمة", "English fallback", "Title without metadata"])(
  "isolates the inline selected title %s without changing English controls",
  (title) => {
    render({ title })
    const heading = byTestId("watch-share-kit")!.querySelector("h3")!
    expect(heading.textContent).toBe(title)
    expect(heading.getAttribute("lang")).toBe("")
    expect(heading.getAttribute("dir")).toBe("auto")
    expect(byTestId("watch-share-kit-close")!.getAttribute("aria-label")).toBe(
      "Close film kit",
    )
  },
)

function byTestId<T extends HTMLElement>(
  id: string,
  scope: ParentNode = document,
) {
  return scope.querySelector<T>(`[data-testid="${id}"]`)
}

function linkInput() {
  return byTestId<HTMLInputElement>("watch-share-kit-link")!
}

function setClipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  })
}

function setNativeShare(
  share: ((data: ShareData) => Promise<void>) | undefined,
) {
  Object.defineProperty(navigator, "share", {
    configurable: true,
    value: share,
  })
}

async function click(element: Element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }))
  })
}

beforeEach(() => {
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
  setNativeShare(undefined)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  document.body.innerHTML = ""
  vi.restoreAllMocks()
})

describe("WatchShareKit recipient language", () => {
  it("changes the link audio without touching the sender's page", async () => {
    window.history.replaceState(null, "", "/watch/seed-demo-video.html")
    render()
    expect(linkInput().value).toBe(
      "https://share.example/watch/seed-demo-video.html?playback_source=share",
    )

    const select = byTestId<HTMLSelectElement>("watch-share-kit-language")!
    expect([...select.options].map((option) => option.value)).toEqual([
      "english",
      "spanish-latin-american",
    ])
    await act(async () => {
      select.value = "spanish-latin-american"
      select.dispatchEvent(new Event("change", { bubbles: true }))
    })

    expect(linkInput().value).toBe(
      "https://share.example/watch/seed-demo-video.html/spanish-latin-american.html?playback_source=share",
    )
    expect(window.location.pathname).toBe("/watch/seed-demo-video.html")
  })

  it("offers only the sender's language and says so while the catalog list is unavailable", async () => {
    const onRequestLanguageOptions = vi.fn()
    render(
      { languageVariants: [], languageOptionsStatus: "error" },
      { onRequestLanguageOptions },
    )

    const select = byTestId<HTMLSelectElement>("watch-share-kit-language")!
    expect([...select.options].map((option) => option.value)).toEqual([
      "english",
    ])
    expect(container.textContent).toContain("Other audio languages")
    await click(byTestId("watch-share-kit-language-retry")!)
    expect(onRequestLanguageOptions).toHaveBeenCalledTimes(1)
  })
})

describe("WatchShareKit prompts", () => {
  it("labels original suggestions when the film has no authored study questions", () => {
    render()
    const prompts = byTestId("watch-share-kit-prompts")!

    expect(prompts.textContent).toContain("Suggested by Watch")
    expect(prompts.textContent).toContain("not a study guide for this film")
    expect(prompts.querySelectorAll("li").length).toBeGreaterThan(0)
  })

  it("shows the film's authored study questions when it has them", () => {
    render({ studyQuestions: ["What surprised you?", "Who would you tell?"] })
    const prompts = byTestId("watch-share-kit-prompts")!

    expect(prompts.textContent).toContain("study questions for this film")
    expect(prompts.textContent).not.toContain("Suggested by Watch")
    expect(
      [...prompts.querySelectorAll("li")].map((li) => li.textContent),
    ).toEqual(["What surprised you?", "Who would you tell?"])
  })
})

describe("WatchShareKit guides", () => {
  it("lists real guide pages and PDFs as safe external links", () => {
    render()
    const links = [
      ...byTestId("watch-share-kit-sources")!.querySelectorAll("a"),
    ]

    expect(links.length).toBeGreaterThanOrEqual(4)
    for (const link of links) {
      expect(link.href).toMatch(/^https:\/\/www\.jesusfilm\.org\//)
      expect(link.target).toBe("_blank")
      expect(link.rel).toContain("noopener")
    }
    expect(links.some((link) => link.href.endsWith(".pdf"))).toBe(true)
  })
})

describe("WatchShareKit copy and native share", () => {
  it("copies the link and confirms", async () => {
    const writeText = vi.fn(() => Promise.resolve())
    setClipboard(writeText)
    render()

    await click(byTestId("watch-share-kit-copy-link")!)

    expect(writeText).toHaveBeenCalledWith(linkInput().value)
    expect(byTestId("watch-share-kit-status")!.textContent).toContain("copied")
  })

  it("keeps the kit and leaves the text selected when the clipboard refuses", async () => {
    setClipboard(() => Promise.reject(new Error("denied")))
    render()

    await click(byTestId("watch-share-kit-copy-link")!)

    const input = linkInput()
    expect(byTestId("watch-share-kit-status")!.textContent).toContain(
      "copy it manually",
    )
    expect(input.readOnly).toBe(true)
    expect([input.selectionStart, input.selectionEnd]).toEqual([
      0,
      input.value.length,
    ])
    expect(byTestId("watch-share-kit-prompts")).not.toBeNull()
    expect(byTestId("watch-share-kit-sources")).not.toBeNull()
  })

  it("selects the invitation when copying it is refused", async () => {
    setClipboard(() => Promise.reject(new Error("denied")))
    render()

    await click(byTestId("watch-share-kit-copy-invitation")!)

    const invitation = byTestId<HTMLTextAreaElement>(
      "watch-share-kit-invitation",
    )!
    expect([invitation.selectionStart, invitation.selectionEnd]).toEqual([
      0,
      invitation.value.length,
    ])
    expect(invitation.value).toContain(linkInput().value)
  })

  it("hides the native share button when the browser has none", () => {
    render()

    expect(byTestId("watch-share-kit-native-share")).toBeNull()
  })

  it("passes the invitation and link to native share", async () => {
    const share = vi.fn(() => Promise.resolve())
    setNativeShare(share)
    render()

    await click(byTestId("watch-share-kit-native-share")!)

    expect(share).toHaveBeenCalledWith({
      title: "Seed Demo Video",
      text: expect.stringContaining("Seed Demo Video"),
      url: linkInput().value,
    })
  })

  it("falls back to selectable text when native share refuses, but stays quiet on cancel", async () => {
    const share = vi.fn<(data: ShareData) => Promise<void>>()
    setNativeShare(share)
    render()

    share.mockRejectedValueOnce(new DOMException("cancelled", "AbortError"))
    await click(byTestId("watch-share-kit-native-share")!)
    expect(byTestId("watch-share-kit-status")!.textContent).toBe("")

    share.mockRejectedValueOnce(new DOMException("nope", "NotAllowedError"))
    await click(byTestId("watch-share-kit-native-share")!)
    expect(byTestId("watch-share-kit-status")!.textContent).toContain(
      "copy it manually",
    )
    expect(linkInput().value).toContain("seed-demo-video")
  })
})

describe("WatchShareKit print view", () => {
  it("prints a document with title, link, attribution and prompts but no controls", async () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => {})
    render({ studyQuestions: ["What surprised you?"] })

    await click(byTestId("watch-share-kit-print")!)
    expect(print).toHaveBeenCalledTimes(1)

    const doc = byTestId("watch-share-kit-print-document")!
    expect(doc.closest("[data-watch-share-kit-print-root]")).not.toBeNull()
    expect(doc.textContent).toContain("Seed Demo Video")
    expect(doc.textContent).toContain(linkInput().value)
    expect(doc.textContent).toContain("What surprised you?")
    expect(doc.textContent).toContain("Jesus Film Project")
    expect(doc.textContent).toContain(
      "https://www.jesusfilm.org/resources/strategies/outreach/how-to-host-a-short-film-festival/",
    )
    expect(
      doc.querySelectorAll("button, input, textarea, select"),
    ).toHaveLength(0)
  })

  it("prints the recipient's link after the language is changed", async () => {
    render()
    const select = byTestId<HTMLSelectElement>("watch-share-kit-language")!
    await act(async () => {
      select.value = "spanish-latin-american"
      select.dispatchEvent(new Event("change", { bubbles: true }))
    })

    expect(byTestId("watch-share-kit-print-document")!.textContent).toContain(
      "/spanish-latin-american.html",
    )
  })

  it("removes the print document when the kit closes", () => {
    render()
    expect(byTestId("watch-share-kit-print-document")).not.toBeNull()

    act(() => root.render(null))

    expect(byTestId("watch-share-kit-print-document")).toBeNull()
  })
})

describe("WatchShareKit dismissal", () => {
  it("closes from the button and from Escape", async () => {
    const onClose = vi.fn()
    render({}, { onClose })

    await click(byTestId("watch-share-kit-close")!)
    expect(onClose).toHaveBeenCalledTimes(1)

    await act(async () => {
      byTestId("watch-share-kit")!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      )
    })
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})

it.each([
  ["ar", "rtl"],
  ["es", "ltr"],
])(
  "keeps English portal content independent of a %s document",
  async (lang, dir) => {
    document.documentElement.lang = lang
    document.documentElement.dir = dir
    try {
      render()
      const node = byTestId("watch-share-kit-print-document")!
      expect(node.getAttribute("lang")).toBe("en")
      expect(node.getAttribute("dir")).toBe("ltr")
    } finally {
      document.documentElement.removeAttribute("lang")
      document.documentElement.removeAttribute("dir")
    }
  },
)

it("does not mark authored questions with missing locale metadata as English in the printed portal", () => {
  document.documentElement.lang = "ar"
  document.documentElement.dir = "rtl"
  try {
    render({ studyQuestions: ["ما الذي لفت انتباهك؟"] })
    const print = byTestId("watch-share-kit-print-document")!
    const lists = [...document.querySelectorAll("li")].filter(
      (node) => node.textContent === "ما الذي لفت انتباهك؟",
    )
    expect(lists).toHaveLength(2)
    for (const node of lists) {
      expect(node.closest("[lang]")?.getAttribute("lang")).toBe("")
      expect(node.closest("[dir]")?.getAttribute("dir")).toBe("auto")
    }
    expect(print.getAttribute("lang")).toBe("en")
    expect(print.getAttribute("dir")).toBe("ltr")
  } finally {
    document.documentElement.removeAttribute("lang")
    document.documentElement.removeAttribute("dir")
  }
})

it("keeps the authored film title neutral inside the English print portal", () => {
  render({ title: "يسوع" })
  const title = byTestId("watch-share-kit-print-document")!.querySelector("h1")!
  expect(title.textContent).toBe("يسوع")
  expect(title.getAttribute("lang")).toBe("")
  expect(title.getAttribute("dir")).toBe("auto")
})
