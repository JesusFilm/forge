import Foundation

/// Series screen state. One query, one projection — the episode rail is the
/// whole point of the screen, so nothing here is lazy or deferred.
@MainActor
final class SeriesViewModel: ObservableObject {
    enum State: Equatable {
        case loading
        case loaded(SeriesDetail)
        case failed
    }

    @Published private(set) var state: State = .loading

    private let repository: SeriesRepository

    init(repository: SeriesRepository = SeriesRepository()) {
        self.repository = repository
    }

    func load(slug: String) async {
        state = .loading
        do {
            guard let series = try await repository.series(slug: slug) else {
                // `videoBySlug` resolved to null — an unknown or unpublished
                // slug. Same surface as a transport failure on purpose: both
                // leave the viewer on a screen with a Retry, which is the only
                // action either case supports.
                state = .failed
                return
            }
            state = .loaded(series)
        } catch is CancellationError {
            // A cancelled task is a navigation away, not a failure — painting
            // an error over a screen the viewer already left is worse than
            // leaving the last state alone.
        } catch let error as URLError where error.code == .cancelled {
            // URLSession surfaces task cancellation as URLError, NOT
            // CancellationError — same situation, same non-answer. Matching
            // only `CancellationError` here would let the dominant
            // cancellation path fall through to `.failed`, which is the
            // opposite of what the clause above intends.
        } catch {
            state = .failed
        }
    }
}
