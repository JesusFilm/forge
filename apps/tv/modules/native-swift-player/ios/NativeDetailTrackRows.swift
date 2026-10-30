import Foundation

struct NativeDetailTrackRow {
  let id: String
  let label: String
  let detail: String
  let searchText: String
  let disabled: Bool
  let pinned: Bool
}

enum NativeDetailTrackRows {
  static func ordered(_ rows: [NativeDetailTrackRow]) -> [NativeDetailTrackRow] {
    rows.enumerated().sorted { left, right in
      if left.element.pinned != right.element.pinned { return left.element.pinned }
      // Keep action rows (Off/Retry) in the order supplied by the owner.
      if left.element.pinned { return left.offset < right.offset }
      let labelOrder = left.element.label.localizedCaseInsensitiveCompare(right.element.label)
      if labelOrder != .orderedSame { return labelOrder == .orderedAscending }
      let detailOrder = left.element.detail.localizedCaseInsensitiveCompare(right.element.detail)
      if detailOrder != .orderedSame { return detailOrder == .orderedAscending }
      return left.offset < right.offset
    }.map(\.element)
  }

  static func matching(_ rows: [NativeDetailTrackRow], query: String) -> [NativeDetailTrackRow] {
    let query = query.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !query.isEmpty else { return rows }
    return rows.filter { row in
      row.pinned || [row.label, row.detail, row.searchText].contains { value in
        value.range(of: query, options: [.caseInsensitive, .diacriticInsensitive]) != nil
      }
    }
  }

  static func status(_ supplied: String?, rows: [NativeDetailTrackRow], query: String) -> String? {
    if let supplied, !supplied.isEmpty { return supplied }
    guard !rows.contains(where: { !$0.pinned }) else { return nil }
    return query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
      ? "No languages available"
      : "No matching languages"
  }
}
