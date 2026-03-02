package com.forge.mobile

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Text
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import com.forge.mobile.ui.theme.ForgeTheme

/**
 * Launcher activity for the Forge Android app.
 *
 * Uses Jetpack Compose with [ForgeTheme] to render the UI and
 * enables edge-to-edge display for a modern full-screen experience.
 */
class MainActivity : ComponentActivity() {
  /**
   * Initialises edge-to-edge rendering and sets the Compose content
   * tree rooted in [ForgeTheme].
   */
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    enableEdgeToEdge()
    setContent {
      ForgeTheme {
        Box(
          modifier = Modifier.fillMaxSize(),
          contentAlignment = Alignment.Center,
        ) {
          Text(text = stringResource(R.string.startup_title))
        }
      }
    }
  }
}
