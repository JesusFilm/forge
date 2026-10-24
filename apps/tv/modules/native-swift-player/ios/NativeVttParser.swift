import Foundation

struct NativeSubtitleCue {
  let start: Double
  let end: Double
  let text: String
}

enum NativeVttParser {
  private static let oneHour: Double = 3600

  static func parse(_ text: String) -> [NativeSubtitleCue] {
    let lines = text
      .replacingOccurrences(of: "\r\n", with: "\n")
      .components(separatedBy: "\n")
    var cues: [NativeSubtitleCue] = []
    var index = 0

    while index < lines.count {
      let line = lines[index]
      guard line.contains("-->") else {
        index += 1
        continue
      }

      let times = line.components(separatedBy: "-->")
      let start = times.count == 2 ? parseTimestamp(times[0]) : nil
      let endToken = times.count == 2
        ? times[1]
          .trimmingCharacters(in: .whitespacesAndNewlines)
          .split(whereSeparator: \.isWhitespace)
          .first
          .map(String.init)
        : nil
      let end = endToken.flatMap(parseTimestamp)

      index += 1
      var body: [String] = []
      while index < lines.count && !lines[index].trimmingCharacters(in: .whitespaces).isEmpty {
        body.append(lines[index])
        index += 1
      }

      if let start,
         let end,
         start.isFinite,
         end.isFinite,
         end > start,
         !body.isEmpty {
        let value = stripTags(body.joined(separator: "\n"))
        if !value.isEmpty {
          cues.append(NativeSubtitleCue(start: start, end: end, text: value))
        }
      }
      index += 1
    }

    return normalizeSmpteOffset(cues.sorted { $0.start < $1.start })
  }

  static func activeCue(in cues: [NativeSubtitleCue], at position: Double) -> NativeSubtitleCue? {
    var low = 0
    var high = cues.count - 1
    var candidate = -1

    while low <= high {
      let middle = (low + high) / 2
      if cues[middle].start <= position {
        candidate = middle
        low = middle + 1
      } else {
        high = middle - 1
      }
    }

    var index = candidate
    var steps = 0
    while index >= 0 && steps < 16 && cues[index].start <= position {
      if position < cues[index].end { return cues[index] }
      index -= 1
      steps += 1
    }
    return nil
  }

  private static func parseTimestamp(_ raw: String) -> Double? {
    let parts = raw.trimmingCharacters(in: .whitespacesAndNewlines).components(separatedBy: ":")
    guard parts.count == 2 || parts.count == 3,
          let seconds = Double(parts[parts.count - 1]),
          let minutes = Double(parts[parts.count - 2]) else { return nil }
    let hours: Double
    if parts.count == 3 {
      guard let parsedHours = Double(parts[0]) else { return nil }
      hours = parsedHours
    } else {
      hours = 0
    }
    return hours * oneHour + minutes * 60 + seconds
  }

  private static func stripTags(_ text: String) -> String {
    var output = text
    while true {
      let next = output.replacingOccurrences(
        of: "<[^>]*>",
        with: "",
        options: .regularExpression
      )
      if next == output { return next }
      output = next
    }
  }

  private static func normalizeSmpteOffset(_ cues: [NativeSubtitleCue]) -> [NativeSubtitleCue] {
    guard let earliest = cues.first?.start, earliest >= oneHour else { return cues }
    let offset = floor(earliest / oneHour) * oneHour
    guard offset > 0 else { return cues }
    return cues.map {
      NativeSubtitleCue(start: $0.start - offset, end: $0.end - offset, text: $0.text)
    }
  }
}
