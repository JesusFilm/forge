import Foundation

/// ViewModel for the watch/home screen. Owns repository access and exposes loading state and content.
@MainActor
@Observable
public final class WatchHomeViewModel {
  public private(set) var isLoading = false
  public private(set) var homeItem: MobileContentItem?
  public private(set) var homeError: String?
  public private(set) var experienceContent: ExperienceContent?

  private let repository: ContentRepository

  public init(repository: ContentRepository) {
    self.repository = repository
  }

  /// Loads home content for the given locale.
  public func load(locale: String = "en") async {
    isLoading = true
    homeError = nil
    homeItem = nil
    defer { isLoading = false }
    do {
      let item = try await repository.fetchHome(locale: locale)
      homeItem = item
    } catch {
      homeError = error.localizedDescription
    }
  }

  /// Fetches a full experience by slug and locale, exposing parsed sections.
  public func loadExperience(slug: String, locale: String = "en") async {
    isLoading = true
    homeError = nil
    experienceContent = nil
    defer { isLoading = false }
    do {
      experienceContent = try await repository.fetchExperience(locale: locale, slug: slug)
    } catch {
      homeError = error.localizedDescription
    }
  }
}
