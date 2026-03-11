import SwiftUI

/// Visual style for media collection item cards.
enum MediaCollectionItemStyle {
  /// Default carousel card (portrait, ~180x260).
  case standard
  /// Compact card for grid layout.
  case compact
  /// Wider card for collection variant (~200x280).
  case collection
  /// Large featured card for hero variant (~300x400).
  case hero
}

/// Individual media item card with thumbnail, category label, title,
/// and optional collection size badge. Used inside MediaCollectionView.
/// Note: `linkToSectionKey` navigation handling is deferred to a future PR.
struct MediaCollectionItemView: View {
  let item: MediaCollectionItem
  let itemNumber: Int?
  let style: MediaCollectionItemStyle

  var body: some View {
    ZStack(alignment: .bottomLeading) {
      backgroundLayer
      contentOverlay
      badgeOverlay
    }
    .modifier(CardFrameModifier(style: style))
    .clipShape(RoundedRectangle(cornerRadius: 12))
    .accessibilityElement(children: .combine)
    .accessibilityLabel(accessibilityText)
  }
}

// MARK: - Dimensions

/// Applies the correct frame sizing per card style.
private struct CardFrameModifier: ViewModifier {
  let style: MediaCollectionItemStyle

  func body(content: Content) -> some View {
    switch style {
    case .compact:
      content.frame(maxWidth: .infinity, minHeight: 200, idealHeight: 200)
    case .standard:
      content.frame(width: 180, height: 260)
    case .collection:
      content.frame(width: 200, height: 280)
    case .hero:
      content.frame(width: 300, height: 400)
    }
  }
}

// MARK: - Background

private extension MediaCollectionItemView {
  @ViewBuilder
  var backgroundLayer: some View {
    if let url = resolvedImageURL {
      AsyncImage(url: url) { phase in
        switch phase {
        case .success(let image):
          image
            .resizable()
            .aspectRatio(contentMode: .fill)
        default:
          darkFallback
        }
      }
      .overlay(gradientOverlay)
    } else {
      darkFallback
    }
  }

  var resolvedImageURL: URL? {
    if let override = item.imageOverride, let url = URL(string: override.url) {
      return url
    }
    if let videoImage = item.video?.image, let url = URL(string: videoImage.url) {
      return url
    }
    return nil
  }

  var darkFallback: some View {
    LinearGradient(
      colors: [Color(white: 0.18), Color(white: 0.10)],
      startPoint: .topLeading,
      endPoint: .bottomTrailing
    )
  }

  var gradientOverlay: some View {
    LinearGradient(
      stops: [
        .init(color: .clear, location: 0.0),
        .init(color: .black.opacity(0.25), location: 0.45),
        .init(color: .black.opacity(0.75), location: 1.0)
      ],
      startPoint: .top,
      endPoint: .bottom
    )
  }
}

// MARK: - Content Overlay

private extension MediaCollectionItemView {
  var contentOverlay: some View {
    VStack(alignment: .leading, spacing: 4) {
      Spacer()
      categoryLabel
      titleLabel
    }
    .padding(14)
  }

  @ViewBuilder
  var categoryLabel: some View {
    if let label = resolvedSubtitle, !label.isEmpty {
      Text(label.uppercased())
        .font(.caption2.weight(.semibold))
        .foregroundStyle(.white.opacity(0.75))
        .tracking(0.8)
        .lineLimit(1)
    }
  }

  @ViewBuilder
  var titleLabel: some View {
    if let title = resolvedTitle, !title.isEmpty {
      Text(title)
        .font(style == .hero ? .title3.weight(.semibold) : .subheadline.weight(.semibold))
        .foregroundStyle(.white)
        .lineLimit(style == .hero ? 3 : 2)
    }
  }

  var resolvedTitle: String? {
    item.titleOverride ?? item.video?.title
  }

  var resolvedSubtitle: String? {
    item.subtitleOverride
  }
}

// MARK: - Badge Overlay

private extension MediaCollectionItemView {
  @ViewBuilder
  var badgeOverlay: some View {
    VStack {
      HStack {
        if let number = itemNumber {
          numberBadge(number)
        }
        Spacer()
        if let size = item.collectionSize, !size.isEmpty {
          collectionSizeBadge(size)
        }
      }
      .padding(10)
      Spacer()
    }
  }

  func numberBadge(_ number: Int) -> some View {
    Text("\(number)")
      .font(.caption.weight(.bold))
      .foregroundStyle(.white)
      .frame(width: 24, height: 24)
      .background(Color.black.opacity(0.6))
      .clipShape(Circle())
  }

  func collectionSizeBadge(_ size: String) -> some View {
    Text(size)
      .font(.caption2.weight(.semibold))
      .foregroundStyle(.white)
      .padding(.horizontal, 8)
      .padding(.vertical, 4)
      .background(.ultraThinMaterial)
      .clipShape(Capsule())
  }
}

// MARK: - Accessibility

private extension MediaCollectionItemView {
  var accessibilityText: String {
    var parts: [String] = []
    if let number = itemNumber {
      // swiftlint:disable:next todo
      parts.append("Item \(number)") // TODO: localize
    }
    if let title = resolvedTitle {
      parts.append(title)
    }
    if let subtitle = resolvedSubtitle {
      parts.append(subtitle)
    }
    if let size = item.collectionSize {
      parts.append(size)
    }
    return parts.joined(separator: ", ")
  }
}

// MARK: - Previews

#if DEBUG
#Preview("Standard carousel items") {
  ScrollView(.horizontal) {
    HStack(spacing: 16) {
      MediaCollectionItemView(
        item: MediaCollectionItem(
          id: "1", titleOverride: "The True Meaning of Easter",
          subtitleOverride: "SHORT VIDEO", collectionSize: nil,
          linkToSectionKey: nil, imageOverride: nil, video: nil
        ),
        itemNumber: nil, style: .standard
      )
      MediaCollectionItemView(
        item: MediaCollectionItem(
          id: "2", titleOverride: "JESUS",
          subtitleOverride: "FEATURE FILM", collectionSize: "61 chapters",
          linkToSectionKey: nil, imageOverride: nil, video: nil
        ),
        itemNumber: nil, style: .standard
      )
    }
    .padding()
  }
  .background(Color.black)
}

#Preview("Hero item") {
  ScrollView(.horizontal) {
    MediaCollectionItemView(
      item: MediaCollectionItem(
        id: "1", titleOverride: "How Did Jesus Die?",
        subtitleOverride: "SHORT VIDEO", collectionSize: nil,
        linkToSectionKey: nil, imageOverride: nil, video: nil
      ),
      itemNumber: nil, style: .hero
    )
    .padding()
  }
  .background(Color.black)
}

#Preview("Numbered items") {
  ScrollView(.horizontal) {
    HStack(spacing: 16) {
      MediaCollectionItemView(
        item: MediaCollectionItem(
          id: "1", titleOverride: "Yakhal / Hope",
          subtitleOverride: "EPISODE", collectionSize: nil,
          linkToSectionKey: nil, imageOverride: nil, video: nil
        ),
        itemNumber: 1, style: .standard
      )
      MediaCollectionItemView(
        item: MediaCollectionItem(
          id: "2", titleOverride: "Shalom / Peace",
          subtitleOverride: "EPISODE", collectionSize: nil,
          linkToSectionKey: nil, imageOverride: nil, video: nil
        ),
        itemNumber: 2, style: .standard
      )
    }
    .padding()
  }
  .background(Color.black)
}
#endif
