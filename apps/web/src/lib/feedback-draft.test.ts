/**
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest"

import {
  clampFeedbackDraftStep,
  clearFeedbackDraft,
  feedbackDraftHasContent,
  loadFeedbackDraft,
  saveFeedbackDraft,
  type FeedbackDraft,
} from "@/lib/feedback-draft"

const STORAGE_KEY = "forge.watch.feedback_draft"

function draft(overrides: Partial<FeedbackDraft> = {}): FeedbackDraft {
  return {
    path: "/watch/jesus.html",
    step: 2,
    category: "problem",
    message: "Playback failed after I pressed Watch.",
    name: "",
    email: "",
    languageArea: "",
    languageSlug: "",
    customLanguageName: "",
    useCustomLanguage: false,
    contentScope: "",
    contentQuery: "",
    selectedContent: null,
    selectedElement: null,
    ...overrides,
  }
}

beforeEach(() => {
  window.sessionStorage.clear()
})

afterEach(() => {
  window.sessionStorage.clear()
})

describe("feedback draft", () => {
  it("round-trips a draft for the page it was written on", () => {
    const written = draft()
    saveFeedbackDraft(written)

    expect(loadFeedbackDraft("/watch/jesus.html")).toEqual(written)
  })

  it("refuses a draft written on a different page, and discards it", () => {
    // Feedback is ABOUT a page. Restoring here would file someone's report
    // against a URL they never looked at.
    saveFeedbackDraft(draft({ path: "/watch/jesus.html" }))

    expect(loadFeedbackDraft("/watch/another.html")).toBeNull()
    // And it does not lie in wait for a third page either.
    expect(window.sessionStorage.getItem(STORAGE_KEY)).toBeNull()
  })

  it("stores nothing for an untouched form", () => {
    saveFeedbackDraft(draft({ category: null, message: "", step: 1 }))

    expect(window.sessionStorage.getItem(STORAGE_KEY)).toBeNull()
  })

  it("treats a chosen category alone as worth keeping", () => {
    expect(
      feedbackDraftHasContent(draft({ message: "", category: "idea" })),
    ).toBe(true)
    expect(
      feedbackDraftHasContent(draft({ message: "   ", category: null })),
    ).toBe(false)
  })

  describe("re-reading what storage hands back", () => {
    it("survives a value that is not JSON at all", () => {
      window.sessionStorage.setItem(STORAGE_KEY, "{not json")

      expect(loadFeedbackDraft("/watch/jesus.html")).toBeNull()
      expect(window.sessionStorage.getItem(STORAGE_KEY)).toBeNull()
    })

    it("rejects an enum value that is not in the form's vocabulary", () => {
      // Another tab, an extension, or an older build of this app could have
      // written this. A bad category would reach the submit payload.
      window.sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          ...draft(),
          category: "urgent",
          contentScope: "everything",
          languageArea: "grammar",
        }),
      )

      const restored = loadFeedbackDraft("/watch/jesus.html")
      expect(restored?.category).toBeNull()
      expect(restored?.contentScope).toBe("")
      expect(restored?.languageArea).toBe("")
      // The message it came with is still restored.
      expect(restored?.message).toBe("Playback failed after I pressed Watch.")
    })

    it("caps a message that grew beyond what the form would accept", () => {
      window.sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ ...draft(), message: "x".repeat(5000) }),
      )

      expect(loadFeedbackDraft("/watch/jesus.html")?.message).toHaveLength(1000)
    })

    it("coerces a non-string field instead of handing it to React", () => {
      window.sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ ...draft(), name: 42, step: "two" }),
      )

      const restored = loadFeedbackDraft("/watch/jesus.html")
      expect(restored?.name).toBe("")
      expect(restored?.step).toBe(1)
    })
  })

  it("keeps the two things a reader cannot retype", () => {
    // A picked video and a pointed-at element cost real effort and are not
    // recoverable from memory; dropping them was the whole failure mode.
    const written = draft({
      selectedContent: {
        title: "Jesus calms the storm",
        id: "video-1",
        slug: "jesus-calms-the-storm",
        label: "EPISODE",
        description: null,
      },
      selectedElement: {
        label: "Download",
        role: "button",
        path: "main>button",
      },
    })
    saveFeedbackDraft(written)

    const restored = loadFeedbackDraft("/watch/jesus.html")
    expect(restored?.selectedContent?.slug).toBe("jesus-calms-the-storm")
    expect(restored?.selectedElement).toEqual({
      label: "Download",
      role: "button",
      path: "main>button",
    })
  })

  it("drops a half-written element pick rather than restoring a partial one", () => {
    window.sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        ...draft(),
        selectedElement: { label: "Download", role: "button" },
        selectedContent: { id: "video-1" },
      }),
    )

    const restored = loadFeedbackDraft("/watch/jesus.html")
    expect(restored?.selectedElement).toBeNull()
    expect(restored?.selectedContent).toBeNull()
  })

  it("bounds name and email to what the submission schema accepts", () => {
    // The rate limiter runs BEFORE schema validation, so restoring a value
    // the server will reject costs the reporter their retry allowance.
    window.sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        ...draft(),
        name: "n".repeat(500),
        email: "e".repeat(500),
      }),
    )

    const restored = loadFeedbackDraft("/watch/jesus.html")
    expect(restored?.name).toHaveLength(100)
    expect(restored?.email).toHaveLength(254)
  })

  describe("the step a draft may resume on", () => {
    it("keeps a coherent draft on the step it left", () => {
      expect(clampFeedbackDraftStep(draft({ step: 4 }))).toBe(4)
    })

    it("refuses to resume past a message the server would reject", () => {
      // Otherwise the reader lands on Send with a message that fails
      // validation, and each retry burns the pre-validation rate limit.
      expect(clampFeedbackDraftStep(draft({ step: 5, message: "x" }))).toBe(2)
    })

    it("refuses to resume past a missing category", () => {
      expect(clampFeedbackDraftStep(draft({ step: 5, category: null }))).toBe(1)
    })

    it("bounds a step outside the wizard entirely", () => {
      expect(clampFeedbackDraftStep(draft({ step: 99 }))).toBe(5)
      expect(clampFeedbackDraftStep(draft({ step: -3 }))).toBe(1)
    })
  })

  it("clears on request", () => {
    saveFeedbackDraft(draft())
    clearFeedbackDraft()

    expect(loadFeedbackDraft("/watch/jesus.html")).toBeNull()
  })

  it("stays quiet when storage is denied outright", () => {
    const original = Object.getOwnPropertyDescriptor(window, "sessionStorage")
    Object.defineProperty(window, "sessionStorage", {
      get() {
        throw new Error("SecurityError")
      },
      configurable: true,
    })

    expect(() => saveFeedbackDraft(draft())).not.toThrow()
    expect(loadFeedbackDraft("/watch/jesus.html")).toBeNull()
    expect(() => clearFeedbackDraft()).not.toThrow()

    if (original) Object.defineProperty(window, "sessionStorage", original)
  })
})
