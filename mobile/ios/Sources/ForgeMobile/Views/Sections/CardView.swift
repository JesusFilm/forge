import SwiftUI

/// Standalone Card section renderer. Displays an optional image, title,
/// description, and optional link. Supports `default` and `featured` variants.
/// Reusable at top level, inside Container slots, and Section wrappers.
struct CardView: View {
  let section: CardSection

  var body: some View {
    cardContent
      .background(Color(.secondarySystemGroupedBackground))
      .clipShape(RoundedRectangle(cornerRadius: 12))
      .shadow(color: .black.opacity(0.08), radius: isFeatured ? 8 : 4, y: 2)
      .accessibilityElement(children: .contain)
  }
}

// MARK: - Subviews

private extension CardView {
  var isFeatured: Bool {
    section.variant == .featured
  }

  @ViewBuilder
  var cardContent: some View {
    if let link = section.link, !link.isEmpty, let url = URL(string: link) {
      Link(destination: url) {
        cardLayout
      }
      .accessibilityAddTraits(.isLink)
    } else {
      cardLayout
    }
  }

  var cardLayout: some View {
    VStack(alignment: .leading, spacing: 0) {
      cardImage
      textContent
    }
  }

  @ViewBuilder
  var cardImage: some View {
    if let media = section.media, let url = URL(string: media.url) {
      AsyncImage(url: url) { phase in
        switch phase {
        case .success(let image):
          image
            .resizable()
            .aspectRatio(contentMode: .fill)
        case .failure:
          imagePlaceholder
        @unknown default:
          imagePlaceholder
        }
      }
      .frame(height: isFeatured ? 220 : 160)
      .clipped()
      .accessibilityLabel(media.alternativeText ?? section.title)
    }
  }

  var imagePlaceholder: some View {
    Rectangle()
      .fill(Color(.tertiarySystemFill))
      .overlay {
        Image(systemName: "photo")
          .font(.title2)
          .foregroundStyle(.tertiary)
      }
  }

  var textContent: some View {
    VStack(alignment: .leading, spacing: isFeatured ? 8 : 6) {
      Text(section.title)
        .font(isFeatured ? .title3.bold() : .headline)
        .foregroundStyle(.primary)
        .accessibilityAddTraits(.isHeader)

      Text(section.description)
        .font(isFeatured ? .body : .subheadline)
        .foregroundStyle(.secondary)
        .lineLimit(isFeatured ? 4 : 3)
    }
    .padding(isFeatured ? 20 : 16)
    .frame(maxWidth: .infinity, alignment: .leading)
  }
}

// MARK: - Previews

#if DEBUG
#Preview("Card – Default") {
  ScrollView {
    CardView(
      section: CardSection(
        id: "preview-1",
        sectionKey: nil,
        title: "The Story of Easter",
        description: "Explore the meaning of Easter through short films and stories.",
        media: UploadFileModel(
          url: "https://images.unsplash.com/photo-1507692049790-de58290a4334",
          alternativeText: "Easter sunrise"
        ),
        link: "https://www.jesusfilm.org/watch/easter.html",
        variant: .default
      )
    )
    .padding()
  }
}

#Preview("Card – Featured") {
  ScrollView {
    CardView(
      section: CardSection(
        id: "preview-2",
        sectionKey: nil,
        title: "Christmas Collection",
        description: "A curated collection of films celebrating the birth of Jesus.",
        media: UploadFileModel(
          url: "https://images.unsplash.com/photo-1512389142860-9c449e58a814",
          alternativeText: "Christmas nativity scene"
        ),
        link: "https://www.jesusfilm.org/watch/christmas.html",
        variant: .featured
      )
    )
    .padding()
  }
}

#Preview("Card – No Image, No Link") {
  ScrollView {
    CardView(
      section: CardSection(
        id: "preview-3",
        sectionKey: nil,
        title: "Coming Soon",
        description: "New content will be available here shortly.",
        media: nil,
        link: nil,
        variant: nil
      )
    )
    .padding()
  }
}
#endif
