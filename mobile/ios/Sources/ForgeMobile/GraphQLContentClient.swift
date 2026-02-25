import Apollo
import ApolloAPI
import Foundation

/// GraphQL client that implements `ContentClient` by calling the CMS GetWatchExperience query.
/// Configure with endpoint URL and optional bearer token (e.g. for dev/stage/prod).
public final class GraphQLContentClient: ContentClient {
  private let apollo: ApolloClient

  /// Use this initializer to inject an `ApolloClient` (e.g. for tests with a mock).
  public init(apollo: ApolloClient) {
    self.apollo = apollo
  }

  /// Creates a client that talks to the given endpoint with optional bearer auth.
  public convenience init(endpoint: URL, bearerToken: String? = nil) {
    let store = ApolloStore(cache: InMemoryNormalizedCache())
    let headers: [String: String] = if let token = bearerToken {
      ["Authorization": "Bearer \(token)"]
    } else {
      [:]
    }
    let transport = RequestChainNetworkTransport(
      interceptorProvider: DefaultInterceptorProvider(store: store),
      endpointURL: endpoint,
      additionalHeaders: headers
    )
    let apollo = ApolloClient(networkTransport: transport, store: store)
    self.init(apollo: apollo)
  }

  public func getContent(locale: String, slug: String) async throws -> MobileContentItem? {
    let filters = ForgeSchema.ExperienceFiltersInput(
      slug: .some(ForgeSchema.StringFilterInput(eq: .some(slug)))
    )
    let query = ForgeSchema.GetWatchExperienceQuery(
      locale: locale,
      filters: filters
    )
    typealias Continuation = CheckedContinuation<
      Result<GraphQLResult<ForgeSchema.GetWatchExperienceQuery.Data>, Error>, Never
    >
    let result = await withCheckedContinuation { (continuation: Continuation) in
      apollo.fetch(query: query, cachePolicy: .fetchIgnoringCacheData) { result in
        continuation.resume(returning: result)
      }
    }
    switch result {
    case .success(let graphQLResult):
      guard let data = graphQLResult.data else {
        if let errors = graphQLResult.errors, !errors.isEmpty {
          throw GraphQLContentClientError.graphQLErrors(errors)
        }
        return nil
      }
      guard let first = data.experiences.compactMap({ $0 }).first else {
        return nil
      }
      return mapExperienceToContentItem(experience: first, locale: locale)
    case .failure(let error):
      throw error
    }
  }

  private func mapExperienceToContentItem(
    experience: ForgeSchema.GetWatchExperienceQuery.Data.Experience,
    locale: String
  ) -> MobileContentItem {
    let title = firstSectionTitle(from: experience.sections) ?? experience.slug
    let state = experience.publishedAt != nil ? "published" : "draft"
    // body: Experience has no root-level body in the schema; not requested in the query. Leave empty.
    return MobileContentItem(
      id: String(experience.documentId),
      slug: experience.slug,
      locale: locale,
      title: title,
      body: "",
      state: state
    )
  }

  private func firstSectionTitle(
    from sections: [ForgeSchema.GetWatchExperienceQuery.Data.Experience.Section?]?
  ) -> String? {
    guard let sections = sections else { return nil }
    for section in sections.compactMap({ $0 }) {
      if let media = section.asComponentSectionsMediaCollection,
         let title = media.title, !title.isEmpty {
        return title
      }
      if let promo = section.asComponentSectionsPromoBanner, !promo.promoBannerHeading.isEmpty {
        return promo.promoBannerHeading
      }
      if let info = section.asComponentSectionsInfoBlocks,
         let heading = info.infoBlocksHeading, !heading.isEmpty {
        return heading
      }
      if let cta = section.asComponentSectionsCta, !cta.ctaHeading.isEmpty {
        return cta.ctaHeading
      }
    }
    return nil
  }
}

public enum GraphQLContentClientError: Error {
  case graphQLErrors([GraphQLError])
}
