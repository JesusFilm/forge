import XCTest
@testable import JesusFilmTV

/// Ported from `apps/tv/src/lib/parseVtt.ts`. Each case pins a behavior that
/// file earned the hard way — none of them are obvious from the WebVTT spec.
final class VttParserTests: XCTestCase {
    func testParsesBasicCues() {
        let vtt = """
        WEBVTT

        1
        00:00:01.000 --> 00:00:04.000
        Hello there

        2
        00:00:05.000 --> 00:00:08.000
        Second line
        """
        let cues = Vtt.parse(vtt)
        XCTAssertEqual(cues.count, 2)
        XCTAssertEqual(cues[0].start, 1, accuracy: 0.001)
        XCTAssertEqual(cues[0].end, 4, accuracy: 0.001)
        XCTAssertEqual(cues[0].text, "Hello there")
    }

    func testAcceptsTwoPartTimestamps() {
        let cues = Vtt.parse("WEBVTT\n\n00:01.000 --> 00:04.000\nShort form")
        XCTAssertEqual(cues.count, 1)
        XCTAssertEqual(cues[0].start, 1, accuracy: 0.001)
    }

    func testIgnoresTrailingCueSettings() {
        // Real VTTs carry positioning after the end timestamp; parsing the
        // whole remainder as a number would drop every such cue.
        let cues = Vtt.parse("WEBVTT\n\n00:00:01.000 --> 00:00:04.000 line:50% align:middle\nPositioned")
        XCTAssertEqual(cues.count, 1)
        XCTAssertEqual(cues[0].end, 4, accuracy: 0.001)
    }

    func testDropsUnparseableTimestampsRatherThanTreatingThemAsZero() {
        // A malformed timestamp coerced to 0 would flash its text at the very
        // start of every video — worse than showing nothing.
        let cues = Vtt.parse("WEBVTT\n\ngarbage --> alsogarbage\nShould not appear")
        XCTAssertTrue(cues.isEmpty)
    }

    func testDropsNonPositiveDurations() {
        let cues = Vtt.parse("WEBVTT\n\n00:00:05.000 --> 00:00:05.000\nZero length")
        XCTAssertTrue(cues.isEmpty)
    }

    func testStripsInlineTags() {
        let cues = Vtt.parse("WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n<b>Bold</b> and <v Speaker>voiced")
        XCTAssertEqual(cues.first?.text, "Bold and voiced")
    }

    func testInterleavedAnglesMatchTheReactNativeParserExactly() {
        // Verified against apps/tv/src/lib/parseVtt.ts, which uses the same
        // `<[^>]*>` pass: `[^>]*` swallows `scr<script`, so the whole
        // `<scr<script>` is one match and `ipt>` survives as literal text.
        // Asserting the "obvious" `Bold and x` here would be asserting a
        // behavior NEITHER implementation has, and would make this port look
        // broken while it is in fact faithful.
        let cues = Vtt.parse("WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n<b>Bold</b> and <scr<script>ipt>x")
        XCTAssertEqual(cues.first?.text, "Bold and ipt>x")
    }

    func testTagStrippingIsIdempotent() {
        // Why the strip loops until stable rather than running once: the
        // guarantee is that no `<...>` pair survives, whatever the input
        // shape. Re-running over the output must change nothing.
        let once = Vtt.parse("WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n<a><b>x</b></a>")
        XCTAssertEqual(once.first?.text, "x")
        XCTAssertFalse(once.first?.text.contains("<") ?? true)
    }

    func testNormalizesSmpteHourOffset() {
        // Broadcast VTTs start at 01:00:00 "program start" while the playhead
        // is media-relative — unshifted, every cue lands an hour late.
        let vtt = """
        WEBVTT

        01:00:01.000 --> 01:00:04.000
        Broadcast cue
        """
        let cues = Vtt.parse(vtt)
        XCTAssertEqual(cues.first?.start ?? -1, 1, accuracy: 0.001)
        XCTAssertEqual(cues.first?.end ?? -1, 4, accuracy: 0.001)
    }

    func testDoesNotShiftAGenuinelyLongFilm() {
        // Only whole-hour offsets are removed. A film whose first cue is at
        // 00:59:59 must not be shifted at all.
        let cues = Vtt.parse("WEBVTT\n\n00:59:59.000 --> 01:00:02.000\nLate start")
        XCTAssertEqual(cues.first?.start ?? -1, 3599, accuracy: 0.001)
    }

    func testKeepsMultiLineCueText() {
        let cues = Vtt.parse("WEBVTT\n\n00:00:01.000 --> 00:00:04.000\nLine one\nLine two")
        XCTAssertEqual(cues.first?.text, "Line one\nLine two")
    }
}

final class FindActiveCueTests: XCTestCase {
    private let cues = [
        VttCue(start: 0, end: 2, text: "a"),
        VttCue(start: 2, end: 4, text: "b"),
        VttCue(start: 10, end: 12, text: "c"),
    ]

    func testFindsTheCueCoveringTheInstant() {
        XCTAssertEqual(Vtt.findActiveCue(cues, at: 0).map(\.text), "a")
        XCTAssertEqual(Vtt.findActiveCue(cues, at: 1.9).map(\.text), "a")
        XCTAssertEqual(Vtt.findActiveCue(cues, at: 2).map(\.text), "b")
        XCTAssertEqual(Vtt.findActiveCue(cues, at: 11).map(\.text), "c")
    }

    func testEndIsExclusive() {
        // At exactly `end`, the cue is over. An inclusive end would leave the
        // last caption of a gap hanging one frame too long.
        XCTAssertNil(Vtt.findActiveCue([VttCue(start: 0, end: 2, text: "a")], at: 2))
    }

    func testReturnsNothingInGapsAndBeforeTheFirstCue() {
        XCTAssertNil(Vtt.findActiveCue(cues, at: 5))
        XCTAssertNil(Vtt.findActiveCue(cues, at: -1))
        XCTAssertNil(Vtt.findActiveCue([], at: 3))
    }

    func testFindsAnEarlierStillOpenCueWhenCuesOverlap() {
        // The binary search lands on the LAST cue started before `t`, which
        // may already have ended while a longer earlier cue is still running.
        // Without the backward walk this returns nothing and the caption
        // vanishes mid-sentence.
        let overlapping = [
            VttCue(start: 0, end: 10, text: "long"),
            VttCue(start: 1, end: 2, text: "short"),
        ]
        XCTAssertEqual(Vtt.findActiveCue(overlapping, at: 5).map(\.text), "long")
    }
}
