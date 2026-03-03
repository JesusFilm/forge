plugins {
  id("com.android.application") version "8.5.2" apply false
  id("org.jetbrains.kotlin.android") version "1.9.25" apply false
  id("com.apollographql.apollo") version "4.1.0" apply false
  id("org.jlleitschuh.gradle.ktlint") version "12.1.1"
}

subprojects {
  apply(plugin = "org.jlleitschuh.gradle.ktlint")
}
