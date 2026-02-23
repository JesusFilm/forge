package com.forge.mobile

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.sp

class MainActivity : ComponentActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    setContent {
      Theme.ForgeMobile {
        StartupScreen()
      }
    }
  }
}

@Composable
private fun StartupScreen() {
  Surface {
    Text(
      text = "Forge Android",
      style = MaterialTheme.typography.headlineMedium,
      fontSize = 24.sp,
    )
  }
}

@Preview(showBackground = true)
@Composable
private fun StartupScreenPreview() {
  Theme.ForgeMobile {
    StartupScreen()
  }
}
