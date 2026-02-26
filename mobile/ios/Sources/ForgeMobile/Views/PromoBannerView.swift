import SwiftUI

/// Renders a PromoBanner section from the data layer. Displays heading, description,
/// optional intro, and CTA link. Composable in the experience view.
public struct PromoBannerView: View {
  private let section: PromoBannerSection

  public init(section: PromoBannerSection) {
    self.section = section
  }

  public var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      if let intro = section.intro, !intro.isEmpty {
        Text(intro)
          .font(.caption)
          .foregroundStyle(.secondary)
          .accessibilityLabel("Intro: \(intro)")
      }
      Text(section.heading)
        .font(.title2)
        .fontWeight(.semibold)
        .accessibilityLabel("Heading: \(section.heading)")
      Text(section.description)
        .font(.body)
        .foregroundStyle(.secondary)
        .accessibilityLabel("Description: \(section.description)")
      if !section.ctaLink.isEmpty {
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
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding()
    .accessibilityElement(children: .combine)
    .accessibilityLabel(accessibilityLabelText)
  }

  private var accessibilityLabelText: String {
    var parts: [String] = []
    if let intro = section.intro, !intro.isEmpty {
      parts.append("Intro: \(intro)")
    }
    parts.append(section.heading)
    parts.append(section.description)
    if !section.ctaLink.isEmpty {
      parts.append("Learn more button")
    }
    return parts.isEmpty ? "Promo banner" : parts.joined(separator: ". ")
  }
}

#if DEBUG
#Preview("PromoBanner") {
  PromoBannerView(section: PromoBannerSection(
    id: "preview-1",
    heading: "Featured experience",
    description: "Discover content for the season.",
    intro: "Limited time",
    ctaLink: "https://example.com"
  ))
}

#Preview("PromoBanner no intro") {
  PromoBannerView(section: PromoBannerSection(
    id: "preview-2",
    heading: "Watch now",
    description: "Stream the full library.",
    intro: nil,
    ctaLink: "https://example.com/watch"
  ))
}
#endif
