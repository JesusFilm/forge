export class VideoDbBackupError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "VideoDbBackupError"
  }
}
