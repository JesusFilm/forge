package com.forge.mobile

import com.apollographql.apollo.ApolloClient
import com.apollographql.apollo.api.http.HttpRequest
import com.apollographql.apollo.api.http.HttpResponse
import com.apollographql.apollo.network.http.HttpInterceptor
import com.apollographql.apollo.network.http.HttpInterceptorChain
import com.forge.mobile.graphql.ExperienceBySlugQuery
import com.forge.mobile.graphql.ExperiencesQuery

/**
 * Apollo-backed [ContentClient] adapter.
 *
 * Uses the CMS GraphQL endpoint with bearer-token authentication.
 * The schema is sourced from apps/cms/schema.graphql and the operations
 * are owned entirely by the Android platform (not shared with iOS).
 */
class GraphQLContentClient(
  endpoint: String,
  bearerToken: String,
) : ContentClient {
  private val apolloClient: ApolloClient =
    ApolloClient.Builder()
      .serverUrl(endpoint)
      .addHttpInterceptor(AuthInterceptor(bearerToken))
      .build()

  override suspend fun getContent(
    locale: String,
    slug: String,
  ): MobileContentItem? {
    val response =
      apolloClient
        .query(ExperienceBySlugQuery(slug = slug, locale = com.apollographql.apollo.api.Optional.present(locale)))
        .execute()
    response.errors?.takeIf { it.isNotEmpty() }?.let { errors ->
      throw IllegalStateException("ExperienceBySlug failed: ${errors.joinToString { it.message }}")
    }

    val experiences = response.data?.experiences.orEmpty()
    if (experiences.size > 1) {
      throw IllegalStateException("Expected one experience for slug '$slug', got ${experiences.size}")
    }
    val experience = experiences.firstOrNull() ?: return null

    // Build a summary body from the first CTA or PromoBanner section
    val body =
      experience.sections?.mapNotNull { section ->
        section?.onComponentSectionsCta?.body
          ?: section?.onComponentSectionsPromoBanner?.description
          ?: section?.onComponentSectionsInfoBlocks?.let { it.description ?: it.heading }
      }?.firstOrNull() ?: ""

    return MobileContentItem(
      id = experience.documentId,
      slug = experience.slug,
      locale = experience.locale ?: locale,
      title =
        experience.sections?.mapNotNull { section ->
          section?.onComponentSectionsCta?.heading
            ?: section?.onComponentSectionsPromoBanner?.heading
            ?: section?.onComponentSectionsInfoBlocks?.heading
        }?.firstOrNull() ?: experience.slug,
      body = body,
      state = if (experience.publishedAt != null) "published" else "draft",
    )
  }

  /**
   * List experiences (for catalogue/navigation).
   */
  suspend fun listExperiences(
    locale: String,
    page: Int = 1,
    pageSize: Int = 25,
  ): List<MobileContentItem> {
    require(page > 0) { "page must be >= 1" }
    require(pageSize > 0) { "pageSize must be > 0" }

    val response =
      apolloClient
        .query(
          ExperiencesQuery(
            locale = com.apollographql.apollo.api.Optional.present(locale),
            page = com.apollographql.apollo.api.Optional.present(page),
            pageSize = com.apollographql.apollo.api.Optional.present(pageSize),
          ),
        )
        .execute()
    response.errors?.takeIf { it.isNotEmpty() }?.let { errors ->
      throw IllegalStateException("Experiences failed: ${errors.joinToString { it.message }}")
    }

    return response.data?.experiences?.mapNotNull { experience ->
      experience ?: return@mapNotNull null
      MobileContentItem(
        id = experience.documentId,
        slug = experience.slug,
        locale = experience.locale ?: locale,
        title = experience.slug,
        body = "",
        state = if (experience.publishedAt != null) "published" else "draft",
      )
    } ?: emptyList()
  }

  fun close() {
    apolloClient.close()
  }
}

/**
 * HTTP interceptor that adds the Authorization: Bearer header to every request.
 */
private class AuthInterceptor(private val token: String) : HttpInterceptor {
  override suspend fun intercept(
    request: HttpRequest,
    chain: HttpInterceptorChain,
  ): HttpResponse {
    if (token.isBlank()) return chain.proceed(request)
    return chain.proceed(
      request.newBuilder()
        .addHeader("Authorization", "Bearer $token")
        .build(),
    )
  }
}
