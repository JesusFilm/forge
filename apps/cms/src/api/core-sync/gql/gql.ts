/* eslint-disable */
import * as types from "./graphql"
import type { TypedDocumentNode as DocumentNode } from "@graphql-typed-document-node/core"

/**
 * Map of all GraphQL operations in the project.
 *
 * This map has several performance disadvantages:
 * 1. It is not tree-shakeable, so it will include all operations in the project.
 * 2. It is not minifiable, so the string of a GraphQL query will be multiple times inside the bundle.
 * 3. It does not support dead code elimination, so it will add unused operations.
 *
 * Therefore it is highly recommended to use the babel or swc plugin for production.
 * Learn more about it here: https://the-guild.dev/graphql/codegen/plugins/presets/preset-client#reducing-bundle-size
 */
type Documents = {
  "\n  query SyncCountries {\n    countries {\n      id\n      population\n      latitude\n      longitude\n      flagPngSrc\n      flagWebpSrc\n      languageCount\n      languageHavingMediaCount\n      continent {\n        id\n        name(primary: true) {\n          value\n          primary\n          language {\n            id\n          }\n        }\n      }\n      name(primary: true) {\n        value\n        primary\n        language {\n          id\n        }\n      }\n      countryLanguages {\n        id\n        speakers\n        displaySpeakers\n        primary\n        suggested\n        order\n        language {\n          id\n        }\n      }\n    }\n  }\n": typeof types.SyncCountriesDocument
  "\n  query SyncKeywords {\n    keywords {\n      id\n      value\n      language {\n        id\n      }\n    }\n  }\n": typeof types.SyncKeywordsDocument
  "\n  query SyncLanguages($where: LanguagesFilter) {\n    languages(limit: 5000, where: $where) {\n      id\n      bcp47\n      iso3\n      slug\n      name {\n        value\n        primary\n        language {\n          id\n        }\n      }\n      audioPreview {\n        value\n        duration\n        size\n        bitrate\n        codec\n      }\n    }\n  }\n": typeof types.SyncLanguagesDocument
  "\n  query SyncVideoVariantsCount($input: VideoVariantFilter) {\n    videoVariantsCount(input: $input)\n  }\n": typeof types.SyncVideoVariantsCountDocument
  "\n  query SyncVideoVariants($limit: Int!, $offset: Int!, $input: VideoVariantFilter) {\n    videoVariants(limit: $limit, offset: $offset, input: $input) {\n      id\n      slug\n      duration\n      lengthInMilliseconds\n      hls\n      dash\n      share\n      downloadable\n      published\n      brightcoveId\n      videoId\n      language {\n        id\n      }\n      videoEdition {\n        id\n        name\n      }\n      muxVideo {\n        id\n        assetId\n        playbackId\n      }\n      downloads {\n        id\n        quality\n        size\n        height\n        width\n        bitrate\n        url\n      }\n    }\n  }\n": typeof types.SyncVideoVariantsDocument
  "\n  query SyncVideosCount($where: VideosFilter) {\n    videosCount(where: $where)\n  }\n": typeof types.SyncVideosCountDocument
  "\n  query SyncBibleBooks {\n    bibleBooks {\n      id\n      osisId\n      alternateName\n      paratextAbbreviation\n      isNewTestament\n      order\n      name(primary: true) {\n        value\n        primary\n        language {\n          id\n        }\n      }\n    }\n  }\n": typeof types.SyncBibleBooksDocument
  "\n  query SyncVideos($limit: Int!, $offset: Int!, $where: VideosFilter) {\n    videos(where: $where, limit: $limit, offset: $offset) {\n      id\n      slug\n      label\n      publishedAt\n      primaryLanguageId\n      locked\n      noIndex\n      source\n      origin {\n        id\n        name\n        description\n      }\n      title {\n        id\n        value\n        primary\n        language {\n          id\n        }\n      }\n      description {\n        id\n        value\n        primary\n        language {\n          id\n        }\n      }\n      snippet {\n        id\n        value\n        primary\n        language {\n          id\n        }\n      }\n      studyQuestions {\n        id\n        value\n        primary\n        order\n        language {\n          id\n        }\n      }\n      imageAlt {\n        id\n        value\n        primary\n        language {\n          id\n        }\n      }\n      bibleCitations {\n        id\n        osisId\n        chapterStart\n        chapterEnd\n        verseStart\n        verseEnd\n        order\n        bibleBook {\n          id\n          osisId\n        }\n      }\n      keywords {\n        id\n      }\n      images {\n        id\n        aspectRatio\n        mobileCinematicHigh\n        mobileCinematicLow\n        mobileCinematicVeryLow\n        thumbnail\n        videoStill\n        blurhash\n        url\n      }\n      subtitles {\n        id\n        primary\n        vttSrc\n        srtSrc\n        value\n        language {\n          id\n        }\n        videoEdition {\n          id\n          name\n        }\n      }\n      children {\n        id\n      }\n    }\n  }\n": typeof types.SyncVideosDocument
}
const documents: Documents = {
  "\n  query SyncCountries {\n    countries {\n      id\n      population\n      latitude\n      longitude\n      flagPngSrc\n      flagWebpSrc\n      languageCount\n      languageHavingMediaCount\n      continent {\n        id\n        name(primary: true) {\n          value\n          primary\n          language {\n            id\n          }\n        }\n      }\n      name(primary: true) {\n        value\n        primary\n        language {\n          id\n        }\n      }\n      countryLanguages {\n        id\n        speakers\n        displaySpeakers\n        primary\n        suggested\n        order\n        language {\n          id\n        }\n      }\n    }\n  }\n":
    types.SyncCountriesDocument,
  "\n  query SyncKeywords {\n    keywords {\n      id\n      value\n      language {\n        id\n      }\n    }\n  }\n":
    types.SyncKeywordsDocument,
  "\n  query SyncLanguages($where: LanguagesFilter) {\n    languages(limit: 5000, where: $where) {\n      id\n      bcp47\n      iso3\n      slug\n      name {\n        value\n        primary\n        language {\n          id\n        }\n      }\n      audioPreview {\n        value\n        duration\n        size\n        bitrate\n        codec\n      }\n    }\n  }\n":
    types.SyncLanguagesDocument,
  "\n  query SyncVideoVariantsCount($input: VideoVariantFilter) {\n    videoVariantsCount(input: $input)\n  }\n":
    types.SyncVideoVariantsCountDocument,
  "\n  query SyncVideoVariants($limit: Int!, $offset: Int!, $input: VideoVariantFilter) {\n    videoVariants(limit: $limit, offset: $offset, input: $input) {\n      id\n      slug\n      duration\n      lengthInMilliseconds\n      hls\n      dash\n      share\n      downloadable\n      published\n      brightcoveId\n      videoId\n      language {\n        id\n      }\n      videoEdition {\n        id\n        name\n      }\n      muxVideo {\n        id\n        assetId\n        playbackId\n      }\n      downloads {\n        id\n        quality\n        size\n        height\n        width\n        bitrate\n        url\n      }\n    }\n  }\n":
    types.SyncVideoVariantsDocument,
  "\n  query SyncVideosCount($where: VideosFilter) {\n    videosCount(where: $where)\n  }\n":
    types.SyncVideosCountDocument,
  "\n  query SyncBibleBooks {\n    bibleBooks {\n      id\n      osisId\n      alternateName\n      paratextAbbreviation\n      isNewTestament\n      order\n      name(primary: true) {\n        value\n        primary\n        language {\n          id\n        }\n      }\n    }\n  }\n":
    types.SyncBibleBooksDocument,
  "\n  query SyncVideos($limit: Int!, $offset: Int!, $where: VideosFilter) {\n    videos(where: $where, limit: $limit, offset: $offset) {\n      id\n      slug\n      label\n      publishedAt\n      primaryLanguageId\n      locked\n      noIndex\n      source\n      origin {\n        id\n        name\n        description\n      }\n      title {\n        id\n        value\n        primary\n        language {\n          id\n        }\n      }\n      description {\n        id\n        value\n        primary\n        language {\n          id\n        }\n      }\n      snippet {\n        id\n        value\n        primary\n        language {\n          id\n        }\n      }\n      studyQuestions {\n        id\n        value\n        primary\n        order\n        language {\n          id\n        }\n      }\n      imageAlt {\n        id\n        value\n        primary\n        language {\n          id\n        }\n      }\n      bibleCitations {\n        id\n        osisId\n        chapterStart\n        chapterEnd\n        verseStart\n        verseEnd\n        order\n        bibleBook {\n          id\n          osisId\n        }\n      }\n      keywords {\n        id\n      }\n      images {\n        id\n        aspectRatio\n        mobileCinematicHigh\n        mobileCinematicLow\n        mobileCinematicVeryLow\n        thumbnail\n        videoStill\n        blurhash\n        url\n      }\n      subtitles {\n        id\n        primary\n        vttSrc\n        srtSrc\n        value\n        language {\n          id\n        }\n        videoEdition {\n          id\n          name\n        }\n      }\n      children {\n        id\n      }\n    }\n  }\n":
    types.SyncVideosDocument,
}

/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 *
 *
 * @example
 * ```ts
 * const query = graphql(`query GetUser($id: ID!) { user(id: $id) { name } }`);
 * ```
 *
 * The query argument is unknown!
 * Please regenerate the types.
 */
export function graphql(source: string): unknown

/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  query SyncCountries {\n    countries {\n      id\n      population\n      latitude\n      longitude\n      flagPngSrc\n      flagWebpSrc\n      languageCount\n      languageHavingMediaCount\n      continent {\n        id\n        name(primary: true) {\n          value\n          primary\n          language {\n            id\n          }\n        }\n      }\n      name(primary: true) {\n        value\n        primary\n        language {\n          id\n        }\n      }\n      countryLanguages {\n        id\n        speakers\n        displaySpeakers\n        primary\n        suggested\n        order\n        language {\n          id\n        }\n      }\n    }\n  }\n",
): (typeof documents)["\n  query SyncCountries {\n    countries {\n      id\n      population\n      latitude\n      longitude\n      flagPngSrc\n      flagWebpSrc\n      languageCount\n      languageHavingMediaCount\n      continent {\n        id\n        name(primary: true) {\n          value\n          primary\n          language {\n            id\n          }\n        }\n      }\n      name(primary: true) {\n        value\n        primary\n        language {\n          id\n        }\n      }\n      countryLanguages {\n        id\n        speakers\n        displaySpeakers\n        primary\n        suggested\n        order\n        language {\n          id\n        }\n      }\n    }\n  }\n"]
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  query SyncKeywords {\n    keywords {\n      id\n      value\n      language {\n        id\n      }\n    }\n  }\n",
): (typeof documents)["\n  query SyncKeywords {\n    keywords {\n      id\n      value\n      language {\n        id\n      }\n    }\n  }\n"]
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  query SyncLanguages($where: LanguagesFilter) {\n    languages(limit: 5000, where: $where) {\n      id\n      bcp47\n      iso3\n      slug\n      name {\n        value\n        primary\n        language {\n          id\n        }\n      }\n      audioPreview {\n        value\n        duration\n        size\n        bitrate\n        codec\n      }\n    }\n  }\n",
): (typeof documents)["\n  query SyncLanguages($where: LanguagesFilter) {\n    languages(limit: 5000, where: $where) {\n      id\n      bcp47\n      iso3\n      slug\n      name {\n        value\n        primary\n        language {\n          id\n        }\n      }\n      audioPreview {\n        value\n        duration\n        size\n        bitrate\n        codec\n      }\n    }\n  }\n"]
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  query SyncVideoVariantsCount($input: VideoVariantFilter) {\n    videoVariantsCount(input: $input)\n  }\n",
): (typeof documents)["\n  query SyncVideoVariantsCount($input: VideoVariantFilter) {\n    videoVariantsCount(input: $input)\n  }\n"]
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  query SyncVideoVariants($limit: Int!, $offset: Int!, $input: VideoVariantFilter) {\n    videoVariants(limit: $limit, offset: $offset, input: $input) {\n      id\n      slug\n      duration\n      lengthInMilliseconds\n      hls\n      dash\n      share\n      downloadable\n      published\n      brightcoveId\n      videoId\n      language {\n        id\n      }\n      videoEdition {\n        id\n        name\n      }\n      muxVideo {\n        id\n        assetId\n        playbackId\n      }\n      downloads {\n        id\n        quality\n        size\n        height\n        width\n        bitrate\n        url\n      }\n    }\n  }\n",
): (typeof documents)["\n  query SyncVideoVariants($limit: Int!, $offset: Int!, $input: VideoVariantFilter) {\n    videoVariants(limit: $limit, offset: $offset, input: $input) {\n      id\n      slug\n      duration\n      lengthInMilliseconds\n      hls\n      dash\n      share\n      downloadable\n      published\n      brightcoveId\n      videoId\n      language {\n        id\n      }\n      videoEdition {\n        id\n        name\n      }\n      muxVideo {\n        id\n        assetId\n        playbackId\n      }\n      downloads {\n        id\n        quality\n        size\n        height\n        width\n        bitrate\n        url\n      }\n    }\n  }\n"]
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  query SyncVideosCount($where: VideosFilter) {\n    videosCount(where: $where)\n  }\n",
): (typeof documents)["\n  query SyncVideosCount($where: VideosFilter) {\n    videosCount(where: $where)\n  }\n"]
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  query SyncBibleBooks {\n    bibleBooks {\n      id\n      osisId\n      alternateName\n      paratextAbbreviation\n      isNewTestament\n      order\n      name(primary: true) {\n        value\n        primary\n        language {\n          id\n        }\n      }\n    }\n  }\n",
): (typeof documents)["\n  query SyncBibleBooks {\n    bibleBooks {\n      id\n      osisId\n      alternateName\n      paratextAbbreviation\n      isNewTestament\n      order\n      name(primary: true) {\n        value\n        primary\n        language {\n          id\n        }\n      }\n    }\n  }\n"]
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  query SyncVideos($limit: Int!, $offset: Int!, $where: VideosFilter) {\n    videos(where: $where, limit: $limit, offset: $offset) {\n      id\n      slug\n      label\n      publishedAt\n      primaryLanguageId\n      locked\n      noIndex\n      source\n      origin {\n        id\n        name\n        description\n      }\n      title {\n        id\n        value\n        primary\n        language {\n          id\n        }\n      }\n      description {\n        id\n        value\n        primary\n        language {\n          id\n        }\n      }\n      snippet {\n        id\n        value\n        primary\n        language {\n          id\n        }\n      }\n      studyQuestions {\n        id\n        value\n        primary\n        order\n        language {\n          id\n        }\n      }\n      imageAlt {\n        id\n        value\n        primary\n        language {\n          id\n        }\n      }\n      bibleCitations {\n        id\n        osisId\n        chapterStart\n        chapterEnd\n        verseStart\n        verseEnd\n        order\n        bibleBook {\n          id\n          osisId\n        }\n      }\n      keywords {\n        id\n      }\n      images {\n        id\n        aspectRatio\n        mobileCinematicHigh\n        mobileCinematicLow\n        mobileCinematicVeryLow\n        thumbnail\n        videoStill\n        blurhash\n        url\n      }\n      subtitles {\n        id\n        primary\n        vttSrc\n        srtSrc\n        value\n        language {\n          id\n        }\n        videoEdition {\n          id\n          name\n        }\n      }\n      children {\n        id\n      }\n    }\n  }\n",
): (typeof documents)["\n  query SyncVideos($limit: Int!, $offset: Int!, $where: VideosFilter) {\n    videos(where: $where, limit: $limit, offset: $offset) {\n      id\n      slug\n      label\n      publishedAt\n      primaryLanguageId\n      locked\n      noIndex\n      source\n      origin {\n        id\n        name\n        description\n      }\n      title {\n        id\n        value\n        primary\n        language {\n          id\n        }\n      }\n      description {\n        id\n        value\n        primary\n        language {\n          id\n        }\n      }\n      snippet {\n        id\n        value\n        primary\n        language {\n          id\n        }\n      }\n      studyQuestions {\n        id\n        value\n        primary\n        order\n        language {\n          id\n        }\n      }\n      imageAlt {\n        id\n        value\n        primary\n        language {\n          id\n        }\n      }\n      bibleCitations {\n        id\n        osisId\n        chapterStart\n        chapterEnd\n        verseStart\n        verseEnd\n        order\n        bibleBook {\n          id\n          osisId\n        }\n      }\n      keywords {\n        id\n      }\n      images {\n        id\n        aspectRatio\n        mobileCinematicHigh\n        mobileCinematicLow\n        mobileCinematicVeryLow\n        thumbnail\n        videoStill\n        blurhash\n        url\n      }\n      subtitles {\n        id\n        primary\n        vttSrc\n        srtSrc\n        value\n        language {\n          id\n        }\n        videoEdition {\n          id\n          name\n        }\n      }\n      children {\n        id\n      }\n    }\n  }\n"]

export function graphql(source: string) {
  return (documents as any)[source] ?? {}
}

export type DocumentType<TDocumentNode extends DocumentNode<any, any>> =
  TDocumentNode extends DocumentNode<infer TType, any> ? TType : never
