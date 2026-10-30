import {
  NativeTrackChoice,
  type NativeTrackChoiceProps,
} from "./NativeTrackChoice"

export function AndroidTrackChoice(props: NativeTrackChoiceProps) {
  return <NativeTrackChoice nativeModuleName="NativeAndroidPlayer" {...props} />
}
