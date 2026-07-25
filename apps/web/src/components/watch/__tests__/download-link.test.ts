import { describe, expect, it } from "vitest"

import { buildDownloadFilename } from "@/components/watch/download-link"

describe("buildDownloadFilename", () => {
  it("uses title, audio language, ISO code, and rendition height", () => {
    expect(
      buildDownloadFilename({
        videoTitle: "Jesus Film",
        languageName: "English",
        languageCode: "eng",
        renditionHeight: 360,
        tier: "low",
      }),
    ).toBe("Jesus-Film_English_eng_360p.mp4")
  })

  it("falls back to a stable language slug when ISO is missing", () => {
    expect(
      buildDownloadFilename({
        videoTitle: "Jesus Film",
        languageName: "Karo",
        languageSlug: "karo-ethiopia",
        renditionHeight: 480,
        tier: "high",
      }),
    ).toBe("Jesus-Film_Karo_karo-ethiopia_480p.mp4")
  })

  it("falls back to the tier label when height is missing", () => {
    expect(
      buildDownloadFilename({
        videoTitle: "Jesus Film",
        languageName: "English",
        languageCode: "eng",
        renditionHeight: null,
        tier: "low",
      }),
    ).toBe("Jesus-Film_English_eng_low.mp4")
  })

  it("uses the video slug when the localized title has no ASCII-safe words", () => {
    expect(
      buildDownloadFilename({
        videoTitle: "প্লট (পর্ব ৫)",
        videoSlug: "bp-plot-episode-5",
        languageName: "Bangla",
        languageCode: "ben",
        renditionHeight: 270,
        tier: "low",
      }),
    ).toBe("bp-plot-episode-5_Bangla_ben_270p.mp4")
  })

  it("uses the video slug when the localized title only contributes digits", () => {
    expect(
      buildDownloadFilename({
        videoTitle: "Плот (серия 5)",
        videoSlug: "bp-plot-episode-5",
        languageName: "Russian",
        languageCode: "rus",
        renditionHeight: 270,
        tier: "low",
      }),
    ).toBe("bp-plot-episode-5_Russian_rus_270p.mp4")
  })

  it("distinguishes same-name languages by code", () => {
    const common = {
      videoTitle: "Jesus Film",
      languageName: "Karo",
      renditionHeight: 360,
      tier: "low" as const,
    }

    expect(buildDownloadFilename({ ...common, languageCode: "kxh" })).toBe(
      "Jesus-Film_Karo_kxh_360p.mp4",
    )
    expect(buildDownloadFilename({ ...common, languageCode: "arr" })).toBe(
      "Jesus-Film_Karo_arr_360p.mp4",
    )
  })

  it("normalizes punctuation and non-ASCII characters to safe symbols", () => {
    expect(
      buildDownloadFilename({
        videoTitle: "L'Évangile: Jésus/Marie",
        languageName: "Français & Côte d’Ivoire",
        languageCode: "fra",
        renditionHeight: 720,
        tier: "high",
      }),
    ).toBe("L-Evangile-Jesus-Marie_Francais-Cote-d-Ivoire_fra_720p.mp4")
  })

  it("removes brackets, control characters, trailing dots, and trailing spaces", () => {
    const filename = buildDownloadFilename({
      videoTitle: "Jesus [Film].   ",
      languageName: "English\t(US)\n",
      languageCode: "e\rng",
      renditionHeight: 360,
      tier: "low",
    })

    expect(filename).toBe("Jesus-Film_English-US_e-ng_360p.mp4")
    expect(filename).toMatch(/^[A-Za-z0-9_.-]+$/)
    expect(filename.replace(/\.mp4$/, "")).not.toMatch(/[. ]$/)
  })

  it("bounds generated filenames while preserving the mp4 extension", () => {
    const filename = buildDownloadFilename({
      videoTitle: "Jesus Film ".repeat(40),
      languageName: "English",
      languageCode: "eng",
      renditionHeight: 360,
      tier: "low",
    })

    expect(filename.length).toBeLessThanOrEqual(200)
    expect(filename).toMatch(/\.mp4$/)
    expect(filename).toMatch(/^[A-Za-z0-9_.-]+$/)
  })

  it("keeps the filename non-empty when metadata is missing", () => {
    expect(buildDownloadFilename({ tier: null })).toBe(
      "Video_Language_unknown_unknown.mp4",
    )
  })
})
