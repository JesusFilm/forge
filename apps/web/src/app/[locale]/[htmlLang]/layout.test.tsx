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
