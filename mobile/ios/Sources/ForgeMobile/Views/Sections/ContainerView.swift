import SwiftUI

/// Renders a Container section as an adaptive grid layout.
/// Each slot occupies a proportion of the 12-column grid based on its `gridSpan`.
/// On compact widths (iPhone portrait), slots stack vertically.
struct ContainerView: View {
  let section: ContainerSection

  @Environment(\.horizontalSizeClass) private var sizeClass

  var body: some View {
    if sizeClass == .compact {
      compactLayout
    } else {
      regularLayout
    }
  }

  /// Vertical stack for compact width (iPhone portrait).
  private var compactLayout: some View {
    VStack(spacing: 16) {
      ForEach(section.slots, id: \.id) { slot in
        SlotContentView(slot: slot)
      }
    }
    .padding(.horizontal, 16)
    .accessibilityElement(children: .contain)
    .accessibilityLabel("Content container with \(section.slots.count) sections")
  }

  /// Horizontal grid for regular width (iPad, landscape).
  private var regularLayout: some View {
    GeometryReader { geometry in
      let spacing: CGFloat = 16
      let totalSpacing = spacing * CGFloat(max(section.slots.count - 1, 0))
      let availableWidth = geometry.size.width - 32 - totalSpacing

      HStack(alignment: .top, spacing: spacing) {
        ForEach(section.slots, id: \.id) { slot in
          SlotContentView(slot: slot)
            .frame(width: slotWidth(
              gridSpan: slot.gridSpan,
              availableWidth: availableWidth
            ))
        }
      }
      .padding(.horizontal, 16)
      .frame(maxWidth: .infinity, alignment: .leading)
    }
    .accessibilityElement(children: .contain)
    .accessibilityLabel("Content container with \(section.slots.count) sections")
  }

  private func slotWidth(gridSpan: Int, availableWidth: CGFloat) -> CGFloat {
    let clamped = max(1, min(gridSpan, 12))
    return availableWidth * CGFloat(clamped) / 12.0
  }
}

// MARK: - Slot content renderer

/// Renders the leaf content items within a single container slot.
private struct SlotContentView: View {
  let slot: ContainerSlot

  var body: some View {
    VStack(spacing: 12) {
      ForEach(slot.content, id: \.id) { content in
        SectionContentView(content: content)
      }
    }
  }
}

// MARK: - Previews

#if DEBUG
#Preview("Container – Two Equal Slots (50/50)") {
  ScrollView {
    ContainerView(
      section: ContainerSection(
        id: "preview-equal",
        sectionKey: nil,
        slots: [
          ContainerSlot(
            id: "slot-1",
            gridSpan: 6,
            content: [
              .cta(CTASection(
                id: "cta-1", sectionKey: nil,
                heading: "Left Slot",
                body: "This occupies 6 of 12 columns.",
                buttonLabel: "Action", buttonLink: nil,
                variant: .primary
              ))
            ]
          ),
          ContainerSlot(
            id: "slot-2",
            gridSpan: 6,
            content: [
              .cta(CTASection(
                id: "cta-2", sectionKey: nil,
                heading: "Right Slot",
                body: "This also occupies 6 of 12 columns.",
                buttonLabel: "Action", buttonLink: nil,
                variant: .secondary
              ))
            ]
          ),
        ]
      )
    )
  }
}

#Preview("Container – Asymmetric (4/8)") {
  ScrollView {
    ContainerView(
      section: ContainerSection(
        id: "preview-asymmetric",
        sectionKey: nil,
        slots: [
          ContainerSlot(
            id: "slot-1",
            gridSpan: 4,
            content: [
              .card(CardSection(
                id: "card-1", sectionKey: nil,
                title: "Narrow Slot",
                description: "4 columns wide.",
                media: nil, link: nil, variant: .default
              ))
            ]
          ),
          ContainerSlot(
            id: "slot-2",
            gridSpan: 8,
            content: [
              .text(TextSection(
                id: "text-1", sectionKey: nil,
                heading: "Wide Slot",
                headingLevel: .h2, subtitle: nil,
                contentParagraphs: ["This slot takes 8 of 12 columns."],
                variant: .default
              ))
            ]
          ),
        ]
      )
    )
  }
}

#endif
