import SwiftUI
import ForgeMobile

@main
struct ForgeApp: App {
  private static let graphQLURL = URL(string: "http://localhost:1337/graphql")!

  var body: some Scene {
    WindowGroup {
      ForgeRootView(contentRepository: makeContentRepository())
    }
  }

  private func makeContentRepository() -> ContentRepository {
    let token = ProcessInfo.processInfo.environment["STRAPI_FULL_ACCESS_TOKEN"]
      .flatMap { $0.isEmpty ? nil : $0 }
      ?? kStrapiFullAccessToken
    let client = GraphQLContentClient(endpoint: Self.graphQLURL, bearerToken: token)
    return ContentRepository(client: client)
  }
}
