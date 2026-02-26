import SwiftUI

/// Renders one experience section by type. Use when displaying a list of sections
/// (e.g. from ExperienceContent.sections). PromoBanner is implemented; other types
/// use placeholders until their renderers ship (#104, #106, #107).
public struct ExperienceSectionView: View {
  private let section: ExperienceSection

  public init(section: ExperienceSection) {
    self.section = section
  }

  public var body: some View {
    switch section {
    case .promoBanner(let promo):
      PromoBannerView(section: promo)
    case .mediaCollection:
      sectionPlaceholder(label: "Media collection")
    case .infoBlocks:
      sectionPlaceholder(label: "Info blocks")
    case .cta:
      sectionPlaceholder(label: "CTA")
    }
  }

  private func sectionPlaceholder(label: String) -> some View {
    Text(label)
      .font(.caption)
      .foregroundStyle(.secondary)
      .frame(maxWidth: .infinity, alignment: .leading)
      .padding()
      .accessibilityLabel("Section: \(label)")
  }
}

#if DEBUG
#Preview("PromoBanner via switch") {
  ExperienceSectionView(section: .promoBanner(PromoBannerSection(
    id: "p1",
    heading: "Preview",
    description: "Description.",
    intro: nil,
    ctaLink: "https://example.com"
  )))
}
#endif
