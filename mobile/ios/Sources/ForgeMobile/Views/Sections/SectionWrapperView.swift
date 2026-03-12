import SwiftUI

/// Renders a Section wrapper — a structural component that applies background
/// styling (color and/or blurHash image) and recursively renders nested content.
/// Handles full 3-level nesting: Section → Container → leaf.
struct SectionWrapperView: View {
  let section: SectionWrapperSection
  private let blurHashImage: Image?
  @Environment(\.colorScheme) private var inheritedColorScheme

  init(section: SectionWrapperSection) {
    self.section = section
    self.blurHashImage = section.blurHash.flatMap {
      BlurHashDecoder.image(blurHash: $0, width: 32, height: 32)
    }
  }

  var body: some View {
    VStack(spacing: 16) {
      ForEach(section.content, id: \.id) { content in
        SectionContentView(content: content)
      }
    }
    .padding(.vertical, 24)
    .frame(maxWidth: .infinity)
    .environment(\.colorScheme, colorSchemeForBackground)
    .background(backgroundView)
    .accessibilityElement(children: .contain)
    .accessibilityLabel(accessibilityDescription)
  }

  // MARK: - Color Scheme

  private var colorSchemeForBackground: ColorScheme {
    switch section.backgroundColor {
    case .dark:
      return .dark
    case .light, .primary:
      return .light
    case .default, .none:
      return inheritedColorScheme
    }
  }

  // MARK: - Background

  @ViewBuilder
  private var backgroundView: some View {
    ZStack {
      backgroundColor
      blurHashBackground
    }
  }

  private var backgroundColor: Color {
    guard let background = section.backgroundColor else { return .clear }
    switch background {
    case .default:
      return .clear
    case .light:
      return Color(.systemGray6)
    case .dark:
      return Color(red: 0.12, green: 0.10, blue: 0.08).opacity(0.6)
    case .primary:
      return Color(red: 0.85, green: 0.55, blue: 0.10)
    }
  }

  @ViewBuilder
  private var blurHashBackground: some View {
    if let image = blurHashImage {
      image
        .resizable()
        .scaledToFill()
        .clipped()
        .opacity(0.6)
    }
  }

  // MARK: - Accessibility

  private var accessibilityDescription: String {
    let bgName = section.backgroundColor?.rawValue ?? "default"
    let count = section.content.count
    let itemLabel = count == 1 ? "content item" : "content items"
    return "Section with \(bgName) background, \(count) \(itemLabel)"
  }
}

// MARK: - Previews

#if DEBUG
#Preview("Section Wrapper – Dark Background") {
  ScrollView {
    SectionWrapperView(
      section: SectionWrapperSection(
        id: "preview-dark",
        sectionKey: nil,
        backgroundColor: .dark,
        blurHash: nil,
        content: [
          .text(TextSection(
            id: "text-1", sectionKey: nil,
            heading: "The True Meaning of Easter",
            headingLevel: .h2, subtitle: "JESUS' VICTORY OVER SIN AND DEATH",
            contentParagraphs: [
              "Easter is about more than eggs and bunnies—it's about Jesus and His amazing love."
            ],
            variant: .default
          )),
          .relatedQuestions(RelatedQuestionsSection(
            id: "rq-1", sectionKey: nil,
            heading: "Related Questions",
            questions: [
              RelatedQuestionItem(
                id: "q1",
                question: "Why is Easter the most important Christian holiday?",
                answer: "Easter celebrates the resurrection of Jesus Christ."
              ),
              RelatedQuestionItem(
                id: "q2",
                question: "What happened during the three days?",
                answer: "Jesus was crucified, buried, and rose from the dead."
              )
            ]
          ))
        ]
      )
    )
  }
}

#Preview("Section Wrapper – Light Background") {
  ScrollView {
    SectionWrapperView(
      section: SectionWrapperSection(
        id: "preview-light",
        sectionKey: nil,
        backgroundColor: .light,
        blurHash: nil,
        content: [
          .cta(CTASection(
            id: "cta-1", sectionKey: nil,
            heading: "What's your next step of faith?",
            body: "Explore resources to grow deeper.",
            buttonLabel: "Learn More", buttonLink: "/watch",
            variant: .primary
          ))
        ]
      )
    )
  }
}

#Preview("Section Wrapper – Primary with BlurHash") {
  ScrollView {
    SectionWrapperView(
      section: SectionWrapperSection(
        id: "preview-blur",
        sectionKey: nil,
        backgroundColor: .primary,
        blurHash: "LEHV6nWB2yk8pyo0adR*.7kCMdnj",
        content: [
          .card(CardSection(
            id: "card-1", sectionKey: nil,
            title: "Free Resources",
            description: "Want to grow deep in your understanding of the Bible?",
            media: nil, link: nil, variant: .featured
          ))
        ]
      )
    )
  }
}

#Preview("Section Wrapper – Container Nesting") {
  ScrollView {
    SectionWrapperView(
      section: SectionWrapperSection(
        id: "preview-nested",
        sectionKey: nil,
        backgroundColor: .dark,
        blurHash: nil,
        content: [
          .container(ContainerSection(
            id: "container-1",
            sectionKey: nil,
            slots: [
              ContainerSlot(
                id: "slot-1",
                gridSpan: 6,
                content: [
                  .text(TextSection(
                    id: "text-nested", sectionKey: nil,
                    heading: "Left Column",
                    headingLevel: .h3, subtitle: nil,
                    contentParagraphs: ["Content in a container inside a section wrapper."],
                    variant: .default
                  ))
                ]
              ),
              ContainerSlot(
                id: "slot-2",
                gridSpan: 6,
                content: [
                  .cta(CTASection(
                    id: "cta-nested", sectionKey: nil,
                    heading: "Right Column",
                    body: "A CTA in the second slot.",
                    buttonLabel: "Action", buttonLink: nil,
                    variant: .secondary
                  ))
                ]
              )
            ]
          ))
        ]
      )
    )
  }
}
#endif
