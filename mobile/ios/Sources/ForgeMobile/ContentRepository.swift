public struct MobileContentItem {
  public let id: String
  public let slug: String
  public let locale: String
  public let title: String
  public let body: String
  public let state: String
}

public protocol ContentClient {
  func getContent(locale: String, slug: String) async throws -> MobileContentItem?
}

// Adapter target: implement ContentClient (e.g. from packages/client GraphQL)
public final class ContentRepository {
  private let client: ContentClient

  public init(client: ContentClient) {
    self.client = client
  }

  public func fetchHome(locale: String) async throws -> MobileContentItem? {
    try await client.getContent(locale: locale, slug: "home")
  }
}
