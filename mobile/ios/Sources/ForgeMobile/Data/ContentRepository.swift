public struct MobileContentItem: Sendable {
  public let id: String
  public let slug: String
  public let locale: String
  public let title: String
  public let body: String
  public let state: String
}

/// Experience with sections for server-driven UI. Returned by fetchExperience.
public struct ExperienceContent: Sendable {
  public let id: String
  public let slug: String
  public let locale: String
  public let title: String
  public let body: String
  public let state: String
  public let sections: [ExperienceSection]

  public init(
    id: String,
    slug: String,
    locale: String,
    title: String,
    body: String,
    state: String,
    sections: [ExperienceSection]
  ) {
    self.id = id
    self.slug = slug
    self.locale = locale
    self.title = title
    self.body = body
    self.state = state
    self.sections = sections
  }
}

public protocol ContentClient {
  func getContent(locale: String, slug: String) async throws -> MobileContentItem?
  /// Fetches full experience with sections for server-driven rendering.
  func getExperience(locale: String, slug: String) async throws -> ExperienceContent?
}

// Adapter target: implement ContentClient (e.g. from packages/graphql GraphQL)
public final class ContentRepository {
  private let client: ContentClient

  public init(client: ContentClient) {
    self.client = client
  }

  public func fetchHome(locale: String) async throws -> MobileContentItem? {
    try await client.getContent(locale: locale, slug: "home")
  }

  /// Fetches experience by locale and slug with sections for section renderers.
  public func fetchExperience(locale: String, slug: String) async throws -> ExperienceContent? {
    try await client.getExperience(locale: locale, slug: slug)
  }
}
