export const MAX_MEDIA_UPLOAD_BYTES = 5 * 1024 * 1024
export const MAX_MEDIA_UPLOAD_LABEL = "5 MB"

export function mediaUploadTooLargeMessage(fileName?: string) {
  return fileName
    ? `${fileName} is larger than ${MAX_MEDIA_UPLOAD_LABEL}. Choose a smaller file.`
    : `Choose a file smaller than ${MAX_MEDIA_UPLOAD_LABEL}.`
}
