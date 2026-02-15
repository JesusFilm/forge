plugins {
  id("com.android.application")
  id("org.jetbrains.kotlin.android")
  id("org.jlleitschuh.gradle.ktlint")
}

ktlint {
  version.set("1.3.1")
  android.set(true)
  filter {
    // Exclude generated Kotlin client (per AGENTS.md - read-only artifacts)
    exclude { element ->
      element.file.path.contains("packages/clients/kotlin-android")
    }
  }
}

android {
  namespace = "com.forge.mobile"
  compileSdk = 34

  defaultConfig {
    applicationId = "com.forge.mobile"
    minSdk = 26
    targetSdk = 34
    versionCode = 1
    versionName = "0.0.1"
  }
}

dependencies {
  implementation("androidx.core:core-ktx:1.13.1")
  implementation("androidx.activity:activity-compose:1.9.2")
  implementation("androidx.compose.ui:ui:1.7.2")
}
