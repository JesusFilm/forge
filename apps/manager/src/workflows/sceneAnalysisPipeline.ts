// Scene analysis pipeline — standalone workflow decoupled from video enrichment.
//
// This pipeline prefers existing subtitle data from admin/Core. If that subtitle
// is unavailable but a Mux asset exists, it can generate/read Mux subtitles as a
// fallback so admin-triggered scene analysis is not blocked by a stale subtitle URL.
//
// Steps: fetch subtitle → generate chapters → extract scene boundaries → analyze scenes (OpenRouter + stills)

import { fetchSubtitleText } from "@/services/subtitles"
import { generateChapters } from "@/services/chapters"
import { extractAndStoreSceneBoundaries } from "@/services/sceneBoundaries"
import { analyzeAllScenes } from "@/services/sceneAnalysis"
import { getMuxAsset } from "@/services/mux"
import { transcribe } from "@/services/transcription"

export type SceneAnalysisPipelineInput = {
  videoId: number
  assetId: string
  muxAssetId: string
  subtitleUrl?: string
  videoLabel: string
  languageCode?: string
  targetLocale?: string
  bibleVerses?: string[]
}

export type SceneAnalysisPipelineOutput = {
  videoId: number
  assetId: string
  sceneCount: number
  totalInputTokens: number
  totalOutputTokens: number
}

export async function runSceneAnalysisPipeline(
  input: SceneAnalysisPipelineInput,
): Promise<SceneAnalysisPipelineOutput> {
  console.log(
    JSON.stringify({
      event: "scene_pipeline_start",
      videoId: input.videoId,
      assetId: input.assetId,
    }),
  )

  const inputLanguageBcp47 = input.targetLocale ?? input.languageCode ?? "auto"

  // Step 1: Fetch existing target-language subtitle or transcribe the
  // selected target-language Mux asset as fallback.
  const transcript = input.subtitleUrl
    ? await fetchSubtitleText(input.subtitleUrl)
    : (await transcribe(input.assetId, input.muxAssetId, inputLanguageBcp47))
        .text

  if (!transcript || transcript.length < 10) {
    throw new Error(
      `Subtitle text too short or empty for video ${input.videoId}`,
    )
  }

  // Step 2: Generate chapters from the transcript
  const chaptersResult = await generateChapters(input.assetId, {
    transcriptText: transcript,
  })

  // Step 3: Extract scene boundaries from chapters
  const sceneBoundaries = await extractAndStoreSceneBoundaries(
    input.assetId,
    chaptersResult.chapters,
    transcript,
  )

  // Step 4: Analyze scenes with OpenRouter + thumbnail stills
  const muxAsset = await getMuxAsset(input.muxAssetId)

  const analysisResult = await analyzeAllScenes(
    input.assetId,
    muxAsset.playbackId,
    sceneBoundaries.scenes,
    {
      videoLabel: input.videoLabel,
      bibleVerses: input.bibleVerses,
      targetLocale: input.targetLocale,
      inputLanguageBcp47,
      muxAssetId: input.muxAssetId,
      transcriptSource: input.subtitleUrl
        ? {
            kind: "subtitle-url",
            languageBcp47: inputLanguageBcp47,
            subtitleUrl: input.subtitleUrl,
          }
        : {
            kind: "mux-transcription",
            languageBcp47: inputLanguageBcp47,
            muxAssetId: input.muxAssetId,
          },
    },
  )

  console.log(
    JSON.stringify({
      event: "scene_pipeline_complete",
      videoId: input.videoId,
      assetId: input.assetId,
      sceneCount: analysisResult.scenes.length,
      totalInputTokens: analysisResult.totalInputTokens,
      totalOutputTokens: analysisResult.totalOutputTokens,
    }),
  )

  return {
    videoId: input.videoId,
    assetId: input.assetId,
    sceneCount: analysisResult.scenes.length,
    totalInputTokens: analysisResult.totalInputTokens,
    totalOutputTokens: analysisResult.totalOutputTokens,
  }
}
