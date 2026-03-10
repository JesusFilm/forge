import Foundation

// MARK: - MediaCollection

public struct MediaCollectionItem: Sendable, Codable {
  public let id: String
  public let titleOverride: String?
  public let subtitleOverride: String?
  public let collectionSize: String?
  public let linkToSectionKey: String?
  public let imageOverride: UploadFileModel?
  public let video: VideoModel?

  public init(
    id: String, titleOverride: String?, subtitleOverride: String?,
    collectionSize: String?, linkToSectionKey: String?,
    imageOverride: UploadFileModel?, video: VideoModel?
  ) {
    self.id = id
    self.titleOverride = titleOverride
    self.subtitleOverride = subtitleOverride
    self.collectionSize = collectionSize
    self.linkToSectionKey = linkToSectionKey
    self.imageOverride = imageOverride
    self.video = video
  }
}

public struct MediaCollectionSection: Sendable, Codable {
  public let id: String
  public let sectionKey: String?
  public let title: String?
  public let subtitle: String?
  public let description: String?
  public let categoryLabel: String?
  public let ctaLink: String?
  public let showItemNumbers: Bool?
  public let footerText: String?
  public let variant: MediaCollectionVariant
  public let items: [MediaCollectionItem]

  public init(
    id: String, sectionKey: String?, title: String?, subtitle: String?,
    description: String?, categoryLabel: String?, ctaLink: String?,
    showItemNumbers: Bool?, footerText: String?,
    variant: MediaCollectionVariant, items: [MediaCollectionItem]
  ) {
    self.id = id
    self.sectionKey = sectionKey
    self.title = title
    self.subtitle = subtitle
    self.description = description
    self.categoryLabel = categoryLabel
    self.ctaLink = ctaLink
    self.showItemNumbers = showItemNumbers
    self.footerText = footerText
    self.variant = variant
    self.items = items
  }
}

// MARK: - CTA

public struct CTASection: Sendable, Codable {
  public let id: String
  public let sectionKey: String?
  public let heading: String?
  public let body: String?
  public let buttonLabel: String
  public let buttonLink: String?
  public let variant: CTAVariant?

  public init(
    id: String, sectionKey: String?, heading: String?, body: String?,
    buttonLabel: String, buttonLink: String?, variant: CTAVariant?
  ) {
    self.id = id
    self.sectionKey = sectionKey
    self.heading = heading
    self.body = body
    self.buttonLabel = buttonLabel
    self.buttonLink = buttonLink
    self.variant = variant
  }
}

// MARK: - VideoHero

public struct VideoHeroSection: Sendable, Codable {
  public let id: String
  public let sectionKey: String?
  public let heading: String?
  public let subheading: String?
  public let streamingUrl: String
  public let ctaLink: String?
  public let ctaLabel: String?
  public let video: VideoModel

  public init(
    id: String, sectionKey: String?, heading: String?, subheading: String?,
    streamingUrl: String, ctaLink: String?, ctaLabel: String?, video: VideoModel
  ) {
    self.id = id
    self.sectionKey = sectionKey
    self.heading = heading
    self.subheading = subheading
    self.streamingUrl = streamingUrl
    self.ctaLink = ctaLink
    self.ctaLabel = ctaLabel
    self.video = video
  }
}

// MARK: - Text

public struct TextSection: Sendable, Codable {
  public let id: String
  public let sectionKey: String?
  public let heading: String?
  public let headingLevel: TextHeadingLevel?
  public let subtitle: String?
  public let content: String
  public let variant: TextVariant?

  public init(
    id: String, sectionKey: String?, heading: String?,
    headingLevel: TextHeadingLevel?, subtitle: String?,
    content: String, variant: TextVariant?
  ) {
    self.id = id
    self.sectionKey = sectionKey
    self.heading = heading
    self.headingLevel = headingLevel
    self.subtitle = subtitle
    self.content = content
    self.variant = variant
  }
}

// MARK: - RelatedQuestions

public struct RelatedQuestionItem: Sendable, Codable {
  public let id: String
  public let question: String
  public let answer: String

  public init(id: String, question: String, answer: String) {
    self.id = id
    self.question = question
    self.answer = answer
  }
}

public struct RelatedQuestionsSection: Sendable, Codable {
  public let id: String
  public let sectionKey: String?
  public let heading: String?
  public let questions: [RelatedQuestionItem]

  public init(id: String, sectionKey: String?, heading: String?, questions: [RelatedQuestionItem]) {
    self.id = id
    self.sectionKey = sectionKey
    self.heading = heading
    self.questions = questions
  }
}

// MARK: - BibleQuotesCarousel

public struct BibleQuoteItem: Sendable, Codable {
  public let id: String
  public let reference: String
  public let text: String
  public let backgroundImage: UploadFileModel?
  public let ctaLabel: String?
  public let ctaLink: String?
  public let attribution: String?

  public init(
    id: String, reference: String, text: String,
    backgroundImage: UploadFileModel?, ctaLabel: String?,
    ctaLink: String?, attribution: String?
  ) {
    self.id = id
    self.reference = reference
    self.text = text
    self.backgroundImage = backgroundImage
    self.ctaLabel = ctaLabel
    self.ctaLink = ctaLink
    self.attribution = attribution
  }
}

public struct BibleQuotesCarouselSection: Sendable, Codable {
  public let id: String
  public let sectionKey: String?
  public let heading: String?
  public let quotes: [BibleQuoteItem]

  public init(id: String, sectionKey: String?, heading: String?, quotes: [BibleQuoteItem]) {
    self.id = id
    self.sectionKey = sectionKey
    self.heading = heading
    self.quotes = quotes
  }
}

// MARK: - Card

public struct CardSection: Sendable, Codable {
  public let id: String
  public let sectionKey: String?
  public let title: String
  public let description: String
  public let media: UploadFileModel?
  public let link: String?
  public let variant: CardVariant?

  public init(
    id: String, sectionKey: String?, title: String, description: String,
    media: UploadFileModel?, link: String?, variant: CardVariant?
  ) {
    self.id = id
    self.sectionKey = sectionKey
    self.title = title
    self.description = description
    self.media = media
    self.link = link
    self.variant = variant
  }
}

// MARK: - Video

public struct VideoSection: Sendable, Codable {
  public let id: String
  public let sectionKey: String?
  public let streamingUrl: String
  public let title: String?
  public let subtitle: String?
  public let media: UploadFileModel?
  public let video: VideoModel?

  public init(
    id: String, sectionKey: String?, streamingUrl: String,
    title: String?, subtitle: String?, media: UploadFileModel?,
    video: VideoModel?
  ) {
    self.id = id
    self.sectionKey = sectionKey
    self.streamingUrl = streamingUrl
    self.title = title
    self.subtitle = subtitle
    self.media = media
    self.video = video
  }
}
