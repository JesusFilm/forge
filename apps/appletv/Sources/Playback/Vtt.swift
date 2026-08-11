import Foundation

struct VttCue: Equatable {
    let start: TimeInterval
    let end: TimeInterval
    let text: String
}

/// WebVTT parsing and lookup, ported from `apps/tv/src/lib/parseVtt.ts`.
///
/// This exists because subtitles are NOT in the HLS manifest: admin serves
/// them as external `vttSrc` files per dub edition, so AVPlayer's own
/// subtitle track selection cannot see them. Rendering them is the app's job.
enum Vtt {
    /// Broadcast/SMPTE VTTs start their first cue at 01:00:00 ("program
    /// start") while the playhead is media-relative.
    private static let oneHour: TimeInterval = 3600

    static func parse(_ content: String) -> [VttCue] {
        let lines = content.components(separatedBy: .newlines)
        var cues: [VttCue] = []
        var i = 0

        while i < lines.count {
            let line = lines[i]
            guard line.contains("-->") else {
                i += 1
                continue
            }
            let parts = line.components(separatedBy: "-->")
            guard parts.count >= 2 else {
                i += 1
                continue
            }
            let start = timestamp(parts[0])
            // The end may carry cue settings ("00:00:08.000 line:50%"), so
            // take only the first whitespace-delimited token.
            let endToken = parts[1]
                .trimmingCharacters(in: .whitespaces)
                .split(separator: " ", maxSplits: 1)
                .first
                .map(String.init) ?? ""
            let end = timestamp(endToken)

            var textLines: [String] = []
            i += 1
            while i < lines.count, !lines[i].trimmingCharacters(in: .whitespaces).isEmpty {
                textLines.append(lines[i])
                i += 1
            }

            // A cue with an unparseable timestamp is DROPPED rather than
            // coerced to zero: a zero-start cue flashes its text at the very
            // beginning of every video, which is worse than showing nothing.
            if !textLines.isEmpty, start.isFinite, end.isFinite, end > start {
                cues.append(
                    VttCue(start: start, end: end, text: stripTags(textLines.joined(separator: "\n")))
                )
            }
            i += 1
        }
        return normalizeSmpteOffset(cues)
    }

    /// `NaN` for an unrecognised shape, so the caller's finite check drops it.
    private static func timestamp(_ raw: String) -> TimeInterval {
        let parts = raw.trimmingCharacters(in: .whitespaces).components(separatedBy: ":")
        switch parts.count {
        case 3:
            guard let h = Double(parts[0]), let m = Double(parts[1]), let s = Double(parts[2]) else {
                return .nan
            }
            return h * 3600 + m * 60 + s
        case 2:
            guard let m = Double(parts[0]), let s = Double(parts[1]) else { return .nan }
            return m * 60 + s
        default:
            return .nan
        }
    }

    /// Loops until stable: a single pass leaves nested tags behind
    /// (`<scr<script>ipt>` → `<script>`), which is an incomplete strip.
    private static func stripTags(_ text: String) -> String {
        var out = text
        while true {
            let next = out.replacingOccurrences(
                of: "<[^>]*>", with: "", options: .regularExpression
            )
            if next == out { return out }
            out = next
        }
    }

    /// Subtract WHOLE hours only — an exact-hour floor avoids corrupting a
    /// genuinely long film whose first caption legitimately arrives late.
    private static func normalizeSmpteOffset(_ cues: [VttCue]) -> [VttCue] {
        guard let earliest = cues.map(\.start).min(), earliest >= oneHour else {
            return cues
        }
        let offset = (earliest / oneHour).rounded(.down) * oneHour
        guard offset > 0 else { return cues }
        return cues.map {
            VttCue(start: $0.start - offset, end: $0.end - offset, text: $0.text)
        }
    }

    /// The cue covering `t`, or nil.
    ///
    /// Binary-searches the last cue starting at or before `t` — cheap on long
    /// VTTs polled every frame — then walks back a BOUNDED number of steps.
    /// The walk matters because cues can overlap: the last one started may
    /// already have ended while a longer earlier cue is still running, and
    /// without it the caption vanishes mid-sentence. The bound keeps a gap in
    /// a long non-overlapping file O(1) instead of O(n).
    static func findActiveCue(_ cues: [VttCue], at t: TimeInterval) -> VttCue? {
        var lo = 0
        var hi = cues.count - 1
        var candidate = -1
        while lo <= hi {
            let mid = (lo + hi) / 2
            if cues[mid].start <= t {
                candidate = mid
                lo = mid + 1
            } else {
                hi = mid - 1
            }
        }
        var steps = 0
        var i = candidate
        while i >= 0, steps < 16, cues[i].start <= t {
            if t < cues[i].end { return cues[i] }
            i -= 1
            steps += 1
        }
        return nil
    }
}
