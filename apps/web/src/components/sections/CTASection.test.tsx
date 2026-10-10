/** @vitest-environment jsdom */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { CTASection } from "@/components/sections/CTASection"
import type { FragmentOf } from "@/lib/legacy-fragment-types"
import { ctaSectionFragment } from "@/lib/fragments/cta-section"

let container: HTMLDivElement
let root: Root

function data(buttonLink: string) {
  return {
    __typename: "ComponentSectionsCtaSection",
    id: "cta",
    ctaHeading: "Explore our resources",
    body: "Find resources to share.",
    buttonLabel: "Browse resources",
    buttonLink,
  } as unknown as FragmentOf<typeof ctaSectionFragment>
}

beforeEach(() => {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe("CTASection", () => {
  it.each([
    "https://mailchi.mp/jesusfilm/beta",
    "https://mailchi.mp/jesusfilm/beta/?source=watch#signup",
    "http://mailchi.mp/jesusfilm/beta",
  ])("hides retired signup sections linking to %s", (url) => {
    act(() => root.render(<CTASection data={data(url)} />))
    expect(container.innerHTML).toBe("")
  })

  it.each([
    "https://example.org",
    "https://mailchi.mp/jesusfilm/resources",
    "https://example.org/jesusfilm/beta",
  ])("preserves other authored CTA links: %s", (url) => {
    act(() => root.render(<CTASection data={data(url)} />))

    const link = container.querySelector("a") as HTMLAnchorElement
    expect(link.getAttribute("href")).toBe(url)
    expect(link.textContent).toBe("Browse resources")
  })
})
