import Foundation

/// Drives the Home screen: one query, one projection, three renderable states.
@MainActor
final class HomeViewModel: ObservableObject {
    enum State {
        case loading
        case loaded(HomeModel)
        case failed
    }

    @Published private(set) var state: State = .loading

    /// Idempotent per rendered result: tab re-entry re-runs the view's `.task`,
    /// and blanking an already-rendered Home back to a spinner would make tab
    /// switching feel broken. Retry from `.failed` still refetches.
    func load() async {
        if case .loaded = state { return }
        state = .loading
        do {
            let data = try await GraphQLClient().fetch(
                WatchHomeData.self,
                query: Queries.watchHomeExperience,
                variables: [
                    "locale": Config.contentLocale,
                    "slug": Config.homeExperienceSlug,
                ]
            )
            state = .loaded(HomeProjection.project(data))
        } catch is CancellationError {
            // `.task` cancelled us because the view left the screen; the next
            // appearance restarts the load, so `.failed` here would be a lie.
        } catch let error as URLError where error.code == .cancelled {
            // URLSession surfaces task cancellation as URLError, not
            // CancellationError — same situation, same non-answer.
        } catch {
            state = .failed
        }
    }
}
