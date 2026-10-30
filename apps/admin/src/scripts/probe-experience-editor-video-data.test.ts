import { describe, expect, it } from "vitest"
import {
  compareReports,
  countMarker,
  isSuccessfulStatus,
  parseCollectionExpansionEvidence,
  parseOptions,
  validateOptions,
} from "./probe-experience-editor-video-data"

describe("experience editor video data probe", () => {
  it("counts direct and escaped Dub markers independently", () => {
    expect(
      countMarker(
        '{"streamUrl":"one"}\\n{\\"streamUrl\\":\\"two\\"}{\\"streamUrl\\":\\"three\\"}',
        '"streamUrl"',
      ),
    ).toBe(3)
  })

  it("handles an empty marker without looping", () => {
    expect(countMarker("response", "")).toBe(0)
  })

  it("rejects redirects and client errors as measurement successes", () => {
    expect(isSuccessfulStatus(200)).toBe(true)
    expect(isSuccessfulStatus(204)).toBe(true)
    expect(isSuccessfulStatus(302)).toBe(false)
    expect(isSuccessfulStatus(401)).toBe(false)
    expect(isSuccessfulStatus(404)).toBe(false)
    expect(isSuccessfulStatus(429)).toBe(false)
  })

  it("requires complete unique collection expansion evidence", () => {
    const digest = "a".repeat(64)
    expect(
      parseCollectionExpansionEvidence(
        JSON.stringify({
          returnedChildren: 124,
          uniqueChildren: 124,
          orderedDigest: digest,
        }),
        124,
      ),
    ).toMatchObject({ complete: true, orderedDigest: digest })
    expect(
      parseCollectionExpansionEvidence(
        JSON.stringify({
          returnedChildren: 100,
          uniqueChildren: 100,
          orderedDigest: digest,
        }),
        124,
      ).complete,
    ).toBe(false)
  })

  it("does not compare reports from different workloads", () => {
    const common = {
      fixture: {
        label: "incident",
        referencedVideos: 125,
        activeDubs: 143_030,
        largestCollectionChildren: 124,
      },
      measurement: {
        concurrency: [1, 4],
        dubMarker: '"streamUrl"',
        roundsPerProfile: 30,
        warmups: 5,
      },
      target: {
        environment: "local",
        editorFingerprint: "editor",
        publicFingerprint: "public",
      },
      hardware: {
        cpuCount: 8,
        cpuModel: "fixture-cpu",
        platform: "linux",
        release: "fixture-kernel",
        totalMemoryBytes: 1_000,
      },
      profiles: [
        {
          summary: { serializedDubRecords: { median: 100 } },
          rssPeakDeltaBytes: 100,
        },
      ],
      publicControl: { summary: { elapsedMs: { p95: 10 } } },
    }
    const comparison = compareReports(common, {
      ...common,
      measurement: { ...common.measurement, warmups: 0 },
    })
    expect(comparison).toMatchObject({
      comparable: false,
      mismatchFields: ["measurement.warmups"],
      initialSerializedDubReductionPercent: null,
      peakRssDeltaReductionPercent: null,
    })

    const cycleMismatch = compareReports(common, {
      ...common,
      measurement: { ...common.measurement, cycles: 20 },
    })
    expect(cycleMismatch).toMatchObject({
      comparable: false,
      mismatchFields: ["measurement.cycles"],
    })
  })

  it("binds authenticated staging and save requests to one approved origin", () => {
    const staging = parseOptions([
      "--environment",
      "staging",
      "--confirm-non-production",
      "--approved-origin",
      "https://admin.staging.example",
      "--editor-url",
      "https://admin.staging.example/dashboard/experiences/one",
      "--cookie-file",
      "/tmp/admin-cookie",
      "--fixture",
      "incident",
      "--revision",
      "candidate",
      "--referenced-videos",
      "125",
      "--active-dubs",
      "143030",
      "--largest-collection-children",
      "124",
    ])
    expect(() => validateOptions(staging)).not.toThrow()
    expect(() =>
      validateOptions({
        ...staging,
        saveBodyPath: "/tmp/save-body",
        saveUrl: new URL("https://attacker.example/action"),
      }),
    ).toThrow("authenticated save target must match the editor origin")
    expect(() =>
      validateOptions({
        ...staging,
        approvedOrigin: new URL("https://admin.jesusfilm.org"),
        editorUrl: new URL(
          "https://admin.jesusfilm.org/dashboard/experiences/one",
        ),
      }),
    ).toThrow("authenticated staging origin must be HTTPS and non-production")
  })
})
