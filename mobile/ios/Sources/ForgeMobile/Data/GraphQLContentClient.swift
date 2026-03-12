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
      id: experience.id, slug: experience.slug, locale: experience.locale,
      title: experience.title, body: experience.body, state: experience.state)
  }

  public func getExperience(locale: String, slug: String) async throws -> ExperienceContent? {
    let filters = ForgeSchema.ExperienceFiltersInput(
      slug: .some(ForgeSchema.StringFilterInput(eq: .some(slug)))
    )
    let query = ForgeSchema.GetWatchExperienceQuery(locale: locale, filters: filters)
    // Use a sendable wrapper so the onCancel closure can cancel the in-flight request.
    let requestBox = ApolloRequestBox()
    let result: Result<GraphQLResult<ForgeSchema.GetWatchExperienceQuery.Data>, any Error>
    result = try await withTaskCancellationHandler {
      try await withCheckedThrowingContinuation { continuation in
        let request = apollo.fetch(
          query: query, cachePolicy: .fetchIgnoringCacheData
        ) { result in
          continuation.resume(returning: result)
        }
        requestBox.set(request)
        if Task.isCancelled {
          request.cancel()
        }
      }
    } onCancel: {
      requestBox.cancel()
    }
    try Task.checkCancellation()
    switch result {
    case .success(let graphQLResult):
      // Use partial data when available — Strapi returns errors alongside data
      // when non-null fields are null for individual sections. We map what we can
      // and skip sections that failed to resolve.
      if let errors = graphQLResult.errors, !errors.isEmpty {
        print("[GraphQLContentClient] Partial errors: \(errors.map(\.message))")
      }
      guard let data = graphQLResult.data,
            let first = data.experiences.compactMap({ $0 }).first else {
        if let errors = graphQLResult.errors, !errors.isEmpty {
          throw GraphQLContentClientError.graphQLErrors(errors)
        }
        return nil
      }
      return mapExperience(first, locale: locale)
    case .failure(let error):
      throw error
    }
  }

  // MARK: - Experience mapping

  private func mapExperience(
    _ exp: ForgeSchema.GetWatchExperienceQuery.Data.Experience, locale: String
  ) -> ExperienceContent {
    let title = firstSectionTitle(from: exp.blocks) ?? exp.slug
    let state = exp.publishedAt != nil ? "published" : "draft"
    let sections = mapTopLevelSections(from: exp.blocks)
    return ExperienceContent(
      id: exp.documentId, slug: exp.slug, locale: locale,
      title: title, body: "", state: state, sections: sections)
  }

  // MARK: - Top-level section dispatch

  private func mapTopLevelSections(
    from sections: [ForgeSchema.GetWatchExperienceQuery.Data.Experience.Block?]?
  ) -> [ExperienceSection] {
    guard let sections else { return [] }
    return sections.compactMap { section in
      guard let section else { return nil }
      return mapTopLevelSection(section)
    }
  }

  private func mapTopLevelSection(
    _ section: ForgeSchema.GetWatchExperienceQuery.Data.Experience.Block
  ) -> ExperienceSection? {
    if let frag = section.asComponentSectionsMediaCollection?.fragments.mediaCollectionFields {
      return .leaf(mapMediaCollection(frag))
    }
    if let frag = section.asComponentSectionsCta?.fragments.ctaFields {
      return .leaf(mapCta(frag))
    }
    if let frag = section.asComponentSectionsVideoHero?.fragments.videoHeroFields {
      return .leaf(mapVideoHero(frag))
    }
    if let frag = section.asComponentSectionsText?.fragments.textFields {
      return .leaf(mapText(frag))
    }
    if let frag = section.asComponentSectionsRelatedQuestions?.fragments.relatedQuestionsFields {
      return .leaf(mapRelatedQuestions(frag))
    }
    if let frag = section.asComponentSectionsBibleQuotesCarousel?
      .fragments.bibleQuotesCarouselFields {
      return .leaf(mapBibleQuotesCarousel(frag))
    }
    if let frag = section.asComponentSectionsCard?.fragments.cardFields {
      return .leaf(mapCard(frag))
    }
    if let frag = section.asComponentSectionsVideo?.fragments.videoSectionFields {
      return .leaf(mapVideoSection(frag))
    }
    if let frag = section.asComponentSectionsEasterDates?.fragments.easterDatesFields {
      return .leaf(mapEasterDates(frag))
    }
    if let container = section.asComponentSectionsContainer {
      return .container(mapContainer(container))
    }
    if let wrapper = section.asComponentSectionsSection {
      return .section(mapSectionWrapper(wrapper))
    }
    return nil
  }

  // MARK: - Container mapping

  private typealias ContainerGQL =
    ForgeSchema.GetWatchExperienceQuery.Data.Experience.Block.AsComponentSectionsContainer
  private typealias SlotContentGQL = ContainerGQL.Slot.SlotContent

  private func mapContainer(_ container: ContainerGQL) -> ContainerSection {
    let slots: [ContainerSlot] = (container.slots ?? []).compactMap { slot in
      guard let slot else { return nil }
      let content = slot.slotContent.compactMap { mapSlotContent($0) }
      return ContainerSlot(id: slot.id, gridSpan: slot.gridSpan, content: content)
    }
    return ContainerSection(id: container.id, sectionKey: container.sectionKey, slots: slots)
  }

  private func mapSlotContent(_ slotContent: SlotContentGQL?) -> SectionContent? {
    guard let slotContent else { return nil }
    if let frag = slotContent.asComponentSectionsMediaCollection?.fragments
      .mediaCollectionFields {
      return mapMediaCollection(frag)
    }
    if let frag = slotContent.asComponentSectionsCta?.fragments.ctaFields {
      return mapCta(frag)
    }
    if let frag = slotContent.asComponentSectionsText?.fragments.textFields {
      return mapText(frag)
    }
    if let frag = slotContent.asComponentSectionsRelatedQuestions?.fragments
      .relatedQuestionsFields {
      return mapRelatedQuestions(frag)
    }
    if let frag = slotContent.asComponentSectionsBibleQuotesCarousel?.fragments
      .bibleQuotesCarouselFields {
      return mapBibleQuotesCarousel(frag)
    }
    if let frag = slotContent.asComponentSectionsCard?.fragments.cardFields {
      return mapCard(frag)
    }
    if let frag = slotContent.asComponentSectionsVideo?.fragments.videoSectionFields {
      return mapVideoSection(frag)
    }
    if let frag = slotContent.asComponentSectionsEasterDates?.fragments.easterDatesFields {
      return mapEasterDates(frag)
    }
    return nil
  }

  // MARK: - Section wrapper mapping

  private typealias SectionWrapperGQL =
    ForgeSchema.GetWatchExperienceQuery.Data.Experience.Block.AsComponentSectionsSection
  private typealias WrapperContentGQL = SectionWrapperGQL.SectionContent
  private typealias NestedContainerGQL = WrapperContentGQL.AsComponentSectionsContainer

  private func mapSectionWrapper(_ wrapper: SectionWrapperGQL) -> SectionWrapperSection {
    let bgColor = wrapper.backgroundColor
      .flatMap { SectionBackgroundColor(rawValue: $0.rawValue) }
    let content: [SectionContent] = (wrapper.sectionContent ?? [])
      .compactMap { mapWrapperContent($0) }
    return SectionWrapperSection(
      id: wrapper.id, sectionKey: wrapper.sectionKey,
      backgroundColor: bgColor, blurHash: wrapper.blurHash, content: content)
  }

  private func mapWrapperContent(_ wrapperContent: WrapperContentGQL?) -> SectionContent? {
    guard let wrapperContent else { return nil }
    if let frag = wrapperContent.asComponentSectionsMediaCollection?.fragments
      .mediaCollectionFields {
      return mapMediaCollection(frag)
    }
    if let frag = wrapperContent.asComponentSectionsCta?.fragments.ctaFields {
      return mapCta(frag)
    }
    if let frag = wrapperContent.asComponentSectionsText?.fragments.textFields {
      return mapText(frag)
    }
    if let frag = wrapperContent.asComponentSectionsRelatedQuestions?.fragments
      .relatedQuestionsFields {
      return mapRelatedQuestions(frag)
    }
    if let frag = wrapperContent.asComponentSectionsBibleQuotesCarousel?.fragments
      .bibleQuotesCarouselFields {
      return mapBibleQuotesCarousel(frag)
    }
    if let frag = wrapperContent.asComponentSectionsCard?.fragments.cardFields {
      return mapCard(frag)
    }
    if let frag = wrapperContent.asComponentSectionsVideo?.fragments.videoSectionFields {
      return mapVideoSection(frag)
    }
    if let frag = wrapperContent.asComponentSectionsEasterDates?.fragments.easterDatesFields {
      return mapEasterDates(frag)
    }
    if let nested = wrapperContent.asComponentSectionsContainer {
      return .container(mapNestedContainer(nested))
    }
    return nil
  }

  private func mapNestedContainer(_ container: NestedContainerGQL) -> ContainerSection {
    let slots: [ContainerSlot] = (container.slots ?? []).compactMap { slot in
      guard let slot else { return nil }
      let content = slot.slotContent.compactMap { mapNestedSlotContent($0) }
      return ContainerSlot(id: slot.id, gridSpan: slot.gridSpan, content: content)
    }
    return ContainerSection(id: container.id, sectionKey: container.sectionKey, slots: slots)
  }

  private func mapNestedSlotContent(
    _ slotContent: NestedContainerGQL.Slot.SlotContent?
  ) -> SectionContent? {
    guard let slotContent else { return nil }
    if let frag = slotContent.asComponentSectionsMediaCollection?.fragments
      .mediaCollectionFields {
      return mapMediaCollection(frag)
    }
    if let frag = slotContent.asComponentSectionsCta?.fragments.ctaFields {
      return mapCta(frag)
    }
    if let frag = slotContent.asComponentSectionsText?.fragments.textFields {
      return mapText(frag)
    }
    if let frag = slotContent.asComponentSectionsRelatedQuestions?.fragments
      .relatedQuestionsFields {
      return mapRelatedQuestions(frag)
    }
    if let frag = slotContent.asComponentSectionsBibleQuotesCarousel?.fragments
      .bibleQuotesCarouselFields {
      return mapBibleQuotesCarousel(frag)
    }
    if let frag = slotContent.asComponentSectionsCard?.fragments.cardFields {
      return mapCard(frag)
    }
    if let frag = slotContent.asComponentSectionsVideo?.fragments.videoSectionFields {
      return mapVideoSection(frag)
    }
    if let frag = slotContent.asComponentSectionsEasterDates?.fragments.easterDatesFields {
      return mapEasterDates(frag)
    }
    return nil
  }
}

// MARK: - Cancellation helper

/// Thread-safe box that holds an Apollo `Cancellable` so `withTaskCancellationHandler`
/// can cancel an in-flight network request from its `onCancel` closure.
private final class ApolloRequestBox: @unchecked Sendable {
  private let lock = NSLock()
  private var request: (any Apollo.Cancellable)?

  func set(_ cancellable: any Apollo.Cancellable) {
    lock.lock()
    request = cancellable
    lock.unlock()
  }

  func cancel() {
    lock.lock()
    let req = request
    lock.unlock()
    req?.cancel()
  }
}

// MARK: - Error type

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
