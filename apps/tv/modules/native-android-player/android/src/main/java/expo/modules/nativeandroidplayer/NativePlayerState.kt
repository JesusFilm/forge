package expo.modules.nativeandroidplayer

import java.util.Locale
import kotlin.math.floor

internal data class NativeSubtitleCue(val start: Double, val end: Double, val text: String)

internal object NativeVttParser {
  fun parse(value: String): List<NativeSubtitleCue> {
    val blocks = value.replace("\r\n", "\n").split(Regex("\n[ \\t]*\n"))
    val cues = blocks.mapNotNull { block ->
      val lines = block.lines()
      val index = lines.indexOfFirst { it.contains("-->") }
      if (index < 0) return@mapNotNull null
      val times = lines[index].split("-->")
      if (times.size != 2) return@mapNotNull null
      val start = timestamp(times[0]) ?: return@mapNotNull null
      val end = timestamp(times[1].trim().split(Regex("\\s+"))[0]) ?: return@mapNotNull null
      var text = lines.drop(index + 1).joinToString("\n").trim()
      do {
        val previous = text
        text = text.replace(Regex("<[^>]*>"), "")
      } while (text != previous)
      if (end <= start || text.isEmpty()) null else NativeSubtitleCue(start, end, text)
    }.sortedBy { it.start }
    val earliest = cues.firstOrNull()?.start ?: return cues
    val offset = if (earliest >= 3600) floor(earliest / 3600) * 3600 else 0.0
    return cues.map { it.copy(start = it.start - offset, end = it.end - offset) }
  }

  fun active(cues: List<NativeSubtitleCue>, position: Double): String {
    var low = 0
    var high = cues.lastIndex
    while (low <= high) {
      val middle = (low + high) ushr 1
      if (cues[middle].start <= position) low = middle + 1 else high = middle - 1
    }
    for (index in high downTo maxOf(0, high - 15)) {
      if (position < cues[index].end) return cues[index].text
    }
    return ""
  }

  private fun timestamp(value: String): Double? {
    val parts = value.trim().split(":")
    if (parts.size !in 2..3) return null
    var result = 0.0
    for (part in parts) result = result * 60 + (part.toDoubleOrNull() ?: return null)
    return result.takeIf { it.isFinite() && it >= 0 }
  }
}

internal data class NativeScrubResult(val positionMs: Long, val resume: Boolean)

internal class NativeScrubState {
  var candidateMs: Long? = null
    private set
  var originMs = 0L
    private set
  private var resume = false

  fun adjust(deltaMs: Long, positionMs: Long, durationMs: Long, playing: Boolean): Long? {
    if (durationMs <= 0) return null
    if (candidateMs == null) {
      originMs = positionMs.coerceAtLeast(0)
      resume = playing
      candidateMs = originMs
    }
    candidateMs = (candidateMs!! + deltaMs).coerceIn(0, maxOf(0, durationMs - 500))
    return candidateMs
  }

  fun commit(): NativeScrubResult? {
    val candidate = candidateMs ?: return null
    candidateMs = null
    return NativeScrubResult(candidate, resume)
  }

  fun cancel(): NativeScrubResult? {
    if (candidateMs == null) return null
    candidateMs = null
    return NativeScrubResult(originMs, resume)
  }
}

internal data class NativeChoiceRow(
  val id: String,
  val label: String,
  val detail: String = "",
  val disabled: Boolean = false,
  val pinned: Boolean = false,
  val searchText: String = ""
)

internal fun filterNativeChoices(rows: List<NativeChoiceRow>, query: String): List<NativeChoiceRow> {
  val term = query.trim().lowercase(Locale.ROOT)
  return rows.filter { row -> row.pinned || term.isEmpty() ||
    listOf(row.label, row.detail, row.id, row.searchText).any { it.lowercase(Locale.ROOT).contains(term) } }
}

internal data class NativeStoryboardTile(val start: Double, val x: Int, val y: Int)
internal data class NativeStoryboard(
  val duration: Double,
  val tileWidth: Int,
  val tileHeight: Int,
  val tiles: List<NativeStoryboardTile>,
  val url: String
) {
  fun tileIndex(position: Double): Int {
    var low = 0
    var high = tiles.lastIndex
    while (low <= high) {
      val middle = (low + high) ushr 1
      if (tiles[middle].start <= position) low = middle + 1 else high = middle - 1
    }
    return high.coerceAtLeast(0)
  }
}
