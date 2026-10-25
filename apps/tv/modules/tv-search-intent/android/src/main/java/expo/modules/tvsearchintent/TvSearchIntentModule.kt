package expo.modules.tvsearchintent

import android.app.SearchManager
import android.content.Intent
import android.provider.MediaStore
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Receives Google Assistant app-search intents on Android TV ("search for X on
 * Jesus Film Watch"). Assistant launches MainActivity with
 * MEDIA_PLAY_FROM_SEARCH (per the Android TV voice-search contract) carrying
 * the spoken query in SearchManager.QUERY. Cold starts read it via
 * consumeLaunchSearchQuery(); warm arrivals surface through the onSearchIntent
 * event (OnNewIntent). The query is USER-SPOKEN text — the JS side must route
 * it through the same sanitize chokepoint as typed input, and it is never
 * logged here.
 */
class TvSearchIntentModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("TvSearchIntent")

    Events("onSearchIntent")

    Function("consumeLaunchSearchQuery") {
      val activity = appContext.currentActivity ?: return@Function null
      val intent = activity.intent ?: return@Function null
      val query = extractQuery(intent)
      if (query != null) {
        // One-shot: an Activity recreation (config change, theme switch)
        // replays the same launch intent — clearing the extra keeps a stale
        // Assistant query from re-firing a search the user already left.
        intent.removeExtra(SearchManager.QUERY)
      }
      query
    }

    OnNewIntent { intent ->
      val query = extractQuery(intent)
      if (query != null) {
        sendEvent("onSearchIntent", mapOf("query" to query))
      }
    }
  }

  private fun extractQuery(intent: Intent): String? {
    val action = intent.action ?: return null
    val isSearchAction =
      action == MediaStore.INTENT_ACTION_MEDIA_PLAY_FROM_SEARCH ||
        action == Intent.ACTION_SEARCH
    if (!isSearchAction) return null
    return intent.getStringExtra(SearchManager.QUERY)?.takeIf { it.isNotBlank() }
  }
}
