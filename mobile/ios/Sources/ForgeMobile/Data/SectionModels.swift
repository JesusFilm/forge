import Foundation

// MARK: - View-facing section models (data layer)

/// Variant for MediaCollection section; aligns with schema ComponentSectionsMediaCollection.variant.
public enum MediaCollectionVariant: String, Sendable {
  case carousel
  case collection
  case grid
  case hero
  case player
}

/// View-facing model for MediaCollection section data.
public struct MediaCollectionSection: Sendable {
  public let id: String
  public let title: String?
  public let subtitle: String?
  public let description: String?
  public let categoryLabel: String?
  public let ctaLink: String?
  public let showItemNumbers: Bool?
  public let variant: MediaCollectionVariant

  public init(
    id: String,
    title: String?,
    subtitle: String?,
    description: String?,
    categoryLabel: String?,
    ctaLink: String?,
    showItemNumbers: Bool?,
    variant: MediaCollectionVariant
  ) {
    self.id = id
    self.title = title
    self.subtitle = subtitle
    self.description = description
    self.categoryLabel = categoryLabel
    self.ctaLink = ctaLink
    self.showItemNumbers = showItemNumbers
    self.variant = variant
  }
}

/// View-facing model for PromoBanner section data.
public struct PromoBannerSection: Sendable {
  public let id: String
  public let heading: String
  public let description: String
  public let intro: String?
  public let ctaLink: String

  public init(id: String, heading: String, description: String, intro: String?, ctaLink: String) {
    self.id = id
    self.heading = heading
    self.description = description
    self.intro = intro
    self.ctaLink = ctaLink
  }
}

/// View-facing model for a single info block (ComponentSectionsInfoBlock).
public struct InfoBlockItem: Sendable {
  public let id: String
  public let title: String
  public let description: String
  public let icon: String

  public init(id: String, title: String, description: String, icon: String) {
    self.id = id
    self.title = title
    self.description = description
    self.icon = icon
  }
}

/// View-facing model for InfoBlocks section data.
public struct InfoBlocksSection: Sendable {
  public let id: String
  public let heading: String?
  public let intro: String?
  public let description: String?
  public let blocks: [InfoBlockItem]

  public init(
    id: String,
    heading: String?,
    intro: String?,
    description: String?,
    blocks: [InfoBlockItem]
  ) {
    self.id = id
    self.heading = heading
    self.intro = intro
    self.description = description
    self.blocks = blocks
  }
}

/// View-facing model for CTA section data.
public struct CTASection: Sendable {
  public let id: String
  public let heading: String
  public let body: String
  public let buttonLabel: String
  public let buttonLink: String

  public init(id: String, heading: String, body: String, buttonLabel: String, buttonLink: String) {
    self.id = id
    self.heading = heading
    self.body = body
    self.buttonLabel = buttonLabel
    self.buttonLink = buttonLink
  }
}

/// Single section for server-driven UI; one of the four schema-aligned section types.
public enum ExperienceSection: Sendable {
  case mediaCollection(MediaCollectionSection)
  case promoBanner(PromoBannerSection)
  case infoBlocks(InfoBlocksSection)
  case cta(CTASection)
}
