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
    case .h1: .largeTitle.bold()
    case .h2: .title.bold()
    case .h3: .title2.weight(.semibold)
    case .h4: .title3.weight(.semibold)
    case .h5: .headline
    case .h6: .subheadline.weight(.semibold)
    }
  }
}

// MARK: - Subtitle

private extension TextSectionView {
  @ViewBuilder
  var subtitleView: some View {
    if let subtitle = section.subtitle, !subtitle.isEmpty {
      Text(subtitle)
        .font(.subheadline.weight(.medium))
        .foregroundStyle(.secondary)
        .fixedSize(horizontal: false, vertical: true)
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
        ForEach(section.contentParagraphs, id: \.self) { paragraph in
          Text(paragraph)
            .font(contentFont)
            .foregroundStyle(contentColor)
            .lineSpacing(contentLineSpacing)
            .fixedSize(horizontal: false, vertical: true)
        }
      }
    }
  }

  var contentFont: Font {
    switch section.variant ?? .default {
    case .lead: .title3
    case .small: .footnote
    case .default: .body
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

// MARK: - Previews

#if DEBUG
#Preview("Default variant") {
  ScrollView {
    TextSectionView(section: TextSection(
      id: "preview-default",
      sectionKey: nil,
      heading: "The Story of Easter",
      headingLevel: .h2,
      subtitle: "A journey of hope and redemption",
      contentParagraphs: [
        "Easter is one of the most significant celebrations in the Christian faith, commemorating the resurrection of Jesus Christ.",
        "This event is central to Christian belief, representing hope, renewal, and the promise of eternal life."
      ],
      variant: .default
    ))
  }
}

#Preview("Lead variant") {
  ScrollView {
    TextSectionView(section: TextSection(
      id: "preview-lead",
      sectionKey: nil,
      heading: "Featured Message",
      headingLevel: .h1,
      subtitle: nil,
      contentParagraphs: [
        "Experience the greatest story ever told through the eyes of those who witnessed it firsthand."
      ],
      variant: .lead
    ))
  }
}

#Preview("Small variant") {
  ScrollView {
    TextSectionView(section: TextSection(
      id: "preview-small",
      sectionKey: nil,
      heading: "Additional Info",
      headingLevel: .h5,
      subtitle: "Details",
      contentParagraphs: [
        "Available in over 2,000 languages worldwide.",
        "Viewed by billions of people since 1979."
      ],
      variant: .small
    ))
  }
}

#Preview("All heading levels") {
  ScrollView {
    VStack(spacing: 0) {
      ForEach(
        [TextHeadingLevel.h1, .h2, .h3, .h4, .h5, .h6],
        id: \.rawValue
      ) { level in
        TextSectionView(section: TextSection(
          id: "preview-\(level.rawValue)",
          sectionKey: nil,
          heading: "Heading \(level.rawValue.uppercased())",
          headingLevel: level,
          subtitle: nil,
          contentParagraphs: ["Sample paragraph for \(level.rawValue)."],
          variant: .default
        ))
        Divider()
      }
    }
  }
}
#endif
