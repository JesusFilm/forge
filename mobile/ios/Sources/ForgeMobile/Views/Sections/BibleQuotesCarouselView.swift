import SwiftUI

/// Horizontal carousel of Scripture quotes with background images and optional CTAs.
/// Standalone SwiftUI view — reusable at top level, inside Container slots,
/// and inside Section wrappers.
struct BibleQuotesCarouselView: View {
  let section: BibleQuotesCarouselSection

  var body: some View {
    VStack(alignment: .leading, spacing: 16) {
      headingView
      carouselView
    }
    .padding(.vertical, 24)
    .frame(maxWidth: .infinity, alignment: .leading)
    .accessibilityElement(children: .contain)
  }
}

// MARK: - Heading

private extension BibleQuotesCarouselView {
  @ViewBuilder
  var headingView: some View {
    if let heading = section.heading, !heading.isEmpty {
      Text(heading.uppercased())
        .font(.subheadline.weight(.semibold))
        .foregroundStyle(.secondary)
        .tracking(1.2)
        .padding(.horizontal, 24)
        .accessibilityAddTraits(.isHeader)
        .accessibilityLabel(heading)
    }
  }
}

// MARK: - Carousel

private extension BibleQuotesCarouselView {
  var carouselView: some View {
    ScrollView(.horizontal, showsIndicators: false) {
      LazyHStack(spacing: 16) {
        ForEach(section.quotes, id: \.id) { quote in
          BibleQuoteCardView(quote: quote)
        }
      }
      .padding(.horizontal, 24)
    }
  }
}

// MARK: - Quote Card

/// Individual quote card with background image, reference, quote text, and optional CTA.
private struct BibleQuoteCardView: View {
  let quote: BibleQuoteItem

  private let cardWidth: CGFloat = 300
  private let cardHeight: CGFloat = 360

  var body: some View {
    ZStack(alignment: .bottomLeading) {
      backgroundLayer
      contentOverlay
    }
    .frame(width: cardWidth, height: cardHeight)
    .clipShape(RoundedRectangle(cornerRadius: 16))
    .accessibilityElement(children: .combine)
    .accessibilityLabel(accessibilityText)
  }
}

// MARK: - Card Background

private extension BibleQuoteCardView {
  @ViewBuilder
  var backgroundLayer: some View {
    if let image = quote.backgroundImage, let url = URL(string: image.url) {
      AsyncImage(url: url) { phase in
        switch phase {
        case .success(let loadedImage):
          loadedImage
            .resizable()
            .aspectRatio(contentMode: .fill)
        default:
          darkFallbackBackground
        }
      }
      .frame(width: cardWidth, height: cardHeight)
      .clipped()
      .overlay(gradientOverlay)
    } else {
      darkFallbackBackground
    }
  }

  var darkFallbackBackground: some View {
    LinearGradient(
      colors: [Color(white: 0.15), Color(white: 0.1)],
      startPoint: .topLeading,
      endPoint: .bottomTrailing
    )
  }

  var gradientOverlay: some View {
    LinearGradient(
      stops: [
        .init(color: .clear, location: 0.0),
        .init(color: .black.opacity(0.3), location: 0.4),
        .init(color: .black.opacity(0.8), location: 1.0)
      ],
      startPoint: .top,
      endPoint: .bottom
    )
  }
}

// MARK: - Card Content

private extension BibleQuoteCardView {
  var contentOverlay: some View {
    VStack(alignment: .leading, spacing: 8) {
      Spacer()

      if let ctaLabel = quote.ctaLabel, !ctaLabel.isEmpty {
        ctaContent(label: ctaLabel)
      } else {
        quoteContent
      }
    }
    .padding(20)
  }

  var quoteContent: some View {
    VStack(alignment: .leading, spacing: 8) {
      Text(quote.reference.uppercased() + ":")
        .font(.caption.weight(.semibold))
        .foregroundStyle(.white.opacity(0.7))
        .tracking(0.5)

      Text(quote.text)
        .font(.body)
        .foregroundStyle(.white)
        .lineSpacing(4)
        .lineLimit(7)
        .truncationMode(.tail)

      if let attribution = quote.attribution, !attribution.isEmpty {
        Text(attribution)
          .font(.caption)
          .foregroundStyle(.white.opacity(0.6))
      }
    }
  }

  @ViewBuilder
  func ctaContent(label: String) -> some View {
    Text(label.uppercased())
      .font(.caption.weight(.semibold))
      .foregroundStyle(.white.opacity(0.7))
      .tracking(1.0)

    Text(quote.text)
      .font(.title3.weight(.semibold))
      .foregroundStyle(.white)
      .lineSpacing(4)
      .lineLimit(4)
      .truncationMode(.tail)

    if let link = quote.ctaLink, !link.isEmpty, let url = URL(string: link) {
      Link(destination: url) {
        HStack(spacing: 6) {
          Image(systemName: "plus.app")
            .font(.footnote)
          Text(label.uppercased())
            .font(.caption.weight(.semibold))
            .tracking(0.5)
        }
        .foregroundStyle(.white)
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .overlay(
          RoundedRectangle(cornerRadius: 8)
            .stroke(.white.opacity(0.5), lineWidth: 1)
        )
      }
      .padding(.top, 4)
      .accessibilityLabel(label)
      .accessibilityAddTraits(.isLink)
    }
  }

  var accessibilityText: String {
    var parts = [quote.reference, quote.text]
    if let attribution = quote.attribution, !attribution.isEmpty {
      parts.append(attribution)
    }
    if let ctaLabel = quote.ctaLabel, !ctaLabel.isEmpty {
      parts.append(ctaLabel)
    }
    return parts.joined(separator: ". ")
  }
}

// MARK: - Previews

#if DEBUG
#Preview("With heading") {
  ScrollView {
    BibleQuotesCarouselView(section: BibleQuotesCarouselSection(
      id: "preview-1",
      sectionKey: nil,
      heading: "Bible Quotes",
      quotes: [
        BibleQuoteItem(
          id: "q1",
          reference: "Jesus (Luke 23:43)",
          text: "Truly I tell you, today you will be with me in paradise.",
          backgroundImage: nil,
          ctaLabel: nil,
          ctaLink: nil,
          attribution: nil
        ),
        BibleQuoteItem(
          id: "q2",
          reference: "Jesus (Luke 23:34)",
          text: "Father, forgive them, for they do not know what they are doing.",
          backgroundImage: nil,
          ctaLabel: nil,
          ctaLink: nil,
          attribution: nil
        ),
        BibleQuoteItem(
          id: "q3",
          reference: "Isaiah 53:5",
          text: "But he was pierced for our transgressions, he was crushed for our iniquities.",
          backgroundImage: nil,
          ctaLabel: nil,
          ctaLink: nil,
          attribution: nil
        )
      ]
    ))
  }
  .background(Color.black)
  .preferredColorScheme(.dark)
}

#Preview("With CTA card") {
  ScrollView {
    BibleQuotesCarouselView(section: BibleQuotesCarouselSection(
      id: "preview-2",
      sectionKey: nil,
      heading: nil,
      quotes: [
        BibleQuoteItem(
          id: "q1",
          reference: "John 3:16",
          text: "For God so loved the world that he gave his one and only Son.",
          backgroundImage: nil,
          ctaLabel: nil,
          ctaLink: nil,
          attribution: nil
        ),
        BibleQuoteItem(
          id: "q2",
          reference: "Free Resources",
          text: "Want to grow deep in your understanding of the Bible?",
          backgroundImage: nil,
          ctaLabel: "Join Our Bible Study",
          ctaLink: "https://www.jesusfilm.org",
          attribution: nil
        )
      ]
    ))
  }
  .background(Color.black)
  .preferredColorScheme(.dark)
}

#Preview("Single quote") {
  ScrollView {
    BibleQuotesCarouselView(section: BibleQuotesCarouselSection(
      id: "preview-3",
      sectionKey: nil,
      heading: "Scripture",
      quotes: [
        BibleQuoteItem(
          id: "q1",
          reference: "Psalm 23:1",
          text: "The Lord is my shepherd, I lack nothing.",
          backgroundImage: nil,
          ctaLabel: nil,
          ctaLink: nil,
          attribution: "King David"
        )
      ]
    ))
  }
  .background(Color.black)
  .preferredColorScheme(.dark)
}
#endif
