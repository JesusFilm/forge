import java.util.Properties

plugins {
  id("com.android.application")
  id("org.jetbrains.kotlin.android")
  id("com.apollographql.apollo")
}

apollo {
  service("forge") {
    packageName.set("com.forge.mobile.graphql")
    schemaFile.set(file("../../../apps/cms/schema.graphql"))
    // heading is String! on ComponentSectionsCta but String on ComponentSectionsInfoBlocks.
    // These are disjoint union members so the shapes can never conflict at runtime.
    fieldsOnDisjointTypesMustMerge.set(false)
  }
}

val localProperties =
  Properties().apply {
    val f = rootProject.file("local.properties")
    if (f.exists()) {
      f.inputStream().use { load(it) }
    }
  }

val graphqlEndpoint =
  localProperties.getProperty("graphql.endpoint")?.takeIf { it.isNotBlank() }
    ?: System.getenv("STRAPI_GRAPHQL_ENDPOINT")?.takeIf { it.isNotBlank() }
    ?: "https://cms.forge.dev/graphql"

val graphqlToken =
  localProperties.getProperty("graphql.token")?.takeIf { it.isNotBlank() }
    ?: System.getenv("STRAPI_GRAPHQL_TOKEN")?.takeIf { it.isNotBlank() }
    ?: ""

android {
  namespace = "com.forge.mobile"
  compileSdk = 34

  defaultConfig {
    applicationId = "com.forge.mobile"
    minSdk = 26
    targetSdk = 34
    versionCode = 1
    versionName = "0.0.1"

    buildConfigField("String", "GRAPHQL_ENDPOINT", "\"$graphqlEndpoint\"")
    buildConfigField("String", "GRAPHQL_TOKEN", "\"$graphqlToken\"")
  }

  buildFeatures {
    compose = true
    buildConfig = true
  }

  composeOptions {
    kotlinCompilerExtensionVersion = "1.5.15"
  }

  compileOptions {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
  }

  kotlinOptions {
    jvmTarget = "17"
  }
}

dependencies {
  val composeBom = platform("androidx.compose:compose-bom:2024.09.00")
  implementation(composeBom)
  implementation("androidx.core:core-ktx:1.13.1")
  implementation("androidx.activity:activity-compose:1.9.2")
  implementation("androidx.compose.ui:ui")
  implementation("androidx.compose.material3:material3")
  implementation("androidx.compose.ui:ui-tooling-preview")
  debugImplementation("androidx.compose.ui:ui-tooling")

  // Apollo GraphQL
  implementation("com.apollographql.apollo:apollo-runtime:4.1.0")
}
