import SwiftUI

/// Standalone CTA section renderer. Displays a heading, body text,
/// and an action button styled by variant (primary / secondary).
/// Reusable at top level, inside Container slots, and Section wrappers.
struct CTAView: View {
  let section: CTASection

  var body: some View {
    VStack(spacing: 12) {
      if let heading = section.heading, !heading.isEmpty {
        Text(heading)
          .font(.title2.bold())
          .multilineTextAlignment(.center)
          .accessibilityAddTraits(.isHeader)
      }

      if let body = section.body, !body.isEmpty {
        Text(body)
          .font(.body)
          .foregroundStyle(.secondary)
          .multilineTextAlignment(.center)
      }

      ctaButton
    }
    .padding(.vertical, 32)
    .padding(.horizontal, 24)
    .frame(maxWidth: .infinity)
    .background(Color(.systemGroupedBackground))
  }

  @ViewBuilder
  private var ctaButton: some View {
    if let link = section.buttonLink, !link.isEmpty,
       let url = URL(string: link) {
      linkButton(url: url)
    } else {
      actionButton
    }
  }

  @ViewBuilder
  private func linkButton(url: URL) -> some View {
    if section.variant == .secondary {
      Link(destination: url) { buttonContent }
        .buttonStyle(.bordered)
        .accessibilityLabel(section.buttonLabel)
        .accessibilityAddTraits(.isLink)
    } else {
      Link(destination: url) { buttonContent }
        .buttonStyle(.borderedProminent)
        .accessibilityLabel(section.buttonLabel)
        .accessibilityAddTraits(.isLink)
    }
  }

  @ViewBuilder
  private var actionButton: some View {
    if section.variant == .secondary {
      Button(action: {}, label: { buttonContent })
        .buttonStyle(.bordered)
        .accessibilityLabel(section.buttonLabel)
    } else {
      Button(action: {}, label: { buttonContent })
        .buttonStyle(.borderedProminent)
        .accessibilityLabel(section.buttonLabel)
    }
  }

  private var buttonContent: some View {
    Text(section.buttonLabel)
      .fontWeight(.semibold)
      .frame(minWidth: 120)
  }
}

// MARK: - Preview

#if DEBUG
#Preview("CTA – Primary") {
  CTAView(
    section: CTASection(
      id: "preview-1",
      sectionKey: nil,
      heading: "Ready to Watch?",
      body: "Stream inspiring films and videos about the life of Jesus.",
      buttonLabel: "Start Watching",
      buttonLink: "https://www.jesusfilm.org/watch",
      variant: .primary
    )
  )
}

#Preview("CTA – Secondary") {
  CTAView(
    section: CTASection(
      id: "preview-2",
      sectionKey: nil,
      heading: "Learn More",
      body: "Discover resources for your community.",
      buttonLabel: "Explore",
      buttonLink: "https://www.jesusfilm.org",
      variant: .secondary
    )
  )
}

#Preview("CTA – No Link") {
  CTAView(
    section: CTASection(
      id: "preview-3",
      sectionKey: nil,
      heading: "Coming Soon",
      body: nil,
      buttonLabel: "Notify Me",
      buttonLink: nil,
      variant: nil
    )
  )
}
#endif
