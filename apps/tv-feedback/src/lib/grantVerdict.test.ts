import { createHash } from "node:crypto"
import { describe, expect, it } from "vitest"

import { acceptsIntegrityVerdict, type IntegrityPayload } from "./grantVerdict"

const now = 1_790_000_000_000
const canonical = "feedback-qr-v1\nchallenge\nnonce"
const policy = {
  packageName: "org.jesusfilm.tv",
  certs: ["approved-signing-cert"],
  versions: ["5"],
}
const request = { packageName: "org.jesusfilm.tv", versionCode: 5 }
const valid: IntegrityPayload = {
  requestDetails: {
    requestPackageName: request.packageName,
    requestHash: createHash("sha256").update(canonical).digest("base64url"),
    timestampMillis: String(now - 1000),
  },
  appIntegrity: {
    appRecognitionVerdict: "PLAY_RECOGNIZED",
    packageName: request.packageName,
    certificateSha256Digest: ["approved-signing-cert"],
    versionCode: "5",
  },
  accountDetails: { appLicensingVerdict: "LICENSED" },
  deviceIntegrity: { deviceRecognitionVerdict: ["MEETS_DEVICE_INTEGRITY"] },
}

describe("Play Integrity admission policy", () => {
  it("requires all signed app, licensing, device, and request-binding signals", () => {
    expect(
      acceptsIntegrityVerdict(valid, request, canonical, policy, now),
    ).toBe(true)
    expect(
      acceptsIntegrityVerdict(
        {
          ...valid,
          requestDetails: { ...valid.requestDetails, requestHash: "wrong" },
        },
        request,
        canonical,
        policy,
        now,
      ),
    ).toBe(false)
    expect(
      acceptsIntegrityVerdict(
        {
          ...valid,
          appIntegrity: {
            ...valid.appIntegrity,
            certificateSha256Digest: ["upload-key"],
          },
        },
        request,
        canonical,
        policy,
        now,
      ),
    ).toBe(false)
    expect(
      acceptsIntegrityVerdict(
        { ...valid, accountDetails: { appLicensingVerdict: "UNLICENSED" } },
        request,
        canonical,
        policy,
        now,
      ),
    ).toBe(false)
    expect(
      acceptsIntegrityVerdict(
        { ...valid, deviceIntegrity: { deviceRecognitionVerdict: [] } },
        request,
        canonical,
        policy,
        now,
      ),
    ).toBe(false)
  })

  it("rejects stale verdicts and unapproved versions", () => {
    expect(
      acceptsIntegrityVerdict(valid, request, canonical, policy, now + 121_000),
    ).toBe(false)
    expect(
      acceptsIntegrityVerdict(
        valid,
        { ...request, versionCode: 6 },
        canonical,
        policy,
        now,
      ),
    ).toBe(false)
  })
})
