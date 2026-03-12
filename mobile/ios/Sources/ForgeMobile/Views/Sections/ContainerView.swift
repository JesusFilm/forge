import SwiftUI

/// Renders a Container section as an adaptive grid layout.
/// Each slot occupies a proportion of the 12-column grid based on its `gridSpan`.
/// On compact widths (iPhone portrait), slots stack vertically.
struct ContainerView: View {
  let section: ContainerSection

  @Environment(\.horizontalSizeClass) private var horizontalSizeClass
  @State private var contentHeight: CGFloat = 0

  var body: some View {
    if horizontalSizeClass == .compact {
      compactLayout
    } else {
      GeometryReader { proxy in
        regularLayout(availableWidth: proxy.size.width)
      }
      .frame(height: contentHeight > 0 ? contentHeight : nil)
      .onPreferenceChange(ContainerHeightKey.self) { contentHeight = $0 }
    }
  }

  /// Vertical stack for narrow widths (iPhone, iPad split-view).
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

  /// Multi-column grid for wide widths (iPad full-screen, landscape).
  /// Packs slots into rows of max 12 columns; overflows wrap to next row.
  private func regularLayout(availableWidth: CGFloat) -> some View {
    let rows = packRows(from: section.slots)
    let spacing: CGFloat = 16

    return VStack(alignment: .leading, spacing: spacing) {
      ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
        let rowSpacing = spacing * CGFloat(max(row.count - 1, 0))
        let rowWidth = availableWidth - 32 - rowSpacing

        HStack(alignment: .top, spacing: spacing) {
          ForEach(row, id: \.id) { slot in
            SlotContentView(slot: slot)
              .frame(width: slotWidth(
                gridSpan: slot.gridSpan,
                availableWidth: rowWidth
              ))
          }
        }
      }
    }
    .padding(.horizontal, 16)
    .frame(maxWidth: .infinity, alignment: .leading)
    .accessibilityElement(children: .contain)
    .accessibilityLabel("Content container with \(section.slots.count) sections")
    .reportHeight(ContainerHeightKey.self)
  }

  /// Groups slots into rows where cumulative gridSpan does not exceed 12.
  private func packRows(from slots: [ContainerSlot]) -> [[ContainerSlot]] {
    var rows: [[ContainerSlot]] = []
    var currentRow: [ContainerSlot] = []
    var currentSpan = 0

    for slot in slots {
      let span = max(1, min(slot.gridSpan, 12))
      if !currentRow.isEmpty && currentSpan + span > 12 {
        rows.append(currentRow)
        currentRow = []
        currentSpan = 0
      }
      currentRow.append(slot)
      currentSpan += span
    }
    if !currentRow.isEmpty { rows.append(currentRow) }
    return rows
  }

  private func slotWidth(gridSpan: Int, availableWidth: CGFloat) -> CGFloat {
    let clamped = max(1, min(gridSpan, 12))
    return availableWidth * CGFloat(clamped) / 12.0
  }
}

// MARK: - Height measurement (regular layout only)

/// Collects the measured content height from inside the regular-layout
/// GeometryReader so the outer frame can report intrinsic height.
private struct ContainerHeightKey: PreferenceKey {
  static var defaultValue: CGFloat = 0
  static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
    value = max(value, nextValue())
  }
}

private extension View {
  func reportHeight<K: PreferenceKey>(_ key: K.Type) -> some View where K.Value == CGFloat {
    background(
      GeometryReader { geo in
        Color.clear.preference(key: key, value: geo.size.height)
      }
    )
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
