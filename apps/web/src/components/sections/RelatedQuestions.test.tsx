/**
 * @vitest-environment jsdom
 */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { reportDatadogRumAction } = vi.hoisted(() => ({
  reportDatadogRumAction: vi.fn(),
}))

vi.mock("@/components/DatadogRum", () => ({
  reportDatadogRumAction,
}))

import { RelatedQuestions } from "./RelatedQuestions"

function makeData(
  overrides: Record<string, unknown> = {},
): Parameters<typeof RelatedQuestions>[0]["data"] {
  return {
    id: "questions-1",
    sectionKey: "related-questions",
    heading: "Frequently asked questions",
    ctaLabel: "Read more",
    ctaLink: "https://www.jesusfilm.org/about/faq/",
    questions: [
      {
        id: "question-1",
        question: "Who is Jesus?",
        answer: "Jesus is the Son of God.",
      },
    ],
    ...overrides,
  } as unknown as Parameters<typeof RelatedQuestions>[0]["data"]
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  reportDatadogRumAction.mockReset()
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
})

describe("RelatedQuestions Watch-home CTA", () => {
  it("adds section context and reports the resolved destination", () => {
    act(() => {
      root.render(<RelatedQuestions surface="watch-home" data={makeData()} />)
    })

    const cta = container.querySelector<HTMLAnchorElement>(
      "[data-watch-home-section-cta='related-questions']",
    )
    expect(cta?.getAttribute("href")).toBe(
      "https://www.jesusfilm.org/about/faq/",
    )
    expect(cta?.getAttribute("aria-label")).toBe(
      "Read more: Frequently asked questions",
    )

    act(() => {
      cta?.click()
    })

    expect(reportDatadogRumAction).toHaveBeenCalledWith(
      "watch_home.section_cta_clicked",
      {
        surface: "watch_home",
        sectionKey: "related-questions",
        destination: "/about/faq/",
        routeKind: "site",
      },
    )
  })

  it("omits an unsupported Watch-local destination on Watch home", () => {
    act(() => {
      root.render(
        <RelatedQuestions
          surface="watch-home"
          data={makeData({ ctaLink: "/watch" })}
        />,
      )
    })

    expect(container.querySelector("a")).toBeNull()
  })

  it("preserves other Experience surfaces", () => {
    act(() => {
      root.render(<RelatedQuestions data={makeData({ ctaLink: "/" })} />)
    })

    expect(container.querySelector("a")?.getAttribute("href")).toBe("/")
  })

  it("keeps native navigation usable when analytics throws", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
    reportDatadogRumAction.mockImplementationOnce(() => {
      throw new Error("analytics unavailable")
    })

    act(() => {
      root.render(<RelatedQuestions surface="watch-home" data={makeData()} />)
    })

    const cta = container.querySelector<HTMLAnchorElement>("a")
    expect(() => {
      act(() => {
        cta?.click()
      })
    }).not.toThrow()
    expect(cta?.getAttribute("href")).toBe(
      "https://www.jesusfilm.org/about/faq/",
    )
    expect(consoleError).toHaveBeenCalledOnce()
    consoleError.mockRestore()
  })
})
