import Foundation

/// Watch-side data access. Owns the two-query split (see `VideoQueries`).
struct VideoRepository {
    var client = GraphQLClient()

    /// Budget for the per-dub media fetch. RN uses 8s and REJECTS on expiry
    /// rather than hanging — a wedged admin must surface as an error the
    /// viewer can retry, not as a subtitle menu that never opens.
    static let dubMediaTimeout: TimeInterval = 8

    func video(slug: String) async throws -> WatchVideo? {
        let data = try await client.fetch(
            VideoBySlugData.self,
            query: VideoQueries.videoBySlug,
            variables: ["slug": slug, "locale": Config.contentLocale]
        )
        return WatchProjection.project(data)
    }

    /// Subtitles for ONE dub. Never call this for every dub — that is the
    /// 9.5MB/13s mistake the split exists to prevent.
    func subtitles(dubID: String) async throws -> [Subtitle] {
        let data = try await withTimeout(seconds: Self.dubMediaTimeout) {
            try await client.fetch(
                VideoDubData.self,
                query: VideoQueries.videoDub,
                variables: ["id": dubID]
            )
        }
        return WatchProjection.projectSubtitles(data)
    }
}

struct TimeoutError: Error {}

/// Race an operation against a deadline. The losing branch is cancelled, so a
/// slow request stops consuming the network once its answer can no longer be
/// used.
func withTimeout<T: Sendable>(
    seconds: TimeInterval,
    operation: @escaping @Sendable () async throws -> T
) async throws -> T {
    try await withThrowingTaskGroup(of: T.self) { group in
        group.addTask { try await operation() }
        group.addTask {
            try await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
            throw TimeoutError()
        }
        guard let first = try await group.next() else { throw TimeoutError() }
        group.cancelAll()
        return first
    }
}
