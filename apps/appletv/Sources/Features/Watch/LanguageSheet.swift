import SwiftUI

/// Audio-language picker. Lists EVERY published dub — 2,291 on `jesus` — so
/// it is a `List`, which recycles rows, never a `VStack` in a `ScrollView`.
///
/// An unplayable dub is shown DISABLED rather than hidden: hiding it makes
/// the list silently disagree with every other surface, and a viewer hunting
/// for their language would conclude it does not exist.
struct LanguageSheet: View {
    let dubs: [Dub]
    let active: Dub?
    let onSelect: (Dub) -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                ForEach(DefaultDub.sortedForDisplay(dubs)) { dub in
                    Button {
                        onSelect(dub)
                        dismiss()
                    } label: {
                        HStack {
                            Text(dub.displayName)
                            Spacer()
                            if dub.id == active?.id {
                                Image(systemName: "checkmark")
                            } else if !dub.isPlayable {
                                Text("Unavailable")
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                    .disabled(!dub.isPlayable)
                }
            }
            .navigationTitle("Audio language")
        }
    }
}

/// Subtitle picker. "Off" is a first-class row, not an absence — a viewer who
/// turned subtitles on needs an obvious way back out.
struct SubtitleSheet: View {
    let subtitles: [Subtitle]
    let active: Subtitle?
    let onSelect: (Subtitle?) -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                Button {
                    onSelect(nil)
                    dismiss()
                } label: {
                    HStack {
                        Text("Off")
                        Spacer()
                        if active == nil { Image(systemName: "checkmark") }
                    }
                }

                ForEach(subtitles) { subtitle in
                    Button {
                        onSelect(subtitle)
                        dismiss()
                    } label: {
                        HStack {
                            Text(subtitle.displayName)
                            Spacer()
                            if subtitle.id == active?.id { Image(systemName: "checkmark") }
                        }
                    }
                }
            }
            .navigationTitle("Subtitles")
        }
    }
}
