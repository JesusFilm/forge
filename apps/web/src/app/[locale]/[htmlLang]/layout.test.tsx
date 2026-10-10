import {
  Children,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react"
import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/watch-font", () => ({
  montserrat: { variable: "font-montserrat" },
}))

import RootLayout from "./layout"
import DatadogRum from "@/components/DatadogRum"
import GoogleAnalytics from "@/components/GoogleAnalytics"
import { BetaTesterModalProvider } from "@/components/watch/BetaTesterModalProvider"
import { WatchChromeShell } from "@/components/WatchChromeShell"
import { RecommendationConsentShell } from "@/components/recommendations/RecommendationConsentShell"
import { watchScriptFontPreload } from "@/lib/watch-script-font"

function findElement(
  node: ReactNode,
  type: ReactElement["type"],
): ReactElement | null {
  if (!isValidElement<{ children?: ReactNode }>(node)) return null
  if (node.type === type) return node

  for (const child of Children.toArray(node.props.children)) {
    const match = findElement(child, type)
    if (match) return match
  }

  return null
}

describe("Watch root layout <html lang>/<dir> (FGE-170 / W-082)", () => {
  async function htmlAttributes(locale: string, htmlLang: string) {
    const layout = (await RootLayout({
      children: <main>Watch page</main>,
      params: Promise.resolve({ locale, htmlLang }),
    })) as ReactElement<{ lang: string; dir: string }>
    return { lang: layout.props.lang, dir: layout.props.dir }
  }

  // The resolver returning `ars` only matters if the document actually renders
  // it, so this asserts at the layer the bug was reported at: production served
  // `<html lang="en" dir="ltr">` for `/watch/arabic-najdi.html/videos`.
  it("declares the content language and direction for catalog-less RTL languages", async () => {
    await expect(htmlAttributes("en", "ars")).resolves.toEqual({
      lang: "ars",
      dir: "rtl",
    })
    await expect(htmlAttributes("en", "pbt")).resolves.toEqual({
      lang: "pbt",
      dir: "rtl",
    })
    await expect(htmlAttributes("en", "prs")).resolves.toEqual({
      lang: "prs",
      dir: "rtl",
    })
  })

  // The RTL cases above cannot show that the TAG is what changed rather than
  // the direction. A catalog-less LTR language is the discriminating companion.
  it("declares the content language for a catalog-less LTR language", async () => {
    await expect(htmlAttributes("en", "aiw")).resolves.toEqual({
      lang: "aiw",
      dir: "ltr",
    })
  })

  it("keeps already-correct documents unchanged", async () => {
    await expect(htmlAttributes("en", "english")).resolves.toEqual({
      lang: "en",
      dir: "ltr",
    })
    await expect(htmlAttributes("en", "en-GB")).resolves.toEqual({
      lang: "en-GB",
      dir: "ltr",
    })
    await expect(htmlAttributes("es", "es-419")).resolves.toEqual({
      lang: "es-419",
      dir: "ltr",
    })
    await expect(htmlAttributes("sd", "sd")).resolves.toEqual({
      lang: "sd",
      dir: "rtl",
    })
  })

  // The layout's own guard drops htmlLang whenever it does not belong to the
  // rendered UI locale's family. That guard is separate from the resolver's,
  // and it must survive the resolver change.
  it("ignores an htmlLang segment that does not belong to the rendered locale", async () => {
    await expect(htmlAttributes("es", "ars")).resolves.toEqual({
      lang: "es",
      dir: "ltr",
    })
  })
})

describe("Watch script font preloads (FGE-181 / W-084)", () => {
  it.each([
    ["ar", "/watch/fonts/noto-sans-arabic.woff2"],
    ["he", "/watch/fonts/noto-sans-hebrew.woff2"],
    ["hi", "/watch/fonts/noto-sans-devanagari.woff2"],
    ["th", "/watch/fonts/noto-sans-thai.woff2"],
    ["am", "/watch/fonts/noto-sans-ethiopic.woff2"],
  ])("preloads the matching subset for %s", (htmlLang, expected) => {
    expect(watchScriptFontPreload(htmlLang)).toBe(expected)
  })

  it.each(["en", "ja", "zh-Hans", "not-a-language"])(
    "does not preload a mismatched or unconfigured subset for %s",
    (htmlLang) => {
      expect(watchScriptFontPreload(htmlLang)).toBeNull()
    },
  )

  it("renders the base-path-aware subset preload in the document head", async () => {
    const layout = await RootLayout({
      children: <main>Arabic Watch page</main>,
      params: Promise.resolve({ locale: "ar", htmlLang: "ar" }),
    })
    const preload = findElement(layout, "link") as ReactElement<{
      href: string
      rel: string
      as: string
    }>

    expect(preload.props).toMatchObject({
      href: "/watch/fonts/noto-sans-arabic.woff2",
      rel: "preload",
      as: "font",
    })
  })
})

describe("Watch root layout", () => {
  it("mounts both environment-configured analytics integrations", async () => {
    const layout = await RootLayout({
      children: <main>Watch page</main>,
      params: Promise.resolve({ locale: "en", htmlLang: "english" }),
    })

    expect(findElement(layout, GoogleAnalytics)).not.toBeNull()
    expect(findElement(layout, DatadogRum)).not.toBeNull()
  })

  it("leaves the runtime beta tester CTA flag out of the static layout", async () => {
    const layout = await RootLayout({
      children: <main>Watch page</main>,
      params: Promise.resolve({ locale: "en", htmlLang: "english" }),
    })

    expect(findElement(layout, BetaTesterModalProvider)).toBeNull()
    expect(findElement(layout, RecommendationConsentShell)).not.toBeNull()

    const routeShell = WatchChromeShell({
      children: <main>Watch page</main>,
      locale: "en",
    })
    const provider = findElement(routeShell, BetaTesterModalProvider)
    expect(provider).not.toBeNull()
    expect(provider?.props).not.toHaveProperty("showGlobalTrigger")
  })
})
