import SwiftUI

/// FAQ-style section renderer that displays expandable question/answer pairs.
/// Standalone SwiftUI view — reusable at top level, inside Container slots,
/// and inside Section wrappers.
struct RelatedQuestionsView: View {
  let section: RelatedQuestionsSection

  @State private var expandedItems: Set<String> = []

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      headingView
      questionsList
    }
    .padding(.vertical, 20)
    .padding(.horizontal, 24)
    .frame(maxWidth: .infinity, alignment: .leading)
    .accessibilityElement(children: .contain)
  }
}

// MARK: - Heading

private extension RelatedQuestionsView {
  @ViewBuilder
  var headingView: some View {
    if let heading = section.heading, !heading.isEmpty {
      Text(heading)
        .font(.title2.bold())
        .foregroundStyle(Color.primary)
        .accessibilityAddTraits(.isHeader)
        .accessibilityLabel(heading)
        .padding(.bottom, 16)
    }
  }
}

// MARK: - Questions List

private extension RelatedQuestionsView {
  var questionsList: some View {
    VStack(alignment: .leading, spacing: 0) {
      ForEach(section.questions, id: \.id) { item in
        questionRow(item)
        if item.id != section.questions.last?.id {
          Divider()
        }
      }
    }
  }

  func questionRow(_ item: RelatedQuestionItem) -> some View {
    let isExpanded = expandedItems.contains(item.id)
    return DisclosureGroup(
      isExpanded: Binding(
        get: { expandedItems.contains(item.id) },
        set: { newValue in
          if newValue {
            expandedItems.insert(item.id)
          } else {
            expandedItems.remove(item.id)
          }
        }
      )
    ) {
      Text(item.answer)
        .font(.body)
        .foregroundStyle(.secondary)
        .lineSpacing(4)
        .padding(.top, 8)
        .padding(.bottom, 12)
        .accessibilityLabel(item.answer)
    } label: {
      Text(item.question)
        .font(.headline)
        .foregroundStyle(Color.primary)
        .padding(.vertical, 12)
        .accessibilityLabel(item.question)
        .accessibilityHint(isExpanded ? "Collapse to hide answer" : "Expand to show answer")
    }
  }
}

// MARK: - Previews

#if DEBUG
#Preview("With heading") {
  ScrollView {
    RelatedQuestionsView(section: RelatedQuestionsSection(
      id: "preview-1",
      sectionKey: nil,
      heading: "Frequently Asked Questions",
      questions: [
        RelatedQuestionItem(
          id: "q1",
          question: "What is the JESUS film?",
          answer: "A two-hour docudrama about the life of Christ based on Luke."
        ),
        RelatedQuestionItem(
          id: "q2",
          question: "How many languages is it available in?",
          answer: "Translated into over 2,000 languages worldwide."
        ),
        RelatedQuestionItem(
          id: "q3",
          question: "How can I watch it?",
          answer: "Stream for free on jesusfilm.org or the Jesus Film Project app."
        )
      ]
    ))
  }
}

#Preview("Without heading") {
  ScrollView {
    RelatedQuestionsView(section: RelatedQuestionsSection(
      id: "preview-2",
      sectionKey: nil,
      heading: nil,
      questions: [
        RelatedQuestionItem(
          id: "q1",
          question: "Can I use this content in my church?",
          answer: "Yes, all content is free to use for ministry purposes."
        ),
        RelatedQuestionItem(
          id: "q2",
          question: "Is there a cost?",
          answer: "No, all videos and resources are provided free of charge."
        )
      ]
    ))
  }
}

#Preview("Single question") {
  ScrollView {
    RelatedQuestionsView(section: RelatedQuestionsSection(
      id: "preview-3",
      sectionKey: nil,
      heading: "About Easter",
      questions: [
        RelatedQuestionItem(
          id: "q1",
          question: "What is the meaning of Easter?",
          answer: "Easter celebrates the resurrection of Jesus Christ from the dead."
        )
      ]
    ))
  }
}
#endif
