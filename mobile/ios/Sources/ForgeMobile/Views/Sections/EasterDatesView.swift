import SwiftUI

/// Collapsible card showing Western Easter, Orthodox Easter, and Jewish Passover
/// dates for the current year. Labels come from CMS; dates are computed at runtime.
struct EasterDatesView: View {
  let section: EasterDatesSection

  @State private var isExpanded = false

  private var year: Int { Calendar.current.component(.year, from: Date()) }

  private var resolvedTitle: String {
    section.easterDatesTitle.replacingOccurrences(of: "{year}", with: "\(year)")
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      headerRow
      if isExpanded {
        datesContent
          .transition(.opacity.combined(with: .move(edge: .top)))
      }
    }
    .padding(20)
    .background(gradientBackground)
    .clipShape(RoundedRectangle(cornerRadius: 16))
    .padding(.horizontal, 16)
    .accessibilityElement(children: .contain)
  }
}

// MARK: - Header

private extension EasterDatesView {
  var headerRow: some View {
    Button {
      withAnimation(.easeInOut(duration: 0.25)) {
        isExpanded.toggle()
      }
    } label: {
      HStack {
        Text(resolvedTitle)
          .font(.title2.bold())
          .foregroundStyle(Color.black)
          .multilineTextAlignment(.leading)
          .fixedSize(horizontal: false, vertical: true)
        Spacer()
        Image(systemName: "chevron.down")
          .font(.body.weight(.semibold))
          .foregroundStyle(Color.black.opacity(0.6))
          .rotationEffect(.degrees(isExpanded ? -180 : 0))
          .animation(.easeInOut(duration: 0.25), value: isExpanded)
      }
    }
    .buttonStyle(.plain)
    .accessibilityLabel(resolvedTitle)
    .accessibilityHint(isExpanded ? "Collapse to hide dates" : "Expand to show dates")
    .accessibilityAddTraits(.isButton)
  }
}

// MARK: - Dates Content

private extension EasterDatesView {
  var datesContent: some View {
    VStack(alignment: .leading, spacing: 16) {
      dateRow(
        label: section.westernEasterLabel,
        components: EasterDateCalculator.westernEaster(year: year),
        isLarge: true
      )
      dateRow(
        label: section.orthodoxEasterLabel,
        components: EasterDateCalculator.orthodoxEaster(year: year),
        isLarge: false
      )
      dateRow(
        label: section.passoverLabel,
        components: EasterDateCalculator.passover(year: year),
        isLarge: false
      )
    }
    .padding(.top, 20)
  }

  func dateRow(label: String, components: DateComponents, isLarge: Bool) -> some View {
    let formatted = EasterDateCalculator.formattedDate(components, locale: section.locale)
    return VStack(alignment: .leading, spacing: 4) {
      Text(label)
        .font(.subheadline)
        .foregroundStyle(Color.black.opacity(0.55))
      Text(formatted)
        .font(isLarge ? .title.bold() : .headline.weight(.semibold))
        .foregroundStyle(Color.black)
        .fixedSize(horizontal: false, vertical: true)
    }
    .accessibilityElement(children: .combine)
  }
}

// MARK: - Background

private extension EasterDatesView {
  var gradientBackground: some View {
    LinearGradient(
      colors: [
        Color(red: 0.90, green: 0.72, blue: 0.20),
        Color(red: 0.88, green: 0.55, blue: 0.15),
        Color(red: 0.92, green: 0.65, blue: 0.25)
      ],
      startPoint: .topLeading,
      endPoint: .bottomTrailing
    )
  }
}

// MARK: - Previews

#if DEBUG
#Preview("Collapsed") {
  ScrollView {
    EasterDatesView(section: EasterDatesSection(
      id: "preview-1",
      sectionKey: nil,
      easterDatesTitle: "When is Easter celebrated in {year}?",
      westernEasterLabel: "Western Easter (Catholic/Protestant)",
      orthodoxEasterLabel: "Orthodox",
      passoverLabel: "Jewish Passover",
      locale: "en-US"
    ))
  }
}

#Preview("Expanded") {
  ScrollView {
    EasterDatesView(section: EasterDatesSection(
      id: "preview-2",
      sectionKey: nil,
      easterDatesTitle: "When is Easter celebrated in {year}?",
      westernEasterLabel: "Western Easter (Catholic/Protestant)",
      orthodoxEasterLabel: "Orthodox",
      passoverLabel: "Jewish Passover",
      locale: "en-US"
    ))
  }
}
#endif
