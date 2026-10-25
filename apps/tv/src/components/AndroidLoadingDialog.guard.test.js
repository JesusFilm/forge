/* global require, test, expect */
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("fs")
const path = require("path")
const root = path.resolve(__dirname, "../..")
const read = (name) => fs.readFileSync(path.join(root, name), "utf8")
const native = (name) =>
  read(
    `modules/native-android-player/android/src/main/java/expo/modules/nativeandroidplayer/${name}`,
  )

test("route loading yields focus to the intro and reevaluates when it completes", () => {
  const source = read("src/components/AndroidLoadingDialog.tsx")
  expect(source).toContain("const introActive = useStartupIntroActive()")
  expect(source).toMatch(
    /if \(introActive\) return\s+return openAndroidLoading/,
  )
  expect(source).toContain("[id, message, introActive]")
  expect(source).toContain("`${id}-${++generation.current}`")
  expect(source).toContain("() => onBackRef.current()")
})

test("only route loading opts into the transparent native focus shield", () => {
  const source = native("NativeAndroidPlayerModule.kt")
  const loading = source
    .split('AsyncFunction("showLoadingDialog")')[1]
    .split('AsyncFunction("dismissLoadingDialog")')[0]
  expect(loading).toContain("transparent = true")
  expect(loading).toContain("loadingRequestId = requestId")
  expect(loading).toContain("if (loadingRequestId == requestId)")
  expect(loading).toContain("promise.resolve(null)")
  expect(source.match(/transparent = true/g)).toHaveLength(1)
})

test("the focus shield paints nothing and never starts dot animation", () => {
  const source = native("BrandedLoadingView.kt")
  expect(source).toContain(
    "if (transparent) Color.TRANSPARENT else Color.rgb(22, 19, 17)",
  )
  expect(source).toContain("if (transparent) return")
  expect(source).toContain("canvas.drawBitmap")
  expect(source.indexOf("if (transparent) return")).toBeLessThan(
    source.indexOf("canvas.drawBitmap"),
  )
  expect(source).toContain(
    "if (!transparent && isShown && animationsEnabled()) pulse.start()",
  )
  expect(source).toContain(
    "if (!transparent && isVisible && animationsEnabled())",
  )
})

test("the transparent dialog keeps modal focus and Back without dimming React", () => {
  const source = native("BrandedLoadingView.kt")
  expect(source).toContain(
    "BrandedLoadingView(context, label, transparent = transparent)",
  )
  expect(source).toContain(
    "if (transparent) clearFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND)",
  )
  expect(source).not.toMatch(/FLAG_NOT_FOCUSABLE|FLAG_NOT_TOUCHABLE/)
  expect(source).toContain("isFocusable = true")
  expect(source).toContain("isFocusableInTouchMode = true")
  expect(source).toContain("dialog.setCancelable(true)")
  expect(source).toContain("dialog.setCanceledOnTouchOutside(false)")
  expect(source).toContain("dialog.window?.setLayout(-1, -1)")
  expect(source).toContain("content.requestFocus()")
  expect(source).toContain("KeyEvent.KEYCODE_DPAD_CENTER")
  expect(source).toContain("KeyEvent.KEYCODE_DPAD_RIGHT)) true")
})

test("the pre-JS cover stays opaque without a logo while preserving focus and Back", () => {
  const source = native("StartupLoadingOverlay.kt")
  expect(source).toContain(
    'BrandedLoadingView(activity, "Starting app", transparent = true)',
  )
  expect(source).toContain("setBackgroundColor(Color.rgb(22, 19, 17))")
  expect(source).toContain("root.addView(StartupLoadingView(activity)")
  expect(source).toContain(
    "if (isShown && hasWindowFocus() && focused !== loading) loading.requestFocus()",
  )
  expect(source).toContain(
    "override fun handleOnBackPressed() { activity.finish() }",
  )
  expect(source).toContain("backCallback.remove()")
  expect(source).not.toMatch(/watch_loading_logo|BitmapFactory|ValueAnimator/)
})

test("native playback and resume retain the existing branded dots by default", () => {
  const source = native("BrandedLoadingView.kt")
  expect(source).toContain("private val transparent: Boolean = false")
  expect(source).toContain("for (index in 0..2)")
  expect(source).toContain(
    'showBrandedLoadingDialog(context, "Preparing playback", {})',
  )
  expect(native("NativeAndroidPlayerView.kt")).toContain(
    'BrandedLoadingView(context, "Preparing playback")',
  )
})
