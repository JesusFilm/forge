/** @vitest-environment node */

import { beforeEach, describe, expect, it, vi } from "vitest"

const linear = vi.hoisted(() => ({ createIssue: vi.fn() }))

vi.mock("@/lib/feedback-linear", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/feedback-linear")>()
  return { ...actual, createLinearFeedbackIssue: linear.createIssue }
})

import {
  FEEDBACK_RATE_LIMIT_MAX_BUCKETS,
  feedbackRateLimitBucketCountForTests,
  resetFeedbackRateLimitForTests,
  submitFeedbackWithHeaders,
} from "./feedback-action-core"

const validPayload = {
  category: "problem",
  message: "The Watch button did not start playback.",
  name: "Alex Morgan",
  email: "alex@example.com",
  page: {
    title: "The Life of Jesus",
    url: "https://www.jesusfilm.org/watch/jesus.html",
    locale: "en",
  },
  languageIssue: { area: "subtitles", language: "Spanish" },
  content: {
    scope: "other",
    title: "Jesus Film Collection",
    id: "collection-1",
    slug: "jesus-film-collection",
    label: "COLLECTION",
  },
  diagnostics: {
    browser: "Chrome 140",
    operatingSystem: "macOS",
    device: "Desktop",
    viewport: "1440 × 1024 @ 2x",
    timeZone: "America/Halifax",
    appVersion: "release-1",
  },
}

function requestHeaders(address = "203.0.113.10"): Headers {
  return new Headers({ "cf-connecting-ip": address })
}

describe("submitFeedbackWithHeaders", () => {
  beforeEach(() => {
    resetFeedbackRateLimitForTests()
    linear.createIssue.mockReset()
    linear.createIssue.mockResolvedValue({ ok: true })
  })

  it("validates and forwards a bounded feedback payload", async () => {
    await expect(
      submitFeedbackWithHeaders(validPayload, requestHeaders()),
    ).resolves.toEqual({ ok: true })
    expect(linear.createIssue).toHaveBeenCalledWith(validPayload)
  })

  it("accepts feedback without optional email or diagnostics", async () => {
    const minimalPayload: Record<string, unknown> = { ...validPayload }
    Reflect.deleteProperty(minimalPayload, "email")
    Reflect.deleteProperty(minimalPayload, "diagnostics")

    await expect(
      submitFeedbackWithHeaders(minimalPayload, requestHeaders()),
    ).resolves.toEqual({ ok: true })
    expect(linear.createIssue).toHaveBeenCalledWith(minimalPayload)
  })

  it.each([
    { ...validPayload, email: "not-an-email" },
    { ...validPayload, name: "" },
    { ...validPayload, message: "short" },
    { ...validPayload, extra: "not allowed" },
    {
      ...validPayload,
      page: { ...validPayload.page, url: "javascript:alert(1)" },
    },
    {
      ...validPayload,
      page: {
        ...validPayload.page,
        url: "https://user:password@example.com/watch",
      },
    },
  ])("rejects invalid public input", async (body) => {
    await expect(
      submitFeedbackWithHeaders(body, requestHeaders()),
    ).resolves.toMatchObject({ ok: false, reason: "invalid" })
    expect(linear.createIssue).not.toHaveBeenCalled()
  })

  it("rate limits a hashed client bucket before dispatch", async () => {
    for (let index = 0; index < 5; index += 1) {
      await expect(
        submitFeedbackWithHeaders(validPayload, requestHeaders()),
      ).resolves.toEqual({ ok: true })
    }

    await expect(
      submitFeedbackWithHeaders(validPayload, requestHeaders()),
    ).resolves.toMatchObject({ ok: false, reason: "rate_limited" })
    expect(linear.createIssue).toHaveBeenCalledTimes(5)
  })

  it("silently accepts a honeypot submission without dispatch", async () => {
    await expect(
      submitFeedbackWithHeaders(
        { ...validPayload, website: "spam.example" },
        requestHeaders(),
      ),
    ).resolves.toEqual({ ok: true })
    expect(linear.createIssue).not.toHaveBeenCalled()
  })

  it("maps Linear failures to a generic typed result", async () => {
    linear.createIssue.mockResolvedValue({
      ok: false,
      reason: "timeout",
      retryable: true,
    })

    await expect(
      submitFeedbackWithHeaders(validPayload, requestHeaders()),
    ).resolves.toEqual({
      ok: false,
      reason: "delivery_failed",
      message: "We could not send your feedback. Please try again.",
    })
  })

  it("caps high-cardinality rate-limit state", async () => {
    const spam = { ...validPayload, website: "spam.example" }
    for (let index = 0; index <= FEEDBACK_RATE_LIMIT_MAX_BUCKETS; index += 1) {
      await submitFeedbackWithHeaders(
        spam,
        requestHeaders(`203.0.113.${index}`),
      )
    }

    expect(feedbackRateLimitBucketCountForTests()).toBe(
      FEEDBACK_RATE_LIMIT_MAX_BUCKETS,
    )
    expect(linear.createIssue).not.toHaveBeenCalled()
  })
})
