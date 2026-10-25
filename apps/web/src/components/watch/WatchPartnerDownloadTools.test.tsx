/**
 * @vitest-environment jsdom
 */

import { NextIntlClientProvider } from "next-intl"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import messages from "../../../messages/en.json"
import { loadWatchCollectionDownloads } from "@/lib/watch-collection-download-actions"
import {
  WATCH_DOWNLOAD_AUTH_REQUIRED,
  WATCH_DOWNLOAD_ERROR_HEADER,
} from "@/lib/watch-download-contract"
import { loadGlobalWatchLanguageOptions } from "@/lib/watch-interaction-loader"
import { loadWatchPartnerDownloadCollection } from "@/lib/watch-partner-download-actions"

import {
  WatchPartnerDownloadTools,
  type WatchPartnerDownloadToolsProps,
} from "./WatchPartnerDownloadTools"

vi.mock("@/lib/watch-collection-download-actions", () => ({
  loadWatchCollectionDownloads: vi.fn(),
}))
vi.mock("@/lib/watch-partner-download-actions", () => ({
  loadWatchPartnerDownloadCollection: vi.fn(),
}))
vi.mock("@/lib/watch-interaction-loader", () => ({
  loadGlobalWatchLanguageOptions: vi.fn(),
}))

const downloads = vi.mocked(loadWatchCollectionDownloads)
const metadata = vi.mocked(loadWatchPartnerDownloadCollection)
const catalog = vi.mocked(loadGlobalWatchLanguageOptions)

// Canonical order is deliberately not alphabetical by id.
const EPISODES = [
  { documentId: "z-1", slug: "first", title: "First", order: 1 },
  { documentId: "a-2", slug: "second", title: "Second", order: 2 },
  { documentId: "m-3", slug: "third", title: "Third", order: 3 },
]
const LANGUAGES = [
  {
    slug: "english",
    englishName: "English",
    nativeName: "English",
    bcp47: "en",
  },
  {
    slug: "spanish",
    englishName: "Spanish",
    nativeName: "Español",
    bcp47: "es",
  },
  {
    slug: "french",
    englishName: "French",
    nativeName: "Français",
    bcp47: "fr",
  },
].map((language) => ({ aliasOwnerSlug: null, ...language }))

function download(language: string, video: string, suffix = "") {
  return {
    documentId: `dl-${language}-${video}${suffix}`,
    capability: `cap-${language}-${video}${suffix}`,
    height: suffix === "-lo" ? 360 : 1080,
    quality: suffix === "-lo" ? "low" : "high",
    size: suffix === "-lo" ? 50 : 200,
  }
}
function dubsFor(language: string, videos: string[], suffixes = [""]) {
  return videos.map((video) => ({
    documentId: `dub-${language}-${video}`,
    videoId: video,
    downloads: suffixes.map((suffix) => download(language, video, suffix)),
  }))
}

let supply: Record<
  string,
  Awaited<ReturnType<typeof loadWatchCollectionDownloads>>
>
let container: HTMLDivElement
let root: Root
let fetchMock: ReturnType<typeof vi.fn>
let headPlan: (downloadId: string) => Response
let clicked: Array<{ downloadId: string | null; download: string }>
let guardClicks: (event: Event) => void

function redirect() {
  return new Response(null, { status: 302 })
}

function view(props: WatchPartnerDownloadToolsProps) {
  return (
    <NextIntlClientProvider
      locale="en"
      messages={{ LanguageCombobox: messages.LanguageCombobox }}
    >
      <WatchPartnerDownloadTools {...props} />
    </NextIntlClientProvider>
  )
}

async function settle(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

async function mount(props: Partial<WatchPartnerDownloadToolsProps> = {}) {
  await act(async () => {
    root.render(view({ languageSlug: "english", locale: "en", ...props }))
  })
  await settle()
}

function byId(testId: string) {
  return container.querySelector<HTMLElement>(`[data-testid="${testId}"]`)
}

async function press(testId: string) {
  await act(async () => {
    byId(testId)!.click()
  })
  await settle()
}

async function addLanguage(name: string) {
  await act(async () => {
    document
      .querySelector<HTMLElement>('[data-testid="language-combobox-trigger"]')!
      .click()
  })
  await act(async () => {
    ;[
      ...document.querySelectorAll<HTMLElement>(
        '[data-testid="language-combobox-option"]',
      ),
    ]
      .find((option) => option.textContent?.includes(name))!
      .click()
  })
  await settle()
}

async function agree() {
  await act(async () => {
    byId("watch-partner-download-terms")!.click()
  })
}

/** Open the languages, add the given ones, prepare, accept the terms. */
async function prepared(extra: string[] = []) {
  await mount()
  await press("watch-partner-choose-languages")
  for (const name of extra) await addLanguage(name)
  await press("watch-partner-prepare")
  await agree()
}

const headIds = () =>
  fetchMock.mock.calls.map(([url]) =>
    new URL(url as string, "http://x").searchParams.get("downloadId"),
  )
const clickedIds = () => clicked.map((entry) => entry.downloadId)
const text = () => container.textContent ?? ""

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  window.history.replaceState(null, "", "/watch/en?role=partner")
  clicked = []
  supply = {
    english: { ok: true, dubs: dubsFor("english", ["z-1", "a-2", "m-3"]) },
    spanish: { ok: true, dubs: dubsFor("spanish", ["z-1", "m-3"]) },
    french: { ok: true, dubs: [] },
  }
  downloads.mockImplementation(async ({ languageSlug }) => supply[languageSlug])
  metadata.mockImplementation(async () => ({
    ok: true,
    collection: {
      slug: "walking-with-jesus-africa",
      title: "Walking with Jesus",
      episodes: EPISODES,
    },
  }))
  catalog.mockResolvedValue(LANGUAGES)
  headPlan = redirect
  fetchMock = vi.fn(async (url: string) =>
    headPlan(new URL(url, "http://x").searchParams.get("downloadId") as string),
  )
  vi.stubGlobal("fetch", fetchMock)
  // Real browser anchors are never followed: record the download requests and
  // swallow the navigation.
  guardClicks = (event) => {
    const anchor = (event.target as Element).closest("a")
    if (!anchor) return
    event.preventDefault()
    if (anchor.hasAttribute("download")) {
      clicked.push({
        downloadId: new URL(anchor.href, "http://x").searchParams.get(
          "downloadId",
        ),
        download: anchor.download,
      })
    }
  }
  document.addEventListener("click", guardClicks, true)
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  document.body.innerHTML = ""
  document.removeEventListener("click", guardClicks, true)
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe("Partner download tools", () => {
  it("makes no request until the visitor chooses to, and then only for the chosen collection and languages", async () => {
    await mount({ collectionSlug: "rivka" })
    expect(catalog).not.toHaveBeenCalled()
    expect(metadata).not.toHaveBeenCalled()
    expect(downloads).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()

    await press("watch-partner-choose-languages")
    expect(catalog).toHaveBeenCalledTimes(1)
    expect(downloads).not.toHaveBeenCalled()

    await press("watch-partner-prepare")
    expect(downloads.mock.calls).toEqual([
      [{ collectionSlug: "rivka", languageSlug: "english" }],
    ])
    expect(metadata.mock.calls).toEqual([
      [{ collectionSlug: "rivka", languageSlug: "english", locale: "en" }],
    ])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("defaults to the Africa collection and offers the curated ones", async () => {
    await mount()
    const select = container.querySelector<HTMLSelectElement>("select")!
    expect(select.value).toBe("walking-with-jesus-africa")
    expect([...select.options].map((option) => option.value)).toEqual([
      "walking-with-jesus-africa",
      "conversation-starters",
      "7-days-with-jesus-walk-with-jesus",
      "storyclubs",
      "do-you-ever-wonder",
      "rivka",
      "file-zero",
      "retelling-the-good-story",
    ])
  })

  it("starts two languages as ordered groups in canonical relation order, with the real queue", async () => {
    await prepared(["Spanish"])
    expect(downloads.mock.calls.map(([call]) => call.languageSlug)).toEqual([
      "english",
      "spanish",
    ])
    const groups = [
      ...container.querySelectorAll<HTMLElement>("[data-group-status]"),
    ]
    expect(groups.map((group) => group.dataset.languageSlug)).toEqual([
      "english",
      "spanish",
    ])
    expect(groups[0].textContent).toContain("3 of 3 films have a download")
    expect(groups[1].textContent).toContain("2 of 3 films have a download")
    expect(groups[1].textContent).toContain("the others are skipped")

    const start = byId("watch-partner-download-start") as HTMLButtonElement
    expect(start.textContent).toContain("5 files")
    await press("watch-partner-download-start")
    await settle(750 * 6)

    const expected = [
      "dl-english-z-1",
      "dl-english-a-2",
      "dl-english-m-3",
      "dl-spanish-z-1",
      "dl-spanish-m-3",
    ]
    expect(headIds()).toEqual(expected)
    expect(clickedIds()).toEqual(expected)
    expect(new Set(clicked.map((entry) => entry.download)).size).toBe(5)
    expect(clicked.every((entry) => entry.download.endsWith(".mp4"))).toBe(true)

    expect(byId("watch-partner-download-summary")!.textContent).toBe(
      "Your browser was asked to start 5 of 5 files. Check your browser’s downloads to see what was saved.",
    )
    expect(byId("watch-partner-download-retry")).toBeNull()
  })

  it("explains the browser's multiple-download permission and never claims a saved file, a ZIP or an email", async () => {
    await prepared(["Spanish"])
    expect(text()).toContain("ask to allow multiple downloads")
    expect(text()).toContain("can’t see whether they were saved")
    await press("watch-partner-download-start")
    await settle(750 * 6)
    expect(text()).not.toMatch(/\bzip\b|e-?mail|downloaded \d|saved \d/i)
  })

  it("tells the truth about a language with no downloads or a failed check, and queues neither", async () => {
    metadata.mockImplementation(async ({ languageSlug }) =>
      languageSlug === "spanish"
        ? { ok: false, reason: "failed" }
        : {
            ok: true,
            collection: {
              slug: "walking-with-jesus-africa",
              title: "Walking with Jesus",
              episodes: EPISODES,
            },
          },
    )
    await prepared(["Spanish", "French"])
    const status = (slug: string) =>
      container.querySelector<HTMLElement>(
        `[data-group-status][data-language-slug="${slug}"]`,
      )!
    expect(status("french").dataset.groupStatus).toBe("unavailable")
    expect(status("french").textContent).toContain(
      "No downloads are available in French",
    )
    expect(status("spanish").dataset.groupStatus).toBe("failed")
    expect(status("spanish").textContent).toContain(
      "couldn’t check Spanish right now",
    )

    await press("watch-partner-download-start")
    await settle(750 * 4)
    expect(clickedIds()).toEqual([
      "dl-english-z-1",
      "dl-english-a-2",
      "dl-english-m-3",
    ])
  })

  it("offers only the qualities a language really has, chosen per language", async () => {
    supply.english = {
      ok: true,
      dubs: dubsFor("english", ["z-1", "a-2", "m-3"], ["", "-lo"]),
    }
    await prepared(["Spanish"])
    const selects = [
      ...container.querySelectorAll<HTMLSelectElement>("li select"),
    ]
    // Spanish has a single rendition per film, so it gets no quality choice.
    expect(selects).toHaveLength(1)
    expect([...selects[0].options].map((o) => o.textContent)).toEqual([
      "Highest quality",
      "Low quality",
    ])
    await act(async () => {
      selects[0].value = "low"
      selects[0].dispatchEvent(new Event("change", { bubbles: true }))
    })
    await press("watch-partner-download-start")
    await settle(750 * 6)
    expect(clickedIds()).toEqual([
      "dl-english-z-1-lo",
      "dl-english-a-2-lo",
      "dl-english-m-3-lo",
      "dl-spanish-z-1",
      "dl-spanish-m-3",
    ])
  })

  it("requires the Terms, and links the canonical Terms of Use", async () => {
    await mount()
    await press("watch-partner-prepare")
    const start = byId("watch-partner-download-start") as HTMLButtonElement
    expect(start.disabled).toBe(true)
    const link = [...container.querySelectorAll("a")].find(
      (a) => a.textContent === "Terms of Use",
    )!
    expect(link.getAttribute("href")).toBe(
      "https://www.jesusfilm.org/terms-of-use/",
    )
    expect(link.getAttribute("target")).toBe("_blank")
    expect(link.getAttribute("rel")).toBe("noopener noreferrer")
    await act(async () => {
      start.click()
    })
    await settle()
    expect(fetchMock).not.toHaveBeenCalled()
    await agree()
    expect(start.disabled).toBe(false)
  })

  it("stops before the next file when cancelled, then resumes only what was not started", async () => {
    await prepared(["Spanish"])
    await press("watch-partner-download-start")
    expect(clickedIds()).toEqual(["dl-english-z-1"])

    await press("watch-partner-download-stop")
    await settle(750 * 6)
    expect(clickedIds()).toEqual(["dl-english-z-1"])
    expect(byId("watch-partner-download-summary")!.textContent).toBe(
      "Stopped. Your browser was asked to start 1 of 5 files. 4 were not started.",
    )
    expect(
      [...container.querySelectorAll("[data-queue-id]")].map(
        (el) => (el as HTMLElement).dataset.queueId,
      ),
    ).toEqual(["english:a-2", "english:m-3", "spanish:z-1", "spanish:m-3"])

    const callsBefore = downloads.mock.calls.length
    await press("watch-partner-download-retry")
    await settle(750 * 6)
    // Fresh capabilities for both languages that still have files to start.
    expect(downloads.mock.calls.length).toBe(callsBefore + 2)
    expect(clickedIds()).toEqual([
      "dl-english-z-1",
      "dl-english-a-2",
      "dl-english-m-3",
      "dl-spanish-z-1",
      "dl-spanish-m-3",
    ])
    expect(byId("watch-partner-download-summary")!.textContent).toContain(
      "asked to start 5 of 5 files",
    )
  })

  it("retries only a file that failed to start, never one already started", async () => {
    let failSecond = true
    headPlan = (downloadId) =>
      failSecond && downloadId === "dl-english-a-2"
        ? new Response(null, { status: 404 })
        : redirect()
    await prepared(["Spanish"])
    await press("watch-partner-download-start")
    await settle(750 * 6)

    expect(clickedIds()).toEqual([
      "dl-english-z-1",
      "dl-english-m-3",
      "dl-spanish-z-1",
      "dl-spanish-m-3",
    ])
    expect(byId("watch-partner-download-summary")!.textContent).toContain(
      "asked to start 4 of 5 files. 1 was not started.",
    )
    expect(byId("watch-partner-download-pending")!.textContent).toBe(
      "English: Second",
    )

    failSecond = false
    const callsBefore = downloads.mock.calls.length
    await press("watch-partner-download-retry")
    await settle(750 * 3)

    // Only English had a failure, so only English is looked up again.
    expect(downloads.mock.calls.slice(callsBefore)).toEqual([
      [
        {
          collectionSlug: "walking-with-jesus-africa",
          languageSlug: "english",
        },
      ],
    ])
    expect(clickedIds()).toEqual([
      "dl-english-z-1",
      "dl-english-m-3",
      "dl-spanish-z-1",
      "dl-spanish-m-3",
      "dl-english-a-2",
    ])
    expect(byId("watch-partner-download-summary")!.textContent).toContain(
      "asked to start 5 of 5 files.",
    )
    expect(byId("watch-partner-download-retry")).toBeNull()
  })

  it("keeps a file out of the retry when it has gone missing since", async () => {
    headPlan = (downloadId) =>
      downloadId === "dl-english-a-2"
        ? new Response(null, { status: 404 })
        : redirect()
    await prepared()
    await press("watch-partner-download-start")
    await settle(750 * 4)
    expect(byId("watch-partner-download-pending")!.textContent).toBe(
      "English: Second",
    )

    supply.english = { ok: true, dubs: dubsFor("english", ["z-1", "m-3"]) }
    await press("watch-partner-download-retry")
    await settle(750 * 2)
    expect(clickedIds()).toEqual(["dl-english-z-1", "dl-english-m-3"])
    expect(byId("watch-partner-download-pending")!.textContent).toBe(
      "English: Second",
    )
  })

  it("offers a real Sign in action when downloads need an account, pointing back at the current page", async () => {
    supply.english = { ok: false, reason: "auth-required" }
    await mount()
    await press("watch-partner-prepare")
    expect(byId("watch-partner-download-groups")).toBeNull()
    const signIn = byId("watch-partner-download-sign-in") as HTMLAnchorElement
    expect(new URL(signIn.href).pathname).toBe("/watch/api/auth/login")
    expect(new URL(signIn.href).searchParams.get("returnTo")).toBe(
      "/watch/en?role=partner",
    )

    window.history.replaceState(null, "", "/watch/en?role=partner&moved=1")
    await act(async () => {
      signIn.click()
    })
    expect(new URL(signIn.href).searchParams.get("returnTo")).toBe(
      "/watch/en?role=partner&moved=1",
    )
  })

  it("asks to sign in again when the account lapses mid-run and leaves the rest not started", async () => {
    headPlan = (downloadId) =>
      downloadId === "dl-english-a-2"
        ? new Response(null, {
            status: 401,
            headers: {
              [WATCH_DOWNLOAD_ERROR_HEADER]: WATCH_DOWNLOAD_AUTH_REQUIRED,
            },
          })
        : redirect()
    await prepared()
    await press("watch-partner-download-start")
    await settle(750 * 3)
    expect(clickedIds()).toEqual(["dl-english-z-1"])
    expect(byId("watch-partner-download-sign-in")).not.toBeNull()
    expect(byId("watch-partner-download-summary")!.textContent).toContain(
      "asked to start 1 of 3 files. 2 were not started.",
    )
  })

  it("stops a running queue when the account changes", async () => {
    await prepared(["Spanish"])
    await press("watch-partner-download-start")
    expect(clickedIds()).toEqual(["dl-english-z-1"])

    await act(async () => {
      root.render(
        view({ languageSlug: "english", locale: "en", accountId: "other" }),
      )
    })
    await settle(750 * 6)
    expect(clickedIds()).toEqual(["dl-english-z-1"])
    expect(byId("watch-partner-download-status")).toBeNull()
    expect(byId("watch-partner-download-groups")).toBeNull()
  })

  it("starts nothing from a lookup that was still in flight when the account changed", async () => {
    await prepared()
    let release!: (
      value: Awaited<ReturnType<typeof loadWatchCollectionDownloads>>,
    ) => void
    downloads.mockImplementationOnce(
      () => new Promise((resolve) => (release = resolve)),
    )
    await press("watch-partner-download-start")
    await act(async () => {
      root.render(
        view({ languageSlug: "english", locale: "en", accountId: "other" }),
      )
    })
    await act(async () => {
      release(supply.english)
    })
    await settle(750 * 4)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(clicked).toEqual([])
  })

  it("discards a prepared collection when the collection or languages change", async () => {
    await prepared()
    expect(byId("watch-partner-download-groups")).not.toBeNull()
    const select = container.querySelector<HTMLSelectElement>("select")!
    await act(async () => {
      select.value = "rivka"
      select.dispatchEvent(new Event("change", { bubbles: true }))
    })
    expect(byId("watch-partner-download-groups")).toBeNull()
    expect(byId("watch-partner-download-start")).toBeNull()
    await press("watch-partner-prepare")
    expect(downloads.mock.calls.at(-1)![0].collectionSlug).toBe("rivka")
  })
})
