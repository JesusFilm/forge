import Foundation

/// Mux URL builders — the Swift mirror of `apps/tv/src/lib/muxUrl.ts`.
///
/// The validation is the point, not decoration: playback ids arrive from CMS
/// data, and interpolating an unvalidated one would let a tainted value smuggle
/// a different host or path into a URL the player then fetches.
enum MuxURL {
    private static let playbackIDPattern = "^[a-zA-Z0-9_-]+$"

    static func isValidPlaybackID(_ id: String) -> Bool {
        id.range(of: playbackIDPattern, options: .regularExpression) != nil
    }

    /// Canonical HLS URL, or nil for a missing/unsafe id.
    static func hlsURL(playbackID: String?) -> URL? {
        guard let id = playbackID, isValidPlaybackID(id) else { return nil }
        return URL(string: "https://stream.mux.com/\(id).m3u8")
    }

    /// Poster frame. Width mirrors the RN thumbnail sizing so both apps ride
    /// the same warm Mux render cache instead of paying cold transcodes.
    static func thumbnailURL(playbackID: String?, width: Int = 640) -> URL? {
        guard let id = playbackID, isValidPlaybackID(id) else { return nil }
        return URL(string: "https://image.mux.com/\(id)/thumbnail.jpg?width=\(width)&fit_mode=smartcrop")
    }
}
