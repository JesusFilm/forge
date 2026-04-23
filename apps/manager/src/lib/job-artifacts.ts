export function buildJobArtifactFilename(
  artifactType: string,
  ext: string,
): string {
  return `${artifactType}.${ext}`
}

export function buildJobArtifactUrl(
  jobId: string,
  artifactType: string,
  ext: string,
): string {
  const filename = buildJobArtifactFilename(artifactType, ext)
  return `/api/jobs/${encodeURIComponent(jobId)}/artifacts/${encodeURIComponent(filename)}`
}

export function parseJobArtifactFilename(
  filename: string,
): { artifactType: string; ext: string } | null {
  const normalized = filename.trim()
  const dotIndex = normalized.lastIndexOf(".")

  if (dotIndex <= 0 || dotIndex === normalized.length - 1) {
    return null
  }

  return {
    artifactType: normalized.slice(0, dotIndex),
    ext: normalized.slice(dotIndex + 1),
  }
}
