import Foundation

/// State machine for the Search tab.
///
/// Debounce, cancellation, and stale-response filtering all live here so the
/// view stays declarative. Correctness rule: a response may publish only when
/// its task is still live AND its query still matches the screen — task
/// cancellation alone can't be trusted because URLSession surfaces our own
/// cancellation as a thrown error (which must not render as a failure), and
/// query comparison alone can't be trusted because the text can return to an
/// earlier value through intermediate edits while an old response is in flight.
@MainActor
final class SearchViewModel: ObservableObject {
    enum State: Equatable {
        case idle
        case searching
        case results([SearchResultRow])
        case failed
    }

    @Published var query = "" {
        didSet {
            guard query != oldValue else { return }
            scheduleSearch()
        }
    }

    @Published private(set) var state: State = .idle

    private let client: GraphQLClient
    private var searchTask: Task<Void, Never>?

    /// The trimmed query the in-flight task or on-screen results answer for.
    /// Lets a whitespace-only edit (same effective query) skip a refetch.
    private var activeQuery: String?

    /// Long enough to swallow a remote-keyboard typing burst, short enough
    /// that results still feel attached to the input.
    private static let debounce: Duration = .milliseconds(350)

    init(client: GraphQLClient = GraphQLClient()) {
        self.client = client
    }

    /// Tab became visible again. deactivate() may have cancelled a search
    /// mid-flight; a stranded `.searching` would otherwise spin forever.
    func activate() {
        if state == .searching { retry() }
    }

    /// Tab left the screen — stop paying for a request nobody will see.
    func deactivate() {
        searchTask?.cancel()
        searchTask = nil
    }

    /// Immediate re-run of the current query; no debounce because the user
    /// explicitly asked (failure-state Retry, or re-arming on activate).
    func retry() {
        searchTask?.cancel()
        let q = trimmedQuery
        guard !q.isEmpty else {
            activeQuery = nil
            state = .idle
            return
        }
        activeQuery = q
        searchTask = Task { [weak self] in
            await self?.search(for: q)
        }
    }

    private var trimmedQuery: String {
        query.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func scheduleSearch() {
        let q = trimmedQuery
        guard !q.isEmpty else {
            searchTask?.cancel()
            searchTask = nil
            activeQuery = nil
            state = .idle
            return
        }
        // Same effective query already in flight or on screen — nothing to do,
        // unless it failed, where a fresh keystroke deserves a fresh attempt.
        if q == activeQuery, state != .failed { return }
        searchTask?.cancel()
        activeQuery = q
        searchTask = Task { [weak self] in
            // A cancelled debounce means a newer keystroke owns the screen.
            guard (try? await Task.sleep(for: Self.debounce)) != nil else { return }
            await self?.search(for: q)
        }
    }

    private func search(for q: String) async {
        guard isCurrent(q) else { return }
        state = .searching
        do {
            let data = try await client.fetch(
                WatchSearchData.self,
                query: Queries.watchSearch,
                variables: ["input": ["query": q]]
            )
            guard isCurrent(q) else { return }
            state = .results(SearchProjection.project(data))
        } catch {
            // Also reached by our own cancelled URLSession call; isCurrent
            // keeps that from flashing a phantom failure over newer results.
            guard isCurrent(q) else { return }
            state = .failed
        }
    }

    private func isCurrent(_ q: String) -> Bool {
        !Task.isCancelled && q == trimmedQuery
    }
}
