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
import { BetaTesterModalProvider } from "@/components/watch/BetaTesterModalProvider"
import { WatchChromeShell } from "@/components/WatchChromeShell"

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

describe("Watch root layout", () => {
  it.each([
    {
      params: { locale: "en", htmlLang: "english-british" },
      expected: { lang: "en-GB", dir: "ltr" },
    },
    {
      params: { locale: "ar", htmlLang: "arabic-modern-standard" },
      expected: { lang: "ar", dir: "rtl" },
    },
  ])(
    "emits $expected.lang metadata with $expected.dir document direction",
    async ({ params, expected }) => {
      const layout = await RootLayout({
        children: <main>Watch page</main>,
        params: Promise.resolve(params),
      })

      const documentRoot = findElement(layout, "html")
      expect(documentRoot?.props).toMatchObject(expected)
    },
  )

  it("leaves the runtime beta tester CTA flag out of the static layout", async () => {
    const layout = await RootLayout({
      children: <main>Watch page</main>,
      params: Promise.resolve({ locale: "en", htmlLang: "english" }),
    })

    expect(findElement(layout, BetaTesterModalProvider)).toBeNull()

    const routeShell = WatchChromeShell({
      children: <main>Watch page</main>,
      locale: "en",
    })
    const provider = findElement(routeShell, BetaTesterModalProvider)
    expect(provider).not.toBeNull()
    expect(provider?.props).not.toHaveProperty("showGlobalTrigger")
  })
})
