import SwiftUI

/// Renders a MediaCollection section from the data layer. Supports variant (carousel, grid, collection, hero, player)
/// and displays title, subtitle, description, categoryLabel, and CTA when present. Composable in the experience view.
public struct MediaCollectionView: View {
  private let section: MediaCollectionSection

  public init(section: MediaCollectionSection) {
    self.section = section
  }

  public var body: some View {
    Group {
      switch section.variant {
      case .hero:
        heroLayout
      case .player:
        playerLayout
      case .carousel, .collection, .grid:
        standardLayout
      }
    }
    .accessibilityElement(children: .combine)
    .accessibilityLabel(accessibilityLabelText)
  }

  private var heroLayout: some View {
    VStack(alignment: .leading, spacing: 8) {
      if let category = section.categoryLabel, !category.isEmpty {
        Text(category)
          .font(.caption)
          .foregroundStyle(.secondary)
          .accessibilityLabel("Category: \(category)")
      }
      if let title = section.title, !title.isEmpty {
        Text(title)
          .font(.title2)
          .fontWeight(.semibold)
          .accessibilityLabel("Title: \(title)")
      }
      if let subtitle = section.subtitle, !subtitle.isEmpty {
        Text(subtitle)
          .font(.subheadline)
          .foregroundStyle(.secondary)
      }
      if let description = section.description, !description.isEmpty {
        Text(description)
          .font(.body)
      }
      ctaButton
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding()
  }

  private var playerLayout: some View {
    VStack(alignment: .leading, spacing: 6) {
      if let title = section.title, !title.isEmpty {
        Text(title)
          .font(.headline)
          .accessibilityLabel("Title: \(title)")
      }
      if let description = section.description, !description.isEmpty {
        Text(description)
          .font(.caption)
          .foregroundStyle(.secondary)
      }
      ctaButton
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding()
  }

  private var standardLayout: some View {
    VStack(alignment: .leading, spacing: 6) {
      if let category = section.categoryLabel, !category.isEmpty {
        Text(category)
          .font(.caption2)
          .foregroundStyle(.secondary)
          .accessibilityLabel("Category: \(category)")
      }
      if let title = section.title, !title.isEmpty {
        Text(title)
          .font(.headline)
          .accessibilityLabel("Title: \(title)")
      }
      if let subtitle = section.subtitle, !subtitle.isEmpty {
        Text(subtitle)
          .font(.subheadline)
          .foregroundStyle(.secondary)
      }
      if let description = section.description, !description.isEmpty {
        Text(description)
          .font(.caption)
      }
      ctaButton
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding(.vertical, 8)
    .padding(.horizontal, 12)
  }

  @ViewBuilder
  private var ctaButton: some View {
    if let link = section.ctaLink, !link.isEmpty {
      Button(
        action: {},
        label: {
          Text("Learn more")
            .font(.subheadline)
            .fontWeight(.medium)
        }
      )
      .buttonStyle(.borderedProminent)
      .accessibilityLabel("Learn more")
      .accessibilityHint("Opens link")
    }
  }

  private var accessibilityLabelText: String {
    var parts: [String] = []
    if let category = section.categoryLabel, !category.isEmpty {
      parts.append("Category: \(category)")
    }
    if let title = section.title, !title.isEmpty {
      parts.append(title)
    }
    if let subtitle = section.subtitle, !subtitle.isEmpty {
      parts.append(subtitle)
    }
    if let description = section.description, !description.isEmpty {
      parts.append(description)
    }
    if section.ctaLink != nil, !(section.ctaLink?.isEmpty ?? true) {
      parts.append("Learn more button")
    }
    return parts.isEmpty ? "Media collection" : parts.joined(separator: ". ")
  }
}

#if DEBUG
#Preview("MediaCollection hero") {
  MediaCollectionView(section: MediaCollectionSection(
    id: "preview-1",
    title: "Featured",
    subtitle: "Watch now",
    description: "A short description of this collection.",
    categoryLabel: "Easter",
    ctaLink: "https://example.com",
    showItemNumbers: false,
    variant: .hero
  ))
}

#Preview("MediaCollection grid") {
  MediaCollectionView(section: MediaCollectionSection(
    id: "preview-2",
    title: "More to explore",
    subtitle: nil,
    description: "Browse collection.",
    categoryLabel: nil,
    ctaLink: nil,
    showItemNumbers: true,
    variant: .grid
  ))
}
#endif
