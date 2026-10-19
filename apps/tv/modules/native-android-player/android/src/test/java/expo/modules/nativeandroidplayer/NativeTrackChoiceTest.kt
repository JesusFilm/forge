package expo.modules.nativeandroidplayer

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.assertNull
import org.junit.Test

class NativeTrackChoiceTest {
  @Test fun retryResultPreservesExactSearchInput() {
    val result = trackChoiceResult("__retry__", " ไทย ")
    assertEquals(mapOf("id" to "__retry__", "query" to " ไทย "), result)
  }

  @Test fun backCancellationDoesNotReturnAChoice() {
    assertNull(trackChoiceResult(null, "English"))
  }

  @Test fun pinnedActionsStayBeforeAlphabeticalLanguages() {
    fun option(key: String, name: String, pin: Boolean = false) = NativePlayerOption().apply { id = key; label = name; pinned = pin }
    val rows = trackRows(listOf(option("z", "Zulu"), option("off", "Subtitles Off", true), option("en", "english"), option("ar", "Arabic")))
    assertEquals(listOf("off", "ar", "en", "z"), rows.map { it.id })
    assertTrue(rows.first().pinned)
  }

  @Test fun disabledAndSearchIdentitySurviveSorting() {
    val option = NativePlayerOption().apply { id = "dub-123"; label = "English"; disabled = true; searchText = "en english" }
    val row = trackRows(listOf(option)).single()
    assertEquals("dub-123", row.id)
    assertEquals("en english", row.searchText)
    assertTrue(row.disabled)
  }
}
