import Foundation
import ForgeMobile

/// Builds the app's `ContentRepository` using GraphQL endpoint from Info.plist and optional bearer token.
enum AppContentRepositoryFactory {
  /// GraphQL endpoint from Info.plist (GraphQLEndpoint). Debug falls back to localhost; Release requires a valid value.
  private static var graphQLURL: URL {
    let key = "GraphQLEndpoint"
    let raw = Bundle.main.object(forInfoDictionaryKey: key) as? String
    let trimmed = raw?.trimmingCharacters(in: .whitespacesAndNewlines)
    if let endpointString = trimmed, !endpointString.isEmpty, let url = URL(string: endpointString) {
      return url
    }
    #if DEBUG
    return URL(string: "http://localhost:1337/graphql")!
    #else
    fatalError("\(key) must be set in Info-Release.plist for production builds.")
    #endif
  }

  static func makeContentRepository() -> ContentRepository {
    let token = ProcessInfo.processInfo.environment["STRAPI_FULL_ACCESS_TOKEN"]
      .flatMap { $0.isEmpty ? nil : $0 }
      ?? kStrapiFullAccessToken
    let client = GraphQLContentClient(endpoint: graphQLURL, bearerToken: token)
    return ContentRepository(client: client)
  }
}
