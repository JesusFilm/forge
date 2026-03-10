import ApolloAPI
import Foundation

// MARK: - Fragment-based mappers (extension on GraphQLContentClient)

extension GraphQLContentClient {

  // MARK: Shared helpers

  func mapUploadFile(url: String, alternativeText: String?) -> UploadFileModel {
    UploadFileModel(url: url, alternativeText: alternativeText)
  }

  func mapVideoModel(
    documentId: String, slug: String, title: String,
    imageUrl: String?, imageAlt: String?
  ) -> VideoModel {
    let image = imageUrl.map { UploadFileModel(url: $0, alternativeText: imageAlt) }
    return VideoModel(documentId: documentId, slug: slug, title: title, image: image)
  }

  // MARK: Leaf mappers (fragment → SectionContent)

  func mapMediaCollection(_ frag: ForgeSchema.MediaCollectionFields) -> SectionContent {
    let items: [MediaCollectionItem] = (frag.items ?? []).compactMap { item in
      guard let item else { return nil }
      let imageOverride = item.imageOverride.map {
        mapUploadFile(url: $0.url, alternativeText: $0.alternativeText)
      }
      let video = item.itemVideo.map {
        mapVideoModel(
          documentId: $0.documentId, slug: $0.slug, title: $0.title,
          imageUrl: $0.image?.url, imageAlt: $0.image?.alternativeText)
      }
      return MediaCollectionItem(
        id: item.id, titleOverride: item.titleOverride,
        subtitleOverride: item.subtitleOverride,
        collectionSize: item.collectionSize,
        linkToSectionKey: item.linkToSectionKey,
        imageOverride: imageOverride, video: video)
    }
    let variant = MediaCollectionVariant(
      rawValue: frag.mediaCollectionVariant.rawValue) ?? .collection
    return .mediaCollection(MediaCollectionSection(
      id: frag.id, sectionKey: frag.sectionKey, title: frag.mediaCollectionTitle,
      subtitle: frag.subtitle, description: frag.mediaCollectionDescription,
      categoryLabel: frag.categoryLabel, ctaLink: frag.mediaCollectionCtaLink,
      showItemNumbers: frag.showItemNumbers, footerText: frag.footerText,
      variant: variant, items: items))
  }

  func mapCta(_ frag: ForgeSchema.CtaFields) -> SectionContent {
    let variant = frag.ctaVariant.flatMap { CTAVariant(rawValue: $0.rawValue) }
    return .cta(CTASection(
      id: frag.id, sectionKey: frag.sectionKey, heading: frag.ctaHeading,
      body: frag.body, buttonLabel: frag.buttonLabel,
      buttonLink: frag.buttonLink, variant: variant))
  }

  func mapVideoHero(_ frag: ForgeSchema.VideoHeroFields) -> SectionContent {
    let video = mapVideoModel(
      documentId: frag.heroVideo.documentId, slug: frag.heroVideo.slug,
      title: frag.heroVideo.title, imageUrl: frag.heroVideo.image?.url,
      imageAlt: frag.heroVideo.image?.alternativeText)
    return .videoHero(VideoHeroSection(
      id: frag.id, sectionKey: frag.sectionKey, heading: frag.videoHeroHeading,
      subheading: frag.subheading, streamingUrl: nil,
      ctaLink: frag.ctaLink, ctaLabel: frag.ctaLabel, video: video))
  }

  func mapText(_ frag: ForgeSchema.TextFields) -> SectionContent {
    let headingLevel = frag.headingLevel.flatMap { TextHeadingLevel(rawValue: $0.rawValue) }
    let variant = frag.textVariant.flatMap { TextVariant(rawValue: $0.rawValue) }
    return .text(TextSection(
      id: frag.id, sectionKey: frag.sectionKey, heading: frag.textHeading,
      headingLevel: headingLevel, subtitle: frag.textSubtitle,
      content: frag.textContent, variant: variant))
  }

  func mapRelatedQuestions(_ frag: ForgeSchema.RelatedQuestionsFields) -> SectionContent {
    let questions: [RelatedQuestionItem] = (frag.questions ?? []).compactMap { item in
      guard let item else { return nil }
      return RelatedQuestionItem(id: item.id, question: item.question, answer: item.answer)
    }
    return .relatedQuestions(RelatedQuestionsSection(
      id: frag.id, sectionKey: frag.sectionKey,
      heading: frag.relatedQuestionsHeading, questions: questions))
  }

  func mapBibleQuotesCarousel(_ frag: ForgeSchema.BibleQuotesCarouselFields) -> SectionContent {
    let quotes: [BibleQuoteItem] = (frag.quotes ?? []).compactMap { quote in
      guard let quote else { return nil }
      let bgImage = quote.backgroundImage.map {
        mapUploadFile(url: $0.url, alternativeText: $0.alternativeText)
      }
      return BibleQuoteItem(
        id: quote.id, reference: quote.reference, text: quote.text,
        backgroundImage: bgImage, ctaLabel: quote.ctaLabel,
        ctaLink: quote.ctaLink, attribution: quote.attribution)
    }
    return .bibleQuotesCarousel(BibleQuotesCarouselSection(
      id: frag.id, sectionKey: frag.sectionKey,
      heading: frag.carouselHeading, quotes: quotes))
  }

  func mapCard(_ frag: ForgeSchema.CardFields) -> SectionContent {
    let media = frag.media.map { mapUploadFile(url: $0.url, alternativeText: $0.alternativeText) }
    let variant = frag.cardVariant.flatMap { CardVariant(rawValue: $0.rawValue) }
    return .card(CardSection(
      id: frag.id, sectionKey: frag.sectionKey, title: frag.cardTitle,
      description: frag.cardDescription, media: media,
      link: frag.link, variant: variant))
  }

  func mapVideoSection(_ frag: ForgeSchema.VideoSectionFields) -> SectionContent {
    let media = frag.videoMedia.map {
      mapUploadFile(url: $0.url, alternativeText: $0.alternativeText)
    }
    let video = frag.sectionVideo.map {
      mapVideoModel(
        documentId: $0.documentId, slug: $0.slug, title: $0.title,
        imageUrl: $0.image?.url, imageAlt: $0.image?.alternativeText)
    }
    return .video(VideoSection(
      id: frag.id, sectionKey: frag.sectionKey, streamingUrl: frag.streamingUrl,
      title: frag.videoTitle, subtitle: frag.videoSubtitle,
      media: media, video: video))
  }

  // MARK: - Title extraction

  /// Scans top-level sections for the first non-empty heading/title to use as experience title.
  func firstSectionTitle(
    from sections: [ForgeSchema.GetWatchExperienceQuery.Data.Experience.Block?]?
  ) -> String? {
    guard let sections else { return nil }
    for section in sections.compactMap({ $0 }) {
      if let hero = section.asComponentSectionsVideoHero,
         let heading = hero.videoHeroHeading, !heading.isEmpty { return heading }
      if let media = section.asComponentSectionsMediaCollection,
         let title = media.mediaCollectionTitle, !title.isEmpty { return title }
      if let text = section.asComponentSectionsText,
         let heading = text.textHeading, !heading.isEmpty { return heading }
      if let card = section.asComponentSectionsCard,
         !card.cardTitle.isEmpty { return card.cardTitle }
      if let cta = section.asComponentSectionsCta,
         let heading = cta.ctaHeading, !heading.isEmpty { return heading }
      if let relatedQuestions = section.asComponentSectionsRelatedQuestions,
         let heading = relatedQuestions.relatedQuestionsHeading,
         !heading.isEmpty { return heading }
      if let carousel = section.asComponentSectionsBibleQuotesCarousel,
         let heading = carousel.carouselHeading, !heading.isEmpty { return heading }
      if let video = section.asComponentSectionsVideo,
         let title = video.videoTitle, !title.isEmpty { return title }
    }
    return nil
  }
}
