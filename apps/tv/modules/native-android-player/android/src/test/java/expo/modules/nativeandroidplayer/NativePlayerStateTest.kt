package expo.modules.nativeandroidplayer

import org.junit.Assert.*
import org.junit.Test

class NativePlayerStateTest {
  @Test fun previewDoesNotChangeOriginAndCommitsOnce() {
    val state = NativeScrubState()
    assertEquals(30_000L, state.adjust(10_000, 20_000, 100_000, true))
    assertEquals(40_000L, state.adjust(10_000, 20_100, 100_000, false))
    assertEquals(20_000L, state.originMs)
    assertEquals(NativeScrubResult(40_000, true), state.commit())
    assertNull(state.commit())
  }

  @Test fun cancellationKeepsPausedIntentAndOriginalPosition() {
    val state = NativeScrubState()
    state.adjust(-10_000, 20_000, 100_000, false)
    assertEquals(NativeScrubResult(20_000, false), state.cancel())
    assertNull(state.candidateMs)
    assertNull(state.cancel())
  }

  @Test fun previewClampsAndIgnoresUnknownDuration() {
    val state = NativeScrubState()
    assertNull(state.adjust(10_000, 0, -1, true))
    assertEquals(0L, state.adjust(-10_000, 0, 15_000, true))
    assertEquals(14_500L, state.adjust(100_000, 0, 15_000, false))
  }

  @Test fun cancellingThenStartingAgainUsesNewPlaybackIntent() {
    val state = NativeScrubState()
    state.adjust(10_000, 20_000, 100_000, true)
    state.cancel()
    state.adjust(10_000, 30_000, 100_000, false)
    assertEquals(NativeScrubResult(40_000, false), state.commit())
  }

  @Test fun vttNormalizesBroadcastOffsetsAndCueSettings() {
    val cues = NativeVttParser.parse("WEBVTT\r\n\r\n1\r\n01:00:20.000 --> 01:00:22.540 line:50%\r\n<b>First</b>\r\nSecond\r\n")
    assertEquals(1, cues.size)
    assertEquals(20.0, cues[0].start, 0.001)
    assertEquals(22.54, cues[0].end, 0.001)
    assertEquals("First\nSecond", cues[0].text)
    assertEquals("First\nSecond", NativeVttParser.active(cues, 20.0))
    assertEquals("", NativeVttParser.active(cues, 22.54))
  }

  @Test fun vttPreservesOrdinaryHourLongFilmsAndFindsOverlaps() {
    val cues = NativeVttParser.parse("WEBVTT\n\n00:20.000 --> 00:40.000\nLong\n\n00:22.000 --> 00:23.000\nShort\n\n01:05:00.000 --> 01:05:01.000\nLate")
    assertEquals(3900.0, cues.last().start, 0.001)
    assertEquals("Short", NativeVttParser.active(cues, 22.5))
    assertEquals("Long", NativeVttParser.active(cues, 25.0))
    assertEquals("", NativeVttParser.active(cues, 19.9))
  }

  @Test fun vttRejectsMalformedAndEmptyCues() {
    assertTrue(NativeVttParser.parse("WEBVTT\n\nbad --> 00:05\nBad\n\n00:08 --> 00:07\nBackwards\n\n00:01 --> 00:02\n<b></b>").isEmpty())
  }

  @Test fun filteringPreservesIdentityDisabledAndPinnedRows() {
    val off = NativeChoiceRow("__off__", "Subtitles Off", pinned = true)
    val rows = listOf(off, NativeChoiceRow("dub-1", "English", searchText = "en"),
      NativeChoiceRow("dub-2", "Thai", "ไทย", disabled = true, searchText = "th"))
    assertEquals(listOf(off, rows[2]), filterNativeChoices(rows, " ไทย "))
    assertEquals(listOf(off, rows[2]), filterNativeChoices(rows, "TH"))
    assertEquals(listOf(off), filterNativeChoices(rows, "missing"))
    assertEquals(rows, filterNativeChoices(rows, ""))
  }

  @Test fun storyboardSelectsTileAtBoundaryAndClampsEnds() {
    val storyboard = NativeStoryboard(30.0, 160, 90,
      listOf(NativeStoryboardTile(0.0, 0, 0), NativeStoryboardTile(10.0, 160, 0), NativeStoryboardTile(20.0, 320, 0)), "https://image.mux.com/id/storyboard.jpg")
    assertEquals(0, storyboard.tileIndex(-1.0))
    assertEquals(0, storyboard.tileIndex(9.9))
    assertEquals(1, storyboard.tileIndex(10.0))
    assertEquals(2, storyboard.tileIndex(100.0))
  }
}
