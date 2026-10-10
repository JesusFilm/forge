import { describe, expect, it } from "vitest"

import { draftSchema, shortInputPropsSchema, type ShortDraft } from "./schema"

const validDraft: ShortDraft = {
  templateId: "focus",
  accentColor: "#ff0000",
  captionPosition: "lower",
  captionFont: "montserrat",
  waveformStyle: "bars",
  title: "A short title",
  showCaptions: true,
  captionPages: [
    {
      text: "Jesus said",
      startMs: 0,
      durationMs: 1000,
      tokens: [
        { text: "Jesus", fromMs: 0, toMs: 400 },
        { text: " said", fromMs: 400, toMs: 1000 },
      ],
    },
  ],
}

const serverInjected = {
  clipUrl: "https://manager.example.org/api/shorts/jobs/abc/media/clip",
  fps: 30,
  clipDurationSec: 12.5,
  hasAudio: true,
}

describe("draftSchema", () => {
  it("accepts a valid operator draft", () => {
    expect(draftSchema.safeParse(validDraft).success).toBe(true)
  })

  it("accepts a draft without the optional title", () => {
    const draftWithoutTitle = { ...validDraft }
    delete draftWithoutTitle.title
    expect(draftSchema.safeParse(draftWithoutTitle).success).toBe(true)
  })

  it.each(["clipUrl", "fps", "clipDurationSec", "hasAudio"] as const)(
    "rejects payloads smuggling the server-injected field %s",
    (field) => {
      const payload = { ...validDraft, [field]: serverInjected[field] }
      expect(draftSchema.safeParse(payload).success).toBe(false)
    },
  )

  it("rejects unknown keys outright (strict)", () => {
    const payload = { ...validDraft, extra: "nope" }
    expect(draftSchema.safeParse(payload).success).toBe(false)
  })

  it("rejects non-hex accentColor values", () => {
    expect(
      draftSchema.safeParse({ ...validDraft, accentColor: "red" }).success,
    ).toBe(false)
    expect(
      draftSchema.safeParse({ ...validDraft, accentColor: "#ff000" }).success,
    ).toBe(false)
    expect(
      draftSchema.safeParse({ ...validDraft, accentColor: "#ff0000" }).success,
    ).toBe(true)
  })

  it("rejects titles longer than 80 characters", () => {
    expect(
      draftSchema.safeParse({ ...validDraft, title: "x".repeat(81) }).success,
    ).toBe(false)
  })

  it("rejects unknown template ids", () => {
    expect(
      draftSchema.safeParse({ ...validDraft, templateId: "bold" }).success,
    ).toBe(false)
  })
})

describe("shortInputPropsSchema", () => {
  const validProps = { ...validDraft, ...serverInjected }

  it("accepts draft + server-injected fields", () => {
    expect(shortInputPropsSchema.safeParse(validProps).success).toBe(true)
  })

  it.each([
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "file:///etc/passwd",
    "http://localhost:3000/clip.mp4",
    "http://127.0.0.1.evil.com:8080/clip.mp4",
    "http://127.0.0.1/clip.mp4",
    "not-a-url",
  ])("rejects scheme-smuggled or non-loopback clipUrl %s", (clipUrl) => {
    expect(
      shortInputPropsSchema.safeParse({ ...validProps, clipUrl }).success,
    ).toBe(false)
  })

  it.each([
    "https://stream.mux.com/clip.mp4",
    "http://127.0.0.1:8123/clip.mp4",
  ])("accepts allowed clipUrl %s", (clipUrl) => {
    expect(
      shortInputPropsSchema.safeParse({ ...validProps, clipUrl }).success,
    ).toBe(true)
  })

  it("rejects non-integer fps and non-positive durations", () => {
    expect(
      shortInputPropsSchema.safeParse({ ...validProps, fps: 29.97 }).success,
    ).toBe(false)
    expect(
      shortInputPropsSchema.safeParse({ ...validProps, clipDurationSec: 0 })
        .success,
    ).toBe(false)
  })
})
