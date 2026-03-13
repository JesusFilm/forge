import SwiftUI

/// Standalone CTA section renderer. Displays a heading, body text,
/// and an action button with an orange-to-red gradient background.
/// Reusable at top level, inside Container slots, and Section wrappers.
struct CTAView: View {
  let section: CTASection

  private var gradientColors: [Color] {
    if section.variant == .secondary {
      return [Color.orange, Color.orange.opacity(0.8)]
    }
    return [Color.orange, Color.red]
  }

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
  }

  @ViewBuilder
  private var ctaButton: some View {
    if let link = section.buttonLink, !link.isEmpty,
       let url = URL(string: link) {
      Link(destination: url) { gradientButtonContent }
        .accessibilityLabel(section.buttonLabel)
        .accessibilityAddTraits(.isLink)
    } else {
      Button(action: {}) { gradientButtonContent }
        .accessibilityLabel(section.buttonLabel)
    }
  }

  private var gradientButtonContent: some View {
    Text(section.buttonLabel)
      .fontWeight(.semibold)
      .foregroundStyle(.white)
      .frame(minWidth: 120)
      .padding(.horizontal, 24)
      .padding(.vertical, 20)
      .background(
        LinearGradient(
          colors: gradientColors,
          startPoint: .leading,
          endPoint: .trailing
        )
      )
      .clipShape(RoundedRectangle(cornerRadius: 12))
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
