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
import { DirectionProvider } from "@/components/DirectionProvider"
import { BetaTesterModalProvider } from "@/components/watch/BetaTesterModalProvider"

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
      name: "English",
      locale: "en",
      htmlLang: "english",
      expectedLang: "en",
      expectedDirection: "ltr",
    },
    {
      name: "Arabic",
      locale: "ar",
      htmlLang: "arabic-modern-standard",
      expectedLang: "ar",
      expectedDirection: "rtl",
    },
    {
      name: "script-sensitive Hassaniyya Latin",
      locale: "mey-Latn",
      htmlLang: "arabic-hassaniya",
      expectedLang: "mey-Latn",
      expectedDirection: "ltr",
    },
  ])(
    "emits the resolved language and direction for $name",
    async ({ locale, htmlLang, expectedLang, expectedDirection }) => {
      const layout = await RootLayout({
        children: <main>Watch page</main>,
        params: Promise.resolve({ locale, htmlLang }),
      })

      expect(layout.props.lang).toBe(expectedLang)
      expect(layout.props.dir).toBe(expectedDirection)
      expect(findElement(layout, DirectionProvider)).toMatchObject({
        props: { direction: expectedDirection },
      })
    },
  )

  it("leaves the runtime beta tester CTA flag out of the static layout", async () => {
    const layout = await RootLayout({
      children: <main>Watch page</main>,
      params: Promise.resolve({ locale: "en", htmlLang: "english" }),
    })

    const provider = findElement(layout, BetaTesterModalProvider)
    expect(provider).not.toBeNull()
    expect(provider?.props).not.toHaveProperty("showGlobalTrigger")
  })
})
