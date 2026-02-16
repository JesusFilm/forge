package com.forge.mobile

data class MobileContentItem(
  val id: String,
  val slug: String,
  val locale: String,
  val title: String,
  val body: String,
  val state: String,
)

interface ContentClient {
  suspend fun getContent(
    locale: String,
    slug: String,
  ): MobileContentItem?
}

// Adapter target: generated client in packages/clients/kotlin-android
class ContentRepository(private val client: ContentClient) {
  suspend fun fetchHome(locale: String): MobileContentItem? {
    return client.getContent(locale = locale, slug = "home")
  }
}
