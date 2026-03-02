import Foundation

/// ViewModel for the watch/home screen. Owns repository access and exposes loading state and content.
@Observable
public final class WatchHomeViewModel {
  public private(set) var isLoading = false
  public private(set) var homeItem: MobileContentItem?
  public private(set) var homeError: String?

  private let repository: ContentRepository

  public init(repository: ContentRepository) {
    self.repository = repository
  }

  /// Loads home content for the given locale. Updates `isLoading`, `homeItem`, and `homeError`.
  public func load(locale: String = "en") async {
    isLoading = true
    homeError = nil
    homeItem = nil
    defer { isLoading = false }
    do {
      let item = try await repository.fetchHome(locale: locale)
      homeItem = item
      homeError = nil
    } catch {
      homeItem = nil
      homeError = error.localizedDescription
    }
  }
}
