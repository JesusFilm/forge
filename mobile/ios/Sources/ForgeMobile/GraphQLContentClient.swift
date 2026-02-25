import Apollo
import ApolloAPI
import Foundation

/// GraphQL client that implements `ContentClient` by calling the CMS GetWatchExperience query.
/// Configure with endpoint URL and optional bearer token (e.g. for dev/stage/prod).
public final class GraphQLContentClient: ContentClient {
  private let apollo: ApolloClient

  public init(endpoint: URL, bearerToken: String? = nil) {
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
    self.apollo = ApolloClient(networkTransport: transport, store: store)
  }

  public func getContent(locale: String, slug: String) async throws -> MobileContentItem? {
    let filters = ForgeSchema.ExperienceFiltersInput(
      slug: .some(ForgeSchema.StringFilterInput(eq: .some(slug)))
    )
    let query = ForgeSchema.GetWatchExperienceQuery(
      locale: locale,
      filters: filters
    )
    let result = await withCheckedContinuation { (continuation: CheckedContinuation<Result<GraphQLResult<ForgeSchema.GetWatchExperienceQuery.Data>, Error>, Never>) in
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
    return MobileContentItem(
      id: String(experience.documentId),
      slug: experience.slug,
      locale: locale,
      title: title,
      body: "",
      state: "published"
    )
  }

  private func firstSectionTitle(from sections: [ForgeSchema.GetWatchExperienceQuery.Data.Experience.Section?]?) -> String? {
    guard let sections = sections else { return nil }
    for section in sections.compactMap({ $0 }) {
      if let media = section.asComponentSectionsMediaCollection, let t = media.title, !t.isEmpty {
        return t
      }
      if let promo = section.asComponentSectionsPromoBanner {
        return promo.promoBannerHeading
      }
      if let info = section.asComponentSectionsInfoBlocks, let t = info.infoBlocksHeading, !t.isEmpty {
        return t
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
