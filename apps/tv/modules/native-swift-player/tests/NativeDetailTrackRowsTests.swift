import Foundation

private func row(_ id: String, _ label: String, detail: String = "", search: String = "", pinned: Bool = false, disabled: Bool = false) -> NativeDetailTrackRow {
  NativeDetailTrackRow(id: id, label: label, detail: detail, searchText: search, disabled: disabled, pinned: pinned)
}

@main
enum NativeDetailTrackRowsTests {
  static func main() {
    let rows = NativeDetailTrackRows.ordered([
      row("th", "Thai", detail: "ภาษาไทย", search: "thai th"),
      row("__off__", "Subtitles Off", pinned: true),
      row("en", "English"),
      row("fr", "Français", search: "fr"),
      row("__retry__", "Try again", pinned: true),
      row("unavailable", "Zulu", disabled: true),
    ])
    precondition(rows.map(\.id) == ["__off__", "__retry__", "en", "fr", "th", "unavailable"], "Pinned actions retain order before alphabetical languages")
    precondition(NativeDetailTrackRows.matching(rows, query: "  THAI ").map(\.id) == ["__off__", "__retry__", "th"], "Case-insensitive trimmed query preserves stable identity")
    precondition(NativeDetailTrackRows.matching(rows, query: "ภาษาไทย").map(\.id) == ["__off__", "__retry__", "th"], "Native language names must be searchable")
    precondition(NativeDetailTrackRows.matching(rows, query: "francais").map(\.id) == ["__off__", "__retry__", "fr"], "Search must tolerate diacritics")
    precondition(NativeDetailTrackRows.matching(rows, query: "th").contains(where: { $0.id == "th" }), "Language tags are searchable")
    let noMatch = NativeDetailTrackRows.matching(rows, query: "not-a-language")
    precondition(noMatch.map(\.id) == ["__off__", "__retry__"], "Off and Retry remain reachable on no match")
    precondition(NativeDetailTrackRows.status(nil, rows: noMatch, query: "not-a-language") == "No matching languages")
    precondition(NativeDetailTrackRows.status("Loading languages…", rows: [], query: "Thai") == "Loading languages…", "Loading is not a no-match result")
    precondition(NativeDetailTrackRows.status("Couldn’t load languages", rows: noMatch, query: "Thai") == "Couldn’t load languages", "Failure is not an empty catalogue")
    precondition(NativeDetailTrackRows.status(nil, rows: [], query: "   ") == "No languages available")
    precondition(NativeDetailTrackRows.matching(rows, query: "Zulu").last?.disabled == true, "Filtering does not enable an unplayable dub")
    precondition(NativeDetailTrackRows.matching(rows, query: "").map(\.id) == rows.map(\.id), "Clearing the query restores all choices")
    print("Native detail track rows: 12 checks passed")
  }
}
