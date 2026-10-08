/**
 * @vitest-environment jsdom
 *
 * v2 (U5, R16): only the three allowlisted study-question CTAs emit
 * `watch_cta_clicked`, each with its identifier and destination class only.
 * The flag is ON and `window.gtag` is defined in every case, so an absence
 * assertion cannot pass because another gate was closed.
 */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import enMessages from "../../../messages/en.json"

const { mockEnv } = vi.hoisted(() => ({
  mockEnv: {
    NEXT_PUBLIC_CANONICAL_ORIGIN: "https://www.jesusfilm.org",
    NEXT_PUBLIC_FORGE_WATCH_GA4_CONTRACT_V2: true as boolean | undefined,
  },
}))

vi.mock("@/env", () => ({ env: mockEnv }))

import { WatchStudyQuestions } from "@/components/watch/WatchStudyQuestions"
import {
  resetWatchAnalyticsEmitState,
  setWatchAnalyticsFrameScheduler,
} from "@/lib/watch-analytics-contract"

let container: HTMLDivElement
let root: Root
let gtag: ReturnType<typeof vi.fn>

function render(prompts: string[]) {
  act(() => {
    root.render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <WatchStudyQuestions prompts={prompts} />
      </NextIntlClientProvider>,
    )
  })
}

function click(testId: string) {
  const element = container.querySelector<HTMLElement>(
    `[data-testid="${testId}"]`,
  )
  expect(element).not.toBeNull()
  act(() => {
    element?.click()
  })
}

function ctaEvents(): Array<Record<string, unknown>> {
  return gtag.mock.calls
    .filter(
      ([command, name]) => command === "event" && name === "watch_cta_clicked",
    )
    .map(([, , params]) => params as Record<string, unknown>)
}

beforeEach(() => {
  mockEnv.NEXT_PUBLIC_FORGE_WATCH_GA4_CONTRACT_V2 = true
  resetWatchAnalyticsEmitState()
  gtag = vi.fn()
  window.gtag = gtag
  // A frame that never runs: every positive assertion below proves the
  // dispatch was IMMEDIATE, as R28 requires for an outbound link.
  setWatchAnalyticsFrameScheduler(() => {})
  window.history.replaceState({}, "", "/watch/jesus.html")
  // Outbound anchors open a new tab; jsdom would otherwise try to navigate.
  document.addEventListener("click", preventNavigation, true)
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  document.removeEventListener("click", preventNavigation, true)
  setWatchAnalyticsFrameScheduler(null)
  window.gtag = undefined
})

function preventNavigation(event: Event) {
  if (event.target instanceof Element && event.target.closest("a")) {
    event.preventDefault()
  }
}

describe("WatchStudyQuestions — mission CTA measurement", () => {
  it("reports each study CTA once, immediately, with only its id and destination class", () => {
    render(["Who is Jesus?"])

    click("watch-study-questions-ask-yours")
    // Expand the question to reach its two CTAs.
    click("watch-study-questions-item-trigger")
    click("watch-study-questions-chat-cta")
    click("watch-study-questions-ask-bible-cta")

    expect(
      ctaEvents().map((params) => [
        params.watch_cta_id,
        params.watch_destination_class,
      ]),
    ).toEqual([
      ["study_ask_yours", "outbound"],
      ["study_chat_with_person", "outbound"],
      ["study_ask_bible_question", "outbound"],
    ])
    for (const params of ctaEvents()) {
      expect(params).toMatchObject({
        event_contract_version: 2,
        page_path: "/watch/jesus.html",
      })
    }
    // Neither the href nor the label text reaches GA.
    const wire = JSON.stringify(gtag.mock.calls)
    for (const forbidden of [
      "chataboutjesus.com",
      "everystudent.com",
      "issuesiface.com",
      "utm_source",
      "Who is Jesus?",
    ]) {
      expect(wire).not.toContain(forbidden)
    }
  })

  it("does not report expanding or collapsing a question", () => {
    render(["Who is Jesus?"])

    click("watch-study-questions-item-trigger")
    click("watch-study-questions-item-trigger")

    expect(gtag).not.toHaveBeenCalled()
  })

  it("emits nothing with the flag off", () => {
    mockEnv.NEXT_PUBLIC_FORGE_WATCH_GA4_CONTRACT_V2 = false
    render(["Who is Jesus?"])

    click("watch-study-questions-ask-yours")

    expect(gtag).not.toHaveBeenCalled()
  })
})
