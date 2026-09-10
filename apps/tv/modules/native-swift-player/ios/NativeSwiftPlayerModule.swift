import ExpoModulesCore

struct NativePlayerOption: Record {
  @Field var id: String = ""
  @Field var label: String = ""
  @Field var detail: String = ""
  @Field var url: String = ""
}

struct NativePlayerMoment: Record {
  @Field var id: String = ""
  @Field var label: String = ""
  @Field var detail: String = ""
  @Field var startSeconds: Double = 0
}

public final class NativeSwiftPlayerModule: Module {
  public func definition() -> ModuleDefinition {
    Name("NativeSwiftPlayer")

    View(NativeSwiftPlayerView.self) {
      Events(
        "onDismiss",
        "onEnded",
        "onPlayNext",
        "onPlaybackPosition",
        "onError",
        "onAudioChange",
        "onSubtitleChange"
      )

      Prop("sourceUrl") { (view, value: String?) in
        view.sourceUrl = value
      }
      Prop("playerVariant") { (view, value: String?) in
        view.playerVariant = value == "native-b" ? "native-b" : "native-a"
      }
      Prop("storyboardUrl") { (view, value: String?) in
        view.storyboardUrl = value
      }
      Prop("title") { (view, value: String?) in
        view.videoTitle = value
      }
      Prop("startAtSeconds") { (view, value: Double?) in
        view.startAtSeconds = max(0, value ?? 0)
      }
      Prop("audioOptions") { (view, value: [NativePlayerOption]) in
        view.audioOptions = value
      }
      Prop("selectedAudioId") { (view, value: String?) in
        view.selectedAudioId = value
      }
      Prop("subtitleOptions") { (view, value: [NativePlayerOption]) in
        view.subtitleOptions = value
      }
      Prop("selectedSubtitleId") { (view, value: String?) in
        view.selectedSubtitleId = value
      }
      Prop("selectedSubtitleUrl") { (view, value: String?) in
        view.selectedSubtitleUrl = value
      }
      Prop("moments") { (view, value: [NativePlayerMoment]) in
        view.moments = value
      }
      Prop("questions") { (view, value: [String]) in
        view.questions = value
      }
      Prop("upNextSlug") { (view, value: String?) in
        view.upNextSlug = value
      }
      Prop("upNextTitle") { (view, value: String?) in
        view.upNextTitle = value
      }
      OnViewDidUpdateProps { (view: NativeSwiftPlayerView) in
        view.commitProps()
      }
    }
  }
}
