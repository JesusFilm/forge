import XCTest
@testable import JesusFilmTV

final class MuxURLTests: XCTestCase {
    func testBuildsCanonicalHlsURL() {
        XCTAssertEqual(
            MuxURL.hlsURL(playbackID: "abc-123_XYZ")?.absoluteString,
            "https://stream.mux.com/abc-123_XYZ.m3u8"
        )
    }

    func testRejectsTaintedPlaybackID() {
        // The validation is load-bearing: a tainted id must not smuggle a
        // different host or path into a URL the player fetches.
        XCTAssertNil(MuxURL.hlsURL(playbackID: "abc/../evil"))
        XCTAssertNil(MuxURL.hlsURL(playbackID: "a?b"))
        XCTAssertNil(MuxURL.hlsURL(playbackID: ""))
        XCTAssertNil(MuxURL.hlsURL(playbackID: nil))
    }
}
