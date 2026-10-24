import {
  DEFAULT_WATCH_PREFERENCES,
  parseStoredPreferences,
  serializeWatchPreferences,
} from "../watchPreferences"
import { TOP_SHELF_PREVIEW_OPTIONS } from "./preview"

test.each(TOP_SHELF_PREVIEW_OPTIONS)(
  "persists $value without changing player/loading choices",
  ({ value }) => {
    const prefs = {
      ...DEFAULT_WATCH_PREFERENCES,
      topShelfPreviewStyle: value,
      loadingAnimationId: "dots" as const,
      startupAnimationId: "09" as const,
      nativePlayerVariant: "native-b" as const,
      audioLanguageSlug: "thai",
    }
    expect(parseStoredPreferences(serializeWatchPreferences(prefs))).toEqual(
      prefs,
    )
  },
)

test("invalid stored preview falls back without changing Native A or dots", () => {
  expect(
    parseStoredPreferences(
      JSON.stringify({
        topShelfPreviewStyle: "bad",
        loadingAnimationId: "dots",
      }),
    ),
  ).toMatchObject({
    topShelfPreviewStyle: "automatic",
    nativePlayerVariant: "native-a",
    loadingAnimationId: "dots",
  })
})
