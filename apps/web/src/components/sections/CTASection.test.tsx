/** @vitest-environment jsdom */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { CTASection } from "@/components/sections/CTASection"
import type { FragmentOf } from "@/lib/legacy-fragment-types"
import { ctaSectionFragment } from "@/lib/fragments/cta-section"
import { BETA_TESTER_URL } from "@/lib/beta-tester"

let container: HTMLDivElement
let root: Root

function data(buttonLink: string) {
  return {
    __typename: "ComponentSectionsCtaSection",
    id: "cta",
    ctaHeading: "Help shape Watch",
    body: "Join the beta group.",
    buttonLabel: "Become a beta tester",
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
  it("uses the provider-safe beta trigger for the exact beta URL", () => {
    act(() => root.render(<CTASection data={data(BETA_TESTER_URL)} />))

    const link = container.querySelector("a") as HTMLAnchorElement
    expect(link.getAttribute("href")).toBe(BETA_TESTER_URL)
    expect(link.target).toBe("_blank")
    expect(link.rel).toBe("noopener noreferrer nofollow")
  })

  it("leaves every other authored CTA as an ordinary link", () => {
    act(() => root.render(<CTASection data={data("https://example.org")} />))

    const link = container.querySelector("a") as HTMLAnchorElement
    expect(link.getAttribute("href")).toBe("https://example.org")
    expect(link.textContent).toBe("Become a beta tester")
  })
})
