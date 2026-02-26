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
    let trimmedToken = bearerToken?.trimmingCharacters(in: .whitespacesAndNewlines)
    let headers: [String: String] = if let token = trimmedToken, !token.isEmpty {
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
    guard let experience = try await getExperience(locale: locale, slug: slug) else {
      return nil
    }
    return MobileContentItem(
      id: experience.id,
      slug: experience.slug,
      locale: experience.locale,
      title: experience.title,
      body: experience.body,
      state: experience.state
    )
  }

  public func getExperience(locale: String, slug: String) async throws -> ExperienceContent? {
    let filters = ForgeSchema.ExperienceFiltersInput(
      slug: .some(ForgeSchema.StringFilterInput(eq: .some(slug)))
    )
    let query = ForgeSchema.GetWatchExperienceQuery(
      locale: locale,
      filters: filters
    )
    let result = await withCheckedContinuation { continuation in
      apollo.fetch(query: query, cachePolicy: .fetchIgnoringCacheData) { result in
        continuation.resume(returning: result)
      }
    }
    switch result {
    case .success(let graphQLResult):
      if let errors = graphQLResult.errors, !errors.isEmpty {
        throw GraphQLContentClientError.graphQLErrors(errors)
      }
      guard let data = graphQLResult.data else {
        return nil
      }
      guard let first = data.experiences.compactMap({ $0 }).first else {
        return nil
      }
      return mapExperienceToExperienceContent(experience: first, locale: locale)
    case .failure(let error):
      throw error
    }
  }

  private func mapExperienceToExperienceContent(
    experience: ForgeSchema.GetWatchExperienceQuery.Data.Experience,
    locale: String
  ) -> ExperienceContent {
    let title = firstSectionTitle(from: experience.sections) ?? experience.slug
    let state = experience.publishedAt != nil ? "published" : "draft"
    let sections = mapSections(from: experience.sections)
    return ExperienceContent(
      id: experience.documentId,
      slug: experience.slug,
      locale: locale,
      title: title,
      body: "",
      state: state,
      sections: sections
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

  /// Maps GraphQL sections to view-facing section models. Skips unmapped or invalid sections; no force-unwrap.
  private func mapSections(
    from sections: [ForgeSchema.GetWatchExperienceQuery.Data.Experience.Section?]?
  ) -> [ExperienceSection] {
    guard let sections = sections else { return [] }
    return sections.compactMap { section in
      guard let section = section else { return nil }
      return mapSection(section)
    }
  }

  private func mapSection(
    _ section: ForgeSchema.GetWatchExperienceQuery.Data.Experience.Section
  ) -> ExperienceSection? {
    if let media = section.asComponentSectionsMediaCollection {
      return mapMediaCollectionSection(media)
    }
    if let promo = section.asComponentSectionsPromoBanner {
      return .promoBanner(PromoBannerSection(
        id: promo.id,
        heading: promo.promoBannerHeading,
        description: promo.promoBannerDescription,
        intro: promo.intro,
        ctaLink: promo.promoBannerCtaLink
      ))
    }
    if let info = section.asComponentSectionsInfoBlocks {
      return mapInfoBlocksSection(info)
    }
    if let cta = section.asComponentSectionsCta {
      return .cta(CTASection(
        id: cta.id,
        heading: cta.ctaHeading,
        body: cta.body,
        buttonLabel: cta.buttonLabel,
        buttonLink: cta.buttonLink
      ))
    }
    return nil
  }

  private func mapMediaCollectionSection(
    _ media: ForgeSchema.GetWatchExperienceQuery.Data.Experience.Section.AsComponentSectionsMediaCollection
  ) -> ExperienceSection? {
    let variant = MediaCollectionVariant(rawValue: media.variant.rawValue) ?? .collection
    return .mediaCollection(MediaCollectionSection(
      id: media.id,
      title: media.title,
      subtitle: media.subtitle,
      description: media.mediaCollectionDescription,
      categoryLabel: media.categoryLabel,
      ctaLink: media.mediaCollectionCtaLink,
      showItemNumbers: media.showItemNumbers,
      variant: variant
    ))
  }

  private func mapInfoBlocksSection(
    _ info: ForgeSchema.GetWatchExperienceQuery.Data.Experience.Section.AsComponentSectionsInfoBlocks
  ) -> ExperienceSection {
    let blocks: [InfoBlockItem] = (info.blocks ?? []).compactMap { block in
      guard let block = block else { return nil }
      return InfoBlockItem(
        id: block.id,
        title: block.title,
        description: block.description,
        icon: block.icon
      )
    }
    return .infoBlocks(InfoBlocksSection(
      id: info.id,
      heading: info.infoBlocksHeading,
      intro: info.intro,
      description: info.infoBlocksDescription,
      blocks: blocks
    ))
  }
}

public enum GraphQLContentClientError: Error, LocalizedError {
  case graphQLErrors([GraphQLError])

  public var errorDescription: String? {
    switch self {
    case .graphQLErrors(let errors):
      let messages = errors.compactMap(\.message)
      return messages.isEmpty ? "GraphQL error" : messages.joined(separator: "; ")
    }
  }
}
