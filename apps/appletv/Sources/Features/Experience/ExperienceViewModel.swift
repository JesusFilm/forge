import Foundation

/// Experience screen state: one query, one projection, four renderable states.
///
/// `empty` is separate from `failed` on purpose — an Experience that resolves
/// with no drawable block is an authoring problem, and telling the viewer
/// "something went wrong" would send them to retry a request that already
/// succeeded.
@MainActor
final class ExperienceViewModel: ObservableObject {
    enum State: Equatable {
        case loading
        case loaded(title: String?, blocks: [ExperienceBlock])
        case empty
        case failed
    }

    @Published private(set) var state: State = .loading

    private let client: GraphQLClient
    /// The slug the current `state` answers for, so a re-entry to an
    /// already-loaded screen doesn't blank it back to a spinner.
    private var loadedSlug: String?

    init(client: GraphQLClient = GraphQLClient()) {
        self.client = client
    }

    func load(slug: String) async {
        if case .loaded = state, loadedSlug == slug { return }
        state = .loading
        do {
            let data = try await client.fetch(
                ExperienceData.self,
                query: ExperienceQueries.experienceBySlug,
                variables: ["locale": Config.contentLocale, "slug": slug]
            )
            let blocks = ExperienceProjection.project(data)
            loadedSlug = slug
            state = blocks.isEmpty
                ? .empty
                : .loaded(title: ExperienceProjection.title(data), blocks: blocks)
        } catch is CancellationError {
            // The view left the screen and `.task` cancelled us; the next
            // appearance restarts the load, so `.failed` here would be a lie.
        } catch let error as URLError where error.code == .cancelled {
            // URLSession reports task cancellation as URLError, not
            // CancellationError — same situation, same non-answer.
        } catch {
            loadedSlug = nil
            state = .failed
        }
    }

    /// Explicit viewer-initiated retry: always refetches, even from `.loaded`.
    func reload(slug: String) async {
        loadedSlug = nil
        state = .loading
        await load(slug: slug)
    }
}
