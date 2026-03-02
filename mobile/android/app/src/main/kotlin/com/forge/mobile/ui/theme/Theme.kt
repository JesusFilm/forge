package com.forge.mobile.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable

/** Material3 dark color scheme using platform defaults. */
private val DarkColorScheme = darkColorScheme()

/** Material3 light color scheme using platform defaults. */
private val LightColorScheme = lightColorScheme()

/**
 * Top-level Forge theme that wraps content in [MaterialTheme].
 *
 * Automatically selects a dark or light color scheme based on the
 * system setting, keeping the app consistent with the device theme.
 *
 * @param darkTheme Whether to use the dark color scheme; defaults to the system preference.
 * @param content The composable content to render within the theme.
 */
@Composable
fun ForgeTheme(
  darkTheme: Boolean = isSystemInDarkTheme(),
  content: @Composable () -> Unit,
) {
  val colorScheme = if (darkTheme) DarkColorScheme else LightColorScheme
  MaterialTheme(
    colorScheme = colorScheme,
    content = content,
  )
}
