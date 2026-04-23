import type { WorkflowStepName } from "../../types/job"

type ArtifactSelection = {
  exact?: string[]
  prefixes?: string[]
}

const ARTIFACT_SELECTION_BY_STEP: Record<WorkflowStepName, ArtifactSelection> =
  {
    download_video: {},
    transcription: { exact: ["transcript"] },
    structured_transcript: { exact: ["subtitlesVtt"] },
    subtitle_post_process: {
      exact: [
        "subtitlePostProcessManifest",
        "subtitlesByLanguage",
        "subtitleTheologyByLanguage",
        "subtitleLanguageDeltasByLanguage",
        "subtitleTrackMetadata",
      ],
    },
    chapters: { exact: ["chapters"] },
    metadata: { exact: ["metadata"] },
    embeddings: { exact: ["embeddings"] },
    translation: {
      exact: ["translations"],
      prefixes: ["translation-"],
    },
    voiceover: {
      exact: ["voiceover"],
      prefixes: ["voiceover-"],
    },
    artifact_upload: { exact: ["storyboard", "chunks", "artifactManifest"] },
    mux_upload: { exact: ["muxUpload"] },
    cms_notify: {},
  }

export function getArtifactsForStep(
  stepName: WorkflowStepName,
  artifacts: Record<string, string>,
): Array<{ key: string; url: string }> {
  const selection = ARTIFACT_SELECTION_BY_STEP[stepName]
  const matchedKeys = new Set<string>()

  for (const key of selection.exact ?? []) {
    if (artifacts[key]) {
      matchedKeys.add(key)
    }
  }

  for (const [key, url] of Object.entries(artifacts).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    if (!url) {
      continue
    }

    if ((selection.prefixes ?? []).some((prefix) => key.startsWith(prefix))) {
      matchedKeys.add(key)
    }
  }

  return Array.from(matchedKeys, (key) => ({ key, url: artifacts[key]! }))
}

export function shouldShowArtifactKey(stepName: WorkflowStepName): boolean {
  return stepName === "translation" || stepName === "voiceover"
}
