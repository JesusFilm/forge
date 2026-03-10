import Foundation

// MARK: - Shared media models

/// Minimal upload file model (url + alt text) for images and media.
public struct UploadFileModel: Sendable, Codable {
  public let url: String
  public let alternativeText: String?

  public init(url: String, alternativeText: String?) {
    self.url = url
    self.alternativeText = alternativeText
  }
}

/// Video content reference from CMS.
public struct VideoModel: Sendable, Codable {
  public let documentId: String
  public let slug: String
  public let title: String
  public let image: UploadFileModel?

  public init(documentId: String, slug: String, title: String, image: UploadFileModel?) {
    self.documentId = documentId
    self.slug = slug
    self.title = title
    self.image = image
  }
}

// MARK: - Enums for section field variants

public enum MediaCollectionVariant: String, Sendable, Codable {
  case carousel, collection, grid, hero, player
}

public enum CardVariant: String, Sendable, Codable {
  case `default`, featured
}

public enum CTAVariant: String, Sendable, Codable {
  case primary, secondary
}

public enum TextHeadingLevel: String, Sendable, Codable {
  case h1, h2, h3, h4, h5, h6
}

public enum TextVariant: String, Sendable, Codable {
  case `default`, lead, small
}

public enum SectionBackgroundColor: String, Sendable, Codable {
  case `default`, light, dark, primary
}

// MARK: - Two-enum section model

/// Leaf content that appears inside Container slots and Section wrappers.
/// Also includes `.container` for Section → Container nesting.
public indirect enum SectionContent: Sendable, Codable {
  case mediaCollection(MediaCollectionSection)
  case cta(CTASection)
  case videoHero(VideoHeroSection)
  case text(TextSection)
  case relatedQuestions(RelatedQuestionsSection)
  case bibleQuotesCarousel(BibleQuotesCarouselSection)
  case card(CardSection)
  case video(VideoSection)
  case container(ContainerSection)
}

/// Top-level section for server-driven UI; leaf, structural, or wrapper.
public enum ExperienceSection: Sendable, Codable {
  case leaf(SectionContent)
  case container(ContainerSection)
  case section(SectionWrapperSection)
}
