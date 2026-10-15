/**
 * @vitest-environment jsdom
 */
import { createRef } from "react"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { MuxPlayerRef } from "@forge/video-player"

import { SubtitleTranscript } from "@/components/watch/SubtitleTranscript"
import type { WatchSubtitle } from "@/lib/content"

vi.mock("next-intl", () => ({
  useTranslations:
    () =>
    (key: string): string =>
      key,
}))

function subtitle(
  slug: string,
  name: string,
  nativeName: string | null,
  nativeNameLang: string | null,
  nameLang?: "en",
): WatchSubtitle {
  return {
    documentId: `subtitle-${slug}`,
    language: {
      slug,
      name,
      ...(nameLang ? { nameLang } : {}),
      nativeName,
      ...(nativeNameLang ? { nativeNameLang } : {}),
      bcp47: slug,
    },
    vttSrc: `https://example.com/${slug}.vtt`,
    primary: false,
    aiGenerated: false,
  }
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  vi.unstubAllGlobals()
  act(() => {
    root.unmount()
  })
  container.remove()
})

function render(subtitles: WatchSubtitle[], audioSlug: string | null) {
  act(() => {
    root.render(
      <SubtitleTranscript
        subtitles={subtitles}
        audioSlug={audioSlug}
        playerRef={createRef<MuxPlayerRef | null>()}
        initialTranscript={{
          vttSrc: subtitles[0]!.vttSrc,
          compactText: "cue",
        }}
      />,
    )
  })
}

describe("SubtitleTranscript native language markup (FGE-50)", () => {
  it("chip: English name and verified native name get separate bdi", () => {
    render([subtitle("ar", "Arabic", "العربية", "ar", "en")], "ar")
    const chip = container.querySelector("span.uppercase")
    const [english, native] = Array.from(chip?.querySelectorAll("bdi") ?? [])
    expect(english?.textContent).toBe("Arabic")
    expect(english?.getAttribute("lang")).toBe("en")
    expect(english?.getAttribute("dir")).toBe("ltr")
    expect(native?.textContent).toBe("العربية")
    expect(native?.getAttribute("lang")).toBe("ar")
    expect(native?.getAttribute("dir")).toBe("rtl")
  })

  it("chip: an English name of unproven language stays untagged", () => {
    // No nameLang: a legacy producer's name may be any language's translation.
    render([subtitle("ar", "Arabic", "العربية", "ar")], "ar")
    const [english] = Array.from(
      container.querySelectorAll("span.uppercase bdi"),
    )
    expect(english?.textContent).toBe("Arabic")
    expect(english?.hasAttribute("lang")).toBe(false)
  })

  it("chip: an unverified native name stays untagged", () => {
    render([subtitle("ku", "Kurdish", "kurdî", null)], "ku")
    const native = container.querySelectorAll("span.uppercase bdi")[1]
    expect(native?.textContent).toBe("kurdî")
    expect(native?.hasAttribute("lang")).toBe(false)
  })

  it("chip: no native name renders the plain English name with no markup", () => {
    render([subtitle("english", "English", null, null)], "english")
    const chip = container.querySelector("span.uppercase")
    expect(chip?.querySelector("bdi")).toBeNull()
    expect(chip?.textContent).toBe("English")
  })

  it("select: option is a plain isolated mixed label with no nested markup or lang", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => {})),
    )
    render(
      [
        subtitle("ar", "Arabic", "العربية", "ar"),
        subtitle("he", "Hebrew", "עברית", "he"),
      ],
      null,
    )
    await act(async () => {
      container
        .querySelector<HTMLElement>(
          '[data-testid="watch-subtitle-transcript-toggle"]',
        )
        ?.click()
    })
    await act(async () => {
      await Promise.resolve()
    })
    const options = Array.from(container.querySelectorAll("select option"))
    expect(options).toHaveLength(2)
    expect(options[0]?.children).toHaveLength(0)
    expect(options[0]?.hasAttribute("lang")).toBe(false)
    expect(options[0]?.textContent).toBe("⁨Arabic⁩ (⁨العربية⁩)")
    expect(container.querySelector("select")?.hasAttribute("lang")).toBe(false)
  })
})
