import SwiftUI

struct TextSectionView: View {
  let section: TextSection

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      headingView
      subtitleView
      contentView
    }
    .padding(containerPadding)
    .frame(maxWidth: .infinity, alignment: .leading)
    .accessibilityElement(children: .contain)
  }
}

// MARK: - Heading

private extension TextSectionView {
  @ViewBuilder
  var headingView: some View {
    if let heading = section.heading, !heading.isEmpty {
      Text(heading)
        .font(headingFont)
        .foregroundStyle(Color.primary)
        .accessibilityAddTraits(.isHeader)
        .accessibilityLabel(heading)
    }
  }

  var headingFont: Font {
    switch section.headingLevel ?? .h2 {
    case .h1: .system(size: 32, weight: .bold)
    case .h2: .system(size: 28, weight: .bold)
    case .h3: .system(size: 24, weight: .semibold)
    case .h4: .system(size: 20, weight: .semibold)
    case .h5: .system(size: 18, weight: .semibold)
    case .h6: .system(size: 16, weight: .semibold)
    }
  }
}

// MARK: - Subtitle

private extension TextSectionView {
  @ViewBuilder
  var subtitleView: some View {
    if let subtitle = section.subtitle, !subtitle.isEmpty {
      Text(subtitle)
        .font(.system(size: 16, weight: .medium))
        .foregroundStyle(.secondary)
        .accessibilityLabel(subtitle)
    }
  }
}

// MARK: - Content Paragraphs

private extension TextSectionView {
  @ViewBuilder
  var contentView: some View {
    if !section.contentParagraphs.isEmpty {
      VStack(alignment: .leading, spacing: 12) {
        ForEach(
          Array(section.contentParagraphs.enumerated()),
          id: \.offset
        ) { _, paragraph in
          Text(paragraph)
            .font(contentFont)
            .foregroundStyle(contentColor)
            .lineSpacing(contentLineSpacing)
        }
      }
    }
  }

  var contentFont: Font {
    switch section.variant ?? .default {
    case .lead: .system(size: 20)
    case .small: .system(size: 14)
    case .default: .system(size: 16)
    }
  }

  var contentColor: Color {
    Color(.label).opacity(0.85)
  }

  var contentLineSpacing: CGFloat {
    switch section.variant ?? .default {
    case .lead: 6
    case .small: 2
    case .default: 4
    }
  }
}

// MARK: - Variant Styling

private extension TextSectionView {
  var containerPadding: EdgeInsets {
    switch section.variant ?? .default {
    case .lead:
      EdgeInsets(top: 32, leading: 24, bottom: 32, trailing: 24)
    case .small:
      EdgeInsets(top: 12, leading: 16, bottom: 12, trailing: 16)
    case .default:
      EdgeInsets(top: 20, leading: 24, bottom: 20, trailing: 24)
    }
  }
}
