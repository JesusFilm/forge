/* eslint-disable @typescript-eslint/no-require-imports */
/* global describe, expect, it, require */
const fs = require("fs")
const path = require("path")

const SWIFT_VIEW = path.resolve(
  __dirname,
  "../../modules/native-swift-player/ios/NativeSwiftPlayerView.swift",
)
const SWIFT_VTT_PARSER = path.resolve(
  __dirname,
  "../../modules/native-swift-player/ios/NativeVttParser.swift",
)
const SWIFT_STORYBOARD = path.resolve(
  __dirname,
  "../../modules/native-swift-player/ios/NativeStoryboard.swift",
)
const REACT_VIEW = path.resolve(__dirname, "./NativeSwiftPlayer.tsx")

describe("native Swift player feature parity wiring", () => {
  const swift = fs.readFileSync(SWIFT_VIEW, "utf8")
  const swiftVtt = fs.readFileSync(SWIFT_VTT_PARSER, "utf8")
  const swiftStoryboard = fs.readFileSync(SWIFT_STORYBOARD, "utf8")
  const react = fs.readFileSync(REACT_VIEW, "utf8")

  it("preserves position and playback state across language source changes", () => {
    expect(swift).toContain(
      "replaceSource(preservingPosition: loadedSourceUrl != nil)",
    )
    expect(swift).toContain("else if !sourceSeekPending, current.isFinite")
    expect(swift).toContain("pendingSeekSeconds = current")
    expect(swift).toContain("pendingSeekSeconds = startAtSeconds")
    expect(swift).toContain(
      "shouldAutoplay = player.rate > 0 || loadedSourceUrl == nil",
    )
    expect(swift).toContain(
      "if finished, self.shouldAutoplay { self.player.play() }",
    )
  })

  it("connects the native language menu to the active video dub", () => {
    expect(swift).toContain('UIAction(title: "Language"')
    expect(swift).toContain("self?.presentLanguages()")
    expect(swift).toContain("audioOptions.sorted")
    expect(swift).toContain("localizedCaseInsensitiveCompare")
    expect(swift).toContain('self?.onAudioChange(["id": id])')
    expect(react).toContain("session.setActiveVariantIndex(index)")
  })

  it("keeps separate native search and dictation entry points for audio and subtitles", () => {
    expect(swift).toContain("UISearchResultsUpdating")
    expect(swift).toContain("UISearchController(searchResultsController: list)")
    expect(swift).toContain('searchPlaceholder: "Search audio languages"')
    expect(swift).toContain('searchPlaceholder: "Search subtitle languages"')
    expect(swift).toContain("UISearchContainerViewController")
    expect(swift).toContain("searchController.isActive = true")
    expect(swift).toContain("localizedCaseInsensitiveContains(query)")
    expect(swift).toContain("visibleRows = rows.filter")
  })

  it("connects subtitle selection, VTT loading, and subtitle-off", () => {
    expect(swift).toContain('UIAction(title: "Subtitles"')
    expect(swift).toContain('id: "__off__"')
    expect(swift).toContain("subtitleOptions.sorted")
    expect(swift).toContain("rows.append(contentsOf: sortedOptions.map")
    expect(swift).toContain("self.selectedSubtitleId = nil")
    expect(swift).toContain("self.selectedSubtitleUrl = nil")
    expect(swift).toContain("self.selectedSubtitleId = option.id")
    expect(swift).toContain("self.selectedSubtitleUrl = option.url")
    expect(swift).toContain('self.onSubtitleChange(["id": option.id])')
    expect(swift).toContain("loadSubtitles()")
    expect(swift).toContain("request.timeoutInterval = 8")
    expect(swift).toContain("(200..<300).contains(http.statusCode)")
    expect(swift).toContain("NativeVttParser.parse(text)")
    expect(swift).toContain(
      'subtitleLabel.accessibilityIdentifier = "NativeSubtitleText"',
    )
    expect(swiftVtt).toContain(
      "trimmingCharacters(in: .whitespacesAndNewlines)",
    )
    expect(swiftVtt).toContain(".split(whereSeparator: \\.isWhitespace)")
    expect(swiftVtt).toContain("normalizeSmpteOffset")
    expect(swiftVtt).toContain("end > start")
    expect(react).toContain("session.setSubtitleEnabled(false)")
    expect(react).toContain("session.setActiveSubtitleSlug(id)")
    expect(react).toContain("session.setSubtitleEnabled(true)")
  })

  it("loads Mux storyboard thumbnails into the displayed native scrubber", () => {
    expect(react).toContain("buildMuxStoryboardUrl")
    expect(react).toContain("storyboardUrl={storyboardUrl ?? undefined}")
    expect(swift).toContain('accessibilityIdentifier = "NativeScrubPreview"')
    expect(swift).toContain(
      "scrubPreviewView.bottomAnchor.constraint(equalTo: overlay.bottomAnchor, constant: -190)",
    )
    expect(swift).toContain("NativeStoryboardParser.parse(data)")
    expect(swift).toContain("showScrubPreview(at: position)")
    expect(swift).toContain("cropStoryboardTile(")
    expect(swift).toContain("hideScrubPreview()")
    expect(swift).toContain("suppressScrubPreviewUntil")
    expect(swift).not.toContain("ignoreNextTimeJump")
    expect(swift).not.toContain("guard self.player.rate == 0")
    expect(swift).not.toContain(
      "if player.rate > 0 {\n      hideScrubPreview()",
    )
    expect(swiftStoryboard).toContain('url.host == "image.mux.com"')
    expect(swiftStoryboard).toContain("static func tileIndex")
  })

  it("connects Explore moments and questions to native playback", () => {
    expect(swift).toContain('UIAction(title: "Explore"')
    expect(swift).toContain('NativeListRow(id: "moment:')
    expect(swift).toContain('NativeListRow(id: "question:')
    expect(swift).toContain("self.player.seek(to: target")
    expect(react).toContain("loadVideoMoments")
    expect(react).toContain("session.video?.studyQuestions")
  })

  it("offers Up Next and forwards the chosen slug", () => {
    expect(swift).toContain('title: "Up Next"')
    expect(swift).toContain('title: "Play Now"')
    expect(swift).toContain('title: "Not Now"')
    expect(swift).toContain('self?.onPlayNext(["slug": slug])')
    expect(swift).toContain(
      "DispatchQueue.main.asyncAfter(deadline: .now() + 10)",
    )
    expect(react).toContain("onPlayNext={(event) =>")
    expect(react).toContain("event.nativeEvent.slug")
  })

  it("reports native position updates for resume and watch-event capture", () => {
    expect(swift).toContain('onPlaybackPosition(["positionSeconds": position')
    expect(react).toContain("evaluateMeaningfulPlayback(")
    expect(react).toContain("onPlaybackPositionRef.current?.(normalized)")
    expect(react).toContain("onMeaningfulPlaybackRef.current?.(normalized)")
  })
})
