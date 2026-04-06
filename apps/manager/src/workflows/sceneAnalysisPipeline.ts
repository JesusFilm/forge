// Scene analysis pipeline — standalone workflow decoupled from video enrichment.
//
// This pipeline consumes existing subtitle data from the CMS (synced from Core API)
// rather than requiring Mux transcription. It runs independently and can be
// triggered for any video that has subtitles + Mux playback data.
//
// Steps: fetch subtitle → generate chapters → extract scene boundaries → analyze scenes (Gemini)

import { fetchSubtitleText } from "@/services/subtitles"
import { generateChapters } from "@/services/chapters"
import { extractAndStoreSceneBoundaries } from "@/services/sceneBoundaries"
import { analyzeAllScenes } from "@/services/sceneAnalysis"
import { getMuxAsset } from "@/services/mux"

export type SceneAnalysisPipelineInput = {
  videoId: number
  assetId: string
  muxAssetId: string
  subtitleUrl: string
  videoLabel: string
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

  // Step 1: Fetch existing subtitle and parse to plain text
  const transcript = await fetchSubtitleText(input.subtitleUrl)

  if (!transcript || transcript.length < 10) {
    throw new Error(
      `Subtitle text too short or empty for video ${input.videoId}`,
    )
  }

  // Step 2: Generate chapters from the transcript
  const chaptersResult = await generateChapters(input.assetId, transcript)

  // Step 3: Extract scene boundaries from chapters
  const sceneBoundaries = await extractAndStoreSceneBoundaries(
    input.assetId,
    chaptersResult.chapters,
    transcript,
  )

  // Step 4: Analyze scenes with Gemini (video + transcript)
  const muxAsset = await getMuxAsset(input.muxAssetId)

  const analysisResult = await analyzeAllScenes(
    input.assetId,
    muxAsset.playbackId,
    sceneBoundaries.scenes,
    {
      videoLabel: input.videoLabel,
      bibleVerses: input.bibleVerses,
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
