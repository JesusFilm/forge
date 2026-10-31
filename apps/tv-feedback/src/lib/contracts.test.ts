import { describe, expect, it } from "vitest"

import {
  readQrContext,
  submissionSchema,
  uploadReservationSchema,
} from "./contracts"

describe("untrusted TV context", () => {
  it("drops unexpected QR values instead of trusting them", () => {
    const input = new URLSearchParams({
      platform: "desktop",
      player: "evil",
      appVersion: "1.0<script>",
      screen: "home",
      secret: "never-copy-this",
    })
    expect(readQrContext(input)).toEqual({
      platform: "not-sure",
      screen: "home",
    })
  })

  it("retains bounded film context from a player QR", () => {
    const input = new URLSearchParams({
      platform: "apple-tv",
      player: "native-a",
      screen: "player",
      filmTitle: "JESUS",
      timestamp: "1:02:03",
    })
    expect(readQrContext(input)).toMatchObject({
      platform: "apple-tv",
      player: "native-a",
      screen: "player",
      filmTitle: "JESUS",
      timestamp: "1:02:03",
    })
    input.set("timestamp", "1:02:03<script>")
    expect(readQrContext(input).timestamp).toBeUndefined()
  })
})

describe("report contracts", () => {
  it("rejects oversize and zero-byte uploads", () => {
    expect(
      uploadReservationSchema.safeParse({
        name: "a.jpg",
        type: "image/jpeg",
        size: 0,
      }).success,
    ).toBe(false)
    expect(
      uploadReservationSchema.safeParse({
        name: "a.jpg",
        type: "image/jpeg",
        size: 11 * 1024 * 1024,
      }).success,
    ).toBe(false)
  })

  it("rejects unrecognized fields and duplicate-invalid file IDs", () => {
    const base = {
      category: "problem",
      message: "Playback failed after changing language",
      tvContext: { platform: "apple-tv" },
      consentPhoneContext: false,
      uploadIds: ["not-a-uuid"],
      idempotencyKey: "7b8d9d70-4b4a-480c-82c0-635de8d65029",
      turnstileToken: "test",
    }
    expect(submissionSchema.safeParse(base).success).toBe(false)
    expect(
      submissionSchema.safeParse({ ...base, uploadIds: [], admin: true })
        .success,
    ).toBe(false)
  })

  it("requires a description for photo and advanced reports", () => {
    const base = {
      category: "problem",
      message: "",
      tvContext: { platform: "apple-tv" },
      consentPhoneContext: false,
      uploadIds: ["7b8d9d70-4b4a-480c-82c0-635de8d65029"],
      idempotencyKey: "8b8d9d70-4b4a-480c-82c0-635de8d65029",
      turnstileToken: "test",
    }
    expect(submissionSchema.safeParse({ ...base, flow: "photo" }).success).toBe(
      false,
    )
    expect(
      submissionSchema.safeParse({
        ...base,
        flow: "photo",
        message: "Playback failed",
      }).success,
    ).toBe(true)
    expect(submissionSchema.safeParse(base).success).toBe(false)
    expect(
      submissionSchema.safeParse({ ...base, flow: "photo", uploadIds: [] })
        .success,
    ).toBe(false)
    expect(
      submissionSchema.safeParse({
        ...base,
        flow: "photo",
        uploadIds: [...base.uploadIds, ...base.uploadIds],
      }).success,
    ).toBe(false)
  })
})
