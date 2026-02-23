package com.forge.mobile

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val LightColorScheme = lightColorScheme(
  primary = Color(0xFF6200EE),
  onPrimary = Color.White,
  surface = Color.White,
  onSurface = Color.Black,
)

object Theme {
  @Composable
  fun ForgeMobile(content: @Composable () -> Unit) {
    MaterialTheme(
      colorScheme = LightColorScheme,
      content = content,
    )
  }
}
